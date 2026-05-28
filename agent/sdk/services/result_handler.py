"""Shared result parsing + DB update helpers for SDK direct execution and background processor."""

from __future__ import annotations
from typing import TYPE_CHECKING
from pathlib import Path

from agent.db import crud
from agent.worker._parsing import _is_error, _extract_media_id, _extract_output_url

if TYPE_CHECKING:
    from agent.sdk.models.media import GenerationResult


def parse_result(raw: dict, req_type: str) -> GenerationResult:
    """Parse a raw FlowClient/OperationService response into a GenerationResult."""
    from agent.sdk.models.media import GenerationResult

    if _is_error(raw):
        error_msg = raw.get("error")
        if not error_msg:
            data = raw.get("data", {})
            if isinstance(data, dict):
                ef = data.get("error", "Unknown error")
                error_msg = ef.get("message", str(ef)[:200]) if isinstance(ef, dict) else str(ef)
            else:
                error_msg = "Unknown error"
        return GenerationResult(success=False, error=str(error_msg), raw=raw)

    media_id = _extract_media_id(raw, req_type)
    url = _extract_output_url(raw, req_type)
    return GenerationResult(success=True, media_id=media_id, url=url, raw=raw)


async def download_to_local_if_needed(url: str | None, dest_path: Path, media_id: str | None = None) -> str | None:
    """Download a HTTP/HTTPS url to local path, and return a file:// URL.
    If the url is already local or empty, return it as-is.
    """
    # If the file already exists, return it
    if dest_path.exists() and dest_path.stat().st_size > 1024:
        return f"file://{dest_path.resolve()}"

    # If url is already local, return it
    if url and (url.startswith("file://") or url.startswith("/")):
        return url

    # Ensure parent dir exists
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    import logging
    import httpx
    from agent.services.headers import random_headers
    logger = logging.getLogger(__name__)

    async def _try_download_direct(target_url: str) -> bool:
        """Attempt downloading target_url directly using httpx with emulated browser headers."""
        try:
            logger.info("Attempting direct httpx download of: %s", target_url[:80])
            headers = random_headers()
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                resp = await client.get(target_url, headers=headers)
                resp.raise_for_status()
                dest_path.write_bytes(resp.content)
                logger.info("Successfully downloaded direct: %s -> %s", target_url[:80], dest_path)
                return True
        except Exception as direct_ex:
            logger.warning("Direct httpx download failed for %s: %s", target_url[:80], direct_ex)
            return False

    async def _try_download_proxy(target_url: str) -> bool:
        """Attempt downloading target_url proxying through the connected extension (uses browser credentials)."""
        try:
            from agent.services.flow_client import get_flow_client
            flow_c = get_flow_client()
            if flow_c.connected:
                logger.info("Attempting extension proxy download of: %s", target_url[:80])
                ext_res = await flow_c.download_asset(target_url)
                if not ext_res.get("error"):
                    b64_content = ext_res.get("data", {}).get("base64")
                    if b64_content:
                        import base64
                        dest_path.write_bytes(base64.b64decode(b64_content))
                        logger.info("Successfully downloaded via extension proxy: %s", dest_path)
                        return True
                    else:
                        logger.warning("No base64 content in proxy download response for %s", target_url[:80])
                else:
                    logger.warning("Proxy download API returned error: %s", ext_res.get("error"))
            else:
                logger.warning("Extension not connected, cannot proxy download %s", target_url[:80])
        except Exception as proxy_ex:
            logger.warning("Proxy download failed for %s: %s", target_url[:80], proxy_ex)
        return False

    # 1. Try direct download if url is provided
    if url:
        if await _try_download_direct(url):
            return f"file://{dest_path.resolve()}"
        # 2. Try extension proxy download fallback
        if await _try_download_proxy(url):
            return f"file://{dest_path.resolve()}"

    # 3. Fallback to get_media + retry download strategies
    if media_id:
        try:
            from agent.services.flow_client import get_flow_client
            flow_c = get_flow_client()
            if flow_c.connected:
                logger.info("Fetching media via get_media: media_id=%s -> %s", media_id, dest_path)
                result = await flow_c.get_media(media_id)
                if not result.get("error"):
                    data = result.get("data", result)
                    encoded = None
                    fresh_url = None
                    if isinstance(data, dict):
                        # Extract fresh signed URL if present
                        fresh_url = (
                            data.get("fifeUrl") or 
                            data.get("servingUri") or 
                            data.get("videoUri") or 
                            data.get("imageUri")
                        )
                        # Also check nested objects
                        if not fresh_url:
                            if "video" in data and isinstance(data["video"], dict):
                                fresh_url = data["video"].get("fifeUrl") or data["video"].get("servingUri") or data["video"].get("videoUri")
                            elif "image" in data and isinstance(data["image"], dict):
                                fresh_url = data["image"].get("fifeUrl") or data["image"].get("servingUri") or data["image"].get("imageUri")

                        # Extract base64 encoded if present
                        if "video" in data and isinstance(data["video"], dict):
                            encoded = data["video"].get("encodedVideo")
                        elif "image" in data and isinstance(data["image"], dict):
                            encoded = data["image"].get("encodedImage")
                        elif "encodedVideo" in data:
                            encoded = data["encodedVideo"]
                        elif "encodedImage" in data:
                            encoded = data["encodedImage"]

                    if encoded:
                        import base64
                        content_bytes = base64.standard_b64decode(encoded)
                        dest_path.write_bytes(content_bytes)
                        logger.info("Successfully downloaded and saved via get_media base64: %s", dest_path)
                        return f"file://{dest_path.resolve()}"
                    elif fresh_url:
                        # Try direct download with random browser headers
                        if await _try_download_direct(fresh_url):
                            return f"file://{dest_path.resolve()}"
                        # Try proxy download via extension as robust fallback
                        if await _try_download_proxy(fresh_url):
                            return f"file://{dest_path.resolve()}"
                    else:
                        logger.warning("No encoded content or fresh URL in get_media response for %s", media_id)
                else:
                    logger.warning("get_media API returned error for %s: %s", media_id, result.get("error"))
            else:
                logger.warning("Extension not connected, cannot fetch media %s via get_media", media_id)
        except Exception as fallback_ex:
            logger.exception("get_media fallback failed: %s", fallback_ex)

    return url


async def apply_scene_result(
    scene_id: str | None,
    req_type: str,
    orientation: str,
    result: GenerationResult,
) -> None:
    """Update scene DB fields after a successful generation.

    Handles cascade: image regen clears video+upscale, video regen clears upscale.
    This is the shared version of processor.py's _update_scene_from_result.
    """
    if not scene_id or not result.success:
        return

    import logging
    logger = logging.getLogger(__name__)

    # Check and download to local storage if it's a cloud URL
    if result.url and not result.url.startswith("file://") and not result.url.startswith("/"):
        try:
            scene = await crud.get_scene(scene_id)
            if scene:
                video = await crud.get_video(scene["video_id"])
                if video:
                    project = await crud.get_project(video["project_id"])
                    if project:
                        from agent.utils.slugify import slugify
                        from agent.config import OUTPUT_DIR
                        project_slug = slugify(project["name"])
                        display_order = scene.get("display_order")
                        if display_order is None:
                            display_order = 0

                        if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
                            dest = OUTPUT_DIR / project_slug / "scenes" / f"scene_{display_order:03d}_{scene_id}.jpg"
                            local_url = await download_to_local_if_needed(result.url, dest, media_id=result.media_id)
                            result.url = local_url
                        elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
                            dest = OUTPUT_DIR / project_slug / "scenes" / f"scene_{display_order:03d}_{scene_id}.mp4"
                            local_url = await download_to_local_if_needed(result.url, dest, media_id=result.media_id)
                            result.url = local_url
                        elif req_type == "UPSCALE_VIDEO":
                            dest = OUTPUT_DIR / project_slug / "4k" / f"scene_{display_order:03d}_{scene_id}.mp4"
                            local_url = await download_to_local_if_needed(result.url, dest, media_id=result.media_id)
                            result.url = local_url
        except Exception as ex:
            logger.exception("Failed to resolve paths or download scene media: %s", ex)

    p = "vertical" if orientation == "VERTICAL" else "horizontal"
    updates = {}

    if req_type in ("GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE"):
        updates.update({
            f"{p}_image_media_id": result.media_id,
            f"{p}_image_url": result.url,
            f"{p}_image_status": "COMPLETED",
            # Cascade: clear downstream
            f"{p}_video_media_id": None, f"{p}_video_url": None, f"{p}_video_status": "PENDING",
            f"{p}_upscale_media_id": None, f"{p}_upscale_url": None, f"{p}_upscale_status": "PENDING",
        })
        # Chain cascade: update parent's end_scene_media_id so its video
        # transitions to this child's new image
        scene = await crud.get_scene(scene_id)
        if scene and scene.get("parent_scene_id") and result.media_id:
            await crud.update_scene(
                scene["parent_scene_id"],
                **{f"{p}_end_scene_media_id": result.media_id},
            )
    elif req_type in ("GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS"):
        updates.update({
            f"{p}_video_media_id": result.media_id,
            f"{p}_video_url": result.url,
            f"{p}_video_status": "COMPLETED",
            # Cascade: clear upscale
            f"{p}_upscale_media_id": None, f"{p}_upscale_url": None, f"{p}_upscale_status": "PENDING",
        })
    elif req_type == "UPSCALE_VIDEO":
        updates.update({
            f"{p}_upscale_media_id": result.media_id,
            f"{p}_upscale_url": result.url,
            f"{p}_upscale_status": "COMPLETED",
        })

    if updates:
        await crud.update_scene(scene_id, **updates)


async def apply_character_result(
    character_id: str,
    result: GenerationResult,
) -> None:
    """Update character DB fields after a successful reference image generation."""
    if not result.success:
        return

    import logging
    logger = logging.getLogger(__name__)

    if result.url and not result.url.startswith("file://") and not result.url.startswith("/"):
        try:
            character = await crud.get_character(character_id)
            if character:
                from agent.utils.slugify import slugify
                from agent.config import OUTPUT_DIR
                char_slug = slugify(character["name"])
                dest = OUTPUT_DIR / "_shared" / "characters" / f"{char_slug}_{character_id}.jpg"
                local_url = await download_to_local_if_needed(result.url, dest, media_id=result.media_id)
                result.url = local_url
        except Exception as ex:
            logger.exception("Failed to resolve paths or download character reference image: %s", ex)

    updates = {}
    if result.media_id:
        updates["media_id"] = result.media_id
    if result.url:
        updates["reference_image_url"] = result.url
    if updates:
        await crud.update_character(character_id, **updates)
