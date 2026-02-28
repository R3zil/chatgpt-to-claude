"""Split large conversations at message boundaries."""

from __future__ import annotations

from .markdown_writer import conversation_to_markdown
from .models import Conversation


DEFAULT_MAX_SIZE = 90_000  # chars (~100K is Claude Project per-file limit)


def maybe_split(
    conversation: Conversation,
    max_size: int = DEFAULT_MAX_SIZE,
) -> list[Conversation]:
    """Split a conversation if its Markdown exceeds max_size characters.

    Returns a list with either the original conversation (if within limits)
    or multiple Conversation objects with "(Part N)" title suffixes.
    """
    markdown = conversation_to_markdown(conversation)
    if len(markdown) <= max_size:
        return [conversation]

    return _split_at_messages(conversation, max_size)


def _split_at_messages(conversation: Conversation, max_size: int) -> list[Conversation]:
    """Split by distributing messages across parts."""
    messages = conversation.messages
    if not messages:
        return [conversation]

    parts = []
    current_messages = []
    current_size = 0
    part_num = 1

    # Rough overhead per message (header + spacing)
    OVERHEAD_PER_MSG = 50

    for msg in messages:
        # Estimate this message's size
        msg_size = sum(len(p.text or "") for p in msg.content_parts) + OVERHEAD_PER_MSG

        if current_size + msg_size > max_size and current_messages:
            # Flush current part
            parts.append(_make_part(conversation, current_messages, part_num))
            part_num += 1
            current_messages = []
            current_size = 0

        current_messages.append(msg)
        current_size += msg_size

    if current_messages:
        parts.append(_make_part(conversation, current_messages, part_num))

    # If we ended up with only 1 part, don't rename it
    if len(parts) == 1:
        return [conversation]

    return parts


def _make_part(
    original: Conversation,
    messages: list,
    part_num: int,
) -> Conversation:
    """Create a Conversation for one part of a split."""
    model_slugs = {m.model_slug for m in messages if m.model_slug}
    return Conversation(
        id=f"{original.id}_part{part_num}",
        title=f"{original.title} (Part {part_num})",
        created_at=original.created_at,
        updated_at=original.updated_at,
        messages=messages,
        model_slugs=model_slugs,
    )
