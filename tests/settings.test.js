// Every name the app saves data under is on the list in settings.js — so a
// typo or a forgotten list can't quietly save somewhere nobody reads.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { STORE, FILE_KEYS, SECRET_KEYS, isKnownKey } from '../src/api/settings.js'

const SRC = path.join(__dirname, '..', 'src')
const files = fs.readdirSync(SRC, { recursive: true }).filter(f => /\.(jsx?|mjs)$/.test(f)).map(f => path.join(SRC, f))
const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
// names written straight into a save/read call, or a *_KEY constant
const used = new Set([
  ...[...code.matchAll(/(?:useLocalStore|readValue|writeValue|readLS|writeLS|lsGet|lsSet)\(\s*'([a-z0-9_]+)'/g)].map(m => m[1]),
  ...[...code.matchAll(/(?:customersKey|recordsKey):\s*'([a-z0-9_]+)'/g)].map(m => m[1]),
  ...[...code.matchAll(/const [A-Z_]*KEY\s*=\s*'(?:fieldapp_)?([a-z0-9_]+)'/g)].map(m => m[1]),
  ...[...code.matchAll(/'fieldapp_([a-z0-9_]+)'/g)].map(m => m[1]),
])

describe('the list of saved data', () => {
  it('every name the app uses is on the list', () => {
    const unknown = [...used].filter(k => !isKnownKey(k)).sort()
    expect(unknown).toEqual([])
  })
  it('found the names (the scan itself works)', () => {
    expect(used.has('material_orders')).toBe(true)
    expect(used.has('crew_roster')).toBe(true)
    expect(used.size).toBeGreaterThan(40)
  })
  it('the lists kept as files include the Material Order List, and nothing that isn\'t used', () => {
    expect(FILE_KEYS).toContain('materials_order_list')
    expect(FILE_KEYS.filter(k => !used.has(k))).toEqual([])
  })
  it('keys and passwords are marked secret, so backups never copy them', () => {
    expect(SECRET_KEYS.sort()).toEqual(['anthropic_api_key', 'cloud_sync_upload_key'])
    expect(Object.values(STORE).every(v => v.what)).toBe(true)
  })
})
