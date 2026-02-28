"""Shared fixtures for testing."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

import pytest


SAMPLE_CONVERSATIONS = [
    {
        "id": "conv-001",
        "title": "Python async patterns",
        "create_time": datetime(2024, 3, 10, 14, 30, tzinfo=timezone.utc).timestamp(),
        "update_time": datetime(2024, 3, 10, 15, 45, tzinfo=timezone.utc).timestamp(),
        "mapping": {
            "root": {
                "id": "root",
                "message": None,
                "parent": None,
                "children": ["msg-1"],
            },
            "msg-1": {
                "id": "msg-1",
                "message": {
                    "id": "msg-1",
                    "author": {"role": "user"},
                    "content": {"content_type": "text", "parts": ["How does async/await work in Python?"]},
                    "create_time": 1710081000.0,
                    "metadata": {},
                },
                "parent": "root",
                "children": ["msg-2"],
            },
            "msg-2": {
                "id": "msg-2",
                "message": {
                    "id": "msg-2",
                    "author": {"role": "assistant"},
                    "content": {
                        "content_type": "text",
                        "parts": [
                            "Python's `async`/`await` syntax enables asynchronous programming. "
                            "Here's a basic example:\n\n```python\nimport asyncio\n\nasync def main():\n"
                            "    await asyncio.sleep(1)\n    print('done')\n```"
                        ],
                    },
                    "create_time": 1710081060.0,
                    "metadata": {"model_slug": "gpt-4"},
                },
                "parent": "msg-1",
                "children": ["msg-3"],
            },
            "msg-3": {
                "id": "msg-3",
                "message": {
                    "id": "msg-3",
                    "author": {"role": "user"},
                    "content": {"content_type": "text", "parts": ["Can you show me error handling?"]},
                    "create_time": 1710081120.0,
                    "metadata": {},
                },
                "parent": "msg-2",
                "children": ["msg-4"],
            },
            "msg-4": {
                "id": "msg-4",
                "message": {
                    "id": "msg-4",
                    "author": {"role": "assistant"},
                    "content": {
                        "content_type": "text",
                        "parts": ["Use try/except inside async functions just like regular Python."],
                    },
                    "create_time": 1710081180.0,
                    "metadata": {"model_slug": "gpt-4"},
                },
                "parent": "msg-3",
                "children": [],
            },
        },
    },
    {
        "id": "conv-002",
        "title": "Sourdough recipe",
        "create_time": datetime(2024, 2, 15, 10, 0, tzinfo=timezone.utc).timestamp(),
        "update_time": datetime(2024, 2, 15, 10, 30, tzinfo=timezone.utc).timestamp(),
        "mapping": {
            "root": {
                "id": "root",
                "message": None,
                "parent": None,
                "children": ["msg-a"],
            },
            "msg-a": {
                "id": "msg-a",
                "message": {
                    "id": "msg-a",
                    "author": {"role": "user"},
                    "content": {"content_type": "text", "parts": ["Give me a sourdough bread recipe"]},
                    "create_time": 1708000000.0,
                    "metadata": {},
                },
                "parent": "root",
                "children": ["msg-b"],
            },
            "msg-b": {
                "id": "msg-b",
                "message": {
                    "id": "msg-b",
                    "author": {"role": "assistant"},
                    "content": {
                        "content_type": "text",
                        "parts": ["Here's a classic sourdough recipe:\n\n**Ingredients:**\n- 500g flour\n- 350g water\n- 100g starter\n- 10g salt"],
                    },
                    "create_time": 1708000060.0,
                    "metadata": {"model_slug": "gpt-3.5-turbo"},
                },
                "parent": "msg-a",
                "children": [],
            },
        },
    },
]


@pytest.fixture
def sample_conversations():
    """Return sample raw conversation data."""
    return SAMPLE_CONVERSATIONS


@pytest.fixture
def sample_zip_bytes():
    """Create an in-memory ZIP with conversations.json."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("conversations.json", json.dumps(SAMPLE_CONVERSATIONS))
    buf.seek(0)
    return buf.read()


@pytest.fixture
def sample_zip_path(tmp_path, sample_zip_bytes):
    """Write sample ZIP to a temp file and return its path."""
    zip_path = tmp_path / "chatgpt_export.zip"
    zip_path.write_bytes(sample_zip_bytes)
    return zip_path
