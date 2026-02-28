/**
 * Convert ChatGPT memories and custom instructions to Claude format.
 */

/**
 * Convert pasted ChatGPT memories text into a Markdown document.
 * ChatGPT memories are typically formatted as a list of facts.
 * @param {string} memoriesText - Raw text from ChatGPT's memory settings.
 * @returns {string} Formatted Markdown.
 */
export function convertMemories(memoriesText) {
  if (!memoriesText || !memoriesText.trim()) return '';

  const lines = [
    '# ChatGPT Memories',
    '',
    '> These are facts and preferences that ChatGPT had memorized about you.',
    '> Review them and consider adding relevant ones to your Claude Project Instructions.',
    '',
  ];

  // Parse memory entries (usually one per line or bullet)
  const entries = memoriesText
    .split(/\n/)
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(line => line.length > 0);

  // Group into categories if possible
  const categories = categorizeMemories(entries);

  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    lines.push(`## ${category}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert pasted custom instructions into Claude-compatible format.
 * @param {string} instructionsText - Raw custom instructions text.
 * @returns {string} Formatted for Claude Project Instructions.
 */
export function convertCustomInstructions(instructionsText) {
  if (!instructionsText || !instructionsText.trim()) return '';

  return [
    '## Custom Instructions (from ChatGPT)',
    '',
    '> These were your custom instructions in ChatGPT.',
    '',
    instructionsText.trim(),
    '',
  ].join('\n');
}

/**
 * Try to categorize memory entries by topic.
 */
function categorizeMemories(entries) {
  const categories = {
    'Personal': [],
    'Work & Projects': [],
    'Technical Preferences': [],
    'Communication Style': [],
    'Other': [],
  };

  const patterns = {
    'Personal': /\b(name|live|family|age|born|from|speak|language|hobby|hobbies|pet|child|kids|wife|husband|partner)\b/i,
    'Work & Projects': /\b(work|job|company|project|team|role|position|business|client|startup|office)\b/i,
    'Technical Preferences': /\b(prefer|use|code|programming|language|framework|tool|editor|ide|stack|python|javascript|react|database)\b/i,
    'Communication Style': /\b(respond|answer|explain|format|style|tone|prefer.*(?:concise|detailed|brief|verbose))\b/i,
  };

  for (const entry of entries) {
    let placed = false;
    for (const [category, pattern] of Object.entries(patterns)) {
      if (pattern.test(entry)) {
        categories[category].push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) {
      categories['Other'].push(entry);
    }
  }

  return categories;
}
