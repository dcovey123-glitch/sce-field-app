import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { effectiveLifecycleStatus } from '../pages/Jobs.jsx'
import { useCrewRoster } from '../api/crewRoster.js'
import CrewDayReview from './CrewDayReview.jsx'
import { setDone } from '../api/tasks.js'

export const TIME_BUCKETS = {
  planning: 'Project planning / helping',
  shop: 'Shop / yard',
  travel: 'Travel / pickup',
  admin: 'Admin / quoting',
}

function uid() { return Math.random().toString(36).slice(2, 10) }

// Local calendar date (YYYY-MM-DD) — toISOString() would give the UTC date,
// which flips to "tomorrow" for evening work in Alberta.
export function localDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function roundHours(h, step) {
  const n = Number(h) || 0
  if (!step || n <= 0) return Math.round(n * 100) / 100
  return Math.max(step, Math.round(n / step) * step)
}

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }

function ReviewRow({ item, jobs, customers, workers, meName, onAddWorker, rounding, onAssign, onDiscard }) {
  const initialTarget = item.jobId ? `job:${item.jobId}` : item.bucket ? `bucket:${item.bucket}` : ''
  const recorded = item.seconds ? (item.seconds || 0) / 3600 : 0
  // One entry can be split across several jobs/buckets — each line gets its own hours
  const [lines, setLines] = useState([{ key: 'l0', target: initialTarget, hours: recorded ? String(roundHours(recorded, rounding)) : '' }])
  const [chosen, setChosen] = useState([workers.includes(meName) ? meName : workers[0]].filter(Boolean))
  const [newWorker, setNewWorker] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const allocated = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const total = allocated * chosen.length
  const missing = [
    ...(lines.some(l => !(Number(l.hours) > 0)) ? ['enter the hours'] : []),
    ...(lines.some(l => !l.target) ? ['pick a job or category'] : []),
    ...(chosen.length === 0 ? ['pick at least one worker'] : []),
    ...(note.trim() ? [] : ['say what was done']),
  ]
  const valid = missing.length === 0
  const when = item.startedAt && !item.manual ? new Date(item.startedAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

  function setLine(key, patch) { setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l)) }
  function addLine() {
    setLines(ls => {
      const n = ls.length + 1
      const key = 'l' + Math.random().toString(36).slice(2, 6)
      if (!recorded) return [...ls, { key, target: '', hours: '' }]
      // split the recorded time evenly across all lines, remainder to the last
      const each = Math.floor((recorded / n) * 100) / 100
      const rest = Math.round((recorded - each * (n - 1)) * 100) / 100
      return [...ls.map(l => ({ ...l, hours: String(each) })), { key, target: '', hours: String(rest) }]
    })
  }
  function removeLine(key) { setLines(ls => ls.length > 1 ? ls.filter(l => l.key !== key) : ls) }
  function toggle(name) {
    setChosen(c => c.includes(name) ? c.filter(n => n !== name) : [...c, name])
  }
  function addWorker() {
    const typed = newWorker.trim()
    if (!typed) return
    // Goes on the Crew roster, so they're in every picker from now on
    const n = onAddWorker(typed)?.name || typed
    setChosen(c => c.includes(n) ? c : [...c, n])
    setNewWorker('')
  }

  const targetSelect = (l) => (
    <select value={l.target} onChange={e => setLine(l.key, { target: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 180 }}>
      <option value="">Assign to…</option>
      <optgroup label="Non-job time">
        {Object.entries(TIME_BUCKETS).map(([id, label]) => <option key={id} value={`bucket:${id}`}>{label}</option>)}
      </optgroup>
      {customers.map(c => {
        const list = jobs.filter(j => j.customerId === c.id)
        if (list.length === 0) return null
        return (
          <optgroup key={c.id} label={c.name}>
            {list.map(j => <option key={j.id} value={`job:${j.id}`}>{j.name || 'Untitled'}</option>)}
          </optgroup>
        )
      })}
    </select>
  )

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{item.label}{recorded ? <span style={{ fontWeight: 400, color: 'var(--text-light)' }}> · recorded {roundHours(recorded, 0).toFixed(2)} h</span> : null}</div>
        <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{when}</div>
      </div>
      {lines.map(l => (
        <div key={l.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-mid)' }}>Hours each{' '}
            <input type="number" step="0.25" min="0" value={l.hours} onChange={e => setLine(l.key, { hours: e.target.value })} style={{ ...inputStyle, width: 70 }} />
          </label>
          {targetSelect(l)}
          {l.target.startsWith('bucket:') && (
            <select value={l.tagJob || ''} onChange={e => setLine(l.key, { tagJob: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 180 }} title="Optional: charge this non-job time to a specific job">
              <option value="">No job (general {TIME_BUCKETS[l.target.slice(7)] || 'time'})</option>
              {customers.map(c => {
                const list = jobs.filter(j => j.customerId === c.id)
                if (list.length === 0) return null
                return (
                  <optgroup key={c.id} label={'Tag to job: ' + c.name}>
                    {list.map(j => <option key={j.id} value={j.id}>{j.name || 'Untitled'}</option>)}
                  </optgroup>
                )
              })}
            </select>
          )}
          {lines.length > 1 && (
            <button onClick={() => removeLine(l.key)} aria-label="Remove this job from the split" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15 }}>✕</button>
          )}
        </div>
      ))}
      <button onClick={addLine} style={{ marginTop: 8, padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: '1px dashed var(--border)', background: '#fff', color: 'var(--text-mid)' }}>
        ➕ Add another job (split the time)
      </button>
      {lines.length > 1 && recorded > 0 && Math.abs(allocated - recorded) > 0.01 && (
        <span style={{ marginLeft: 8, fontSize: 11, color: '#8a5d00' }}>
          {allocated.toFixed(2)} h of {recorded.toFixed(2)} h recorded is assigned
        </span>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Workers:</span>
        {workers.map(n => (
          <button key={n} onClick={() => toggle(n)} style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
            border: '1px solid ' + (chosen.includes(n) ? 'var(--navy)' : 'var(--border)'),
            background: chosen.includes(n) ? 'var(--navy)' : '#fff', color: chosen.includes(n) ? '#fff' : 'var(--text)',
          }}>{n}</button>
        ))}
        <input value={newWorker} onChange={e => setNewWorker(e.target.value)} onKeyDown={e => e.key === 'Enter' && addWorker()} placeholder="+ add to crew" style={{ ...inputStyle, width: 110, fontSize: 12 }} />
      </div>
      <textarea
        value={note} onChange={e => setNote(e.target.value)} rows={2}
        placeholder="What was done? (required — e.g. ran conduit to panel, troubleshot lighting controls)"
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 8, resize: 'vertical', borderColor: note.trim() ? 'var(--border)' : '#e0a716' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-mid)' }}>
          {chosen.length} worker{chosen.length === 1 ? '' : 's'} × {allocated.toFixed(2)} h = <b>{total.toFixed(2)} h</b> total
          {lines.length > 1 ? ` across ${lines.length} jobs` : ''}
          {!valid && <div style={{ color: '#8a5d00', marginTop: 2 }}>To confirm: {missing.join(', ')}</div>}
        </div>
        <button onClick={() => { if (item.manual || window.confirm('Discard this time entry?')) onDiscard() }} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Discard</button>
        <button
          disabled={!valid || saving}
          onClick={async () => { setSaving(true); try { await onAssign({ allocations: lines.map(l => l.target.startsWith('bucket:') && l.tagJob ? { target: 'job:' + l.tagJob, category: l.target.slice(7), hoursEach: Number(l.hours) } : { target: l.target, hoursEach: Number(l.hours) }), workers: chosen, note: note.trim() }) } finally { setSaving(false) } }}
          style={{ padding: '6px 14px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: valid ? 'pointer' : 'default', background: 'var(--accent)', color: 'var(--navy)', opacity: valid && !saving ? 1 : 0.5 }}
        >{saving ? 'Saving…' : 'Confirm'}</button>
      </div>
    </div>
  )
}

// Review queue for time entries sent from the phone's time clock.
// Confirmed time is stored for REVIEW ONLY (job.trackedTime) — it never feeds
// laborEntries, actualLabor, T&M totals or billing.
export default function TimeReview({ day, allowManual }) {
  const [pending, setPending] = useLocalStore('time_pending', [])
  const crew = useCrewRoster()
  const workers = crew.active.map(p => p.name)
  const [rounding, setRounding] = useLocalStore('time_rounding', 0.25)
  const [, setNonJobLog] = useLocalStore('time_nonjob_log', [])
  const [sort, setSort] = useState('time')
  const [manual, setManual] = useState([])
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })

  const customers = jobsStore.customers.filter(c => !c.trashedAt)
  const jobs = jobsStore.records.filter(j => !j.trashedAt && ['onGoing', 'deficiencies'].includes(effectiveLifecycleStatus(j)))
  const allJobs = jobsStore.records.filter(j => !j.trashedAt)
  const selectable = [...jobs, ...allJobs.filter(j => pending.some(p => p.jobId === j.id) && !jobs.includes(j))]

  const jobName = id => { const j = allJobs.find(x => x.id === id); return j ? j.name || 'Untitled' : '' }
  const items = [...pending, ...manual]
  const sorted = items.slice().sort((a, b) => {
    if (sort === 'hours') return (b.seconds || 0) - (a.seconds || 0)
    if (sort === 'job') return (jobName(a.jobId) || a.label || '').localeCompare(jobName(b.jobId) || b.label || '')
    return (a.startedAt || '').localeCompare(b.startedAt || '')
  })

  function buildEntry(item, hoursEach, ws, note) {
    return {
      id: uid(), date: item.manualDate || localDate(item.startedAt),
      startedAt: item.startedAt, endedAt: item.endedAt,
      hoursEach, workers: ws, totalHours: Math.round(hoursEach * ws.length * 100) / 100, note: note || '',
    }
  }
  async function writeEntry(target, entry) {
    if (target.startsWith('job:')) {
      const job = jobsStore.records.find(j => j.id === target.slice(4))
      if (!job) return false
      // Built from the job as it is when the save runs, so nothing saved a moment ago is lost
      await jobsStore.updateRecord(job.id, current => ({
        trackedTime: [...(current.trackedTime || []).filter(e => e.id !== entry.id), entry],
      }))
    } else {
      setNonJobLog(log => [...log, { ...entry, bucket: target.slice(7), label: TIME_BUCKETS[target.slice(7)] || target.slice(7) }])
    }
    return true
  }
  function removeItem(item) {
    if (item.manual) setManual(m => m.filter(x => x.id !== item.id))
    else setPending(list => list.filter(p => p.id !== item.id))
  }
  async function assign(item, { allocations, workers: ws, note }) {
    // Merge lines that point at the same job/bucket so one record isn't written twice
    const merged = new Map()
    allocations.forEach(a => {
      const k = a.target + '|' + (a.category || '')
      const prev = merged.get(k) || { target: a.target, category: a.category, hoursEach: 0 }
      merged.set(k, { ...prev, hoursEach: prev.hoursEach + a.hoursEach })
    })
    let ok = true
    for (const { target, category, hoursEach } of merged.values()) {
      const entry = { ...buildEntry(item, Math.round(hoursEach * 100) / 100, ws, note), sourceId: item.id, ...(category ? { category } : {}) }
      if (!(await writeEntry(target, entry))) ok = false
    }
    if (ok) removeItem(item)
  }

  // Save edits to a crew day as you go, so nothing is lost if you leave the page
  function updateItem(next) {
    if (next.manual) setManual(m => m.map(x => x.id === next.id ? next : x))
    else setPending(list => list.map(p => p.id === next.id ? next : p))
  }
  function addManualCrew() {
    const d = day || localDate()
    setManual(m => [...m, { id: uid(), type: 'crewDay', manual: true, date: d, label: 'Missed time — ' + d, crew: crew.me ? [{ id: crew.me.id, name: crew.me.name }] : [], segments: [], seconds: 0, startedAt: d + 'T07:00:00' }])
  }


  if (items.length === 0 && !allowManual) return null

  return (
    <div style={{ padding: 12, background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 'var(--rs)', marginBottom: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#8a5d00', minWidth: 200 }}>
          ⏱ {pending.length} time entr{pending.length === 1 ? 'y' : 'ies'} to review
          <span style={{ fontWeight: 400 }}> — tracking only, never used for billing</span>
        </div>
        <label style={{ fontSize: 11, color: '#8a5d00' }}>Sort{' '}
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...inputStyle, padding: '3px 6px', fontSize: 11 }}>
            <option value="time">Time</option><option value="job">Job</option><option value="hours">Hours</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: '#8a5d00' }}>Round to{' '}
          <select value={rounding} onChange={e => setRounding(Number(e.target.value))} style={{ ...inputStyle, padding: '3px 6px', fontSize: 11 }}>
            <option value={0}>Exact</option><option value={0.25}>¼ h</option><option value={0.5}>½ h</option>
          </select>
        </label>
        {allowManual && (
          <button onClick={addManualCrew} title="For a day (or part of one) nobody clocked — you, your crew, or both" style={{ padding: '5px 12px', border: '1px solid #8a5d00', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: '#fff', color: '#8a5d00' }}>
            ➕ Add missed time
          </button>
        )}
      </div>
      {items.length === 0 && <div style={{ fontSize: 12, color: '#8a5d00' }}>Nothing waiting. Anything you forgot to clock today can be added with “Add missed time”.</div>}
      {sorted.map(item => item.type === 'crewDay' ? (
        <CrewDayReview
          key={item.id} item={item} jobs={selectable} allJobs={allJobs} customers={customers}
          crew={crew} rounding={rounding} writeEntry={writeEntry}
          onChange={updateItem} onDone={() => removeItem(item)} onDiscard={() => removeItem(item)}
          onTask={(jobId, taskId, on, at) => jobsStore.updateRecord(jobId, setDone(taskId, on, crew.meName, at))}
        />
      ) : (
        <ReviewRow
          key={item.id} item={item} jobs={selectable} customers={customers}
          workers={workers} meName={crew.meName} onAddWorker={crew.addPerson} rounding={rounding}
          onAssign={opts => assign(item, opts)}
          onDiscard={() => removeItem(item)}
        />
      ))}
    </div>
  )
}
