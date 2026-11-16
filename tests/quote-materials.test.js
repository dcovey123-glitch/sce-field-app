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
    expect(quoteLineStatus(j, lines[0], { requests: [req] }).done).toBe(true)
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
