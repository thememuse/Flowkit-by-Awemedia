"""Settings API — lưu và lấy cài đặt ứng dụng.

Hỗ trợ:
- API keys (Anthropic, Suno)
- Project defaults (material, orientation, scene count)
- Pipeline config (concurrency, cooldown)
"""
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter

from agent.config import BASE_DIR

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

_SETTINGS_FILE = BASE_DIR / "settings.json"

_DEFAULTS = {
    # ── API Keys (single — legacy) ───────────────────────────
    "anthropicApiKey": "",
    "openaiApiKey": "",
    "geminiApiKey": "",
    "sunoApiKey": "",
    "elevenlabsApiKey": "",
    # ── API Keys (array — rotation) ──────────────────────────
    "anthropicApiKeys": [],   # list of strings — xoay vòng khi bị limit
    "openaiApiKeys":    [],
    "geminiApiKeys":    [],
    # ── Provider per task ───────────────────────────────────
    "modelScriptGen":  "claude",
    "modelEpisodeGen": "claude",
    "modelReview":     "claude",
    # ── Model per provider ───────────────────────────────────
    "claudeModel":  "claude-haiku-4-5-20251001",
    "openaiModel":  "gpt-4o-mini",
    "geminiModel":  "gemini-2.0-flash",
    # ── Project defaults ────────────────────────────────────
    "defaultMaterial":    "realistic",
    "defaultOrientation": "VERTICAL",
    "defaultSceneCount":  10,
    # ── Pipeline ─────────────────────────────────────────────
    "maxConcurrentRequests": 5,
    "apiCooldown":           10,
    "language":              "vi",
    "reviewModel":           "claude-haiku-4-5-20251001",
    # ── Download ─────────────────────────────────────────────
    "upscaleMethod":         "veo",
    "downloadLocation":      "",  # "" = browser default download folder
    # ── TTS defaults (ElevenLabs) ────────────────────────────
    "ttsDefaultModel":    "eleven_multilingual_v2",
    "ttsDefaultVoiceId":  "",
    "ttsDefaultFormat":   "mp3_44100_128",
    "ttsStability":       0.5,
    "ttsSimilarityBoost": 0.75,
    "ttsStyle":           0.0,
    "ttsSpeed":           1.0,
    "ttsSpeakerBoost":    True,
}


def _read() -> dict:
    if _SETTINGS_FILE.exists():
        try:
            return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _write(data: dict) -> None:
    _SETTINGS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_settings() -> dict:
    """Trả về settings hiện tại đã merge với defaults."""
    saved = _read()
    return {**_DEFAULTS, **saved}


def _apply_to_env(settings: dict) -> None:
    """Hot-reload API keys vào config module và env."""
    from agent import config

    key = settings.get("anthropicApiKey", "")
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
        config.ANTHROPIC_API_KEY = key

    openai_key = settings.get("openaiApiKey", "")
    if openai_key:
        os.environ["OPENAI_API_KEY"] = openai_key

    gemini_key = settings.get("geminiApiKey", "")
    if gemini_key:
        os.environ["GEMINI_API_KEY"] = gemini_key

    suno = settings.get("sunoApiKey", "")
    if suno:
        os.environ["SUNO_API_KEY"] = suno
        config.SUNO_API_KEY = suno

    elevenlabs = settings.get("elevenlabsApiKey", "")
    if elevenlabs:
        os.environ["ELEVENLABS_API_KEY"] = elevenlabs

    max_c = settings.get("maxConcurrentRequests")
    if max_c is not None:
        config.MAX_CONCURRENT_REQUESTS = int(max_c)

    cooldown = settings.get("apiCooldown")
    if cooldown is not None:
        config.API_COOLDOWN = int(cooldown)

    review_model = settings.get("reviewModel", "")
    if review_model:
        config.REVIEW_MODEL = review_model

    # Hot-reload thư mục tải xuống/đầu ra của Flow
    download_loc = settings.get("downloadLocation", "").strip()
    if download_loc:
        download_path = Path(download_loc)
        config.OUTPUT_DIR = download_path
        config.SHARED_OUTPUT_DIR = download_path / "_shared"
        config.TTS_TEMPLATES_DIR = config.SHARED_OUTPUT_DIR / "tts_templates"
        config.MUSIC_OUTPUT_DIR = config.SHARED_OUTPUT_DIR / "music"
    else:
        config.OUTPUT_DIR = config.BASE_DIR / "output"
        config.SHARED_OUTPUT_DIR = config.OUTPUT_DIR / "_shared"
        config.TTS_TEMPLATES_DIR = config.SHARED_OUTPUT_DIR / "tts_templates"
        config.MUSIC_OUTPUT_DIR = config.SHARED_OUTPUT_DIR / "music"


@router.get("")
async def get_all():
    """Trả về tất cả settings (giá trị mặc định nếu chưa set)."""
    return get_settings()


@router.patch("")
async def update(body: dict):
    """Cập nhật một hoặc nhiều settings. Merge vào settings hiện tại."""
    current = _read()
    current.update(body)
    _write(current)

    # Hot-reload các key cấu hình
    merged = {**_DEFAULTS, **current}
    _apply_to_env(merged)

    logger.info("Settings updated: %s", list(body.keys()))
    return merged


@router.post("/reload")
async def reload():
    """Reload settings từ file và áp dụng vào config."""
    settings = get_settings()
    _apply_to_env(settings)
    return {"ok": True, "loaded": list(settings.keys())}
