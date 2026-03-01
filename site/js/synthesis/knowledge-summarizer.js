/**
 * Generate knowledge summaries from topic clusters.
 * Extracts key topics, decisions, and notable conversations per cluster.
 */

import { sanitizeFilename } from '../organizer.js';

/**
 * Generate knowledge summary documents from topic clusters.
 * @param {Array} clusters - From topic-clusterer.js
 * @returns {Array<{title: string, filename: string, markdown: string}>}
 */
export function summarizeClusters(clusters) {
  return clusters.map(cluster => {
    const title = cluster.label;
    const filename = `topic_${sanitizeFilename(title.toLowerCase().replace(/^your\s+/i, ''))}.md`;
    const markdown = generateClusterSummary(cluster);
    return { title, filename, markdown };
  });
}

function generateClusterSummary(cluster) {
  const lines = [
    `# ${cluster.label}`,
    '',
  ];

  // Date range
  const dates = cluster.conversations
    .filter(c => c.createdAt)
    .map(c => c.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length > 0) {
    const start = dates[0].toISOString().slice(0, 7); // YYYY-MM
    const end = dates[dates.length - 1].toISOString().slice(0, 7);
    const range = start === end ? start : `${start} to ${end}`;
    lines.push(`> Synthesized from ${cluster.conversations.length} conversations (${range}).`);
    lines.push('');
  }

  // Key Topics Discussed
  const topics = extractKeyTopics(cluster);
  if (topics.length > 0) {
    lines.push('## Key Topics Discussed');
    for (const topic of topics.slice(0, 8)) {
      lines.push(`- ${topic}`);
    }
    lines.push('');
  }

  // Key Decisions & Preferences
  const decisions = extractDecisions(cluster);
  if (decisions.length > 0) {
    lines.push('## Key Decisions & Preferences');
    for (const decision of decisions.slice(0, 6)) {
      lines.push(`- ${decision}`);
    }
    lines.push('');
  }

  // Notable Conversations
  const notable = getNotableConversations(cluster);
  if (notable.length > 0) {
    lines.push('## Notable Conversations');
    for (const conv of notable.slice(0, 8)) {
      const date = conv.createdAt ? conv.createdAt.toISOString().slice(0, 10) : 'Unknown date';
      const msgCount = conv.messages ? conv.messages.length : 0;
      lines.push(`- **${conv.title}** (${date}) -- ${msgCount} messages`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Extract key topics as noun phrases from user messages.
 */
function extractKeyTopics(cluster) {
  const phraseCounts = {};

  for (const conv of cluster.conversations) {
    if (!conv.messages) continue;
    for (const msg of conv.messages) {
      if (msg.authorRole !== 'user') continue;
      const text = msg.contentParts.map(p => p.text || '').join(' ');
      const phrases = extractNounPhrases(text);
      for (const phrase of phrases) {
        phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
      }
    }
  }

  return Object.entries(phraseCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase.charAt(0).toUpperCase() + phrase.slice(1));
}

/**
 * Simple noun phrase extraction (2-3 word sequences, no stopwords).
 */
function extractNounPhrases(text) {
  const STOP = new Set([
    'a','an','the','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','can','shall',
    'i','me','my','you','your','he','she','it','we','they','this','that','these',
    'those','and','or','but','in','on','at','to','for','of','with','by','from',
    'not','no','so','if','then','than','very','just','also','how','what','when',
    'where','why','who','which','please','thanks','thank','help','want','need',
  ]);

  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
  const phrases = [];

  for (let i = 0; i < words.length - 1; i++) {
    if (STOP.has(words[i])) continue;

    // 2-word phrases
    if (!STOP.has(words[i + 1])) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }

    // 3-word phrases
    if (i < words.length - 2 && !STOP.has(words[i + 2])) {
      phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  return phrases;
}

/**
 * Extract decision/preference statements from user messages.
 */
function extractDecisions(cluster) {
  const decisions = [];
  const DECISION_PATTERNS = [
    /i (?:prefer|always use|usually use|chose|decided|go with|like to use|stick with) (.+?)(?:\.|$)/gi,
    /(?:better|best) to (.+?)(?:\.|$)/gi,
    /i(?:'ll| will) (?:go with|use|stick with) (.+?)(?:\.|$)/gi,
  ];

  for (const conv of cluster.conversations) {
    if (!conv.messages) continue;
    for (const msg of conv.messages) {
      if (msg.authorRole !== 'user') continue;
      const text = msg.contentParts.map(p => p.text || '').join(' ');

      for (const pattern of DECISION_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const decision = match[0].trim();
          if (decision.length > 10 && decision.length < 200) {
            decisions.push(decision.charAt(0).toUpperCase() + decision.slice(1));
          }
        }
      }
    }
  }

  // Deduplicate similar decisions
  const unique = [];
  for (const d of decisions) {
    if (!unique.some(u => u.toLowerCase().includes(d.toLowerCase().slice(0, 20)))) {
      unique.push(d);
    }
  }

  return unique;
}

/**
 * Get the most notable conversations (by message count).
 */
function getNotableConversations(cluster) {
  return [...cluster.conversations]
    .filter(c => c.messages && c.messages.length > 0)
    .sort((a, b) => b.messages.length - a.messages.length);
}
