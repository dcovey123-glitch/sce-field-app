import { ABT_TZ, todayLocal } from './albertaTime.js'

// How money and dates look, everywhere in the app. One place, so a total on
// one screen reads the same as on the next, and a date never slips a day.

const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''))) || 0
const fmtNum = (v, min, max) => Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: min, maximumFractionDigits: max })
const sign = v => (v < 0 && Math.abs(v) >= 0.005 ? '-' : '')

// $1,234.56 · -$12.00 · $0.00
export const money = v => { const n = num(v); return `${sign(n)}$${fmtNum(n, 2, 2)}` }
// $1,235 (rounded to the dollar)
export const moneyWhole = v => { const n = Math.round(num(v)); return `${sign(n)}$${fmtNum(n, 0, 0)}` }
// Unit prices: $0.4375 · $12.50 (2 to 4 decimals)
export const moneyUnit = v => { const n = num(v); return `${sign(n)}$${fmtNum(n, 2, 4)}` }
// Blank for nothing: '' instead of $0.00
export const moneyOrBlank = v => (num(v) ? money(v) : '')
export const moneyWholeOrBlank = v => (num(v) ? moneyWhole(v) : '')
export const round2 = v => Math.round(num(v) * 100) / 100

// ── Dates ──
// A plain day ("2026-11-08") is a day here, not midnight in London: read at
// noon so Alberta (UTC-6) never shows it as the day before. Timestamps as is.
export function parseDay(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v) ? null : v
  const s = String(v)
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : /^\d{4}-\d{2}$/.test(s) ? `${s}-15T12:00:00` : s)
  return isNaN(d) ? null : d
}

const STYLES = {
  short: { month: 'short', day: 'numeric' }, //                      Nov 8
  medium: { month: 'short', day: 'numeric', year: 'numeric' }, //    Nov 8, 2026
  weekday: { weekday: 'short', month: 'short', day: 'numeric' }, //  Sun, Nov 8
  weekdayLong: { weekday: 'long', month: 'short', day: 'numeric' }, // Sunday, Nov 8
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, // Sunday, November 8, 2026
  monthYear: { month: 'long', year: 'numeric' }, //                  November 2026
  month: { month: 'long' }, //                                       November
  monthShort: { month: 'short', year: '2-digit' }, //                Nov 26
  when: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, // Nov 8, 3:05 p.m.
  whenWeekday: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}
// fmtDate('2026-11-08') → "Nov 8"; fmtDate(x, 'medium') → "Nov 8, 2026"; '' when there's no date
export function fmtDate(v, style = 'short') {
  const d = parseDay(v)
  if (!d) return ''
  const opts = { ...(STYLES[style] || STYLES.short), timeZone: ABT_TZ } // Alberta Time, always
  return opts.hour ? d.toLocaleString('en-CA', opts) : d.toLocaleDateString('en-CA', opts)
}
// 3:05 p.m.
export const fmtTime = v => { const d = parseDay(v); return d ? d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: ABT_TZ }) : '' }
// The day as YYYY-MM-DD in Alberta Time (a plain day stays that day)
export const dayKey = (v = new Date()) => { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v); const d = parseDay(v); return d ? todayLocal(d) : '' }
