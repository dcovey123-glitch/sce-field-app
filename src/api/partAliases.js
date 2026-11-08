import { todayLocal } from './albertaTime.js'
// One Catalog part, several wholesaler part numbers.
//
// The same 4x4 box comes from Nedco, Gescan and Westburne under three part
// numbers. Merged, it's one Catalog part whose `parts` list holds each
// supplier's part number and latest price; the Catalog price follows the rule
// you pick — the highest of them (default) or the average.
//
// part.parts: [{ partNo, supplier, price, at }]   (present once merged, 2+ entries)
// part.priceRule: 'highest' | 'average'

const norm = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '')
const r4 = v => Math.round(v * 10000) / 10000

export function partNosOf(c) {
  const list = [c && c.partNo, ...((c && c.parts) || []).map(p => p.partNo)].filter(Boolean)
  return [...new Set(list.map(String))]
}
export function hasPartNo(c, pn) {
  const k = norm(pn)
  return !!k && partNosOf(c).some(p => norm(p) === k)
}
export function isMerged(c) { return ((c && c.parts) || []).length > 1 }

export function priceByRule(parts, rule) {
  const prices = (parts || []).map(p => Number(p.price)).filter(v => v > 0)
  if (!prices.length) return 0
  if (rule === 'average') return r4(prices.reduce((a, v) => a + v, 0) / prices.length)
  return r4(Math.max(...prices))
}

// A new price for one of a merged part's part numbers (from a slip/quote line).
// Returns { item, flag } — the Catalog price is re-worked by the part's rule.
export function priceIntoMerged(c, li, source, date) {
  const cost = Number(li.cost) || 0
  const parts = (c.parts || []).map(p => ({ ...p }))
  let entry = parts.find(p => norm(p.partNo) === norm(li.partNo))
  if (!entry) entry = parts.find(p => source && String(p.supplier || '').toLowerCase() === String(source).toLowerCase()) || parts[0]
  const prev = Number(entry.price) || 0
  entry.price = cost; entry.at = date || todayLocal(); if (source) entry.supplier = source
  const refCost = priceByRule(parts, c.priceRule)
  const item = { ...c, parts, refCost }
  const changed = prev > 0 && Math.abs(prev - cost) > 0.005
  return {
    item,
    flag: changed ? { merged: true, item: c.nickname || c.name, supplier: source || entry.supplier || '', partNo: entry.partNo, catalogCost: prev, newCost: cost, refCost, rule: c.priceRule || 'highest', prevRef: Number(c.refCost) || 0 } : null,
  }
}
