import React, { useEffect, useMemo, useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { customerTodosForHitList, setTodoDone, addTodo, setTodoPriority } from '../api/customerNotes.js'
import { byPriority, norm } from '../api/priority.js'
import PriorityFlag from './PriorityFlag.jsx'
import { useOutlookAppointments } from '../api/useCalendar.js'
import { CALENDAR_KEY, eventFromEmail } from '../api/calendar.js'
import { scheduleForHitList, SCHED_DONE_KEY, tickSched } from '../api/hitSchedule.js'
import { weekStartDay } from '../api/weekStart.js'
import { todayLocal } from '../api/albertaTime.js'
import { fmtDate } from '../api/format.js'

// Home: a quick to-do list. Type a line, Enter to add, tick it when it's done.
// Done items drop to the bottom (struck through) until you clear them.
// Open to-dos from each customer's General Notes show here too, tagged with
// the customer — tick one here and it's ticked on the customer; click the
// customer's name to open it.
//
// full: the Hit List in its own window (⤢ on Home). Same list, more room —
// customer to-dos grouped under each customer, double-click a line of yours
// to edit it, and you can add a to-do straight onto a customer.
//
// Every line has a priority flag (click: Normal → High → Low); High sorts
// to the top. "Scheduled" lists what's on each week — job starts, required-by
// dates, your Calendar, Outlook, and dates the morning email run found (see
// hitSchedule.js). Home shows this week; the ⤢ window shows the weeks ahead.
const uid = () => Math.random().toString(36).slice(2, 10)

export default function HitList({ full = false }) {
  const [items, setItems] = useLocalStore('hit_list', [])
  const [text, setText] = useState('')
  const [hover, setHover] = useState('')
  const [editing, setEditing] = useState(null) // { id, text }
  const [forCustomer, setForCustomer] = useState('') // full: add onto this customer
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const custTodos = jobsHub.loading ? [] : customerTodosForHitList(jobsHub.customers)
  const tickCustomer = t => jobsHub.updateCustomer(t.customerId, c => ({ todos: setTodoDone(c.todos, t.id, true) }))
  const prioCustomer = (t, p) => jobsHub.updateCustomer(t.customerId, c => ({ todos: setTodoPriority(c.todos, t.id, p) }))

  // Scheduled, week by week
  const [events, setEvents] = useLocalStore(CALENDAR_KEY, [])
  const [schedDone, setSchedDone] = useLocalStore(SCHED_DONE_KEY, {})
  const outlook = useOutlookAppointments()
  const [email, setEmail] = useState({ feed: null, local: null })
  useEffect(() => {
    let live = true
    const load = () => window.desktop?.emailNotesLoad?.().then(r => { if (live && r) setEmail({ feed: r.feed || null, local: r.local || null }) }).catch(() => {})
    load()
    const t = setInterval(load, 10 * 60 * 1000)
    window.addEventListener('focus', load)
    return () => { live = false; clearInterval(t); window.removeEventListener('focus', load) }
  }, [])
  const today = todayLocal()
  const sched = useMemo(() => jobsHub.loading ? { overdue: [], weeks: [], hidden: 0 } : scheduleForHitList({
    today, weeks: full ? 6 : 1, weekStart: weekStartDay(),
    jobs: jobsHub.records, customers: jobsHub.customers, events, outlook: outlook.events,
    emailFeed: email.feed, emailLocal: email.local, done: schedDone && typeof schedDone === 'object' ? schedDone : {},
  }), [jobsHub.loading, jobsHub.records, jobsHub.customers, events, outlook.events, email, schedDone, today, full])
  const tickSchedItem = it => setSchedDone(d => tickSched(d && typeof d === 'object' ? d : {}, it))
  const addEmailToCal = it => {
    const e = eventFromEmail(it.emailItem, uid)
    if (e) setEvents(list => (Array.isArray(list) && list.some(x => x.emailId === e.emailId)) ? list : [...(Array.isArray(list) ? list : []), e])
  }
  const openJob = jobId => { const j = (jobsHub.records || []).find(x => x.id === jobId); if (j) openCustomer(j.customerId) }
  const thisWeek = sched.weeks[0] ? sched.weeks[0].items : []
  const openCustomer = id => { if (window.desktop?.openCustomerWindow) window.desktop.openCustomerWindow(id) }
  const list = Array.isArray(items) ? items : []
  const open = byPriority(list.filter(x => !x.doneAt))
  const done = list.filter(x => x.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
  const add = () => {
    const t = text.trim(); if (!t) return
    if (full && forCustomer) jobsHub.updateCustomer(forCustomer, c => ({ todos: addTodo(c.todos, t) }))
    else setItems(l => [...(Array.isArray(l) ? l : []), { id: uid(), text: t, at: new Date().toISOString() }])
    setText('')
  }
  const upd = (id, patch) => setItems(l => (Array.isArray(l) ? l : []).map(x => x.id === id ? { ...x, ...patch } : x))
  const del = id => setItems(l => (Array.isArray(l) ? l : []).filter(x => x.id !== id))
  const saveEdit = () => {
    if (!editing) return
    const t = editing.text.trim()
    if (t) upd(editing.id, { text: t })
    setEditing(null)
  }

  const fs = full ? 14.5 : 12.5
  const row = (x, isDone) => (
    <div key={x.id} onMouseEnter={() => setHover(x.id)} onMouseLeave={() => setHover('')}
      style={{ display: 'flex', alignItems: 'flex-start', gap: full ? 9 : 6, padding: full ? '6px 4px' : '3px 2px', fontSize: fs, lineHeight: 1.4, borderBottom: full ? '1px solid var(--surface-2)' : 'none' }}>
      <input type="checkbox" checked={isDone} onChange={e => upd(x.id, { doneAt: e.target.checked ? new Date().toISOString() : undefined })} style={{ marginTop: full ? 4 : 2, cursor: 'pointer' }} />
      {!isDone && <span style={{ marginTop: full ? 2 : 1 }}><PriorityFlag size={full ? 16 : 14} value={x.priority} onChange={p => upd(x.id, { priority: norm(p) })} /></span>}
      {editing && editing.id === x.id ? (
        <input autoFocus value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }} onBlur={saveEdit}
          style={{ flex: 1, fontSize: fs, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--font)' }} />
      ) : (
        <span onDoubleClick={() => full && !isDone && setEditing({ id: x.id, text: x.text })} title={full && !isDone ? 'Double-click to edit' : undefined}
          style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', color: isDone ? 'var(--text-light)' : 'var(--text)', textDecoration: isDone ? 'line-through' : 'none' }}>{x.text}</span>
      )}
      {full && !isDone && x.at && <span style={{ fontSize: 11, color: 'var(--text-light)', whiteSpace: 'nowrap', marginTop: 2 }}>{ago(x.at)}</span>}
      {hover === x.id && <button onClick={() => del(x.id)} title="Remove" style={{ border: 'none', background: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>}
    </div>
  )
  const custRow = (t, tag) => (
    <div key={t.customerId + t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: full ? 9 : 6, padding: full ? '6px 4px' : '3px 2px', fontSize: fs, lineHeight: 1.4, borderBottom: full ? '1px solid var(--surface-2)' : 'none' }}>
      <input type="checkbox" checked={false} onChange={() => tickCustomer(t)} title="Done — ticks it off on the customer too" style={{ marginTop: full ? 4 : 2, cursor: 'pointer' }} />
      <span style={{ marginTop: full ? 2 : 1 }}><PriorityFlag size={full ? 16 : 14} value={t.priority} onChange={p => prioCustomer(t, p)} /></span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
        {tag && <span onClick={() => openCustomer(t.customerId)} title={`Open ${t.customerName}`}
          style={{ fontSize: 10.5, fontWeight: 800, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '0 6px', marginRight: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t.customerName}</span>}
        {t.text}
      </span>
      {full && t.at && <span style={{ fontSize: 11, color: 'var(--text-light)', whiteSpace: 'nowrap', marginTop: 2 }}>{ago(t.at)}</span>}
    </div>
  )
  const schedRow = it => {
    const k = KIND[it.kind === 'emailDate' ? it.dateKind : it.kind] || KIND.event
    const when = `${fmtDate(it.date, 'weekday')}${it.start ? ' ' + it.start : ''}`
    const suggested = it.kind === 'emailSuggest' || it.kind === 'emailDate'
    return (
      <div key={it.id + '@' + it.date} style={{ display: 'flex', alignItems: 'flex-start', gap: full ? 9 : 6, padding: full ? '6px 4px' : '3px 2px', fontSize: fs, lineHeight: 1.4, borderBottom: full ? '1px solid var(--surface-2)' : 'none', opacity: suggested ? 0.85 : 1 }}>
        <input type="checkbox" checked={false} onChange={() => tickSchedItem(it)} title="Done — takes it off the Hit List (the job and Calendar stay as they are)" style={{ marginTop: full ? 4 : 2, cursor: 'pointer' }} />
        <span title={k.label} style={{ marginTop: 1, flexShrink: 0 }}>{k.icon}</span>
        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          <span style={{ fontSize: full ? 11.5 : 10.5, fontWeight: 800, color: k.color, marginRight: 5, whiteSpace: 'nowrap' }}>{when}</span>
          {it.jobId
            ? <span onClick={() => openJob(it.jobId)} title="Open the customer" style={{ cursor: 'pointer' }}>{it.title}</span>
            : it.title}
          {suggested && <span style={{ fontSize: 10, fontWeight: 800, color: '#5b3fa0', background: '#efeaf8', borderRadius: 8, padding: '0 5px', marginLeft: 5, whiteSpace: 'nowrap' }}>from email</span>}
          {full && it.detail && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-light)' }}>{it.detail}</span>}
        </span>
        {it.kind === 'emailSuggest' && <button onClick={() => addEmailToCal(it)} title="Put this date on your Calendar" style={{ border: '1px solid #c9dbef', background: '#eef4fb', color: '#1a5fa0', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '1px 6px', whiteSpace: 'nowrap' }}>+ Calendar</button>}
        {full && it.link && <button onClick={() => window.desktop?.openExternal(it.link)} style={{ border: 'none', background: 'none', color: '#1a5fa0', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, padding: 0 }}>Open</button>}
      </div>
    )
  }
  const restoreSched = sched.hidden > 0 && (
    <button onClick={() => setSchedDone({})} title="Show the scheduled items you ticked off again"
      style={{ border: 'none', background: 'none', color: '#1a5fa0', fontSize: full ? 12 : 10.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>↺ {sched.hidden} ticked off</button>
  )

  const clearDone = done.length > 0 && (
    <button onClick={() => setItems(l => (Array.isArray(l) ? l : []).filter(x => !x.doneAt))}
      style={{ marginTop: 4, border: 'none', background: 'none', color: '#1a5fa0', fontSize: full ? 12.5 : 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Clear done ({done.length})</button>
  )
  const total = open.length + custTodos.length + sched.overdue.length + thisWeek.length

  if (full) {
    // Customer to-dos grouped under each customer, customers A–Z
    const byCust = new Map()
    custTodos.forEach(t => { if (!byCust.has(t.customerId)) byCust.set(t.customerId, { name: t.customerName, items: [] }); byCust.get(t.customerId).items.push(t) })
    const groups = [...byCust.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
    const customers = (jobsHub.customers || []).filter(c => !c.trashedAt && !c.sleepingAt).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    const head = { fontSize: 11.5, fontWeight: 800, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '18px 0 4px' }
    return (
      <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg, #f6f8fb)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '20px 22px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ flex: 1, fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: 24 }}>🎯 Hit List</span>
            <span style={{ fontSize: 13, color: 'var(--text-light)' }}>{total ? `${total} to do` : 'All clear'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder={forCustomer ? 'Add a to-do for this customer, press Enter…' : 'Add a line, press Enter…'}
              style={{ flex: 1, fontSize: 15, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font)', background: 'var(--surface)' }} />
            <select value={forCustomer} onChange={e => setForCustomer(e.target.value)} title="Add it to your own list, or onto a customer's General Notes"
              style={{ fontSize: 13, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', maxWidth: 200 }}>
              <option value="">My list</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '4px 14px 10px', marginTop: 14 }}>
            <div style={{ ...head, display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ flex: 1 }}>📅 Scheduled</span>
              {restoreSched}
            </div>
            {sched.overdue.length > 0 && (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#c0392b', margin: '6px 0 2px' }}>Past due</div>
                {sched.overdue.map(schedRow)}
              </>
            )}
            {sched.weeks.map((w, i) => (w.items.length || i === 0) && (
              <div key={w.key}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: i === 0 ? 'var(--text)' : 'var(--text-mid)', margin: '8px 0 2px' }}>
                  {w.label} <span style={{ fontWeight: 600, color: 'var(--text-light)' }}>· {fmtDate(w.from, 'short')} – {fmtDate(w.to, 'short')}</span>
                </div>
                {w.items.map(schedRow)}
                {!w.items.length && <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '4px 4px' }}>Nothing scheduled.</div>}
              </div>
            ))}

            <div style={head}>Mine</div>
            {open.map(x => row(x, false))}
            {!open.length && <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '6px 4px' }}>Nothing of yours on the list.</div>}

            {groups.map(([id, g]) => (
              <div key={id}>
                <div style={{ ...head, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span onClick={() => openCustomer(id)} title={`Open ${g.name}`} style={{ color: '#1a5fa0', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 14 }}>{g.name} →</span>
                  <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{g.items.length} to do</span>
                </div>
                {g.items.map(t => custRow(t, false))}
              </div>
            ))}

            {done.length > 0 && (
              <>
                <div style={head}>Done</div>
                {done.map(x => row(x, true))}
                {clearDone}
              </>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 10 }}>
            Double-click one of yours to edit it. Click the flag in front of a line to set its priority (Normal → High → Low); High goes to the top. Customer to-dos come from each customer's General Notes — ticking one here ticks it there.
            Scheduled shows the next six weeks from your Calendar, Outlook, jobs' start and required-by dates, and dates found in your email (marked "from email" until you add them). Ticking one off only takes it off this list.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-hitlist onClick={e => e.stopPropagation()} style={{ width: 236, boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 4px 18px rgba(15,30,46,.10)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span style={{ flex: 1, fontFamily: 'var(--font-d)', fontWeight: 700, fontSize: 13 }}>🎯 Hit List</span>
        {total > 0 && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{total} to do</span>}
        {window.desktop?.openHitListWindow && (
          <button onClick={() => window.desktop.openHitListWindow()} title="Open the Hit List in its own window"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '3px 5px', color: 'var(--text-mid)' }}>⤢</button>
        )}
      </div>
      <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="Add a line, press Enter…"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, fontFamily: 'var(--font)' }} />
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {(sched.overdue.length > 0 || thisWeek.length > 0) && (
          <div style={{ marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--surface-2)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '2px 0' }}>This week</div>
            {sched.overdue.map(schedRow)}
            {thisWeek.map(schedRow)}
          </div>
        )}
        {open.map(x => row(x, false))}
        {custTodos.map(t => custRow(t, true))}
        {!open.length && !done.length && !custTodos.length && <div style={{ fontSize: 11.5, color: 'var(--text-light)', padding: '4px 2px' }}>Nothing on the list.</div>}
        {done.map(x => row(x, true))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>{clearDone}{restoreSched}</div>
    </div>
  )
}

const KIND = {
  jobstart: { icon: '▶', color: '#1e7a34', label: 'Job start' },
  jobdue: { icon: '🏁', color: '#c0392b', label: 'Required by (completion)' },
  event: { icon: '📅', color: '#1a5fa0', label: 'On your Calendar' },
  email: { icon: '✉', color: '#5b3fa0', label: 'From email, on your Calendar' },
  emailSuggest: { icon: '✉', color: '#5b3fa0', label: 'Date found in email — not on your Calendar yet' },
  outlook: { icon: '🗓', color: '#0f6cbd', label: 'Outlook' },
}

// "today", "yesterday", "5d", "3w"
function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (!(d >= 0)) return ''
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d}d`
  return `${Math.floor(d / 7)}w`
}
