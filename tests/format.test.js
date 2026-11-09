// Money and dates look the same everywhere, and a date never slips a day
import { describe, it, expect } from 'vitest'
import { money, moneyWhole, moneyUnit, moneyOrBlank, round2, parseDay, fmtDate, fmtTime, dayKey } from '../src/api/format.js'

describe('money', () => {
  it('two decimals with commas; minus before the dollar sign', () => {
    expect(money(1234.5)).toBe('$1,234.50')
    expect(money(-12)).toBe('-$12.00')
    expect(money(0)).toBe('$0.00')
    expect(money(-0.001)).toBe('$0.00') // no "-$0.00"
  })
  it('reads numbers typed as text, and treats junk as $0', () => {
    expect(money('1,250.5')).toBe('$1,250.50')
    expect(money('$90')).toBe('$90.00')
    expect(money(undefined)).toBe('$0.00')
    expect(money('abc')).toBe('$0.00')
  })
  it('whole dollars, unit prices, and blank for nothing', () => {
    expect(moneyWhole(1234.5)).toBe('$1,235')
    expect(moneyUnit(0.4375)).toBe('$0.4375')
    expect(moneyUnit(12.5)).toBe('$12.50')
    expect(moneyOrBlank(0)).toBe('')
    expect(moneyOrBlank(5)).toBe('$5.00')
    expect(round2(13.333333)).toBe(13.33)
  })
})

describe('dates', () => {
  it('a plain day stays that day in Alberta (the billing date bug)', () => {
    expect(fmtDate('2026-11-08')).toBe('Nov 8') // was showing Nov 7
    expect(fmtDate('2026-11-08', 'medium')).toBe('Nov 8, 2026')
    expect(fmtDate('2026-11-08', 'weekday')).toBe('Sun, Nov 8')
    expect(fmtDate('2026-01-01', 'long')).toBe('Thursday, January 1, 2026')
    expect(dayKey('2026-11-08')).toBe('2026-11-08')
  })
  it('a moment is shown in Alberta Time (UTC-6): 11 pm here is already tomorrow in UTC', () => {
    expect(fmtDate('2026-11-09T05:00:00Z')).toBe('Nov 8')
    expect(dayKey('2026-11-09T05:00:00Z')).toBe('2026-11-08')
    expect(fmtTime('2026-11-08T21:05:00Z')).toBe('3:05 p.m.')
    expect(fmtDate('2026-11-08T21:05:00Z', 'when')).toBe('Nov 8, 3:05 p.m.')
  })
  it('months, and nothing for no date', () => {
    expect(fmtDate('2026-11', 'monthYear')).toBe('November 2026')
    expect(fmtDate('', 'medium')).toBe('')
    expect(fmtDate('not a date')).toBe('')
    expect(parseDay(null)).toBeNull()
  })
})
