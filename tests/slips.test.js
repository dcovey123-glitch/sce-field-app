// Packing slips → jobs and Stock: what gets charged where, and nothing twice
import { describe, it, expect } from 'vitest'
import {
  GENERAL_STOCK_ID, slipKind, noPoState, lineUse, initialUse, lineRemaining, jobEntriesFromSlip, setSlipLineUse,
  leftoverLinesForJob, closeOutLines, moveQuoteChargesToSlips, mergeIntoStock, slipUnit, sameOrder, archiveBlockers,
} from '../src/api/slips.js'

let k = 0
const uid = () => 'e' + (++k)
const total = entries => Math.round(entries.reduce((a, e) => a + e.qty * e.price, 0) * 100) / 100
const slip = (over = {}) => ({ id: 's1', wholesaler: 'Nedco', invoiceNumber: '5962096-01', poNumber: 'P0022311', orderDate: '2026-11-02', kind: 'order', jobs: [], lineItems: [], ...over })

describe('what a slip is', () => {
  it('a slip with a PO is an order; no PO and tagged for pricing is a pricing quote', () => {
    expect(slipKind(slip())).toBe('order')
    expect(slipKind(slip({ poNumber: '', kind: 'pricing' }))).toBe('pricing')
    expect(slipKind(slip({ poNumber: 'PO #', kind: 'pricing' }))).toBe('pricing') // "PO #" alone is not a PO
    expect(slipKind(slip({ poNumber: 'P0022311', kind: 'pricing' }))).toBe('order') // a PO makes it an order
  })
  it('an order with no PO is "waiting" while new and untouched, "none" once picked up, put on a job, or a month old', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(noPoState(slip({ poNumber: '', orderDate: today }))).toBe('waiting')
    expect(noPoState(slip({ poNumber: '', orderDate: today, receivedAt: today }))).toBe('none')
    expect(noPoState(slip({ poNumber: '', orderDate: today, jobs: [{ id: 'j1' }] }))).toBe('none')
    expect(noPoState(slip({ poNumber: '', orderDate: '2026-01-01' }))).toBe('none')
    expect(noPoState(slip())).toBeNull()
  })
})

describe('charging a slip line to jobs', () => {
  it('a line on one job charges all of it to that job, at the slip price per unit', () => {
    const o = slip({ jobs: [{ id: 'j1' }], lineItems: [{ id: 'l1', partNo: 'LEVGFTR1W', name: 'GFCI 15A', qty: 12, uom: 'ea', totalPrice: 159.96 }] })
    const e = jobEntriesFromSlip(o, 'j1', uid)
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ qty: 12, price: 13.33, partNo: 'LEVGFTR1W', source: 'Nedco · Inv 5962096-01 · PO P0022311' })
    expect(total(e)).toBe(159.96)
  })
  it('unit price comes from the line total when there is one, else the cost', () => {
    expect(slipUnit({ qty: 3, totalPrice: 100 })).toBeCloseTo(33.3333, 4)
    expect(slipUnit({ qty: 3, cost: 7.5 })).toBe(7.5)
    expect(slipUnit({ qty: 3 })).toBe(0)
  })
  it('a line shared by two jobs is one pool: what A uses, B can no longer take', () => {
    let orders = [slip({ lineItems: [{ id: 'l1', partNo: 'WIRTECK12/3', name: 'Teck 12/3', qty: 50, uom: 'm', totalPrice: 386.81, jobIds: ['jA', 'jB'] }] })]
    expect(initialUse(orders[0], orders[0].lineItems[0])).toEqual({}) // nobody's until they use it
    orders[0].lineItems[0].usedBy = {} // confirmed that way
    const key = 'slip:s1:l1'
    const a = setSlipLineUse(orders, { slipOrderId: 's1', orderKey: key, id: 'x' }, 'jA', 30, uid)
    orders = a.orders
    expect(lineRemaining(orders[0], orders[0].lineItems[0])).toBe(20)
    const b = setSlipLineUse(orders, { slipOrderId: 's1', orderKey: key, id: 'y' }, 'jB', 35, uid)
    expect(b.max).toBe(20)
    expect(b.entry.qty).toBe(20) // can't take more than is left
    const charged = a.entry.qty * a.entry.price + b.entry.qty * b.entry.price
    expect(Math.round(charged * 100) / 100).toBe(386.81) // the whole line, once
  })
  it('older slips (before shared lines) split a two-job line evenly', () => {
    const o = slip({ lineItems: [{ id: 'l1', name: 'Teck', qty: 50, totalPrice: 100, jobIds: ['jA', 'jB'] }] })
    expect(lineUse(o, o.lineItems[0])).toEqual({ jA: 25, jB: 25 })
    expect(total([...jobEntriesFromSlip(o, 'jA', uid), ...jobEntriesFromSlip(o, 'jB', uid)])).toBe(100)
  })
  it('setting a job back to 0 takes its charge off', () => {
    const orders = [slip({ jobs: [{ id: 'j1' }], lineItems: [{ id: 'l1', name: 'Box', qty: 10, totalPrice: 50 }] })]
    const r = setSlipLineUse(orders, { slipOrderId: 's1', orderKey: 'slip:s1:l1', id: 'x' }, 'j1', 0, uid)
    expect(r.entry).toBeNull()
    expect(jobEntriesFromSlip(r.orders[0], 'j1', uid)).toEqual([])
  })
  it('a Stock-only line goes all to Stock and charges no job', () => {
    const o = slip({ jobs: [{ id: GENERAL_STOCK_ID }], lineItems: [{ id: 'l1', name: 'Wirenuts', qty: 100, totalPrice: 20 }] })
    expect(lineUse(o, o.lineItems[0])).toEqual({ [GENERAL_STOCK_ID]: 100 })
    expect(jobEntriesFromSlip(o, GENERAL_STOCK_ID, uid)).toEqual([])
  })
  it('a line that came on a later release is charged from that slip, not this one', () => {
    const o = slip({ jobs: [{ id: 'j1' }], lineItems: [{ id: 'l1', name: 'Panel', qty: 1, totalPrice: 900, movedTo: 's2' }] })
    expect(jobEntriesFromSlip(o, 'j1', uid)).toEqual([])
  })
})

describe('closing out a job', () => {
  const shared = () => [slip({ lineItems: [{ id: 'l1', name: 'EMT 3/4', qty: 100, totalPrice: 250, received: true, jobIds: ['jA', 'jB'], usedBy: { jA: 40, jB: 30 } }] })]
  it('a shared line is not leftover until every job on it is complete', () => {
    expect(leftoverLinesForJob(shared(), { id: 'jA' }, id => id === 'jA')).toHaveLength(0)
    const left = leftoverLinesForJob(shared(), { id: 'jA' }, () => true)
    expect(left).toHaveLength(1)
    expect(left[0].remaining).toBe(30)
  })
  it('"used on this job" charges the rest to the job', () => {
    const orders = shared()
    const items = leftoverLinesForJob(orders, { id: 'jA' }, () => true)
    const r = closeOutLines(orders, { id: 'jA' }, items, 'use', [], uid)
    expect(r.orders[0].lineItems[0].usedBy).toEqual({ jA: 70, jB: 30 })
    expect(r.entries[0].qty).toBe(70)
    expect(r.stockLines).toEqual([])
  })
  it('"to Stock" moves the rest to Stock — and only received material reaches the shelf', () => {
    const orders = shared()
    const items = leftoverLinesForJob(orders, { id: 'jA' }, () => true)
    const r = closeOutLines(orders, { id: 'jA' }, items, 'stock', [], uid)
    expect(r.orders[0].lineItems[0].usedBy).toEqual({ jA: 40, jB: 30, [GENERAL_STOCK_ID]: 30 })
    expect(r.stockLines.map(s => s.li.qty)).toEqual([30])
    expect(r.entries[0].qty).toBe(40) // the job still pays only for what it used
    const notIn = shared(); notIn[0].lineItems[0].received = false
    expect(closeOutLines(notIn, { id: 'jA' }, items, 'stock', [], uid).stockLines).toEqual([])
  })
})

describe('a quote replaced by its packing slips', () => {
  const quote = { id: 'q1', docType: 'quote', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '5962096', poNumber: 'P0022311', jobs: [{ id: 'j1' }],
    lineItems: [{ id: 'a', partNo: 'LEVGFTR1W', name: 'GFCI', qty: 12, totalPrice: 159.96 }, { id: 'b', partNo: 'BOX4SQ', name: '4sq box', qty: 20, totalPrice: 60 }] }
  const job = { id: 'j1', materialEntries: [
    { id: 'm1', kind: 'order', slipOrderId: 'q1', orderKey: 'slip:q1:a', partNo: 'LEVGFTR1W', item: 'GFCI', qty: 12, price: 13.33 },
    { id: 'm2', kind: 'order', slipOrderId: 'q1', orderKey: 'slip:q1:b', partNo: 'BOX4SQ', item: '4sq box', qty: 20, price: 3 },
  ] }
  it('nothing changes while no packing slip is in', () => {
    expect(moveQuoteChargesToSlips([quote], job, uid)).toBeNull()
  })
  it('a slip with part of the order: those lines charge from the slip, the rest stays on the quote', () => {
    const ps = { id: 'p1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '5962096-01', poNumber: 'P0022311', receivedAt: '2026-11-04',
      lineItems: [{ id: 'x', partNo: 'LEVGFTR1W', name: 'GFCI', qty: 8, totalPrice: 106.64, received: true }] }
    expect(sameOrder(quote, ps)).toBe(true)
    const r = moveQuoteChargesToSlips([quote, ps], job, uid)
    const gfci = r.entries.filter(e => e.partNo === 'LEVGFTR1W')
    expect(gfci.find(e => e.slipOrderId === 'p1').qty).toBe(8)
    const rest = gfci.find(e => e.slipOrderId === 'q1')
    expect(rest).toMatchObject({ qty: 4, note: 'Rest of the quote — slip not in yet' })
    expect(gfci.reduce((a, e) => a + e.qty, 0)).toBe(12) // nothing lost, nothing doubled
    expect(r.entries.find(e => e.partNo === 'BOX4SQ').qty).toBe(20) // not on the slip: untouched
    // running it again changes nothing
    expect(moveQuoteChargesToSlips(r.orders, { ...job, materialEntries: r.entries }, uid)).toBeNull()
  })
  it('a slip line that went to Stock is taken back for the job when the quote says it was the job\'s', () => {
    const ps = { id: 'p1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '5962096-01', poNumber: 'P0022311',
      lineItems: [{ id: 'x', partNo: 'BOX4SQ', name: '4sq box', qty: 20, totalPrice: 60, received: true, jobIds: [GENERAL_STOCK_ID], usedBy: { [GENERAL_STOCK_ID]: 20 } }] }
    const r = moveQuoteChargesToSlips([quote, ps], job, uid)
    expect(r.orders.find(o => o.id === 'p1').lineItems[0].usedBy).toEqual({ j1: 20 })
    expect(r.stockTaken.map(s => s.qty)).toEqual([20]) // and off the shelf count
  })
})

describe('Stock and archiving', () => {
  it('received lines add to the matching Stock item by part #, or become a new one', () => {
    const stock = [{ id: 'st1', partNo: 'BOX4SQ', name: '4sq box', qty: 5, cost: 2.5 }]
    const next = mergeIntoStock(stock, { id: 's1' }, [{ partNo: 'box4sq', name: 'Box', qty: 10, cost: 3 }, { partNo: 'NEW1', name: 'New thing', qty: 2, cost: 1 }], uid)
    expect(next.find(s => s.id === 'st1')).toMatchObject({ qty: 15, cost: 3 })
    expect(next).toHaveLength(2)
  })
  it('a slip says what is stopping it from being archived', () => {
    const o = slip({ jobs: [{ id: 'j1' }], lineItems: [{ id: 'l1', name: 'Box', qty: 10, totalPrice: 50 }] })
    expect(archiveBlockers(o)).toEqual(['not fully received', 'quote & slips not balanced', 'not sent to Jonathan yet'])
  })
})
