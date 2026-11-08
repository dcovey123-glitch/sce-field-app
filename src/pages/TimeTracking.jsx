import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import TimeReview, { TIME_BUCKETS, localDate } from '../components/TimeReview.jsx'
import NoteEdit from '../components/NoteEdit.jsx'
import TimeEntryEditor from '../components/TimeEntryEditor.jsx'
import { useCrewRoster } from '../api/crewRoster.js'
import PostTimeToLabor, { unpostedCount } from '../components/PostTimeToLabor.jsx'
import { addDayToSheets } from '../api/timesheetFromClock.js'

// Crew-clock time tracking. Confirmed days are written to job.trackedTime and
// (optionally) the weekly timesheet. Nothing here feeds labor actuals, T&M
// totals or billing.

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay()) // Sunday — same Sun–Sat weeks as Timesheets
  return x
}
function inRange(dateStr, range) {
  if (range === 'all') return true
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  if (range === 'week') return d >= startOfWeek(now)
  if (range === 'lastweek') { const s = startOfWeek(now); const ps = new Date(s); ps.setDate(ps.getDate() - 7); return d >= ps && d < s }
  if (range === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  return true
}
const fmt = n => (Math.round(n * 100) / 100).toFixed(2)

const pill = active => ({
  padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  border: '1px solid ' + (active ? 'var(--navy)' : 'var(--border)'),
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--text-mid)',
})

export default function TimeTracking() {
  const [pending] = useLocalStore('time_pending', [])
  const [nonJob, setNonJob] = useLocalStore('time_nonjob_log', [])
  const [tab, setTab] = useState('catchup')
  const [range, setRange] = useState('week')
  const [day, setDay] = useState(localDate())
  const [workday, setWorkday] = useLocalStore('time_workday_hours', 8)
  const [openJob, setOpenJob] = useState(null)
  const [editing, setEditing] = useState(null) // confirmed entry being edited
  const crew = useCrewRoster()
  const workers = crew.active.map(p => p.name)
  const meName = crew.meName
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })

  const custName = id => jobsStore.customers.find(c => c.id === id)?.name || ''
  // Jobs with clock time not yet posted to Labor Actual
  const toPostJobs = jobsStore.records.filter(j => !j.trashedAt && unpostedCount(j) > 0)
  const toPostCount = toPostJobs.reduce((s, j) => s + unpostedCount(j), 0)
  const jobRows = jobsStore.records
    .filter(j => !j.trashedAt && (j.trackedTime || []).length > 0)
    .map(j => {
      const entries = (j.trackedTime || []).filter(e => inRange(e.date, range))
      return { job: j, entries, total: entries.reduce((s, e) => s + (Number(e.totalHours) || 0), 0) }
    })
    .filter(r => r.entries.length > 0)
    .sort((a, b) => b.total - a.total)
  const jobsTotal = jobRows.reduce((s, r) => s + r.total, 0)

  const nonJobEntries = nonJob.filter(e => inRange(e.date, range))
  const bucketTotals = Object.entries(TIME_BUCKETS).map(([id, label]) => ({
    id, label, total: nonJobEntries.filter(e => e.bucket === id).reduce((s, e) => s + (Number(e.totalHours) || 0), 0),
  }))
  const nonJobTotal = bucketTotals.reduce((s, b) => s + b.total, 0)
  const grand = jobsTotal + nonJobTotal

  // Every confirmed entry, flattened, for the catch-up timeline and accounting.
  const allEntries = [
    ...jobsStore.records.filter(j => !j.trashedAt).flatMap(j => (j.trackedTime || []).map(e => ({
      ...e, kind: 'job', jobId: j.id, jobName: j.name || 'Untitled', customer: custName(j.customerId) || '—',
    }))),
    ...nonJob.map(e => ({ ...e, kind: 'bucket', jobName: e.label, customer: 'Non-job' })),
  ]
  const hoursOf = e => Number(e.totalHours) || 0
  const dayEntries = allEntries.filter(e => e.date === day).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
  const dayTotal = dayEntries.reduce((s, e) => s + hoursOf(e), 0)
  // "Accounted" is person-hours for you only vs the workday target, so only
  // count entries you were on (hoursEach), not the helper's or the crew total.
  // Entries with no workers recorded are treated as yours.
  const isMine = e => !e.workers?.length || e.workers.some(w => (w || '').trim().toLowerCase() === (meName || '').trim().toLowerCase())
  const dayYours = dayEntries.filter(isMine).reduce((s, e) => s + (Number(e.hoursEach) || 0), 0)
  const dayPending = pending.filter(p => localDate(p.startedAt) === day)
  const unaccounted = Math.max(0, (Number(workday) || 0) - dayYours)
  const shiftDay = n => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); setDay(localDate(d.toISOString())) }
  const fmtDay = new Date(day + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
  const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

  // Accounting (selected range)
  const rangeEntries = allEntries.filter(e => inRange(e.date, range))

  // 📋 Push to timesheet: every confirmed entry in the range goes onto the
  // weekly Timesheets. Days already sent from End-of-day Catch-up are left
  // alone; pushing again replaces only what this button put there.
  const [sheets, setSheets] = useLocalStore('timesheets', {})
  const [pushMsg, setPushMsg] = useState('')
  const sentSessions = new Set(Object.values(sheets || {}).flatMap(w => (w.workers || []).flatMap(x => (x.days || []).flatMap(d => (Array.isArray(d) ? d : [d]).map(r => r && r.fromSession)))).filter(Boolean))
  const toPush = rangeEntries.filter(e => !(e.sessionId && sentSessions.has(e.sessionId)) && (e.workers || []).length > 0)
  function pushToTimesheet() {
    const byDate = {}
    for (const e of toPush.slice().sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')))) {
      const n = (e.workers || []).length
      const hrs = Math.round((Number(e.hoursEach) || (Number(e.totalHours) || 0) / n) * 100) / 100
      if (!(hrs > 0)) continue
      const project = e.kind === 'job' ? `${e.customer && e.customer !== '—' ? e.customer + ' — ' : ''}${e.jobName}` : (e.jobName || 'Non-job')
      const day = byDate[e.date] || (byDate[e.date] = {})
      ;(e.workers || []).forEach((name, i) => {
        const key = String(name).trim().toLowerCase()
        const p = day[key] || (day[key] = { name, workerId: (e.workerIds || [])[i] || crew.findByName?.(name)?.id || '', rows: [] })
        p.rows.push({ jobId: e.kind === 'job' ? e.jobId : '', project, hours: hrs, ot: !!e.ot, note: e.note || '' })
      })
    }
    const dates = Object.keys(byDate).sort()
    if (!dates.length) { setPushMsg('Nothing new to push — everything in this range is already on the timesheet.'); return }
    const me = crew.me ? { name: crew.me.name, id: crew.me.id } : null
    setSheets(sh => dates.reduce((acc, date) => addDayToSheets(acc, { date, sessionId: 'tt:' + date, people: Object.values(byDate[date]), me }), sh))
    const hours = dates.reduce((t, d) => t + Object.values(byDate[d]).reduce((a, p) => a + p.rows.reduce((x, r) => x + r.hours, 0), 0), 0)
    setPushMsg(`✓ Pushed ${fmt(hours)} h over ${dates.length} day${dates.length === 1 ? '' : 's'} to Timesheets. Pushing again replaces these rows (no doubles).`)
  }
  const rangeTotal = rangeEntries.reduce((s, e) => s + hoursOf(e), 0)
  const group = keyFn => {
    const m = new Map()
    rangeEntries.forEach(e => { const k = keyFn(e); m.set(k, (m.get(k) || 0) + hoursOf(e)) })
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const byCustomer = group(e => e.customer)
  const byJob = group(e => e.kind === 'job' ? `${e.customer} — ${e.jobName}` : e.jobName).slice(0, 10)
  const byWorker = (() => {
    const m = new Map()
    rangeEntries.forEach(e => (e.workers?.length ? e.workers : ['(unassigned)']).forEach(w => m.set(w, (m.get(w) || 0) + (Number(e.hoursEach) || 0))))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })()
  const weekDays = (() => {
    if (range !== 'week' && range !== 'lastweek') return null
    const s = startOfWeek(new Date()); if (range === 'lastweek') s.setDate(s.getDate() - 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s); d.setDate(s.getDate() + i)
      const key = localDate(d.toISOString())
      const es = allEntries.filter(e => e.date === key)
      return { key, label: d.toLocaleDateString([], { weekday: 'short' }), job: es.filter(e => e.kind === 'job').reduce((a, e) => a + hoursOf(e), 0), non: es.filter(e => e.kind === 'bucket').reduce((a, e) => a + hoursOf(e), 0) }
    })
  })()
  const dayMax = weekDays ? Math.max(1, ...weekDays.map(d => d.job + d.non)) : 1
  const nonShare = rangeTotal > 0 ? (rangeEntries.filter(e => e.kind === 'bucket').reduce((s, e) => s + hoursOf(e), 0) / rangeTotal) * 100 : 0

  function Bars({ rows }) {
    const max = Math.max(0.0001, ...rows.map(r => r[1]))
    return rows.map(([name, v]) => (
      <div key={name} style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span>{name}</span><b>{fmt(v)} h <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>({rangeTotal ? Math.round(v / rangeTotal * 100) : 0}%)</span></b>
        </div>
        <div style={{ height: 8, background: 'var(--surface-2, #eef1f4)', borderRadius: 4 }}>
          <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: 'var(--navy)', borderRadius: 4 }} />
        </div>
      </div>
    ))
  }
  const heading = t => <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '16px 0 8px' }}>{t}</div>

  // Notes can be added or edited any time after an entry is confirmed
  function saveNote(e, note) {
    if (e.kind === 'job') {
      jobsStore.updateRecord(e.jobId, cur => ({ trackedTime: (cur.trackedTime || []).map(x => x.id === e.id ? { ...x, note } : x) }))
    } else {
      setNonJob(l => l.map(x => x.id === e.id ? { ...x, note } : x))
    }
  }

  // Save edits to a confirmed entry — in place if it's still charged to the
  // same job/bucket, otherwise moved to the new one.
  async function saveEdit(e, { date, hoursEach, workers: ws, target, note }) {
    const base = {
      id: e.id, date, startedAt: e.startedAt, endedAt: e.endedAt, hoursEach, workers: ws,
      totalHours: Math.round(hoursEach * ws.length * 100) / 100, note, ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.category ? { category: e.category } : {}),
    }
    const oldTarget = e.kind === 'job' ? `job:${e.jobId}` : `bucket:${e.bucket}`
    const withBucket = t => ({ ...base, bucket: t.slice(7), label: TIME_BUCKETS[t.slice(7)] || t.slice(7) })

    if (target === oldTarget) {
      if (e.kind === 'job') {
        await jobsStore.updateRecord(e.jobId, cur => ({ trackedTime: (cur.trackedTime || []).map(x => x.id === e.id ? base : x) }))
      } else {
        setNonJob(l => l.map(x => x.id === e.id ? withBucket(target) : x))
      }
    } else {
      // remove from the old place…
      await deleteEntry(e)
      // …and add to the new one
      if (target.startsWith('job:')) {
        await jobsStore.updateRecord(target.slice(4), cur => ({ trackedTime: [...(cur.trackedTime || []).filter(x => x.id !== base.id), base] }))
      } else {
        setNonJob(l => [...l, withBucket(target)])
      }
    }
    setEditing(null)
  }
  const editBtn = (e, extra) => (
    <button onClick={ev => { ev.stopPropagation(); setEditing(e) }} title="Edit this entry" aria-label="Edit entry"
      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 14, padding: '0 2px', ...extra }}>✎</button>
  )

  // Remove a confirmed entry from wherever it's stored (a job, or the non-job log)
  async function deleteEntry(e) {
    if (e.kind === 'job') {
      await jobsStore.updateRecord(e.jobId, cur => ({ trackedTime: (cur.trackedTime || []).filter(x => x.id !== e.id) }))
    } else {
      setNonJob(l => l.filter(x => x.id !== e.id))
    }
  }
  function removeEntry(e) {
    const what = `${e.hoursEach} h${(e.workers?.length || 1) > 1 ? ` × ${e.workers.length} workers` : ''} on ${e.date}`
    if (!window.confirm(`Delete this time entry (${what})? This can't be undone.`)) return
    deleteEntry(e)
    if (editing && editing.id === e.id) setEditing(null)
  }
  const removeBtn = e => (
    <button onClick={ev => { ev.stopPropagation(); removeEntry(e) }} title="Delete this entry" aria-label="Delete entry"
      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 13, padding: '0 2px' }}>✕</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '14px 16px' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700 }}>⏱ Time Tracking</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
          Crew clock time from your phone. Confirmed days go onto the timesheet — never used for billing.
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 820 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <button style={pill(tab === 'catchup')} onClick={() => setTab('catchup')}>End-of-day Catch-up{pending.length > 0 ? ` (${pending.length})` : ''}</button>
          <button style={pill(tab === 'post')} onClick={() => setTab('post')}>Post to Jobs{toPostCount > 0 ? ` (${toPostCount})` : ''}</button>
          <button style={pill(tab === 'accounting')} onClick={() => setTab('accounting')}>Time Accounting</button>
          <button style={pill(tab === 'byjob')} onClick={() => setTab('byjob')}>By Job</button>
          <button style={pill(tab === 'nonjob')} onClick={() => setTab('nonjob')}>Non-job Time</button>
          <div style={{ flex: 1 }} />
          {tab !== 'catchup' && tab !== 'post' && [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['all', 'All time']].map(([id, label]) => (
            <button key={id} style={pill(range === id)} onClick={() => { setRange(id); setPushMsg('') }}>{label}</button>
          ))}
          {(
            <button onClick={pushToTimesheet} title="Put every confirmed entry in this period onto the weekly Timesheets (days already sent are skipped)"
              style={{ ...pill(false), background: '#1e7a34', borderColor: '#1e7a34', color: '#fff' }}>📋 Push {({ week: 'this week', lastweek: 'last week', month: 'this month', all: 'all time' })[range]} to timesheet{toPush.length ? ` (${toPush.length})` : ''}</button>
          )}
        </div>
        {pushMsg && <div style={{ fontSize: 12.5, marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: pushMsg.startsWith('✓') ? '#e6f4ea' : 'var(--surface-2)', color: pushMsg.startsWith('✓') ? '#1e7a34' : 'var(--text-mid)' }}>{pushMsg}</div>}

        {(tab === 'byjob' || tab === 'nonjob') && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {[['Total tracked', grand], ['On jobs', jobsTotal], ['Non-job', nonJobTotal]].map(([l, v]) => (
            <div key={l} style={{ flex: '1 1 120px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-light)' }}>{l}</div>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: 20, fontWeight: 700 }}>{fmt(v)} h</div>
            </div>
          ))}
        </div>}

        {tab !== 'catchup' && pending.length > 0 && (
          <div style={{ fontSize: 12, color: '#8a5d00', marginBottom: 10, cursor: 'pointer' }} onClick={() => setTab('catchup')}>{pending.length} entr{pending.length === 1 ? 'y is' : 'ies are'} waiting in End-of-day Catch-up and not counted yet →</div>
        )}

        {tab === 'catchup' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button style={pill(false)} onClick={() => shiftDay(-1)}>◀</button>
              <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <button style={pill(false)} onClick={() => shiftDay(1)}>▶</button>
              <button style={pill(day === localDate())} onClick={() => setDay(localDate())}>Today</button>
              <div style={{ flex: 1 }} />
              <label style={{ fontSize: 11, color: 'var(--text-light)' }}>Workday target{' '}
                <input type="number" step="0.5" min="0" value={workday} onChange={e => setWorkday(e.target.value)} style={{ width: 52, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} /> h
              </label>
            </div>

            <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{fmtDay}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              {[['Your hours logged', dayYours, null], ['Still to review', dayPending.reduce((s, p) => s + (p.seconds || 0) / 3600, 0), '#8a5d00'], ['Unaccounted vs target', Math.max(0, unaccounted - dayPending.reduce((s, p) => s + (p.seconds || 0) / 3600, 0)), unaccounted > 0 ? '#c0392b' : '#1e7a34']].map(([l, v, c]) => (
                <div key={l} style={{ flex: '1 1 120px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-light)' }}>{l}</div>
                  <div style={{ fontFamily: 'var(--font-d)', fontSize: 20, fontWeight: 700, color: c || 'var(--text)' }}>{fmt(v)} h</div>
                </div>
              ))}
            </div>

            <TimeReview day={day} allowManual />

            {heading('Confirmed for this day')}
            {dayEntries.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Nothing confirmed for this day yet.</div>
              : dayEntries.map(e => (
                <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                  <span style={{ width: 62, color: 'var(--text-mid)' }}>{fmtTime(e.startedAt) || '—'}</span>
                  <span style={{ flex: 1 }}>
                    <b>{e.kind === 'job' ? `${e.customer} — ${e.jobName}` : e.jobName}</b>
                    <span style={{ color: 'var(--text-light)' }}> · {(e.workers?.length || 1)} × {e.hoursEach} h</span>
                    {e.ot && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#9a6610' }}>OT</span>}
                    <div><NoteEdit value={e.note} onSave={v => saveNote(e, v)} /></div>
                  </span>
                  <b>{fmt(e.totalHours)} h</b>
                  {editBtn(e)}
                  {removeBtn(e)}
                </div>
              ))}
            {dayEntries.length > 0 && <div style={{ textAlign: 'right', fontSize: 12, marginTop: 6 }}>Crew total: <b>{fmt(dayTotal)} h</b></div>}
          </>
        )}

        {tab === 'catchup' && toPostCount > 0 && (
          <div style={{ fontSize: 12, color: '#8a5d00', margin: '12px 0', cursor: 'pointer' }} onClick={() => setTab('post')}>
            {toPostCount} confirmed entr{toPostCount === 1 ? 'y is' : 'ies are'} waiting to be posted to job Labor Actual →
          </div>
        )}

        {tab === 'post' && (
          toPostJobs.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-light)', padding: 20, textAlign: 'center' }}>Nothing waiting. Confirmed crew-clock time shows up here until you post it to the job's Labor Actual.</div>
            : toPostJobs.map(job => (
              <PostTimeToLabor key={job.id} project={job}
                onUpdate={fn => jobsStore.updateRecord(job.id, fn)}
                heading={<div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>
                  {custName(job.customerId)} — {job.name || 'Untitled'}
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', marginLeft: 8 }}>{job.type === 'tm' ? 'T&M' : job.type === 'warranty' ? 'Warranty' : 'Quoted'}</span>
                </div>} />
            ))
        )}

        {tab === 'accounting' && (
          rangeEntries.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-light)', padding: 20, textAlign: 'center' }}>No confirmed time in this period yet.</div>
            : <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                {[['Total tracked', `${fmt(rangeTotal)} h`], ['Non-job share', `${Math.round(nonShare)}%`], ['Entries', String(rangeEntries.length)]].map(([l, v]) => (
                  <div key={l} style={{ flex: '1 1 120px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-light)' }}>{l}</div>
                    <div style={{ fontFamily: 'var(--font-d)', fontSize: 20, fontWeight: 700 }}>{v}</div>
                  </div>
                ))}
              </div>

              {weekDays && (
                <>
                  {heading('By day')}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120, marginBottom: 4 }}>
                    {weekDays.map(d => (
                      <div key={d.key} style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
                        <div style={{ height: 90, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-light)' }}>{d.job + d.non > 0 ? fmt(d.job + d.non) : ''}</div>
                          <div title={`Non-job ${fmt(d.non)} h`} style={{ height: `${(d.non / dayMax) * 78}px`, background: '#e0a716', borderRadius: '3px 3px 0 0' }} />
                          <div title={`Jobs ${fmt(d.job)} h`} style={{ height: `${(d.job / dayMax) * 78}px`, background: 'var(--navy)' }} />
                        </div>
                        <div style={{ marginTop: 3 }}>{d.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}><span style={{ color: 'var(--navy)' }}>■</span> Jobs &nbsp;<span style={{ color: '#e0a716' }}>■</span> Non-job</div>
                </>
              )}

              {heading('By customer / category')}
              <Bars rows={byCustomer} />
              {heading('Top jobs & buckets')}
              <Bars rows={byJob} />
              {byWorker.length > 0 && (<>{heading('By worker (hours each)')}<Bars rows={byWorker} /></>)}
            </>
        )}

        {tab === 'byjob' && (
          jobRows.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-light)', padding: 20, textAlign: 'center' }}>No tracked job time in this period. Clock in from the Time tab on your phone, then hit Sync now on the Mobile page.</div>
            : jobRows.map(({ job, entries, total }) => (
              <div key={job.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
                <div onClick={() => setOpenJob(o => o === job.id ? null : job.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{job.name || 'Untitled'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{custName(job.customerId)} · {job.type === 'tm' ? 'T&M' : job.type === 'warranty' ? 'Warranty' : 'Quoted'} · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{fmt(total)} h</div>
                  <div style={{ color: 'var(--text-light)' }}>{openJob === job.id ? '▾' : '▸'}</div>
                </div>
                {openJob === job.id && (
                  <div style={{ padding: '0 12px 8px' }}>
                    {entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => (
                      <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ width: 80, color: 'var(--text-mid)' }}>{e.date}</span>
                        <span style={{ flex: 1 }}>
                          {(e.workers?.length || 1)} × {e.hoursEach} h{e.workers?.length ? ` (${e.workers.join(', ')})` : ''}
                          <div><NoteEdit value={e.note} onSave={v => saveNote({ ...e, kind: 'job', jobId: job.id }, v)} /></div>
                        </span>
                        <b>{fmt(e.totalHours)} h</b>
                        {editBtn({ ...e, kind: 'job', jobId: job.id, jobName: job.name, customer: custName(job.customerId) })}
                        {removeBtn({ ...e, kind: 'job', jobId: job.id })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
        )}

        {tab === 'nonjob' && (
          <>
            {bucketTotals.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{b.label}</span><b>{fmt(b.total)} h</b>
              </div>
            ))}
            {nonJobEntries.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '14px 0 6px' }}>Entries</div>}
            {nonJobEntries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ width: 80, color: 'var(--text-mid)' }}>{e.date}</span>
                <span style={{ flex: 1 }}>{e.label} — {(e.workers?.length || 1)} × {e.hoursEach} h
                  <div><NoteEdit value={e.note} onSave={v => saveNote({ ...e, kind: 'bucket' }, v)} /></div>
                </span>
                <b>{fmt(e.totalHours)} h</b>
                {editBtn({ ...e, kind: 'bucket' })}
                {removeBtn({ ...e, kind: 'bucket' })}
              </div>
            ))}
          </>
        )}
      </div>
      {editing && (
        <TimeEntryEditor
          entry={editing} workers={workers}
          customers={jobsStore.customers.filter(c => !c.trashedAt)}
          jobs={jobsStore.records.filter(j => !j.trashedAt)}
          onCancel={() => setEditing(null)} onSave={vals => saveEdit(editing, vals)}
          onDelete={() => removeEntry(editing)}
        />
      )}
    </div>
  )
}
