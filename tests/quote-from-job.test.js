import { describe, it, expect } from 'vitest'
import { workToDate, workToDateScope, bringInWorkPatch, unlinkWorkPatch, pendingQuoteFor, becomeQuotedJobPatch, jobsToBringIn, WORK_TO_DATE_NAME } from '../src/api/quoteFromJob.js'

let k = 0
const uid = () => 'u' + (++k)
const job = {
  id: 'j1', name: 'Center for Financial Literacy', customerId: 'c', type: 'tm', co: '117',
  laborEntries: [{ date: '2026-10-21', hours: 2 }, { date: '2026-10-23', hours: 6 }, { date: '2026-10-22', hours: 3 }],
  materialEntries: [
    { partNo: 'LUT1', item: 'Wireless occ sensor', qty: 2, price: 105.95, uom: 'ea' },
    { partNo: 'LUT1', item: 'Wireless occ sensor', qty: 1, price: 105.95, uom: 'ea' },
    { partNo: 'SYE65904', item: '2x4 flat panel', qty: 2, price: 69.95, uom: 'ea' },
  ],
}

describe('Work done so far → quote', () => {
  it('adds up hours and merges like materials', () => {
    const w = workToDate(job)
    expect(w).toMatchObject({ hours: 11, matCost: 457.75, from: '2026-10-21', to: '2026-10-23' })
    expect(w.materials).toEqual([
      { partNo: 'LUT1', desc: 'Wireless occ sensor', qty: 3, uom: 'ea', rate: 105.95 },
      { partNo: 'SYE65904', desc: '2x4 flat panel', qty: 2, uom: 'ea', rate: 69.95 },
    ])
  })
  it('puts a Work completed to date scope first, at the quote rate', () => {
    const sc = workToDateScope(job, 90, uid)
    expect(sc.name).toBe(WORK_TO_DATE_NAME)
    expect(sc.labor).toEqual([expect.objectContaining({ desc: 'Labor completed to date', qty: 11, rate: 90 })])
    expect(sc.materials).toHaveLength(2)
    const quote = { id: 'q', rate: 95, scopes: [{ id: 's1', name: 'Remaining lighting' }] }
    const p = bringInWorkPatch(quote, job, uid)
    expect(p.scopes.map(s => s.name)).toEqual([WORK_TO_DATE_NAME, 'Remaining lighting'])
    expect(p.scopes[0].labor[0].rate).toBe(95)
    expect(p.fromJob).toMatchObject({ jobId: 'j1', hours: 11, matCost: 457.75 })
    // updating replaces the same scope (more hours logged since)
    const more = { ...job, laborEntries: [...job.laborEntries, { date: '2026-10-24', hours: 4 }] }
    const p2 = bringInWorkPatch({ ...quote, ...p }, more, uid)
    expect(p2.scopes.filter(s => s.name === WORK_TO_DATE_NAME)).toHaveLength(1)
    expect(p2.scopes[0].id).toBe(p.scopes[0].id)
    expect(p2.scopes[0].labor[0].qty).toBe(15)
    // unlink takes it back off
    expect(unlinkWorkPatch({ ...quote, ...p2 }).scopes.map(s => s.name)).toEqual(['Remaining lighting'])
  })
  it('the job is on hold only while the quote is out', () => {
    const j = { ...job, pendingQuoteId: 'q' }
    expect(pendingQuoteFor(j, [{ id: 'q' }])).toEqual({ id: 'q' })
    expect(pendingQuoteFor(j, [{ id: 'q', approved: true }])).toBeNull()
    expect(pendingQuoteFor(j, [{ id: 'q', invalidated: true }])).toBeNull()
    expect(pendingQuoteFor(job, [{ id: 'q' }])).toBeNull()
  })
  it('on approval the job becomes the quoted job', () => {
    const p = becomeQuotedJobPatch({ ...job, pendingQuoteId: 'q', linkedQuoteIds: ['old'] }, { id: 'q' }, 4321.567)
    expect(p).toMatchObject({ type: 'quoted', coValue: 4321.57, linkedQuoteIds: ['old', 'q'], pendingQuoteId: null })
    expect(p.becameQuotedFrom.wasType).toBe('tm')
  })
  it('offers T&M jobs of that customer that are not billed', () => {
    const jobs = [job, { ...job, id: 'b', lifecycleStatus: 'billed' }, { ...job, id: 'q2', type: 'quoted' }, { ...job, id: 'x', customerId: 'z' }]
    expect(jobsToBringIn(jobs, 'c').map(j => j.id)).toEqual(['j1'])
  })
})
