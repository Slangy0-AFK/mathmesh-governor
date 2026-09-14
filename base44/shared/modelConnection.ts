const NATIVE = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
export async function prepareConnection(svc, input) {
  const { provider, model, apiKey } = input;
  if (!['openai', 'anthropic', 'gemini', 'compatible'].includes(provider)) throw new Error('Choose a supported connection protocol.');
  if (typeof model !== 'string' || !model.trim() || model.length > 150 || typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 1000) throw new Error('A model ID and API key are required.');
  const endpoint = NATIVE[provider] || input.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 500) throw new Error('Invalid endpoint.');
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) throw new Error('Use HTTPS on port 443, without credentials, query parameters or fragments.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host.includes('metadata')) throw new Error('Only public DNS hostnames are supported.');
  if (provider === 'compatible') {
    const entries = await svc.entities.EgressAllowlist.filter({ host }, '-created_date', 1);
    if (!entries[0]?.enabled || !entries[0].allowed_methods?.includes('POST')) throw new Error(`Add ${host} to the Egress Allowlist with POST enabled before sending a key to it.`);
  }
  return { provider, model: model.trim(), apiKey: apiKey.trim(), endpoint: url.toString().replace(/\/+$/, '') };
}
export async function callConnectedModel(connection, prompt) {
  const { provider, model, apiKey, endpoint } = connection;
  const headers = { 'Content-Type': 'application/json' };
  let url, body;
  if (provider === 'anthropic') {
    url = `${endpoint}/messages`; headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 512, temperature: 0, messages: [{ role: 'user', content: prompt }] };
  } else if (provider === 'gemini') {
    url = `${endpoint}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`; headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 512 } };
  } else if (provider === 'openai') {
    url = `${endpoint}/responses`; headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: prompt, max_output_tokens: 512, store: false };
  } else {
    url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`; headers.Authorization = `Bearer ${apiKey}`;
    body = { model, max_tokens: 512, temperature: 0, messages: [{ role: 'user', content: prompt }] };
  }
  const start = Date.now();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(25000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider returned HTTP ${response.status}. Check credentials, model access, endpoint and quota.`); }
  const reader = response.body.getReader(); let size = 0, raw = ''; const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 100000) { await reader.cancel(); throw new Error('Provider response exceeded the size limit.'); } raw += decoder.decode(value, { stream: true }); }
  const data = JSON.parse(raw + decoder.decode());
  const answer = provider === 'anthropic' ? data.content?.filter(p => p.type === 'text').map(p => p.text).join('') : provider === 'gemini' ? data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') : provider === 'openai' ? data.output?.flatMap(p => p.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('') : data.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000) throw new Error('No usable text returned, or answer exceeded 4,000 characters.');
  const u = data.usage || data.usageMetadata;
  const inputTokens = u?.input_tokens ?? u?.prompt_tokens ?? u?.promptTokenCount;
  const outputTokens = u?.output_tokens ?? u?.completion_tokens ?? u?.candidatesTokenCount;
  const total = u?.total_tokens ?? u?.totalTokenCount ?? (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? inputTokens + outputTokens : null);
  return { answer: answer.split(apiKey).join('[credential redacted]'), latencyMs: Date.now() - start, usage: Number.isFinite(total) && total >= 0 ? { input: inputTokens ?? null, output: outputTokens ?? null, total } : null, modelReported: typeof data.model === 'string' ? data.model : null };
}