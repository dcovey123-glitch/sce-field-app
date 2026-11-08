// Alberta Time is UTC-6 all year (since Nov 1, 2026)
import { describe, it, expect } from 'vitest'
import { todayLocal, monthLocal, abtHM, abtFromHM } from '../src/api/albertaTime.js'

describe('Alberta Time', () => {
  it('7:30 pm on the last day of the month stays in that month (UTC already says the 1st)', () => {
    const t = new Date('2026-12-01T01:30:00Z') // Nov 30, 7:30 pm Alberta Time
    expect(todayLocal(t)).toBe('2026-11-30')
    expect(monthLocal(t)).toBe('2026-11')
  })
  it('midnight rolls over at 06:00 UTC', () => {
    expect(todayLocal(new Date('2026-11-09T05:59:00Z'))).toBe('2026-11-08')
    expect(todayLocal(new Date('2026-11-09T06:00:00Z'))).toBe('2026-11-09')
  })
  it('typed clock times round-trip', () => {
    const iso = abtFromHM('2026-11-08', '07:30')
    expect(iso).toBe('2026-11-08T13:30:00.000Z')
    expect(abtHM(iso)).toBe('07:30')
  })
})
