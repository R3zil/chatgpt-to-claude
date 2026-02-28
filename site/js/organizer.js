/**
 * Output path resolution and filename sanitization.
 * Ported from Python: core/organizer.py
 */

/**
 * Determine the output file path for a conversation.
 */
export function resolveOutputPath(conversation, mode, baseDir) {
  const safeName = sanitizeFilename(conversation.title);

  if (mode === 'flat') {
    return `${baseDir}/${safeName}.md`;
  }

  let subdir;
  if (conversation.createdAt) {
    const d = conversation.createdAt;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    subdir = mode === 'monthly' ? `${y}-${m}` : `${y}`;
  } else {
    subdir = 'undated';
  }

  return `${baseDir}/${subdir}/${safeName}.md`;
}

/**
 * Create a safe filename from a conversation title.
 */
export function sanitizeFilename(title, maxLength = 100) {
  let safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  safe = safe.trim().replace(/\s+/g, '_');
  safe = safe.replace(/[^\w\-.]/g, '');
  safe = safe.replace(/^[._]+|[._]+$/g, '');

  if (!safe) safe = 'untitled';
  return safe.slice(0, maxLength);
}

/**
 * Append a numeric suffix if the path has already been used.
 * @param {string} path
 * @param {Map<string, number>} usedPaths - Mutated in-place.
 * @returns {string}
 */
export function deduplicatePath(path, usedPaths) {
  const key = path.toLowerCase();
  if (usedPaths.has(key)) {
    const count = usedPaths.get(key) + 1;
    usedPaths.set(key, count);
    const dotIdx = path.lastIndexOf('.');
    if (dotIdx > 0) {
      return `${path.slice(0, dotIdx)}_${count}${path.slice(dotIdx)}`;
    }
    return `${path}_${count}`;
  } else {
    usedPaths.set(key, 0);
    return path;
  }
}
