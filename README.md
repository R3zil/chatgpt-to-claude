# ChatGPT -> Claude

Switch from ChatGPT to Claude without starting from scratch. Transfer your conversations, context, and preferences — not just files, your AI identity.

## Two Ways to Use

### Web App (Recommended)

Visit the **[live site](https://r3zil.github.io/chatgpt-to-claude/)** — no install needed. Everything runs in your browser.

### Python CLI

```bash
pip install -e .
chatgpt-to-claude convert export.zip -o ./output
```

## What You Get

| Output | Description |
|--------|-------------|
| `_CLAUDE_PROFILE.md` | A synthesized profile capturing your role, expertise, communication style, and interests. Paste this into Claude's Project Instructions. |
| `_KNOWLEDGE_BASE/` | Conversations grouped by topic with extracted insights: "Your Python Projects", "Your Cooking Recipes", etc. |
| `_CONVERSATIONS/` | Full transcripts organized by month with YAML frontmatter. |
| `_MEMORIES.md` | Your ChatGPT memories converted to Claude format (if provided). |
| `_INDEX.md` | Table of contents for everything. |
| `_UPLOAD_GUIDE.md` | Step-by-step Claude upload instructions. |

## How It Works

1. **Export from ChatGPT**: Settings -> Data Controls -> Export Data. You'll get a ZIP via email.
2. **Drop it on the site**: We analyze your conversations client-side — your data never leaves your browser.
3. **Upload to Claude**: Download the migration package and upload to a Claude Project.

### What Makes This Different

Most migration tools just convert files. This tool produces:

- **User Profile** — Detects your role, technical expertise, communication style, and recurring interests via regex heuristics and TF-IDF analysis.
- **Knowledge Base** — Topics clustered via Jaccard similarity on TF-IDF keyword vectors, then summarized with key insights per cluster.
- **Clean Conversations** — Faithful tree traversal of ChatGPT's branching conversation format, handling all content types (code, browsing, images, execution output).
- **Optional AI Enhancement** — BYOK (Bring Your Own Key) for deeper analysis using Claude or OpenAI APIs.

## Features

- Handles all ChatGPT content types (text, code, browsing, images, execution output)
- Topic clustering via TF-IDF + Jaccard similarity (no ML library needed)
- User profile extraction (role, expertise, communication style, writing patterns)
- ChatGPT memories and custom instructions conversion
- Web Worker for non-blocking parsing of large exports
- Organizes output by month, year, or flat
- YAML frontmatter for Claude Project search
- Splits large conversations to stay within Claude's file limits
- **Privacy-first**: everything runs locally, data never leaves your machine
- No build tools, no npm — pure ES modules

## CLI Usage

```bash
# Install
pip install -e .

# Convert with monthly organization (default)
chatgpt-to-claude convert export.zip -o ./output

# Just see statistics
chatgpt-to-claude stats export.zip

# Flat organization, no frontmatter
chatgpt-to-claude convert export.zip -o ./output --organize flat --no-frontmatter

# Launch local web UI
chatgpt-to-claude serve
```

## Architecture

```
chatgpt-to-claude/
  src/                    # Python package (PyPI/CLI)
  site/                   # Static site (GitHub Pages)
    index.html            # Single-page app
    style.css             # Dark theme
    js/
      app.js              # Main orchestrator + UI state machine
      extractor.js        # ZIP reading (JSZip)
      parser.js           # Tree traversal (ported from Python)
      content-handlers.js # Content type dispatch
      markdown-writer.js  # Markdown + YAML generation
      organizer.js        # Filename sanitization
      splitter.js         # Large conversation splitting
      statistics.js       # Aggregate stats
      synthesis/
        topic-clusterer.js      # TF-IDF + Jaccard clustering
        profile-builder.js      # User profile heuristics
        knowledge-summarizer.js # Topical knowledge summaries
        memory-converter.js     # ChatGPT memories conversion
      byok/
        api-client.js           # BYOK Claude/OpenAI API calls
        llm-synthesizer.js      # LLM-powered deep synthesis
      workers/
        parse-worker.js         # Web Worker for non-blocking parsing
```

## Development

```bash
pip install -e ".[dev]"
pytest
```

## Privacy

- The web app runs entirely in your browser. No server, no analytics, no tracking.
- Your ChatGPT export data is processed locally and never transmitted anywhere.
- BYOK API calls go directly from your browser to the API provider — we never see your key.
- Open source. Verify it yourself.

## License

MIT
