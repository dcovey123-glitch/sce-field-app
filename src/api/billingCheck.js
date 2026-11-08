// Billing check: what the wholesaler billed/shipped (material-order slips)
// against what was ordered (the quote lines behind the PO in Orders & POs).
//
// The slip and the order are tied together by PO number. Every slip on the
// same PO counts toward that PO (partial shipments add up), except a second
// copy of the same document (a packing slip and the invoice for the same
// shipment carry the same invoice/order number, so they count once).

import { matchOrdersByPo, normPo, orderParts } from './orders.js'
import { isQuoteDoc, sameOrder } from './slips.js'

const num = v => Number(v) || 0
const r2 = v => Math.round(v * 100) / 100
const normPart = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '')
const normDesc = s => String(s || '').toLowerCase().replace(/[^0-9a-z]+/g, ' ').trim()

function sameLine(a, b) {
  const pa = normPart(a.partNo), pb = normPart(b.partNo)
  if (pa && pb) return pa === pb
  const da = normDesc(a.desc || a.name), db = normDesc(b.desc || b.name)
  return !!da && da === db
}

// Unit price on a slip line — prefer the printed line total ÷ qty, since
// wholesalers often print per-100 / per-1000 unit prices.
function slipUnit(li) {
  const q = num(li.qty), t = num(li.totalPrice)
  if (li.priceFromQuote) return null // filled in from the quote, not printed
  if (q && t) return t / q
  return li.cost != null && li.cost !== '' && num(li.cost) > 0 ? num(li.cost) : null
}
const hasPrices = s => (s.lineItems || []).some(li => !li.priceFromQuote && (num(li.totalPrice) > 0 || num(li.cost) > 0))

// ── Several orders on one PO ──
// One PO can cover several wholesaler orders, each with its own reference #
// (and releases of it: 5962096-03, -04…). A packing slip belongs to the order
// with the same reference # (any release), or the one it shares items with.
// What was ordered on a PO: the quote lines in Orders & POs, or — when that
// quote isn't there (or has no lines) — the quote document(s) saved on the PO.
// forSlip: only the quote document(s) that slip's order belongs to.
export function orderedOnPo(po, allSlips, feedRows, forSlip) {
  const matches = matchOrdersByPo(feedRows || [], po)
  const parts = matches.flatMap(orderParts)
  const ordered = []
  const add = (l, quote) => {
    const ex = ordered.find(o => sameLine(o, l))
    if (ex) { ex.qty += num(l.qty); ex.ext += num(l.ext) } else ordered.push({ partNo: l.partNo, desc: l.desc, uom: l.uom, qty: num(l.qty), ext: num(l.ext), quote })
  }
  parts.forEach(p => p.lines.forEach(l => add(l, p.number)))
  let total = r2(parts.reduce((a, p) => a + num(p.total), 0))
  const k = normPo(po)
  const allDocs = k ? (allSlips || []).filter(o => isQuoteDoc(o) && normPo(o.poNumber) === k) : []
  let docs = allDocs
  let source = matches.length ? 'feed' : ''
  if (!ordered.length && !total && forSlip && allDocs.length) docs = allDocs.filter(d => sameOrder(d, forSlip))
  if (!ordered.length && docs.length) {
    docs.forEach(d => (d.lineItems || []).forEach(li => add({ partNo: li.partNo, desc: li.name, uom: li.uom, qty: li.qty, ext: num(li.totalPrice) || num(li.cost) * num(li.qty) }, d.invoiceNumber || 'quote')))
    total = r2(docs.reduce((a, d) => a + (num(d.subtotal) || (d.lineItems || []).reduce((s, li) => s + num(li.totalPrice), 0)), 0))
    source = 'doc'
  }
  return { matches, ordered, total, docs, allDocs, source, has: !!(ordered.length || total) }
}
function shippedQty(li) {
  if (li.movedTo) return 0 // came on a later release
  // A line marked backordered with no charge is "ordered, nothing shipped"
  if (li.backordered && !num(li.totalPrice)) return 0
  return num(li.qty)
}

export function slipsOnSamePo(slip, allSlips) {
  const k = normPo(slip.poNumber)
  if (!k) return [slip]
  const same = (allSlips || []).filter(o => o.id !== slip.id && (o.kind || 'order') === 'order' && !o.recordOnly && !isQuoteDoc(o) && normPo(o.poNumber) === k)
  // Every slip on the PO counts — releases (-01, -02…), separate orders and
  // each page of a multi-page slip. The only thing skipped is a second COPY
  // of the same document: same reference # AND the same lines (e.g. the
  // packing slip and the invoice for one shipment, or the same slip saved twice).
  const sig = o => `${normPart(o.invoiceNumber)}::${(o.lineItems || []).map(li => `${normPart(li.partNo) || normDesc(li.name)}@${num(li.qty)}`).sort().join('|')}`
  const seen = new Set([sig(slip)])
  const out = [slip]
  same.sort((a, b) => (a.docType === 'invoice' ? -1 : 0) - (b.docType === 'invoice' ? -1 : 0)).forEach(o => {
    const key = sig(o)
    if (normPart(o.invoiceNumber) && seen.has(key)) return
    seen.add(key); out.push(o)
  })
  return out
}

// → { status: 'none' | 'noOrder' | 'totalsOnly' | 'ok' | 'flag', issues: [...], over, ordered, billed, matches, slips }
// issue: { type: 'price'|'overQty'|'extra'|'math'|'overTotal', partNo, desc, ... , amount (money it costs you, + = overcharged) }
// info:  { type: 'toCome'|'backordered', ... }  (not problems, just status)
export function billingCheck(slip, allSlips, feedRows) {
  const res = { status: 'none', issues: [], info: [], over: 0, matches: [], slips: [slip] }
  if (!slip || !normPo(slip.poNumber) || isQuoteDoc(slip)) return res
  const od = orderedOnPo(slip.poNumber, allSlips, feedRows, slip)
  const matches = od.matches
  res.matches = matches
  const lines = slip.lineItems || []
  // a separate order on a PO whose quote is another order's: nothing to check it against
  if (!matches.length && !od.docs.length && od.allDocs.length) { res.status = 'none'; res.separate = true; return res }

  // The slip's own arithmetic
  const lineSum = r2(lines.reduce((a, li) => a + num(li.totalPrice), 0))
  if (num(slip.subtotal) && lineSum && Math.abs(num(slip.subtotal) - lineSum) > 0.05) {
    res.issues.push({ type: 'math', desc: `Slip subtotal ${r2(num(slip.subtotal)).toFixed(2)} but its lines add up to ${lineSum.toFixed(2)}`, amount: r2(num(slip.subtotal) - lineSum) })
  }
  if (!matches.length && !od.docs.length) { res.status = 'noOrder'; finish(res); return res }

  const ordered = od.ordered
  const quotedTotal = od.total
  res.ordered = { total: quotedTotal, lines: ordered.length }

  const poSlips = od.source === 'doc' ? slipsOnSamePo(slip, allSlips).filter(s => s === slip || od.docs.some(d => sameOrder(d, s))) : slipsOnSamePo(slip, allSlips)
  res.slips = poSlips
  const billedPo = poSlips.reduce((a, o) => a + (o.lineItems || []).reduce((s, li) => s + (li.movedTo ? 0 : num(li.totalPrice)), 0), 0)
  res.billed = { thisSlip: lineSum, poTotal: r2(billedPo) }

  if (!ordered.length) {
    // The order only has a total — compare totals across the PO
    res.status = 'totalsOnly'
    if (quotedTotal && poSlips.some(hasPrices) && billedPo - quotedTotal > Math.max(1, quotedTotal * 0.01)) {
      res.issues.push({ type: 'overTotal', desc: `Billed ${r2(billedPo).toFixed(2)} on this PO so far vs quoted ${quotedTotal.toFixed(2)} (before tax)`, amount: r2(billedPo - quotedTotal) })
    }
    finish(res); return res
  }

  lines.filter(li => !li.movedTo).forEach(li => {
    const o = ordered.find(x => sameLine(x, li))
    const unit = slipUnit(li)
    const q = shippedQty(li)
    if (li.backordered) res.info.push({ type: 'backordered', partNo: li.partNo, desc: li.name, qty: num(li.qty), uom: li.uom })
    if (!o) {
      if (q > 0) res.issues.push({ type: 'extra', partNo: li.partNo, desc: li.name, qty: q, uom: li.uom, unit, amount: r2(li.priceFromQuote ? 0 : num(li.totalPrice)) })
      return
    }
    const oUnit = o.qty ? o.ext / o.qty : null
    if (unit != null && oUnit != null && q > 0 && Math.abs(unit - oUnit) > Math.max(0.01, oUnit * 0.005)) {
      res.issues.push({ type: 'price', partNo: li.partNo || o.partNo, desc: li.name || o.desc, qty: q, uom: li.uom || o.uom, unit: r2v(unit), orderedUnit: r2v(oUnit), quote: o.quote, amount: r2((unit - oUnit) * q) })
    }
  })

  // Quantities across every slip on this PO
  ordered.forEach(o => {
    let billedQty = 0, unitSeen = null
    poSlips.forEach(s => (s.lineItems || []).forEach(li => { if (sameLine(o, li)) { billedQty += shippedQty(li); unitSeen = slipUnit(li) ?? unitSeen } }))
    const onThis = lines.some(li => sameLine(o, li))
    if (billedQty - o.qty > 0.0001 && onThis) {
      const oUnit = o.qty ? o.ext / o.qty : (unitSeen || 0)
      res.issues.push({ type: 'overQty', partNo: o.partNo, desc: o.desc, qty: r2(billedQty), orderedQty: o.qty, uom: o.uom, quote: o.quote, amount: r2((billedQty - o.qty) * (unitSeen ?? oUnit)) })
    } else if (o.qty - billedQty > 0.0001) {
      res.info.push({ type: 'toCome', partNo: o.partNo, desc: o.desc, qty: r2(o.qty - billedQty), orderedQty: o.qty, uom: o.uom, quote: o.quote })
    }
  })
  finish(res)
  return res
}

const r2v = v => Math.round(v * 10000) / 10000
function finish(res) {
  res.over = r2(res.issues.reduce((a, i) => a + (i.amount > 0 ? i.amount : 0), 0))
  if (res.issues.length) res.status = 'flag'
  else if (res.status === 'noOrder') return
  else if (res.status === 'totalsOnly') res.status = 'okTotals'
  else res.status = 'ok'
}

const money = v => '$' + (Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Plain-text note to send the wholesaler (or Jonathan) about the differences
export function billingNoteText(slip, res) {
  const head = `${slip.wholesaler || 'Supplier'} ${slip.invoiceNumber ? 'invoice/slip ' + slip.invoiceNumber : 'slip'}${slip.poNumber ? ' — SCE PO ' + slip.poNumber : ''}`
  const rows = res.issues.map(i => {
    const what = `${i.partNo ? i.partNo + ' ' : ''}${i.desc || ''}`.trim()
    if (i.type === 'price') return `- ${what}: billed ${money(i.unit)}/${i.uom || 'ea'} vs quoted ${money(i.orderedUnit)}${i.quote ? ` (quote ${i.quote})` : ''} on ${i.qty} = ${money(i.amount)} ${i.amount > 0 ? 'over' : 'under'}`
    if (i.type === 'overQty') return `- ${what}: ${i.qty} ${i.uom || ''} billed on this PO vs ${i.orderedQty} ordered${i.quote ? ` (quote ${i.quote})` : ''} — about ${money(i.amount)} extra`
    if (i.type === 'extra') return `- ${what}: ${i.qty} ${i.uom || ''} billed (${money(i.amount)}) but not on the quote/PO`
    return `- ${i.desc}`
  })
  return `${head}\n\nThese don't match what was quoted/ordered:\n${rows.join('\n')}\n\nCan you please check and send a corrected invoice or credit? Thanks.`
}

// A flagged slip counts as dealt with once reviewed (and nothing new came up since)
export function isReviewed(slip, res) { return !!slip.billingReviewedAt && slip.billingReviewedCount === res.issues.length }

// ── Is this PO balanced? ──
// Balanced = the quote is in Orders & POs, the slips on the PO account for
// everything that was ordered, and every billing difference was reviewed.
// A forced receive (from Orders & POs, or on a slip) counts as balanced.
export function poStatus(po, allSlips, feedRows) {
  const out = { po, balanced: false, forced: null, reasons: [], matches: [], slips: [], toCome: [], open: [] }
  if (!normPo(po)) { out.reasons.push('no PO # on the slip, so it can’t be matched to a quote'); return out }
  const od = orderedOnPo(po, allSlips, feedRows)
  const matches = od.matches
  const onPo = (allSlips || []).filter(o => (o.kind || 'order') === 'order' && !o.recordOnly && normPo(o.poNumber) === normPo(po))
  const slips = onPo.filter(o => !isQuoteDoc(o)) // packing slips (what was picked up)
  out.matches = matches; out.slips = slips; out.quoteDocs = od.docs
  const forcedOrder = matches.find(m => m.forcedReceived)
  const forcedSlip = onPo.find(s => s.forceReceivedAt)
  if (forcedOrder) out.forced = { by: 'order', reason: forcedOrder.forcedReceived.reason || '', at: forcedOrder.forcedReceived.at }
  else if (forcedSlip && !(od.source === 'doc' && od.docs.length > 1)) out.forced = { by: 'slip', reason: forcedSlip.forceReason || '', at: forcedSlip.forceReceivedAt }
  if (out.forced) { out.balanced = true; return out }

  // Quotes saved here (not in Orders & POs): each order on the PO balances on its own
  if (od.source === 'doc' && od.has) {
    const label = d => od.docs.length > 1 ? `Quote ${d.invoiceNumber || ''}: ` : ''
    od.docs.forEach(d => {
      if (d.forceReceivedAt) return
      const mine = slips.filter(s => sameOrder(d, s))
      if (!mine.length) { out.reasons.push(`${label(d)}waiting for the packing slips (pick-up)`); return }
      const rs = mine.map(s => ({ s, r: billingCheck(s, allSlips, feedRows) }))
      const open = rs.filter(x => x.r.status === 'flag' && !isReviewed(x.s, x.r))
      out.open.push(...open)
      if (open.length) out.reasons.push(`${label(d)}${open.length} slip${open.length === 1 ? '' : 's'} with billing differences not reviewed`)
      const toCome = rs[0].r.info.filter(i => i.type === 'toCome')
      out.toCome.push(...toCome)
      if (toCome.length) out.reasons.push(`${label(d)}still to come: ${toCome.slice(0, 3).map(i => `${i.qty} ${i.uom || ''} ${i.partNo || i.desc}`.replace(/\s+/g, ' ').trim()).join(', ')}${toCome.length > 3 ? ` +${toCome.length - 3} more` : ''}`)
    })
    out.balanced = out.reasons.length === 0
    return out
  }

  const hasQuote = od.has
  if (!matches.length && !od.docs.length) out.reasons.push(`no quote for PO ${po} — mark the quote document “This is the quote”, or add the PO # to its quote in Orders & POs`)
  else if (!hasQuote) out.reasons.push('the quote (lines or total) isn’t in yet')
  if (!slips.length) out.reasons.push('waiting for the packing slips (pick-up)')
  if (!hasQuote || !slips.length) return out

  const results = slips.map(s => ({ s, r: billingCheck(s, allSlips, feedRows) }))
  out.open = results.filter(x => x.r.status === 'flag' && !isReviewed(x.s, x.r))
  if (out.open.length) out.reasons.push(`${out.open.length} slip${out.open.length === 1 ? '' : 's'} with billing differences not reviewed`)
  const first = results[0].r
  if (first.ordered && first.ordered.lines) {
    out.toCome = first.info.filter(i => i.type === 'toCome')
    if (out.toCome.length) out.reasons.push(`still to come: ${out.toCome.slice(0, 3).map(i => `${i.qty} ${i.uom || ''} ${i.partNo || i.desc}`.replace(/\s+/g, ' ').trim()).join(', ')}${out.toCome.length > 3 ? ` +${out.toCome.length - 3} more` : ''}`)
  } else if (slips.some(hasPrices)) {
    const quoted = first.ordered ? first.ordered.total : 0
    const billed = first.billed ? first.billed.poTotal : 0
    if (quoted && billed < quoted - Math.max(1, quoted * 0.01)) out.reasons.push(`slips total $${billed.toFixed(2)} of $${quoted.toFixed(2)} quoted`)
  }
  out.balanced = out.reasons.length === 0
  return out
}

// Balance for one slip's order: the whole PO when the quote is in Orders & POs;
// with quotes saved here, just the order it belongs to (a slip that's its own
// order on the PO, with no quote for it, has nothing to wait for).
export function orderStatus(slip, allSlips, feedRows) {
  const po = slip && slip.poNumber
  const od = orderedOnPo(po, allSlips, feedRows)
  if (od.source !== 'doc' || !od.allDocs.length) return poStatus(po, allSlips, feedRows)
  const docs = isQuoteDoc(slip) ? [slip] : od.allDocs.filter(d => sameOrder(d, slip))
  if (!docs.length) return { po, balanced: true, separate: true, forced: null, reasons: [], matches: [], slips: [slip], toCome: [], open: [] }
  const keep = new Set(docs.map(d => d.id))
  const pkts = (allSlips || []).filter(o => !isQuoteDoc(o) && normPo(o.poNumber) === normPo(po) && docs.some(d => sameOrder(d, o)))
  const scoped = (allSlips || []).filter(o => keep.has(o.id) || pkts.includes(o))
  const r = poStatus(po, scoped, feedRows)
  if (docs.every(d => d.forceReceivedAt) || pkts.some(p => p.forceReceivedAt)) return { ...r, balanced: true, forced: { by: 'slip', reason: (docs.find(d => d.forceReceivedAt) || pkts.find(p => p.forceReceivedAt) || {}).forceReason || '' }, reasons: [] }
  return r
}
