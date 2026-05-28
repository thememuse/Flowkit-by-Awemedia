"""Skills API — CRUD cho skills (file .md trong skills/ folder).

Cho phép UI:
- Liệt kê tất cả skills (built-in + custom)
- Đọc nội dung skill
- Tạo custom skill mới
- Sửa custom skill
- Xóa custom skill (không thể xóa built-in)
"""
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])

# Thư mục chứa built-in skills (thư mục gốc dự án)
_SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
# Custom skills user-defined
_CUSTOM_SKILLS_DIR = Path.home() / "Library" / "Application Support" / "flowkit" / "custom_skills"

# Windows fallback
if os.name == "nt":
    _appdata = Path(os.environ.get("APPDATA", Path.home()))
    _CUSTOM_SKILLS_DIR = _appdata / "flowkit" / "custom_skills"

_CUSTOM_SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _skill_id(path: Path) -> str:
    return path.stem  # "fk-gen-images" from "fk-gen-images.md"


def _read_frontmatter(content: str) -> dict:
    """Extract simple key: value pairs from first H1 or description line."""
    lines = content.strip().splitlines()
    name = ""
    description = ""
    for line in lines[:5]:
        if line.startswith("# "):
            name = line[2:].strip()
        elif not description and line and not line.startswith("#"):
            description = line.strip()
    return {"name": name or description[:60], "description": description}


def _list_dir(path: Path) -> list[dict]:
    results = []
    if not path.exists():
        return results
    for f in sorted(path.glob("fk-*.md")):
        content = f.read_text("utf-8", errors="replace")
        meta = _read_frontmatter(content)
        results.append({
            "id": _skill_id(f),
            "name": meta["name"] or _skill_id(f),
            "description": meta["description"],
            "is_builtin": path == _SKILLS_DIR,
            "path": str(f),
            "size": f.stat().st_size,
        })
    return results


class SkillCreate(BaseModel):
    id: str                   # e.g. "fk-my-skill"
    name: str
    description: str = ""
    content: str              # Markdown content


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None


# ── Endpoints ──────────────────────────────────────────────

@router.get("")
async def list_skills():
    """Liệt kê tất cả skills: built-in + custom."""
    builtin = _list_dir(_SKILLS_DIR)
    custom = _list_dir(_CUSTOM_SKILLS_DIR)
    # Mark builtin
    for s in builtin:
        s["is_builtin"] = True
    for s in custom:
        s["is_builtin"] = False
    return builtin + custom


@router.get("/{skill_id}")
async def get_skill(skill_id: str):
    """Lấy nội dung markdown của một skill."""
    # Check built-in first
    for base in [_SKILLS_DIR, _CUSTOM_SKILLS_DIR]:
        path = base / f"{skill_id}.md"
        if path.exists():
            content = path.read_text("utf-8", errors="replace")
            meta = _read_frontmatter(content)
            return {
                "id": skill_id,
                "name": meta["name"],
                "description": meta["description"],
                "content": content,
                "is_builtin": base == _SKILLS_DIR,
                "path": str(path),
            }
    raise HTTPException(404, f"Skill '{skill_id}' not found")


@router.post("", status_code=201)
async def create_skill(body: SkillCreate):
    """Tạo custom skill mới."""
    # Validate id
    if not re.match(r"^fk-[a-z0-9\-]+$", body.id):
        raise HTTPException(400, "Skill ID phải có dạng 'fk-<name>' với chữ thường và dấu gạch ngang")
    if (_SKILLS_DIR / f"{body.id}.md").exists():
        raise HTTPException(409, f"Skill '{body.id}' đã tồn tại dưới dạng built-in")
    path = _CUSTOM_SKILLS_DIR / f"{body.id}.md"
    if path.exists():
        raise HTTPException(409, f"Custom skill '{body.id}' đã tồn tại")

    content = body.content or f"# {body.name}\n\n{body.description}\n"
    path.write_text(content, "utf-8")
    logger.info("Custom skill created: %s", body.id)
    return {"id": body.id, "name": body.name, "is_builtin": False, "path": str(path)}


@router.patch("/{skill_id}")
async def update_skill(skill_id: str, body: SkillUpdate):
    """Sửa custom skill (không thể sửa built-in)."""
    if (_SKILLS_DIR / f"{skill_id}.md").exists():
        raise HTTPException(400, f"Không thể sửa built-in skill '{skill_id}'")
    path = _CUSTOM_SKILLS_DIR / f"{skill_id}.md"
    if not path.exists():
        raise HTTPException(404, f"Custom skill '{skill_id}' không tìm thấy")

    if body.content is not None:
        path.write_text(body.content, "utf-8")
    logger.info("Custom skill updated: %s", skill_id)
    return {"id": skill_id, "ok": True}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    """Xóa custom skill (không thể xóa built-in)."""
    if (_SKILLS_DIR / f"{skill_id}.md").exists():
        raise HTTPException(400, f"Không thể xóa built-in skill '{skill_id}'")
    path = _CUSTOM_SKILLS_DIR / f"{skill_id}.md"
    if not path.exists():
        raise HTTPException(404, f"Custom skill '{skill_id}' không tìm thấy")
    path.unlink()
    logger.info("Custom skill deleted: %s", skill_id)
    return {"ok": True}
