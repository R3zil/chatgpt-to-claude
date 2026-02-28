"""CLI entry point using Click + Rich."""

from __future__ import annotations

from pathlib import Path

import click
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

from ..core.extractor import ExportFormatError, extract_conversations
from ..core.markdown_writer import conversation_to_markdown, generate_index
from ..core.models import OrganizeMode
from ..core.organizer import deduplicate_path, resolve_output_path
from ..core.parser import parse_conversations
from ..core.splitter import DEFAULT_MAX_SIZE, maybe_split
from ..core.statistics import compute_statistics
from .display import print_statistics, print_summary

console = Console()

UPLOAD_GUIDE = """\
# How to Upload to Claude

## Option 1: Claude Project Knowledge Base (Recommended)

1. Go to [claude.ai](https://claude.ai)
2. Create a new **Project** (or open an existing one)
3. Click **"Add content"** in the project knowledge section
4. Select **"Upload files"**
5. Select the `.md` files from this export
6. Claude will now have access to your ChatGPT conversation history

**Note**: Claude Projects have a knowledge base limit. If your export is very
large, upload the most important conversations first, or use the `--summary-only`
flag to generate condensed versions.

## Option 2: Direct Chat Upload

1. Start a new conversation on [claude.ai](https://claude.ai)
2. Use the paperclip icon to attach specific `.md` files
3. Ask Claude questions about the content

## Option 3: Claude Code (CLI)

1. Place the files in your project directory
2. Claude Code will automatically see them as part of your codebase

## Tips

- The `_INDEX.md` file is a great starting point — upload it first so Claude
  can see an overview of all your conversations
- For very large exports, consider uploading by topic or time period
- Use the monthly/yearly organization to batch uploads logically
"""


@click.group()
@click.version_option(package_name="chatgpt-to-claude")
def cli():
    """ChatGPT to Claude -- Convert your ChatGPT exports to clean Markdown."""


@cli.command()
@click.argument("source", type=click.Path(exists=True))
@click.option(
    "--output", "-o",
    type=click.Path(),
    default="./output",
    help="Output directory for converted files.",
)
@click.option(
    "--organize",
    type=click.Choice(["flat", "monthly", "yearly"]),
    default="monthly",
    help="How to organize output files.",
)
@click.option(
    "--max-file-size",
    type=int,
    default=DEFAULT_MAX_SIZE,
    help="Max characters per file before splitting.",
)
@click.option(
    "--no-frontmatter",
    is_flag=True,
    help="Omit YAML frontmatter from output files.",
)
def convert(source: str, output: str, organize: str, max_file_size: int, no_frontmatter: bool):
    """Convert a ChatGPT export to Claude-ready Markdown files."""
    output_dir = Path(output)
    organize_mode = OrganizeMode(organize)

    console.print("\n[bold blue]ChatGPT -> Claude Migration Tool[/]\n")

    # Load
    try:
        console.print(f"Loading export from: [cyan]{source}[/]")
        raw_data = extract_conversations(source)
        console.print(f"Found [bold]{len(raw_data)}[/] conversations\n")
    except ExportFormatError as e:
        console.print(f"[red]Error:[/] {e}")
        raise SystemExit(1)

    # Parse and convert
    all_conversations = []
    used_paths: dict[str, int] = {}

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Converting conversations...", total=len(raw_data))

        for conv in parse_conversations(raw_data, metadata_only=False):
            if not conv.messages:
                progress.advance(task)
                continue

            # Split if too large
            parts = maybe_split(conv, max_file_size)

            for part in parts:
                markdown = conversation_to_markdown(
                    part,
                    include_frontmatter=not no_frontmatter,
                )

                out_path = resolve_output_path(part, organize_mode, output_dir)
                out_path = deduplicate_path(out_path, used_paths)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(markdown, encoding="utf-8")

            all_conversations.append(conv)
            progress.advance(task)

    # Generate index and upload guide
    index_md = generate_index(all_conversations, organize_mode)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "_INDEX.md").write_text(index_md, encoding="utf-8")
    (output_dir / "_UPLOAD_GUIDE.md").write_text(UPLOAD_GUIDE, encoding="utf-8")

    # Stats
    stats = compute_statistics(all_conversations)
    console.print()
    print_statistics(stats, console)
    print_summary(output_dir, stats, console)


@cli.command()
@click.argument("source", type=click.Path(exists=True))
def stats(source: str):
    """Show statistics about a ChatGPT export without converting."""
    console.print("\n[bold blue]ChatGPT Export Statistics[/]\n")

    try:
        raw_data = extract_conversations(source)
    except ExportFormatError as e:
        console.print(f"[red]Error:[/] {e}")
        raise SystemExit(1)

    # Use metadata-only mode for speed
    metas = list(parse_conversations(raw_data, metadata_only=True))
    export_stats = compute_statistics(metas)
    print_statistics(export_stats, console)


@cli.command()
@click.option("--port", "-p", type=int, default=5000, help="Port for the web UI.")
@click.option("--host", "-h", default="127.0.0.1", help="Host to bind to.")
def serve(port: int, host: str):
    """Launch the web UI for browser-based conversion."""
    from ..web.app import create_app

    console.print("\n[bold blue]ChatGPT -> Claude Web UI[/]")
    console.print(f"Starting at [cyan]http://{host}:{port}[/]\n")
    console.print("[dim]Press Ctrl+C to stop[/]\n")

    app = create_app()
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    cli()
