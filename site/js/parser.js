/**
 * ChatGPT conversation tree traversal and parsing.
 * Ported from Python: core/parser.py
 */

import { renderContent } from './content-handlers.js';

const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

/**
 * Parse raw conversation data into structured objects.
 * @param {Array} rawData - The parsed conversations.json array.
 * @param {Object} options
 * @param {boolean} options.metadataOnly - If true, return lightweight metadata only.
 * @returns {Array} Array of Conversation or ConversationMeta objects.
 */
export function parseConversations(rawData, { metadataOnly = false } = {}) {
  const results = [];
  for (const rawConv of rawData) {
    const convId = rawConv.id || '';
    const title = rawConv.title || 'Untitled';
    const createdAt = parseTimestamp(rawConv.create_time);
    const updatedAt = parseTimestamp(rawConv.update_time);
    const mapping = rawConv.mapping || {};

    if (metadataOnly) {
      results.push({
        id: convId,
        title,
        createdAt,
        updatedAt,
        messageCount: countMessages(mapping),
        modelSlugs: extractModelSlugs(mapping),
      });
    } else {
      const messages = traverseAndParse(mapping);
      const modelSlugs = new Set(messages.filter(m => m.modelSlug).map(m => m.modelSlug));
      results.push({
        id: convId,
        title,
        createdAt,
        updatedAt,
        messages,
        modelSlugs,
      });
    }
  }
  return results;
}

/**
 * Parse a single raw conversation.
 */
export function parseSingleConversation(rawConv) {
  return parseConversations([rawConv], { metadataOnly: false })[0];
}

function traverseAndParse(mapping) {
  if (!mapping || !Object.keys(mapping).length) return [];
  const rawMessages = traverseTree(mapping);
  return rawMessages.map(parseMessage).filter(Boolean);
}

/**
 * Core tree traversal algorithm.
 * 1. Find root (node with no parent)
 * 2. Walk forward taking last child to find deepest leaf
 * 3. Walk backward from leaf via parent pointers
 * 4. Reverse for chronological order
 */
function traverseTree(mapping) {
  if (!mapping || !Object.keys(mapping).length) return [];

  // Find root
  let rootId = null;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.parent == null) {
      rootId = nodeId;
      break;
    }
  }
  if (rootId === null) return [];

  // Walk forward to find leaf
  let leafId = rootId;
  while (true) {
    const node = mapping[leafId];
    if (!node) break;
    const children = node.children || [];
    if (!children.length) break;
    leafId = children[children.length - 1];
  }

  // Walk backward from leaf to root
  const messages = [];
  let currentId = leafId;
  while (currentId != null) {
    const node = mapping[currentId];
    if (!node) break;

    const msg = node.message;
    if (msg != null) {
      const author = msg.author || {};
      const role = author.role || '';
      const content = msg.content;

      // Skip system messages (unless user-created)
      const isUserSystem = (msg.metadata || {}).is_user_system_message || false;
      if (role === 'system' && !isUserSystem) {
        currentId = node.parent;
        continue;
      }

      // Skip tool messages
      if (role === 'tool') {
        currentId = node.parent;
        continue;
      }

      // Skip messages with no content
      if (!content || !content.parts) {
        currentId = node.parent;
        continue;
      }

      // Skip empty text parts
      const parts = content.parts || [];
      const hasContent = parts.some(p =>
        (typeof p === 'string' && p.trim()) || (typeof p === 'object' && p !== null)
      );
      if (!hasContent && content.content_type === 'text') {
        currentId = node.parent;
        continue;
      }

      messages.push(msg);
    }

    currentId = node.parent;
  }

  messages.reverse();
  return messages;
}

function parseMessage(raw) {
  const msgId = raw.id || '';
  const author = raw.author || {};
  const roleStr = author.role || 'user';
  const authorRole = VALID_ROLES.has(roleStr) ? roleStr : 'user';

  const content = raw.content || {};
  const contentParts = renderContent(content);

  const createdAt = parseTimestamp(raw.create_time);
  const metadata = raw.metadata || {};
  const modelSlug = metadata.model_slug || metadata.model || null;

  return { id: msgId, authorRole, contentParts, createdAt, modelSlug };
}

function countMessages(mapping) {
  let count = 0;
  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;
    const role = (msg.author || {}).role || '';
    if (role === 'user' || role === 'assistant') count++;
  }
  return count;
}

function extractModelSlugs(mapping) {
  const slugs = new Set();
  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;
    const metadata = msg.metadata || {};
    const slug = metadata.model_slug || metadata.model;
    if (slug) slugs.add(slug);
  }
  return slugs;
}

export function parseTimestamp(ts) {
  if (ts == null) return null;
  try {
    return new Date(Number(ts) * 1000);
  } catch {
    return null;
  }
}
