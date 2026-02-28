"""Output path resolution and filename sanitization."""

from __future__ import annotations

import re
from pathlib import Path

from .models import Conversation, OrganizeMode


def resolve_output_path(
    conversation: Conversation,
    mode: OrganizeMode,
    base_dir: Path,
) -> Path:
    """Determine the output file path for a conversation.

    Args:
        conversation: The conversation to generate a path for.
        mode: Organization mode (flat, monthly, yearly).
        base_dir: The root output directory.

    Returns:
        The full Path where the conversation Markdown should be written.
    """
    safe_name = sanitize_filename(conversation.title)

    if mode == OrganizeMode.FLAT:
        return base_dir / f"{safe_name}.md"

    if conversation.created_at:
        if mode == OrganizeMode.MONTHLY:
            subdir = conversation.created_at.strftime("%Y-%m")
        else:  # YEARLY
            subdir = conversation.created_at.strftime("%Y")
    else:
        subdir = "undated"

    return base_dir / subdir / f"{safe_name}.md"


def sanitize_filename(title: str, max_length: int = 100) -> str:
    """Create a safe filename from a conversation title.

    Removes filesystem-invalid characters, collapses whitespace,
    and truncates to max_length.
    """
    # Remove characters invalid on Windows/Linux/Mac
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title)
    # Collapse whitespace to underscores
    safe = re.sub(r"\s+", "_", safe.strip())
    # Remove any remaining non-word characters (keep letters, digits, underscore, hyphen, dot)
    safe = re.sub(r"[^\w\-.]", "", safe)
    # Strip leading/trailing dots and underscores
    safe = safe.strip("._")

    if not safe:
        safe = "untitled"

    return safe[:max_length]


def deduplicate_path(path: Path, used_paths: dict[str, int]) -> Path:
    """Append a numeric suffix if the path has already been used.

    Args:
        path: The desired output path.
        used_paths: A dict tracking path usage counts (mutated in-place).

    Returns:
        A unique path, possibly with a numeric suffix.
    """
    path_key = str(path).lower()  # Case-insensitive on Windows
    if path_key in used_paths:
        used_paths[path_key] += 1
        stem = path.stem
        suffix = path.suffix
        new_name = f"{stem}_{used_paths[path_key]}{suffix}"
        return path.with_name(new_name)
    else:
        used_paths[path_key] = 0
        return path
