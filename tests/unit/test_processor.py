"""Unit tests for agent/worker/processor.py — heavy mocking of crud, flow_client, operations."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.worker.processor import (
    WorkerController,
    _is_already_completed,
    _mark_scene_failed,
    _handle_failure,
    _process_one,
)
from agent.config import MAX_RETRIES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_req(
    req_type="GENERATE_IMAGE",
    scene_id="scene-001",
    orientation="VERTICAL",
    retry_count=0,
    rid="aaaaaaaa-bbbb-cccc-dddd-000000000001",
):
    return {
        "id": rid,
        "type": req_type,
        "scene_id": scene_id,
        "orientation": orientation,
        "retry_count": retry_count,
        "project_id": "proj-001",
        "video_id": "video-001",
    }


# ---------------------------------------------------------------------------
# WorkerController cleanup
# ---------------------------------------------------------------------------

class TestWorkerControllerCleanup:
    def test_flow_key_auto_resume_requires_recent_arm(self):
        controller = WorkerController()

        controller.pause("NO_FLOW_KEY")
        assert controller.can_auto_resume_after_flow_key() is False

        controller.arm_flow_key_auto_resume()
        assert controller.can_auto_resume_after_flow_key() is True

        controller.resume()
        assert controller.can_auto_resume_after_flow_key() is False

    def test_manual_pause_clears_flow_key_auto_resume_arm(self):
        controller = WorkerController()

        controller.arm_flow_key_auto_resume()
        controller.pause("USER")

        assert controller.can_auto_resume_after_flow_key() is False

    @pytest.mark.asyncio
    async def test_cleanup_stale_processing_restores_scene_status_to_pending(self):
        controller = WorkerController()
        stale = [make_req(req_type="GENERATE_VIDEO", scene_id="scene-001", orientation="VERTICAL")]

        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.list_requests = AsyncMock(return_value=stale)
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await controller._cleanup_stale_processing()

        mock_crud.update_request.assert_awaited_once_with(
            stale[0]["id"],
            status="PENDING",
            error_message="reset: stale PROCESSING on startup",
        )
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_video_status="PENDING")

    @pytest.mark.asyncio
    async def test_startup_existing_queue_pauses_worker(self):
        controller = WorkerController()
        pending = [make_req(req_type="GENERATE_VIDEO")]

        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.list_requests = AsyncMock(side_effect=[pending, []])
            await controller._pause_if_existing_queue()

        assert controller.paused is True
        assert controller.pause_reason == "STALE_QUEUE"


# ---------------------------------------------------------------------------
# _is_already_completed
# ---------------------------------------------------------------------------

class TestIsAlreadyCompleted:
    @pytest.mark.asyncio
    async def test_returns_true_when_vertical_image_completed(self, sample_scene_row):
        """Should return True when vertical_image_status is COMPLETED."""
        req = make_req(req_type="GENERATE_IMAGE", scene_id="scene-001")
        # sample_scene_row has vertical_image_status = "COMPLETED"
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.get_scene = AsyncMock(return_value=sample_scene_row)
            result = await _is_already_completed(req, "VERTICAL")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_vertical_image_pending(self, sample_scene_row):
        """Should return False when vertical_image_status is PENDING."""
        pending_scene = {**sample_scene_row, "vertical_image_status": "PENDING"}
        req = make_req(req_type="GENERATE_IMAGE", scene_id="scene-001")
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.get_scene = AsyncMock(return_value=pending_scene)
            result = await _is_already_completed(req, "VERTICAL")
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_for_generate_character_image(self, sample_scene_row):
        """GENERATE_CHARACTER_IMAGE has no scene — should always return False."""
        req = make_req(req_type="GENERATE_CHARACTER_IMAGE", scene_id="scene-001")
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.get_scene = AsyncMock(return_value=sample_scene_row)
            result = await _is_already_completed(req, "VERTICAL")
        assert result is False
        mock_crud.get_scene.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_no_scene_id(self):
        """If scene_id is missing, should return False without querying DB."""
        req = make_req(req_type="GENERATE_IMAGE", scene_id=None)
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.get_scene = AsyncMock()
            result = await _is_already_completed(req, "VERTICAL")
        assert result is False
        mock_crud.get_scene.assert_not_called()

    @pytest.mark.asyncio
    async def test_edit_image_never_skipped_even_when_image_completed(self, sample_scene_row):
        """EDIT_IMAGE should always run — it replaces the existing image."""
        req = make_req(req_type="EDIT_IMAGE", scene_id="scene-001")
        # sample_scene_row has vertical_image_status = "COMPLETED"
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.get_scene = AsyncMock(return_value=sample_scene_row)
            result = await _is_already_completed(req, "VERTICAL")
        assert result is False


# ---------------------------------------------------------------------------
# _mark_scene_failed
# ---------------------------------------------------------------------------

class TestMarkSceneFailed:
    @pytest.mark.asyncio
    async def test_sets_vertical_image_status_failed_for_generate_image(self):
        req = make_req(req_type="GENERATE_IMAGE", scene_id="scene-001", orientation="VERTICAL")
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_scene = AsyncMock()
            await _mark_scene_failed(req)
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_image_status="FAILED")

    @pytest.mark.asyncio
    async def test_sets_vertical_video_status_failed_for_generate_video(self):
        req = make_req(req_type="GENERATE_VIDEO", scene_id="scene-001", orientation="VERTICAL")
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_scene = AsyncMock()
            await _mark_scene_failed(req)
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_video_status="FAILED")

    @pytest.mark.asyncio
    async def test_sets_vertical_upscale_status_failed_for_upscale_video(self):
        req = make_req(req_type="UPSCALE_VIDEO", scene_id="scene-001", orientation="VERTICAL")
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_scene = AsyncMock()
            await _mark_scene_failed(req)
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_upscale_status="FAILED")

    @pytest.mark.asyncio
    async def test_no_update_when_no_scene_id(self):
        req = make_req(req_type="GENERATE_IMAGE", scene_id=None)
        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_scene = AsyncMock()
            await _mark_scene_failed(req)
        mock_crud.update_scene.assert_not_called()


# ---------------------------------------------------------------------------
# _handle_failure
# ---------------------------------------------------------------------------

class TestHandleFailure:
    @pytest.mark.asyncio
    async def test_retries_when_under_max_retries(self):
        """When retry_count+1 < MAX_RETRIES, request should go back to PENDING."""
        req = make_req(retry_count=0)
        rid = req["id"]
        result = {"error": "timeout"}

        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, result)

        mock_crud.update_request.assert_awaited_once()
        call_kwargs = mock_crud.update_request.call_args
        assert call_kwargs[0][0] == rid
        assert call_kwargs[1]["status"] == "PENDING"
        assert call_kwargs[1]["retry_count"] == 1

    @pytest.mark.asyncio
    async def test_marks_failed_when_at_max_retries(self):
        """When retry_count+1 >= MAX_RETRIES, request + scene should be marked FAILED."""
        req = make_req(req_type="GENERATE_IMAGE", scene_id="scene-001", retry_count=MAX_RETRIES - 1)
        rid = req["id"]
        result = {"error": "permanent failure"}

        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, result)

        mock_crud.update_request.assert_awaited_once()
        call_kwargs = mock_crud.update_request.call_args
        assert call_kwargs[0][0] == rid
        assert call_kwargs[1]["status"] == "FAILED"
        # Scene should also be marked failed
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_image_status="FAILED")

    @pytest.mark.asyncio
    async def test_extracts_error_message_from_nested_data(self):
        """Error message extraction from data.error.message should work."""
        req = make_req(retry_count=MAX_RETRIES - 1)
        rid = req["id"]
        result = {
            "data": {
                "error": {
                    "code": 403,
                    "message": "caller does not have permission",
                }
            }
        }

        with patch("agent.worker.processor.crud") as mock_crud:
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, result)

        call_kwargs = mock_crud.update_request.call_args
        assert "caller does not have permission" in call_kwargs[1]["error_message"]

    @pytest.mark.asyncio
    async def test_unusual_activity_captcha_pauses_worker_without_retry_timer(self):
        """PUBLIC_ERROR_UNUSUAL_ACTIVITY should not keep auto-retrying."""
        req = make_req(req_type="GENERATE_VIDEO", retry_count=0)
        rid = req["id"]
        retry_after = {}
        result = {
            "data": {
                "error": {
                    "code": 403,
                    "message": "reCAPTCHA evaluation failed",
                    "details": [{"reason": "PUBLIC_ERROR_UNUSUAL_ACTIVITY"}],
                }
            }
        }
        controller = MagicMock()

        with patch("agent.worker.processor.crud") as mock_crud, \
                patch("agent.worker.processor.get_worker_controller", return_value=controller):
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, result, retry_after)

        mock_crud.update_request.assert_awaited_once()
        call_args = mock_crud.update_request.call_args
        assert call_args[0][0] == rid
        assert call_args[1]["status"] == "PENDING"
        assert call_args[1]["retry_count"] == 1
        assert "PUBLIC_ERROR_UNUSUAL_ACTIVITY" in call_args[1]["error_message"]
        assert retry_after == {}
        controller.pause.assert_called_once_with("CAPTCHA_UNUSUAL_ACTIVITY")

    @pytest.mark.asyncio
    async def test_generic_captcha_keeps_short_retry_timer(self):
        """Non-unusual captcha errors keep the short in-memory retry path."""
        req = make_req(req_type="GENERATE_VIDEO", retry_count=0)
        rid = req["id"]
        retry_after = {}
        result = {"error": "reCAPTCHA evaluation failed"}

        with patch("agent.worker.processor.crud") as mock_crud, \
                patch("agent.worker.processor.get_worker_controller") as mock_controller:
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, result, retry_after)

        assert retry_after[rid] > 0
        mock_controller.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_flow_key_pauses_worker_without_retry_increment(self):
        """Missing Flow token should pause instead of burning retries."""
        req = make_req(req_type="GENERATE_VIDEO", retry_count=4)
        rid = req["id"]
        retry_after = {}
        controller = MagicMock()

        with patch("agent.worker.processor.crud") as mock_crud, \
                patch("agent.worker.processor.get_worker_controller", return_value=controller):
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            await _handle_failure(rid, req, {"error": "NO_FLOW_KEY"}, retry_after)

        mock_crud.update_request.assert_awaited_once_with(
            rid,
            status="PENDING",
            error_message="NO_FLOW_KEY",
        )
        mock_crud.update_scene.assert_awaited_once_with("scene-001", vertical_video_status="PENDING")
        assert retry_after == {}
        controller.pause.assert_called_once_with("NO_FLOW_KEY")

    @pytest.mark.asyncio
    async def test_processing_failure_restores_scene_status_to_pending(self):
        """Soft retry should not leave the scene asset stuck in PROCESSING."""
        req = make_req(req_type="GENERATE_IMAGE", scene_id="scene-001", orientation="VERTICAL")

        with patch("agent.worker.processor.crud") as mock_crud, \
                patch("agent.worker.processor._is_already_completed", new_callable=AsyncMock, return_value=False), \
                patch("agent.worker.processor._dispatch", new_callable=AsyncMock, return_value={"error": "timeout"}), \
                patch("agent.worker.processor.event_bus") as mock_bus:
            mock_crud.update_request = AsyncMock()
            mock_crud.update_scene = AsyncMock()
            mock_bus.emit = AsyncMock()
            await _process_one(req, retry_after={})

        scene_status_updates = [call.kwargs for call in mock_crud.update_scene.await_args_list]
        assert {"vertical_image_status": "PROCESSING"} in scene_status_updates
        assert {"vertical_image_status": "PENDING"} in scene_status_updates
