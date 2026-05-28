"""ElevenLabs TTS service — HTTP client using httpx."""
import asyncio
import logging
from pathlib import Path
from typing import Optional, Any
import httpx

logger = logging.getLogger(__name__)

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
# Timeout for TTS generation (can be slow for long texts)
TTS_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


async def get_voices(api_key: str) -> list[dict]:
    """Fetch all available voices from ElevenLabs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ELEVENLABS_BASE_URL}/voices",
            headers={"xi-api-key": api_key},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("voices", [])


async def get_models(api_key: str) -> list[dict]:
    """Fetch all available TTS models from ElevenLabs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ELEVENLABS_BASE_URL}/models",
            headers={"xi-api-key": api_key},
        )
        resp.raise_for_status()
        data = resp.json()
        # Filter to only TTS-capable models
        return [m for m in data if m.get("can_do_text_to_speech", True)]


async def text_to_speech(
    api_key: str,
    voice_id: str,
    text: str,
    output_path: str,
    model_id: str = "eleven_multilingual_v2",
    voice_settings: Optional[dict] = None,
    output_format: str = "mp3_44100_128",
    previous_text: Optional[str] = None,
    next_text: Optional[str] = None,
    language_code: Optional[str] = None,
) -> dict:
    """
    Generate speech for given text using ElevenLabs API.
    Returns dict with: ok, path, duration, character_count, error
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Build extension from output_format
    ext = "mp3" if output_format.startswith("mp3") else "wav"
    if not output_path.endswith(f".{ext}"):
        output_path = output_path.rsplit(".", 1)[0] + f".{ext}"

    payload: dict[str, Any] = {
        "text": text,
        "model_id": model_id,
    }

    if voice_settings:
        payload["voice_settings"] = voice_settings
    else:
        payload["voice_settings"] = {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
            "speed": 1.0,
        }

    if previous_text:
        payload["previous_text"] = previous_text
    if next_text:
        payload["next_text"] = next_text
    if language_code:
        payload["language_code"] = language_code

    url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}"
    params = {"output_format": output_format}

    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
            resp = await client.post(
                url,
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                    "Accept": f"audio/{ext}",
                },
                json=payload,
                params=params,
            )

            if resp.status_code == 422:
                detail = resp.json().get("detail", str(resp.text))
                return {"ok": False, "error": f"Validation error: {detail}"}

            if resp.status_code == 401:
                return {"ok": False, "error": "Invalid ElevenLabs API key"}

            if resp.status_code == 429:
                return {"ok": False, "error": "ElevenLabs rate limit exceeded. Try again later."}

            if not resp.is_success:
                return {"ok": False, "error": f"ElevenLabs API error {resp.status_code}: {resp.text[:200]}"}

            # Write audio bytes to file
            audio_bytes = resp.content
            Path(output_path).write_bytes(audio_bytes)

            duration = _estimate_duration_from_bytes(len(audio_bytes), output_format)
            character_count = len(text)

            logger.info("ElevenLabs TTS saved: %s (%d chars, %.1fs)", output_path, character_count, duration or 0)
            return {
                "ok": True,
                "path": output_path,
                "duration": duration,
                "character_count": character_count,
            }

    except httpx.TimeoutException:
        return {"ok": False, "error": "ElevenLabs request timed out. Text may be too long."}
    except httpx.HTTPError as e:
        return {"ok": False, "error": f"HTTP error: {str(e)}"}
    except Exception as e:
        logger.exception("ElevenLabs TTS unexpected error")
        return {"ok": False, "error": str(e)}


async def text_to_speech_with_timestamps(
    api_key: str,
    voice_id: str,
    text: str,
    output_path: str,
    model_id: str = "eleven_multilingual_v2",
    voice_settings: Optional[dict] = None,
    output_format: str = "mp3_44100_128",
) -> dict:
    """
    Generate speech with character-level timestamps.
    Returns dict with: ok, path, duration, alignment (characters + start_times)
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    payload: dict[str, Any] = {
        "text": text,
        "model_id": model_id,
        "voice_settings": voice_settings or {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
            "speed": 1.0,
        },
    }

    url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}/with-timestamps"
    params = {"output_format": output_format}

    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
            resp = await client.post(
                url,
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
                params=params,
            )

            if not resp.is_success:
                return {"ok": False, "error": f"ElevenLabs error {resp.status_code}: {resp.text[:200]}"}

            data = resp.json()
            import base64
            audio_b64 = data.get("audio_base64", "")
            alignment = data.get("alignment", {})
            normalized_alignment = data.get("normalized_alignment", {})

            if audio_b64:
                audio_bytes = base64.b64decode(audio_b64)
                Path(output_path).write_bytes(audio_bytes)
                duration = _estimate_duration_from_bytes(len(audio_bytes), output_format)
            else:
                duration = None

            return {
                "ok": True,
                "path": output_path,
                "duration": duration,
                "alignment": alignment,
                "normalized_alignment": normalized_alignment,
                "character_count": len(text),
            }

    except Exception as e:
        logger.exception("ElevenLabs with-timestamps error")
        return {"ok": False, "error": str(e)}


def _estimate_duration_from_bytes(byte_count: int, output_format: str) -> Optional[float]:
    """Rough estimate of duration based on file size and bitrate."""
    try:
        if "mp3" in output_format:
            # Parse bitrate from format like mp3_44100_128
            parts = output_format.split("_")
            kbps = int(parts[-1]) if len(parts) >= 3 else 128
            bytes_per_second = (kbps * 1000) / 8
            return round(byte_count / bytes_per_second, 2)
        elif "pcm" in output_format:
            parts = output_format.split("_")
            sample_rate = int(parts[-1]) if len(parts) >= 2 else 24000
            # 16-bit mono
            bytes_per_second = sample_rate * 2
            return round(byte_count / bytes_per_second, 2)
    except Exception:
        pass
    return None


async def get_voice_preview(api_key: str, voice_id: str) -> Optional[str]:
    """Get preview URL for a voice. Returns the preview_url or None."""
    try:
        voices = await get_voices(api_key)
        voice = next((v for v in voices if v["voice_id"] == voice_id), None)
        return voice.get("preview_url") if voice else None
    except Exception:
        return None
