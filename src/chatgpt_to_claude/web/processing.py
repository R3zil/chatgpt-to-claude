"""In-memory processing pipeline for web uploads."""

from __future__ import annotations

import io
import time
import uuid
import zipfile
from typing import Optional

from ..core.extractor import extract_conversations
from ..core.markdown_writer import conversation_to_markdown, generate_index
from ..core.models import OrganizeMode
from ..core.organizer import deduplicate_path, resolve_output_path, sanitize_filename
from ..core.parser import parse_conversations, parse_single_conversation
from ..core.splitter import maybe_split
from ..core.statistics import ExportStatistics, compute_statistics, statistics_to_dict


class ConversionSession:
    """Holds state for an in-progress conversion.

    All data stays in memory — nothing touches disk.
    """

    def __init__(self, file_data: bytes):
        self.session_id = str(uuid.uuid4())
        self.created_at = time.time()

        # Parse the raw data from the uploaded ZIP
        self.raw_data: list[dict] = extract_conversations(io.BytesIO(file_data))

        # Extract metadata (fast pass)
        self.metadata = list(parse_conversations(self.raw_data, metadata_only=True))
        self.statistics = compute_statistics(self.metadata)
        self.result_zip: Optional[io.BytesIO] = None

    def get_metadata_dicts(self) -> list[dict]:
        """Return metadata as JSON-serializable dicts."""
        result = []
        for meta in self.metadata:
            result.append({
                "id": meta.id,
                "title": meta.title,
                "created_at": meta.created_at.isoformat() if meta.created_at else None,
                "updated_at": meta.updated_at.isoformat() if meta.updated_at else None,
                "message_count": meta.message_count,
                "model_slugs": sorted(meta.model_slugs),
            })
        return result

    def get_statistics_dict(self) -> dict:
        return statistics_to_dict(self.statistics)

    def preview_conversation(self, conversation_id: str) -> Optional[str]:
        """Full parse and Markdown render of a single conversation."""
        for raw in self.raw_data:
            if raw.get("id") == conversation_id:
                conv = parse_single_conversation(raw)
                return conversation_to_markdown(conv)
        return None

    def convert_selected(
        self,
        conversation_ids: list[str] | None = None,
        organize: str = "monthly",
        include_frontmatter: bool = True,
    ) -> io.BytesIO:
        """Convert selected (or all) conversations and build an in-memory ZIP.

        Args:
            conversation_ids: IDs to include, or None for all.
            organize: Organization mode (flat, monthly, yearly).
            include_frontmatter: Whether to include YAML frontmatter.

        Returns:
            BytesIO containing the ZIP file ready for download.
        """
        organize_mode = OrganizeMode(organize)
        output_base = "claude_import"

        # Filter raw data to selected IDs
        if conversation_ids:
            id_set = set(conversation_ids)
            selected = [r for r in self.raw_data if r.get("id") in id_set]
        else:
            selected = self.raw_data

        # Parse and convert
        all_conversations = []
        used_paths: dict[str, int] = {}

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for conv in parse_conversations(selected, metadata_only=False):
                if not conv.messages:
                    continue

                parts = maybe_split(conv)
                for part in parts:
                    markdown = conversation_to_markdown(
                        part,
                        include_frontmatter=include_frontmatter,
                    )
                    from pathlib import PurePosixPath, Path

                    out_path = resolve_output_path(part, organize_mode, Path(output_base))
                    out_path = deduplicate_path(out_path, used_paths)
                    # Use forward slashes in ZIP
                    zip_path = str(PurePosixPath(out_path))
                    zf.writestr(zip_path, markdown)

                all_conversations.append(conv)

            # Add index
            index_md = generate_index(all_conversations, organize_mode)
            zf.writestr(f"{output_base}/_INDEX.md", index_md)

            # Add upload guide
            from ..cli.app import UPLOAD_GUIDE
            zf.writestr(f"{output_base}/_UPLOAD_GUIDE.md", UPLOAD_GUIDE)

        buf.seek(0)
        self.result_zip = buf
        return buf


# Simple in-memory session store
_sessions: dict[str, ConversionSession] = {}

MAX_SESSION_AGE = 3600  # 1 hour


def create_session(file_data: bytes) -> ConversionSession:
    """Create a new conversion session from uploaded file data."""
    _cleanup_expired()
    session = ConversionSession(file_data)
    _sessions[session.session_id] = session
    return session


def get_session(session_id: str) -> Optional[ConversionSession]:
    """Retrieve a session by ID."""
    session = _sessions.get(session_id)
    if session and (time.time() - session.created_at) > MAX_SESSION_AGE:
        del _sessions[session_id]
        return None
    return session


def _cleanup_expired():
    """Remove sessions older than MAX_SESSION_AGE."""
    now = time.time()
    expired = [
        sid for sid, s in _sessions.items()
        if (now - s.created_at) > MAX_SESSION_AGE
    ]
    for sid in expired:
        del _sessions[sid]
