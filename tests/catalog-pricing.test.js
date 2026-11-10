import { describe, it, expect } from 'vitest'
import { catalogRequestItems, pairToCatalog, applyToCatalog, openCatalogRequests } from '../src/api/catalogPricing.js'

const catalog = [
  { id: 'c1', name: '4" square box 2-1/8 deep', nickname: '4sq deep', partNo: '', refCost: 0, uom: 'EA' },
  { id: 'c2', name: 'Red wirenut', nickname: '', partNo: '', refCost: 0, uom: '' },
  { id: 'c3', name: 'BR115 breaker', partNo: 'EATBR115', refCost: 10.49, uom: 'EA' },
]
const req = { id: 'r1', catalogPricing: true, wholesaler: 'Nedco', sentAt: '2026-11-10T15:00:00Z', items: catalogRequestItems(catalog) }

describe('catalog pricing', () => {
  it('sends qty 1 of each with the catalog id', () => {
    expect(req.items.map(i => [i.qty, i.catalogId])).toEqual([[1, 'c1'], [1, 'c2'], [1, 'c3']])
  })
  it('pairs by part #, then the wording', () => {
    const lines = [
      { partNo: 'THS52151', name: 'BOX 4SQ 2-1/8D WELDED', qty: 1, cost: 3.1 },
      { partNo: 'IDE30-076', name: 'WIRE CONN RED 76B', qty: 1, cost: 0.12 },
      { partNo: 'EATBR115', name: 'BR 1P 15A', qty: 1, cost: 10.99 },
    ]
    expect(pairToCatalog(lines, catalog, req).map(p => [p.catalogId, p.why])).toEqual([['c1', 'description'], ['c2', 'description'], ['c3', 'part #']])
  })
  it('without the request, lines it cannot place stay unpaired', () => {
    expect(pairToCatalog([{ partNo: 'X1', name: 'Something else', cost: 1 }], catalog).map(p => p.catalogId)).toEqual([null])
  })
  it('apply puts their part #, description and price on our item, ours stays as the nickname', () => {
    const r = applyToCatalog(catalog, [
      { line: { partNo: 'IDE30-076', name: 'WIRE CONN RED 76B', uom: 'EA', cost: 0.12 }, catalogId: 'c2', useTheirs: true },
      { line: { partNo: 'EATBR115', name: 'BR 1P 15A', cost: 10.99 }, catalogId: 'c3', useTheirs: false },
      { line: { partNo: 'NEW1', name: 'New thing', uom: 'EA', cost: 5 }, catalogId: 'add' },
      { line: { partNo: 'S1', name: 'skip me', cost: 1 }, catalogId: 'skip' },
    ], { source: 'Nedco', number: '6060001', date: '2026-11-12' })
    const c2 = r.catalog.find(c => c.id === 'c2')
    expect(c2).toMatchObject({ partNo: 'IDE30-076', name: 'WIRE CONN RED 76B', nickname: 'Red wirenut', refCost: 0.12, uom: 'EA' })
    expect(c2.priceHistory[0]).toMatchObject({ cost: 0.12, source: 'Nedco quote 6060001' })
    const c3 = r.catalog.find(c => c.id === 'c3')
    expect(c3).toMatchObject({ partNo: 'EATBR115', name: 'BR115 breaker', refCost: 10.99 })
    expect(r.flags).toHaveLength(1) // c3's price changed
    expect(r).toMatchObject({ updated: 2, added: 1 })
    expect(r.catalog).toHaveLength(4)
  })
  it('finds the open request, same wholesaler first', () => {
    const list = [{ ...req, id: 'g', wholesaler: 'Gescan', sentAt: '2026-11-11' }, req, { ...req, id: 'done', matchedSlipId: 'o1' }]
    expect(openCatalogRequests(list, 'Nedco Red Deer').map(r => r.id)).toEqual(['r1', 'g'])
  })
})

import { likeness } from '../src/api/catalogPricing.js'
describe('catalog pricing — wording', () => {
  it('matches the same thing worded differently, in a different order', () => {
    const cat = [{ id: 'g', name: 'Wire guard for gym fixture', nickname: 'gym guard', partNo: '' }, { id: 'l', name: '4ft LED strip', partNo: '' }]
    const r = { items: [{ catalogId: 'g', desc: 'Wire guard for gym fixture', qty: 1 }, { catalogId: 'l', desc: '4ft LED strip', qty: 1 }] }
    const lines = [{ partNo: 'ABC123', name: 'LED STRIP 4FT', cost: 55 }, { partNo: 'WG-9', name: "GUARD WIRE 4' LIN", cost: 12.5 }]
    expect(pairToCatalog(lines, cat, r).map(p => [p.catalogId, p.why])).toEqual([['l', 'description'], ['g', 'description']])
    expect(likeness('LED STRIP 4FT', '4ft LED strip')).toBe(1)
  })
  it('falls back to line order only when they quoted as many lines as we asked', () => {
    const cat = [{ id: 'a', name: 'Thing one', partNo: '' }, { id: 'b', name: 'Thing two', partNo: '' }]
    const r = { items: [{ catalogId: 'a' }, { catalogId: 'b' }] }
    expect(pairToCatalog([{ name: 'XQ-1 ZZ', cost: 1 }], cat, r)[0].catalogId).toBe(null)
    expect(pairToCatalog([{ name: 'XQ-1 ZZ', cost: 1 }, { name: 'PL-9 YY', cost: 2 }], cat, r).map(p => p.catalogId)).toEqual(['a', 'b'])
  })
})
