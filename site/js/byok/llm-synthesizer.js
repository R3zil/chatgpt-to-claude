/**
 * LLM-powered deep synthesis using the user's own API key.
 * Enhances the heuristic profile with AI-generated insights.
 */

import { sendMessage } from './api-client.js';

const PROFILE_SYSTEM_PROMPT = `You are analyzing a user's ChatGPT conversation history to create a profile for Claude Project Instructions.

Given a heuristic profile and conversation samples, produce an ENHANCED profile in Markdown. Focus on:
1. Correcting any inaccurate heuristic detections
2. Adding nuanced insights about the user's expertise level (beginner/intermediate/expert per technology)
3. Identifying communication preferences (e.g., "prefers code examples over explanations")
4. Noting recurring problem-solving approaches
5. Capturing domain-specific vocabulary the user expects Claude to understand

Output ONLY the Markdown profile, no meta-commentary. Use the same section structure as the input.`;

const KNOWLEDGE_SYSTEM_PROMPT = `You are synthesizing insights from a cluster of related conversations. Given a topic label and conversation excerpts, produce a concise knowledge summary in Markdown that captures:

1. Key concepts and terminology the user works with
2. Specific tools, libraries, or approaches they use
3. Problems they've encountered and solutions that worked
4. Patterns in how they approach this topic

Output ONLY the Markdown summary. Be concise but specific. Include concrete details, not generic observations.`;

/**
 * Enhance the heuristic profile using LLM analysis.
 * @param {Object} config - API config (provider, apiKey, model)
 * @param {string} heuristicProfile - The heuristic _CLAUDE_PROFILE.md content
 * @param {Array} conversations - Parsed conversations (we'll sample from these)
 * @param {Function} [onProgress] - Progress callback (0-100)
 * @returns {Promise<string>} Enhanced profile Markdown
 */
export async function enhanceProfile(config, heuristicProfile, conversations, onProgress) {
  const progress = onProgress || (() => {});
  progress(10);

  // Sample user messages for the LLM to analyze
  const samples = sampleConversations(conversations, 15);
  const samplesText = samples.map(s =>
    `### "${s.title}"\n${s.excerpts.join('\n')}`
  ).join('\n\n');

  progress(20);

  const userMessage = `## Heuristic Profile (auto-detected)
${heuristicProfile}

## Conversation Samples
${samplesText}

---
Please enhance this profile with deeper insights based on the conversation samples. Keep the same section structure.`;

  progress(30);

  const enhanced = await sendMessage(config, PROFILE_SYSTEM_PROMPT, userMessage);
  progress(100);

  return enhanced;
}

/**
 * Generate enhanced knowledge summaries for topic clusters.
 * @param {Object} config - API config
 * @param {Array} clusters - Topic clusters with conversations
 * @param {Function} [onProgress] - Progress callback (0-100)
 * @returns {Promise<Array<{title: string, filename: string, markdown: string}>>}
 */
export async function enhanceKnowledge(config, clusters, onProgress) {
  const progress = onProgress || (() => {});
  const results = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const pct = Math.round((i / clusters.length) * 100);
    progress(pct);

    const excerpts = sampleCluster(cluster, 10);
    const excerptsText = excerpts.map(e =>
      `### "${e.title}"\n${e.messages.join('\n')}`
    ).join('\n\n');

    const userMessage = `## Topic: ${cluster.label}
## ${cluster.conversations.length} conversations, keywords: ${(cluster.keywords || []).slice(0, 10).join(', ')}

## Conversation Excerpts
${excerptsText}

---
Produce a knowledge summary for this topic cluster.`;

    try {
      const markdown = await sendMessage(config, KNOWLEDGE_SYSTEM_PROMPT, userMessage);
      const filename = `topic_${sanitize(cluster.label.toLowerCase().replace(/^your\s+/i, ''))}.md`;
      results.push({ title: cluster.label, filename, markdown });
    } catch (err) {
      // Fallback: use the cluster label as a simple summary
      const filename = `topic_${sanitize(cluster.label.toLowerCase().replace(/^your\s+/i, ''))}.md`;
      results.push({
        title: cluster.label,
        filename,
        markdown: `# ${cluster.label}\n\n> AI enhancement failed for this cluster: ${err.message}\n`,
      });
    }
  }

  progress(100);
  return results;
}

/**
 * Sample conversations for LLM input (staying within token limits).
 */
function sampleConversations(conversations, maxConversations) {
  // Sort by message count (most substantive first)
  const sorted = [...conversations]
    .filter(c => c.messages && c.messages.length >= 3)
    .sort((a, b) => b.messages.length - a.messages.length);

  const sampled = sorted.slice(0, maxConversations);

  return sampled.map(conv => {
    const userMsgs = conv.messages
      .filter(m => m.authorRole === 'user')
      .map(m => m.contentParts.map(p => p.text || '').join(' '))
      .filter(t => t.trim());

    // Take first 3 user messages, truncated
    const excerpts = userMsgs.slice(0, 3).map(m => {
      const truncated = m.length > 300 ? m.slice(0, 300) + '...' : m;
      return `> ${truncated}`;
    });

    return { title: conv.title, excerpts };
  });
}

/**
 * Sample conversations from a cluster for knowledge synthesis.
 */
function sampleCluster(cluster, maxConversations) {
  const sorted = [...cluster.conversations]
    .filter(c => c.messages && c.messages.length >= 2)
    .sort((a, b) => b.messages.length - a.messages.length);

  return sorted.slice(0, maxConversations).map(conv => {
    const msgs = conv.messages.slice(0, 4).map(m => {
      const role = m.authorRole === 'user' ? 'User' : 'Assistant';
      const text = m.contentParts.map(p => p.text || '').join(' ');
      const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
      return `**${role}**: ${truncated}`;
    });
    return { title: conv.title, messages: msgs };
  });
}

function sanitize(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100) || 'untitled';
}
