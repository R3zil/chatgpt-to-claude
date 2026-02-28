/**
 * ZIP extraction and conversations.json discovery.
 * Ported from Python: core/extractor.py
 * Uses JSZip (loaded globally from lib/jszip.min.js).
 */

/**
 * Extract conversations and optional extras from a ZIP File object.
 * @param {File} file - The uploaded ZIP file.
 * @returns {Promise<{conversations: Array, extras: Object}>}
 */
export async function extractFromZip(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const conversations = await findAndParseConversations(zip);
  const extras = await findExtras(zip);

  return { conversations, extras };
}

async function findAndParseConversations(zip) {
  // Find conversations.json (may be at root or in a subdirectory)
  const candidates = Object.keys(zip.files).filter(n => n.endsWith('conversations.json'));

  if (!candidates.length) {
    throw new Error(
      "No 'conversations.json' found in the ZIP. " +
      "Make sure this is a ChatGPT data export (Settings -> Data Controls -> Export Data)."
    );
  }

  // Prefer shortest path (closest to root)
  const target = candidates.sort((a, b) => a.length - b.length)[0];

  try {
    const text = await zip.file(target).async('text');
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse conversations.json: ${e.message}`);
  }
}

/**
 * Look for additional files in the ZIP (user.json, memories, etc.)
 */
async function findExtras(zip) {
  const extras = {};

  const filenames = Object.keys(zip.files);

  for (const name of filenames) {
    const lower = name.toLowerCase();
    const basename = lower.split('/').pop();

    if (basename === 'user.json') {
      try {
        extras.user = JSON.parse(await zip.file(name).async('text'));
      } catch { /* skip */ }
    }

    if (basename === 'model_comparisons.json') {
      try {
        extras.modelComparisons = JSON.parse(await zip.file(name).async('text'));
      } catch { /* skip */ }
    }

    if (basename === 'message_feedback.json') {
      try {
        extras.messageFeedback = JSON.parse(await zip.file(name).async('text'));
      } catch { /* skip */ }
    }

    if (basename === 'shared_conversations.json') {
      try {
        extras.sharedConversations = JSON.parse(await zip.file(name).async('text'));
      } catch { /* skip */ }
    }

    if (basename === 'chat.html') {
      extras.hasChatHtml = true;
    }
  }

  return extras;
}
