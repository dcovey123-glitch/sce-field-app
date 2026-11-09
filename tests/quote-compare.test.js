import { describe, it, expect } from 'vitest'
import { compareToQuote, applyCompare, pricingSourcesFor, feedRowLines, sourceRef } from '../src/api/quoteCompare.js'

const quote = {
  id: 'q1', quoteNumber: 'Q-104', title: 'Gym lights',
  scopes: [{ id: 's1', name: 'Lighting', materials: [
    { id: 'm1', partNo: 'ABC123', desc: '4ft LED strip', uom: 'ea', qty: 10, rate: 50 },
    { id: 'm2', partNo: '', desc: 'Wire guard for gym fixture', uom: 'ea', qty: 10, rate: 0 },
  ] }],
}

describe('compare to quote', () => {
  it('splits price differences, unmatched lines and our unpriced lines', () => {
    const r = compareToQuote([
      { partNo: 'ABC123', name: 'LED STRIP 4FT', qty: 10, cost: 55 },
      { partNo: 'WG-9', name: 'GUARD WIRE 4\' LIN', qty: 10, cost: 12.5 },
    ], quote)
    expect(r.diffs.map(d => d.match.id)).toEqual(['m1'])
    expect(r.missing.map(m => m.line.partNo)).toEqual(['WG-9'])
    expect(r.unpriced.map(q => q.id)).toEqual(['m2'])
  })

  it('pairing a line by hand puts their part # and price on ours, keeps our wording and qty, and records the source', () => {
    const line = { partNo: 'WG-9', name: 'GUARD WIRE 4\' LIN', qty: 4, cost: 12.5 }
    const src = { kind: 'slip', id: 'o7', label: 'Nedco #555', date: '2026-11-09', lines: [line] }
    const patch = applyCompare(quote, { replace: [{ line, quoteLineId: 'm2' }], source: sourceRef(src), at: '2026-11-09T10:00:00Z' })
    const m2 = patch.scopes[0].materials.find(m => m.id === 'm2')
    expect(m2).toMatchObject({ partNo: 'WG-9', desc: 'Wire guard for gym fixture', qty: 10, rate: 12.5 })
    expect(patch.scopes[0].materials).toHaveLength(2)
    expect(patch.priceSources[0]).toMatchObject({ kind: 'slip', id: 'o7', updated: 1, added: 0 })
    expect(patch.priceSources[0].lines).toBeUndefined()
    // and now it matches on its own
    expect(compareToQuote([line], { ...quote, ...patch }).same).toHaveLength(1)
  })

  it('adds and updates, and re-comparing the same source replaces its reference', () => {
    const r = compareToQuote([{ partNo: 'ABC123', name: 'x', qty: 1, cost: 55 }, { partNo: 'NEW1', name: 'Box', qty: 2, cost: 3 }], quote)
    const first = applyCompare(quote, { update: r.diffs, add: r.missing, scopeId: 's1', source: { kind: 'feed', id: 'f1:Q9', label: 'L' } })
    expect(first.scopes[0].materials.find(m => m.id === 'm1').rate).toBe(55)
    expect(first.scopes[0].materials.some(m => m.partNo === 'NEW1' && m.rate === 3)).toBe(true)
    const again = applyCompare({ ...quote, ...first }, { source: { kind: 'feed', id: 'f1:Q9', label: 'L' } })
    expect(again.priceSources).toHaveLength(1)
  })
})

describe('pricing quotes for a quote', () => {
  it('finds slips and email-run quotes filed for it', () => {
    const orders = [
      { id: 'o1', wholesaler: 'Nedco', invoiceNumber: 'P1', orderDate: '2026-11-02', pricingTarget: { type: 'quote', quoteId: 'q1' }, lineItems: [{ partNo: 'ABC123', name: 'LED', qty: 2, totalPrice: 100 }] },
      { id: 'o2', wholesaler: 'Guillevin', pricingTarget: { type: 'quote', quoteId: 'other' }, lineItems: [] },
    ]
    const feedRows = [
      { id: 'r1', supplier: 'Westburne', date: '2026-11-05', quoteNumber: 'W77', filedAs: 'quote', ref: 'Q-104', quoteLines: { W77: [{ partNo: 'ABC123', desc: 'LED', qty: 4, ext: 210 }] } },
      { id: 'r2', supplier: 'Westburne', quoteNumber: 'W78', filedAs: 'job', ref: 'Q-104', quoteLines: {} },
    ]
    const list = pricingSourcesFor(quote, { orders, feedRows })
    expect(list.map(s => s.kind + ':' + s.id)).toEqual(['feed:r1:W77', 'slip:o1'])
    expect(list[0].lines[0].cost).toBe(52.5)
    expect(list[1].lines[0].cost).toBe(50)
  })
  it('per-unit price from an email-run line', () => {
    expect(feedRowLines({ quoteLines: { A: [{ partNo: 'X', desc: 'y', qty: 3, ext: 10 }] } }, 'A')[0].cost).toBeCloseTo(3.3333)
  })
})
