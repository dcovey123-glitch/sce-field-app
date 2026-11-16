// The Hit List's "Scheduled" part: what's on, week by week, pulled from
//   • the Calendar — your events, email dates you OK'd, Outlook appointments
//   • jobs — start dates and required-by (completion) dates
//   • the morning email run — dates it found that you haven't put on the
//     Calendar yet (shown as "from email", one click adds them; nothing goes
//     on by itself)
// Each item lands in the week it's scheduled. Ticking one off only hides it
// from the Hit List (kept in hit_list_sched_done); it doesn't change the job,
// the Calendar or Outlook. If its date moves, it shows again.
import { buildDays, hm12 } from './calendar.js'
import { weekKeyOf, weekEndKey } from './weekStart.js'
import { fmtDate } from './format.js'

export const SCHED_DONE_KEY = 'hit_list_sched_done' // { "<item id>@<date>": ISO when ticked }

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const schedKey = it => `${it.id}@${it.date}`

const KIND_ORDER = { jobdue: 0, jobstart: 1, event: 2, email: 2, outlook: 3, emailSuggest: 4, emailDate: 4 }

// ctx: { today, weeks, weekStart, jobs, customers, events, outlook, emailFeed, emailLocal, done }
// → { overdue: [items], weeks: [{ key, label, from, to, items }], hidden }
export function scheduleForHitList(ctx) {
  const today = ctx.today
  const weeks = ctx.weeks || 6
  const from = weekKeyOf(today, ctx.weekStart)
  const to = addDays(from, weeks * 7 - 1)
  const done = ctx.done || {}
  const jobs = (ctx.jobs || []).filter(j => !j.trashedAt)
  const custName = id => ((ctx.customers || []).find(c => c.id === id) || {}).name || ''
  const isClosed = j => ['billed', 'unbilled', 'closed'].includes(j.lifecycleStatus) || j.completed

  const items = []
  // Calendar: yours, Outlook, job starts and required-by dates (tasks stay on Today)
  const days = buildDays(from, to, { jobs, customers: ctx.customers, events: ctx.events, outlook: ctx.outlook })
  for (const d of Object.values(days)) {
    for (const s of d.schedule) {
      if (s.kind === 'task') continue
      if (s.kind === 'jobstart') {
        const j = jobs.find(x => x.id === s.jobId)
        if (j && isClosed(j)) continue
      }
      items.push({ id: s.id, date: d.date, kind: s.kind, start: s.start || '', title: s.title, detail: s.detail || '', jobId: s.jobId || '', link: s.link || '' })
    }
  }

  // The morning run's email dates you haven't acted on yet
  const decided = (ctx.emailLocal && ctx.emailLocal.decisions) || {}
  const onCal = new Set((ctx.events || []).map(e => e.emailId).filter(Boolean))
  for (const it of (ctx.emailFeed && ctx.emailFeed.items) || []) {
    if (!it || !it.id) continue
    const dec = decided[it.id]
    const ev = it.event
    if (ev && isDay(ev.date) && ev.date >= from && ev.date <= to && !onCal.has(it.id) && !(dec && dec.status === 'skipped')) {
      items.push({ id: 'es:' + it.id, date: ev.date, kind: 'emailSuggest', start: hm12(ev.start || ''), title: ev.title || it.subject || 'From email', detail: [ev.place, it.from ? `From ${it.from}` : ''].filter(Boolean).join(' · '), link: it.webLink || '', emailItem: it })
    }
    // Start / required-by dates an email gives a job — they fill the job when you approve the note
    if (dec || !it.fields) continue
    const name = (it.target && (it.target.name || it.target.quoteNumber)) || it.targetLabel || ''
    const job = it.target && it.target.kind === 'job' ? jobs.find(j => normName(j.name) === normName(it.target.name)) : null
    for (const [field, label, kind] of [['dateStart', 'Start', 'jobstart'], ['dateComplete', 'Required by', 'jobdue']]) {
      const v = it.fields[field]
      if (!isDay(v) || v < from || v > to || (job && job[field] === v)) continue
      items.push({ id: `ef:${it.id}:${field}`, date: v, kind: 'emailDate', dateKind: kind, start: '', title: `${label} — ${name || 'job'}`, detail: `From email${it.from ? ' · ' + it.from : ''} — approve it in Assistant Update to put it on the job`, link: it.webLink || '', jobId: job ? job.id : '' })
    }
  }

  // Required-by dates already gone by on jobs that aren't finished
  const overdue = jobs
    .filter(j => !isClosed(j) && isDay(j.dateComplete) && j.dateComplete < from)
    .map(j => ({ id: 'jd:' + j.id, date: j.dateComplete, kind: 'jobdue', start: '', title: `Required by — ${custName(j.customerId) ? custName(j.customerId) + ' — ' : ''}${j.name || 'Job'}`, detail: 'Past its required-by date', jobId: j.id }))
    .filter(it => !done[schedKey(it)])
    .sort((a, b) => a.date.localeCompare(b.date))

  let hidden = 0
  const visible = items.filter(it => (done[schedKey(it)] ? (hidden++, false) : true))
  const sortItems = list => list.sort((a, b) => a.date.localeCompare(b.date) || (KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5) || String(a.start).localeCompare(String(b.start)))

  const out = []
  for (let w = 0; w < weeks; w++) {
    const key = addDays(from, w * 7)
    const end = weekEndKey(key)
    const list = sortItems(visible.filter(it => it.date >= key && it.date <= end))
    out.push({ key, from: key, to: end, label: w === 0 ? 'This week' : w === 1 ? 'Next week' : `Week of ${fmtDate(key, 'short') || key}`, items: list })
  }
  return { overdue, weeks: out, hidden }
}

// Tick / untick a scheduled item on the Hit List
export const tickSched = (done, it) => ({ ...(done || {}), [schedKey(it)]: new Date().toISOString() })
export const untickAll = () => ({})
