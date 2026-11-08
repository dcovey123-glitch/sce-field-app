import { normalizeLines } from './units.js'
// Shared rules for material slips (the `material_orders` store).
//
// A slip is either:
//   kind 'order'   — a Material Order: lines go to job(s) and/or Stock
//   kind 'pricing' — a Pricing Quote: prices go to the Catalog, and if it is
//                    tagged to one of Dustin's quotes, it's compared to that
//                    quote's material list
// Older slips have no kind: recordOnly ones are pricing, the rest are orders.
//
// Life of a material order: confirmed → received → on the weekly timesheet
// list → sent to Jonathan (when that timesheet is exported) → archived once
// it's sent, fully received and every line is allocated (job or Stock).

export const GENERAL_STOCK_ID = 'general-stock'

// ── Quote → packing slips ──
// What usually comes in on a PO: the wholesaler's QUOTE (what was ordered)
// and the PACKING SLIPS from each pick-up (what was actually picked up) —
// no final invoice. A quote document saved here (docType 'quote') is the
// order for its PO: until a packing slip comes in, its lines are the job's
// material; once one does, the packing slips take over and the quote is just
// what they're checked against (and what's still to come).
const poKey = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^po/, '').replace(/^0+/, '')
export function isQuoteDoc(o) { return !!o && o.docType === 'quote' }
// One PO can cover several orders (each its own reference #, plus releases
// -01, -02…). A packing slip belongs to the order with the same reference #,
// or the one it shares items with.
const nrm = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '')
const nrmD = s => String(s || '').toLowerCase().replace(/[^0-9a-z]+/g, ' ').trim()
const refBase = s => nrm(String(s || '').trim().replace(/[-/ .](bo|b\/o|\d{1,3})$/i, ''))
const lineKeyOf = li => nrm(li.partNo) || nrmD(li.name || li.desc)
// The wholesaler + order # without the release / backorder suffix
// ("Nedco 5962096-03" and "NEDCO - DIV. OF REXEL 5962096-04" → same order)
export function orderBaseKey(o) {
  const base = refBase(o && o.invoiceNumber)
  if (!base) return ''
  const who = (String((o && o.wholesaler) || '').toLowerCase().match(/[a-z]+/) || [''])[0]
  return who + ':' + base
}
export function orderBaseLabel(o) { return String((o && o.invoiceNumber) || '').trim().replace(/[-/ .](bo|b\/o|\d{1,3})$/i, '') }
export function sameOrder(a, b) {
  if (!a || !b) return false
  if (a.id && a.id === b.id) return true
  const ra = refBase(a.invoiceNumber), rb = refBase(b.invoiceNumber)
  if (ra && rb && ra === rb) return true
  const ka = new Set((a.lineItems || []).map(lineKeyOf).filter(Boolean))
  return (b.lineItems || []).some(li => ka.has(lineKeyOf(li)))
}
// Packing slips on this quote's own order (not other orders on the same PO)
export function packingSlipsForQuote(orders, q) { return packingSlipsOnPo(orders, q.poNumber).filter(x => sameOrder(q, x)) }
export function packingSlipsOnPo(orders, po) {
  const k = poKey(po)
  return k ? (orders || []).filter(x => slipKind(x) === 'order' && !x.recordOnly && !isQuoteDoc(x) && poKey(x.poNumber) === k) : []
}
export function quoteDocsOnPo(orders, po) {
  const k = poKey(po)
  return k ? (orders || []).filter(x => slipKind(x) === 'order' && isQuoteDoc(x) && poKey(x.poNumber) === k) : []
}
// A quote whose packing slips have come in — no longer counts as material
export function isReplacedQuote(o, orders) { return isQuoteDoc(o) && packingSlipsForQuote(orders, o).length > 0 }

// With a PO it's an order (material bought). Without one it's a pricing
// quote — prices checked against / added to the Catalog (and compared to the
// quote it's tagged to) — until it gets a PO. A slip already received or put
// on jobs without a PO (a cash pick-up) stays an order.
export const hasPoNumber = o => !!String((o && o.poNumber) || '').replace(/^po\s*#?\s*/i, '').trim()
// Pricing = tagged "Quote for Pricing" (and nothing else). Everything else
// is an order: with a PO, waiting for one, or (older / picked up) without one.
export function slipKind(o) {
  if (hasPoNumber(o)) return 'order'
  return (o.kind || (o.recordOnly ? 'pricing' : 'order')) === 'pricing' ? 'pricing' : 'order'
}
const slipOnJobsOrReceived = o => !!o.receivedAt || (o.jobs || []).length > 0 || (o.lineItems || []).some(li => li.received || (li.jobIds || []).length || (li.usedBy && Object.keys(li.usedBy).length))
// An order with no PO: 'waiting' (a recent quote, nothing done with it yet)
// or 'none' (picked up / on jobs / older than 30 days — find the PO later)
export function noPoState(o) {
  if (hasPoNumber(o) || slipKind(o) !== 'order') return null
  const age = Date.now() - Date.parse(o.orderDate || o.createdAt || 0)
  return !slipOnJobsOrReceived(o) && !(age > 30 * 86400000) ? 'waiting' : 'none'
}
export function isFullyReceived(o) {
  const items = o.lineItems || []
  return items.length > 0 && items.every(li => li.received)
}
export function lineJobIds(li) { return (li.jobIds || []).filter(id => id && id !== GENERAL_STOCK_ID) }

// ── Shared lines ──
// A line can be on one job, several jobs, Stock, or a mix. Which jobs: the
// line's own job tags, or — when the line has none — the jobs the whole slip
// is tagged to. How much each job used is kept on the line (usedBy), so a
// line shared by Project A and B has one pool: use 50 ft on A and B sees the
// same remaining.
export function lineJobsOf(o, li) {
  if ((li.jobIds || []).length) return lineJobIds(li)
  return (o && o.jobs ? o.jobs : []).map(j => j.id).filter(id => id && id !== GENERAL_STOCK_ID)
}
const n = v => Number(v) || 0
// A line on General Stock and no real job — its own tag, or (no tags of its
// own) the slip is on General Stock only. Stock takes whatever's left of it.
export function isStockOnlyLine(o, li) {
  if (lineJobsOf(o, li).length) return false
  if ((li.jobIds || []).length) return li.jobIds.includes(GENERAL_STOCK_ID)
  return !!(o && (o.jobs || []).some(j => j && j.id === GENERAL_STOCK_ID))
}
export function lineUse(o, li) {
  if (li.usedBy && typeof li.usedBy === 'object') {
    // Stock-only line: Stock takes all of it. A line with jobs keeps its leftover
    // with the job until the job is closed out (then it's used or pushed to Stock).
    if (!isStockOnlyLine(o, li)) return li.usedBy
    const rest = n(li.qty) - Object.values(li.usedBy).reduce((a, v) => a + n(v), 0)
    return rest > 0 ? { ...li.usedBy, [GENERAL_STOCK_ID]: n(li.usedBy[GENERAL_STOCK_ID]) + rest } : li.usedBy
  }
  // Older slips (before shared lines): a one-job line was all that job's,
  // a line tagged to several jobs was split evenly, a Stock line all Stock.
  const jobs = lineJobsOf(o, li)
  const q = n(li.qty)
  if (!jobs.length) return isStockOnlyLine(o, li) ? { [GENERAL_STOCK_ID]: q } : {}
  if (jobs.length === 1) return { [jobs[0]]: q }
  if ((li.jobIds || []).length) return Object.fromEntries(jobs.map(j => [j, q / jobs.length]))
  return {}
}
// usedBy for a newly confirmed line: one job → all of it; several → nothing
// yet (each job takes what it used); only Stock → all Stock.
export function initialUse(o, li) {
  const jobs = lineJobsOf(o, li)
  if (jobs.length === 1) return { [jobs[0]]: n(li.qty) }
  if (isStockOnlyLine(o, li)) return { [GENERAL_STOCK_ID]: n(li.qty) }
  return {}
}
export function lineUsed(o, li) { return Object.values(lineUse(o, li)).reduce((a, v) => a + n(v), 0) }
export function lineRemaining(o, li) { return Math.max(0, Math.round((n(li.qty) - lineUsed(o, li)) * 1000) / 1000) }
export function lineIsAllocated(li, o) {
  if (li && li.movedTo) return true
  if (!o) return (li.jobIds || []).length > 0
  return lineRemaining(o, li) <= 0.0005
}
export function isFullyAllocated(o) {
  const items = o.lineItems || []
  return items.length > 0 && items.every(li => lineIsAllocated(li, o))
}
export function isArchived(o) {
  if (o.archivedAt) return true
  if (slipKind(o) === 'pricing') return !!(o.pricingPushedAt || o.quoteComparedAt)
  // a quote is done once its packing slips took over and the PO balanced
  if (isQuoteDoc(o) && o.replacedAt) return isBalanced(o)
  return !!o.sentAt && isFullyReceived(o) && isFullyAllocated(o) && isBalanced(o)
}
// The quote and all the slips on its PO balance (or it was forced received)
export function isBalanced(o) { return !!(o.poBalancedAt || o.forceReceivedAt) }
// What's still in the way of archiving (shown on the slip)
export function archiveBlockers(o) {
  if (slipKind(o) === 'pricing') return o.pricingPushedAt || o.quoteComparedAt ? [] : ['not checked against Catalog yet']
  const out = []
  if (!isFullyReceived(o)) out.push('not fully received')
  if (!isBalanced(o)) out.push('quote & slips not balanced')
  const un = (o.lineItems || []).filter(li => !lineIsAllocated(li, o)).length
  if (un) out.push(`${un} line${un === 1 ? '' : 's'} not fully used on jobs or moved to Stock`)
  if (!o.sentAt) out.push('not sent to Jonathan yet')
  return out
}

// Key that ties a slip line to a job's material entry
export function slipLineKey(orderId, li, idx) { return `slip:${orderId}:${li.id || idx}` }

// The job material entries a slip's lines produce for one job: whatever that
// job has used of each line (lines it hasn't used yet get no entry).
export function slipUnit(li) {
  return n(li.totalPrice) && n(li.qty) ? n(li.totalPrice) / n(li.qty) : (li.cost != null && li.cost !== '' ? n(li.cost) : 0)
}
export function slipSource(order) {
  return [order.wholesaler, order.invoiceNumber && `Inv ${order.invoiceNumber}`, order.poNumber && `PO ${order.poNumber}`].filter(Boolean).join(' · ')
}
export function slipEntry(order, li, idx, qty, uid) {
  return {
    id: uid(), kind: 'order', orderKey: slipLineKey(order.id, li, idx), slipOrderId: order.id,
    qty: Math.round(n(qty) * 1000) / 1000, uom: li.uom || '', partNo: li.partNo || '',
    item: li.nickname || li.name || li.partNo || 'Material', price: Math.round(slipUnit(li) * 10000) / 10000, source: slipSource(order),
  }
}
export function jobEntriesFromSlip(order, jobId, uid) {
  return (order.lineItems || []).map((li, idx) => {
    if (li.movedTo) return null // came on a later release — charged from that slip
    if (!lineJobsOf(order, li).includes(jobId)) return null
    const q = n(lineUse(order, li)[jobId])
    return q > 0 ? slipEntry(order, li, idx, q, uid) : null
  }).filter(Boolean)
}
// Every job a slip touches (tagged, or has used some of a line)
export function jobsOnSlip(order) {
  const ids = new Set()
  ;(order.lineItems || []).forEach(li => {
    lineJobsOf(order, li).forEach(id => ids.add(id))
    Object.keys(lineUse(order, li)).forEach(id => id !== GENERAL_STOCK_ID && ids.add(id))
  })
  return [...ids]
}

// Orders that touch a job: tagged to it, or any line on it
export function ordersForJob(orders, jobId) {
  return (orders || []).filter(o => slipKind(o) === 'order' && !isReplacedQuote(o, orders) && (
    (o.jobs || []).some(j => j.id === jobId) || (o.lineItems || []).some(li => lineJobsOf(o, li).includes(jobId))
  ))
}

// Material on this job's slips that's still unused. A line shared with other
// jobs only counts once ALL of its jobs are complete — until then the rest
// belongs to the jobs still going. isComplete(jobId) says whether a job is done.
export function leftoverLinesForJob(orders, project, isComplete) {
  const done = id => id === project.id || (isComplete ? isComplete(id) : false)
  const out = []
  ordersForJob(orders, project.id).forEach(o => {
    ;(o.lineItems || []).forEach((li, idx) => {
      const jobs = lineJobsOf(o, li)
      if (jobs.length && !jobs.includes(project.id)) return
      if (!jobs.every(done)) return
      const remaining = lineRemaining(o, li)
      if (remaining > 0.0005) out.push({ order: o, li, idx, key: slipLineKey(o.id, li, idx), remaining })
    })
  })
  return out
}

// Close-out for one job: its slip lines with something not yet used by it
// or pushed to Stock. mode 'use' = the rest was used on this job; 'stock' =
// the rest goes to Stock. → { orders, entries, stockLines } to save.
export function closeOutLines(orders, project, items, mode, entries, uid) {
  const ids = new Set(items.map(x => x.order.id))
  const byOrder = new Map()
  items.forEach(x => { if (!byOrder.has(x.order.id)) byOrder.set(x.order.id, new Set()); byOrder.get(x.order.id).add(x.idx) })
  const stockLines = []
  const nextOrders = orders.map(o => {
    if (!ids.has(o.id)) return o
    const idxs = byOrder.get(o.id)
    const lineItems = (o.lineItems || []).map((li, i) => {
      if (!idxs.has(i)) return li
      const rest = lineRemaining(o, li)
      if (mode === 'stock') {
        if (li.received && rest > 0) stockLines.push({ order: o, li: { ...li, qty: rest } })
        return lineWithRestInStock(o, li)
      }
      const use = { ...lineUse(o, li) }
      use[project.id] = n(use[project.id]) + rest
      return { ...li, usedBy: use, jobIds: [...new Set([...lineJobsOf(o, li), project.id])] }
    })
    return { ...o, lineItems }
  })
  // the job's material list follows the slips
  let nextEntries = entries || []
  nextOrders.filter(o => ids.has(o.id)).forEach(o => {
    nextEntries = [...nextEntries.filter(e => e.slipOrderId !== o.id), ...jobEntriesFromSlip(o, project.id, uid)]
  })
  return { orders: nextOrders, entries: nextEntries, stockLines }
}

// A line after moving what's left of it into Stock
export function lineWithRestInStock(o, li) {
  const rest = lineRemaining(o, li)
  const use = { ...lineUse(o, li) }
  if (rest > 0) use[GENERAL_STOCK_ID] = n(use[GENERAL_STOCK_ID]) + rest
  return { ...li, usedBy: use, jobIds: [...new Set([...lineJobsOf(o, li), GENERAL_STOCK_ID])] }
}

// Everything a search should hit, archive included
export function slipSearchText(o) {
  return [
    o.wholesaler, o.invoiceNumber, o.poNumber, o.orderDate, o.fileName, o.note,
    o.pricingTarget?.quoteNumber, o.pricingTarget?.title,
    ...(o.jobs || []).map(j => `${j.customerName || ''} ${j.name || ''}`),
    ...(o.lineItems || []).map(li => `${li.partNo || ''} ${li.name || ''} ${li.nickname || ''}`),
  ].filter(Boolean).join(' ').toLowerCase()
}

// Simple match between a slip/quote line and another list's line
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export function sameItem(a, b) {
  const pa = norm(a.partNo), pb = norm(b.partNo)
  if (pa && pb) return pa === pb
  const da = norm(a.name || a.desc || a.item), db = norm(b.name || b.desc || b.item)
  return !!da && da === db
}

// Add slip lines to the Stock list (same matching as receiving an order:
// part #, then nickname, then name). Returns the new list.
function findStockMatch(list, li) {
  const lc = s => String(s || '').toLowerCase()
  if (li.partNo) { const m = list.find(s => s.partNo && lc(s.partNo) === lc(li.partNo)); if (m) return m }
  if (li.nickname) { const m = list.find(s => s.nickname && lc(s.nickname) === lc(li.nickname)); if (m) return m }
  return list.find(s => s.name && li.name && lc(s.name) === lc(li.name))
}
export function mergeIntoStock(list, order, lineItems, uid) {
  let next = list || []
  lineItems.forEach(li => {
    const existing = findStockMatch(next, li)
    if (existing) {
      next = next.map(s => s.id === existing.id ? {
        ...s,
        qty: (Number(s.qty) || 0) + (Number(li.qty) || 0),
        cost: li.cost != null && li.cost !== '' ? Number(li.cost) : s.cost,
        totalPrice: li.totalPrice != null && li.totalPrice !== '' ? Number(li.totalPrice) : s.totalPrice,
        uom: li.uom || s.uom,
        nickname: li.nickname || s.nickname,
        orderId: order.id,
      } : s)
    } else {
      next = [...next, {
        id: uid(), name: li.name, partNo: li.partNo, nickname: li.nickname || '', uom: li.uom || '', qty: Number(li.qty) || 0,
        cost: Number(li.cost) || 0, totalPrice: li.totalPrice != null ? Number(li.totalPrice) : null,
        orderId: order.id,
      }]
    }
  })
  return next
}

// A feed quote's lines (Orders & POs) in slip-line shape for comparing
export function feedPartLines(part) {
  return normalizeLines((part.lines || []).map(l => ({ partNo: l.partNo, name: l.desc, uom: l.uom, qty: l.qty, totalPrice: l.ext, cost: null })))
}

// Take qty back off the Stock list (material that went to Stock but belongs on a job)
export function takeFromStock(list, li, qty) {
  const m = findStockMatch(list || [], li)
  if (!m) return list
  return list.map(s => s.id === m.id ? { ...s, qty: Math.max(0, r3s((Number(s.qty) || 0) - qty)) } : s)
}

// Change how much of a slip line one job used, from the job's material list.
// Returns { orders, entry (null when 0), max } or null if the line's gone.
export function setSlipLineUse(orders, entry, jobId, qty, uid) {
  const o = orders.find(x => x.id === entry.slipOrderId)
  if (!o) return null
  const idx = (o.lineItems || []).findIndex((li, i) => slipLineKey(o.id, li, i) === entry.orderKey)
  if (idx < 0) return null
  const li = o.lineItems[idx]
  const use = { ...lineUse(o, li) }
  const others = Object.entries(use).filter(([k]) => k !== jobId).reduce((a, [, v]) => a + n(v), 0)
  const max = r3s(n(li.qty) - others)
  const q = r3s(Math.max(0, Math.min(n(qty), max)))
  if (q > 0) use[jobId] = q; else delete use[jobId]
  const nl = { ...li, usedBy: use, jobIds: [...new Set([...lineJobsOf(o, li), jobId])] }
  const nextOrders = orders.map(x => x.id !== o.id ? x : { ...x, lineItems: x.lineItems.map((l2, i) => i === idx ? nl : l2) })
  return { orders: nextOrders, entry: q > 0 ? { ...slipEntry(o, nl, idx, q, uid), id: entry.id } : null, max }
}


// ── Quote → packing slips, for job charges ──
// The quote is what was ordered (the total). Packing slips are what came,
// and once they're in they're what's charged. A job charged from a quote —
// a quote document in Materials, or an email-run quote's lines — moves to the
// matching slip lines (by part #, then description), taking from what that
// line had going to Stock if it has to. What the slips don't cover (a slip
// still missing) stays charged from the quote, so nothing is lost or doubled.
// Same answer every time it runs. → null when nothing changes, else
// { orders, ordersChanged, entries, stockTaken }
const r3s = v => Math.round(v * 1000) / 1000
const poNorm = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^po/, '').replace(/^0+/, '')
function chargeQuoteEntriesToSlips(orders, job, quoteEntries, slipsFor, uid) {
  const entries = job.materialEntries || []
  if (!quoteEntries.length) return null
  const next = orders.map(o => ({ ...o, lineItems: [...(o.lineItems || [])] }))
  const touched = new Set(), stockTaken = []
  let linesChanged = false
  const replaced = new Map() // entry id → new entry or null
  for (const e of quoteEntries) {
    const ordered = n(e.quoteQty != null ? e.quoteQty : e.qty)
    const slips = slipsFor(e).map(x => next.find(o => o.id === x.id)).filter(Boolean)
    const lines = []
    slips.forEach(sl => sl.lineItems.forEach((li, idx) => {
      if (!li.movedTo && sameItem({ partNo: li.partNo, name: li.name }, { partNo: e.partNo, name: e.item })) lines.push({ s: sl, idx })
    }))
    if (!lines.length) continue // nothing on the slips to match: leave it
    let mine = lines.reduce((a, { s: sl, idx }) => a + n(lineUse(sl, sl.lineItems[idx])[job.id]), 0)
    for (const { s: sl, idx } of lines) {
      if (mine >= ordered) break
      const li = sl.lineItems[idx]
      const use = { ...lineUse(sl, li) }
      const cur = n(use[job.id]), stockUse = n(use[GENERAL_STOCK_ID])
      const others = Object.entries(use).filter(([k]) => k !== job.id && k !== GENERAL_STOCK_ID).reduce((a, [, v]) => a + n(v), 0)
      const free = Math.max(0, n(li.qty) - others - cur - stockUse)
      const want = ordered - mine
      const fromFree = Math.min(want, free), fromStock = Math.min(want - fromFree, stockUse)
      if (fromFree + fromStock <= 0) continue
      use[job.id] = r3s(cur + fromFree + fromStock)
      if (fromStock > 0) {
        const left = r3s(stockUse - fromStock)
        if (left > 0) use[GENERAL_STOCK_ID] = left; else delete use[GENERAL_STOCK_ID]
        if (li.received) stockTaken.push({ li, qty: fromStock })
      }
      sl.lineItems[idx] = { ...li, usedBy: use, jobIds: [...new Set([...lineJobsOf(sl, li), job.id, ...(use[GENERAL_STOCK_ID] ? [GENERAL_STOCK_ID] : [])])] }
      linesChanged = true
      touched.add(sl.id)
      mine += fromFree + fromStock
    }
    lines.forEach(({ s: sl }) => { if (n(lineUse(sl, sl.lineItems[lines.find(x => x.s === sl).idx])[job.id]) > 0) touched.add(sl.id) })
    const rest = r3s(ordered - mine)
    replaced.set(e.id, rest > 0.0005 ? { ...e, quoteQty: ordered, qty: rest, note: 'Rest of the quote — slip not in yet' } : null)
  }
  let out = entries.flatMap(e => replaced.has(e.id) ? (replaced.get(e.id) ? [replaced.get(e.id)] : []) : [e])
  for (const id of touched) {
    const sl = next.find(o => o.id === id)
    const fresh = jobEntriesFromSlip(sl, job.id, uid)
    const old = out.filter(e => e.slipOrderId === id)
    out = [...out.filter(e => e.slipOrderId !== id), ...fresh.map(f => { const o = old.find(x => x.orderKey === f.orderKey); return o ? { ...f, id: o.id } : f })]
  }
  // unchanged? (same lines, same qtys)
  const sig = list => list.map(e => `${e.orderKey || e.id}:${n(e.qty)}`).sort().join('|')
  if (!linesChanged && sig(out) === sig(entries)) return null
  return { orders: linesChanged ? next : orders, ordersChanged: linesChanged, entries: out, stockTaken }
}

// A quote document in Materials (Parsed details) whose packing slips came in
export function moveQuoteChargesToSlips(orders, job, uid) {
  const quoteEntries = (job.materialEntries || []).filter(e => {
    if (!e.slipOrderId) return false
    const q = orders.find(o => o.id === e.slipOrderId)
    return !!q && isReplacedQuote(q, orders)
  })
  return chargeQuoteEntriesToSlips(orders, job, quoteEntries, e => packingSlipsForQuote(orders, orders.find(o => o.id === e.slipOrderId)), uid)
}

// An email-run quote's lines charged on the job, once slips on its PO are in
export function moveFeedChargesToSlips(orders, job, feedRows, uid) {
  const poOf = e => {
    if (e.kind !== 'order' || e.slipOrderId || !e.orderKey) return ''
    const r = (feedRows || []).find(x => x.id === String(e.orderKey).split('#')[0])
    return r && r.poNumber ? poNorm(r.poNumber) : ''
  }
  const slipsOn = po => (orders || []).filter(o => slipKind(o) === 'order' && !isQuoteDoc(o) && poNorm(o.poNumber) === po)
  const quoteEntries = (job.materialEntries || []).filter(e => { const po = poOf(e); return po && slipsOn(po).length })
  return chargeQuoteEntriesToSlips(orders, job, quoteEntries, e => slipsOn(poOf(e)), uid)
}
