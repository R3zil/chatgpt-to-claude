"""Tests for conversation parsing and tree traversal."""

from chatgpt_to_claude.core.parser import parse_conversations, parse_single_conversation
from chatgpt_to_claude.core.models import AuthorRole, Conversation, ConversationMeta


def test_parse_conversations_full(sample_conversations):
    """Full parse returns Conversation objects with messages."""
    convs = list(parse_conversations(sample_conversations, metadata_only=False))
    assert len(convs) == 2
    assert all(isinstance(c, Conversation) for c in convs)

    # First conversation: 4 messages (2 user + 2 assistant)
    c1 = convs[0]
    assert c1.title == "Python async patterns"
    assert len(c1.messages) == 4
    assert c1.messages[0].author_role == AuthorRole.USER
    assert c1.messages[1].author_role == AuthorRole.ASSISTANT
    assert "gpt-4" in c1.model_slugs


def test_parse_conversations_metadata_only(sample_conversations):
    """Metadata-only parse returns ConversationMeta with counts."""
    metas = list(parse_conversations(sample_conversations, metadata_only=True))
    assert len(metas) == 2
    assert all(isinstance(m, ConversationMeta) for m in metas)

    m1 = metas[0]
    assert m1.title == "Python async patterns"
    assert m1.message_count == 4  # 2 user + 2 assistant
    assert "gpt-4" in m1.model_slugs


def test_message_ordering(sample_conversations):
    """Messages should be in chronological order (root to leaf)."""
    conv = parse_single_conversation(sample_conversations[0])
    assert conv.messages[0].content_parts[0].text == "How does async/await work in Python?"
    assert "async" in conv.messages[1].content_parts[0].text.lower()
    assert conv.messages[2].content_parts[0].text == "Can you show me error handling?"
    assert "try/except" in conv.messages[3].content_parts[0].text


def test_empty_conversation():
    """Conversations with no mapping should produce no messages."""
    raw = {"id": "empty", "title": "Empty", "mapping": {}, "create_time": None, "update_time": None}
    conv = parse_single_conversation(raw)
    assert len(conv.messages) == 0


def test_system_messages_filtered():
    """System messages should be filtered out by default."""
    raw = {
        "id": "sys-test",
        "title": "System Test",
        "create_time": None,
        "update_time": None,
        "mapping": {
            "root": {"id": "root", "message": None, "parent": None, "children": ["sys"]},
            "sys": {
                "id": "sys",
                "message": {
                    "id": "sys",
                    "author": {"role": "system"},
                    "content": {"content_type": "text", "parts": ["You are a helpful assistant"]},
                    "create_time": None,
                    "metadata": {},
                },
                "parent": "root",
                "children": ["user"],
            },
            "user": {
                "id": "user",
                "message": {
                    "id": "user",
                    "author": {"role": "user"},
                    "content": {"content_type": "text", "parts": ["Hello"]},
                    "create_time": None,
                    "metadata": {},
                },
                "parent": "sys",
                "children": [],
            },
        },
    }
    conv = parse_single_conversation(raw)
    assert len(conv.messages) == 1
    assert conv.messages[0].author_role == AuthorRole.USER
