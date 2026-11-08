// Purchases: one record per PO (or quote #), in one stage, with the right flags
import { describe, it, expect } from 'vitest'
import { buildPurchases } from '../src/api/purchases.js'

const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const row = (o = {}) => ({ id: 'f1', supplier: 'Nedco', date: daysAgo(3), quoteNumber: '5962096', poNumber: 'P0022311', status: 'Ordered', quoteTotal: 500, ...o })
const slip = (o = {}) => ({ id: 's1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '5962096-01', poNumber: 'P0022311', orderDate: daysAgo(2), jobs: [{ id: 'j1', name: 'B208 Lighting' }],
  lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture', qty: 10, totalPrice: 300, jobIds: ['j1'] }, { id: 'l2', partNo: 'B2', name: 'Wire', qty: 100, totalPrice: 200, jobIds: ['j1'] }], ...o })
const one = args => { const all = buildPurchases(args); expect(all).toHaveLength(1); return all[0] }
const ids = p => p.flags.map(f => f.id)

describe('a purchase moving through its stages', () => {
  it('PO issued, no slip yet → Ordered', () => {
    const p = one({ feed: [row()] })
    expect(p.stage).toBe('ordered')
    expect(p.why).toMatch(/PO P0022311 · no slip yet/)
    expect(p.total).toBe(500)
  })
  it('slip in, some lines received → still Ordered, with the count', () => {
    const s = slip(); s.lineItems[0].received = true
    const p = one({ feed: [row()], slips: [s] })
    expect(p.stage).toBe('ordered')
    expect(p.why).toMatch(/1 of 2 lines received/)
  })
  it('all received, not sent → Received', () => {
    const s = slip(); s.lineItems.forEach(li => { li.received = true })
    expect(one({ feed: [row()], slips: [s] }).stage).toBe('received')
  })
  it('sent to Jonathan with every line on a job → Closed', () => {
    const s = slip({ sentAt: daysAgo(1) }); s.lineItems.forEach(li => { li.received = true })
    expect(one({ feed: [row()], slips: [s] }).stage).toBe('closed')
  })
  it('sent but a line is on no job or Stock → Sent, flagged', () => {
    const s = slip({ sentAt: daysAgo(1), jobs: [] }); s.lineItems.forEach(li => { li.received = true }); s.lineItems[1].jobIds = []
    const p = one({ feed: [row()], slips: [s] })
    expect(p.stage).toBe('sent')
    expect(ids(p)).toContain('unused')
  })
  it('closed by you stays closed, with your reason', () => {
    const p = one({ feed: [row()], marks: { 'po:p0022311': { closed: true, reason: 'picked up, no slip' } } })
    expect(p.stage).toBe('closed')
    expect(p.why).toBe('Closed by you — picked up, no slip')
  })
})

describe('grouping', () => {
  it('the email-run row and the slips on the same PO are one purchase ("PO #" and spacing ignored)', () => {
    const p = one({ feed: [row({ poNumber: 'PO # P0022311' })], slips: [slip({ poNumber: 'p0022311' })] })
    expect(p.rows).toHaveLength(1)
    expect(p.slips).toHaveLength(1)
  })
  it('a slip with no PO joins its quote by quote # and is flagged to get the PO', () => {
    const p = one({ feed: [row()], slips: [slip({ poNumber: '' })] })
    const f = p.flags.find(x => x.id === 'slipnopo')
    expect(f.text).toBe('Slip missing PO P0022311')
    expect(f.fix).toEqual({ kind: 'applyPo', po: 'P0022311', ids: ['s1'] })
  })
  it('a no-PO quote whose number shows up on a slip under a PO becomes part of that purchase', () => {
    const all = buildPurchases({ feed: [row({ id: 'f2', poNumber: '', quoteNumber: '7001' })], slips: [slip({ invoiceNumber: '7001' })] })
    expect(all).toHaveLength(1)
    expect(all[0].rows.map(r => r.id)).toEqual(['f2'])
  })
})

describe('no PO yet', () => {
  it('a new quote with no PO → Waiting for PO, no flag', () => {
    const p = one({ feed: [row({ poNumber: '', status: 'Quote', date: daysAgo(3) })] })
    expect(p.stage).toBe('waiting')
    expect(p.flags).toEqual([])
  })
  it('flagged once it has waited over 14 days', () => {
    expect(ids(one({ feed: [row({ poNumber: '', status: 'Quote', date: daysAgo(20) })] }))).toContain('oldwait')
  })
  it('an order PO older than 21 days still not in is flagged', () => {
    expect(ids(one({ feed: [row({ date: daysAgo(30) })] }))).toContain('oldorder')
  })
  it('a quote kept for pricing → Pricing, never flagged', () => {
    const p = one({ feed: [row({ poNumber: '', status: 'Quote', pricingOnly: true, date: daysAgo(90) })] })
    expect(p.stage).toBe('pricing')
    expect(p.flags).toEqual([])
  })
})

describe('quote vs packing slips', () => {
  it('compares what came on the slips to the quote', () => {
    const s = slip({ lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture', qty: 10, totalPrice: 300, jobIds: ['j1'] }] })
    const p = one({ feed: [row()], slips: [s] })
    expect(p.quoteTotal).toBe(500)
    expect(p.slipSum).toBe(300)
    expect(p.shortBy).toBe(200)
    expect(p.why).toMatch(/slips \$300\.00 of \$500\.00/)
  })
  it('closed short (forced received): the balance is flagged for the export', () => {
    const s = slip({ forceReceivedAt: daysAgo(1), lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture', qty: 10, totalPrice: 300, jobIds: ['j1'], received: true }] })
    const p = one({ feed: [row()], slips: [s] })
    expect(p.stage).toBe('received')
    expect(p.flags.find(f => f.id === 'short').text).toBe('Slips short $200.00 — the balance goes on the timesheet export')
  })
  it('a slip line moved to a later release is not counted twice', () => {
    const s1 = slip({ lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture', qty: 10, totalPrice: 300, movedTo: 's2' }] })
    const s2 = slip({ id: 's2', invoiceNumber: '5962096-02', lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture', qty: 10, totalPrice: 300, jobIds: ['j1'] }] })
    expect(one({ feed: [row()], slips: [s1, s2] }).slipSum).toBe(300)
  })
})

describe('sent orders with no quote back', () => {
  it('an order you sent sits in Requested, flagged after 4 days with no quote', () => {
    const p = one({ requests: [{ id: 'r1', sentAt: new Date(Date.now() - 6 * 86400000).toISOString(), wholesaler: 'Nedco', items: [{ partNo: 'A1' }] }] })
    expect(p.stage).toBe('requested')
    expect(ids(p)).toContain('noquote')
  })
  it('a pricing list never nags', () => {
    const p = one({ requests: [{ id: 'r1', sentAt: new Date(Date.now() - 60 * 86400000).toISOString(), wholesaler: 'Nedco', pricing: true, items: [] }] })
    expect(p.stage).toBe('pricing')
    expect(p.flags).toEqual([])
  })
})
