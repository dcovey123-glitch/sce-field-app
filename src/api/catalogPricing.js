// Catalog pricing: send Catalog items to a wholesaler at qty 1 for pricing,
// then put what comes back (their part #, description and price) onto those
// same Catalog items — even when we didn't know the part # or their wording.
import { hasPartNo, isMerged, priceIntoMerged } from './partAliases.js'
import { sameItem } from './slips.js'
import { todayLocal } from './albertaTime.js'

const n = v => Number(v) || 0
const uid = () => Math.random().toString(36).slice(2, 10)
const blank = v => !String(v || '').trim()

// Catalog items → lines for the Request for Quote (qty 1 each)
export function catalogRequestItems(items) {
  return (items || []).map(c => ({ qty: 1, uom: c.uom || 'EA', partNo: c.partNo || '', desc: c.name || c.nickname || '', nickname: c.nickname || '', catalogId: c.id }))
}

// The open Catalog pricing request this quote is most likely the answer to
export function openCatalogRequests(requests, wholesaler = '') {
  const w = String(wholesaler || '').toLowerCase()
  return (requests || []).filter(r => r.catalogPricing && !r.removedAt && !r.matchedFeedId && !r.matchedSlipId)
    .sort((a, b) => {
      const sa = w && String(a.wholesaler || '').toLowerCase().includes(w.split(' ')[0]) ? 1 : 0
      const sb = w && String(b.wholesaler || '').toLowerCase().includes(w.split(' ')[0]) ? 1 : 0
      return sb - sa || String(b.sentAt || '').localeCompare(String(a.sentAt || ''))
    })
}

// Words two descriptions share, 0..1 (4FT = 4 FT = 4', BOX = BOXES)
const words = t => new Set(String(t || '').toLowerCase().replace(/(\d)\s*(ft|')/g, '$1ft').replace(/[^0-9a-z]+/g, ' ').split(' ').filter(w => w.length > 1 || /\d/.test(w)).map(w => w.replace(/(es|s)$/, '')))
export function likeness(a, b) {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return 0
  let k = 0; A.forEach(w => { if (B.has(w)) k++ })
  return k / Math.min(A.size, B.size)
}

// Which Catalog item each of their lines is: their part # already on one of
// ours, then the same description, then — for the items we sent without a
// part # — the same line position on our request (wholesalers quote in order).
// lines: [{ partNo, name, uom, qty, cost }]
// → [{ i, line, catalogId: string|null, why: 'part #'|'description'|'line order'|null }]
export function pairToCatalog(lines, catalog, request = null) {
  const cat = catalog || []
  const asked = ((request && request.items) || []).filter(x => x.catalogId)
  const taken = new Set()
  const out = (lines || []).map((line, i) => {
    let c = line.partNo ? cat.find(x => !taken.has(x.id) && hasPartNo(x, line.partNo)) : null
    let why = c ? 'part #' : null
    if (!c) {
      const a = asked.find(x => !taken.has(x.catalogId) && sameItem({ partNo: x.partNo, name: x.desc }, { partNo: line.partNo, name: line.name }))
      c = a ? cat.find(x => x.id === a.catalogId) : cat.find(x => !taken.has(x.id) && sameItem({ partNo: '', name: x.name }, { partNo: '', name: line.name }))
      if (c) why = 'description'
    }
    if (c) taken.add(c.id)
    return { i, line, catalogId: c ? c.id : null, why }
  })
  // Still unpaired: most words in common with something on the request (or
  // the Catalog) — "LED STRIP 4FT" is our "4ft LED strip"
  const free = () => (asked.length ? asked.map(a => cat.find(x => x.id === a.catalogId)).filter(Boolean) : cat).filter(x => !taken.has(x.id))
  out.filter(p => !p.catalogId).map(p => ({ p, best: free().map(c => ({ c, s: Math.max(likeness(p.line.name, c.name), likeness(p.line.name, c.nickname)) })).sort((a, b) => b.s - a.s)[0] }))
    .filter(x => x.best && x.best.s >= 0.5).sort((a, b) => b.best.s - a.best.s)
    .forEach(({ p, best }) => { if (taken.has(best.c.id)) return; p.catalogId = best.c.id; p.why = 'description'; taken.add(best.c.id) })
  // Still unpaired: same position on the request, if that item is still free
  // (only when they quoted the same number of lines we asked for)
  if (asked.length && asked.length === (lines || []).length) out.forEach(p => {
    if (p.catalogId) return
    const a = asked[p.i]
    if (a && !taken.has(a.catalogId) && cat.some(x => x.id === a.catalogId)) { p.catalogId = a.catalogId; p.why = 'line order'; taken.add(a.catalogId) }
  })
  return out
}

// Put their lines onto the Catalog.
// picks: [{ line, catalogId | 'add' | 'skip', useTheirs: bool }]
//   useTheirs — their description becomes the name (ours is kept as the
//   nickname, so you still find it by what you call it)
// → { catalog, updated, added, flags }
export function applyToCatalog(catalog, picks, { source = '', date = todayLocal(), number = '' } = {}) {
  let next = [...(catalog || [])]
  let updated = 0, added = 0
  const flags = []
  const label = [source, number && `quote ${number}`].filter(Boolean).join(' ')
  for (const p of picks || []) {
    const li = p.line || {}
    const cost = n(li.cost)
    if (p.catalogId === 'skip' || !p.catalogId) continue
    if (p.catalogId === 'add') {
      next.push({ id: uid(), partNo: li.partNo || '', nickname: '', name: li.name || '', uom: li.uom || '', refCost: cost, category: '', priceHistory: cost ? [{ date, cost, source: label || source, partNo: li.partNo || '' }] : [], pricedFrom: label })
      added++
      continue
    }
    const c = next.find(x => x.id === p.catalogId)
    if (!c) continue
    let item = { ...c }
    if (isMerged(c) && li.partNo && hasPartNo(c, li.partNo)) {
      const r = priceIntoMerged(c, li, source, date)
      item = r.item
      if (r.flag) flags.push({ ...r.flag, catalogId: c.id })
    } else {
      if (c.refCost != null && n(c.refCost) > 0 && cost && Math.abs(n(c.refCost) - cost) > 0.005) flags.push({ item: c.nickname || c.name, catalogCost: c.refCost, newCost: cost, catalogId: c.id })
      if (cost) item.refCost = cost
      if (li.partNo && blank(c.partNo)) item.partNo = li.partNo
    }
    if (p.useTheirs && li.name && li.name !== c.name) {
      item.name = li.name
      if (blank(c.nickname) && c.name) item.nickname = c.name
    }
    if (blank(item.uom) && li.uom) item.uom = li.uom
    if (cost) item.priceHistory = [...(c.priceHistory || []), { date, cost, source: label || source, partNo: li.partNo || '' }].slice(-20)
    item.pricedFrom = label
    next = next.map(x => x.id === c.id ? item : x)
    updated++
  }
  return { catalog: next, updated, added, flags }
}
