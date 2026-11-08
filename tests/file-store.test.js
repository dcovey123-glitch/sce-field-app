// The big lists in their own files: moving over, saving, damaged files
import { describe, it, expect, beforeEach } from 'vitest'
import { initFileStore, readValue, writeValue, isFileKey, nonFileKeys, _resetForTests } from '../src/api/fileStore.js'

function setup({ files = {}, local = {}, failSave = false } = {}) {
  const ls = new Map(Object.entries(local).map(([k, v]) => ['fieldapp_' + k, JSON.stringify(v)]))
  globalThis.localStorage = {
    getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k),
    key: i => [...ls.keys()][i], get length() { return ls.size },
  }
  const disk = new Map(Object.entries(files))
  const events = []
  const win = new EventTarget()
  win.addEventListener('fieldapp-save-failed', e => events.push(e.detail))
  win.desktop = {
    getDataRoot: async () => 'D:\\data',
    appFileLoadAll: async keys => Object.fromEntries(keys.filter(k => disk.has(k)).map(k => [k, disk.get(k)])),
    appFileSave: async (k, t) => { if (failSave) return false; disk.set(k, JSON.stringify(JSON.parse(t), null, 2)); return true },
    appFileSaveSync: (k, t) => { disk.set(k, t); return true },
    onAppFileChanged: () => () => {},
  }
  globalThis.window = win
  return { ls, disk, events }
}

describe('file store', () => {
  beforeEach(() => _resetForTests())

  it('moves a list from internal storage to its file, checks it, then removes the internal copy', async () => {
    const orders = [{ id: 'o1', invoiceNumber: '123' }]
    const { ls, disk } = setup({ local: { material_orders: orders, todos: [{ id: 't' }] } })
    await initFileStore()
    expect(JSON.parse(disk.get('material_orders'))).toEqual(orders)
    expect(ls.has('fieldapp_material_orders')).toBe(false)
    expect(ls.has('fieldapp_todos')).toBe(true) // small things stay put
    expect(readValue('material_orders', [])).toEqual(orders)
    expect(isFileKey('material_orders')).toBe(true)
    expect(isFileKey('todos')).toBe(false)
  })

  it('keeps the internal copy when the file could not be written', async () => {
    const { ls } = setup({ local: { material_stock: [{ id: 's1' }] }, failSave: true })
    await initFileStore()
    expect(ls.has('fieldapp_material_stock')).toBe(true)
    expect(readValue('material_stock', [])).toEqual([{ id: 's1' }])
  })

  it('the file wins over a leftover internal copy', async () => {
    const { ls } = setup({ files: { timesheets: JSON.stringify({ '2026-11-01': { workers: [] } }) }, local: { timesheets: { old: true } } })
    await initFileStore()
    expect(readValue('timesheets', {})).toEqual({ '2026-11-01': { workers: [] } })
    expect(ls.has('fieldapp_timesheets')).toBe(false)
  })

  it('saves to the file shortly after a change (and not to internal storage)', async () => {
    const { ls, disk } = setup({ files: { material_catalog: '[]' } })
    await initFileStore()
    writeValue('material_catalog', [{ id: 'c1' }])
    expect(readValue('material_catalog', [])).toEqual([{ id: 'c1' }]) // instant
    expect(ls.has('fieldapp_material_catalog')).toBe(false)
    await new Promise(r => setTimeout(r, 500))
    expect(JSON.parse(disk.get('material_catalog'))).toEqual([{ id: 'c1' }])
  })

  it('leaves a damaged file alone and says so', async () => {
    const { events } = setup({ files: { daily_notes: { damaged: true } } })
    await initFileStore()
    expect(isFileKey('daily_notes')).toBe(false)
    expect(nonFileKeys(['daily_notes', 'material_orders'])).toEqual(['daily_notes'])
    await new Promise(r => setTimeout(r, 1600))
    expect(events.some(e => /daily_notes/.test(e.key))).toBe(true)
  })

  it('does nothing outside the desktop app', async () => {
    setup({ local: { material_orders: [1] } })
    delete window.desktop
    await initFileStore()
    expect(isFileKey('material_orders')).toBe(false)
    writeValue('material_orders', [2])
    expect(JSON.parse(localStorage.getItem('fieldapp_material_orders'))).toEqual([2])
  })
})
