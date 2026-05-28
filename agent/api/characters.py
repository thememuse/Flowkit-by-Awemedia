from fastapi import APIRouter, HTTPException, Request
from agent.models.character import Character, CharacterCreate, CharacterUpdate
from agent.sdk.persistence.sqlite_repository import SQLiteRepository
from agent.utils.slugify import slugify

router = APIRouter(prefix="/characters", tags=["characters"])


def _get_repo() -> SQLiteRepository:
    return SQLiteRepository()


def find_local_character_file(character_id: str) -> str | None:
    from agent.config import OUTPUT_DIR
    char_dir = OUTPUT_DIR / "_shared" / "characters"
    if char_dir.exists():
        for f in char_dir.glob(f"*{character_id}*.jpg"):
            if f.is_file():
                return f"file://{f.resolve()}"
    return None


@router.post("", response_model=Character)
async def create(body: CharacterCreate):
    repo = _get_repo()
    return await repo.create_character(**body.model_dump(exclude_none=True))


@router.get("", response_model=list[Character])
async def list_all(request: Request):
    repo = _get_repo()
    rows = await repo.list("character", order_by="created_at DESC")
    chars = [repo._row_to_character(r) for r in rows]
    for c in chars:
        url = c.reference_image_url
        if not url or url.startswith("http"):
            local_url = find_local_character_file(c.id)
            if local_url:
                url = local_url
        if url:
            from agent.api.scenes import _localize_url
            c.reference_image_url = _localize_url(url, request)
    return chars


@router.get("/{cid}", response_model=Character)
async def get(cid: str, request: Request):
    repo = _get_repo()
    c = await repo.get_character(cid)
    if not c:
        raise HTTPException(404, "Character not found")
    url = c.reference_image_url
    if not url or url.startswith("http"):
        local_url = find_local_character_file(c.id)
        if local_url:
            url = local_url
    if url:
        from agent.api.scenes import _localize_url
        c.reference_image_url = _localize_url(url, request)
    return c


@router.patch("/{cid}", response_model=Character)
async def update(cid: str, body: CharacterUpdate, request: Request):
    repo = _get_repo()
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates:
        updates["slug"] = slugify(updates["name"])
    row = await repo.update("character", cid, **updates)
    if not row:
        raise HTTPException(404, "Character not found")
    c = repo._row_to_character(row)
    url = c.reference_image_url
    if not url or url.startswith("http"):
        local_url = find_local_character_file(c.id)
        if local_url:
            url = local_url
    if url:
        from agent.api.scenes import _localize_url
        c.reference_image_url = _localize_url(url, request)
    return c


@router.delete("/{cid}")
async def delete(cid: str):
    repo = _get_repo()
    if not await repo.delete_character(cid):
        raise HTTPException(404, "Character not found")
    return {"ok": True}
