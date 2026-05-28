from fastapi import APIRouter, HTTPException, Request
from agent.models.scene import Scene, SceneCreate, SceneUpdate
from agent.sdk.persistence.sqlite_repository import SQLiteRepository
from agent.config import OUTPUT_DIR
import json

router = APIRouter(prefix="/scenes", tags=["scenes"])

_repo = SQLiteRepository()

_OUTPUT_PREFIX = str(OUTPUT_DIR)  # e.g. /Volumes/.../output


def _localize_url(url: str | None, request: Request | None = None) -> str | None:
    """Convert a local file:// URL to an HTTP URL served by /media.

    workflow videos are saved as:
      file:///any/path/output/_workflow_videos/UUID.mp4
    served at:
      http://127.0.0.1:8100/media/_workflow_videos/UUID.mp4

    We find the /output/ marker in the path and take everything after it.
    """
    if not url:
        return url
    if url.startswith("file://"):
        local_path = url[7:]  # strip file://
        # Find /output/ marker in path to extract relative portion
        marker = "/output/"
        idx = local_path.find(marker)
        if idx != -1:
            rel = local_path[idx + len(marker):]  # e.g. _workflow_videos/UUID.mp4
            base = f"http://{request.headers.get('host', '127.0.0.1:8100')}" if request else "http://127.0.0.1:8100"
            return f"{base}/media/{rel}"
        # Fallback: try the configured OUTPUT_DIR prefix
        if local_path.startswith(_OUTPUT_PREFIX):
            rel = local_path[len(_OUTPUT_PREFIX):].lstrip("/")
            base = f"http://{request.headers.get('host', '127.0.0.1:8100')}" if request else "http://127.0.0.1:8100"
            return f"{base}/media/{rel}"
    return url


def find_local_scene_file(scene_id: str, subdir: str, display_order: int | None, ext: str) -> str | None:
    from agent.config import OUTPUT_DIR
    if not OUTPUT_DIR.exists():
        return None
    order_val = display_order if display_order is not None else 0
    for p_dir in OUTPUT_DIR.iterdir():
        if p_dir.is_dir() and not p_dir.name.startswith("_"):
            # Check canonical filename first
            canonical = p_dir / subdir / f"scene_{order_val:03d}_{scene_id}.{ext}"
            if canonical.exists():
                return f"file://{canonical.resolve()}"
            # Fallback: check matching scene_id in that subdirectory
            subdir_path = p_dir / subdir
            if subdir_path.exists():
                for f in subdir_path.glob(f"*{scene_id}*"):
                    if f.is_file():
                        return f"file://{f.resolve()}"
    return None


async def _download_missing_asset_bg(scene_id: str, key: str, subdir: str, display_order: int, ext: str, media_id: str):
    import logging
    from agent.db import crud
    from agent.config import OUTPUT_DIR
    from agent.utils.slugify import slugify
    from agent.sdk.services.result_handler import download_to_local_if_needed
    logger = logging.getLogger(__name__)

    try:
        scene = await crud.get_scene(scene_id)
        if not scene:
            return
        video = await crud.get_video(scene["video_id"])
        if not video:
            return
        project = await crud.get_project(video["project_id"])
        if not project:
            return

        project_slug = slugify(project["name"])
        dest = OUTPUT_DIR / project_slug / subdir / f"scene_{display_order:03d}_{scene_id}.{ext}"
        
        # We don't have the original GCS URL (or it's expired), but we have media_id
        local_url = await download_to_local_if_needed(None, dest, media_id=media_id)
        if local_url:
            await crud.update_scene(scene_id, **{key: local_url})
            logger.info("Successfully recovered expired scene asset on-the-fly: %s", dest)
            from agent.services.event_bus import event_bus
            await event_bus.emit("urls_refreshed", {"count": 1})
    except Exception as e:
        logger.exception("Failed to recover missing scene asset in background: %s", e)


def _transform_scene(flat: dict, request: Request | None = None) -> dict:
    """Transform file:// video and image URLs to HTTP URLs for browser playback."""
    scene_id = flat.get("id")
    display_order = flat.get("display_order")
    if display_order is None:
        display_order = 0

    for key, subdir, ext in (
        ("vertical_image_url", "scenes", "jpg"),
        ("horizontal_image_url", "scenes", "jpg"),
        ("vertical_video_url", "scenes", "mp4"),
        ("horizontal_video_url", "scenes", "mp4"),
        ("vertical_upscale_url", "4k", "mp4"),
        ("horizontal_upscale_url", "4k", "mp4"),
    ):
        url = flat.get(key)
        media_id = flat.get(f"{key[:-4]}_media_id")

        # If the URL is empty or is a cloud URL, check if we have it locally
        if scene_id and (not url or url.startswith("http")):
            local_url = find_local_scene_file(scene_id, subdir, display_order, ext)
            if local_url:
                url = local_url
            elif media_id and flat.get(f"{key[:-4]}_status") == "COMPLETED":
                # Asset is completed but no local file exists! Schedule recovery background task.
                import asyncio
                asyncio.create_task(_download_missing_asset_bg(scene_id, key, subdir, display_order, ext, media_id))

        if url:
            flat[key] = _localize_url(url, request)

    return flat



def _scene_to_flat(sdk_scene) -> dict:
    """Convert SDK Scene domain model to flat dict matching API response shape."""
    repo = SQLiteRepository()
    flat = repo._scene_to_updates(sdk_scene)
    flat["id"] = sdk_scene.id
    flat["video_id"] = sdk_scene.video_id
    flat["display_order"] = sdk_scene.display_order
    flat["parent_scene_id"] = sdk_scene.parent_scene_id
    flat["transition_prompt"] = sdk_scene.transition_prompt
    flat["chain_type"] = sdk_scene.chain_type
    flat["source"] = sdk_scene.source
    flat["character_names"] = sdk_scene.character_names
    flat["created_at"] = sdk_scene.created_at
    flat["updated_at"] = sdk_scene.updated_at
    return flat


@router.post("", response_model=Scene)
async def create(body: SceneCreate):
    # Auto-prepend material scene_prefix if project has a material set
    if body.video_id and body.prompt:
        video = await _repo.get_video(body.video_id)
        if video:
            from agent.db.crud import get_project
            project_row = await get_project(video.project_id)
            if project_row and project_row.get("material"):
                from agent.materials import get_material
                mat = get_material(project_row["material"])
                if mat and mat.get("scene_prefix"):
                    prefix = mat["scene_prefix"]
                    if not body.prompt.startswith(prefix):
                        body.prompt = f"{prefix} {body.prompt}"

    data = body.model_dump(exclude_none=True)

    # Auto-shift subsequent scenes when inserting
    if data.get("chain_type") == "INSERT" and data.get("video_id"):
        insert_order = data.get("display_order", 0)
        existing = await _repo.list_scenes(data["video_id"])
        # Shift scenes at or after insert_order in reverse to avoid collisions
        to_shift = sorted(
            [s for s in existing if s.display_order >= insert_order],
            key=lambda s: s.display_order,
            reverse=True,
        )
        for s in to_shift:
            await _repo.update("scene", s.id, display_order=s.display_order + 1)

    sdk_scene = await _repo.create_scene(**data)
    return _scene_to_flat(sdk_scene)


@router.get("", response_model=list[Scene])
async def list_by_video(video_id: str, request: Request):
    scenes = await _repo.list_scenes(video_id)
    return [_transform_scene(_scene_to_flat(s), request) for s in scenes]


@router.get("/{sid}", response_model=Scene)
async def get(sid: str, request: Request):
    sdk_scene = await _repo.get_scene(sid)
    if not sdk_scene:
        raise HTTPException(404, "Scene not found")
    return _transform_scene(_scene_to_flat(sdk_scene), request)


@router.patch("/{sid}", response_model=Scene)
async def update(sid: str, body: SceneUpdate):
    # Use exclude_unset (not exclude_none) so explicit null clears fields
    # e.g. {"vertical_video_url": null} → sets DB column to NULL
    data = body.model_dump(exclude_unset=True)
    if "character_names" in data and isinstance(data["character_names"], list):
        data["character_names"] = json.dumps(data["character_names"])
    row = await _repo.update("scene", sid, **data)
    if not row:
        raise HTTPException(404, "Scene not found")
    sdk_scene = _repo._row_to_scene(row)
    return _scene_to_flat(sdk_scene)


@router.delete("/{sid}")
async def delete(sid: str):
    if not await _repo.delete("scene", sid):
        raise HTTPException(404, "Scene not found")
    return {"ok": True}


@router.delete("")
async def cleanup(video_id: str, source: str = "system"):
    """Delete all scenes with given source and re-compact display_order."""
    if source not in ("system", "user"):
        raise HTTPException(400, "Can only cleanup 'system' or 'user' scenes")
    scenes = await _repo.list_scenes(video_id)
    to_delete = [s for s in scenes if s.source == source]
    to_keep = sorted([s for s in scenes if s.source != source], key=lambda s: s.display_order)

    # Delete matching scenes
    for s in to_delete:
        await _repo.delete("scene", s.id)

    # Re-compact display_order (0, 1, 2, ...)
    for i, s in enumerate(to_keep):
        if s.display_order != i:
            await _repo.update("scene", s.id, display_order=i)

    return {"deleted": len(to_delete), "remaining": len(to_keep)}


@router.post("/{sid}/refresh-media", response_model=Scene)
async def refresh_scene_media(sid: str, request: Request):
    """Force recover/download missing or expired media assets for a scene."""
    from agent.db import crud
    from agent.config import OUTPUT_DIR
    from agent.utils.slugify import slugify
    from agent.sdk.services.result_handler import download_to_local_if_needed

    scene = await crud.get_scene(sid)
    if not scene:
        raise HTTPException(404, "Scene not found")
    
    video = await crud.get_video(scene["video_id"])
    if not video:
        raise HTTPException(404, "Video not found")
        
    project = await crud.get_project(video["project_id"])
    if not project:
        raise HTTPException(404, "Project not found")

    project_slug = slugify(project["name"])
    display_order = scene.get("display_order") or 0
    
    recovered_count = 0
    for key, subdir, ext in (
        ("vertical_image_url", "scenes", "jpg"),
        ("horizontal_image_url", "scenes", "jpg"),
        ("vertical_video_url", "scenes", "mp4"),
        ("horizontal_video_url", "scenes", "mp4"),
        ("vertical_upscale_url", "4k", "mp4"),
        ("horizontal_upscale_url", "4k", "mp4"),
    ):
        media_id = scene.get(f"{key[:-4]}_media_id")
        status = scene.get(f"{key[:-4]}_status")
        
        if media_id and status == "COMPLETED":
            dest = OUTPUT_DIR / project_slug / subdir / f"scene_{display_order:03d}_{sid}.{ext}"
            # Force attempt download using media_id fallback
            local_url = await download_to_local_if_needed(None, dest, media_id=media_id)
            if local_url:
                await crud.update_scene(sid, **{key: local_url})
                recovered_count += 1
                
    if recovered_count > 0:
        # Fetch updated scene
        sdk_scene = await _repo.get_scene(sid)
        return _transform_scene(_scene_to_flat(sdk_scene), request)
        
    return _transform_scene(scene, request)

