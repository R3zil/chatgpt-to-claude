"""Data models shared across CLI and web layers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class AuthorRole(Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class ContentType(Enum):
    TEXT = "text"
    CODE = "code"
    EXECUTION_OUTPUT = "execution_output"
    BROWSING_DISPLAY = "tether_browsing_display"
    BROWSING_QUOTE = "tether_quote"
    MULTIMODAL_TEXT = "multimodal_text"
    UNKNOWN = "unknown"


class OrganizeMode(Enum):
    FLAT = "flat"
    MONTHLY = "monthly"
    YEARLY = "yearly"


@dataclass
class ContentPart:
    """A single part of message content."""

    content_type: ContentType
    text: Optional[str] = None
    language: Optional[str] = None
    image_ref: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = None


@dataclass
class Message:
    id: str
    author_role: AuthorRole
    content_parts: list[ContentPart]
    created_at: Optional[datetime] = None
    model_slug: Optional[str] = None


@dataclass
class ConversationMeta:
    """Lightweight metadata for fast preview without full parse."""

    id: str
    title: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    message_count: int = 0
    model_slugs: set[str] = field(default_factory=set)


@dataclass
class Conversation:
    """Fully parsed conversation with ordered messages."""

    id: str
    title: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    messages: list[Message] = field(default_factory=list)
    model_slugs: set[str] = field(default_factory=set)


@dataclass
class ExportStatistics:
    total_conversations: int = 0
    total_messages: int = 0
    date_range: tuple[Optional[datetime], Optional[datetime]] = (None, None)
    models_used: dict[str, int] = field(default_factory=dict)
    messages_by_role: dict[str, int] = field(default_factory=dict)
    conversations_by_month: dict[str, int] = field(default_factory=dict)
