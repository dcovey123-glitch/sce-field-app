// Alberta Time (ABT): UTC-6 all year, since Nov 1, 2026 (no more clock changes).
// The app works in Alberta Time no matter what the computer's time-zone data
// says — older time-zone tables (Windows, Electron's built-in copy) still think
// Edmonton falls back to UTC-7 in November, which shows times an hour behind.
export const ABT_TZ = 'Etc/GMT+6' // = UTC-6 (the sign is reversed in these names)
const OFFSET_MS = 6 * 3600 * 1000
const pad = n => String(n).padStart(2, '0')

// Clock parts in Alberta Time
export function abtParts(when = new Date()) {
  const x = new Date(new Date(when).getTime() - OFFSET_MS)
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() }
}
// "2026-11-08" — today's date in Alberta (not UTC, which is tomorrow after 6 pm)
export function todayLocal(when = new Date()) { const p = abtParts(when); return `${p.y}-${pad(p.m)}-${pad(p.d)}` }
// "2026-11"
export function monthLocal(when = new Date()) { const p = abtParts(when); return `${p.y}-${pad(p.m)}` }
// "07:30" for a time input, from a stored moment
export function abtHM(iso) { if (!iso) return ''; const p = abtParts(iso); return `${pad(p.h)}:${pad(p.min)}` }
// A day + "07:30" typed in Alberta Time → the stored moment (ISO)
export function abtFromHM(date, hm) {
  const [y, m, d] = String(date).split('-').map(Number)
  const [h, mi] = String(hm || '0:0').split(':').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, (h || 0), (mi || 0)) + OFFSET_MS).toISOString()
}

// Every date/time the app shows is drawn in Alberta Time unless a screen asks
// for another zone. Runs once, before anything renders (first import in main.jsx).
let installed = false
export function installAlbertaTime() {
  if (installed) return
  installed = true
  for (const fn of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    const orig = Date.prototype[fn]
    Date.prototype[fn] = function (locales, options) {
      if (options && options.timeZone) return orig.call(this, locales, options)
      return orig.call(this, locales, { ...(options || {}), timeZone: ABT_TZ })
    }
  }
}
installAlbertaTime()
