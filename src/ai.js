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

/** Wrap fetch to capture raw error response body (SDK sometimes reports "no body") */
function createFetchWithErrorCapture() {
  return async (url, init) => {
    const res = await fetch(url, init)
    if (!res.ok) {
      const body = await res.text()
      const err = new Error(`${res.status} ${body || res.statusText}`)
      err.status = res.status
      err.error = tryParseJSON(body)
      err.rawBody = body
      throw err
    }
    return res
  }
}

function tryParseJSON(s) { try { return JSON.parse(s) } catch { return null } }

function logError(log, endpoint, e) {
  log(`✗ ${endpoint} failed: ${e.status ?? ''} ${e.rawBody ?? e.message}`)
}

function getClient(baseUrl, apiKey) {
  const base = baseUrl.replace(/\/$/, '')
  const key = `${base}::${apiKey}`
  if (!clientCache[key]) {
    clientCache[key] = new OpenAI({
      baseURL: base, apiKey, dangerouslyAllowBrowser: true,
      fetch: createFetchWithErrorCapture(),
    })
  }
  return clientCache[key]
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

  // Auto-detect: try completions first, fall back to responses
  log(`Detecting API format...`)

  let completionsErr
  log(`Trying /chat/completions ...`)
  try {
    const result = await callCompletions(client, cfg.model, prompt, opts)
    apiTypeCache[base] = 'completions'
    log(`✓ Using /chat/completions`)
    return result
  } catch (e) {
    if (e.name === 'AbortError') throw e
    completionsErr = e
    logError(log, '/chat/completions', e)
  }

  log(`Trying /responses ...`)
  try {
    const result = await callResponses(client, cfg.model, prompt, opts)
    apiTypeCache[base] = 'responses'
    log(`✓ Using /responses`)
    return result
  } catch (e) {
    if (e.name === 'AbortError') throw e
    logError(log, '/responses', e)
    // Both failed — throw the more informative error
    throw completionsErr.status ? completionsErr : e
  }
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
