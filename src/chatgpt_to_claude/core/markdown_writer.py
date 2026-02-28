"""Markdown generation from parsed conversations."""

from __future__ import annotations

import yaml

from .models import (
    ContentPart,
    ContentType,
    Conversation,
    Message,
    OrganizeMode,
)


ROLE_LABELS = {
    "user": "User",
    "assistant": "Assistant",
    "system": "System",
    "tool": "Tool",
}


def conversation_to_markdown(
    conversation: Conversation,
    include_frontmatter: bool = True,
    include_model_info: bool = True,
) -> str:
    """Convert a Conversation to a complete Markdown string.

    Args:
        conversation: The parsed conversation.
        include_frontmatter: Whether to add YAML frontmatter.
        include_model_info: Whether to show model name per assistant message.

    Returns:
        A complete Markdown document as a string.
    """
    if not conversation.messages:
        return ""

    sections = []

    if include_frontmatter:
        sections.append(_render_frontmatter(conversation))

    sections.append(f"# {conversation.title}\n")

    for msg in conversation.messages:
        sections.append(_render_message(msg, include_model_info))

    return "\n".join(sections)


def _render_frontmatter(conversation: Conversation) -> str:
    """Generate YAML frontmatter block."""
    meta = {"title": conversation.title, "source": "chatgpt-export"}

    if conversation.created_at:
        meta["created"] = conversation.created_at.isoformat()
    if conversation.updated_at:
        meta["updated"] = conversation.updated_at.isoformat()
    if conversation.model_slugs:
        meta["models"] = sorted(conversation.model_slugs)

    meta["message_count"] = len(conversation.messages)

    frontmatter = yaml.dump(meta, default_flow_style=False, allow_unicode=True).strip()
    return f"---\n{frontmatter}\n---\n"


def _render_message(message: Message, include_model: bool) -> str:
    """Render a single message as Markdown."""
    role_label = ROLE_LABELS.get(message.author_role.value, message.author_role.value.title())

    # Add model info for assistant messages
    if include_model and message.author_role.value == "assistant" and message.model_slug:
        header = f"## {role_label} ({message.model_slug})"
    else:
        header = f"## {role_label}"

    content_lines = []
    for part in message.content_parts:
        rendered = _render_content_part(part)
        if rendered:
            content_lines.append(rendered)

    content = "\n\n".join(content_lines)
    return f"{header}\n\n{content}\n"


def _render_content_part(part: ContentPart) -> str:
    """Render a ContentPart to Markdown."""
    if part.content_type == ContentType.TEXT:
        return part.text or ""

    if part.content_type == ContentType.CODE:
        lang = part.language or ""
        return f"```{lang}\n{part.text or ''}\n```"

    if part.content_type == ContentType.EXECUTION_OUTPUT:
        return f"```\n[Output]\n{part.text or ''}\n```"

    if part.content_type == ContentType.BROWSING_DISPLAY:
        return f"> [Web Browsing Result]\n> {part.text or ''}"

    if part.content_type == ContentType.BROWSING_QUOTE:
        lines = []
        if part.title:
            if part.url:
                lines.append(f"> **[{part.title}]({part.url})**")
            else:
                lines.append(f"> **{part.title}**")
        if part.text:
            lines.append(f"> {part.text}")
        return "\n".join(lines)

    if part.content_type == ContentType.UNKNOWN:
        return part.text or ""

    return part.text or ""


def generate_index(
    conversations: list[Conversation],
    organize_mode: OrganizeMode,
) -> str:
    """Generate an INDEX.md with a table of contents."""
    from .organizer import resolve_output_path

    lines = [
        "# ChatGPT Export — Conversation Index",
        "",
        "Converted for use with Claude Projects.",
        "",
        f"**Total conversations**: {len(conversations)}",
        "",
        "---",
        "",
    ]

    # Sort by date (newest first)
    sorted_convs = sorted(
        conversations,
        key=lambda c: c.created_at or _MIN_DT,
        reverse=True,
    )

    current_month = None
    for conv in sorted_convs:
        if not conv.messages:
            continue

        if conv.created_at:
            month_label = conv.created_at.strftime("%B %Y")
            date_str = conv.created_at.strftime("%Y-%m-%d")
        else:
            month_label = "Unknown Date"
            date_str = "?"

        if month_label != current_month:
            current_month = month_label
            lines.append(f"### {month_label}")
            lines.append("")

        msg_count = len(conv.messages)
        models = ", ".join(sorted(conv.model_slugs)) if conv.model_slugs else ""
        model_info = f" | {models}" if models else ""

        lines.append(f"- **{conv.title}** — {date_str}, {msg_count} messages{model_info}")

    lines.append("")
    return "\n".join(lines)


# Sentinel for sorting conversations without dates
from datetime import datetime, timezone

_MIN_DT = datetime.min.replace(tzinfo=timezone.utc)
