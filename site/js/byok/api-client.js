/**
 * BYOK (Bring Your Own Key) API client for Claude and OpenAI.
 * Makes direct API calls from the browser using the user's own API key.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * @typedef {Object} ApiConfig
 * @property {'claude'|'openai'} provider
 * @property {string} apiKey
 * @property {string} [model] - Override the default model
 */

/**
 * Send a message to Claude or OpenAI API.
 * @param {ApiConfig} config
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>} The assistant's response text.
 */
export async function sendMessage(config, systemPrompt, userMessage) {
  if (config.provider === 'claude') {
    return sendClaude(config, systemPrompt, userMessage);
  } else if (config.provider === 'openai') {
    return sendOpenAI(config, systemPrompt, userMessage);
  }
  throw new Error(`Unknown provider: ${config.provider}`);
}

async function sendClaude(config, systemPrompt, userMessage) {
  const model = config.model || 'claude-sonnet-4-20250514';

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Claude returned an empty response');
  return text;
}

async function sendOpenAI(config, systemPrompt, userMessage) {
  const model = config.model || 'gpt-4o-mini';

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty response');
  return text;
}

/**
 * Validate an API key by making a minimal request.
 * @param {ApiConfig} config
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateApiKey(config) {
  try {
    await sendMessage(config, 'Respond with OK.', 'ping');
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
