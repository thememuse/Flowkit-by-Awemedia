from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from agent.api.projects import ThumbnailRequest, generate_thumbnail, sync_to_flow


@pytest.mark.asyncio
async def test_sync_to_flow_rejects_missing_flow_session_before_repo_lookup():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    repo = MagicMock()
    repo.get_project = AsyncMock()

    with patch("agent.api.projects.get_flow_client", return_value=client), \
            patch("agent.api.projects._get_repo", return_value=repo):
        with pytest.raises(HTTPException) as exc:
            await sync_to_flow("project-1")

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    repo.get_project.assert_not_called()


@pytest.mark.asyncio
async def test_generate_thumbnail_rejects_missing_flow_session_before_repo_lookup():
    client = MagicMock()
    client.connected = True
    client.flow_key_present = False
    client.generate_images = AsyncMock()
    repo = MagicMock()
    repo.get_project = AsyncMock()

    with patch("agent.api.projects.get_flow_client", return_value=client), \
            patch("agent.api.projects._get_repo", return_value=repo):
        with pytest.raises(HTTPException) as exc:
            await generate_thumbnail("project-1", ThumbnailRequest(prompt="thumbnail"))

    assert exc.value.status_code == 409
    assert "Flow session not ready" in exc.value.detail
    repo.get_project.assert_not_called()
    client.generate_images.assert_not_called()
