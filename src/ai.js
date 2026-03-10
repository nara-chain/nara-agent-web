/**
 * Unified AI API caller — supports both /chat/completions and /responses endpoints.
 * Uses OpenAI SDK. Auto-detects the correct format and caches it per baseUrl.
 */
import OpenAI from 'openai'

// Cache: baseUrl → 'completions' | 'responses'
const apiTypeCache = {}
// Cache: baseUrl → OpenAI client instance
const clientCache = {}

/** Get cached API type for a baseUrl (for UI display) */
export function getApiType(baseUrl) {
  return apiTypeCache[baseUrl?.replace(/\/$/, '')] ?? null
}

function getClient(baseUrl, apiKey) {
  const base = baseUrl.replace(/\/$/, '')
  const key = `${base}::${apiKey}`
  if (!clientCache[key]) {
    clientCache[key] = new OpenAI({ baseURL: base, apiKey, dangerouslyAllowBrowser: true })
  }
  return clientCache[key]
}

/**
 * Raw fetch probe — used for auto-detect to get full error details.
 * Returns { ok, status, body } without SDK error wrapping.
 */
async function rawProbe(baseUrl, apiKey, path, payload, signal) {
  const url = `${baseUrl}${path}`
  try {
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(payload),
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: e.message }
  }
}

/**
 * Call AI model with auto-detection of API format.
 * @param {{ baseUrl: string, model: string, apiKey: string }} cfg
 * @param {string} prompt
 * @param {{ maxTokens?: number, signal?: AbortSignal, onLog?: (msg: string) => void }} opts
 * @returns {Promise<string>} AI response text
 */
export async function callAI(cfg, prompt, opts = {}) {
  const base = cfg.baseUrl.replace(/\/$/, '')
  const client = getClient(cfg.baseUrl, cfg.apiKey)
  const log = opts.onLog ?? (() => {})

  const cached = apiTypeCache[base]

  // If cached, use known format directly
  if (cached === 'responses') {
    log(`API: /responses (cached)`)
    return callResponses(client, cfg.model, prompt, opts)
  }
  if (cached === 'completions') {
    log(`API: /chat/completions (cached)`)
    return callCompletions(client, cfg.model, prompt, opts)
  }

  // Auto-detect using raw fetch to get full error details
  log(`Detecting API format...`)

  const completionsPayload = { model: cfg.model, messages: [{ role: 'user', content: prompt }], max_tokens: opts.maxTokens ?? 50 }
  const responsesPayload = { model: cfg.model, input: [{ role: 'user', content: prompt }], max_output_tokens: opts.maxTokens ?? 50 }

  log(`Trying /chat/completions ...`)
  const r1 = await rawProbe(base, cfg.apiKey, '/chat/completions', completionsPayload, opts.signal)
  if (r1.ok) {
    apiTypeCache[base] = 'completions'
    log(`✓ Using /chat/completions`)
    const data = JSON.parse(r1.body)
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  }
  log(`✗ /chat/completions failed: ${r1.status} ${r1.body}`)

  log(`Trying /responses ...`)
  const r2 = await rawProbe(base, cfg.apiKey, '/responses', responsesPayload, opts.signal)
  if (r2.ok) {
    apiTypeCache[base] = 'responses'
    log(`✓ Using /responses`)
    const data = JSON.parse(r2.body)
    return data.output_text?.trim() ?? data.output?.[0]?.content?.[0]?.text?.trim() ?? ''
  }
  log(`✗ /responses failed: ${r2.status} ${r2.body}`)

  // Both failed — throw with the most informative error
  const err = new Error(`API detection failed. /chat/completions: ${r1.status} ${r1.body}`)
  err.status = r1.status || r2.status
  throw err
}

async function callCompletions(client, model, prompt, opts = {}) {
  const res = await client.chat.completions.create(
    { model, messages: [{ role: 'user', content: prompt }], max_tokens: opts.maxTokens ?? 50 },
    { signal: opts.signal },
  )
  return res.choices?.[0]?.message?.content?.trim() ?? ''
}

async function callResponses(client, model, prompt, opts = {}) {
  const res = await client.responses.create(
    { model, input: [{ role: 'user', content: prompt }], max_output_tokens: opts.maxTokens ?? 50 },
    { signal: opts.signal },
  )
  return res.output_text?.trim() ?? ''
}
