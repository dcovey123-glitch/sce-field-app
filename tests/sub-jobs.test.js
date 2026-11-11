import { describe, it, expect } from 'vitest'
import { parentCandidates, makeSubJobUpdates, quoteIdsOf, whyCantCombine } from '../src/api/subJobs.js'
import { effectiveJobTotal, unbilledAmount, tmTotal, tmBillPatch, isCombinedChild, combinedChildren, setJobsSource } from '../src/api/billing.js'
import { closeoutChecks } from '../src/api/jobClose.js'

const customers = [{ id: 'c1', name: 'RDP' }, { id: 'c2', name: 'Other Co' }]
const jobs = [
  { id: 'a', name: 'Gym lighting', co: 'CO-12', customerId: 'c1' },
  { id: 'b', name: 'Gym lighting controls', co: 'CO-14', customerId: 'c1' },
  { id: 'b1', name: 'Gym sensors', customerId: 'c1', relatedJobId: 'b' },
  { id: 'x', name: 'Shop panel', customerId: 'c2' },
  { id: 't', name: 'Trashed', customerId: 'c1', trashedAt: '2026-01-01' },
  { id: 's', name: 'Already a sub', customerId: 'c1', relatedJobId: 'a' }
]

describe('picking a parent job', () => {
  it('leaves out itself, its own sub-jobs, sub-jobs, and trashed jobs; same customer first', () => {
    expect(parentCandidates(jobs, jobs[1], customers).map(p => p.id)).toEqual(['a', 'x'])
  })
  it('searches name, CO and customer', () => {
    expect(parentCandidates(jobs, jobs[1], customers, 'co-12').map(p => p.id)).toEqual(['a'])
    expect(parentCandidates(jobs, jobs[1], customers, 'other').map(p => p.id)).toEqual(['x'])
  })
})

describe('making it a sub-job', () => {
  it('points the job and its own sub-jobs at the new parent', () => {
    expect(makeSubJobUpdates(jobs, jobs[1], 'a')).toEqual([
      { id: 'b', patch: { relatedJobId: 'a', foldIntoParent: false } },
      { id: 'b1', patch: { relatedJobId: 'a' } }
    ])
    expect(makeSubJobUpdates(jobs, jobs[1], 'a', true)[0].patch).toEqual({ relatedJobId: 'a', foldIntoParent: true })
  })
  it('never under itself', () => {
    expect(makeSubJobUpdates(jobs, jobs[1], 'b')).toEqual([])
  })
  it('reads old single-quote jobs too', () => {
    expect(quoteIdsOf({ linkedQuoteId: 'q1' })).toEqual(['q1'])
    expect(quoteIdsOf({ linkedQuoteIds: ['q1', 'q2'] })).toEqual(['q1', 'q2'])
  })
})

describe('one CO, one total', () => {
  const main = { id: 'm', type: 'quoted', co: '101', jobValue: 10000, billedProgress: 50 }
  const add = { id: 's', type: 'quoted', co: '', coValue: 2500, relatedJobId: 'm', foldIntoParent: true }
  const own = { id: 'o', type: 'quoted', co: '102', jobValue: 800, relatedJobId: 'm' }
  const all = [main, add, own]
  it('a combined sub-job adds to the main job and shows nothing on its own; an own-CO sub-job stays separate', () => {
    expect(effectiveJobTotal(main, all)).toBe(12500)
    expect(effectiveJobTotal(add, all)).toBe(0)
    expect(effectiveJobTotal(own, all)).toBe(800)
    expect(unbilledAmount(main, all)).toBe(6250)
    expect(unbilledAmount(add, all)).toBe(0)
    expect(isCombinedChild(add, all)).toBe(true)
    expect(combinedChildren(main, all).map(j => j.id)).toEqual(['s'])
  })
  it('falls back to its own total if the main job is gone or a different type', () => {
    expect(effectiveJobTotal(add, [add])).toBe(2500)
    expect(effectiveJobTotal(add, [{ ...main, type: 'tm' }, add])).toBe(2500)
  })
  it('T&M: hours and marked-up materials of both, billed on the main job', () => {
    const a = { id: 'a', type: 'tm', actualLabor: 900, actualMaterials: 100 }
    const b = { id: 'b', type: 'tm', actualLabor: 450, actualMaterials: 200, relatedJobId: 'a', foldIntoParent: true }
    setJobsSource(() => [a, b])
    try {
      expect(tmTotal(a)).toBe(900 + 115 + 450 + 230)
      expect(tmTotal(b)).toBe(0)
      expect(tmBillPatch(a).billingHistory[0].amount).toBe(1695)
      expect(tmBillPatch(b)).toBeNull()
    } finally { setJobsSource(() => []) }
  })
  it('close-out doesn\'t ask a combined sub-job for its own CO or billing', () => {
    const ids = closeoutChecks({ ...add, dateStart: '2026-11-01' }, 'billed', { jobs: all }).map(c => c.id)
    expect(ids).not.toContain('co'); expect(ids).not.toContain('coValue'); expect(ids).not.toContain('billing')
  })
  it('only same-type, not-yet-billed jobs combine', () => {
    expect(whyCantCombine(add, main)).toBeNull()
    expect(whyCantCombine({ type: 'tm' }, main)).toMatch(/same type/)
    expect(whyCantCombine({ type: 'quoted', billingHistory: [{ amount: 5 }] }, main)).toMatch(/already been billed/)
    expect(whyCantCombine({ type: 'warranty' }, { type: 'warranty' })).toMatch(/Warranty/)
    expect(whyCantCombine({ type: 'quoted', customerId: 'c2' }, { ...main, customerId: 'c1' })).toMatch(/different customer/)
  })
  it('the jobs list shows a combined sub-job only inside its main job', async () => {
    const { topLevelJobs } = await import('../src/pages/Jobs.jsx')
    setJobsSource(() => all)
    try { expect(topLevelJobs(all).map(j => j.id)).toEqual(['m', 'o']) } finally { setJobsSource(() => []) }
  })
})
