from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from agent.models.request import Request, RequestCreate
from agent.models.enums import StatusType
from agent.db import crud

router = APIRouter(prefix="/requests", tags=["requests"])


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


@router.post("", response_model=Request)
async def create(body: RequestCreate):
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
        rows = [r for r in rows if r.get("created_at", "") >= since]
    counts = {"PENDING": 0, "PROCESSING": 0, "COMPLETED": 0, "FAILED": 0}
    for r in rows:
        s = r.get("status", "PENDING")
        counts[s] = counts.get(s, 0) + 1
    total = len(rows)
    return BatchStatus(
        total=total,
        pending=counts["PENDING"],
        processing=counts["PROCESSING"],
        orientation=orientation,
        completed=counts["COMPLETED"],
        failed=counts["FAILED"],
        done=(counts["PENDING"] == 0 and counts["PROCESSING"] == 0),
        all_succeeded=(counts["COMPLETED"] == total and total > 0),
    )


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


@router.post("/{rid}/cancel")
async def cancel(rid: str):
    r = await crud.get_request(rid)
    if not r:
        raise HTTPException(404, "Request not found")
    
    # 1. Update request status to FAILED
    await crud.update_request(rid, status="FAILED", error_message="Cancelled by user")
    
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
    await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": "Cancelled by user"})
    
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
        # Update request status to FAILED
        await crud.update_request(rid, status="FAILED", error_message="Cancelled by user")
        # Add to cancel registry
        cancel_request(rid)
        # Emit update
        await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": "Cancelled by user"})
        
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
    
    # 1. Fetch all active requests
    pending = await crud.list_requests(status="PENDING")
    processing = await crud.list_requests(status="PROCESSING")
    active = pending + processing
    
    # 2. Cancel each active request
    for r in active:
        rid = r["id"]
        await crud.update_request(rid, status="FAILED", error_message="Cancelled by user")
        cancel_request(rid)
        await event_bus.emit("request_update", {"id": rid, "status": "FAILED", "error": "Cancelled by user"})
        
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
                
    return {"status": "success", "cancelled_count": len(active)}


@router.post("/pause")
async def pause_worker():
    """Pause the background worker loop from processing new requests."""
    from agent.worker.processor import get_worker_controller
    controller = get_worker_controller()
    controller.pause()
    return {"status": "success", "paused": True}


@router.post("/resume")
async def resume_worker():
    """Resume the background worker loop to process pending requests."""
    from agent.worker.processor import get_worker_controller
    controller = get_worker_controller()
    controller.resume()
    return {"status": "success", "paused": False}


@router.get("/worker-status")
async def get_worker_status():
    """Get the current paused/active status of the worker."""
    from agent.worker.processor import get_worker_controller
    controller = get_worker_controller()
    return {
        "paused": getattr(controller, "_paused", False),
        "active_count": controller.active_count
    }

