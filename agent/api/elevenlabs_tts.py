"""FastAPI router for ElevenLabs TTS endpoints."""
import asyncio
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse

from agent.api.settings import get_settings
from agent.config import OUTPUT_DIR
from agent.models.elevenlabs_tts import (
    ElevenLabsTTSRequest,
    ElevenLabsBatchRequest,
    ElevenLabsBatchResponse,
    ElevenLabsSegmentResult,
)
from agent.services.elevenlabs_tts import (
    get_voices,
    get_models,
    text_to_speech,
    text_to_speech_with_timestamps,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/elevenlabs", tags=["elevenlabs-tts"])

# Semaphore: max 3 concurrent ElevenLabs TTS requests
_EL_SEMAPHORE = asyncio.Semaphore(3)

# In-memory store for batch jobs
_BATCH_JOBS: dict[str, dict] = {}

# Directory for ElevenLabs output audio
EL_OUTPUT_DIR = OUTPUT_DIR / "elevenlabs_tts"


def _get_api_key() -> str:
    """Get ElevenLabs API key from settings. Raise 400 if not configured."""
    settings = get_settings()
    key = settings.get("elevenlabsApiKey", "").strip()
    if not key:
        raise HTTPException(
            status_code=400,
            detail="ElevenLabs API key not configured. Please add it in Settings → API Keys."
        )
    return key


@router.get("/voices")
async def list_voices():
    """Get all available ElevenLabs voices."""
    settings = get_settings()
    api_key = settings.get("elevenlabsApiKey", "").strip()
    if not api_key:
        return {"voices": [], "total": 0, "configured": False}
    try:
        voices = await get_voices(api_key)
        return {"voices": voices, "total": len(voices), "configured": True}
    except Exception as e:
        logger.exception("Failed to fetch ElevenLabs voices")
        raise HTTPException(500, f"Failed to fetch voices: {str(e)}")


@router.get("/models")
async def list_models():
    """Get all available ElevenLabs TTS models."""
    settings = get_settings()
    api_key = settings.get("elevenlabsApiKey", "").strip()
    if not api_key:
        return {"models": [], "configured": False}
    try:
        models = await get_models(api_key)
        return {"models": models, "configured": True}
    except Exception as e:
        logger.exception("Failed to fetch ElevenLabs models")
        raise HTTPException(500, f"Failed to fetch models: {str(e)}")


@router.get("/test")
async def test_connection():
    """Test ElevenLabs API key connection."""
    api_key = _get_api_key()
    try:
        voices = await get_voices(api_key)
        return {
            "ok": True,
            "voice_count": len(voices),
            "message": f"Kết nối thành công! Tìm thấy {len(voices)} giọng đọc."
        }
    except HTTPException:
        raise
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.post("/tts")
async def generate_tts(body: ElevenLabsTTSRequest):
    """Generate TTS for a single segment. Returns audio file download URL."""
    api_key = _get_api_key()

    EL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    segment_id = body.segment_id or str(uuid.uuid4())
    # Determine file extension from output_format
    ext = "mp3" if body.output_format.startswith("mp3") else (
        "ogg" if body.output_format.startswith("opus") else
        "wav" if body.output_format.startswith("pcm") else "mp3"
    )
    filename = f"{segment_id}.{ext}"
    output_path = str(EL_OUTPUT_DIR / filename)

    async with _EL_SEMAPHORE:
        result = await text_to_speech(
            api_key=api_key,
            voice_id=body.voice_id,
            text=body.text,
            output_path=output_path,
            model_id=body.model_id,
            voice_settings=body.voice_settings.model_dump() if body.voice_settings else None,
            output_format=body.output_format,
            previous_text=body.previous_text,
            next_text=body.next_text,
            language_code=body.language_code,
        )

    if not result.get("ok"):
        raise HTTPException(500, result.get("error", "TTS generation failed"))

    actual_path = result.get("path", output_path)
    actual_filename = Path(actual_path).name

    return {
        "ok": True,
        "segment_id": segment_id,
        "audio_url": f"/api/elevenlabs/audio/{actual_filename}",
        "duration": result.get("duration"),
        "character_count": result.get("character_count"),
    }


@router.post("/tts/with-timestamps")
async def generate_tts_with_timestamps(body: ElevenLabsTTSRequest):
    """Generate TTS with character-level timing alignment."""
    api_key = _get_api_key()

    EL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    segment_id = body.segment_id or str(uuid.uuid4())
    ext = "mp3" if body.output_format.startswith("mp3") else "wav"
    filename = f"{segment_id}.{ext}"
    output_path = str(EL_OUTPUT_DIR / filename)

    async with _EL_SEMAPHORE:
        result = await text_to_speech_with_timestamps(
            api_key=api_key,
            voice_id=body.voice_id,
            text=body.text,
            output_path=output_path,
            model_id=body.model_id,
            voice_settings=body.voice_settings.model_dump() if body.voice_settings else None,
            output_format=body.output_format,
        )

    if not result.get("ok"):
        raise HTTPException(500, result.get("error", "TTS generation failed"))

    actual_path = result.get("path", output_path)
    actual_filename = Path(actual_path).name

    return {
        "ok": True,
        "segment_id": segment_id,
        "audio_url": f"/api/elevenlabs/audio/{actual_filename}",
        "duration": result.get("duration"),
        "alignment": result.get("alignment"),
        "normalized_alignment": result.get("normalized_alignment"),
        "character_count": result.get("character_count"),
    }


@router.post("/tts/batch", response_model=ElevenLabsBatchResponse)
async def generate_tts_batch(body: ElevenLabsBatchRequest, background_tasks: BackgroundTasks):
    """
    Generate TTS for multiple segments. Runs in background.
    Returns job_id for polling via GET /tts/batch/{job_id}
    """
    api_key = _get_api_key()

    if not body.segments:
        raise HTTPException(400, "No segments provided")
    if len(body.segments) > 200:
        raise HTTPException(400, "Too many segments: max 200")

    job_id = str(uuid.uuid4())
    _BATCH_JOBS[job_id] = {
        "total": len(body.segments),
        "completed": 0,
        "failed": 0,
        "done": False,
        "results": [],
    }

    background_tasks.add_task(
        _run_batch_job,
        job_id=job_id,
        api_key=api_key,
        body=body,
    )

    return ElevenLabsBatchResponse(
        job_id=job_id,
        total=len(body.segments),
        completed=0,
        failed=0,
        done=False,
        results=[],
    )


@router.get("/tts/batch/{job_id}", response_model=ElevenLabsBatchResponse)
async def get_batch_status(job_id: str):
    """Poll batch job status."""
    if job_id not in _BATCH_JOBS:
        raise HTTPException(404, "Batch job not found")
    job = _BATCH_JOBS[job_id]
    return ElevenLabsBatchResponse(
        job_id=job_id,
        total=job["total"],
        completed=job["completed"],
        failed=job["failed"],
        done=job["done"],
        results=[ElevenLabsSegmentResult(**r) for r in job["results"]],
    )


@router.delete("/tts/batch/{job_id}")
async def cancel_batch(job_id: str):
    """Cancel and clean up a batch job."""
    if job_id in _BATCH_JOBS:
        _BATCH_JOBS[job_id]["cancelled"] = True
        _BATCH_JOBS[job_id]["done"] = True
        del _BATCH_JOBS[job_id]
    return {"ok": True}


@router.get("/audio/{filename}")
async def download_audio(filename: str):
    """Download a generated audio file by filename."""
    # Security: only allow filenames without path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")

    file_path = EL_OUTPUT_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, "Audio file not found")

    # Determine media type from extension
    ext = file_path.suffix.lower()
    media_type_map = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".pcm": "audio/pcm",
    }
    media_type = media_type_map.get(ext, "audio/mpeg")

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


async def _run_batch_job(job_id: str, api_key: str, body: ElevenLabsBatchRequest):
    """Background task: generate TTS for all segments sequentially."""
    EL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    job = _BATCH_JOBS.get(job_id)
    if not job:
        return

    voice_settings = body.voice_settings.model_dump() if body.voice_settings else None
    ext = "mp3" if body.output_format.startswith("mp3") else (
        "ogg" if body.output_format.startswith("opus") else
        "wav" if body.output_format.startswith("pcm") else "mp3"
    )

    for seg in body.segments:
        if job.get("cancelled"):
            break

        seg_id = seg.get("id") or str(uuid.uuid4())
        text = seg.get("text", "").strip()
        if not text:
            job["results"].append({
                "segment_id": seg_id,
                "status": "failed",
                "error": "Empty text",
            })
            job["failed"] += 1
            continue

        filename = f"{seg_id}.{ext}"
        output_path = str(EL_OUTPUT_DIR / filename)

        try:
            async with _EL_SEMAPHORE:
                result = await text_to_speech(
                    api_key=api_key,
                    voice_id=body.voice_id,
                    text=text,
                    output_path=output_path,
                    model_id=body.model_id,
                    voice_settings=voice_settings,
                    output_format=body.output_format,
                    previous_text=seg.get("previous_text"),
                    next_text=seg.get("next_text"),
                    language_code=body.language_code,
                )

            if result.get("ok"):
                actual_filename = Path(result.get("path", output_path)).name
                job["results"].append({
                    "segment_id": seg_id,
                    "status": "completed",
                    "audio_url": f"/api/elevenlabs/audio/{actual_filename}",
                    "duration": result.get("duration"),
                    "character_count": result.get("character_count"),
                })
                job["completed"] += 1
            else:
                job["results"].append({
                    "segment_id": seg_id,
                    "status": "failed",
                    "error": result.get("error", "Unknown error"),
                })
                job["failed"] += 1

        except Exception as e:
            logger.exception("Batch TTS segment %s failed", seg_id)
            job["results"].append({
                "segment_id": seg_id,
                "status": "failed",
                "error": str(e),
            })
            job["failed"] += 1

        # Small delay between requests to avoid rate limiting
        await asyncio.sleep(0.3)

    job["done"] = True
    logger.info("Batch job %s done: %d completed, %d failed", job_id, job["completed"], job["failed"])
