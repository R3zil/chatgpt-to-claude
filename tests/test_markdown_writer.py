"""Tests for Markdown generation."""

from chatgpt_to_claude.core.parser import parse_single_conversation
from chatgpt_to_claude.core.markdown_writer import conversation_to_markdown


def test_basic_markdown_output(sample_conversations):
    """Converted Markdown should contain title, roles, and content."""
    conv = parse_single_conversation(sample_conversations[0])
    md = conversation_to_markdown(conv)

    assert "# Python async patterns" in md
    assert "## User" in md
    assert "## Assistant (gpt-4)" in md
    assert "async/await" in md


def test_frontmatter_included(sample_conversations):
    """YAML frontmatter should be present when enabled."""
    conv = parse_single_conversation(sample_conversations[0])
    md = conversation_to_markdown(conv, include_frontmatter=True)

    assert md.startswith("---\n")
    assert "source: chatgpt-export" in md
    assert "title: Python async patterns" in md


def test_frontmatter_excluded(sample_conversations):
    """No frontmatter when disabled."""
    conv = parse_single_conversation(sample_conversations[0])
    md = conversation_to_markdown(conv, include_frontmatter=False)

    assert not md.startswith("---\n")
    assert "# Python async patterns" in md


def test_empty_conversation_produces_empty_string():
    """A conversation with no messages should return empty string."""
    raw = {"id": "empty", "title": "Empty", "mapping": {}, "create_time": None, "update_time": None}
    conv = parse_single_conversation(raw)
    md = conversation_to_markdown(conv)
    assert md == ""
