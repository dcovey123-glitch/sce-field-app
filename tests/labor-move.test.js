import { describe, it, expect } from 'vitest'
import { duplicateLabor, moveLabor, moveTargets } from '../src/api/laborMove.js'

// Modelled on Center for Financial Literacy: five days typed in by hand,
// then the same five posted from the clock.
const rates = [{ id: 'journeyman', label: 'Journeyman', rate: 90 }]
const typed = (id, date, worker, hours, what) => ({ id, date, worker, hours, rateId: 'journeyman', workCompleted: what })
const posted = (id, tid, date, worker, hours, what) => ({ ...typed(id, date, worker, hours, what), fromTracked: `${tid}|${worker}` })
const main = {
  id: 'main', name: 'Center for Financial Literacy', customerId: 'c',
  laborEntries: [
    typed('a', '2026-10-23', 'Dustin Covey', 6, 'Lighting Re-Work'),
    typed('b', '2026-10-22', 'Brandon Spelrem', 3, 'Microwave Plug Wiring'),
    posted('p1', 't1', '2026-10-23', 'Dustin Covey', 6, 'Lighting Re-Work'),
    posted('p2', 't2', '2026-10-22', 'Brandon Spelrem', 3, 'Microwave Plug Wiring'),
    posted('p3', 't3', '2026-10-22', 'Dustin Covey', 2, 'Lighting Work'),
  ],
  trackedTime: [
    { id: 't1', date: '2026-10-23', workers: ['Dustin Covey'], hoursEach: 6, totalHours: 6 },
    { id: 't2', date: '2026-10-22', workers: ['Brandon Spelrem'], hoursEach: 3, totalHours: 3 },
    { id: 't3', date: '2026-10-22', workers: ['Dustin Covey', 'Brandon Spelrem'], workerIds: ['d', 'b'], hoursEach: 2, totalHours: 4 },
  ],
}
const lighting = { id: 'sub', name: 'Financial Literacy - Lighting', customerId: 'c', relatedJobId: 'main' }

describe('Labor duplicates', () => {
  it('finds hand-typed entries that match clock-posted ones', () => {
    expect(duplicateLabor(main)).toEqual({ a: 'p1', b: 'p2' })
  })
})

describe('Moving labor', () => {
  it('moves the entries and the clock time behind them', () => {
    const res = moveLabor({ source: main, target: lighting, ids: ['p1', 'p3'], sourceRates: rates, targetRates: [] })
    expect(res.source.laborEntries.map(e => e.id)).toEqual(['a', 'b', 'p2'])
    expect(res.target.laborEntries.map(e => e.id)).toEqual(['p1', 'p3'])
    expect(res.target.laborEntries[0].movedFrom.jobId).toBe('main')
    expect(res.target.laborRates).toEqual(rates) // the rate came with it
    // t1 moved whole; t3 split: Dustin's 2 h moved, Brandon's stayed
    expect(res.source.trackedTime.map(t => [t.id, t.workers, t.totalHours])).toEqual([['t2', ['Brandon Spelrem'], 3], ['t3', ['Brandon Spelrem'], 2]])
    expect(res.source.trackedTime[1].workerIds).toEqual(['b'])
    expect(res.target.trackedTime.map(t => [t.id, t.workers, t.totalHours])).toEqual([['t1', ['Dustin Covey'], 6], ['t3', ['Dustin Covey'], 2]])
    expect(res.target.trackedTime[1].workerIds).toEqual(['d'])
  })
  it('typed entries move without touching clock time', () => {
    const res = moveLabor({ source: main, target: lighting, ids: ['a'], sourceRates: rates, targetRates: rates })
    expect(res.source.trackedTime).toBeUndefined()
    expect(res.target.laborRates).toBeUndefined()
    expect(res.target.laborEntries.map(e => e.id)).toEqual(['a'])
  })
  it('lists the same job family first', () => {
    const other = { id: 'x', name: 'AC Elevator', customerId: 'c' }
    const far = { id: 'y', name: 'Arena', customerId: 'z' }
    expect(moveTargets([far, other, lighting, main], main).map(t => t.job.id)).toEqual(['sub', 'x', 'y'])
    expect(moveTargets([far, other, lighting, main], lighting).map(t => t.job.id)[0]).toBe('main')
  })
})
