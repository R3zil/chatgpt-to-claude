"""Flask route handlers."""

from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request, send_file

from ..core.extractor import ExportFormatError
from .processing import create_session, get_session

web = Blueprint("web", __name__)


@web.route("/")
def index():
    """Landing page with drag-and-drop upload zone."""
    return render_template("index.html")


@web.route("/api/upload", methods=["POST"])
def upload():
    """Accept ZIP upload, parse metadata, return session info."""
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.lower().endswith(".zip"):
        return jsonify({"error": "Please upload a .zip file"}), 400

    try:
        file_data = file.read()
        session = create_session(file_data)
    except ExportFormatError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to process file: {e}"}), 500

    return jsonify({
        "session_id": session.session_id,
        "statistics": session.get_statistics_dict(),
        "conversations": session.get_metadata_dicts(),
    })


@web.route("/api/preview/<session_id>/<conversation_id>")
def preview_conversation(session_id: str, conversation_id: str):
    """Full parse and render of a single conversation for preview."""
    session = get_session(session_id)
    if not session:
        return jsonify({"error": "Session expired or not found"}), 404

    markdown = session.preview_conversation(conversation_id)
    if markdown is None:
        return jsonify({"error": "Conversation not found"}), 404

    return jsonify({"markdown": markdown})


@web.route("/api/convert", methods=["POST"])
def convert():
    """Convert selected conversations and return download info."""
    data = request.get_json()
    if not data or "session_id" not in data:
        return jsonify({"error": "Missing session_id"}), 400

    session = get_session(data["session_id"])
    if not session:
        return jsonify({"error": "Session expired or not found"}), 404

    conversation_ids = data.get("conversation_ids")  # None = all
    organize = data.get("organize", "monthly")
    include_frontmatter = data.get("include_frontmatter", True)

    try:
        session.convert_selected(
            conversation_ids=conversation_ids,
            organize=organize,
            include_frontmatter=include_frontmatter,
        )
    except Exception as e:
        return jsonify({"error": f"Conversion failed: {e}"}), 500

    return jsonify({"ready": True, "session_id": data["session_id"]})


@web.route("/api/download/<session_id>")
def download(session_id: str):
    """Stream the generated ZIP file to the browser."""
    session = get_session(session_id)
    if not session or not session.result_zip:
        return jsonify({"error": "No conversion result found"}), 404

    session.result_zip.seek(0)
    return send_file(
        session.result_zip,
        mimetype="application/zip",
        as_attachment=True,
        download_name="chatgpt_to_claude_export.zip",
    )
