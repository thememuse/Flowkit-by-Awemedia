"""Pydantic models for ElevenLabs TTS endpoints."""
from typing import Optional
from pydantic import BaseModel, Field


class ElevenLabsVoiceSettings(BaseModel):
    stability: float = Field(default=0.5, ge=0.0, le=1.0)
    similarity_boost: float = Field(default=0.75, ge=0.0, le=1.0)
    style: float = Field(default=0.0, ge=0.0, le=1.0)
    use_speaker_boost: bool = True
    speed: float = Field(default=1.0, ge=0.25, le=4.0)


class ElevenLabsTTSRequest(BaseModel):
    voice_id: str
    text: str
    model_id: str = "eleven_multilingual_v2"
    voice_settings: Optional[ElevenLabsVoiceSettings] = None
    output_format: str = "mp3_44100_128"
    segment_id: Optional[str] = None
    # Context for better quality
    previous_text: Optional[str] = None
    next_text: Optional[str] = None
    language_code: Optional[str] = None


class ElevenLabsBatchRequest(BaseModel):
    voice_id: str
    segments: list[dict]  # [{id, text, previous_text?, next_text?}]
    model_id: str = "eleven_multilingual_v2"
    voice_settings: Optional[ElevenLabsVoiceSettings] = None
    output_format: str = "mp3_44100_128"
    language_code: Optional[str] = None


class ElevenLabsVoice(BaseModel):
    voice_id: str
    name: str
    category: Optional[str] = None
    labels: Optional[dict] = None
    preview_url: Optional[str] = None
    description: Optional[str] = None


class ElevenLabsModel(BaseModel):
    model_id: str
    name: str
    description: Optional[str] = None
    can_be_finetuned: bool = False
    can_do_text_to_speech: bool = True
    languages: Optional[list[dict]] = None


class ElevenLabsSegmentResult(BaseModel):
    segment_id: str
    status: str  # "completed" | "failed"
    audio_url: Optional[str] = None
    duration: Optional[float] = None
    character_count: Optional[int] = None
    error: Optional[str] = None


class ElevenLabsBatchResponse(BaseModel):
    job_id: str
    total: int
    completed: int
    failed: int
    done: bool
    results: list[ElevenLabsSegmentResult]
