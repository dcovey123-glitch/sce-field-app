// Fixing a request matched to the wrong quote, and changing which of our quotes it's for
import { describe, it, expect } from 'vitest'
import { unmatchPatch, autoMatchPricingRequests, requestQuoteRef, quotePickList } from '../src/api/requests.js'

const req = { id: 'r1', pricing: true, sentAt: '2026-11-04T16:00:00Z', wholesaler: 'Nedco', items: [{ partNo: 'LEVGFTR1W' }, { partNo: 'LEV5362W' }] }
const wrong = { id: 'f1', supplier: 'Nedco', quoteNumber: '6056920', date: '2026-11-05', quoteLines: { a: [{ partNo: 'LEVGFTR1W' }, { partNo: 'LEV5362W' }] } }
const right = { id: 'f2', supplier: 'Nedco', quoteNumber: '6056999', date: '2026-11-06', quoteLines: { a: [{ partNo: 'LEVGFTR1W' }] } }

describe('Unmatch', () => {
  it('clears the match and remembers the wrong quote', () => {
    const p = unmatchPatch({ ...req, matchedFeedId: 'f1', needsConfirm: false, confirmedAt: 'x', rejectedFeedIds: ['f0'] })
    expect(p).toMatchObject({ matchedFeedId: null, matchedSlipId: null, needsConfirm: false, confirmedAt: null, rejectedFeedIds: ['f0', 'f1'] })
  })
  it('the auto-matcher won\'t put it back on the same quote after Unmatch', () => {
    const matched = autoMatchPricingRequests([req], [wrong, right])
    expect(matched[0].matchedFeedId).toBe('f1')
    const undone = [{ ...matched[0], ...unmatchPatch(matched[0]) }]
    const again = autoMatchPricingRequests(undone, [wrong, right])
    expect(again[0].matchedFeedId).toBe('f2')
  })
  it('remembers a wrong slip too, without repeats', () => {
    expect(unmatchPatch({ matchedSlipId: 's1', rejectedSlipIds: ['s1'] }).rejectedSlipIds).toEqual(['s1'])
  })
})

describe('changing which of our quotes a request is for', () => {
  const quotes = [
    { id: 'q1', quoteNumber: 'Q-2026-009', title: 'Arts Vault pots', customerName: 'RDP' },
    { id: 'q2', quoteNumber: 'Q-2026-012', title: 'Gym lighting', customerName: 'RDP' },
    { id: 'q3', quoteNumber: 'Q-2026-010', title: 'Residence GFCIs', customerName: 'RDP Residence' }
  ]
  it('stores the quote the way a sent request does', () => {
    expect(requestQuoteRef(quotes[1])).toEqual({ id: 'q2', number: 'Q-2026-012', title: 'Gym lighting' })
    expect(requestQuoteRef(null)).toBeNull()
  })
  it('lists newest first, and search matches number, title or customer', () => {
    expect(quotePickList(quotes).map(q => q.id)).toEqual(['q2', 'q3', 'q1'])
    expect(quotePickList(quotes, 'residence').map(q => q.id)).toEqual(['q3'])
    expect(quotePickList(quotes, '009').map(q => q.id)).toEqual(['q1'])
  })
})
