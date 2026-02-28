"""Rich console formatting helpers for the CLI."""

from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..core.models import ExportStatistics


def print_statistics(stats: ExportStatistics, console: Console) -> None:
    """Display export statistics as a Rich table."""
    table = Table(title="Export Statistics", show_header=False, border_style="blue")
    table.add_column("Metric", style="bold")
    table.add_column("Value")

    table.add_row("Conversations", str(stats.total_conversations))
    table.add_row("Total messages", f"{stats.total_messages:,}")

    if stats.date_range[0] and stats.date_range[1]:
        start = stats.date_range[0].strftime("%Y-%m-%d")
        end = stats.date_range[1].strftime("%Y-%m-%d")
        table.add_row("Date range", f"{start}  ->  {end}")

    if stats.models_used:
        models_str = ", ".join(
            f"{model} ({count:,})" for model, count in sorted(stats.models_used.items())
        )
        table.add_row("Models used", models_str)

    if stats.messages_by_role:
        roles_str = ", ".join(
            f"{role}: {count:,}" for role, count in sorted(stats.messages_by_role.items())
        )
        table.add_row("Messages by role", roles_str)

    console.print(table)
    console.print()


def print_summary(output_dir: Path, stats: ExportStatistics, console: Console) -> None:
    """Display final conversion summary."""
    lines = [
        f"[bold green]Output directory:[/] {output_dir.resolve()}",
        f"[bold green]Conversations converted:[/] {stats.total_conversations}",
        f"[bold green]Total messages:[/] {stats.total_messages:,}",
    ]

    if stats.date_range[0] and stats.date_range[1]:
        start = stats.date_range[0].strftime("%Y-%m-%d")
        end = stats.date_range[1].strftime("%Y-%m-%d")
        lines.append(f"[bold green]Date range:[/] {start} -> {end}")

    lines.append("")
    lines.append("[bold]Next steps:[/]")
    lines.append(f"  1. See [cyan]{output_dir / '_UPLOAD_GUIDE.md'}[/] for Claude upload instructions")
    lines.append(f"  2. See [cyan]{output_dir / '_INDEX.md'}[/] for the conversation index")

    panel = Panel(
        "\n".join(lines),
        title="[bold]Migration Complete[/]",
        border_style="green",
    )
    console.print(panel)
