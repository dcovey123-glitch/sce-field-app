import React, { useState } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useCrewRoster } from '../api/crewRoster.js'
import { effectiveLifecycleStatus } from './Jobs.jsx'
import { TaskRow } from '../components/JobTasks.jsx'
import NeedsYou, { useNeedsYou } from '../components/NeedsYou.jsx'
import { useLocalStore } from '../api/useLocalStore.js'
import { tasksOf, isOverdue, isDueToday, newTask, addTasks, changeTask, removeTask, setDone, fmtDay } from '../api/tasks.js'

const small = { fontSize: 11.5, color: 'var(--text-light)' }
const inp = { fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }
const pill = on => ({ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: on ? 'none' : '1px solid var(--border)', background: on ? 'var(--navy)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-mid)' })

// Every job's open tasks on one page: what needs doing, what's overdue, and
// which jobs are all done but not billed yet.
export default function Todo({ navigate }) {
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const crew = useCrewRoster()
  const me = crew.meName
  const people = crew.active.map(p => p.name)
  const [who, setWho] = useState('all') // all | mine | a name
  const [view, setView] = useState('job') // job | due | done
  const [q, setQ] = useState('')
  const [addText, setAddText] = useState('')
  const [addJob, setAddJob] = useState('')
  const [tab, setTab] = useLocalStore('today_tab', 'needs')
  const needs = useNeedsYou(navigate)

  const custName = id => (jobsStore.customers.find(c => c.id === id) || {}).name || ''
  const jobs = jobsStore.records.filter(j => !j.trashedAt)
  const liveJobs = jobs.filter(j => effectiveLifecycleStatus(j) !== 'billed')
  const label = j => `${j.name || 'Job'}${custName(j.customerId) ? ' · ' + custName(j.customerId) : ''}`
  const upd = (j, patch) => jobsStore.updateRecord(j.id, patch)
  const openJob = j => navigate && navigate({ hub: 'jobs', view: 'section', customerId: j.customerId, projectId: j.id, section: 'tasks' })

  const whoOk = t => who === 'all' || (who === 'mine' ? (!t.who || t.who === me) : t.who === who)
  const textOk = (t, j) => !q || `${t.text} ${t.notes} ${j.name} ${custName(j.customerId)} ${t.who}`.toLowerCase().includes(q.toLowerCase())
  const all = jobs.flatMap(j => tasksOf(j).map(t => ({ t, j })))
  const open = all.filter(x => !x.t.done && whoOk(x.t) && textOk(x.t, x.j))
  const overdue = open.filter(x => isOverdue(x.t))
  const dueToday = open.filter(x => isDueToday(x.t))
  const doneRecent = all.filter(x => x.t.done && textOk(x.t, x.j)).sort((a, b) => String(b.t.doneAt).localeCompare(String(a.t.doneAt))).slice(0, 80)
  // jobs whose list is all ticked but not billed yet
  const readyToBill = liveJobs.filter(j => tasksOf(j).length && tasksOf(j).every(t => t.done))
  // jobs on the go with no tasks at all
  const noTasks = liveJobs.filter(j => effectiveLifecycleStatus(j) === 'onGoing' && !tasksOf(j).length)

  const row = ({ t, j }, showJob) => (
    <TaskRow key={j.id + t.id} t={t} people={people} compact jobLabel={showJob ? label(j) : null} onOpenJob={() => openJob(j)}
      onPatch={p => upd(j, changeTask(t.id, p))}
      onToggle={on => upd(j, setDone(t.id, on, me))}
      onRemove={() => upd(j, removeTask(t.id))} />
  )

  const byJob = new Map()
  open.forEach(x => { if (!byJob.has(x.j.id)) byJob.set(x.j.id, { j: x.j, items: [] }); byJob.get(x.j.id).items.push(x) })
  const groups = [...byJob.values()].sort((a, b) =>
    (b.items.some(x => isOverdue(x.t)) - a.items.some(x => isOverdue(x.t))) || custName(a.j.customerId).localeCompare(custName(b.j.customerId)) || String(a.j.name).localeCompare(String(b.j.name)))

  const quickAdd = () => {
    const j = jobs.find(x => x.id === addJob)
    if (!j || !addText.trim()) return
    upd(j, addTasks(addText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => newTask(s, me))))
    setAddText('')
  }

  return (
    <div style={{ padding: '16px 20px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: 24, fontWeight: 700, marginRight: 6 }}>☀ Today</span>
        <button onClick={() => setTab('needs')} style={{ ...pill(tab === 'needs'), fontSize: 13, padding: '6px 14px' }}>⚠ Needs you{needs.total ? ` (${needs.total})` : ''}</button>
        <button onClick={() => setTab('tasks')} style={{ ...pill(tab === 'tasks'), fontSize: 13, padding: '6px 14px' }}>✅ Tasks{open.length ? ` (${open.length})` : ''}</button>
        <span style={{ ...small, marginLeft: 'auto' }}>{new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      </div>
      {tab === 'needs' ? <NeedsYou navigate={navigate} /> : <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800 }}>Tasks</span>
        <span style={small}>{open.length} open on {byJob.size} job{byJob.size === 1 ? '' : 's'}</span>
        {overdue.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: '#c0392b', borderRadius: 10, padding: '2px 9px' }}>{overdue.length} overdue</span>}
        {dueToday.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#7a5a00', background: '#fff3d6', borderRadius: 10, padding: '2px 9px' }}>{dueToday.length} due today</span>}
      </div>

      {/* what needs you first */}
      {(overdue.length > 0 || readyToBill.length > 0) && (
        <div style={{ border: '1px solid #e3a49c', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '7px 12px', background: '#fdecea', fontSize: 13, fontWeight: 800, color: '#8e1f14' }}>⚠ Needs you</div>
          {overdue.map(x => row(x, true))}
          {readyToBill.map(j => (
            <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: '#1e7a34', fontWeight: 800 }}>✓</span>
              <span style={{ flex: 1 }}><b>{label(j)}</b> — every task done{(() => { const d = tasksOf(j).map(t => t.doneAt).sort().pop(); return d ? ` (last ${fmtDay(d)})` : '' })()}. Ready to bill?</span>
              <button onClick={() => navigate && navigate({ hub: 'jobs', view: 'section', customerId: j.customerId, projectId: j.id, section: 'general' })} style={{ ...pill(false) }}>Open job →</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['job', 'By job'], ['due', 'By date'], ['done', 'Done lately']].map(([id, l]) => <button key={id} onClick={() => setView(id)} style={pill(view === id)}>{l}</button>)}
        <span style={{ width: 10 }} />
        <select value={who} onChange={e => setWho(e.target.value)} style={{ ...inp, padding: '5px 8px' }}>
          <option value="all">Everyone</option>
          <option value="mine">Mine + unassigned</option>
          {people.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks, jobs, customers…" style={{ ...inp, flex: 1, minWidth: 180 }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={addJob} onChange={e => setAddJob(e.target.value)} style={{ ...inp, maxWidth: 320 }}>
          <option value="">Add a task to… pick a job</option>
          {[...liveJobs].sort((a, b) => label(a).localeCompare(label(b))).map(j => <option key={j.id} value={j.id}>{label(j)}</option>)}
        </select>
        <input value={addText} onChange={e => setAddText(e.target.value)} placeholder="What has to be done" onKeyDown={e => { if (e.key === 'Enter') quickAdd() }} style={{ ...inp, flex: 1, minWidth: 200 }} />
        <button disabled={!addJob || !addText.trim()} onClick={quickAdd} style={{ ...pill(true), borderRadius: 6, opacity: !addJob || !addText.trim() ? 0.5 : 1 }}>+ Add</button>
      </div>

      {view === 'job' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!groups.length && <div style={{ ...small, padding: 20, textAlign: 'center', fontSize: 13 }}>{q ? 'No open tasks match.' : 'Nothing open. Add tasks on a job (its Tasks section) or above.'}</div>}
          {groups.map(g => {
            const all = tasksOf(g.j), doneN = all.filter(t => t.done).length
            return (
              <div key={g.j.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <a href="#" onClick={e => { e.preventDefault(); openJob(g.j) }} style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', textDecoration: 'none' }}>{g.j.name || 'Job'}</a>
                  <span style={small}>{custName(g.j.customerId)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={small}>{doneN} of {all.length} done</span>
                  <span style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${all.length ? (doneN / all.length) * 100 : 0}%`, background: '#1e7a34' }} /></span>
                </div>
                {g.items.map(x => row(x, false))}
              </div>
            )
          })}
        </div>
      )}

      {view === 'due' && (() => {
        const sorted = [...open].sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999'))
        return (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {!sorted.length && <div style={{ ...small, padding: 14 }}>Nothing open.</div>}
            {sorted.map(x => row(x, true))}
          </div>
        )
      })()}

      {view === 'done' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {!doneRecent.length && <div style={{ ...small, padding: 14 }}>Nothing ticked off yet.</div>}
          {doneRecent.map(x => row(x, true))}
        </div>
      )}

      {noTasks.length > 0 && view === 'job' && !q && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--text-mid)' }}>{noTasks.length} job{noTasks.length === 1 ? '' : 's'} on the go with no tasks</summary>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {noTasks.map(j => <button key={j.id} onClick={() => openJob(j)} style={pill(false)}>{label(j)}</button>)}
          </div>
        </details>
      )}
      </>}
    </div>
  )
}
