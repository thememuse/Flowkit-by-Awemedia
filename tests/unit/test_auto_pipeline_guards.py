from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from agent.api.auto_pipeline import AutoPipelineRequest, _jobs, _submit_batch, start_auto_pipeline


@pytest.mark.asyncio
async def test_auto_pipeline_start_rejects_missing_flow_session_before_job_created():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    before_jobs = set(_jobs.keys())

    with patch("agent.services.flow_client.get_flow_client", return_value=client):
        with pytest.raises(HTTPException) as exc:
            await start_auto_pipeline(
                AutoPipelineRequest(
                    project_id="project-1",
                    episode_title="Episode",
                    episode_brief="Brief",
                )
            )

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    assert set(_jobs.keys()) == before_jobs


@pytest.mark.asyncio
async def test_auto_pipeline_submit_batch_rejects_missing_flow_session_before_db_write():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False

    with patch("agent.services.flow_client.get_flow_client", return_value=client), \
            patch("agent.api.auto_pipeline.crud") as mock_crud:
        mock_crud.create_request = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await _submit_batch([
                {
                    "type": "GENERATE_VIDEO",
                    "scene_id": "scene-1",
                    "project_id": "project-1",
                    "video_id": "video-1",
                    "orientation": "HORIZONTAL",
                }
            ])

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    mock_crud.create_request.assert_not_called()
