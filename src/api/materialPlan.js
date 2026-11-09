// A job's material plan: what it needs (from the quote, or added), where each
// line is coming from — 📦 Stock (reserved off the basement shelf) or 🚚 Order —
// and where it's at. Kept on the job as plannedMaterials; each line:
//   { id, partNo, item, uom, qty, price, source: 'stock'|'order'|'',
//     stockPick (reserved Stock item), queuedAt (on the order sheet), ... }
// Where an ordered line is at is worked out from what the app already has:
// the order sheet, sent requests, matched quotes, POs and packing slips.
import { slipKind, isQuoteDoc, lineJobsOf, sameItem, hasPoNumber } from './slips.js'
import { REQUESTS_KEY } from './requests.js'
import { fmtDate } from './format.js'

export const ORDER_LIST_KEY = 'materials_order_list'
export { REQUESTS_KEY }
const n = v => Number(v) || 0
const poShow = s => String(s || '').replace(/^po\s*#?\s*/i, '').trim()
const short = s => String(s || '').split(/[\s(-]/)[0]
const day = iso => fmtDate(iso)
const lineLike = l => ({ partNo: l.partNo, name: l.item || l.desc || l.name })

// How much of a Stock item other open jobs have reserved
export function reservedElsewhere(jobs, stockId, exceptLineId) {
  return (jobs || []).filter(j => !j.trashedAt && j.lifecycleStatus !== 'billed')
    .flatMap(j => (j.plannedMaterials || []).filter(l => l.stockPick === stockId && l.id !== exceptLineId))
    .reduce((a, l) => a + n(l.qty), 0)
}
export function stockFree(stock, jobs, stockId, exceptLineId) {
  const s = (stock || []).find(x => x.id === stockId)
  if (!s) return null
  const shelf = n(s.qty), held = reservedElsewhere(jobs, stockId, exceptLineId)
  return { item: s, shelf, held, free: Math.round((shelf - held) * 1000) / 1000 }
}
// Best Stock item for a line (part #, then nickname / name)
export function findStockFor(stock, line) {
  const lc = s => String(s || '').toLowerCase().trim()
  const list = (stock || []).filter(s => n(s.qty) > 0)
  if (line.partNo) { const m = list.find(s => s.partNo && lc(s.partNo) === lc(line.partNo)); if (m) return m }
  return list.find(s => (s.nickname && lc(s.nickname) === lc(line.item)) || (s.name && lc(s.name) === lc(line.item))) || null
}

// ── Linking a plan line to an order by hand ──
// When a slip or quote line doesn't match on its own (different part #, a
// supplier's own wording, not tagged to the job), you pick it: the plan line
// keeps links: [{ orderId, lineId }] and its status follows that line.
export const slipLineKey = (li, i) => li.id || '#' + i
const linkedTo = (line, o, li, i) => (line.links || []).some(k => k.orderId === o.id && k.lineId === slipLineKey(li, i))
export function linkLine(line, orderId, lineId) {
  const links = (line.links || []).filter(k => !(k.orderId === orderId && k.lineId === lineId))
  return { ...line, source: 'order', links: [...links, { orderId, lineId }] }
}
export const unlinkLine = (line, orderId, lineId) => ({ ...line, links: (line.links || []).filter(k => !(k.orderId === orderId && k.lineId === lineId)) })
// What's linked, for showing on the line
export function linkedLines(line, orders) {
  return (line.links || []).map(k => {
    const o = (orders || []).find(x => x.id === k.orderId)
    const i = o ? (o.lineItems || []).findIndex((li, j) => slipLineKey(li, j) === k.lineId) : -1
    const li = i >= 0 ? o.lineItems[i] : null
    return { ...k, o, li, gone: !li, label: o ? `${short(o.wholesaler)} ${isQuoteDoc(o) ? 'quote ' : '#'}${o.invoiceNumber || ''}` : 'Slip removed', sub: li ? `${n(li.qty)} ${li.uom || ''} ${li.partNo || ''} ${li.name || ''}`.replace(/\s+/g, ' ').trim() : '' }
  })
}
// Slip and quote lines you could link a plan line to: this job's first, then
// the best word match; recent first. q = what you typed (words, part #, slip #).
export function linkCandidates(orders, job, line, q = '', { days = 120, today = new Date().toISOString().slice(0, 10) } = {}) {
  const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1)
  const mine = new Set(words(`${line.partNo || ''} ${line.item || ''}`))
  const qw = words(q)
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10)
  const out = []
  for (const o of orders || []) {
    if (slipKind(o) !== 'order' || o.archivedNote) continue
    const date = String(o.orderDate || o.receivedAt || '').slice(0, 10)
    ;(o.lineItems || []).forEach((li, i) => {
      if (li.movedTo) return
      const hay = `${o.wholesaler} ${o.invoiceNumber} ${o.poNumber || ''} ${li.partNo || ''} ${li.name || ''}`
      if (qw.length && !qw.every(w => hay.toLowerCase().includes(w))) return
      if (!qw.length && date && date < cutoff) return
      const overlap = words(`${li.partNo || ''} ${li.name || ''}`).filter(w => mine.has(w)).length
      const onJob = lineJobsOf(o, li).includes(job.id) || (o.jobs || []).some(j => j.id === job.id)
      out.push({ orderId: o.id, lineId: slipLineKey(li, i), o, li, date, onJob, overlap, linked: linkedTo(line, o, li, i), score: (onJob ? 100 : 0) + overlap * 10 })
    })
  }
  return out.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date))).slice(0, 40)
}

// Where one planned line is at
export function planLineStatus(line, job, { orders = [], requests = [], feedRows = [], orderList = [], stock = [], jobs = [] }) {
  if (line.source === 'stock') {
    if (!line.stockPick) return { id: 'pickstock', tone: 'warn', label: 'Pick the Stock item' }
    const f = stockFree(stock, jobs, line.stockPick, line.id)
    if (!f) return { id: 'pickstock', tone: 'warn', label: 'Stock item gone — pick again' }
    const short_ = f.free < n(line.qty)
    return { id: 'reserved', tone: short_ ? 'bad' : 'ok', label: short_ ? `📦 Only ${Math.max(0, f.free)} free on the shelf` : '📦 Reserved from Stock', detail: `${f.shelf} on the shelf${f.held ? ` · ${f.held} held for other jobs` : ''}` }
  }
  if (line.source !== 'order') return { id: 'undecided', tone: 'muted', label: 'Stock or order?' }

  // Received: packing slips tagged to this job with this part — or linked by you
  const isMine = (o, li, i) => linkedTo(line, o, li, i) || (lineJobsOf(o, li).includes(job.id) && sameItem({ partNo: li.partNo, name: li.name }, lineLike(line)))
  // (a quote document counts only when you linked its line yourself)
  const slipLines = orders.filter(o => slipKind(o) === 'order')
    .flatMap(o => (o.lineItems || []).map((li, i) => ({ o, li, i })).filter(({ o: oo, li, i }) => !li.movedTo && (isQuoteDoc(oo) ? linkedTo(line, oo, li, i) : isMine(oo, li, i))))
  const rec = slipLines.filter(x => x.li.received).reduce((a, x) => a + n(x.li.qty), 0)
  const notCharged = slipLines.some(x => !lineJobsOf(x.o, x.li).includes(job.id))
  if (rec >= n(line.qty) && rec > 0) return { id: 'received', tone: 'ok', label: '✓ Received', detail: `${[...new Set(slipLines.map(x => short(x.o.wholesaler) + ' #' + x.o.invoiceNumber))].join(', ')} — ${notCharged ? 'linked by you; not charged to this job yet — put the slip line on the job in Materials' : 'charged on Materials Actual'}` }
  // On a PO: a slip or quote document with a PO, tagged to this job
  const onPo = orders.filter(o => slipKind(o) === 'order' && hasPoNumber(o) && (o.lineItems || []).some((li, i) => isMine(o, li, i)))
  // A quote you linked that has no PO yet
  const linkedQuote = orders.find(o => isQuoteDoc(o) && !hasPoNumber(o) && (o.lineItems || []).some((li, i) => linkedTo(line, o, li, i)))
  // The request this line went out on
  const req = (requests || []).filter(r => !r.removedAt).find(r => (r.items || []).some(i => (i.planRefs || []).some(p => p.jobId === job.id && p.lineId === line.id)))
  const row = req && req.matchedFeedId ? (feedRows || []).find(r => r.id === req.matchedFeedId) : null
  if (rec > 0) return { id: 'partial', tone: 'warn', label: `Received ${rec} of ${line.qty}`, detail: onPo[0] ? `PO ${poShow(onPo[0].poNumber)}` : '' }
  if (onPo.length || (row && row.poNumber)) {
    const po = onPo.length ? poShow(onPo[0].poNumber) : poShow(row.poNumber)
    return { id: 'onpo', tone: 'info', label: `🧾 On PO ${po}`, detail: onPo.length ? `${short(onPo[0].wholesaler)} — waiting to pick up` : `${row.supplier} quote ${row.quoteNumber}` }
  }
  if (req && req.fromCatalog) return hasPoNumber(req)
    ? { id: 'onpo', tone: 'info', label: `🧾 On PO ${poShow(req.poNumber)}`, detail: 'Catalog quote — waiting to pick up' }
    : { id: 'quoted', tone: 'info', label: '📒 Quoted from our Catalog', detail: 'Needs a PO' }
  if (row) return { id: 'quoted', tone: 'info', label: `💬 Quoted — ${row.supplier} ${row.quoteNumber}`, detail: 'Needs a PO' }
  if (linkedQuote) return { id: 'quoted', tone: 'info', label: `💬 Quoted — ${short(linkedQuote.wholesaler)} ${linkedQuote.invoiceNumber || ''}`.trim(), detail: 'Needs a PO · linked by you' }
  if (req) return { id: 'sent', tone: 'info', label: `${req.phoned ? '📞 Phoned in' : '📨 Sent'} to ${req.wholesaler || 'supplier'} ${day(req.sentAt)}`, detail: 'Waiting for the quote' }
  if ((orderList || []).some(i => (i.planRefs || []).some(p => p.jobId === job.id && p.lineId === line.id))) return { id: 'queued', tone: 'muted', label: '📝 On the order sheet', detail: 'Not sent yet' }
  return { id: 'toorder', tone: 'warn', label: '🚚 To order' }
}

export const STATUS_ORDER = ['undecided', 'pickstock', 'toorder', 'queued', 'sent', 'quoted', 'onpo', 'partial', 'reserved', 'received']
export function planSummary(statuses) {
  const c = id => statuses.filter(s => s.id === id).length
  return {
    total: statuses.length,
    needs: c('undecided') + c('pickstock') + c('toorder') + statuses.filter(s => s.tone === 'bad').length,
    stock: c('reserved') + c('pickstock'),
    ordering: c('toorder') + c('queued') + c('sent') + c('quoted'),
    onPo: c('onpo') + c('partial'),
    received: c('received'),
    undecided: c('undecided'),
  }
}

// Put planned lines on the shared order sheet, merging with a line for the
// same part already there; each sheet line remembers which job lines it covers
export function addPlanLinesToOrderList(list, job, lines, uid) {
  let next = [...(list || [])]
  for (const l of lines) {
    const ref = { jobId: job.id, jobName: job.name || 'Job', lineId: l.id, qty: n(l.qty) }
    const i = next.findIndex(x => (x.planRefs || []).length && sameItem({ partNo: x.partNo, name: x.desc }, lineLike(l)) && (x.uom || '') === (l.uom || ''))
    if (i >= 0) {
      const x = next[i]
      const refs = [...(x.planRefs || []).filter(p => !(p.jobId === job.id && p.lineId === l.id)), ref]
      next[i] = { ...x, qty: refs.reduce((a, p) => a + n(p.qty), 0), planRefs: refs, ...jobLabel(refs) }
    } else {
      next = [...next, { id: uid(), qty: n(l.qty), partNo: l.partNo || '', desc: l.item || '', nickname: '', uom: l.uom || '', source: 'plan', planRefs: [ref], ...jobLabel([ref]) }]
    }
  }
  return next
}
export function jobLabel(refs) {
  const byJob = new Map()
  ;(refs || []).forEach(p => byJob.set(p.jobId, { name: p.jobName, qty: (byJob.get(p.jobId)?.qty || 0) + n(p.qty) }))
  const list = [...byJob.entries()]
  return list.length === 1 ? { jobId: list[0][0], jobName: list[0][1].name } : { jobId: '', jobName: list.map(([, v]) => `${v.name} (${v.qty})`).join(' · ') }
}

// When a quote / slip comes back for a request that carried job lines, tag
// its untagged lines to those jobs (split by what each job asked for).
// → null, or the new orders list
export function tagSlipsFromRequests(orders, requests, feedRows) {
  const poNorm = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^po/, '').replace(/^0+/, '')
  let changed = false
  const next = (orders || []).map(o => {
    if (slipKind(o) !== 'order') return o
    const reqs = (requests || []).filter(r => !r.removedAt && (r.matchedFeedId || (r.fromCatalog && hasPoNumber(r))) && (r.items || []).some(i => (i.planRefs || []).length)).filter(r => {
      if (r.fromCatalog) return hasPoNumber(o) && poNorm(o.poNumber) === poNorm(r.poNumber)
      const row = (feedRows || []).find(x => x.id === r.matchedFeedId)
      if (!row) return false
      if (o.feedKey && String(o.feedKey).startsWith(row.id)) return true
      return hasPoNumber(o) && row.poNumber && poNorm(o.poNumber) === poNorm(row.poNumber)
    })
    if (!reqs.length) return o
    let lineChanged = false
    const lineItems = (o.lineItems || []).map(li => {
      if ((li.jobIds || []).length || (o.jobs || []).length || li.autoTagged) return li
      const item = reqs.flatMap(r => r.items || []).find(i => (i.planRefs || []).length && sameItem({ partNo: i.partNo, name: i.desc }, { partNo: li.partNo, name: li.name }))
      if (!item) return li
      const ids = [...new Set(item.planRefs.map(p => p.jobId))]
      lineChanged = true
      if (ids.length === 1) return { ...li, jobIds: ids, autoTagged: true }
      // several jobs: each gets what it asked for, as far as the line goes
      let left = n(li.qty)
      const usedBy = {}
      item.planRefs.forEach(p => { const take = Math.min(n(p.qty), left); if (take > 0) { usedBy[p.jobId] = (usedBy[p.jobId] || 0) + take; left -= take } })
      return { ...li, jobIds: ids, usedBy, autoTagged: true }
    })
    if (!lineChanged) return o
    changed = true
    return { ...o, lineItems }
  })
  return changed ? next : null
}
