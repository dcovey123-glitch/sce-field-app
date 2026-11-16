import { describe, it, expect } from 'vitest'
import { scheduleForHitList, tickSched, schedKey } from '../src/api/hitSchedule.js'
import { byPriority, nextPriority } from '../src/api/priority.js'
import { customerTodosForHitList, setTodoPriority, openTodos } from '../src/api/customerNotes.js'
import { moveTask } from '../src/api/tasks.js'

// Monday 2026-11-16, weeks start Monday (1)
const base = {
  today: '2026-11-16', weeks: 3, weekStart: 1,
  customers: [{ id: 'c1', name: 'RDP' }],
  jobs: [
    { id: 'j1', customerId: 'c1', name: 'B208 Door', dateStart: '2026-11-18', dateComplete: '2026-11-27', lifecycleStatus: 'onGoing' },
    { id: 'j2', customerId: 'c1', name: 'Old one', dateComplete: '2026-11-10', lifecycleStatus: 'onGoing' },
    { id: 'j3', customerId: 'c1', name: 'Billed', dateStart: '2026-11-17', dateComplete: '2026-11-19', lifecycleStatus: 'billed' },
  ],
  events: [{ id: 'e1', date: '2026-11-17', start: '11:00', title: 'Site visit RDRH', source: 'manual' }],
  outlook: [],
  emailFeed: { items: [
    { id: 'm1', subject: 'Shutdown', from: 'Edwin', event: { date: '2026-11-24', title: 'Power shutdown — Tower 1' } },
    { id: 'm2', subject: 'PO', target: { kind: 'job', name: 'B208 Door' }, fields: { dateStart: '2026-11-18', dateComplete: '2026-12-02' } },
    { id: 'm3', subject: 'Skipped', event: { date: '2026-11-19', title: 'Nope' } },
  ] },
  emailLocal: { decisions: { m3: { status: 'skipped' } } },
}

describe('Hit List schedule', () => {
  it('puts each date in the week it is scheduled', () => {
    const s = scheduleForHitList(base)
    expect(s.weeks.map(w => w.label)).toEqual(['This week', 'Next week', expect.stringMatching(/^Week of/)])
    const wk0 = s.weeks[0].items.map(i => i.title)
    expect(wk0).toContain('Site visit RDRH')
    expect(wk0).toContain('Start — RDP — B208 Door')
    expect(wk0.some(t => /Billed/.test(t))).toBe(false) // billed jobs left out
    expect(s.weeks[1].items.map(i => i.kind)).toEqual(['emailSuggest', 'jobdue']) // Nov 24 email date, then Nov 27 required-by (date order)
    // email gives a new required-by date (Dec 2), but not the start date the job already has
    expect(s.weeks[2].items.map(i => i.id)).toEqual(['ef:m2:dateComplete'])
    // skipped email dates stay out
    expect(JSON.stringify(s)).not.toContain('Nope')
  })
  it('lists required-by dates already gone by', () => {
    const s = scheduleForHitList(base)
    expect(s.overdue.map(i => i.jobId)).toEqual(['j2'])
  })
  it('email dates already on the calendar are not suggested again', () => {
    const s = scheduleForHitList({ ...base, events: [...base.events, { id: 'e2', date: '2026-11-24', title: 'Power shutdown', emailId: 'm1', source: 'email' }] })
    const kinds = s.weeks[1].items.map(i => i.kind)
    expect(kinds).toContain('email')
    expect(kinds).not.toContain('emailSuggest')
  })
  it('ticking one off hides it until its date moves', () => {
    let s = scheduleForHitList(base)
    const it0 = s.weeks[0].items.find(i => i.id === 'js:j1')
    const done = tickSched({}, it0)
    expect(Object.keys(done)).toEqual([schedKey(it0)])
    s = scheduleForHitList({ ...base, done })
    expect(s.weeks[0].items.some(i => i.id === 'js:j1')).toBe(false)
    expect(s.hidden).toBe(1)
    const moved = { ...base, done, jobs: base.jobs.map(j => j.id === 'j1' ? { ...j, dateStart: '2026-11-20' } : j) }
    expect(scheduleForHitList(moved).weeks[0].items.some(i => i.id === 'js:j1')).toBe(true)
  })
})

describe('Priority', () => {
  it('cycles Normal → High → Low → Normal', () => {
    expect(nextPriority('')).toBe('high')
    expect(nextPriority('high')).toBe('low')
    expect(nextPriority('low')).toBe('')
  })
  it('sorts High first and keeps order otherwise', () => {
    const l = [{ id: 'a' }, { id: 'b', priority: 'low' }, { id: 'c', priority: 'high' }, { id: 'd' }]
    expect(byPriority(l).map(x => x.id)).toEqual(['c', 'a', 'd', 'b'])
  })
  it('customer to-dos carry priority onto the Hit List', () => {
    const todos = setTodoPriority([{ id: 't1', text: 'x', at: '2026-01-01' }, { id: 't2', text: 'y', at: '2026-02-01' }], 't2', 'high')
    expect(openTodos(todos).map(t => t.id)).toEqual(['t2', 't1'])
    expect(customerTodosForHitList([{ id: 'c', name: 'C', todos }]).map(t => t.id)).toEqual(['t2', 't1'])
  })
  it('task ▲▼ moves within the order shown (High first)', () => {
    const job = { tasks: [{ id: 'a', done: false }, { id: 'b', done: false, priority: 'high' }, { id: 'c', done: false }] }
    const patch = moveTask('c', -1)(job)
    expect(byPriority(patch.tasks).map(t => t.id)).toEqual(['b', 'c', 'a'])
  })
})
