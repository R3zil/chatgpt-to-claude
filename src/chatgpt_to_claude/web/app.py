"""Flask application factory."""

from __future__ import annotations

import os

from flask import Flask


def create_app(config: dict | None = None) -> Flask:
    """Create and configure the Flask application.

    Args:
        config: Optional config overrides.

    Returns:
        Configured Flask app.
    """
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )

    # Defaults
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200MB
    app.config["SECRET_KEY"] = os.urandom(24).hex()

    if config:
        app.config.update(config)

    # Register routes
    from .routes import web
    app.register_blueprint(web)

    return app
