/**
 * Split large conversations at message boundaries.
 * Ported from Python: core/splitter.py
 */

import { conversationToMarkdown } from './markdown-writer.js';

const DEFAULT_MAX_SIZE = 90_000;
const OVERHEAD_PER_MSG = 50;

/**
 * Split a conversation if its Markdown exceeds maxSize characters.
 */
export function maybeSplit(conversation, maxSize = DEFAULT_MAX_SIZE) {
  const markdown = conversationToMarkdown(conversation);
  if (markdown.length <= maxSize) return [conversation];
  return splitAtMessages(conversation, maxSize);
}

function splitAtMessages(conversation, maxSize) {
  const messages = conversation.messages;
  if (!messages || !messages.length) return [conversation];

  const parts = [];
  let currentMessages = [];
  let currentSize = 0;
  let partNum = 1;

  for (const msg of messages) {
    const msgSize = msg.contentParts.reduce((sum, p) => sum + (p.text || '').length, 0) + OVERHEAD_PER_MSG;

    if (currentSize + msgSize > maxSize && currentMessages.length) {
      parts.push(makePart(conversation, currentMessages, partNum));
      partNum++;
      currentMessages = [];
      currentSize = 0;
    }

    currentMessages.push(msg);
    currentSize += msgSize;
  }

  if (currentMessages.length) {
    parts.push(makePart(conversation, currentMessages, partNum));
  }

  if (parts.length === 1) return [conversation];
  return parts;
}

function makePart(original, messages, partNum) {
  const modelSlugs = new Set(messages.filter(m => m.modelSlug).map(m => m.modelSlug));
  return {
    id: `${original.id}_part${partNum}`,
    title: `${original.title} (Part ${partNum})`,
    createdAt: original.createdAt,
    updatedAt: original.updatedAt,
    messages,
    modelSlugs,
  };
}

export { DEFAULT_MAX_SIZE };
