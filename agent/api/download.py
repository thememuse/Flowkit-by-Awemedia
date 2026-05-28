"""Download API — Save media files to configured download location.

POST /api/download/save
  body: { url, filename, project_name, scene_name, type }
  Saves file to: downloadLocation/project_name/filename

POST /api/download/save-batch
  body: { items: [{url, filename, ...}], project_name }
  Saves multiple files.
"""
import logging
import os
import re
import httpx
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from agent.api.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/download", tags=["download"])


class SaveRequest(BaseModel):
    url: str
    filename: str
    project_name: str
    scene_name: Optional[str] = None


class SaveBatchRequest(BaseModel):
    items: list[SaveRequest]
    project_name: str


def _slugify(name: str) -> str:
    """Convert name to safe folder/file name."""
    name = name.strip().lower()
    name = re.sub(r'[^\w\s-]', '', name)
    name = re.sub(r'[-\s]+', '-', name)
    return name[:60]


def _get_download_dir(project_name: str) -> Path:
    settings = get_settings()
    base = settings.get("downloadLocation", "").strip()

    if not base:
        # Default: ~/Downloads/flowkit
        base = str(Path.home() / "Downloads" / "flowkit")

    project_slug = _slugify(project_name)
    target = Path(base) / project_slug
    target.mkdir(parents=True, exist_ok=True)
    return target


async def _fetch_and_save(url: str, dest: Path) -> dict:
    """Fetch URL and save to dest. Handles both http:// and file:// URLs."""
    if url.startswith("file://"):
        local_path = Path(url[7:])
        if not local_path.exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")
        import shutil
        shutil.copy2(str(local_path), str(dest))
        return {"size": dest.stat().st_size}

    # HTTP URL
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return {"size": len(resp.content)}


@router.post("/save")
async def save_file(body: SaveRequest):
    """Save a single media file to downloadLocation/project_name/filename."""
    try:
        target_dir = _get_download_dir(body.project_name)
        dest = target_dir / body.filename

        # Avoid overwriting: add suffix if exists
        if dest.exists():
            stem = dest.stem
            suffix = dest.suffix
            i = 1
            while dest.exists():
                dest = target_dir / f"{stem}_{i}{suffix}"
                i += 1

        info = await _fetch_and_save(body.url, dest)
        logger.info("Saved file: %s (%d bytes)", dest, info["size"])
        return {"ok": True, "path": str(dest), "size": info["size"]}

    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Download save error: %s", e)
        raise HTTPException(500, f"Save failed: {e}")


@router.post("/save-batch")
async def save_batch(body: SaveBatchRequest):
    """Save multiple files to downloadLocation/project_name/."""
    results = []
    errors = []

    for item in body.items:
        try:
            target_dir = _get_download_dir(item.project_name)
            dest = target_dir / item.filename

            if dest.exists():
                stem = dest.stem
                suffix = dest.suffix
                i = 1
                while dest.exists():
                    dest = target_dir / f"{stem}_{i}{suffix}"
                    i += 1

            info = await _fetch_and_save(item.url, dest)
            results.append({"filename": item.filename, "path": str(dest), "size": info["size"]})
        except Exception as e:
            errors.append({"filename": item.filename, "error": str(e)})

    return {
        "ok": len(errors) == 0,
        "saved": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }


@router.get("/location")
async def get_location():
    """Return the effective download location."""
    settings = get_settings()
    base = settings.get("downloadLocation", "").strip()
    if not base:
        base = str(Path.home() / "Downloads" / "flowkit")
    return {"path": base, "exists": Path(base).exists()}
