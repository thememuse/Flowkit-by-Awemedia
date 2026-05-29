from fastapi import HTTPException
from datetime import datetime, timedelta, timezone

from agent.api.requests import router
from agent.api.requests import (
    BatchRequestCreate,
    batch_status,
    cancel_all,
    create,
    create_batch,
    get_worker_status,
    resume_worker,
)
from agent.models.request import RequestCreate
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def test_worker_status_route_is_registered_before_request_id_route():
    paths = [route.path for route in router.routes]

    assert "/requests/{rid}" in paths
    dynamic_index = paths.index("/requests/{rid}")
    for static_path in (
        "/requests/pending",
        "/requests/batch-status",
        "/requests/worker-status",
        "/requests/cancel-active",
        "/requests/cancel-all",
        "/requests/pause",
        "/requests/resume",
    ):
        assert static_path in paths
        assert paths.index(static_path) < dynamic_index


@pytest.mark.asyncio
async def test_worker_status_reports_queue_count():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = "NO_FLOW_KEY"
    controller.active_count = 1
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller), \
            patch("agent.api.requests.crud") as mock_crud:
        mock_crud.list_requests = AsyncMock(side_effect=[
            [{"id": "p1"}, {"id": "p2"}],
            [{"id": "r1"}],
        ])
        result = await get_worker_status()

    assert result["pending_count"] == 2
    assert result["processing_count"] == 1
    assert result["queue_count"] == 3


@pytest.mark.asyncio
async def test_batch_status_reports_captcha_block_when_worker_paused():
    controller = MagicMock()
    controller.paused = True
    rows = [
        {
            "id": "req-1",
            "type": "GENERATE_VIDEO",
            "status": "PENDING",
            "created_at": "2026-05-28T12:00:00Z",
            "error_message": "reCAPTCHA evaluation failed [PUBLIC_ERROR_UNUSUAL_ACTIVITY]",
        }
    ]

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        mock_crud.list_requests = AsyncMock(return_value=rows)
        result = await batch_status(video_id="video-1", type="GENERATE_VIDEO")

    assert result.pending == 1
    assert result.worker_paused is True
    assert result.blocked is True
    assert "PUBLIC_ERROR_UNUSUAL_ACTIVITY" in result.last_error


@pytest.mark.asyncio
async def test_batch_status_reports_no_flow_key_block_when_worker_paused():
    controller = MagicMock()
    controller.paused = True
    rows = [
        {
            "id": "req-1",
            "type": "GENERATE_VIDEO",
            "status": "PENDING",
            "created_at": "2026-05-28T12:00:00Z",
            "error_message": "NO_FLOW_KEY",
        }
    ]

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        mock_crud.list_requests = AsyncMock(return_value=rows)
        result = await batch_status(video_id="video-1", type="GENERATE_VIDEO")

    assert result.pending == 1
    assert result.worker_paused is True
    assert result.blocked is True
    assert result.last_error == "NO_FLOW_KEY"


@pytest.mark.asyncio
async def test_resume_rejects_when_extension_disconnected():
    client = MagicMock()
    client.connected = False
    client.flow_key_present = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await resume_worker()

    assert exc.value.status_code == 409
    assert "Extension not connected" in exc.value.detail


@pytest.mark.asyncio
async def test_resume_rejects_when_flow_session_missing():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await resume_worker()

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail


@pytest.mark.asyncio
async def test_resume_allowed_when_flow_session_ready():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = None

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        result = await resume_worker()

    assert result == {"status": "success", "paused": False, "pause_reason": None}
    controller.resume.assert_called_once_with()


@pytest.mark.asyncio
async def test_resume_rejects_stale_no_flow_key_queue_without_force():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = "NO_FLOW_KEY"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await resume_worker()

    assert exc.value.status_code == 409
    assert "stale queue" in exc.value.detail
    controller.resume.assert_not_called()


@pytest.mark.asyncio
async def test_resume_rejects_captcha_pause_without_force():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = "CAPTCHA_UNUSUAL_ACTIVITY"

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await resume_worker()

    assert exc.value.status_code == 409
    assert "reCAPTCHA unusual activity" in exc.value.detail
    controller.resume.assert_not_called()


@pytest.mark.asyncio
async def test_resume_rejects_startup_stale_queue_without_force():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = "STALE_QUEUE"

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await resume_worker()

    assert exc.value.status_code == 409
    assert "previous app session" in exc.value.detail
    controller.resume.assert_not_called()


@pytest.mark.asyncio
async def test_resume_force_allows_stale_queue():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = True
    controller = MagicMock()
    controller.pause_reason = "NO_FLOW_KEY"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        result = await resume_worker(force=True)

    assert result == {"status": "success", "paused": False, "pause_reason": None}
    controller.resume.assert_called_once_with()


@pytest.mark.asyncio
async def test_create_rejects_when_flow_session_missing():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    mock_crud.create_request.assert_not_called()


@pytest.mark.asyncio
async def test_create_rejects_when_flow_session_check_unavailable():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", side_effect=RuntimeError("boom")):
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 503
    assert "Flow session check unavailable" in exc.value.detail
    mock_crud.create_request.assert_not_called()


@pytest.mark.asyncio
async def test_create_batch_rejects_when_extension_disconnected():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    client = MagicMock()
    client.connected = False
    client.flow_key_present = False

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await create_batch(BatchRequestCreate(requests=[body]))

    assert exc.value.status_code == 409
    assert "Extension not connected" in exc.value.detail
    mock_crud.create_request.assert_not_called()


@pytest.mark.asyncio
async def test_create_rejects_when_stale_queue_would_block_new_work_even_before_flow_key():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    client = MagicMock()
    client.flow_key_present = False
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "NO_FLOW_KEY"
    controller.can_auto_resume_after_flow_key.return_value = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "stale queue" in exc.value.detail


@pytest.mark.asyncio
async def test_create_rejects_when_captcha_pause_would_block_new_work():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    client = MagicMock()
    client.flow_key_present = True
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "CAPTCHA_UNUSUAL_ACTIVITY"

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "reCAPTCHA unusual activity" in exc.value.detail


@pytest.mark.asyncio
async def test_create_rejects_when_startup_stale_queue_would_block_new_work():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    client = MagicMock()
    client.flow_key_present = True
    controller = MagicMock()
    controller.paused = True
    controller.pause_reason = "STALE_QUEUE"

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "previous app session" in exc.value.detail


@pytest.mark.asyncio
async def test_create_rejects_recent_unusual_activity_even_after_queue_clean():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client = MagicMock()
    client.flow_key_present = True
    controller = MagicMock()
    controller.paused = False

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        mock_crud.list_requests = AsyncMock(return_value=[
            {"id": "failed-1", "error_message": "reCAPTCHA evaluation failed [PUBLIC_ERROR_UNUSUAL_ACTIVITY]", "updated_at": recent}
        ])
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "Recent reCAPTCHA unusual activity" in exc.value.detail


@pytest.mark.asyncio
async def test_create_rejects_recent_pending_unusual_activity_after_cancel_all():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client = MagicMock()
    client.flow_key_present = True
    controller = MagicMock()
    controller.paused = False

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        mock_crud.list_requests = AsyncMock(return_value=[
            {
                "id": "pending-1",
                "status": "PENDING",
                "error_message": "reCAPTCHA evaluation failed [PUBLIC_ERROR_UNUSUAL_ACTIVITY]",
                "updated_at": recent,
            }
        ])
        with pytest.raises(HTTPException) as exc:
            await create(body)

    assert exc.value.status_code == 409
    assert "Recent reCAPTCHA unusual activity" in exc.value.detail


@pytest.mark.asyncio
async def test_create_ignores_old_unusual_activity_record():
    body = RequestCreate(
        type="GENERATE_VIDEO",
        scene_id="scene-1",
        project_id="project-1",
        video_id="video-1",
        orientation="HORIZONTAL",
    )
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client = MagicMock()
    client.flow_key_present = True
    controller = MagicMock()
    controller.paused = False

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.worker.processor.get_worker_controller", return_value=controller):
        mock_crud.list_requests = AsyncMock(side_effect=[
            [{"id": "failed-1", "error_message": "reCAPTCHA evaluation failed [PUBLIC_ERROR_UNUSUAL_ACTIVITY]", "updated_at": old}],
            [],
        ])
        mock_crud.update_video = AsyncMock()
        mock_crud.create_request = AsyncMock(return_value={"id": "req-1"})
        result = await create(body)

    assert result == {"id": "req-1"}


@pytest.mark.asyncio
async def test_cancel_all_clears_stale_queue_pause():
    controller = MagicMock()
    controller.pause_reason = "STALE_QUEUE"

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.worker.processor.get_worker_controller", return_value=controller), \
            patch("agent.utils.cancel_registry.cancel_request"), \
            patch("agent.services.event_bus.event_bus") as mock_bus:
        mock_crud.list_requests = AsyncMock(side_effect=[
            [{"id": "req-1", "type": "GENERATE_VIDEO", "scene_id": "scene-1", "orientation": "HORIZONTAL"}],
            [],
        ])
        mock_crud.update_request = AsyncMock()
        mock_crud.update_scene = AsyncMock()
        mock_bus.emit = AsyncMock()
        result = await cancel_all()

    assert result == {"status": "success", "cancelled_count": 1}
    controller.resume.assert_called_once_with()


@pytest.mark.asyncio
async def test_cancel_all_preserves_unusual_activity_error_for_cooldown_guard():
    controller = MagicMock()
    controller.pause_reason = "CAPTCHA_UNUSUAL_ACTIVITY"
    captcha_error = "reCAPTCHA evaluation failed [PUBLIC_ERROR_UNUSUAL_ACTIVITY]"

    with patch("agent.api.requests.crud") as mock_crud, \
            patch("agent.worker.processor.get_worker_controller", return_value=controller), \
            patch("agent.utils.cancel_registry.cancel_request"), \
            patch("agent.services.event_bus.event_bus") as mock_bus:
        mock_crud.list_requests = AsyncMock(side_effect=[
            [{
                "id": "req-1",
                "type": "GENERATE_VIDEO",
                "scene_id": "scene-1",
                "orientation": "HORIZONTAL",
                "error_message": captcha_error,
            }],
            [],
        ])
        mock_crud.update_request = AsyncMock()
        mock_crud.update_scene = AsyncMock()
        mock_bus.emit = AsyncMock()
        result = await cancel_all()

    assert result == {"status": "success", "cancelled_count": 1}
    mock_crud.update_request.assert_called_once()
    update_kwargs = mock_crud.update_request.call_args.kwargs
    assert update_kwargs["status"] == "FAILED"
    assert "PUBLIC_ERROR_UNUSUAL_ACTIVITY" in update_kwargs["error_message"]
    assert "Cancelled by user" in update_kwargs["error_message"]
