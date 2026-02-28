/**
 * Content-type-specific rendering for ChatGPT message parts.
 * Ported from Python: core/content_handlers.py
 */

const CONTENT_TYPES = {
  TEXT: 'text',
  CODE: 'code',
  EXECUTION_OUTPUT: 'execution_output',
  BROWSING_DISPLAY: 'tether_browsing_display',
  BROWSING_QUOTE: 'tether_quote',
  MULTIMODAL_TEXT: 'multimodal_text',
  UNKNOWN: 'unknown',
};

function handleText(content) {
  const parts = content.parts || [];
  const result = [];
  for (const part of parts) {
    if (typeof part === 'string' && part.trim()) {
      result.push({ contentType: CONTENT_TYPES.TEXT, text: part });
    } else if (typeof part === 'object' && part !== null) {
      result.push(...handleStructuredPart(part));
    }
  }
  return result;
}

function handleMultimodalText(content) {
  const parts = content.parts || [];
  const result = [];
  for (const part of parts) {
    if (typeof part === 'string' && part.trim()) {
      result.push({ contentType: CONTENT_TYPES.TEXT, text: part });
    } else if (typeof part === 'object' && part !== null) {
      result.push(...handleStructuredPart(part));
    }
  }
  return result;
}

function handleStructuredPart(part) {
  const ct = part.content_type || '';

  if (ct.includes('image')) {
    const pointer = part.asset_pointer || '';
    return [{ contentType: CONTENT_TYPES.TEXT, text: pointer ? `[Image: ${pointer}]` : '[Image]', imageRef: pointer || null }];
  }

  if (ct === 'file' || ct.includes('file')) {
    const name = part.name || 'unnamed_file';
    return [{ contentType: CONTENT_TYPES.TEXT, text: `[File: ${name}]` }];
  }

  if (part.text) {
    return [{ contentType: CONTENT_TYPES.TEXT, text: part.text }];
  }

  return [];
}

function handleCode(content) {
  const codeText = content.text || '';
  const language = content.language || 'python';
  return [{ contentType: CONTENT_TYPES.CODE, text: codeText, language }];
}

function handleExecutionOutput(content) {
  const output = content.text || '';
  if (!output) return [];
  return [{ contentType: CONTENT_TYPES.EXECUTION_OUTPUT, text: output }];
}

function handleBrowsingDisplay(content) {
  const result = content.result || '';
  if (!result) return [];
  return [{ contentType: CONTENT_TYPES.BROWSING_DISPLAY, text: result }];
}

function handleBrowsingQuote(content) {
  const title = content.title || '';
  const text = content.text || '';
  const url = content.url || '';
  return [{ contentType: CONTENT_TYPES.BROWSING_QUOTE, text, title, url }];
}

function handleUnknown(content) {
  const parts = content.parts || [];
  const text = content.text || '';
  const ctName = content.content_type || 'unknown';

  const result = [];
  if (text) {
    result.push({ contentType: CONTENT_TYPES.UNKNOWN, text });
  } else if (parts.length) {
    for (const part of parts) {
      if (typeof part === 'string' && part.trim()) {
        result.push({ contentType: CONTENT_TYPES.UNKNOWN, text: part });
      }
    }
  }

  if (!result.length) {
    result.push({ contentType: CONTENT_TYPES.UNKNOWN, text: `[Unsupported content type: ${ctName}]` });
  }
  return result;
}

const HANDLERS = {
  text: handleText,
  code: handleCode,
  execution_output: handleExecutionOutput,
  tether_browsing_display: handleBrowsingDisplay,
  tether_quote: handleBrowsingQuote,
  multimodal_text: handleMultimodalText,
};

export function renderContent(rawContent) {
  const contentType = rawContent.content_type || 'text';
  const handler = HANDLERS[contentType] || handleUnknown;
  return handler(rawContent);
}

export { CONTENT_TYPES };
