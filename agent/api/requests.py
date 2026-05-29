from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from agent.models.request import Request, RequestCreate
from agent.models.enums import StatusType
from agent.db import crud

router = APIRouter(prefix="/requests", tags=["requests"])


def _adjust_since(since_str: str) -> str:
    try:
        # since_str is like "2026-05-28T10:13:24.123Z" or "2026-05-28T10:13:24Z"
        clean_str = since_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_str)
        # Subtract 10 seconds to handle clock drift + millisecond truncation safely
        dt_adjusted = dt - timedelta(seconds=10)
        return dt_adjusted.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return since_str


def _ensure_flow_session_ready():
    """Reject new media work before it can become a stuck progress bar."""
    try:
        from agent.services.flow_client import get_flow_client
        client = get_flow_client()
        if not client.connected:
            raise HTTPException(409, "Extension not connected — open Flow browser first")
        if not client.flow_key_present:
            raise HTTPException(409, "Flow session not ready — open/login to Google Flow first")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, f"Flow session check unavailable: {exc}")


def _ensure_queue_accepts_new_work():
    """Fail fast when a stale/captcha-paused queue would keep new work stuck."""
    try:
        from agent.services.flow_client import get_flow_client
        from agent.worker.processor import get_worker_controller
        client = get_flow_client()
        controller = get_worker_controller()
        if not getattr(controller, "paused", False):
            return
        if controller.pause_reason == "CAPTCHA_UNUSUAL_ACTIVITY":
            raise HTTPException(
                409,
                "Worker is paused after reCAPTCHA unusual activity. Cancel stale requests before submitting new work.",
            )
        if controller.pause_reason == "STALE_QUEUE":
            raise HTTPException(
                409,
                "Worker is holding a queue from a previous app session. Cancel stale requests before submitting new work.",
            )
        if controller.pause_reason == "NO_FLOW_KEY" and not controller.can_auto_resume_after_flow_key():
            raise HTTPException(
                409,
                "Worker is holding a stale queue from an older Flow session. Cancel stale requests before submitting new work.",
            )
    except HTTPException:
        raise
    except Exception:
        # Do not block request creation if worker coordination is unavailable.
        return


async def _ensure_recent_captcha_allows_new_work():
    for row in await crud.list_requests():
        error = (row.get("error_message") or "").lower()
        if not _is_unusual_activity_message(error):
            continue
        ts = row.get("updated_at") or row.get("created_at")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            continue
        if datetime.now(dt.tzinfo) - dt <= timedelta(minutes=30):
            raise HTTPException(
                409,
                "Recent reCAPTCHA unusual activity is recorded. Wait 30 minutes, refresh the Flow browser session, then retry later.",
            )


def _is_unusual_activity_message(message: str) -> bool:
    return "public_error_unusual_activity" in message or "unusual_activity" in message


def _cancel_error_message(request: dict) -> str:
    """Keep unusual-activity evidence so submit guards can enforce cooldown."""
    existing = request.get("error_message") or ""
    if _is_unusual_activity_message(existing.lower()):
        return f"{existing} | Cancelled by user"
    return "Cancelled by user"



class RequestUpdate(BaseModel):
    status: Optional[StatusType] = None
    media_id: Optional[str] = None
    output_url: Optional[str] = None
    error_message: Optional[str] = None
    request_id: Optional[str] = None


class BatchRequestCreate(BaseModel):
    requests: list[RequestCreate]


class BatchStatus(BaseModel):
    total: int
    pending: int
    processing: int
    completed: int
    failed: int
    done: bool
    all_succeeded: bool
    orientation: Optional[str] = None
    worker_paused: bool = False
    blocked: bool = False
    last_error: Optional[str] = None


@router.post("", response_model=Request)
async def create(body: RequestCreate):
    _ensure_queue_accepts_new_work()
    _ensure_flow_session_ready()
    await _ensure_recent_captcha_allows_new_work()
    data = body.model_dump(exclude_none=True)
    data["req_type"] = data.pop("type")

    # Reject if there's already an active request for the same scene + type
    scene_id = data.get("scene_id")
    req_type = data.get("req_type")
    if scene_id and req_type:
        existing = await crud.list_requests(scene_id=scene_id)
        active = [r for r in existing
                  if r.get("type") == req_type
                  and r.get("status") in ("PENDING", "PROCESSING")]
        if active:
            raise HTTPException(
                409,
                f"Active {req_type} request already exists for scene {scene_id[:8]} "
                f"(status={active[0]['status']}, id={active[0]['id'][:8]})"
            )

    # Auto-set video orientation (symmetric with batch endpoint)
    vid = data.get("video_id")
    orient = data.get("orientation")
    if vid and orient:
        await crud.update_video(vid, orientation=orient)

    return await crud.create_request(**data)


@router.post("/batch", response_model=list[Request])
async def create_batch(body: BatchRequestCreate):
    """Submit multiple requests atomically. Server handles throttling (max 5 concurrent, 10s cooldown).
    Duplicate active requests for the same scene+type are skipped (not errors)."""
    _ensure_queue_accepts_new_work()
    _ensure_flow_session_ready()
    await _ensure_recent_captcha_allows_new_work()
    # Auto-set video orientation from the batch (tracks current active orientation)
    _seen_vids: set[str] = set()
    for item in body.requests:
        vid = item.video_id
        orient = item.orientation
        if vid and orient and vid not in _seen_vids:
            _seen_vids.add(vid)
            await crud.update_video(vid, orientation=orient)
    results = []
    for item in body.requests:
        data = item.model_dump(exclude_none=True)
        data["req_type"] = data.pop("type")
        scene_id = data.get("scene_id")
        character_id = data.get("character_id")
        req_type = data.get("req_type")
        # Idempotent: skip if active request already exists
        if scene_id and req_type:
            existing = await crud.list_requests(scene_id=scene_id)
            active = [r for r in existing
                      if r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                results.append(active[0])
                continue
        if character_id and req_type:
            existing = await crud.list_requests(project_id=data.get("project_id"))
            active = [r for r in existing
                      if r.get("character_id") == character_id
                      and r.get("type") == req_type
                      and r.get("status") in ("PENDING", "PROCESSING")]
            if active:
                results.append(active[0])
                continue
        results.append(await crud.create_request(**data))

    return results


@router.get("", response_model=list[Request])
async def list_all(scene_id: str = None, status: str = None,
                   video_id: str = None, project_id: str = None):
    return await crud.list_requests(scene_id=scene_id, status=status,
                                    video_id=video_id, project_id=project_id)


@router.get("/pending", response_model=list[Request])
async def list_pending():
    return await crud.list_pending_requests()


@router.get("/batch-status", response_model=BatchStatus)
async def batch_status(video_id: str = None, project_id: str = None,
                       type: str = None, orientation: str = None,
                       since: str = None):
    """Aggregate status for all requests matching the filter.
    Poll this instead of polling N individual request IDs.
    `since` is an ISO timestamp (e.g. 2026-01-01T00:00:00Z) to only count requests created at or after that time.
    Use it to avoid counting stale requests from previous sessions."""
    rows = await crud.list_requests(video_id=video_id, project_id=project_id)
    if type:
        rows = [r for r in rows if r.get("type") == type]
    if orientation:
        rows = [r for r in rows if r.get("orientation") == orientation]
    if since:
        adjusted_since = _adjust_since(since)
        rows = [r for r in rows if r.get("created_at", "") >= adjusted_since]
    counts = {"PENDING": 0, "PROCESSING": 0, "COMPLETED": 0, "FAILED": 0}
    for r in rows:
        s = r.get("status", "PENDING")
        counts[s] = counts.get(s, 0) + 1
    total = len(rows)
    last_error = next(
        (
            r.get("error_message")
            for r in rows
            if r.get("error_message") and r.get("status") in ("PENDING", "PROCESSING", "FAILED")
        ),
        None,
    )
    try:
        from agent.worker.processor import get_worker_controller
        controller = get_worker_controller()
        worker_paused = bool(getattr(controller, "paused", False))
        worker_pause_reason = controller.pause_reason
    except Exception:
        worker_paused = False
        worker_pause_reason = None
    error_lower = (last_error or "").lower()
    blocked = (
        worker_paused
        and counts["PENDING"] > 0
        and (
            "captcha" in error_lower
            or "recaptcha" in error_lower
            or "unusual_activity" in error_lower
            or "no_flow_key" in error_lower
            or "stale_queue" in error_lower
            or worker_pause_reason == "STALE_QUEUE"
        )
    )
    return BatchStatus(
        total=total,
        pending=counts["PENDING"],
        processing=counts["PROCESSING"],
        orientation=orientation,
        completed=counts["COMPLETED"],
        failed=counts["FAILED"],
        done=(total > 0 and counts["PENDING"] == 0 and counts["PROCESSING"] == 0),
        all_succeeded=(counts["COMPLETED"] == total and total > 0),
        worker_paused=worker_paused,
        blocked=blocked,
        last_error=last_error,
    )


@router.get("/worker-status")
async def get_worker_status():
    """Get the current paused/active status of the worker."""
    from agent.worker.processor import get_worker_controller
    from agent.services.flow_client import get_flow_client
    controller = get_worker_controller()
    client = get_flow_client()
    pending = await crud.list_requests(status="PENDING")
    processing = await crud.list_requests(status="PROCESSING")
    return {
        "paused": getattr(controller, "_paused", False),
        "pause_reason": controller.pause_reason,
        "can_auto_resume_after_flow_key": controller.can_auto_resume_after_flow_key(),
        "active_count": controller.active_count,
        "pending_count": len(pending),
        "processing_count": len(processing),
        "queue_count": len(pending) + len(processing),
        "extension_connected": client.connected,
        "flow_key_present": client.flow_key_present,
    }


@router.post("/{rid}/cancel")
async def cancel(rid: str):
    r = await crud.get_request(rid)
    if not r:
        raise HTTPException(404, "Request not found")
    
    # 1. Update request status to FAILED
    cancel_error = _cancel_error_message(r)
    await crud.update_request(rid, status="FAILED", error_message=cancel_error)
    
    # 2. Add to cancellation registry
    from agent.utils.cancel_registry import cancel_request
    cancel_request(rid)
    
    # 3. Update the corresponding scene status to FAILED if it was PROCESSING/PENDING
    scene_id = r.get("scene_id")
    req_type = r.get("type")
    orientation = r.get("orientation") or "VERTICAL"
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
    
    if scene_id:
        updates = {}
        if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
            updates[f"{prefix}_image_status"] = "FAILED"
        elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
            updates[f"{prefix}_video_status"] = "FAILED"
        elif req_type == "UPSCALE_VIDEO":
            updates[f"{prefix}_upscale_status"] = "FAILED"
        if updates:
            await crud.update_scene(scene_id, **updates)
            
    # Notify event bus so the dashboard knows!
    from agent.services.event_bus import event_bus
    await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": cancel_error})
    
    return {"status": "success", "message": f"Request {rid} cancelled"}


@router.post("/cancel-active")
async def cancel_active(scene_id: str, type: str, orientation: Optional[str] = "VERTICAL"):
    # Find all pending/processing requests for this scene and type
    existing = await crud.list_requests(scene_id=scene_id)
    active = [r for r in existing
              if r.get("type") == type
              and r.get("status") in ("PENDING", "PROCESSING")]
              
    if not active:
        return {"status": "skipped", "message": "No active requests found"}
        
    from agent.utils.cancel_registry import cancel_request
    from agent.services.event_bus import event_bus
    
    prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
    
    for r in active:
        rid = r["id"]
        cancel_error = _cancel_error_message(r)
        # Update request status to FAILED
        await crud.update_request(rid, status="FAILED", error_message=cancel_error)
        # Add to cancel registry
        cancel_request(rid)
        # Emit update
        await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": cancel_error})
        
    # Update corresponding scene status
    updates = {}
    if type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
        updates[f"{prefix}_image_status"] = "FAILED"
    elif type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
        updates[f"{prefix}_video_status"] = "FAILED"
    elif type == "UPSCALE_VIDEO":
        updates[f"{prefix}_upscale_status"] = "FAILED"
    if updates:
        await crud.update_scene(scene_id, **updates)
        
    return {"status": "success", "message": f"Cancelled {len(active)} request(s) for scene {scene_id[:8]}"}


@router.post("/cancel-all")
async def cancel_all():
    """Cancel all active (PENDING and PROCESSING) requests globally."""
    from agent.utils.cancel_registry import cancel_request
    from agent.services.event_bus import event_bus
    from agent.worker.processor import get_worker_controller
    
    # 1. Fetch all active requests
    pending = await crud.list_requests(status="PENDING")
    processing = await crud.list_requests(status="PROCESSING")
    active = pending + processing
    
    # 2. Cancel each active request
    for r in active:
        rid = r["id"]
        cancel_error = _cancel_error_message(r)
        await crud.update_request(rid, status="FAILED", error_message=cancel_error)
        cancel_request(rid)
        await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": cancel_error})
        
        # 3. Update the corresponding scene status to FAILED
        scene_id = r.get("scene_id")
        req_type = r.get("type")
        orientation = r.get("orientation") or "VERTICAL"
        prefix = "vertical" if orientation == "VERTICAL" else "horizontal"
        
        if scene_id:
            updates = {}
            if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
                updates[f"{prefix}_image_status"] = "FAILED"
            elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
                updates[f"{prefix}_video_status"] = "FAILED"
            elif req_type == "UPSCALE_VIDEO":
                updates[f"{prefix}_upscale_status"] = "FAILED"
            if updates:
                await crud.update_scene(scene_id, **updates)

    controller = get_worker_controller()
    if controller.pause_reason in ("STALE_QUEUE", "CAPTCHA_UNUSUAL_ACTIVITY", "NO_FLOW_KEY"):
        controller.resume()

    return {"status": "success", "cancelled_count": len(active)}


@router.post("/pause")
async def pause_worker():
    """Pause the background worker loop from processing new requests."""
    from agent.worker.processor import get_worker_controller
    controller = get_worker_controller()
    controller.pause("USER")
    return {"status": "success", "paused": True, "pause_reason": controller.pause_reason}


@router.post("/resume")
async def resume_worker(force: bool = False):
    """Resume the background worker loop to process pending requests."""
    from agent.worker.processor import get_worker_controller
    from agent.services.flow_client import get_flow_client
    client = get_flow_client()
    if not client.connected:
        raise HTTPException(409, "Extension not connected — open Flow browser first")
    if not client.flow_key_present:
        raise HTTPException(409, "Flow session not ready — open/login to Google Flow first")
    controller = get_worker_controller()
    if not force:
        if controller.pause_reason == "CAPTCHA_UNUSUAL_ACTIVITY":
            raise HTTPException(
                409,
                "Worker paused after reCAPTCHA unusual activity. Cancel stale requests or resume with force.",
            )
        if controller.pause_reason == "STALE_QUEUE":
            raise HTTPException(
                409,
                "Worker is holding a queue from a previous app session. Cancel stale requests or resume with force.",
            )
        if controller.pause_reason == "NO_FLOW_KEY" and not controller.can_auto_resume_after_flow_key():
            raise HTTPException(
                409,
                "Worker is holding a stale queue from an older Flow session. Cancel stale requests or resume with force.",
            )
    controller.resume()
    return {"status": "success", "paused": False, "pause_reason": None}


@router.get("/{rid}", response_model=Request)
async def get(rid: str):
    r = await crud.get_request(rid)
    if not r:
        raise HTTPException(404, "Request not found")
    return r


@router.patch("/{rid}", response_model=Request)
async def update(rid: str, body: RequestUpdate):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No fields to update")
    r = await crud.update_request(rid, **data)
    if not r:
        raise HTTPException(404, "Request not found")
    return r
