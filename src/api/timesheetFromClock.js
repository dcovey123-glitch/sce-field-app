// Puts a confirmed crew-clock day onto the weekly Timesheets (the sheet that
// goes to Jonathan), so hours aren't typed in twice.
//
// One row per person per job for that day. Rows written here carry
// `fromSession` (the crew day's id) and `jobId`. Sending the same day again
// replaces only its own rows — anything typed by hand is left alone.

import { weekKeyOf } from './weekStart.js'

// Same week math as Timesheets.jsx (api/weekStart.js — Sun–Sat unless changed),
// keyed by the week's first day. A day files into the week that holds it, so
// its position is days since that key (works for any start day).
export function weekKeyFor(dateStr) { return weekKeyOf(dateStr) }
const dayIdxIn = (wk, dateStr) => Math.round((new Date(dateStr + 'T00:00:00') - new Date(wk + 'T00:00:00')) / 86400000)
const DAY_COUNT = 7
const lower = s => (s || '').trim().toLowerCase()
const blankRow = () => ({ reg: '', ot: '', project: '', notes: '' })
const isBlank = r => !r || (!r.reg && !r.ot && !(r.project || '').trim() && !(r.notes || '').trim())

/**
 * sheets   – the whole `timesheets` store { [weekKey]: { workers: [...] } }
 * date     – 'YYYY-MM-DD'
 * sessionId– the crew day's id (so a re-send replaces its own rows)
 * people   – [{ name, workerId, rows: [{ jobId, project, hours, ot, note }] }]  rows in time order
 *            ot = true only when "OT rates apply" was ticked — never worked out automatically
 * me       – { name, id } so a brand-new week starts with you on it, like Timesheets does
 * Returns the updated store.
 */
export function addDayToSheets(sheets, { date, sessionId, people, me, removeSessions }) {
  const wk = weekKeyFor(date)
  const dayIdx = dayIdxIn(wk, date)
  // rows from these earlier pushes come off first (re-pushing never doubles)
  const drop = new Set([sessionId, ...(removeSessions || [])].filter(Boolean))
  const next = { ...(sheets || {}) }
  const week = next[wk]
    ? { ...next[wk], workers: (next[wk].workers || []).slice() }
    : { workers: me ? [{ name: me.name, ...(me.id ? { workerId: me.id } : {}), days: Array.from({ length: DAY_COUNT }, () => [blankRow()]), expenses: [] }] : [] }

  // This crew day's earlier rows come out of EVERY worker first (handles a
  // person being removed from the day since it was last sent)
  week.workers = week.workers.map(w => {
    const days = (w.days || []).map(d => Array.isArray(d) ? d : [d])
    const cleaned = days.map((rows, i) => {
      if (i !== dayIdx) return rows
      const kept = rows.filter(r => !drop.has(r.fromSession))
      return kept.length ? kept : [blankRow()]
    })
    return { ...w, days: cleaned }
  })

  people.forEach(p => {
    if (!p.rows.length) return
    let idx = week.workers.findIndex(w => (p.workerId && w.workerId === p.workerId) || lower(w.name) === lower(p.name))
    if (idx === -1) {
      week.workers.push({ name: p.name, ...(p.workerId ? { workerId: p.workerId } : {}), days: Array.from({ length: DAY_COUNT }, () => [blankRow()]), expenses: [] })
      idx = week.workers.length - 1
    }
    const w = week.workers[idx]
    const days = (w.days || []).map(d => Array.isArray(d) ? d : [d])
    while (days.length < DAY_COUNT) days.push([blankRow()])
    const kept = days[dayIdx].filter(r => !isBlank(r))
    const added = p.rows.map(r => ({
      reg: !r.ot && r.hours ? String(r.hours) : '', ot: r.ot && r.hours ? String(r.hours) : '',
      project: r.project, notes: r.note || '', jobId: r.jobId || '', fromSession: r.session || sessionId,
    }))
    days[dayIdx] = [...kept, ...added]
    week.workers[idx] = { ...w, ...(p.workerId && !w.workerId ? { workerId: p.workerId } : {}), days }
  })

  next[wk] = week
  return next
}

// ── Push confirmed clock time onto the timesheets ──
// Every confirmed entry (job.trackedTime + the non-job log) dated from..to
// (inclusive, 'YYYY-MM-DD'). Days already sent from End-of-day Catch-up (their
// rows are still on a sheet) are skipped; pushing again replaces only what
// this put there (session 'tt:<date>'), so nothing doubles.
export function clockEntriesInRange({ jobs = [], customers = [], nonJob = [], from, to }) {
  const cust = id => (customers.find(c => c.id === id) || {}).name || ''
  const inR = d => d && (!from || d >= from) && (!to || d <= to)
  return [
    ...jobs.filter(j => !j.trashedAt).flatMap(j => (j.trackedTime || []).filter(e => inR(e.date)).map(e => ({
      ...e, kind: 'job', jobId: j.id, project: `${cust(j.customerId) ? cust(j.customerId) + ' — ' : ''}${j.name || 'Job'}`,
    }))),
    ...(nonJob || []).filter(e => inR(e.date)).map(e => ({ ...e, kind: 'bucket', jobId: '', project: e.label || 'Non-job' })),
  ]
}
// Every row already on a sheet, by the push that put it there
export function sentSessionsOf(sheets) {
  return new Set(Object.values(sheets || {}).flatMap(w => (w.workers || []).flatMap(x => (x.days || [])
    .flatMap(d => (Array.isArray(d) ? d : [d]).map(r => r && r.fromSession)))).filter(Boolean))
}
// One person's share of one confirmed entry is one timesheet line. Its push id
// is 'tte:<entry>:<person>', so a line can be pushed on its own, with the
// whole week, or again — and it's only ever on the sheet once.
export const lineSession = (e, name) => `tte:${e.id}:${lower(name)}`
// Is this person's share of this entry on a timesheet already?
export function lineOnSheet(sent, e, name) {
  return sent.has(lineSession(e, name)) || (e.sessionId && sent.has(e.sessionId)) || sent.has('tt:' + e.date)
}

/**
 * Push confirmed clock entries onto the timesheets.
 * entries  – the entries to push (with .project, .workers, .hoursEach …)
 * only     – optional person name: push just that person's lines
 * dayPool  – every confirmed entry (needed only to tidy rows from the older
 *            whole-day push, 'tt:<date>': that day is re-pushed whole, line by line)
 * Lines already sent from End-of-day Catch-up (the crew day's session) are left alone.
 */
export function pushClockTime(sheets, { entries, me, findPerson, only, dayPool }) {
  const sent = sentSessionsOf(sheets)
  let todo = entries.filter(e => !(e.sessionId && sent.has(e.sessionId)) && (e.workers || []).length > 0)
  // a day that still has old whole-day rows is converted whole, so nothing is lost
  const legacy = [...new Set(todo.map(e => e.date))].filter(d => sent.has('tt:' + d))
  if (legacy.length && dayPool) {
    const ids = new Set(todo.map(e => e.id))
    todo = [...todo, ...dayPool.filter(e => legacy.includes(e.date) && !ids.has(e.id) && !(e.sessionId && sent.has(e.sessionId)) && (e.workers || []).length > 0)]
  }
  const byDate = {}
  let fresh = 0
  for (const e of todo.slice().sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')))) {
    const n = e.workers.length
    const hrs = Math.round((Number(e.hoursEach) || (Number(e.totalHours) || 0) / n) * 100) / 100
    if (!(hrs > 0)) continue
    const day = byDate[e.date] || (byDate[e.date] = { people: {}, sessions: [] })
    e.workers.forEach((name, i) => {
      const legacyDay = legacy.includes(e.date)
      if (only && lower(name) !== lower(only) && !legacyDay) return
      const session = lineSession(e, name)
      if (!sent.has(session)) fresh++
      day.sessions.push(session)
      const key = lower(name)
      const p = day.people[key] || (day.people[key] = { name, workerId: (e.workerIds || [])[i] || (findPerson && findPerson(name)?.id) || '', rows: [] })
      p.rows.push({ jobId: e.jobId || '', project: e.project, hours: hrs, ot: !!e.ot, note: e.note || '', session })
    })
  }
  const dates = Object.keys(byDate).filter(d => Object.keys(byDate[d].people).length).sort()
  const next = dates.reduce((acc, date) => addDayToSheets(acc, {
    date, sessionId: 'tt:' + date, removeSessions: byDate[date].sessions, people: Object.values(byDate[date].people), me,
  }), sheets || {})
  const hours = dates.reduce((t, d) => t + Object.values(byDate[d].people).reduce((a, p) => a + p.rows.reduce((x, r) => x + r.hours, 0), 0), 0)
  return { sheets: next, dates, hours: Math.round(hours * 100) / 100, count: todo.length, fresh }
}
