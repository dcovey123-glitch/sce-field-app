// The calendar: every source lands on the right day, nothing doubled
import { describe, it, expect } from 'vitest'
import { buildDays, daySummary, upcoming, monthGrid, newEvent, eventFromEmail, onCalendar, dayMarks } from '../src/api/calendar.js'

let k = 0
const uid = () => 'id' + (++k)
const customers = [{ id: 'c1', name: 'Red Deer Polytechnic - Residence' }]
const job = {
  id: 'j1', customerId: 'c1', name: 'Tower 4 - Unit 44 - Bath GFI', dateStart: '2026-11-10', dateComplete: '2026-11-20',
  trackedTime: [
    { id: 't1', date: '2026-11-05', startedAt: '2026-11-05T15:00:00Z', endedAt: '2026-11-05T17:30:00Z', hoursEach: 2.5, workers: ['Brandon Spelrem', 'Dustin Covey'], totalHours: 5, note: 'Swapped GFCI' },
  ],
  laborEntries: [
    { id: 'l1', date: '2026-11-05', hours: 2.5, worker: 'Brandon Spelrem', workCompleted: 'Swapped GFCI', fromTracked: 't1' }, // posted from the clock — not twice
    { id: 'l2', date: '2026-11-04', hours: 3, worker: 'Tyler Gaudet', workCompleted: 'Pulled wire' },
  ],
  tasks: [{ id: 'k1', text: 'Order cover plate', due: '2026-11-12', done: false }, { id: 'k2', text: 'Test GFCI', done: true, doneAt: '2026-11-06T02:00:00Z', doneBy: 'Brandon' }],
  deficiencies: [{ id: 'd1', text: 'Cover plate missing', resolved: true, resolvedAt: '2026-11-05T20:00:00Z' }],
  billingHistory: [{ id: 'b1', date: '2026-11-04', amount: 200.66, percent: 100 }],
}
const ctx = {
  jobs: [job, { id: 'jt', name: 'Old', trashedAt: '2026-01-01', dateStart: '2026-11-05' }], customers,
  nonJob: [{ id: 'n1', date: '2026-11-05', hoursEach: 4, workers: ['Dustin Covey'], label: 'Admin / quoting', note: 'GWH Arena quote' }],
  events: [{ id: 'e1', date: '2026-11-12', start: '10:00', title: 'Site walk — Arts Vault', source: 'manual' }],
  outlook: [{ id: 'o1', start: '2026-11-12T21:30:00Z', end: '2026-11-12T22:00:00Z', subject: 'CANA weekly', location: 'Teams' }],
  dailyNotes: { '2026-11-05': [{ id: 's1', text: 'Panel B labelled', jobId: null }, { id: 's2', assistant: true, text: '10:46 AM · Justin (Nedco)…', miscEntries: [{ id: 'm' }] }] },
  orders: [{ id: 'o1', wholesaler: 'Nedco', invoiceNumber: '6056920-01', receivedAt: '2026-11-05T18:00:00Z', jobs: [{ name: 'Tower 4' }] }, { id: 'o2', kind: 'pricing', receivedAt: '2026-11-05T18:00:00Z' }],
  quotes: [{ id: 'q1', title: 'B208 Lighting', sentDate: '2026-11-04' }],
}
const days = buildDays('2026-11-01', '2026-11-30', ctx)

describe('a day of everything', () => {
  it('clocked time by worker, job and non-job, with what was done', () => {
    const t = days['2026-11-05'].time
    expect(t.map(w => [w.worker, w.hours])).toEqual([['Dustin Covey', 6.5], ['Brandon Spelrem', 2.5]])
    expect(t.find(w => w.worker === 'Dustin Covey').lines.map(l => l.project)).toEqual(['Red Deer Polytechnic - Residence — Tower 4 - Unit 44 - Bath GFI', 'Admin / quoting'])
    expect(t[1].lines[0]).toMatchObject({ note: 'Swapped GFCI', start: '9:00 a.m.', end: '11:30 a.m.' })
  })
  it('labor posted from the clock isn\'t listed twice; labor entered by hand is', () => {
    expect(days['2026-11-05'].work.some(w => w.kind === 'labor')).toBe(false)
    expect(days['2026-11-04'].work[0]).toMatchObject({ kind: 'labor', title: 'Pulled wire', hours: 3 })
  })
  it('tasks done, deficiencies fixed, notes, slips in, billing and quotes sent land on their day (Alberta Time)', () => {
    expect(days['2026-11-05'].work.map(w => w.kind).sort()).toEqual(['deffixed', 'taskdone']) // done 8 pm Nov 5 here = 02:00Z Nov 6
    expect(days['2026-11-05'].notes.map(x => x.kind)).toEqual(['note', 'assistant'])
    expect(days['2026-11-05'].materials).toHaveLength(1) // the pricing quote isn't material in
    expect(days['2026-11-04'].money.map(m => m.kind).sort()).toEqual(['billing', 'quotesent'])
  })
  it('schedule: your events and Outlook in time order, tasks due, job start and required-by; trashed jobs left out', () => {
    expect(days['2026-11-12'].schedule.map(s => s.title)).toEqual(['Order cover plate', 'Site walk — Arts Vault', 'CANA weekly'])
    expect(days['2026-11-12'].schedule.find(s => s.kind === 'outlook')).toMatchObject({ start: '3:30 p.m.', detail: 'Teams' })
    expect(days['2026-11-10'].schedule[0].title).toBe('Start — Red Deer Polytechnic - Residence — Tower 4 - Unit 44 - Bath GFI')
    expect(days['2026-11-20'].schedule[0].kind).toBe('jobdue')
    expect(days['2026-11-05'].schedule).toHaveLength(0)
  })
})

describe('glance, upcoming, month', () => {
  it('the hover summary says what\'s on in a few lines', () => {
    expect(daySummary(days['2026-11-05'])).toEqual(['⏱ 9 h — Dustin 6.5, Brandon 2.5', '🔧 2 work items', '📝 2 notes', '📦 1 slip in'])
    expect(daySummary(days['2026-11-12'])[1]).toBe('10:00 a.m. Site walk — Arts Vault')
    expect(dayMarks(days['2026-11-12'])).toEqual({ schedule: 3, time: false, other: 0 })
  })
  it('upcoming lists schedule items from today on, in order', () => {
    expect(upcoming(days, '2026-11-11').map(u => u.date)).toEqual(['2026-11-12', '2026-11-12', '2026-11-12', '2026-11-20'])
  })
  it('a month is whole weeks starting Sunday (or the week start you set)', () => {
    const g = monthGrid(2026, 11)
    expect(g[0][0]).toMatchObject({ date: '2026-11-01', inMonth: true })
    expect(g.length).toBe(5)
    expect(monthGrid(2026, 11, 1)[0][0].date).toBe('2026-10-26')
  })
})

describe('adding events', () => {
  it('by hand needs a date and a title', () => {
    expect(newEvent({ date: '2026-11-12', title: '  Meet Chad  ', start: '09:00' }, uid)).toMatchObject({ title: 'Meet Chad', source: 'manual', start: '09:00' })
    expect(newEvent({ date: '', title: 'x' }, uid)).toBeNull()
    expect(newEvent({ date: '2026-11-12', title: ' ' }, uid)).toBeNull()
  })
  it('from an email you OK\'d: keeps the link, and is only added once', () => {
    const item = { id: 'mail1#misc', from: 'Amanda (RDP)', subject: 'Power shutdown', webLink: 'https://outlook/x', event: { date: '2026-11-18', start: '07:00', end: '09:00', title: 'Power shutdown — Tower 1', place: 'Tower 1' } }
    const e = eventFromEmail(item, uid)
    expect(e).toMatchObject({ date: '2026-11-18', title: 'Power shutdown — Tower 1', source: 'email', emailId: 'mail1#misc', emailLink: 'https://outlook/x', notes: 'Tower 1 · From Amanda (RDP)' })
    expect(onCalendar([e], 'mail1#misc')).toBe(true)
    expect(eventFromEmail({ id: 'x' }, uid)).toBeNull()
  })
})
