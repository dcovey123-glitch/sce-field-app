// One record per purchase: the email run's quote / PO rows (current and
// archived) and the slips saved in Materials, grouped by PO — or, with no PO,
// by quote #. Each purchase sits in one stage, with plain-English flags for
// anything that needs you, and a "why" line saying how it got there.
import { hasPoNumber, slipKind, noPoState, isQuoteDoc, isArchived, lineIsAllocated, orderBaseKey } from './slips.js'
import { feedPoState, quoteNumbersOf, numKey } from './orders.js'
import { distributorName } from './monthDist.js'
import { catalogQuoteTotal } from './requests.js'

export const STAGES = [
  { id: 'requested', label: 'Requested', icon: '📨', hint: 'Order or pricing list sent — waiting for the quote to come back' },
  { id: 'pricing', label: 'Pricing', icon: '💲', hint: 'Quotes kept for pricing — give one a PO to order it' },
  { id: 'waiting', label: 'Waiting for PO', icon: '⏳', hint: 'Quotes for material being bought, no PO yet' },
  { id: 'ordered', label: 'Ordered', icon: '📦', hint: 'PO issued, not all picked up' },
  { id: 'received', label: 'Received', icon: '📥', hint: 'All in, not sent to Jonathan yet' },
  { id: 'sent', label: 'Sent to Jonathan', icon: '📤', hint: 'On a timesheet, something still open' },
  { id: 'closed', label: 'Closed', icon: '✓', hint: 'Done' },
]

const poKey = s => String(s || '').toLowerCase().replace(/^po\s*#?\s*/, '').replace(/[^0-9a-z]/g, '')
const poShow = s => String(s || '').replace(/^po\s*#?\s*/i, '').trim()
const invBase = s => numKey(String(s || '').replace(/-\d{1,2}$/, ''))
const days = d => { const t = Date.parse(d || ''); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000) }
const slipTotal = o => Number(o.invoiceTotal) || (o.lineItems || []).filter(li => !li.movedTo).reduce((a, li) => a + (Number(li.totalPrice) || (Number(li.qty) || 0) * (Number(li.cost) || 0)), 0)
const isMaterialSlip = o => !o.kind || o.kind === 'order' || o.kind === 'pricing'

export function buildPurchases({ slips = [], feed = [], previous = [], marks = {}, billingFlag = () => false, requests = [] }) {
  const map = new Map()
  const get = k => { if (!map.has(k)) map.set(k, { key: k, slips: [], rows: [], requests: [] }); return map.get(k) }
  const byQuote = new Map()
  const rows = [...feed.filter(r => !r.archived).map(r => ({ ...r, _prev: false })), ...previous.map(r => ({ ...r, _prev: true }))]
  for (const r of rows) {
    const k = hasPoNumber(r) ? 'po:' + poKey(r.poNumber) : 'q:' + r.id
    get(k).rows.push(r)
    quoteNumbersOf(r).forEach(n => { const q = numKey(n); if (q.length >= 4 && !byQuote.has(q)) byQuote.set(q, k) })
  }
  for (const o of slips) {
    if (!isMaterialSlip(o)) continue
    const k = hasPoNumber(o) ? 'po:' + poKey(o.poNumber)
      : byQuote.get(numKey(o.invoiceNumber)) || byQuote.get(invBase(o.invoiceNumber)) || 'slip:' + (orderBaseKey(o) || o.id)
    get(k).slips.push(o)
  }
  // a quote with no PO whose quote # turns up on a slip under a PO: same purchase
  for (const [k, g] of [...map]) {
    if (!k.startsWith('q:') || g.slips.length) continue
    const nums = g.rows.flatMap(quoteNumbersOf).map(numKey)
    const home = [...map.values()].find(x => x !== g && x.slips.some(o => nums.includes(numKey(o.invoiceNumber)) || nums.includes(invBase(o.invoiceNumber))))
    if (home) { home.rows.push(...g.rows); map.delete(k) }
  }
  // what you sent: with the quote it was matched to, or on its own until then
  for (const q of requests || []) {
    if (!q || q.removedAt) continue
    const home = q.matchedFeedId && [...map.values()].find(g => g.rows.some(r => r.id === q.matchedFeedId))
    if (home) home.requests.push(q)
    else if (q.fromCatalog && hasPoNumber(q)) get('po:' + poKey(q.poNumber)).requests.push(q)
    else get('req:' + q.id).requests.push(q)
  }
  return [...map.values()].map(p => finish(p, marks[p.key] || {}, billingFlag))
}

function finish(p, mark, billingFlag) {
  const { rows, slips } = p
  const requests = p.requests || []
  if (!rows.length && !slips.length && requests.length) return sentOnly(p, requests, mark)
  const cur = rows.filter(r => !r._prev)
  const po = poShow((rows.find(hasPoNumber) || slips.find(hasPoNumber) || requests.find(hasPoNumber) || {}).poNumber)
  // once packing slips are in, they're what came — the quote is just what was ordered
  const packing = slips.filter(o => !isQuoteDoc(o))
  const live = packing.length ? packing : slips.filter(o => !(isQuoteDoc(o) && o.replacedAt))
  const lines = live.flatMap(o => (o.lineItems || []).map(li => ({ o, li })))
  const supplier = distributorName((rows[0] || {}).supplier || (slips[0] || {}).wholesaler || (requests[0] || {}).wholesaler || '')
  const dates = [...rows.map(r => r.date), ...slips.map(o => o.orderDate)].filter(Boolean).sort()
  const date = dates[dates.length - 1] || ''
  const quotes = [...new Set([...rows.flatMap(quoteNumbersOf), ...slips.filter(isQuoteDoc).map(o => o.invoiceNumber), ...(requests.some(r => r.fromCatalog) ? ['Catalog quote'] : [])].filter(n => n && !/^order\s/i.test(n)))]
  const invoices = [...new Set(live.filter(o => !isQuoteDoc(o)).map(o => o.invoiceNumber).filter(Boolean))]
  const filing = rows.map(r => r.filedAs === 'stock' ? 'Shop stock' : r.filedAs === 'quote' ? (r.refLabel || r.ref) : r.filedAs === 'job' ? (r.ref || r.refLabel) : (r.ref || r.job)).find(Boolean) || ''
  const jobs = [...new Set(slips.flatMap(o => (o.jobs || []).map(j => j.name)).filter(Boolean))]
  const forWhat = filing || jobs.join(', ')
  const total = (cur[0] && Number(cur[0].quoteTotal)) || live.reduce((a, o) => a + slipTotal(o), 0) || (rows[0] && Number(rows[0].quoteTotal)) || 0
  const notes = [...rows.map(r => r.note), ...slips.map(o => o.note)].filter(Boolean)
  // Quote = what was ordered (the PO total). Packing slips = what came; they
  // should add up to the quote. Short and closed → the balance goes on the export.
  const r2 = v => Math.round(v * 100) / 100
  const quoteTotal = r2(Math.max(rows.reduce((m, r) => Math.max(m, Number(r.quoteTotal) || 0), 0),
    slips.filter(isQuoteDoc).reduce((a, o) => a + (slipTotal(o) || Number(o.subtotal) || 0), 0),
    requests.filter(r => r.fromCatalog).reduce((a, r) => a + catalogQuoteTotal(r), 0)))
  const slipSum = r2(packing.reduce((a, o) => a + slipTotal(o), 0))
  const shortBy = packing.length && quoteTotal ? r2(quoteTotal - slipSum) : 0
  const money = v => '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const slipVsQuote = packing.length && quoteTotal ? `slips ${money(slipSum)} of ${money(quoteTotal)}` : ''

  const oldRecord = slips.length > 0 && slips.every(o => o.archivedNote)
  // came back for a pricing request (sent from a quote) — kept for pricing; it
  // just needs your OK the first time
  const fromPricingReq = !po && requests.some(r => r.pricing && !r.removedAt)
  const toConfirm = fromPricingReq && requests.some(r => r.pricing && r.needsConfirm)
  const pricing = !po && (fromPricingReq || rows.some(r => feedPoState(r) === 'pricing') || (slips.length > 0 && slips.every(o => slipKind(o) === 'pricing')))
  const oldQuote = !po && !slips.length && rows.length > 0 && rows.every(r => r._prev)
  const forced = rows.some(r => r.forcedReceived) || slips.some(o => o.forceReceivedAt)
  const allLinesIn = lines.length > 0 && lines.every(x => x.li.received || x.li.movedTo)
  const anyIn = lines.some(x => x.li.received)
  const feedReceived = rows.some(r => r.status === 'Received')
  // the quote was received into jobs before its packing slips came in
  const qLines = slips.filter(isQuoteDoc).flatMap(o => o.lineItems || [])
  const quoteIn = packing.length > 0 && qLines.length > 0 && qLines.every(li => li.received || li.movedTo)
  const received = allLinesIn || quoteIn || forced || (!live.length && feedReceived)
  const sent = live.length > 0 && live.every(o => o.sentAt)
  const unused = (pricing || oldRecord) ? 0 : lines.filter(x => !x.li.movedTo && !lineIsAllocated(x.li, x.o)).length
  const billed = live.some(o => billingFlag(o))
  const allArchived = slips.length > 0 && slips.every(isArchived)
  const feedClosed = !slips.length && rows.length > 0 && rows.every(r => r.status === 'Closed')
  const age = days(date)

  let stage, why
  if (pricing || oldQuote || (!po && feedClosed)) {
    stage = 'pricing'
    const forQuote = (requests.find(r => r.quote) || {}).quote
    why = toConfirm ? `Came back for your pricing request${forQuote ? ' (quote ' + (forQuote.number || forQuote.title) + ')' : ''} — confirm it's for pricing`
      : pricing ? `No PO · kept for pricing${filing ? ' (' + filing + ')' : forQuote ? ' (quote ' + (forQuote.number || forQuote.title) + ')' : ''}` : 'No PO · old quote the email run archived'
  } else if (!po && !anyIn && !slips.some(o => noPoState(o) === 'none')) {
    stage = 'waiting'; why = `Quote in ${date || ''} · no PO yet`
  } else if (mark.closed || oldRecord || allArchived || (po && feedClosed)) {
    stage = 'closed'
    why = mark.closed ? `Closed by you${mark.reason ? ' — ' + mark.reason : ''}` : oldRecord ? 'Old pick-up record (before job tracking)' : allArchived ? 'Sent, every line on a job or Stock, balanced' : 'Closed in Orders & POs'
  } else if (!received) {
    stage = 'ordered'
    why = po ? `PO ${po}${anyIn ? ` · ${lines.filter(x => x.li.received).length} of ${lines.length} lines received` : live.length ? ' · nothing received yet' : ' · no slip yet'}` : 'Picked up without a PO'
  } else if (!live.length) {
    stage = 'received'; why = `PO ${po} · received${forced ? ' (closed without slips)' : ''} · no slip in Materials`
  } else if (!sent) {
    stage = 'received'; why = `${po ? 'PO ' + po + ' · ' : ''}all received · not sent to Jonathan yet`
  } else if (unused || billed) {
    stage = 'sent'; why = 'Sent to Jonathan · something still open'
  } else {
    stage = 'closed'; why = 'Sent, every line on a job or Stock'
  }

  if (slipVsQuote && (stage !== 'closed' || shortBy > 1)) why += ` · ${slipVsQuote}${forced && shortBy > 1 ? ` (closed short — ${money(shortBy)} balance line on the export)` : ''}`
  // What needs you (only on open things)
  const flags = []
  if (stage === 'pricing' && toConfirm) flags.push({ id: 'confirmpricing', text: 'Confirm it\'s for pricing', tone: 'info' })
  const missing = po && stage !== 'pricing' ? slips.filter(o => !hasPoNumber(o)) : []
  if (missing.length) flags.push({ id: 'slipnopo', text: `Slip missing PO ${po}`, tone: 'fix', fix: { kind: 'applyPo', po, ids: missing.map(o => o.id) } })
  if (stage !== 'closed' && stage !== 'pricing') {
    if (!po && stage !== 'waiting') flags.push({ id: 'nopo', text: 'No PO', tone: 'warn' })
    if (quoteIn && !allLinesIn) flags.push({ id: 'psnotrec', text: 'Packing slip not ticked received (the quote was)', tone: 'warn' })
    if (unused && received && !quoteIn) flags.push({ id: 'unused', text: `${unused} line${unused === 1 ? '' : 's'} not on a job/Stock`, tone: 'warn' })
    if (billed) flags.push({ id: 'billed', text: 'Billed differently than quoted', tone: 'bad' })
    if (forced && shortBy > 1) flags.push({ id: 'short', text: `Slips short ${money(shortBy)} — the balance goes on the timesheet export`, tone: 'info' })
    if (stage === 'received' && !live.length) flags.push({ id: 'noslip', text: 'No slip — push to export or close', tone: 'info' })
    if (stage === 'ordered' && age != null && age > 21) flags.push({ id: 'oldorder', text: `Ordered ${age} days ago`, tone: 'warn' })
    if (stage === 'waiting' && age != null && age > 14) flags.push({ id: 'oldwait', text: `No PO after ${age} days`, tone: 'warn' })
    if (rows.length && rows.every(r => r._prev) && stage === 'ordered') flags.push({ id: 'oldpo', text: 'Old PO — close it or add slips', tone: 'warn' })
  }
  return { ...p, po, supplier, date, age, quotes, invoices, forWhat, jobs, total, quoteTotal, slipSum, shortBy, notes, stage, why, flags, oldRecord, liveSlips: live, mark }
}

// Sent, no quote back yet
function sentOnly(p, requests, mark) {
  const q = requests[0]
  const date = String(q.sentAt || '').slice(0, 10)
  const age = days(q.sentAt)
  const jobs = [...new Set(requests.flatMap(r => (r.jobs || []).map(j => j.name)).filter(Boolean))]
  const n = (q.items || []).length
  const pricing = !!q.pricing
  const flags = []
  if (q.fromCatalog) {
    const total = catalogQuoteTotal(q), po = poShow(q.poNumber)
    const money = v => '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (!po && !mark.closed && age != null && age > 14) flags.push({ id: 'oldwait', text: `No PO after ${age} days`, tone: 'warn' })
    if (po && !mark.closed && age != null && age > 21) flags.push({ id: 'oldorder', text: `Ordered ${age} days ago`, tone: 'warn' })
    return {
      ...p, requests, po, supplier: q.wholesaler ? distributorName(q.wholesaler) === 'Unknown supplier' ? q.wholesaler : distributorName(q.wholesaler) : 'Catalog quote',
      date, age, quotes: ['Catalog quote'], invoices: [], forWhat: jobs.join(', ') || q.subject || '', jobs, total, quoteTotal: total, slipSum: 0, shortBy: 0,
      notes: [], stage: mark.closed ? 'closed' : po ? 'ordered' : 'waiting',
      why: mark.closed ? `Closed by you${mark.reason ? ' — ' + mark.reason : ''}` : `📒 Quoted from our Catalog ${date} (${n} item${n === 1 ? '' : 's'}, ${money(total)}) · ${po ? 'PO ' + po + ' · no slip yet' : 'no PO yet'}`,
      flags, oldRecord: false, liveSlips: [], mark,
    }
  }
  if (!pricing && !mark.closed && age != null && age > 4) flags.push({ id: 'noquote', text: `No quote back after ${age} days`, tone: 'warn' })
  return {
    ...p, requests, po: '', supplier: distributorName(q.wholesaler || '') === 'Unknown supplier' ? (q.wholesaler || 'PDF only') : distributorName(q.wholesaler),
    date, age, quotes: [], invoices: [], forWhat: jobs.join(', ') || q.subject || '', jobs, total: 0, quoteTotal: 0, slipSum: 0, shortBy: 0,
    notes: [], stage: mark.closed ? 'closed' : pricing ? 'pricing' : 'requested',
    why: mark.closed ? `Closed by you${mark.reason ? ' — ' + mark.reason : ''}` : `${pricing ? 'Pricing list' : 'Order'} ${q.phoned ? 'phoned in' : 'sent'} ${date} (${n} item${n === 1 ? '' : 's'}) · waiting for the quote`,
    flags, oldRecord: false, liveSlips: [], mark,
  }
}

export function purchaseSearchText(p) {
  return [p.supplier, p.po, ...p.quotes, ...p.invoices, p.forWhat, ...p.jobs, ...p.notes, p.why,
    ...p.rows.flatMap(r => [r.description, r.quoteNumber, r.poNumber, r.job, r.ref, r.refLabel, r.note, r.contact, r.date,
      ...Object.values(r.quoteLines || {}).flat().map(l => `${l.partNo || ''} ${l.desc || l.name || ''}`)]),
    ...(p.requests || []).flatMap(r => [r.wholesaler, r.subject, r.poNumber, r.fromCatalog ? 'catalog quote' : '', ...(r.jobs || []).map(j => j.name), ...(r.items || []).map(i => `${i.partNo} ${i.desc}`)]),
    ...p.slips.flatMap(o => [o.wholesaler, o.note, o.invoiceNumber, o.poNumber, o.orderDate, ...(o.jobs || []).map(j => j.name), ...(o.lineItems || []).map(li => `${li.partNo || ''} ${li.name || ''} ${li.nickname || ''}`)])]
    .filter(Boolean).join(' ').toLowerCase()
}
