// Which day the work week starts on — Sunday (Sun–Sat) unless changed in
// Time → ⚙ Week starts on. Timesheets, Time Tracking and the timesheet's
// material list all use this, so they always agree.
//
// A week is stored under the date of its first day ('YYYY-MM-DD'). Weeks
// already filled in keep their own dates; a change applies to new weeks, so
// it's best changed between weeks.
export const WEEK_START_KEY = 'week_start_day' // 0 = Sunday … 6 = Saturday
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekStartDay() {
  try {
    const v = JSON.parse(localStorage.getItem('fieldapp_' + WEEK_START_KEY))
    return Number.isInteger(v) && v >= 0 && v <= 6 ? v : 0
  } catch { return 0 }
}
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const asDate = x => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? new Date(x + 'T00:00:00') : new Date(x))

// First day of the week holding `date` (a Date at local midnight)
export function startOfWeek(date = new Date(), ws = weekStartDay()) {
  const d = asDate(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7))
  return d
}
// 'YYYY-MM-DD' of that first day — the key a week is stored under
export const weekKeyOf = (date = new Date(), ws) => ymd(startOfWeek(date, ws))
// 0…6: which day of its week `date` is
export const dayIndexInWeek = (date, ws = weekStartDay()) => (asDate(date).getDay() - ws + 7) % 7
// Name of day i of the week stored under `key` (works for any start day)
export function weekdayName(key, i, short = false) {
  const d = asDate(key); d.setDate(d.getDate() + i)
  const n = WEEKDAY_NAMES[d.getDay()]
  return short ? n.slice(0, 3) : n
}
// Last day ('YYYY-MM-DD') of the week stored under `key`
export function weekEndKey(key) { const d = asDate(key); d.setDate(d.getDate() + 6); return ymd(d) }
