"""Unit tests for request CRUD helpers."""

from unittest.mock import patch

import pytest

from agent.db import crud


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def fetchall(self):
        return self._rows


class _FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.query = None
        self.params = None

    async def execute(self, query, params=None):
        self.query = query
        self.params = params
        return _FakeCursor(self.rows)


@pytest.mark.asyncio
async def test_list_actionable_requests_filters_future_next_retry_at_in_sql():
    db = _FakeDb([
        {
            "id": "req-visible",
            "type": "GENERATE_VIDEO",
            "status": "PENDING",
            "created_at": "2026-05-28T12:00:00Z",
            "next_retry_at": "2099-01-01T00:00:00Z",
        }
    ])

    with patch("agent.db.crud.get_db", return_value=db):
        rows = await crud.list_actionable_requests(limit=5)

    assert rows == db.rows
    assert "next_retry_at is null or next_retry_at <= ?" in " ".join(db.query.lower().split())
    assert len(db.params) == 1
