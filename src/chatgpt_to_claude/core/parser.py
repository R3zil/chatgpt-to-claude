"""ChatGPT conversation tree traversal and parsing."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterator, Union, overload

from .content_handlers import render_content
from .models import (
    AuthorRole,
    Conversation,
    ConversationMeta,
    Message,
)


@overload
def parse_conversations(raw_data: list[dict], metadata_only: bool = False) -> Iterator[Conversation]: ...

@overload
def parse_conversations(raw_data: list[dict], metadata_only: bool = True) -> Iterator[ConversationMeta]: ...

def parse_conversations(
    raw_data: list[dict],
    metadata_only: bool = False,
) -> Iterator[Union[ConversationMeta, Conversation]]:
    """Yield parsed conversations from raw JSON data.

    Args:
        raw_data: The parsed conversations.json list.
        metadata_only: If True, yield ConversationMeta (fast, for previews).
                       If False, yield full Conversation objects.

    Yields:
        ConversationMeta or Conversation objects.
    """
    for raw_conv in raw_data:
        conv_id = raw_conv.get("id", "")
        title = raw_conv.get("title") or "Untitled"
        created_at = _parse_timestamp(raw_conv.get("create_time"))
        updated_at = _parse_timestamp(raw_conv.get("update_time"))
        mapping = raw_conv.get("mapping", {})

        if metadata_only:
            msg_count = _count_messages(mapping)
            model_slugs = _extract_model_slugs(mapping)
            yield ConversationMeta(
                id=conv_id,
                title=title,
                created_at=created_at,
                updated_at=updated_at,
                message_count=msg_count,
                model_slugs=model_slugs,
            )
        else:
            messages = _traverse_and_parse(mapping)
            model_slugs = {m.model_slug for m in messages if m.model_slug}
            yield Conversation(
                id=conv_id,
                title=title,
                created_at=created_at,
                updated_at=updated_at,
                messages=messages,
                model_slugs=model_slugs,
            )


def parse_single_conversation(raw_conv: dict) -> Conversation:
    """Parse a single raw conversation dict into a Conversation object."""
    result = next(parse_conversations([raw_conv], metadata_only=False))
    assert isinstance(result, Conversation)
    return result


def _traverse_and_parse(mapping: dict) -> list[Message]:
    """Traverse the conversation tree and extract ordered messages.

    ChatGPT stores conversations as a tree (branching on edits).
    Strategy: find the leaf node (no children or the current_node),
    walk backward via parent pointers, then reverse for chronological order.
    """
    if not mapping:
        return []

    raw_messages = _traverse_tree(mapping)
    return [_parse_message(raw) for raw in raw_messages if raw is not None]


def _traverse_tree(mapping: dict) -> list[dict]:
    """Walk the tree from leaf to root, then reverse.

    Finds the deepest leaf by following last-child pointers from root,
    then walks backward from that leaf via parent pointers.
    """
    if not mapping:
        return []

    # Find root (node with no parent)
    root_id = None
    for node_id, node in mapping.items():
        if node.get("parent") is None:
            root_id = node_id
            break

    if root_id is None:
        return []

    # Walk forward from root, always taking the last child, to find the leaf
    leaf_id = root_id
    while True:
        node = mapping.get(leaf_id)
        if not node:
            break
        children = node.get("children", [])
        if not children:
            break
        leaf_id = children[-1]

    # Walk backward from leaf to root
    messages = []
    current_id = leaf_id
    while current_id is not None:
        node = mapping.get(current_id)
        if not node:
            break
        msg = node.get("message")
        if msg is not None:
            author = msg.get("author", {})
            role = author.get("role", "")
            content = msg.get("content")

            # Skip system messages (unless user-created)
            is_user_system = msg.get("metadata", {}).get("is_user_system_message", False)
            if role == "system" and not is_user_system:
                current_id = node.get("parent")
                continue

            # Skip tool results (internal) unless they have visible content
            if role == "tool":
                current_id = node.get("parent")
                continue

            # Skip messages with no content
            if not content or not content.get("parts"):
                current_id = node.get("parent")
                continue

            # Skip empty text parts
            parts = content.get("parts", [])
            has_content = any(
                (isinstance(p, str) and p.strip()) or isinstance(p, dict)
                for p in parts
            )
            if not has_content and content.get("content_type") == "text":
                current_id = node.get("parent")
                continue

            messages.append(msg)

        current_id = node.get("parent")

    messages.reverse()
    return messages


def _parse_message(raw: dict) -> Message:
    """Convert a raw message dict into a Message dataclass."""
    msg_id = raw.get("id", "")
    author = raw.get("author", {})
    role_str = author.get("role", "user")

    try:
        author_role = AuthorRole(role_str)
    except ValueError:
        author_role = AuthorRole.USER

    content = raw.get("content", {})
    content_parts = render_content(content)

    created_at = _parse_timestamp(raw.get("create_time"))

    metadata = raw.get("metadata", {})
    model_slug = metadata.get("model_slug") or metadata.get("model")

    return Message(
        id=msg_id,
        author_role=author_role,
        content_parts=content_parts,
        created_at=created_at,
        model_slug=model_slug,
    )


def _count_messages(mapping: dict) -> int:
    """Quick message count without full parsing."""
    count = 0
    for node in mapping.values():
        msg = node.get("message")
        if msg is None:
            continue
        role = msg.get("author", {}).get("role", "")
        if role in ("user", "assistant"):
            count += 1
    return count


def _extract_model_slugs(mapping: dict) -> set[str]:
    """Extract all model slugs from a conversation mapping."""
    slugs = set()
    for node in mapping.values():
        msg = node.get("message")
        if msg is None:
            continue
        metadata = msg.get("metadata", {})
        slug = metadata.get("model_slug") or metadata.get("model")
        if slug:
            slugs.add(slug)
    return slugs


def _parse_timestamp(ts: float | int | None) -> datetime | None:
    """Convert a Unix timestamp to a UTC datetime, or None."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None
