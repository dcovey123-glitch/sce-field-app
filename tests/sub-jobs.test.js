import { describe, it, expect } from 'vitest'
import { parentCandidates, makeSubJobUpdates, quoteIdsOf } from '../src/api/subJobs.js'

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
      { id: 'b', patch: { relatedJobId: 'a' } },
      { id: 'b1', patch: { relatedJobId: 'a' } }
    ])
  })
  it('never under itself', () => {
    expect(makeSubJobUpdates(jobs, jobs[1], 'b')).toEqual([])
  })
  it('reads old single-quote jobs too', () => {
    expect(quoteIdsOf({ linkedQuoteId: 'q1' })).toEqual(['q1'])
    expect(quoteIdsOf({ linkedQuoteIds: ['q1', 'q2'] })).toEqual(['q1', 'q2'])
  })
})
