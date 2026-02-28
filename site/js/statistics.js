/**
 * Aggregate statistics computation.
 * Ported from Python: core/statistics.py
 */

/**
 * Compute aggregate statistics in a single pass.
 * Works with both full conversations and metadata objects.
 */
export function computeStatistics(conversations) {
  const stats = {
    totalConversations: 0,
    totalMessages: 0,
    dateRange: { start: null, end: null },
    modelsUsed: {},
    messagesByRole: {},
    conversationsByMonth: {},
  };

  for (const conv of conversations) {
    stats.totalConversations++;

    // Message count
    if (conv.messages) {
      stats.totalMessages += conv.messages.length;
      for (const msg of conv.messages) {
        stats.messagesByRole[msg.authorRole] = (stats.messagesByRole[msg.authorRole] || 0) + 1;
        if (msg.modelSlug) {
          stats.modelsUsed[msg.modelSlug] = (stats.modelsUsed[msg.modelSlug] || 0) + 1;
        }
      }
    } else if (conv.messageCount != null) {
      stats.totalMessages += conv.messageCount;
      if (conv.modelSlugs) {
        for (const slug of conv.modelSlugs) {
          if (!(slug in stats.modelsUsed)) stats.modelsUsed[slug] = 0;
        }
      }
    }

    // Date tracking
    const dt = conv.createdAt;
    if (dt) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const monthKey = `${y}-${m}`;
      stats.conversationsByMonth[monthKey] = (stats.conversationsByMonth[monthKey] || 0) + 1;

      if (!stats.dateRange.start || dt < stats.dateRange.start) stats.dateRange.start = dt;
      if (!stats.dateRange.end || dt > stats.dateRange.end) stats.dateRange.end = dt;
    }
  }

  return stats;
}

/**
 * Format a date range as a string.
 */
export function formatDateRange(dateRange) {
  if (!dateRange.start || !dateRange.end) return 'Unknown';
  const fmt = (d) => d.toISOString().slice(0, 10);
  return `${fmt(dateRange.start)} -> ${fmt(dateRange.end)}`;
}
