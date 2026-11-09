// Every AI call the app makes (reading slips, quotes and CO/PO documents,
// writing scopes and job summaries) goes through here: one model, one key,
// the same error messages, and one retry when the service is busy.
import { readValue } from './fileStore.js'
import { useLocalStore } from './useLocalStore.js'

export const AI_MODEL = 'claude-sonnet-5'
export const API_KEY_KEY = 'anthropic_api_key'
const URL = 'https://api.anthropic.com/v1/messages'
const RETRY_STATUSES = new Set([429, 500, 502, 503, 529])

// The key saved in Settings (Materials → ⚙)
export function useApiKey() { return useLocalStore(API_KEY_KEY, '') }
export const readApiKey = () => readValue(API_KEY_KEY, '') || ''

// A message you can show someone: what went wrong and what to do
export function aiErrorMessage(status, apiMessage) {
  if (status === 401) return 'The AI key was refused — check it in Materials → ⚙ Settings.'
  if (status === 403) return 'The AI key isn\'t allowed to do this — check it in Materials → ⚙ Settings.'
  if (status === 413) return 'That file is too big to read — try a smaller PDF or fewer pages.'
  if (status === 429) return 'Too many AI requests at once — wait a minute and try again.'
  if (status === 529 || status === 503) return 'The AI service is busy — try again in a minute.'
  if (status === 0) return 'Couldn\'t reach the AI service — check the internet connection.'
  return apiMessage || `AI error ${status}`
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Send one request (body = { model, max_tokens, messages }) → the response.
// Busy / offline: waits and tries once more. Fails: throws a readable Error.
export async function aiPost(apiKey, body, { retryDelayMs = 2500, fetchImpl } = {}) {
  const key = apiKey || readApiKey()
  if (!key) throw new Error('No AI key yet — add one in Materials → ⚙ Settings.')
  const send = () => (fetchImpl || fetch)(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: AI_MODEL, ...body }),
  })
  let res
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await send() } catch { res = { ok: false, status: 0, json: async () => ({}) } }
    if (res.ok || (!RETRY_STATUSES.has(res.status) && res.status !== 0)) break
    if (attempt === 0) await sleep(retryDelayMs) // busy or offline for a moment: one more try
  }
  if (!res.ok) {
    let apiMessage = ''
    try { const e = await res.json(); apiMessage = e?.error?.message || '' } catch { /* status only */ }
    const err = new Error(aiErrorMessage(res.status, apiMessage))
    err.status = res.status
    throw err
  }
  return res
}

// → the reply text. prompt (+ pdf = base64 PDF put before it), or content =
// your own list of blocks. Throws an Error with a readable message.
export async function askAI({ apiKey, prompt, content, pdf, maxTokens = 1000, model = AI_MODEL, retryDelayMs = 2500, fetchImpl, whole = false }) {
  const blocks = content != null ? content
    : pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: prompt }]
      : prompt
  const res = await aiPost(apiKey, { model, max_tokens: maxTokens, messages: [{ role: 'user', content: blocks }] }, { retryDelayMs, fetchImpl })
  const data = await res.json()
  if (whole && data.stop_reason === 'max_tokens') throw new Error('The document is too long to read in one go — the reply got cut off. Try splitting it.')
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
}

// The JSON object in a reply (it may come wrapped in ```json fences or words)
export function jsonFromReply(text) {
  const t = String(text || '').replace(/```json|```/g, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a === -1 || b < a) throw new Error('The AI reply had no data in it — try again.')
  try { return JSON.parse(t.slice(a, b + 1)) } catch { throw new Error('The AI reply was cut off or garbled — try again.') }
}
export async function askAIForJSON(opts) { return jsonFromReply(await askAI({ maxTokens: 8000, whole: true, ...opts })) }
