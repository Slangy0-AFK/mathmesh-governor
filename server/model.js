const PROVIDERS = {
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions' },
};

/**
 * Extract usage data from provider response. Returns {input, output, total} if available,
 * or null if provider did not report usage.
 */
function extractUsage(data, provider) {
  if (provider === 'anthropic') {
    const usage = data.usage || {};
    const input = usage.input_tokens ?? null;
    const output = usage.output_tokens ?? null;
    const total = (Number.isFinite(input) && Number.isFinite(output)) ? input + output : null;
    return { input, output, total };
  }
  if (provider === 'openai' || provider === 'compatible') {
    const usage = data.usage || {};
    const input = usage.prompt_tokens ?? null;
    const output = usage.completion_tokens ?? null;
    const total = usage.total_tokens ?? null;
    return { input, output, total };
  }
  return { input: null, output: null, total: null };
}

export async function invokeModel({ prompt, response_json_schema, model }) {
  const provider = process.env.MODEL_PROVIDER || 'anthropic';
  const apiKey = process.env.MODEL_API_KEY;
  const modelId = model && model !== 'automatic' ? model : process.env.MODEL_ID;
  if (!apiKey || !modelId) throw new Error('MODEL_API_KEY and MODEL_ID must be configured on the server.');
  if (typeof prompt !== 'string' || prompt.length > 40000) throw new Error('Model prompt is missing or exceeds the 40,000 character limit.');

  let endpoint = PROVIDERS[provider]?.endpoint;
  if (provider === 'compatible') {
    endpoint = process.env.MODEL_ENDPOINT;
    if (!endpoint) throw new Error('MODEL_ENDPOINT is required for the compatible provider.');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('MODEL_ENDPOINT must be an HTTPS URL without credentials, query, or fragment.');
    }
    endpoint = endpoint.replace(/\/$/, '');
    if (!endpoint.endsWith('/chat/completions')) endpoint += '/chat/completions';
  }
  if (!endpoint) throw new Error(`Unsupported MODEL_PROVIDER: ${provider}`);

  const headers = { 'content-type': 'application/json' };
  let body;
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: modelId, max_tokens: 2048, temperature: 0, messages: [{ role: 'user', content: prompt }] };
    if (response_json_schema) {
      body.tools = [{ name: 'structured_verdict', description: 'Return the requested structured verdict.', input_schema: response_json_schema }];
      body.tool_choice = { type: 'tool', name: 'structured_verdict' };
    }
  } else {
    headers.authorization = `Bearer ${apiKey}`;
    body = { model: modelId, temperature: 0, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] };
    if (response_json_schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'structured_verdict', strict: false, schema: response_json_schema },
      };
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Configured model provider returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  const usage = extractUsage(data, provider);

  if (provider === 'anthropic') {
    const tool = data.content?.find((item) => item.type === 'tool_use' && item.name === 'structured_verdict');
    if (response_json_schema) {
      if (!tool?.input || typeof tool.input !== 'object') throw new Error('Model provider returned no structured verdict.');
      return { response: tool.input, usage };
    }
    const text = data.content?.filter((item) => item.type === 'text').map((item) => item.text).join('');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Model provider returned no text.');
    return { response: text, usage };
  }

  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Model provider returned no text.');
  if (!response_json_schema) return { response: text, usage };
  try { 
    return { response: JSON.parse(text), usage }; 
  } catch { 
    throw new Error('Model provider returned invalid structured JSON.'); 
  }
}