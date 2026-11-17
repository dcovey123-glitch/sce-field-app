import { describe, it, expect } from 'vitest'
import { timePoolSummary, poolLaborLine, isLiveQuote } from '../src/api/timePool.js'

const log = [
  { id: 'a', bucket: 'planning', totalHours: 3.5 },
  { id: 'b', bucket: 'admin', totalHours: 2 },
  { id: 'c', bucket: 'admin', hoursEach: 1, workers: ['Dustin', 'Brandon'] }, // 2 man-hours
  { id: 'd', bucket: 'shop', totalHours: 5 }, // overhead — never in the pool
  { id: 'e', bucket: 'admin', totalHours: 3, quoteId: 'q1' }, // logged to quote q1
]
const withLine = (q, line, scope = 's1') => ({ ...q, scopes: [{ id: scope, name: 'Lighting', labor: [{ id: 'L' + Math.random(), ...line }] }] })

describe('Un-billed time pool', () => {
  it('counts helping and quoting only; time logged to a quote is kept for it', () => {
    const q1 = { id: 'q1', scopes: [] }, q2 = { id: 'q2', scopes: [] }
    const s = timePoolSummary(log, [q1, q2], 'q1')
    expect(s.pool).toEqual({ planning: 3.5, admin: 4 })
    expect(s.forQuote.toApply).toEqual({ planning: 0, admin: 3 })
    expect(timePoolSummary(log, [q1, q2], 'q2').forQuote.toApply).toEqual({ planning: 0, admin: 0 })
  })

  it('billing a piece into a quote takes it out of the pool; deleting the line puts it back', () => {
    const q2 = withLine({ id: 'q2' }, poolLaborLine({ bucket: 'planning', hours: 2, rate: 90 }))
    expect(timePoolSummary(log, [{ id: 'q1' }, q2]).pool).toEqual({ planning: 1.5, admin: 4 })
    expect(timePoolSummary(log, [{ id: 'q1' }, { id: 'q2', scopes: [] }]).pool).toEqual({ planning: 3.5, admin: 4 })
  })

  it('applying the hours logged to a quote clears its flag without touching the pool', () => {
    const q1 = withLine({ id: 'q1' }, poolLaborLine({ bucket: 'admin', hours: 3, from: 'quote', rate: 90 }))
    const s = timePoolSummary(log, [q1], 'q1')
    expect(s.forQuote.toApply.admin).toBe(0)
    expect(s.pool.admin).toBe(4)
    expect(s.forQuote.lines).toHaveLength(1)
  })

  it('a lost (invalidated or deleted) quote gives its hours back, including time logged to it', () => {
    const q1 = { ...withLine({ id: 'q1' }, poolLaborLine({ bucket: 'admin', hours: 1, rate: 90 })), invalidated: true }
    expect(isLiveQuote(q1)).toBe(false)
    expect(timePoolSummary(log, [q1]).pool).toEqual({ planning: 3.5, admin: 7 }) // 4 + the 3 logged to q1
    const gone = { ...q1, invalidated: false, trashedAt: '2026-11-16' }
    expect(timePoolSummary(log, [gone]).pool.admin).toBe(7)
  })

  it('the labor line carries the hours at the quote rate', () => {
    const l = poolLaborLine({ bucket: 'admin', hours: 2.5, rate: 95 })
    expect(l).toMatchObject({ desc: 'Estimating & quoting', qty: 2.5, rate: 95, timePool: { bucket: 'admin', from: 'pool' } })
  })
})
