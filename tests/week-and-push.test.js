// Week start day + pushing clock time onto the timesheet line by line
import { describe, it, expect, beforeEach } from 'vitest'
import { weekKeyOf, dayIndexInWeek, weekdayName, startOfWeek } from '../src/api/weekStart.js'
import { pushClockTime, addDayToSheets, sentSessionsOf, lineOnSheet } from '../src/api/timesheetFromClock.js'

const store = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }
})

describe('week start', () => {
  it('defaults to Sunday–Saturday', () => {
    expect(weekKeyOf('2026-11-11')).toBe('2026-11-08') // Wed → Sun Nov 8
    expect(weekKeyOf('2026-11-08')).toBe('2026-11-08')
    expect(weekKeyOf('2026-11-14')).toBe('2026-11-08') // Sat ends the week
    expect(dayIndexInWeek('2026-11-14')).toBe(6)
    expect(weekdayName('2026-11-08', 0)).toBe('Sunday')
  })
  it('can start on Monday', () => {
    store.fieldapp_week_start_day = '1'
    expect(weekKeyOf('2026-11-08')).toBe('2026-11-02') // a Sunday is the end of a Mon week
    expect(weekKeyOf('2026-11-09')).toBe('2026-11-09')
    expect(weekdayName('2026-11-09', 0, true)).toBe('Mon')
    expect(startOfWeek('2026-11-11').getDay()).toBe(1)
  })
})

const entry = (id, date, workers, hoursEach, extra = {}) => ({ id, date, workers, hoursEach, totalHours: hoursEach * workers.length, project: 'RDP — Arena', jobId: 'j1', startedAt: date + 'T14:00:00Z', ...extra })
const rowsFor = (sheets, wk, name, i) => (sheets[wk].workers.find(w => w.name === name)?.days[i] || []).filter(r => r.reg || r.ot)

describe('pushing to the timesheet', () => {
  it('pushes one person’s line on its own, then the week without doubling', () => {
    const e1 = entry('e1', '2026-11-10', ['Dustin', 'Brandon'], 4)
    const e2 = entry('e2', '2026-11-11', ['Dustin'], 3)
    let r = pushClockTime({}, { entries: [e1], only: 'Brandon' })
    expect(rowsFor(r.sheets, '2026-11-08', 'Brandon', 2)).toHaveLength(1)
    expect(r.sheets['2026-11-08'].workers.some(w => w.name === 'Dustin' && rowsFor(r.sheets, '2026-11-08', 'Dustin', 2).length)).toBe(false)
    const sent = sentSessionsOf(r.sheets)
    expect(lineOnSheet(sent, e1, 'Brandon')).toBe(true)
    expect(lineOnSheet(sent, e1, 'Dustin')).toBe(false)
    // whole week
    r = pushClockTime(r.sheets, { entries: [e1, e2] })
    expect(rowsFor(r.sheets, '2026-11-08', 'Brandon', 2)).toHaveLength(1)
    expect(rowsFor(r.sheets, '2026-11-08', 'Dustin', 2)).toHaveLength(1)
    expect(rowsFor(r.sheets, '2026-11-08', 'Dustin', 3)).toHaveLength(1)
    // again — still no doubles
    r = pushClockTime(r.sheets, { entries: [e1, e2] })
    expect(r.fresh).toBe(0)
    expect(rowsFor(r.sheets, '2026-11-08', 'Dustin', 2)).toHaveLength(1)
  })
  it('leaves hand-typed rows alone', () => {
    let sheets = { '2026-11-08': { workers: [{ name: 'Dustin', days: Array.from({ length: 7 }, (_, i) => i === 2 ? [{ reg: '1', ot: '', project: 'Shop', notes: '' }] : [{ reg: '', ot: '', project: '', notes: '' }]) }] } }
    sheets = pushClockTime(sheets, { entries: [entry('e1', '2026-11-10', ['Dustin'], 4)] }).sheets
    expect(rowsFor(sheets, '2026-11-08', 'Dustin', 2).map(r => r.project)).toEqual(['Shop', 'RDP — Arena'])
  })
  it('turns an old whole-day push into lines without losing any', () => {
    const e1 = entry('e1', '2026-11-10', ['Dustin'], 4), e2 = entry('e2', '2026-11-10', ['Dustin'], 2)
    let sheets = addDayToSheets({}, { date: '2026-11-10', sessionId: 'tt:2026-11-10', people: [{ name: 'Dustin', rows: [{ project: 'RDP — Arena', hours: 4 }, { project: 'RDP — Arena', hours: 2 }] }] })
    sheets = pushClockTime(sheets, { entries: [e1], dayPool: [e1, e2] }).sheets
    const rows = rowsFor(sheets, '2026-11-08', 'Dustin', 2)
    expect(rows.map(r => r.reg)).toEqual(['4', '2'])
    expect(rows.every(r => r.fromSession.startsWith('tte:'))).toBe(true)
  })
  it('skips a day already sent from End-of-day Catch-up', () => {
    let sheets = addDayToSheets({}, { date: '2026-11-10', sessionId: 'crew1', people: [{ name: 'Dustin', rows: [{ project: 'RDP — Arena', hours: 4 }] }] })
    const r = pushClockTime(sheets, { entries: [entry('e1', '2026-11-10', ['Dustin'], 4, { sessionId: 'crew1' })] })
    expect(r.dates).toHaveLength(0)
  })
})
