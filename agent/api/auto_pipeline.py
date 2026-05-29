"""Auto-Pipeline — chạy toàn bộ pipeline từ đầu đến cuối tự động.

POST /api/ai/auto-pipeline        — khởi chạy pipeline (background task)
GET  /api/ai/auto-pipeline/{id}   — poll trạng thái
DELETE /api/ai/auto-pipeline/{id} — hủy job
"""
import asyncio
import logging
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent.api.ai_generate import (
    _call_ai, _parse_json_response, _material_hint,
    ORIENTATION_HINTS, _char_summary,
)
from agent.api.requests import (
    _ensure_flow_session_ready,
    _ensure_queue_accepts_new_work,
    _ensure_recent_captcha_allows_new_work,
)
from agent.db import crud

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["auto-pipeline"])

# ── In-memory job store ───────────────────────────────────────

class PipelineStep(BaseModel):
    name: str
    status: str = "pending"   # pending | running | done | failed | skipped
    detail: str = ""
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

class PipelineJob(BaseModel):
    job_id: str
    project_id: str
    status: str = "running"   # running | completed | failed | cancelled
    current_step: str = ""
    steps: list[PipelineStep] = []
    video_id: Optional[str] = None
    scene_count: int = 0
    error: Optional[str] = None
    created_at: float = 0.0
    finished_at: Optional[float] = None

_jobs: dict[str, PipelineJob] = {}


def _get_job(job_id: str) -> PipelineJob:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} không tồn tại")
    return job


def _step(job: PipelineJob, name: str) -> PipelineStep:
    s = next((x for x in job.steps if x.name == name), None)
    if not s:
        s = PipelineStep(name=name)
        job.steps.append(s)
    return s


def _mark(job: PipelineJob, step_name: str, status: str, detail: str = ""):
    s = _step(job, step_name)
    s.status = status
    s.detail = detail
    if status == "running":
        s.started_at = time.time()
    elif status in ("done", "failed", "skipped"):
        s.finished_at = time.time()
    job.current_step = step_name
    logger.info("AutoPipeline [%s] %s → %s %s", job.job_id[:8], step_name, status, detail)


# ── Pydantic models ───────────────────────────────────────────

class AutoPipelineRequest(BaseModel):
    project_id: str
    episode_title: str
    episode_brief: str
    scene_count: int = 10
    orientation: str = "VERTICAL"
    include_refs: bool = True
    auto_review: bool = False
    style_notes: Optional[str] = None
    provider: Optional[str] = None  # override: "claude" | "openai" | "gemini"


class AutoPipelineResponse(BaseModel):
    job_id: str
    status: str
    steps: list[PipelineStep]
    video_id: Optional[str] = None
    scene_count: int = 0
    current_step: str = ""
    error: Optional[str] = None
    elapsed_secs: Optional[float] = None


# ── Batch helpers ─────────────────────────────────────────────

async def _poll_batch_done(video_id: str, req_type: str, timeout: int = 900) -> bool:
    """Poll batch-status until done=true. Returns True if all_succeeded."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            rows = await crud.list_requests(video_id=video_id)
            rows = [r for r in rows if r.get("type") == req_type]
            if rows:
                pending = sum(1 for r in rows if r["status"] == "PENDING")
                processing = sum(1 for r in rows if r["status"] == "PROCESSING")
                completed = sum(1 for r in rows if r["status"] == "COMPLETED")
                if pending == 0 and processing == 0:
                    return completed == len(rows)
        except Exception:
            pass
        await asyncio.sleep(5)
    return False


async def _poll_refs_done(project_id: str, timeout: int = 300) -> bool:
    """Poll until all characters have media_id."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            chars = await crud.get_project_characters(project_id)
            if not chars:
                return True  # no characters needed
            if all(c.get("media_id") for c in chars):
                return True
        except Exception:
            pass
        await asyncio.sleep(5)
    return False


async def _submit_batch(requests_list: list[dict]):
    """Submit requests to DB directly (bypasses HTTP, same as /api/requests/batch)."""
    _ensure_queue_accepts_new_work()
    _ensure_flow_session_ready()
    await _ensure_recent_captcha_allows_new_work()
    for item in requests_list:
        req_type = item.pop("type", item.pop("req_type", None))
        if not req_type:
            continue
        scene_id    = item.get("scene_id")
        char_id     = item.get("character_id")
        project_id  = item.get("project_id")
        video_id    = item.get("video_id")
        orientation = item.get("orientation")

        # Idempotent: skip if active request exists
        if scene_id and req_type:
            existing = await crud.list_requests(scene_id=scene_id)
            active = [r for r in existing
                      if r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                continue

        if char_id and req_type:
            existing = await crud.list_requests(project_id=project_id)
            active = [r for r in existing
                      if r.get("character_id") == char_id
                      and r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                continue

        await crud.create_request(
            req_type=req_type,
            scene_id=scene_id,
            character_id=char_id,
            project_id=project_id,
            video_id=video_id,
            orientation=orientation,
        )


# ── Background task ───────────────────────────────────────────

async def _run_pipeline(job_id: str, req: AutoPipelineRequest):
    """The actual pipeline — runs in background asyncio task."""
    job = _jobs[job_id]
    STEP_SCRIPT = "1. AI tạo kịch bản"
    STEP_CREATE = "2. Tạo video + cảnh"
    STEP_REFS   = "3. Ảnh tham chiếu"
    STEP_IMAGES = "4. Ảnh cảnh"
    STEP_VIDEOS = "5. Video cảnh"
    STEP_REVIEW = "6. Review chất lượng"
    STEP_DONE   = "7. Hoàn thành"

    step_names = [STEP_SCRIPT, STEP_CREATE, STEP_REFS, STEP_IMAGES, STEP_VIDEOS]
    if req.auto_review:
        step_names.append(STEP_REVIEW)
    step_names.append(STEP_DONE)
    for sn in step_names:
        _step(job, sn)

    try:
        # ── Step 1: Generate script ──────────────────────────
        _mark(job, STEP_SCRIPT, "running", "Đang gọi AI tạo kịch bản...")

        project = await crud.get_project(req.project_id)
        if not project:
            raise ValueError(f"Không tìm thấy project {req.project_id}")

        chars = await crud.get_project_characters(req.project_id)
        all_videos = await crud.list_videos(req.project_id)
        ep_number = len(all_videos) + 1

        material_hint    = _material_hint(project.get("material", "realistic"))
        orientation_hint = ORIENTATION_HINTS.get(req.orientation, "")
        char_block       = _char_summary(chars)

        prev_ctx = ""
        if all_videos:
            prev_lines = [
                f"- Tập {i+1}: {v.get('title','?')}\n  {(v.get('description') or '')[:150]}"
                for i, v in enumerate(all_videos[-3:])
            ]
            prev_ctx = "Các tập trước:\n" + "\n".join(prev_lines)

        system = f"""Biên kịch series video AI. Viết kịch bản tập mới bám sát project gốc.
PHONG CÁCH: {material_hint}
ĐỊNH DẠNG: {orientation_hint}
NGÔN NGỮ: vi
CONTINUITY: Nhân vật nhất quán, kế thừa sự kiện tập trước.
Trả về JSON thuần, không giải thích."""

        user = f"""PROJECT: {project.get('name', '')}
STORY: {project.get('story', '')}

NHÂN VẬT:
{char_block}

{prev_ctx}

TẬP {ep_number}: {req.episode_title}
NỘI DUNG: {req.episode_brief}
{f"GHI CHÚ: {req.style_notes}" if req.style_notes else ""}

Viết {req.scene_count} cảnh. Trả về JSON:
{{
  "title": "Tiêu đề tập {ep_number}",
  "description": "Tóm tắt 1-2 câu",
  "scenes": [{{"display_order": 0, "prompt": "...", "video_prompt": "0-3s: ... Negative: subtitles.", "narrator_text": "...", "character_names": []}}]
}}"""

        raw = await _call_ai("episodeGen", system, user, max_tokens=8000,
                              provider_override=req.provider)
        data = _parse_json_response(raw, req.provider or "AI")
        ai_scenes = data.get("scenes", [])
        ai_title = data.get("title", f"Tập {ep_number}: {req.episode_title}")
        ai_desc  = data.get("description", req.episode_brief)

        _mark(job, STEP_SCRIPT, "done", f"✓ {len(ai_scenes)} cảnh được tạo")

        # ── Step 2: Create video + scenes in DB ──────────────
        _mark(job, STEP_CREATE, "running", "Đang tạo video + cảnh trong DB...")

        video = await crud.create_video(
            project_id=req.project_id,
            title=ai_title,
            description=ai_desc,
            orientation=req.orientation,
            display_order=len(all_videos),
        )
        video_id = video["id"]
        job.video_id = video_id

        for i, sc in enumerate(ai_scenes):
            char_names = sc.get("character_names") or []
            await crud.create_scene(
                video_id=video_id,
                display_order=sc.get("display_order", i),
                prompt=sc.get("prompt", ""),
                video_prompt=sc.get("video_prompt"),
                character_names=char_names if char_names else None,
                narrator_text=None,  # stored via update below
                chain_type="ROOT" if i == 0 else "CONTINUATION",
                source="auto-pipeline",
            )

        # Update narrator_text via update (not in create signature)
        scenes_db = await crud.list_scenes(video_id)
        for i, (sc_data, db_scene) in enumerate(zip(ai_scenes, scenes_db)):
            narrator = sc_data.get("narrator_text", "")
            if narrator:
                await crud.update_scene(db_scene["id"], narrator_text=narrator)

        job.scene_count = len(ai_scenes)
        _mark(job, STEP_CREATE, "done", f"✓ Video + {len(ai_scenes)} cảnh tạo xong")

        # ── Step 3: Gen character reference images ───────────
        if req.include_refs:
            _mark(job, STEP_REFS, "running", "Kiểm tra ảnh tham chiếu nhân vật...")
            missing_chars = [c for c in chars if not c.get("media_id")]
            if missing_chars:
                ref_reqs = [
                    {
                        "type": "GENERATE_CHARACTER_IMAGE",
                        "character_id": c["id"],
                        "project_id": req.project_id,
                        "orientation": "HORIZONTAL" if c.get("entity_type") == "location" else "VERTICAL",
                    }
                    for c in missing_chars
                ]
                await _submit_batch(ref_reqs)
                _mark(job, STEP_REFS, "running",
                      f"Đã gửi {len(ref_reqs)} requests — đang chờ hoàn thành...")
                ok = await _poll_refs_done(req.project_id, timeout=300)
                if ok:
                    _mark(job, STEP_REFS, "done", "✓ Tất cả nhân vật đã có ảnh tham chiếu")
                else:
                    _mark(job, STEP_REFS, "failed",
                          "Timeout — một số nhân vật chưa có ảnh, vẫn tiếp tục")
            else:
                _mark(job, STEP_REFS, "skipped", "Tất cả nhân vật đã có ảnh tham chiếu")
        else:
            _mark(job, STEP_REFS, "skipped", "Bỏ qua (include_refs=false)")

        # ── Step 4: Gen scene images ──────────────────────────
        _mark(job, STEP_IMAGES, "running",
              f"Đang gửi {len(scenes_db)} requests tạo ảnh...")

        img_reqs = [
            {
                "type": "GENERATE_IMAGE",
                "scene_id": s["id"],
                "project_id": req.project_id,
                "video_id": video_id,
                "orientation": req.orientation,
            }
            for s in scenes_db
        ]
        await _submit_batch(img_reqs)
        _mark(job, STEP_IMAGES, "running",
              f"Đã gửi {len(img_reqs)} ảnh — đang chờ (có thể mất 2-5 phút)...")

        img_ok = await _poll_batch_done(video_id, "GENERATE_IMAGE", timeout=600)
        if img_ok:
            _mark(job, STEP_IMAGES, "done", f"✓ {len(img_reqs)} ảnh hoàn thành")
        else:
            _mark(job, STEP_IMAGES, "failed",
                  "Một số ảnh thất bại — vẫn tiếp tục tạo video")

        # ── Step 5: Gen scene videos ──────────────────────────
        _mark(job, STEP_VIDEOS, "running",
              f"Đang kiểm tra và tạo video cảnh (2-5 phút/cảnh)...")

        scenes_db2 = await crud.list_scenes(video_id)
        ori_lower   = req.orientation.lower()
        img_stat_k  = f"{ori_lower}_image_status"
        vid_stat_k  = f"{ori_lower}_video_status"

        vid_reqs = [
            {
                "type": "GENERATE_VIDEO",
                "scene_id": s["id"],
                "project_id": req.project_id,
                "video_id": video_id,
                "orientation": req.orientation,
            }
            for s in scenes_db2
            if s.get(img_stat_k) == "COMPLETED"
            and s.get(vid_stat_k) != "COMPLETED"
        ]

        if vid_reqs:
            await _submit_batch(vid_reqs)
            _mark(job, STEP_VIDEOS, "running",
                  f"Đã gửi {len(vid_reqs)} video — đang chờ (có thể mất 10-40 phút)...")
            vid_ok = await _poll_batch_done(video_id, "GENERATE_VIDEO", timeout=3600)
            if vid_ok:
                _mark(job, STEP_VIDEOS, "done", f"✓ {len(vid_reqs)} video hoàn thành")
            else:
                _mark(job, STEP_VIDEOS, "failed",
                      "Một số video thất bại — xem chi tiết trong Pipeline View")
        else:
            _mark(job, STEP_VIDEOS, "skipped",
                  "Không có cảnh nào có ảnh để tạo video (kiểm tra bước 4)")

        # ── Step 6: Auto-review ───────────────────────────────
        if req.auto_review:
            _mark(job, STEP_REVIEW, "running", "Đang review chất lượng bằng Claude Vision...")
            try:
                from agent.api.reviews import review_video as _rv
                result = await _rv(video_id=video_id, mode="light")
                scores = result.get("scores") or {}
                low = [k for k, v in scores.items() if v < 7.5]
                if low:
                    _mark(job, STEP_REVIEW, "done",
                          f"⚠️ {len(low)} cảnh điểm thấp (<7.5): {', '.join(str(x) for x in low[:5])}")
                else:
                    _mark(job, STEP_REVIEW, "done", "✓ Tất cả cảnh đạt chất lượng (≥7.5)")
            except Exception as e:
                _mark(job, STEP_REVIEW, "failed", f"Review lỗi: {e}")

        # ── Done ──────────────────────────────────────────────
        _mark(job, STEP_DONE, "done", f"✓ Pipeline hoàn thành — {job.scene_count} cảnh")
        job.status = "completed"
        job.finished_at = time.time()

    except asyncio.CancelledError:
        job.status = "cancelled"
        job.error = "Job bị hủy"
        job.finished_at = time.time()

    except Exception as e:
        logger.exception("AutoPipeline failed job=%s: %s", job_id[:8], e)
        job.status = "failed"
        job.error = str(e)
        job.finished_at = time.time()


# ── API Endpoints ─────────────────────────────────────────────

@router.post("/auto-pipeline")
async def start_auto_pipeline(body: AutoPipelineRequest):
    """Khởi chạy full auto-pipeline. Trả về job_id để poll."""
    _ensure_queue_accepts_new_work()
    _ensure_flow_session_ready()
    await _ensure_recent_captcha_allows_new_work()
    job_id = str(uuid.uuid4())
    job = PipelineJob(
        job_id=job_id,
        project_id=body.project_id,
        created_at=time.time(),
    )
    _jobs[job_id] = job
    asyncio.create_task(_run_pipeline(job_id, body))
    return AutoPipelineResponse(
        job_id=job_id,
        status=job.status,
        steps=job.steps,
        current_step=job.current_step,
    )


@router.get("/auto-pipeline/{job_id}")
async def get_auto_pipeline_status(job_id: str):
    """Poll trạng thái job."""
    job = _get_job(job_id)
    elapsed = None
    if job.finished_at:
        elapsed = round(job.finished_at - job.created_at, 1)
    elif job.status == "running":
        elapsed = round(time.time() - job.created_at, 1)
    return AutoPipelineResponse(
        job_id=job.job_id,
        status=job.status,
        current_step=job.current_step,
        steps=job.steps,
        video_id=job.video_id,
        scene_count=job.scene_count,
        error=job.error,
        elapsed_secs=elapsed,
    )


@router.delete("/auto-pipeline/{job_id}")
async def cancel_auto_pipeline(job_id: str):
    """Đánh dấu job là cancelled."""
    job = _get_job(job_id)
    if job.status == "running":
        job.status = "cancelled"
        job.error = "Hủy bởi người dùng"
        job.finished_at = time.time()
    return {"ok": True, "status": job.status}


@router.get("/auto-pipeline")
async def list_auto_pipeline_jobs():
    """Liệt kê tất cả jobs gần đây."""
    jobs = sorted(_jobs.values(), key=lambda j: j.created_at, reverse=True)[:50]
    return [
        {
            "job_id": j.job_id,
            "project_id": j.project_id,
            "status": j.status,
            "video_id": j.video_id,
            "current_step": j.current_step,
            "scene_count": j.scene_count,
            "created_at": j.created_at,
            "elapsed": round(time.time() - j.created_at, 1),
        }
        for j in jobs
    ]
