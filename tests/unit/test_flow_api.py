from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from agent.api.flow import (
    GenerateImageRequest,
    GenerateVideoRequest,
    UpscaleVideoRequest,
    generate_image,
    generate_video,
    upscale_video,
)


@pytest.mark.asyncio
async def test_direct_generate_image_rejects_missing_flow_session():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    client.generate_images = AsyncMock()

    with patch("agent.api.flow.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await generate_image(GenerateImageRequest(prompt="p", project_id="project-1"))

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    client.generate_images.assert_not_called()


@pytest.mark.asyncio
async def test_direct_generate_video_rejects_missing_flow_session():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    client.generate_video = AsyncMock()

    body = GenerateVideoRequest(
        start_image_media_id="image-1",
        prompt="p",
        project_id="project-1",
        scene_id="scene-1",
    )

    with patch("agent.api.flow.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await generate_video(body)

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    client.generate_video.assert_not_called()


@pytest.mark.asyncio
async def test_direct_upscale_rejects_missing_flow_session():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    client.upscale_video = AsyncMock()

    body = UpscaleVideoRequest(media_id="video-1", scene_id="scene-1")

    with patch("agent.api.flow.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await upscale_video(body)

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    client.upscale_video.assert_not_called()
