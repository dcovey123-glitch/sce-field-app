// The calendar: everything the app knows, by day.
//   Schedule  — your events (added by hand or from an email you OK'd), Outlook
//               appointments, tasks due, job start / required-by dates
//   Time      — clocked time, grouped by worker (job + hours + what was done)
//   Work      — labor posted by hand, tasks ticked off, deficiencies fixed
//   Notes     — Daily Notes, incl. the emails the Assistant filed that day
//   Materials — slips received
//   Money     — billing logged, quotes sent
// Pure functions: the screens hand in the data, these sort it into days.
import { dayKey, fmtTime } from './format.js'

export const CALENDAR_KEY = 'calendar_events' // your own events: [{ id, date, start, end, title, notes, jobId, source, emailId, emailLink, createdAt }]
export const OUTLOOK_KIND = 'outlook'

const n = v => Number(v) || 0
const r2 = v => Math.round(v * 100) / 100
const jobLabel = (j, custName) => `${custName ? custName + ' — ' : ''}${j.name || 'Job'}`
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

// ── Your events ──
export function newEvent(fields, uid) {
  const title = String(fields.title || '').trim()
  if (!isDay(fields.date) || !title) return null
  return { id: uid(), date: fields.date, start: fields.start || '', end: fields.end || '', title, notes: String(fields.notes || '').trim(), jobId: fields.jobId || '', source: fields.source || 'manual', ...(fields.emailId ? { emailId: fields.emailId } : {}), ...(fields.emailLink ? { emailLink: fields.emailLink } : {}), createdAt: new Date().toISOString() }
}
// An email item from the morning run that names a date → an event (once per email)
export function eventFromEmail(item, uid) {
  const ev = item && item.event
  if (!ev || !isDay(ev.date)) return null
  return newEvent({ date: ev.date, start: ev.start || '', end: ev.end || '', title: ev.title || item.subject || 'From email', notes: [ev.place, item.from ? `From ${item.from}` : ''].filter(Boolean).join(' · '), source: 'email', emailId: item.id, emailLink: item.webLink || '' }, uid)
}
export const onCalendar = (events, emailId) => (events || []).some(e => e.emailId && e.emailId === emailId)

// ── Building the days ──
// ctx: { jobs, customers, nonJob, events, outlook, dailyNotes, orders, quotes }
export function buildDays(from, to, ctx) {
  const days = {}
  const day = d => (days[d] || (days[d] = { date: d, schedule: [], time: [], work: [], notes: [], materials: [], money: [] }))
  const inR = d => isDay(d) && d >= from && d <= to
  const custName = id => ((ctx.customers || []).find(c => c.id === id) || {}).name || ''
  const jobs = (ctx.jobs || []).filter(j => !j.trashedAt)

  // Schedule — yours
  for (const e of ctx.events || []) if (inR(e.date)) day(e.date).schedule.push({ kind: e.source === 'email' ? 'email' : 'event', id: e.id, start: hm12(e.start), end: hm12(e.end), title: e.title, detail: e.notes || '', jobId: e.jobId || '', link: e.emailLink || '', editable: true })
  // Schedule — Outlook (read-only)
  for (const o of ctx.outlook || []) {
    const d = dayKey(o.start)
    if (!inR(d)) continue
    day(d).schedule.push({ kind: OUTLOOK_KIND, id: 'o:' + o.id, start: o.allDay ? '' : fmtTime(o.start), end: o.allDay ? '' : fmtTime(o.end), title: o.subject || '(no subject)', detail: [o.location, o.organizer].filter(Boolean).join(' · '), link: o.webLink || '' })
  }
  // Schedule — job dates and tasks due; Work — tasks done, deficiencies fixed, labor posted by hand
  for (const j of jobs) {
    const label = jobLabel(j, custName(j.customerId))
    const closed = ['billed', 'unbilled', 'closed'].includes(j.lifecycleStatus) || j.completed
    if (inR(j.dateStart)) day(j.dateStart).schedule.push({ kind: 'jobstart', id: 'js:' + j.id, title: `Start — ${label}`, jobId: j.id })
    if (!closed && inR(j.dateComplete)) day(j.dateComplete).schedule.push({ kind: 'jobdue', id: 'jd:' + j.id, title: `Required by — ${label}`, jobId: j.id })
    for (const t of j.tasks || []) {
      if (!t.done && inR(t.due)) day(t.due).schedule.push({ kind: 'task', id: 't:' + t.id, title: t.text, detail: [label, t.who].filter(Boolean).join(' · '), jobId: j.id })
      const doneDay = t.done && t.doneAt ? dayKey(t.doneAt) : ''
      if (inR(doneDay)) day(doneDay).work.push({ kind: 'taskdone', id: 'td:' + t.id, title: `✓ ${t.text}`, detail: [label, t.doneBy].filter(Boolean).join(' · '), jobId: j.id })
    }
    for (const d of j.deficiencies || []) {
      const fixed = d.resolved && d.resolvedAt ? dayKey(d.resolvedAt) : ''
      if (inR(fixed)) day(fixed).work.push({ kind: 'deffixed', id: 'df:' + d.id, title: `Deficiency fixed: ${d.text}`, detail: label, jobId: j.id })
    }
    // posted labor that didn't come from the clock (clocked time is listed under Time)
    for (const e of j.laborEntries || []) {
      if (e.fromTracked || !inR(e.date)) continue
      day(e.date).work.push({ kind: 'labor', id: 'l:' + e.id, title: e.workCompleted || 'Labor', detail: `${label} · ${e.worker || 'crew'} · ${r2(n(e.hours))} h`, hours: n(e.hours), worker: e.worker || '', jobId: j.id })
    }
    // Money — billing logged
    for (const b of j.billingHistory || []) if (inR(b.date)) day(b.date).money.push({ kind: 'billing', id: 'b:' + b.id, title: `Billed ${label}`, amount: n(b.amount), detail: b.tm ? 'T&M' : `${b.percent}%`, jobId: j.id })
  }

  // Time — clocked, by worker
  const clocked = [
    ...jobs.flatMap(j => (j.trackedTime || []).map(e => ({ ...e, project: jobLabel(j, custName(j.customerId)), jobId: j.id }))),
    ...(ctx.nonJob || []).map(e => ({ ...e, project: e.label || e.bucket || 'Admin / shop', jobId: '' })),
  ]
  for (const e of clocked) {
    if (!inR(e.date)) continue
    const people = (e.workers && e.workers.length ? e.workers : ['Crew'])
    const each = n(e.hoursEach) || (people.length ? n(e.totalHours) / people.length : 0)
    for (const w of people) {
      const list = day(e.date).time
      let row = list.find(x => x.worker === w)
      if (!row) { row = { worker: w, hours: 0, lines: [] }; list.push(row) }
      row.hours = r2(row.hours + each)
      row.lines.push({ id: e.id, project: e.project, jobId: e.jobId, hours: r2(each), note: e.note || '', start: e.startedAt ? fmtTime(e.startedAt) : '', end: e.endedAt ? fmtTime(e.endedAt) : '' })
    }
  }

  // Notes
  for (const [d, raw] of Object.entries(ctx.dailyNotes || {})) {
    if (!inR(d)) continue
    const secs = typeof raw === 'string' ? [{ id: d, text: raw }] : raw || []
    for (const s of secs) if (String(s.text || '').trim()) day(d).notes.push({ kind: s.assistant ? 'assistant' : 'note', id: 'n:' + s.id, title: s.assistant ? `Emails filed (${(s.miscEntries || []).length})` : (s.jobId ? (jobs.find(j => j.id === s.jobId) || {}).name || 'Note' : 'Note'), text: s.text, workers: s.workerNames || [] })
  }
  // Materials — slips received
  for (const o of ctx.orders || []) {
    const d = o.receivedAt ? dayKey(o.receivedAt) : ''
    if (!inR(d) || o.kind === 'pricing' || o.recordOnly) continue
    day(d).materials.push({ kind: 'slip', id: 's:' + o.id, title: `${o.wholesaler || 'Slip'}${o.invoiceNumber ? ' #' + o.invoiceNumber : ''}`, detail: [(o.jobs || []).map(x => x.name).filter(Boolean).join(', '), o.poNumber ? 'PO ' + o.poNumber : ''].filter(Boolean).join(' · ') })
  }
  // Money — quotes sent
  for (const q of ctx.quotes || []) if (!q.trashedAt && inR(q.sentDate)) day(q.sentDate).money.push({ kind: 'quotesent', id: 'q:' + q.id, title: `Quote sent — ${q.title || 'Quote'}`, detail: q.quoteNumber || '' })

  for (const d of Object.values(days)) {
    d.schedule.sort((a, b) => (a.start ? 0 : -1) - (b.start ? 0 : -1) || toMin(a.start) - toMin(b.start))
    d.time.sort((a, b) => b.hours - a.hours)
  }
  return days
}
// "13:30" (a time box) → "1:30 p.m.", the way Outlook times show
export function hm12(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return t || ''
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'a.m.' : 'p.m.'}`
}
// "9:30 a.m." / "13:30" → minutes, for sorting
function toMin(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([ap])?/i)
  if (!m) return -1
  let h = Number(m[1]) % 12
  if (!m[3] && Number(m[1]) >= 12) h = Number(m[1])
  if (m[3] && m[3].toLowerCase() === 'p') h += 12
  return h * 60 + Number(m[2])
}

// The short version for hovering over a date on the Home calendar
export function daySummary(d) {
  if (!d) return []
  const out = []
  for (const s of d.schedule.slice(0, 4)) out.push(`${s.start ? s.start + ' ' : ''}${s.title}`)
  if (d.schedule.length > 4) out.push(`+${d.schedule.length - 4} more on the schedule`)
  const hrs = r2(d.time.reduce((a, w) => a + w.hours, 0))
  if (hrs) out.push(`⏱ ${hrs} h — ${d.time.map(w => `${w.worker.split(' ')[0]} ${w.hours}`).join(', ')}`)
  if (d.work.length) out.push(`🔧 ${d.work.length} work item${d.work.length === 1 ? '' : 's'}`)
  if (d.notes.length) out.push(`📝 ${d.notes.length} note${d.notes.length === 1 ? '' : 's'}`)
  if (d.materials.length) out.push(`📦 ${d.materials.length} slip${d.materials.length === 1 ? '' : 's'} in`)
  for (const m of d.money) out.push(m.kind === 'billing' ? `💰 ${m.title}` : `📨 ${m.title}`)
  return out
}
// How busy a day is, for the dots on the month grid
export function dayMarks(d) {
  if (!d) return {}
  return { schedule: d.schedule.length, time: d.time.length > 0, other: d.work.length + d.notes.length + d.materials.length + d.money.length }
}
// Upcoming: schedule items from today on, in date order
export function upcoming(days, today, limit = 60) {
  return Object.values(days).filter(d => d.date >= today && d.schedule.length).sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(d => d.schedule.map(s => ({ ...s, date: d.date }))).slice(0, limit)
}
// The weeks shown for a month: Sunday-first (or the app's week start), whole weeks
export function monthGrid(year, month, weekStart = 0) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const back = (first.getUTCDay() - weekStart + 7) % 7
  const start = new Date(first.getTime() - back * 86400000)
  const weeks = []
  for (let w = 0; w < 6; w++) {
    const row = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + (w * 7 + i) * 86400000)
      row.push({ date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month - 1, day: d.getUTCDate() })
    }
    if (w >= 4 && !row.some(c => c.inMonth)) break
    weeks.push(row)
  }
  return weeks
}
