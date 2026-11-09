// A job's material plan, and what's still open before a job is "Project current"
import { describe, it, expect } from 'vitest'
import { reservedElsewhere, stockFree, planLineStatus, planSummary, addPlanLinesToOrderList, tagSlipsFromRequests, linkCandidates, linkLine, unlinkLine, linkedLines } from '../src/api/materialPlan.js'
import { jobDeficiencies } from '../src/api/jobHealth.js'
import { missingSlipCharges, slipDuplicateOf } from '../src/api/materialsAudit.js'

let k = 0
const uid = () => 'u' + (++k)
const stock = [{ id: 'st1', partNo: 'BOX4SQ', name: '4sq box', qty: 20 }]
const job = (over = {}) => ({ id: 'j1', name: 'B208 Lighting', plannedMaterials: [], materialEntries: [], ...over })

describe('Stock reserved for jobs', () => {
  const jobs = [
    job({ id: 'jA', plannedMaterials: [{ id: 'a', stockPick: 'st1', qty: 8 }] }),
    job({ id: 'jB', plannedMaterials: [{ id: 'b', stockPick: 'st1', qty: 5 }] }),
    job({ id: 'jC', lifecycleStatus: 'billed', plannedMaterials: [{ id: 'c', stockPick: 'st1', qty: 50 }] }),
    job({ id: 'jD', trashedAt: '2026-11-01', plannedMaterials: [{ id: 'd', stockPick: 'st1', qty: 50 }] }),
  ]
  it('counts what other open jobs hold — billed and trashed jobs hold nothing', () => {
    expect(reservedElsewhere(jobs, 'st1', 'a')).toBe(5)
    expect(stockFree(stock, jobs, 'st1', 'a')).toMatchObject({ shelf: 20, held: 5, free: 15 })
  })
  it('a Stock line shows Reserved when there\'s enough free, and how many are free when there isn\'t', () => {
    expect(planLineStatus({ id: 'a', source: 'stock', stockPick: 'st1', qty: 8 }, jobs[0], { stock, jobs }).id).toBe('reserved')
    const s = planLineStatus({ id: 'a', source: 'stock', stockPick: 'st1', qty: 18 }, jobs[0], { stock, jobs })
    expect(s).toMatchObject({ tone: 'bad', label: '📦 Only 15 free on the shelf' })
    expect(planLineStatus({ id: 'x', source: 'stock', qty: 1 }, jobs[0], { stock, jobs }).id).toBe('pickstock')
  })
})

describe('an ordered plan line, step by step', () => {
  const line = { id: 'l1', partNo: 'LEVGFTR1W', item: 'GFCI 15A', qty: 12, source: 'order' }
  const J = job({ plannedMaterials: [line] })
  const ref = { jobId: 'j1', lineId: 'l1', qty: 12 }
  const st = ctx => planLineStatus(line, J, ctx).id
  it('To order → on the order sheet → sent → quoted → on a PO → part received → received', () => {
    expect(st({})).toBe('toorder')
    expect(st({ orderList: [{ partNo: 'LEVGFTR1W', planRefs: [ref] }] })).toBe('queued')
    const req = { id: 'r1', wholesaler: 'Nedco', sentAt: '2026-11-02T10:00:00Z', items: [{ partNo: 'LEVGFTR1W', planRefs: [ref] }] }
    expect(st({ requests: [req] })).toBe('sent')
    const row = { id: 'f1', supplier: 'Nedco', quoteNumber: '6056920' }
    expect(st({ requests: [{ ...req, matchedFeedId: 'f1' }], feedRows: [row] })).toBe('quoted')
    expect(st({ requests: [{ ...req, matchedFeedId: 'f1' }], feedRows: [{ ...row, poNumber: 'P0022311' }] })).toBe('onpo')
    const slip = (qty, received) => ({ id: 's1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '6056920-01', poNumber: 'P0022311', jobs: [{ id: 'j1' }], lineItems: [{ partNo: 'LEVGFTR1W', name: 'GFCI', qty, received }] })
    expect(planLineStatus(line, J, { orders: [slip(8, true)] })).toMatchObject({ id: 'partial', label: 'Received 8 of 12' })
    expect(st({ orders: [slip(12, true)] })).toBe('received')
  })
  it('the plan summary counts what needs you', () => {
    const s = planSummary([{ id: 'undecided' }, { id: 'toorder', tone: 'warn' }, { id: 'reserved', tone: 'bad' }, { id: 'received', tone: 'ok' }])
    expect(s).toMatchObject({ total: 4, needs: 3, received: 1, undecided: 1 })
  })
})

describe('the shared order sheet', () => {
  it('the same part from two jobs is one line, with each job\'s share; adding a line again replaces it, never doubles', () => {
    let list = addPlanLinesToOrderList([], { id: 'jA', name: 'Arena' }, [{ id: 'a1', partNo: 'BOX4SQ', item: '4sq box', uom: 'ea', qty: 10 }], uid)
    list = addPlanLinesToOrderList(list, { id: 'jB', name: 'Library' }, [{ id: 'b1', partNo: 'BOX4SQ', item: '4sq box', uom: 'ea', qty: 5 }], uid)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ qty: 15, jobName: 'Arena (10) · Library (5)' })
    list = addPlanLinesToOrderList(list, { id: 'jA', name: 'Arena' }, [{ id: 'a1', partNo: 'BOX4SQ', item: '4sq box', uom: 'ea', qty: 12 }], uid)
    expect(list[0].qty).toBe(17)
  })
  it('when the slip comes back, its line is split between the jobs as each asked, never past the line', () => {
    const reqs = [{ id: 'r1', matchedFeedId: 'f1', items: [{ partNo: 'BOX4SQ', planRefs: [{ jobId: 'jA', qty: 10 }, { jobId: 'jB', qty: 5 }] }] }]
    const orders = [{ id: 's1', kind: 'order', poNumber: 'P1', jobs: [], lineItems: [{ partNo: 'BOX4SQ', name: '4sq box', qty: 12 }] }]
    const out = tagSlipsFromRequests(orders, reqs, [{ id: 'f1', poNumber: 'P1' }])
    expect(out[0].lineItems[0]).toMatchObject({ jobIds: ['jA', 'jB'], usedBy: { jA: 10, jB: 2 }, autoTagged: true })
    expect(tagSlipsFromRequests(out, reqs, [{ id: 'f1', poNumber: 'P1' }])).toBeNull() // only once
  })
})

describe('job health — is the project current?', () => {
  it('a billed job has nothing left; a job with no status or done-but-unbilled says so', () => {
    expect(jobDeficiencies(job({ deficiencies: [{ text: 'x' }] }), { status: 'billed' })).toEqual([])
    expect(jobDeficiencies(job(), { status: null })).toContain('Status not set (Ongoing / Unbilled / Billed)')
    expect(jobDeficiencies(job(), { status: 'unbilled' })).toContain('Complete — not billed yet')
    expect(jobDeficiencies(job(), { status: 'ongoing' })).toEqual([])
  })
  it('lists clocked labor not posted, material with no price, and slip lines not on the job', () => {
    const j = job({ materialEntries: [{ id: 'm', item: 'Wire', qty: 3, price: 0 }] })
    const orders = [{ id: 's1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '1', poNumber: 'P1', jobs: [{ id: 'j1' }], lineItems: [{ id: 'l1', partNo: 'A1', name: 'Fixture lamp', qty: 2, totalPrice: 80 }] }]
    const out = jobDeficiencies(j, { status: 'ongoing', unposted: 2, orders })
    expect(out).toEqual(expect.arrayContaining(['Labor: 2 clocked entries not posted to the job', 'Materials: 1 item with no price', 'Materials: 1 slip line not on the job']))
    expect(missingSlipCharges(orders, j)[0]).toMatchObject({ qty: 2, value: 80 })
  })
  it('spots the same material charged twice (once by hand, once from the slip)', () => {
    const slipE = { id: 'a', orderKey: 'slip:s1:l1', partNo: 'A1', item: 'Fixture lamp', qty: 2, price: 40 }
    const hand = { id: 'b', partNo: '', item: 'Fixture lamp', qty: 2, price: 40 }
    expect(slipDuplicateOf(hand, [slipE, hand])).toBe(slipE)
    expect(jobDeficiencies(job({ materialEntries: [slipE, hand] }), { status: 'ongoing' })).toContain('Materials: 1 item charged twice')
  })
  it('plan lines not decided, or to order and not sent, are listed', () => {
    const j = job({ plannedMaterials: [{ id: 'p1', item: 'A', qty: 1, source: '' }, { id: 'p2', item: 'B', qty: 1, source: 'order' }] })
    expect(jobDeficiencies(j, { status: 'ongoing' })).toEqual(['Plan: 1 line not set to Stock or Order', 'Plan: 1 line to order, not sent'])
    expect(jobDeficiencies(j, { status: 'ongoing', orderSheet: [{ planRefs: [{ jobId: 'j1', lineId: 'p2' }] }] })).toEqual(['Plan: 1 line not set to Stock or Order'])
  })
  it('flagged labor, notes put on Needs you, overdue tasks and open deficiencies keep it from being current', () => {
    const j = job({
      laborEntries: [{ id: 'l', flag: { kind: 'Overtime not billed', note: 'Sat call-out' } }, { id: 'l2', flag: { kind: 'x', resolvedAt: '2026-11-01' } }],
      notesLog: [{ id: 'n', text: 'Ask Edwin about keys', needsMe: true }],
      tasks: [{ id: 't', text: 'Order lamps', due: '2026-01-01' }],
      deficiencies: [{ text: 'Cover plate missing' }, { text: 'fixed', resolved: true }],
    })
    expect(jobDeficiencies(j, { status: 'ongoing' })).toEqual([
      'Tasks: 1 overdue',
      'Labor: 1 flagged — Overtime not billed: Sat call-out',
      'Notes: 1 to address — Ask Edwin about keys',
      'Deficiencies: 1 open — Cover plate missing',
    ])
  })
})

describe('linking a plan line to an order by hand', () => {
  const line = { id: 'l1', partNo: 'GFCI15W', item: 'GFCI 15A white', qty: 12, source: 'order' }
  const J = job({ plannedMaterials: [line] })
  // Nedco wrote it its own way and the slip isn't tagged to the job: no auto-match
  const slip = { id: 's1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '6056920-01', poNumber: 'P0022311', orderDate: '2026-11-04', jobs: [], lineItems: [{ id: 'x', partNo: 'LEVGFTR1W', name: 'LEV SMARTLOCK GFCI 15A WH', qty: 12, received: true }] }
  it('without a link the line is still "To order"', () => {
    expect(planLineStatus(line, J, { orders: [slip] }).id).toBe('toorder')
  })
  it('the picker finds it by the words in the line, recent first', () => {
    const c = linkCandidates([slip], J, line, '', { today: '2026-11-09' })
    expect(c[0]).toMatchObject({ orderId: 's1', lineId: 'x', overlap: 2 })
    expect(linkCandidates([slip], J, line, 'smartlock', { today: '2026-11-09' })).toHaveLength(1)
    expect(linkCandidates([slip], J, line, 'breaker', { today: '2026-11-09' })).toHaveLength(0)
  })
  it('linked: follows that slip line — received, and says it isn\'t charged to the job yet', () => {
    const linked = linkLine(line, 's1', 'x')
    const s = planLineStatus(linked, J, { orders: [slip] })
    expect(s.id).toBe('received')
    expect(s.detail).toMatch(/not charged to this job yet/)
    expect(linkedLines(linked, [slip])[0]).toMatchObject({ label: 'Nedco #6056920-01', gone: false })
    expect(planLineStatus(unlinkLine(linked, 's1', 'x'), J, { orders: [slip] }).id).toBe('toorder')
  })
  it('linked to a slip on a PO that isn\'t in yet → On PO; to a quote with no PO → Quoted', () => {
    const notIn = { ...slip, lineItems: [{ ...slip.lineItems[0], received: false }] }
    expect(planLineStatus(linkLine(line, 's1', 'x'), J, { orders: [notIn] }).id).toBe('onpo')
    const quote = { ...slip, id: 'q1', docType: 'quote', poNumber: '', invoiceNumber: '6056920', lineItems: [{ ...slip.lineItems[0], received: false }] }
    expect(planLineStatus(linkLine(line, 'q1', 'x'), J, { orders: [quote] })).toMatchObject({ id: 'quoted', detail: 'Needs a PO · linked by you' })
  })
  it('linked to a quote line that was received counts as received', () => {
    const q = { ...slip, id: 'q2', docType: 'quote', invoiceNumber: '6040938' }
    expect(planLineStatus(linkLine(line, 'q2', 'x'), J, { orders: [q] }).id).toBe('received')
  })
  it('job health stops listing a linked line as "to order, not sent"', () => {
    expect(jobDeficiencies(job({ plannedMaterials: [linkLine(line, 's1', 'x')] }), { status: 'ongoing' })).toEqual([])
  })
})
