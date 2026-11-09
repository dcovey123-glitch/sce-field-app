// AI calls: one model, readable errors, one retry when busy
import { describe, it, expect } from 'vitest'
import { askAI, askAIForJSON, jsonFromReply, aiErrorMessage, AI_MODEL } from '../src/api/ai.js'

const reply = (status, body) => ({ ok: status === 200, status, json: async () => body })
const ok = text => reply(200, { content: [{ type: 'text', text }] })

describe('asking the AI', () => {
  it('sends the key, the model and a PDF before the question', async () => {
    let sent
    const text = await askAI({ apiKey: 'k1', prompt: 'Read this', pdf: 'QUJD', fetchImpl: async (url, o) => { sent = { url, ...o, body: JSON.parse(o.body) }; return ok('hello') } })
    expect(text).toBe('hello')
    expect(sent.headers['x-api-key']).toBe('k1')
    expect(sent.body.model).toBe(AI_MODEL)
    expect(sent.body.messages[0].content.map(b => b.type)).toEqual(['document', 'text'])
  })
  it('tries once more when the service is busy, then gives a plain message', async () => {
    let calls = 0
    expect(await askAI({ apiKey: 'k', prompt: 'x', retryDelayMs: 1, fetchImpl: async () => (++calls === 1 ? reply(529, {}) : ok('done')) })).toBe('done')
    calls = 0
    await expect(askAI({ apiKey: 'k', prompt: 'x', retryDelayMs: 1, fetchImpl: async () => { calls++; return reply(529, {}) } })).rejects.toThrow('The AI service is busy — try again in a minute.')
    expect(calls).toBe(2)
  })
  it('a refused key is not retried and says where to fix it', async () => {
    let calls = 0
    await expect(askAI({ apiKey: 'bad', prompt: 'x', retryDelayMs: 1, fetchImpl: async () => { calls++; return reply(401, { error: { message: 'invalid x-api-key' } }) } })).rejects.toThrow('The AI key was refused — check it in Materials → ⚙ Settings.')
    expect(calls).toBe(1)
  })
  it('no internet: one retry, then says so', async () => {
    await expect(askAI({ apiKey: 'k', prompt: 'x', retryDelayMs: 1, fetchImpl: async () => { throw new TypeError('Failed to fetch') } })).rejects.toThrow('Couldn\'t reach the AI service')
  })
  it('no key: says where to add one', async () => {
    globalThis.localStorage = { getItem: () => null }
    await expect(askAI({ prompt: 'x', fetchImpl: async () => ok('') })).rejects.toThrow('No AI key yet')
  })
  it('pulls the data out of a reply, fenced or not', async () => {
    expect(jsonFromReply('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(() => jsonFromReply('sorry')).toThrow('no data')
    expect(() => jsonFromReply('{"a":')).toThrow()
    expect(await askAIForJSON({ apiKey: 'k', prompt: 'x', fetchImpl: async () => ok('{"total": 12.5}') })).toEqual({ total: 12.5 })
  })
  it('other errors pass the service\'s own message through', () => {
    expect(aiErrorMessage(400, 'prompt is too long')).toBe('prompt is too long')
    expect(aiErrorMessage(418, '')).toBe('AI error 418')
  })
})
