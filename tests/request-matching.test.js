// Matching a sent material request to its quote by hand
import { describe, it, expect } from 'vitest'
import { quoteChoices } from '../src/api/requests.js'
import { buildPurchases } from '../src/api/purchases.js'
import { planLineStatus } from '../src/api/materialPlan.js'

const req = { id: 'r1', sentAt: '2026-11-04T16:00:00Z', wholesaler: 'Nedco', items: [{ partNo: 'LEVGFTR1W', planRefs: [{ jobId: 'j1', lineId: 'l1', qty: 12 }] }] }
const fresh = { id: 'f1', supplier: 'Nedco', quoteNumber: '6056920', date: '2026-11-05', quoteLines: { a: [{ partNo: 'LEVGFTR1W', desc: 'GFCI' }] }, quoteTotal: 160 }
const old = { id: 'f0', supplier: 'Gescan', quoteNumber: '18268040', date: '2026-10-20', quoteTotal: 90, description: 'Arts Vault pots' }
const archived = { id: 'p9', supplier: 'Nedco', quoteNumber: '6040001', date: '2026-10-01', quoteTotal: 50 }
const pdf = { id: 's7', kind: 'order', docType: 'quote', wholesaler: 'Westburne', invoiceNumber: '4547914', orderDate: '2026-11-06', poNumber: '', jobs: [], lineItems: [{ id: 'x', partNo: 'LEVGFTR1W', name: 'GFCI', qty: 12, totalPrice: 158 }] }

describe('choosing a quote to match', () => {
  it('no search: what came in since it went out — email-run quotes and quote PDFs in the app — best match first', () => {
    const c = quoteChoices(req, { rows: [fresh, old], previous: [archived], slips: [pdf] })
    expect(c.map(x => x.kind + ':' + x.number)).toEqual(['feed:6056920', 'slip:4547914'])
    expect(c[0]).toMatchObject({ overlap: 1, sameSup: true })
  })
  it('search reaches older and archived quotes too', () => {
    expect(quoteChoices(req, { rows: [fresh, old], previous: [archived] }, {}, 'arts vault').map(x => x.id)).toEqual(['f0'])
    expect(quoteChoices(req, { rows: [fresh, old], previous: [archived] }, {}, '6040001')[0]).toMatchObject({ id: 'p9', archived: true })
    expect(quoteChoices(req, { slips: [pdf] }, {}, 'westburne')[0]).toMatchObject({ kind: 'slip', isQuote: true, total: 158 })
  })
  it('a quote already matched to another request isn\'t offered again', () => {
    expect(quoteChoices(req, { rows: [fresh], slips: [pdf] }, { feed: new Set(['f1']), slip: new Set(['s7']) })).toEqual([])
  })
})

describe('matched to a quote read into the app', () => {
  it('the request joins that purchase', () => {
    const all = buildPurchases({ slips: [pdf], requests: [{ ...req, matchedSlipId: 's7' }] })
    expect(all).toHaveLength(1)
    expect(all[0].requests.map(r => r.id)).toEqual(['r1'])
  })
  it('the job Plan line shows it as quoted, then on PO once the quote has one', () => {
    const line = { id: 'l1', partNo: 'GFCI-X', item: 'GFCI', qty: 12, source: 'order' }
    const J = { id: 'j1', plannedMaterials: [line] }
    const r = [{ ...req, matchedSlipId: 's7' }]
    expect(planLineStatus(line, J, { orders: [pdf], requests: r })).toMatchObject({ id: 'quoted', label: '💬 Quoted — Westburne 4547914' })
    expect(planLineStatus(line, J, { orders: [{ ...pdf, poNumber: '10118' }], requests: r })).toMatchObject({ id: 'onpo', label: '🧾 On PO 10118' })
  })
})
