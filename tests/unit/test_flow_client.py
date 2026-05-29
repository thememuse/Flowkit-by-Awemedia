import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from agent.services.flow_client import FlowClient


def test_resume_worker_after_flow_key_resumes_only_when_controller_allows():
    client = FlowClient()
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "NO_FLOW_KEY"
    controller.can_auto_resume_after_flow_key.return_value = True

    with patch("agent.worker.processor.get_worker_controller", return_value=controller):
        client._resume_worker_after_flow_key()

    controller.resume.assert_called_once_with()


def test_extension_ready_without_flow_key_clears_stale_agent_token():
    client = FlowClient()
    client.set_flow_key("ya29.old-token")

    async def run():
        await client.handle_message({"type": "extension_ready", "flowKeyPresent": False})

    asyncio.run(run())

    assert client.flow_key_present is False


def test_token_cleared_message_clears_stale_agent_token():
    client = FlowClient()
    client.set_flow_key("ya29.old-token")

    async def run():
        await client.handle_message({"type": "token_cleared", "reason": "AUTH_401"})

    asyncio.run(run())

    assert client.flow_key_present is False


def test_api_request_without_flow_key_fails_before_extension_send():
    client = FlowClient()
    ws = MagicMock()
    ws.send = AsyncMock()
    client.set_extension(ws)

    async def run():
        return await client._send("api_request", {"url": "https://aisandbox-pa.googleapis.com/v1/test"})

    result = asyncio.run(run())

    assert result == {"error": "NO_FLOW_KEY", "status": 503}
    ws.send.assert_not_called()
    assert client._pending == {}


def test_resume_worker_after_flow_key_keeps_unarmed_no_flow_key_pause():
    client = FlowClient()
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "NO_FLOW_KEY"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.worker.processor.get_worker_controller", return_value=controller):
        client._resume_worker_after_flow_key()

    controller.resume.assert_not_called()


def test_resume_worker_after_flow_key_keeps_manual_pause():
    client = FlowClient()
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "USER"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.worker.processor.get_worker_controller", return_value=controller):
        client._resume_worker_after_flow_key()

    controller.resume.assert_not_called()


def test_resume_worker_after_flow_key_keeps_captcha_pause():
    client = FlowClient()
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "CAPTCHA_UNUSUAL_ACTIVITY"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.worker.processor.get_worker_controller", return_value=controller):
        client._resume_worker_after_flow_key()

    controller.resume.assert_not_called()


def test_media_generation_uses_matching_recaptcha_actions():
    client = FlowClient()
    client._send = AsyncMock(return_value={"status": 200})

    async def run():
        await client.generate_images("prompt", "project-1")
        await client.generate_video("image-1", "prompt", "project-1", "scene-1")
        await client.generate_video_from_references(["image-1"], "prompt", "project-1", "scene-1")
        await client.upscale_video("video-1", "scene-1")

    asyncio.run(run())

    params_by_call = [call.args[1] for call in client._send.call_args_list]
    assert params_by_call[0]["captchaAction"] == "IMAGE_GENERATION"
    assert params_by_call[1]["captchaAction"] == "VIDEO_GENERATION"
    assert params_by_call[2]["captchaAction"] == "VIDEO_GENERATION"
    assert params_by_call[3]["captchaAction"] == "VIDEO_GENERATION"
