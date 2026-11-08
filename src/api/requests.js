// Material orders and pricing lists you've sent to a wholesaler, kept until
// the quote comes back. Each one sits in Orders & Slips (📨 Sent) — match it
// to the quote when it lands (the quote then carries on: PO → order), or move
// it to Pricing.
//
// request: { id, sentAt, wholesaler, subject, file, items:[{qty,uom,partNo,desc}],
//            jobs:[{id,name}], pricing, matchedFeedId, matchedAt, removedAt }
// A quote you made yourself from the Catalog: fromCatalog, items carry price,
// poNumber once Jonathan gives it one (slips on that PO then file under it).
import { distributorName } from './monthDist.js'
import { partNosOf } from './partAliases.js'

export const REQUESTS_KEY = 'material_requests'
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function addRequestTo(list, r) {
  return [{ id: uid(), sentAt: new Date().toISOString(), matchedFeedId: null, ...r }, ...(Array.isArray(list) ? list : [])]
}

// Store it straight to local storage (the export bar lives on several pages)
export function saveSentRequest(r) {
  try {
    const k = 'fieldapp_' + REQUESTS_KEY
    const cur = JSON.parse(localStorage.getItem(k) || '[]')
    localStorage.setItem(k, JSON.stringify(addRequestTo(cur, r)))
    window.dispatchEvent(new CustomEvent('fieldapp-local', { detail: { key: REQUESTS_KEY, from: 'export' } }))
  } catch { /* ignore */ }
}

const pn = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
// Quotes from the email run that could be the answer to this request, best first
export function quoteCandidates(req, rows, takenIds = new Set()) {
  const sent = Date.parse(req.sentAt) - 2 * 86400000
  const sup = distributorName(req.wholesaler || '')
  const parts = new Set((req.items || []).map(i => pn(i.partNo)).filter(x => x.length >= 4))
  return (rows || [])
    .filter(r => !r.archived && !takenIds.has(r.id) && !(Date.parse(r.date) < sent))
    .map(r => {
      const lines = Object.values(r.quoteLines || {}).flat()
      const overlap = lines.filter(l => parts.has(pn(l.partNo))).length
      const sameSup = sup !== 'Unknown supplier' && distributorName(r.supplier) === sup
      return { r, overlap, sameSup, score: overlap * 3 + (sameSup ? 2 : 0) }
    })
    .sort((a, b) => b.score - a.score || String(b.r.date).localeCompare(String(a.r.date)))
}

// Catalog (then Stock) price for an order line: part # (or an alternate), then nickname / name
const lc = s => String(s || '').toLowerCase().trim()
export function catalogPriceFor(item) {
  try {
    const cat = JSON.parse(localStorage.getItem('fieldapp_material_catalog') || '[]')
    const stock = JSON.parse(localStorage.getItem('fieldapp_material_stock') || '[]')
    const p = pn(item.partNo), d = lc(item.desc || item.nickname || item.name)
    const c = (p && cat.find(c => partNosOf(c).some(x => pn(x) === p)))
      || (d && cat.find(c => lc(c.nickname) === d || lc(c.name) === d))
    if (c && Number(c.refCost) > 0) return Number(c.refCost)
    const st = (p && stock.find(s => pn(s.partNo) === p)) || (d && stock.find(s => lc(s.nickname) === d || lc(s.name) === d))
    if (st && Number(st.cost) > 0) return Number(st.cost)
    return Number(item.price) || Number(item.cost) || 0
  } catch { return Number(item.price) || 0 }
}
export const catalogQuoteTotal = r => Math.round((r.items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0) * 100) / 100

// A pricing request's quote coming back: match it automatically when the
// evidence is good (2+ of the same part #s, or 1 and the same supplier), and
// flag it to be confirmed as Pricing. → null, or the new requests list
export function autoMatchPricingRequests(requests, rows) {
  const list = Array.isArray(requests) ? requests : []
  const taken = new Set(list.filter(r => r.matchedFeedId && !r.removedAt).map(r => r.matchedFeedId))
  let changed = false
  const next = list.map(r => {
    if (!r.pricing || r.fromCatalog || r.removedAt || r.matchedFeedId) return r
    const no = new Set(r.rejectedFeedIds || [])
    const best = quoteCandidates(r, rows, taken).find(c => !no.has(c.r.id) && (c.overlap >= 2 || (c.overlap >= 1 && c.sameSup)))
    if (!best) return r
    taken.add(best.r.id); changed = true
    return { ...r, matchedFeedId: best.r.id, matchedAt: new Date().toISOString(), autoMatched: true, needsConfirm: true }
  })
  return changed ? next : null
}
