"""ZIP extraction and conversations.json discovery."""

from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path
from typing import BinaryIO, Union


class ExportFormatError(Exception):
    """Raised when the export file is missing or malformed."""


def extract_conversations(source: Union[str, Path, BinaryIO]) -> list[dict]:
    """Load conversations.json from a ZIP file, BytesIO, or extracted directory.

    Args:
        source: Path to a ZIP file, path to an extracted directory,
                or a BytesIO object containing the ZIP data.

    Returns:
        Parsed list of conversation dicts from conversations.json.

    Raises:
        ExportFormatError: If conversations.json is missing or malformed.
    """
    if isinstance(source, (str, Path)):
        path = Path(source)
        if path.is_file() and path.suffix == ".zip":
            return _load_from_zip_path(path)
        elif path.is_dir():
            return _load_from_directory(path)
        else:
            raise ExportFormatError(
                f"'{source}' is not a ZIP file or directory. "
                "Please provide a ChatGPT data export ZIP or its extracted folder."
            )
    elif isinstance(source, (BytesIO, BinaryIO)) or hasattr(source, "read"):
        return _load_from_file_object(source)
    else:
        raise ExportFormatError(f"Unsupported source type: {type(source)}")


def _load_from_zip_path(zip_path: Path) -> list[dict]:
    with zipfile.ZipFile(zip_path, "r") as zf:
        return _find_and_parse_conversations(zf)


def _load_from_file_object(file_obj: BinaryIO) -> list[dict]:
    with zipfile.ZipFile(file_obj, "r") as zf:
        return _find_and_parse_conversations(zf)


def _find_and_parse_conversations(zf: zipfile.ZipFile) -> list[dict]:
    """Locate conversations.json inside a ZipFile and parse it."""
    candidates = [n for n in zf.namelist() if n.endswith("conversations.json")]
    if not candidates:
        raise ExportFormatError(
            "No 'conversations.json' found in the ZIP. "
            "Make sure this is a ChatGPT data export "
            "(Settings → Data Controls → Export Data)."
        )
    # Prefer the shortest path (closest to root)
    target = min(candidates, key=len)
    try:
        with zf.open(target) as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ExportFormatError(f"Failed to parse conversations.json: {e}") from e


def _load_from_directory(dir_path: Path) -> list[dict]:
    """Load conversations.json from an extracted export directory."""
    conv_file = dir_path / "conversations.json"

    # Check one level deep if not at root
    if not conv_file.exists():
        for child in dir_path.iterdir():
            if child.is_dir():
                candidate = child / "conversations.json"
                if candidate.exists():
                    conv_file = candidate
                    break

    if not conv_file.exists():
        raise ExportFormatError(
            f"No 'conversations.json' found in '{dir_path}'. "
            "Make sure this is an extracted ChatGPT data export."
        )

    try:
        with open(conv_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ExportFormatError(f"Failed to parse conversations.json: {e}") from e
