/**
 * Markdown generation from parsed conversations.
 * Ported from Python: core/markdown_writer.py
 */

import { CONTENT_TYPES } from './content-handlers.js';

const ROLE_LABELS = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

/**
 * Convert a Conversation to a Markdown string.
 */
export function conversationToMarkdown(conversation, { includeFrontmatter = true, includeModelInfo = true } = {}) {
  if (!conversation.messages || !conversation.messages.length) return '';

  const sections = [];

  if (includeFrontmatter) {
    sections.push(renderFrontmatter(conversation));
  }

  sections.push(`# ${conversation.title}\n`);

  for (const msg of conversation.messages) {
    sections.push(renderMessage(msg, includeModelInfo));
  }

  return sections.join('\n');
}

/**
 * Generate YAML frontmatter (hand-rolled, no library needed).
 */
function renderFrontmatter(conversation) {
  const meta = {};
  meta.title = conversation.title;
  meta.source = 'chatgpt-export';

  if (conversation.createdAt) {
    meta.created = conversation.createdAt.toISOString();
  }
  if (conversation.updatedAt) {
    meta.updated = conversation.updatedAt.toISOString();
  }
  if (conversation.modelSlugs && conversation.modelSlugs.size > 0) {
    meta.models = [...conversation.modelSlugs].sort();
  }
  meta.message_count = conversation.messages.length;

  const yaml = toYaml(meta);
  return `---\n${yaml}\n---\n`;
}

/**
 * Minimal YAML serializer for simple frontmatter.
 */
function toYaml(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`- ${item}`);
      }
    } else if (typeof value === 'string' && (value.includes(':') || value.includes("'"))) {
      lines.push(`${key}: '${value.replace(/'/g, "''")}'`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

function renderMessage(message, includeModel) {
  const roleLabel = ROLE_LABELS[message.authorRole] || message.authorRole;

  let header;
  if (includeModel && message.authorRole === 'assistant' && message.modelSlug) {
    header = `## ${roleLabel} (${message.modelSlug})`;
  } else {
    header = `## ${roleLabel}`;
  }

  const contentLines = [];
  for (const part of message.contentParts) {
    const rendered = renderContentPart(part);
    if (rendered) contentLines.push(rendered);
  }

  const content = contentLines.join('\n\n');
  return `${header}\n\n${content}\n`;
}

function renderContentPart(part) {
  switch (part.contentType) {
    case CONTENT_TYPES.TEXT:
      return part.text || '';
    case CONTENT_TYPES.CODE: {
      const lang = part.language || '';
      return `\`\`\`${lang}\n${part.text || ''}\n\`\`\``;
    }
    case CONTENT_TYPES.EXECUTION_OUTPUT:
      return `\`\`\`\n[Output]\n${part.text || ''}\n\`\`\``;
    case CONTENT_TYPES.BROWSING_DISPLAY:
      return `> [Web Browsing Result]\n> ${part.text || ''}`;
    case CONTENT_TYPES.BROWSING_QUOTE: {
      const lines = [];
      if (part.title) {
        lines.push(part.url ? `> **[${part.title}](${encodeURI(part.url)})**` : `> **${part.title}**`);
      }
      if (part.text) lines.push(`> ${part.text}`);
      return lines.join('\n');
    }
    default:
      return part.text || '';
  }
}

/**
 * Generate an INDEX.md table of contents.
 */
export function generateIndex(conversations) {
  const lines = [
    '# ChatGPT Export -- Conversation Index',
    '',
    'Converted for use with Claude Projects.',
    '',
    `**Total conversations**: ${conversations.length}`,
    '',
    '---',
    '',
  ];

  const sorted = [...conversations].sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.getTime() : 0;
    const tb = b.createdAt ? b.createdAt.getTime() : 0;
    return tb - ta;
  });

  let currentMonth = null;
  for (const conv of sorted) {
    if (!conv.messages || !conv.messages.length) continue;

    let monthLabel, dateStr;
    if (conv.createdAt) {
      monthLabel = conv.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      dateStr = conv.createdAt.toISOString().slice(0, 10);
    } else {
      monthLabel = 'Unknown Date';
      dateStr = '?';
    }

    if (monthLabel !== currentMonth) {
      currentMonth = monthLabel;
      lines.push(`### ${monthLabel}`, '');
    }

    const msgCount = conv.messages.length;
    const models = conv.modelSlugs && conv.modelSlugs.size > 0
      ? ` | ${[...conv.modelSlugs].sort().join(', ')}`
      : '';

    lines.push(`- **${conv.title}** -- ${dateStr}, ${msgCount} messages${models}`);
  }

  lines.push('');
  return lines.join('\n');
}
