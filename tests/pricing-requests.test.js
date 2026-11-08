import { describe, it, expect } from 'vitest'
import { autoMatchPricingRequests } from '../src/api/requests.js'
import { buildPurchases } from '../src/api/purchases.js'

const req = (over = {}) => ({ id: 'q1', sentAt: '2026-11-02T10:00:00Z', wholesaler: 'Guillevin', pricing: true,
  quote: { id: 'Q', number: 'Q-1042', title: 'Shop lights' },
  items: [{ qty: 4, partNo: 'ABC1234' }, { qty: 2, partNo: 'XYZ9876' }], ...over })
const row = (over = {}) => ({ id: 'f1', supplier: 'Guillevin', date: '2026-11-04', quoteNumber: '55501', status: 'Quote',
  quoteLines: { a: [{ partNo: 'ABC1234' }, { partNo: 'XYZ9876' }] }, ...over })

describe('pricing requests sent from a quote', () => {
  it('matches the quote that comes back and asks to confirm', () => {
    const next = autoMatchPricingRequests([req()], [row()])
    expect(next[0]).toMatchObject({ matchedFeedId: 'f1', autoMatched: true, needsConfirm: true })
  })
  it('leaves orders, catalog quotes and rejected quotes alone', () => {
    expect(autoMatchPricingRequests([req({ pricing: false })], [row()])).toBeNull()
    expect(autoMatchPricingRequests([req({ fromCatalog: true })], [row()])).toBeNull()
    expect(autoMatchPricingRequests([req({ rejectedFeedIds: ['f1'] })], [row()])).toBeNull()
  })
  it('does not match a quote from before it was sent', () => {
    expect(autoMatchPricingRequests([req()], [row({ date: '2026-10-20' })])).toBeNull()
  })
  it('files the purchase as Pricing with a confirm flag, then without once confirmed', () => {
    const r = autoMatchPricingRequests([req()], [row()])
    const p = buildPurchases({ slips: [], feed: [row()], previous: [], marks: {}, requests: r }).find(x => x.rows.length)
    expect(p.stage).toBe('pricing')
    expect(p.flags.map(f => f.id)).toContain('confirmpricing')
    const done = r.map(x => ({ ...x, needsConfirm: false }))
    const p2 = buildPurchases({ slips: [], feed: [row()], previous: [], marks: {}, requests: done }).find(x => x.rows.length)
    expect(p2.stage).toBe('pricing')
    expect(p2.flags.length).toBe(0)
  })
  it('a pricing request with nothing back yet sits in Pricing, not Requested', () => {
    const p = buildPurchases({ slips: [], feed: [], previous: [], marks: {}, requests: [req()] })
    expect(p[0].stage).toBe('pricing')
  })
})
