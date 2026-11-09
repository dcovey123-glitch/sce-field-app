// A wholesaler's pricing quote against one of our customer quotes: what's
// priced differently, what isn't on our quote, and — when their part # or
// wording doesn't match ours — which of our lines it really is (you say).
// Nothing changes on the quote until you apply.
import { sameItem } from './slips.js'
import { quoteNumbersOf, orderParts } from './orders.js'

const n = v => Number(v) || 0
const uid = () => Math.random().toString(36).slice(2, 10)

export function quoteMaterialLines(quote) {
  const out = []
  ;(quote.scopes || []).forEach(sc => (sc.materials || []).forEach(m => out.push({ ...m, scopeId: sc.id, scopeName: sc.name })))
  return out
}

// lines: [{ partNo, name, uom, qty, cost }]
export function compareToQuote(lines, quote) {
  const quoteLines = quoteMaterialLines(quote)
  const diffs = [], missing = [], same = []
  ;(lines || []).forEach((l, i) => {
    const m = quoteLines.find(q => sameItem({ partNo: q.partNo, name: q.desc }, { partNo: l.partNo, name: l.name }))
    const cost = n(l.cost)
    if (!m) missing.push({ i, line: l })
    else if (Math.abs(n(m.rate) - cost) > 0.005) diffs.push({ i, line: l, match: m })
    else same.push({ i, line: l, match: m })
  })
  const matchedIds = new Set([...diffs, ...same].map(x => x.match.id))
  const unpriced = quoteLines.filter(q => !matchedIds.has(q.id)) // our lines nothing on their quote matched
  return { diffs, missing, same, quoteLines, unpriced }
}

// The change to make to the quote.
//   update:  [diff]                      → take their price
//   add:     [{ line }]                  → new material line in scopeId
//   replace: [{ line, quoteLineId }]     → that line of ours IS this one: their
//            part # and price go on it; our wording and qty stay
//   source:  { kind, id, label, date, number?, slipPath? } → kept on the quote
export function applyCompare(cur, { update = [], add = [], replace = [], scopeId = '', source = null, at = new Date().toISOString() }) {
  const scopes = (cur.scopes || []).length ? cur.scopes : [{ id: uid(), name: 'Materials', scopeText: '', materials: [], labor: [] }]
  const target = scopes.find(s => s.id === scopeId) || scopes[0]
  const next = scopes.map(s => {
    let mats = (s.materials || []).map(m => {
      const d = update.find(x => x.match.id === m.id)
      if (d) return { ...m, rate: n(d.line.cost) }
      const r = replace.find(x => x.quoteLineId === m.id)
      if (r) return { ...m, partNo: r.line.partNo || m.partNo || '', rate: n(r.line.cost), ...(r.line.name && !m.desc ? { desc: r.line.name } : {}) }
      return m
    })
    if (s.id === target.id) {
      mats = [...mats, ...add.map(({ line }) => ({ id: uid(), partNo: line.partNo || '', desc: line.name || '', uom: line.uom || '', qty: n(line.qty), rate: n(line.cost) }))]
    }
    return { ...s, materials: mats }
  })
  const patch = { scopes: next }
  if (source) {
    const prev = (cur.priceSources || []).filter(p => !(p.kind === source.kind && p.id === source.id))
    patch.priceSources = [{ ...source, at, added: add.length, updated: update.length + replace.length }, ...prev]
  }
  return patch
}

// Lines of an email-run quote, priced per unit
export function feedRowLines(row, number) {
  const all = row && row.quoteLines && typeof row.quoteLines === 'object' ? row.quoteLines : {}
  const nums = number ? [number] : Object.keys(all)
  return nums.flatMap(k => (all[k] || []).filter(l => l && (l.partNo || l.desc)).map(l => ({ partNo: l.partNo || '', name: l.desc || '', uom: l.uom || '', qty: n(l.qty), cost: n(l.qty) ? Math.round(n(l.ext) / n(l.qty) * 10000) / 10000 : n(l.ext) })))
}
export const slipPriceLines = o => (o.lineItems || []).filter(li => !li.movedTo && (li.partNo || li.name)).map(li => ({ partNo: li.partNo || '', name: li.name || '', uom: li.uom || '', qty: n(li.qty), cost: li.cost != null && li.cost !== '' ? n(li.cost) : (n(li.qty) ? Math.round(n(li.totalPrice) / n(li.qty) * 10000) / 10000 : 0) }))

// A pricing quote read in as a slip, as something to compare
export function sourceFromSlip(o) {
  return { kind: 'slip', id: o.id, label: `${o.wholesaler || 'Slip'}${o.invoiceNumber ? ' #' + o.invoiceNumber : ''}`, date: String(o.orderDate || o.receivedAt || '').slice(0, 10), number: o.invoiceNumber || '', lines: slipPriceLines(o), slipPath: o.slipPath || '' }
}
// An email-run row, one source per quote # on it
export function sourcesFromFeedRow(r) {
  const nums = quoteNumbersOf(r)
  return (nums.length ? nums : ['']).map(num => ({ kind: 'feed', id: r.id + ':' + num, label: `${r.supplier || 'Supplier'} quote ${num}`.trim(), date: r.date || '', number: num, lines: feedRowLines(r, num || undefined), slipPath: '' }))
}
// What gets kept on the quote (no lines)
export const sourceRef = s => s && { kind: s.kind, id: s.id, label: s.label, date: s.date || '', number: s.number || '', slipPath: s.slipPath || '' }

const low = v => String(v || '').trim().toLowerCase()

// Every pricing quote we know of for this quote: quote PDFs read in as Pricing
// Quotes for it, email-run quotes filed for it, and ones it was priced from.
// → [{ kind:'slip'|'feed', id, label, date, number, lines, slipPath, compared }]
export function pricingSourcesFor(quote, { orders = [], feedRows = [] } = {}) {
  const keys = [low(quote.quoteNumber), low(quote.title)].filter(Boolean)
  const done = new Map((quote.priceSources || []).map(p => [p.kind + ':' + p.id, p]))
  const out = []
  for (const o of orders) {
    if (o.archivedNote) continue
    const t = o.pricingTarget
    const forThis = t && t.type === 'quote' && (t.quoteId === quote.id || (low(t.quoteNumber) && low(t.quoteNumber) === keys[0]))
    if (!forThis && !done.has('slip:' + o.id)) continue
    out.push({ ...sourceFromSlip(o), compared: done.get('slip:' + o.id) || null })
  }
  for (const r of feedRows) {
    for (const part of orderParts(r)) {
      const id = r.id + ':' + part.number
      const forThis = part.filedAs === 'quote' && part.refs.some(x => keys.includes(low(x)))
      if (!forThis && !done.has('feed:' + id)) continue
      const src = sourcesFromFeedRow(r).find(s => s.id === id)
      if (src) out.push({ ...src, compared: done.get('feed:' + id) || null })
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
