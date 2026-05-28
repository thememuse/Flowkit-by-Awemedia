"""AI Script Generation API — hỗ trợ đa provider với key rotation.

Endpoints:
  POST /api/ai/generate-script   — Tạo kịch bản + scenes từ story/topic
  POST /api/ai/generate-episode  — Tạo tập mới cho project đã có
"""
import json
import logging
import time
from typing import Optional

import aiohttp
import certifi
import ssl

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent.config import ANTHROPIC_API_KEY, REVIEW_MODEL
from agent.api.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

# ── API URLs ──────────────────────────────────────────────
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_OPENAI_URL    = "https://api.openai.com/v1/chat/completions"
_GEMINI_URL    = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


# ── Key Rotator ───────────────────────────────────────────

class KeyRotator:
    """Round-robin key rotation với tracking thời gian bị rate-limit.

    - Lưu index hiện tại per provider
    - Khi một key bị 429 → đánh dấu cooldown 60s rồi thử key tiếp
    - Nếu tất cả keys bị limit → raise lỗi rõ ràng
    """

    def __init__(self) -> None:
        self._index: dict[str, int] = {}          # provider → current index
        self._cooldown: dict[str, dict[str, float]] = {}  # provider → {key: until_ts}

    def _get_keys(self, provider: str) -> list[str]:
        """Lấy danh sách keys cho provider từ settings."""
        s = get_settings()
        if provider == "claude":
            keys = s.get("anthropicApiKeys", [])
            if not keys:
                single = s.get("anthropicApiKey", "") or ANTHROPIC_API_KEY or ""
                keys = [single] if single else []
        elif provider == "openai":
            keys = s.get("openaiApiKeys", [])
            if not keys:
                single = s.get("openaiApiKey", "")
                keys = [single] if single else []
        elif provider == "gemini":
            keys = s.get("geminiApiKeys", [])
            if not keys:
                single = s.get("geminiApiKey", "")
                keys = [single] if single else []
        else:
            keys = []
        return [k for k in keys if k and k.strip()]

    def get_next_key(self, provider: str) -> str:
        """Lấy key tiếp theo, bỏ qua keys đang trong cooldown."""
        keys = self._get_keys(provider)
        if not keys:
            provider_names = {"claude": "Anthropic", "openai": "OpenAI", "gemini": "Gemini"}
            raise HTTPException(
                400,
                f"Chưa có {provider_names.get(provider, provider)} API Key. "
                "Vào Cài đặt → API Keys để thêm."
            )

        now = time.time()
        cooldowns = self._cooldown.get(provider, {})
        # Xoá cooldown đã hết hạn
        active_cds = {k: v for k, v in cooldowns.items() if v > now}
        self._cooldown[provider] = active_cds

        # Tìm key không bị cooldown
        n = len(keys)
        start = self._index.get(provider, 0) % n
        for i in range(n):
            idx = (start + i) % n
            key = keys[idx]
            if key not in active_cds:
                self._index[provider] = (idx + 1) % n
                return key

        # Tất cả keys đang cooldown — tính thời gian còn lại
        min_wait = min(active_cds.values()) - now
        raise HTTPException(
            429,
            f"Tất cả {len(keys)} key {provider} đang bị rate-limit. "
            f"Thử lại sau {int(min_wait) + 1} giây hoặc thêm key mới."
        )

    def mark_rate_limited(self, provider: str, key: str, cooldown_secs: int = 60) -> None:
        """Đánh dấu key bị rate-limit, cooldown N giây."""
        if provider not in self._cooldown:
            self._cooldown[provider] = {}
        self._cooldown[provider][key] = time.time() + cooldown_secs
        logger.warning("Key rate-limited: provider=%s key=***%s cooldown=%ds",
                       provider, key[-6:], cooldown_secs)

    def get_status(self) -> dict:
        """Trả về trạng thái rotation để hiển thị trên UI."""
        now = time.time()
        result = {}
        for provider in ["claude", "openai", "gemini"]:
            keys = self._get_keys(provider)
            cooldowns = self._cooldown.get(provider, {})
            result[provider] = {
                "total": len(keys),
                "available": sum(1 for k in keys if cooldowns.get(k, 0) <= now),
                "rate_limited": sum(1 for k in keys if cooldowns.get(k, 0) > now),
            }
        return result


# Singleton rotator — dùng chung toàn app
_rotator = KeyRotator()


@router.get("/key-status")
async def get_key_status():
    """Trả về trạng thái keys (số lượng, available, rate-limited)."""
    return _rotator.get_status()


# ── Provider callers với rotation ─────────────────────────

def _make_ssl_connector():
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    return aiohttp.TCPConnector(ssl=ssl_ctx)


async def _call_claude(system: str, user: str, max_tokens: int = 4096) -> str:
    """Gọi Claude với key rotation."""
    s = get_settings()
    model = s.get("claudeModel", REVIEW_MODEL or "claude-haiku-4-5-20251001")

    last_err = None
    keys = _rotator._get_keys("claude")
    attempts = max(1, len(keys))

    for _ in range(attempts):
        api_key = _rotator.get_next_key("claude")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        async with aiohttp.ClientSession(connector=_make_ssl_connector()) as session:
            async with session.post(_ANTHROPIC_URL, headers=headers, json=payload,
                                    timeout=aiohttp.ClientTimeout(total=120)) as resp:
                body = await resp.json()
                if resp.status == 429:
                    retry_after = int(resp.headers.get("retry-after", 60))
                    _rotator.mark_rate_limited("claude", api_key, retry_after)
                    last_err = body.get("error", {}).get("message", "Rate limited")
                    continue
                if resp.status != 200:
                    err = body.get("error", {}).get("message", str(body))
                    raise HTTPException(502, f"Claude API error: {err}")
                return body["content"][0]["text"]

    raise HTTPException(429, f"Tất cả Claude keys bị rate-limit: {last_err}")


async def _call_openai(system: str, user: str, max_tokens: int = 4096) -> str:
    """Gọi OpenAI với key rotation."""
    s = get_settings()
    model = s.get("openaiModel", "gpt-4o-mini")

    last_err = None
    keys = _rotator._get_keys("openai")
    attempts = max(1, len(keys))

    for _ in range(attempts):
        api_key = _rotator.get_next_key("openai")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        }
        async with aiohttp.ClientSession(connector=_make_ssl_connector()) as session:
            async with session.post(_OPENAI_URL, headers=headers, json=payload,
                                    timeout=aiohttp.ClientTimeout(total=120)) as resp:
                body = await resp.json()
                if resp.status == 429:
                    retry_after = int(resp.headers.get("retry-after", 60))
                    _rotator.mark_rate_limited("openai", api_key, retry_after)
                    last_err = body.get("error", {}).get("message", "Rate limited")
                    continue
                if resp.status != 200:
                    err = body.get("error", {}).get("message", str(body))
                    raise HTTPException(502, f"OpenAI API error: {err}")
                return body["choices"][0]["message"]["content"]

    raise HTTPException(429, f"Tất cả OpenAI keys bị rate-limit: {last_err}")


async def _call_gemini(system: str, user: str, max_tokens: int = 4096) -> str:
    """Gọi Gemini với key rotation."""
    s = get_settings()
    model = s.get("geminiModel", "gemini-2.0-flash")

    last_err = None
    keys = _rotator._get_keys("gemini")
    attempts = max(1, len(keys))

    for _ in range(attempts):
        api_key = _rotator.get_next_key("gemini")
        url = _GEMINI_URL.format(model=model) + f"?key={api_key}"
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": user}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": 0.7,
            },
        }
        async with aiohttp.ClientSession(connector=_make_ssl_connector()) as session:
            async with session.post(url, json=payload,
                                    timeout=aiohttp.ClientTimeout(total=120)) as resp:
                body = await resp.json()
                if resp.status == 429:
                    retry_after = int(resp.headers.get("retry-after", 60))
                    _rotator.mark_rate_limited("gemini", api_key, retry_after)
                    last_err = body.get("error", {}).get("message", "Rate limited")
                    continue
                if resp.status != 200:
                    err = body.get("error", {}).get("message", str(body))
                    raise HTTPException(502, f"Gemini API error: {err}")
                try:
                    return body["candidates"][0]["content"]["parts"][0]["text"]
                except (KeyError, IndexError) as e:
                    raise HTTPException(502, f"Gemini trả về định dạng không hợp lệ: {e}")

    raise HTTPException(429, f"Tất cả Gemini keys bị rate-limit: {last_err}")


async def _call_ai(task: str, system: str, user: str, max_tokens: int = 4096,
                   provider_override: Optional[str] = None) -> str:
    """Dispatcher: chọn provider theo override hoặc settings của task."""
    if provider_override and provider_override in ("claude", "openai", "gemini"):
        provider = provider_override
    else:
        s = get_settings()
        key = f"model{task[0].upper()}{task[1:]}"
        provider = s.get(key, "claude")
    logger.info("AI call: task=%s provider=%s override=%s", task, provider, provider_override)

    if provider == "openai":
        return await _call_openai(system, user, max_tokens)
    elif provider == "gemini":
        return await _call_gemini(system, user, max_tokens)
    else:
        return await _call_claude(system, user, max_tokens)


def _parse_json_response(raw: str, provider: str = "AI") -> dict:
    """Parse JSON từ response — xử lý markdown code blocks."""
    clean = raw.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        end = next((i for i, l in enumerate(lines[1:], 1) if l.strip() == "```"), len(lines))
        clean = "\n".join(lines[1:end])
    start = clean.find("{")
    end_bracket = clean.rfind("}")
    if start != -1 and end_bracket != -1:
        clean = clean[start:end_bracket + 1]
    try:
        return json.loads(clean)
    except json.JSONDecodeError as e:
        logger.error("%s returned invalid JSON: %s\nRaw: %s", provider, e, raw[:500])
        raise HTTPException(502, f"{provider} trả về JSON không hợp lệ: {e}")


# ── Pydantic models ────────────────────────────────────────

class GenerateScriptRequest(BaseModel):
    name: str
    story: str
    topic: Optional[str] = None
    language: str = "vi"
    material: str = "realistic"
    orientation: str = "VERTICAL"
    scene_count: int = 10
    characters: Optional[list[dict]] = None
    style_notes: Optional[str] = None
    provider: Optional[str] = None  # override provider: "claude" | "openai" | "gemini"


class GeneratedScene(BaseModel):
    display_order: int
    prompt: str
    video_prompt: str
    narrator_text: str
    character_names: list[str] = []


class GenerateScriptResponse(BaseModel):
    title: str
    description: str
    scenes: list[GeneratedScene]
    suggested_characters: list[dict] = []
    production_notes: str = ""


class GenerateEpisodeRequest(BaseModel):
    project_id: str
    project_name: str
    project_story: str
    project_material: str
    characters: list[dict]
    episode_number: int
    episode_title: str
    episode_brief: str
    scene_count: int = 10
    orientation: str = "VERTICAL"
    language: str = "vi"
    style_notes: Optional[str] = None
    previous_episodes: Optional[list[dict]] = None
    provider: Optional[str] = None  # override provider: "claude" | "openai" | "gemini"


class GenerateEpisodeResponse(BaseModel):
    title: str
    description: str
    scenes: list[GeneratedScene]
    continuity_notes: str = ""


# ── Helpers ────────────────────────────────────────────────

MATERIAL_STYLE_HINTS = {
    "realistic": "Photorealistic documentary style.",
    "3d_pixar": "3D animated Pixar style with vibrant colors.",
    "anime": "Japanese anime style, cel-shaded art.",
    "ghibli": "Studio Ghibli style. Soft watercolor tones.",
    "stop_motion": "Felt and wood stop-motion. Tactile textures.",
    "oil_painting": "Classic oil painting. Rich textures, chiaroscuro.",
    "comic_book": "Comic book illustration. Bold outlines, halftone.",
    "cyberpunk": "Cyberpunk neon-noir. Rain-slicked streets, holograms.",
}

ORIENTATION_HINTS = {
    "VERTICAL": "9:16 vertical for mobile/Shorts. Centered subjects, close-up shots preferred.",
    "HORIZONTAL": "16:9 wide for YouTube. Panoramic scenes are great.",
}


def _material_hint(material: str) -> str:
    return MATERIAL_STYLE_HINTS.get(material, f"{material} visual style.")


def _char_summary(characters: list[dict]) -> str:
    if not characters:
        return "No characters defined yet."
    return "\n".join(
        f"- {c.get('name','?')} ({c.get('entity_type','character')}): {c.get('description','')[:100]}"
        for c in characters
    )


# ── Endpoint 1: Generate Script ────────────────────────────

@router.post("/generate-script", response_model=GenerateScriptResponse)
async def generate_script(body: GenerateScriptRequest):
    material_hint = _material_hint(body.material)
    orientation_hint = ORIENTATION_HINTS.get(body.orientation, "")
    char_block = _char_summary(body.characters or [])

    system = f"""Bạn là nhà biên kịch chuyên nghiệp và đạo diễn AI video.
Nhiệm vụ: Tạo kịch bản video {body.scene_count} cảnh bằng ngôn ngữ {body.language}.

PHONG CÁCH: {material_hint}
ĐỊNH DẠNG: {orientation_hint}

QUY TẮc QUAN TRỌNG (ĐỌC KỸ TRƯỚC KHI VIẾT):

▶ QUY TẮc SỐ 1 — ĐỒNG NHẤT BỐI CẢNH (CRITICAL):
  Trước khi viết bất kỳ cảnh nào, phải xác định rõ FRAME THI GIẬ: năm, thập kỷ, địa điểm. VD: "1941, đảo Oahu, Hawaii."
  Tất cả nhân vật, quân đội, vũ khí, phương tiện, trang phục, công trình kiến trúc trong MỌI cảnh ĐỀU phải thuộc đúng FRAME THI GIẬ này.
  
  SAI: Các bên khác nhau trong cùng cảnh mặc trang phục khác thời kỳ.
  ĐÚNG: Quân Đồng Minh Phe A và Quân Phát xít Phe B đều mặc đúng đồng phục năm 1941.
  
  Mỗi cảnh phải mô tả cụ thể trang phục/thiết bị/vũ khí của TẤT CẢ nhóm/phái/quốc gia xuất hiện trong cảnh.

▶ QUY TẮc SỐ 2 — Mô TẢ PROMPT Ảnh:
  Chỉ mô tả NỘI DUNG hình ảnh: nhân vật đang làm gì, môi trường, ánh sáng, màu sắc.
  TỤYỆT ĐỐI KHÔNG ghi thông số kỹ thuật máy ảnh: không "85mm", không "f/1.4", không "ARRI", không "bokeh", không "shot on".
  Ví dụ đúng: "Japanese Zero fighters swoop low over Battleship Row at dawn, anti-aircraft tracers lighting the smoke-filled sky."
  Ví dụ SAI: "Dramatic 35mm shot, wide angle lens, bokeh background, RAW footage."

▶ QUY TẮc SỐ 3 — VIDEO PROMPT:
  "0-3s: [hành động]. 3-6s: [hành động]. 6-8s: [hành động]. Negative: subtitles, watermark, text overlay."

▶ QUY TẮc SỐ 4: `narrator_text` 2-3 câu súc tích bằng {body.language}.
▶ QUY TẮc SỐ 5: `character_names` — tên CHÍNH XÁC như đã định nghĩa.

Trả về JSON hợp lệ, KHÔNG thêm text ngoài JSON."""

    user = f"""Dự án: **{body.name}**

Câu chuyện:
{body.story}

Nhân vật:
{char_block}

{f"Ghi chú: {body.style_notes}" if body.style_notes else ""}

Before writing scenes, identify:
- TIME PERIOD (năm/thập kỷ): Extract from the story above
- ALL FACTIONS/GROUPS: List every army/country/side involved and their correct period uniform/equipment

Tạo {body.scene_count} cảnh. Trả về JSON:
{{
  "title": "Tiêu đề hấp dẫn",
  "description": "Mô tả 1-2 câu",
  "era_context": "Đây là nơi viết FRAME THI GIẬ + tất cả lực lượng + trang bị đúng lịch sử",
  "production_notes": "",
  "suggested_characters": [{{"name": "Tên", "entity_type": "character", "description": "Mô tả", "voice_description": ""}}],
  "scenes": [{{"display_order": 0, "prompt": "[Trang phục/thiết bị cụ thể của TẤT CẢ phe có mặt, đúng năm XXX] ...", "video_prompt": "0-3s: ... Negative: subtitles.", "narrator_text": "...", "character_names": []}}]
}}"""

    raw = await _call_ai("scriptGen", system, user, max_tokens=8000,
                          provider_override=body.provider)
    provider = body.provider or get_settings().get("modelScriptGen", "claude")
    data = _parse_json_response(raw, provider.title())

    scenes = [
        GeneratedScene(
            display_order=sc.get("display_order", i),
            prompt=sc.get("prompt", ""),
            video_prompt=sc.get("video_prompt", ""),
            narrator_text=sc.get("narrator_text", ""),
            character_names=sc.get("character_names", []),
        )
        for i, sc in enumerate(data.get("scenes", []))
    ]

    return GenerateScriptResponse(
        title=data.get("title", body.name),
        description=data.get("description", ""),
        scenes=scenes,
        suggested_characters=data.get("suggested_characters", []),
        production_notes=data.get("production_notes", ""),
    )


# ── Endpoint 2: Generate Episode ──────────────────────────

@router.post("/generate-episode", response_model=GenerateEpisodeResponse)
async def generate_episode(body: GenerateEpisodeRequest):
    material_hint = _material_hint(body.project_material)
    orientation_hint = ORIENTATION_HINTS.get(body.orientation, "")
    char_block = _char_summary(body.characters)

    prev_ctx = ""
    if body.previous_episodes:
        prev_lines = [
            f"- Tập {ep.get('number','?')}: {ep.get('title','?')}\n  {ep.get('description','')[:200]}"
            for ep in body.previous_episodes[-3:]
        ]
        prev_ctx = "Các tập trước:\n" + "\n".join(prev_lines)

    system = f"""Biên kịch series video AI. Viết kịch bản tập mới bám sát project gốc.

PHONG CÁCH: {material_hint}
ĐỊNH DẠNG: {orientation_hint}
NGÔN NGỮ: {body.language}

CONTINUITY: Nhân vật nhất quán, bối cảnh phù hợp, kế thừa sự kiện tập trước.

QUY TẮc QUAN TRỌNG (ĐỌC KỸ TRƯỚC KHI VIẾT):

▶ QUY TẮc SỐ 1 — ĐỒNG NHẤT BỐI CẢNH (CRITICAL):
  Trước khi viết bất kỳ cảnh nào, xác định FRAME THI GIẬ chính xác (năm, thập kỷ, địa điểm).
  Tất cả nhân vật, quân đội, vũ khí, phương tiện, trang phục trong mọi cảnh ĐỀU phải đúng với FRAME THI GIẬ đó.
  Tất cả các nhóm/phái/quốc gia xuất hiện trong cùng cảnh phải có trang phục/thiết bị đúng thời điểm.
  VD sai: Quân Mỹ 1941 với bộ đồng phục hiện đại trong khi phít Nhật mặc đúng thời kiỳ.
  VD đúng: Cả Quân Mỹ và Nhật đều mặc trang phục năm 1941 đúng lịch sử.
  Mỗi prompt cảnh phải nêu rõ trang phục/thiết bị cụ thể của TẤT CẢ lực lượng xuất hiện.

▶ QUY TẮc SỐ 2 — PROMPT Ảnh:
  Chỉ mô tả NỘI DUNG: nhân vật làm gì, môi trường, ánh sáng, màu sắc.
  TUYỆT ĐỐI KHÔNG ghi thông số kỹ thuật máy ảnh (85mm, f/1.4, ARRI, bokeh, shot on...).
  Thông số máy ảnh làm AI in chữ kỹ thuật lên ảnh — lỗi nghiêm trọng.

Trả về JSON thuần, không giải thích."""

    user = f"""PROJECT: {body.project_name}
STORY: {body.project_story}

NHÂN VẬT:
{char_block}

{prev_ctx}

TẬP {body.episode_number}: {body.episode_title}
NỘI DUNG: {body.episode_brief}
{f"GHI CHÚ: {body.style_notes}" if body.style_notes else ""}

Before writing scenes, identify:
- TIME PERIOD: Extract exact year/decade from story and episode brief
- ALL FACTIONS: List every army/country/side + their period-correct uniform and equipment

Viết {body.scene_count} cảnh. Trả về JSON:
{{
  "title": "Tiêu đề tập {body.episode_number}",
  "description": "Tóm tắt 1-2 câu",
  "era_context": "FRAME THI GIẬ + tất cả lực lượng + trang bị đúng lịch sử",
  "continuity_notes": "",
  "scenes": [{{"display_order": 0, "prompt": "[Trang phục/thiết bị đúng năm XXX của TẤT CẢ phe] ...", "video_prompt": "0-3s: ... Negative: subtitles.", "narrator_text": "...", "character_names": []}}]
}}"""

    raw = await _call_ai("episodeGen", system, user, max_tokens=8000,
                          provider_override=body.provider)
    provider = body.provider or get_settings().get("modelEpisodeGen", "claude")
    data = _parse_json_response(raw, provider.title())

    scenes = [
        GeneratedScene(
            display_order=sc.get("display_order", i),
            prompt=sc.get("prompt", ""),
            video_prompt=sc.get("video_prompt", ""),
            narrator_text=sc.get("narrator_text", ""),
            character_names=sc.get("character_names", []),
        )
        for i, sc in enumerate(data.get("scenes", []))
    ]

    return GenerateEpisodeResponse(
        title=data.get("title", f"Tập {body.episode_number}: {body.episode_title}"),
        description=data.get("description", body.episode_brief),
        scenes=scenes,
        continuity_notes=data.get("continuity_notes", ""),
    )
