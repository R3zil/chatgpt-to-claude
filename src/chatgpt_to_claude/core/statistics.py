"""Aggregate statistics computation for ChatGPT exports."""

from __future__ import annotations

from typing import Iterable, Union

from .models import Conversation, ConversationMeta, ExportStatistics


def compute_statistics(
    conversations: Iterable[Union[Conversation, ConversationMeta]],
) -> ExportStatistics:
    """Compute aggregate statistics in a single pass.

    Works with both full Conversation objects and lightweight ConversationMeta.
    """
    stats = ExportStatistics()
    earliest = None
    latest = None

    for conv in conversations:
        stats.total_conversations += 1

        # Message count
        if isinstance(conv, Conversation):
            msg_count = len(conv.messages)
            for msg in conv.messages:
                role_key = msg.author_role.value
                stats.messages_by_role[role_key] = stats.messages_by_role.get(role_key, 0) + 1
                if msg.model_slug:
                    stats.models_used[msg.model_slug] = (
                        stats.models_used.get(msg.model_slug, 0) + 1
                    )
        else:
            msg_count = conv.message_count
            for slug in conv.model_slugs:
                if slug not in stats.models_used:
                    stats.models_used[slug] = 0

        stats.total_messages += msg_count

        # Date tracking
        dt = conv.created_at
        if dt:
            month_key = dt.strftime("%Y-%m")
            stats.conversations_by_month[month_key] = (
                stats.conversations_by_month.get(month_key, 0) + 1
            )
            if earliest is None or dt < earliest:
                earliest = dt
            if latest is None or dt > latest:
                latest = dt

    stats.date_range = (earliest, latest)
    return stats


def statistics_to_dict(stats: ExportStatistics) -> dict:
    """Convert ExportStatistics to a JSON-serializable dict."""
    return {
        "total_conversations": stats.total_conversations,
        "total_messages": stats.total_messages,
        "date_range": {
            "start": stats.date_range[0].isoformat() if stats.date_range[0] else None,
            "end": stats.date_range[1].isoformat() if stats.date_range[1] else None,
        },
        "models_used": stats.models_used,
        "messages_by_role": stats.messages_by_role,
        "conversations_by_month": dict(sorted(stats.conversations_by_month.items())),
    }
