import { describe, it, expect } from 'vitest'
import { timePoolSummary, poolLaborLine, isLiveQuote, patchPoolLine, poolByMonth, PENDING_DAYS } from '../src/api/timePool.js'

const log = [
  { date: '2026-11-05', id: 'a', bucket: 'planning', totalHours: 3.5 },
  { date: '2026-11-05', id: 'b', bucket: 'admin', totalHours: 2 },
  { date: '2026-11-05', id: 'c', bucket: 'admin', hoursEach: 1, workers: ['Dustin', 'Brandon'] }, // 2 man-hours
  { date: '2026-11-05', id: 'd', bucket: 'shop', totalHours: 5 }, // overhead — never in the pool
  { date: '2026-11-05', id: 'e', bucket: 'admin', totalHours: 3, quoteId: 'q1' }, // logged to quote q1
]
const withLine = (q, line, scope = 's1') => ({ ...q, scopes: [{ id: scope, name: 'Lighting', labor: [{ id: 'L' + Math.random(), ...line }] }] })

describe('Un-billed time pool', () => {
  it('counts helping and quoting only; time logged to a quote is kept for it', () => {
    const q1 = { id: 'q1', scopes: [] }, q2 = { id: 'q2', scopes: [] }
    const s = timePoolSummary(log, [q1, q2], 'q1')
    expect(s.pool).toMatchObject({ planning: 3.5, admin: 4 })
    expect(s.forQuote.toApply).toMatchObject({ planning: 0, admin: 3 })
    expect(timePoolSummary(log, [q1, q2], 'q2').forQuote.toApply).toMatchObject({ planning: 0, admin: 0 })
  })

  it('billing a piece into a quote takes it out of the pool; deleting the line puts it back', () => {
    const q2 = withLine({ id: 'q2' }, poolLaborLine({ bucket: 'planning', hours: 2, rate: 90 }))
    expect(timePoolSummary(log, [{ id: 'q1' }, q2]).pool).toMatchObject({ planning: 1.5, admin: 4 })
    expect(timePoolSummary(log, [{ id: 'q1' }, { id: 'q2', scopes: [] }]).pool).toMatchObject({ planning: 3.5, admin: 4 })
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
    expect(timePoolSummary(log, [q1]).pool).toMatchObject({ planning: 3.5, admin: 7 }) // 4 + the 3 logged to q1
    const gone = { ...q1, invalidated: false, trashedAt: '2026-11-16' }
    expect(timePoolSummary(log, [gone]).pool.admin).toBe(7)
  })

  it('the labor line carries the hours at the quote rate', () => {
    const l = poolLaborLine({ bucket: 'admin', hours: 2.5, rate: 95 })
    expect(l).toMatchObject({ desc: 'Estimating & quoting', qty: 2.5, rate: 95, timePool: { bucket: 'admin', from: 'pool' } })
  })
})

describe('Pool start date', () => {
  it('counts pool time from the start day; time logged to a quote counts whatever its date', () => {
    const dated = [
      { bucket: 'admin', totalHours: 5, date: '2026-10-20' },
      { bucket: 'admin', totalHours: 2, date: '2026-11-01' },
      { bucket: 'planning', totalHours: 1, date: '2026-11-03' },
      { bucket: 'admin', totalHours: 4, date: '2026-10-25', quoteId: 'q1' },
    ]
    const s = timePoolSummary(dated, [{ id: 'q1' }], 'q1')
    expect(s.pool).toMatchObject({ planning: 1, admin: 2 })
    expect(s.forQuote.toApply.admin).toBe(4)
    expect(timePoolSummary(dated, [{ id: 'q1' }], null, '2026-10-01').pool.admin).toBe(7)
  })
})

describe('Pending, recovered and back', () => {
  const day = 86400000
  const now = Date.parse('2026-11-16T12:00:00Z')
  const lineAt = (bucket, hours, daysAgo, extra = {}) => ({ id: 'x' + Math.random(), desc: 'x', qty: hours, rate: 90, timePool: { bucket, from: 'pool', at: new Date(now - daysAgo * day).toISOString(), ...extra } })
  const q = (id, labor, extra = {}) => ({ id, quoteNumber: id, scopes: [{ id: 's', name: 'S', labor }], ...extra })
  const log = [{ date: '2026-11-02', bucket: 'admin', totalHours: 20 }, { date: '2026-11-03', bucket: 'prep', totalHours: 6 }]

  it('ordering & prep time builds the pool; general admin does not', () => {
    const s = timePoolSummary([...log, { date: '2026-11-04', bucket: 'office', totalHours: 9 }], [], null, '2026-11-01', now)
    expect(s.pool).toEqual({ planning: 0, admin: 20, prep: 6 })
  })
  it('approved = recovered, out = pending, both held out of the pool', () => {
    const s = timePoolSummary(log, [q('A', [lineAt('admin', 4, 10)], { approved: true }), q('B', [lineAt('admin', 3, 10)])], null, '2026-11-01', now)
    expect(s.recovered.admin).toBe(4)
    expect(s.pending.admin).toBe(3)
    expect(s.pool.admin).toBe(13)
  })
  it(`no approval in ${PENDING_DAYS} days, or released by hand → back in the pool`, () => {
    const old = q('C', [lineAt('admin', 5, PENDING_DAYS + 1)])
    const rel = q('D', [lineAt('admin', 2, 3, { released: '2026-11-15' })])
    const s = timePoolSummary(log, [old, rel], null, '2026-11-01', now)
    expect(s.back.admin).toBe(7)
    expect(s.pool.admin).toBe(20)
    expect(s.lines.map(l => l.why)).toEqual([`no approval in ${PENDING_DAYS} days`, 'released'])
    // approved later anyway → it counts as recovered again
    expect(timePoolSummary(log, [{ ...old, approved: true }], null, '2026-11-01', now).recovered.admin).toBe(5)
  })
  it('release / un-release only changes the line marker', () => {
    const quote = q('E', [{ ...lineAt('prep', 2, 1), id: 'L1' }, { id: 'L2', desc: 'Install', qty: 8, rate: 90 }])
    const p = patchPoolLine(quote, 'L1', { released: '2026-11-16' })
    expect(p.scopes[0].labor[0].timePool.released).toBe('2026-11-16')
    expect(p.scopes[0].labor[1]).toEqual(quote.scopes[0].labor[1])
    const back = patchPoolLine({ ...quote, ...p }, 'L1', { released: null })
    expect(back.scopes[0].labor[0].timePool.released).toBeUndefined()
  })
  it('month by month: logged vs billed in', () => {
    const rows = poolByMonth(log, [q('A', [lineAt('admin', 4, 2)], { approved: true })], '2026-11-01', now)
    expect(rows[0]).toMatchObject({ month: '2026-11', logged: 26, recovered: 4 })
  })
})
