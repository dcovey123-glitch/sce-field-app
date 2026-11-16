import { describe, it, expect } from 'vitest'
import { quoteLines, quoteLineStatus, quoteLinesSummary, addQuoteLinesToOrderList, splitOrderSheet, legacyKeys, purchaseQuoteRef } from '../src/api/quoteMaterials.js'

let n = 0
const uid = () => 'u' + (++n)
const quote = { id: 'Q1', quoteNumber: 'Q-RDP-2026-100', title: 'Gym lights', scopes: [{ name: 'Gym', materials: [
  { id: 'm1', partNo: 'LED4', desc: '4ft LED strip', uom: 'EA', qty: 10, rate: 50 },
  { id: 'm2', partNo: 'WAGO', desc: 'Wago 221', uom: 'BX', qty: 2, rate: 30 },
  { id: 'm3', partNo: '', desc: 'Unistrut', uom: 'FT', qty: 40, rate: 3 },
] }] }
const job = { id: 'J1', name: 'Gym retrofit' }

describe('quote as the reference for a job\'s material', () => {
  const lines = quoteLines(quote)
  it('lists every quote material line with a stable key', () => {
    expect(lines.map(l => l.key)).toEqual(['Q1:m1', 'Q1:m2', 'Q1:m3'])
  })
  it('nothing done yet → "Not ordered"', () => {
    const s = quoteLineStatus(job, lines[0], {})
    expect(s.chips.map(c => c.id)).toEqual(['none'])
    expect(s.done).toBe(false)
  })
  it('on the order sheet with its tag, then sent as an order, partly', () => {
    const sheet = addQuoteLinesToOrderList([], job, [lines[0]], 'order', uid)
    expect(sheet[0].tag).toBe('order')
    expect(quoteLineStatus(job, lines[0], { orderList: sheet }).chips[0].label).toMatch(/On order sheet — 🛒 Order \(10\)/)
    const req = { pricing: false, wholesaler: 'Nedco', sentAt: '2026-11-12T10:00:00Z', items: [{ planRefs: [{ jobId: 'J1', lineId: 'Q1:m1', qty: 6 }] }] }
    const s = quoteLineStatus(job, lines[0], { requests: [req] })
    expect(s.chips.map(c => c.id)).toEqual(['ordered', 'short'])
    expect(s.chips[1].label).toBe('4 of 10 not ordered')
  })
  it('pricing lines are grouped by their quote and never count as ordered', () => {
    const sheet = addQuoteLinesToOrderList([], job, [lines[1], lines[2]], 'pricing', uid)
    const { order, pricingGroups } = splitOrderSheet(sheet)
    expect(order).toEqual([])
    expect(pricingGroups[0].quote.number).toBe('Q-RDP-2026-100')
    const req = { pricing: true, quote: { id: 'Q1' }, wholesaler: 'Gescan', items: [{ planRefs: [{ jobId: 'J1', lineId: 'Q1:m2', qty: 2 }] }] }
    const s = quoteLineStatus(job, lines[1], { requests: [req] })
    expect(s.chips.map(c => c.id)).toEqual(['pricing-sent'])
    expect(s.done).toBe(false)
  })
  it('Materials Actual lines and Not needed close a line', () => {
    const j = { ...job, materialEntries: [{ quoteLineKey: 'Q1:m3', qty: 40 }], quoteLineState: { 'Q1:m2': { notNeeded: true } } }
    expect(quoteLineStatus(j, lines[2], {}).done).toBe(true)
    expect(quoteLineStatus(j, lines[1], {}).chips.map(c => c.id)).toEqual(['notneeded'])
    const sum = quoteLinesSummary(lines.map(l => quoteLineStatus(j, l, {})))
    expect(sum).toMatchObject({ total: 3, open: 1, actual: 1, notNeeded: 1, notOrdered: 1 })
  })
  it('old Plan lines on the sheet / sent still show on their quote line', () => {
    const j = { ...job, plannedMaterials: [{ id: 'p9', sourceQuoteId: 'Q1', sourceLineId: 'm1' }] }
    expect(legacyKeys(j)).toEqual({ p9: 'Q1:m1' })
    const req = { wholesaler: 'Nedco', items: [{ planRefs: [{ jobId: 'J1', lineId: 'p9', qty: 10 }] }] }
    const st = quoteLineStatus(j, lines[0], { requests: [req] })
    expect(st.chips.map(c => c.id)).toEqual(['ordered'])
    expect(st.done).toBe(false) // ordered isn't done until it's charged to the job
  })
  it('ordered → received on a slip → charged to the job (then done)', () => {
    const req = { wholesaler: 'Nedco', items: [{ planRefs: [{ jobId: 'J1', lineId: 'Q1:m1', qty: 10 }] }] }
    const slip = { id: 'o1', kind: 'order', lineItems: [{ partNo: 'LED4', name: '4ft LED strip', qty: 10, received: true, jobIds: ['J1'], usedBy: { J1: 10 } }] }
    const recd = quoteLineStatus(job, lines[0], { requests: [req], orders: [slip] })
    expect(recd.chips.map(c => c.id)).toEqual(['ordered', 'received'])
    expect(recd.done).toBe(false)
    const j = { ...job, materialEntries: [{ kind: 'order', slipOrderId: 'o1', partNo: 'LED4', item: '4ft LED strip', qty: 10 }] }
    const charged = quoteLineStatus(j, lines[0], { requests: [req], orders: [slip] })
    expect(charged.chips.map(c => c.id)).toEqual(['ordered', 'charged'])
    expect(charged.done).toBe(true)
  })
  it('a pricing purchase knows which of our quotes it belongs to', () => {
    expect(purchaseQuoteRef({ requests: [{ quote: { id: 'Q1', number: 'Q-RDP-2026-100', title: 'Gym lights' } }], slips: [] }).number).toBe('Q-RDP-2026-100')
    expect(purchaseQuoteRef({ requests: [], slips: [{ pricingTarget: { type: 'quote', quoteId: 'Q2', quoteNumber: 'Q-X', title: 'T' } }] }).id).toBe('Q2')
    expect(purchaseQuoteRef({ requests: [], slips: [] })).toBe(null)
  })
})

import { buildPurchases } from '../src/api/purchases.js'
describe('material orders close only when every line is assigned', () => {
  const slip = extra => ({ id: 's1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '123', poNumber: '5001', orderDate: '2026-11-10',
    lineItems: [{ name: 'Box', qty: 2, cost: 5, totalPrice: 10, received: true, jobIds: ['J1'], usedBy: { J1: 2 } }, { name: 'Wire', qty: 100, cost: 1, totalPrice: 100, received: true }], ...extra })
  it('received, not sent → ready to send to Jonathan, says what is unassigned', () => {
    const p = buildPurchases({ slips: [slip({})] })[0]
    expect(p.stage).toBe('received')
    expect(p.why).toMatch(/ready to send to Jonathan · 1 line still to put on a job or Stock/)
  })
  it('sent and archived but a line is unassigned → stays open', () => {
    const p = buildPurchases({ slips: [slip({ sentAt: '2026-11-12', archivedAt: '2026-11-13' })] })[0]
    expect(p.stage).toBe('sent')
  })
  it('sent, every line assigned → closed', () => {
    const s = slip({ sentAt: '2026-11-12' })
    s.lineItems[1].movedTo = 'Stock'
    expect(buildPurchases({ slips: [s] })[0].stage).toBe('closed')
  })
})

import { renameJobInOrderFilings, mergeOrders } from '../src/api/orders.js'
describe('renaming a job keeps its orders', () => {
  const feed = { orders: [
    { id: 'r1', supplier: 'Nedco', quoteNumber: 'QT1', filedAs: 'job', ref: 'Gym retrofit' },
    { id: 'r2', supplier: 'Gescan', quoteNumber: 'QT2', filedAs: 'job', refs: ['Gym retrofit', 'Lab lights'] },
    { id: 'r3', supplier: 'Nedco', quoteNumber: 'QT3', filedAs: 'job', ref: 'Other job' },
  ] }
  it('moves every filing to the new name, leaves the rest alone', () => {
    const { local, changed } = renameJobInOrderFilings(feed, {}, 'Gym Retrofit', 'Gym retrofit - Phase 1')
    expect(changed).toBe(2)
    const rows = mergeOrders(feed, local)
    expect(rows.find(r => r.id === 'r1').ref).toBe('Gym retrofit - Phase 1')
    expect(rows.find(r => r.id === 'r2').refs).toEqual(['Gym retrofit - Phase 1', 'Lab lights'])
    expect(rows.find(r => r.id === 'r3').ref).toBe('Other job')
  })
  it('a split quote # filed to the job follows too', () => {
    const local = { overrides: { r3: { parts: { QT3: { filedAs: 'job', ref: 'Gym retrofit' } } } } }
    const out = renameJobInOrderFilings(feed, local, 'Gym retrofit', 'Gym')
    expect(out.local.overrides.r3.parts.QT3.ref).toBe('Gym')
  })
})

import { receivedInWeek, poCompletion, exportWeekKey } from '../src/api/timesheetExport.js'
describe('an order goes to Jonathan in one piece', () => {
  const wk = exportWeekKey(new Date('2026-11-12T12:00:00'))
  const s1 = { id: 'a', kind: 'order', poNumber: '5001', invoiceNumber: '100', receivedAt: '2026-11-10T15:00:00Z', lineItems: [{ received: true }] }
  const s2 = { id: 'b', kind: 'order', poNumber: '5001', invoiceNumber: '100-01', lineItems: [{ received: false, backordered: true }] }
  it('a slip waits while another slip on its PO is still backordered', () => {
    expect(receivedInWeek([s1, s2], wk)).toEqual([])
    expect(poCompletion([s1, s2]).get('5001')).toMatchObject({ complete: false, waiting: 1 })
  })
  it('once the last slip is in, the whole PO goes on that week', () => {
    const done = { ...s2, receivedAt: '2026-11-12T15:00:00Z', lineItems: [{ received: true }] }
    const list = receivedInWeek([s1, done], wk)
    expect(list.map(o => o.id).sort()).toEqual(['a', 'b'])
    expect(list.every(o => o.receivedAt === '2026-11-12T15:00:00Z')).toBe(true)
  })
  it('a slip with no PO still goes on its own', () => {
    expect(receivedInWeek([{ id: 'c', kind: 'order', receivedAt: '2026-11-11T15:00:00Z', lineItems: [{ received: true }] }], wk).length).toBe(1)
  })
})

import { noPoState, docTagOf, DOC_TAGS } from '../src/api/slips.js'
describe('slip tags: Quote, Packing slip, Invoice, Receipt', () => {
  it('has the four tags; an untagged slip is a packing slip', () => {
    expect(DOC_TAGS.map(t => t.id)).toEqual(['quote', 'packing_slip', 'invoice', 'receipt'])
    expect(docTagOf({})).toBe('packing_slip')
  })
  it('a receipt never waits for a PO and is never flagged "No PO"', () => {
    const r = { id: 'r', kind: 'order', docType: 'receipt', orderDate: new Date().toISOString().slice(0, 10), lineItems: [{ name: 'Wire nuts', qty: 1, cost: 9, totalPrice: 9 }] }
    expect(noPoState(r)).toBe('none')
    const p = buildPurchases({ slips: [r] })[0]
    expect(p.flags.some(f => f.id === 'nopo')).toBe(false)
  })
  it('a receipt sent to the timesheet as an expense is not material received', () => {
    const wk = exportWeekKey(new Date('2026-11-12T12:00:00'))
    const r = { id: 'r', kind: 'order', docType: 'receipt', receivedAt: '2026-11-11T15:00:00Z', expenseAt: '2026-11-11T16:00:00Z', lineItems: [{ received: true }] }
    expect(receivedInWeek([r], wk)).toEqual([])
  })
})
