import React, { useMemo, useState } from 'react'
import { Modal } from '../components/UI.jsx'
import { useLocalStore } from '../api/useLocalStore.js'
import { useCalendar } from '../api/useCalendar.js'
import { useCrewRoster } from '../api/crewRoster.js'
import { weekKeyOf, weekStartDay } from '../api/weekStart.js'
import { todayLocal } from '../api/albertaTime.js'
import {
  SCHEDULE_KEY, SCHEDULE_DAYS_KEY, SCHEDULE_SETTINGS_KEY, DEFAULT_SETTINGS, BACKEND, SHIFTS,
  uid, addDays, weekDates, dayLabel, isWeekend, hoursOf, timeText, blockTitle, isBackend,
  buildWorkList, meetingsFrom, scheduleFlags, hoursByPerson, scheduleText,
} from '../api/schedule.js'
import { dayByPerson, dayByGroup, weekByPerson, weekByGroup, scheduleDayHtml, scheduleWeekHtml } from '../api/scheduleViews.js'
import logoUrl from '../assets/logo_sce_new.jpg'

// 📅 Crew Schedule: pick the days, then say who's on what. Meetings come in
// on their own (your Calendar, emails you OK'd, Outlook); the flags up top
// say what the plan misses — quoting and admin above all.

const small = { fontSize: 11.5, color: 'var(--text-light)' }
const inp = { fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }
const pill = on => ({ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', border: on ? '1px solid var(--navy)' : '1px solid var(--border)', background: on ? 'var(--navy)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-mid)' })
const linkBtn = { background: 'none', border: 'none', padding: '0 3px', cursor: 'pointer', fontSize: 12, color: 'var(--blue-dark)' }
const FLAG_STYLE = {
  red: { bg: '#fdecea', border: '#e3a49c', color: '#8e1f14', icon: '⛔' },
  amber: { bg: '#fff6e0', border: '#f0cf85', color: '#7a5a00', icon: '⚠' },
  info: { bg: 'var(--gray-light)', border: 'var(--border)', color: 'var(--text-mid)', icon: 'ℹ' },
}
const MEET_ICON = { event: '📅', email: '📧', outlook: '🗓' }
const DATE_ICON = { jobstart: '▶', jobdue: '⏰', task: '☐' }
const KIND_COLOR = { job: 'var(--blue)', office: 'var(--accent)', other: 'var(--gray)' }
const VIEW_KEY = 'schedule_view' // { view: 'day' | 'week', group: 'person' | 'job' }

async function logoDataUrl() {
  try {
    if (logoUrl.startsWith('data:')) return logoUrl
    const buf = await (await fetch(logoUrl)).arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return `data:image/jpeg;base64,${btoa(bin)}`
  } catch { return '' }
}

export default function Scheduler() {
  const ws = weekStartDay()
  const today = todayLocal ? todayLocal() : new Date().toISOString().slice(0, 10)
  const [weekKey, setWeekKey] = useState(() => weekKeyOf(new Date(), ws))
  const week = weekDates(weekKey)
  const [picks, setPicks] = useLocalStore(SCHEDULE_DAYS_KEY, {})
  const [assignments, setAssignments] = useLocalStore(SCHEDULE_KEY, [])
  const [storedSettings, setSettings] = useLocalStore(SCHEDULE_SETTINGS_KEY, DEFAULT_SETTINGS)
  const settings = { ...DEFAULT_SETTINGS, ...(storedSettings || {}) }
  const [todos] = useLocalStore('todos', [])
  const [hitList] = useLocalStore('hit_list', [])
  const [editor, setEditor] = useState(null) // { initial } | null
  const [showSettings, setShowSettings] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [viewPrefs, setViewPrefs] = useLocalStore(VIEW_KEY, { view: 'week', group: 'person' })
  const view = (viewPrefs && viewPrefs.view) === 'day' ? 'day' : 'week'
  const group = (viewPrefs && viewPrefs.group) === 'job' ? 'job' : 'person'
  const setView = v => setViewPrefs(p => ({ ...(p || {}), view: v }))
  const setGroup = g => setViewPrefs(p => ({ ...(p || {}), group: g }))
  const [dayFocus, setDayFocus] = useState(null)
  const [exp, setExp] = useState({ busy: false, msg: '', err: '' })

  const cal = useCalendar(week[0], week[6])
  const crew = useCrewRoster()
  const meName = crew.meName
  const people = crew.active.map(p => p.name)

  const picked = ((picks || {})[weekKey] || []).filter(d => week.includes(d)).sort()
  const setPicked = list => setPicks(p => ({ ...(p || {}), [weekKey]: [...new Set(list)].sort() }))
  const togglePick = d => {
    if (!picked.includes(d)) return setPicked([...picked, d])
    const n = (assignments || []).filter(a => a.date === d).length
    if (n && !window.confirm(`${dayLabel(d)} has ${n} block${n === 1 ? '' : 's'} booked. Take the day off the schedule? (The blocks are kept and come back if you pick the day again.)`)) return
    setPicked(picked.filter(x => x !== d))
  }

  const workList = useMemo(() => buildWorkList(cal.jobsHub.records, cal.jobsHub.customers, today), [cal.jobsHub.records, cal.jobsHub.customers, today])
  const meetings = useMemo(() => meetingsFrom(cal.days, week), [cal.days, weekKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const backendOpenList = [
    ...(todos || []).filter(t => !t.done).map(t => ({ id: 't' + t.id, text: t.text, from: 'To-do' })),
    ...(hitList || []).filter(t => !t.done).map(t => ({ id: 'h' + t.id, text: t.text, from: 'Hit List' })),
  ]
  const weekAssign = (assignments || []).filter(a => week.includes(a.date))
  const flags = useMemo(() => scheduleFlags({
    dates: picked, weekDates: week, assignments: weekAssign, meName, crew: people, meetings, workList, settings, backendOpen: backendOpenList.length,
  }), [picked.join(), weekAssign, meName, people.join(), meetings, workList, settings, backendOpenList.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const hours = hoursByPerson(weekAssign, picked)
  const unscheduled = workList.filter(w => !w.waiting && !weekAssign.some(a => picked.includes(a.date) && a.kind === 'job' && a.jobId === w.jobId))
  const waiting = workList.filter(w => w.waiting && !weekAssign.some(a => picked.includes(a.date) && a.jobId === w.jobId))

  const save = blocks => {
    setAssignments(list => {
      const cur = Array.isArray(list) ? list : []
      const ids = new Set(blocks.map(b => b.id))
      return [...cur.filter(a => !ids.has(a.id)), ...blocks]
    })
    const newDays = blocks.map(b => b.date).filter(d => week.includes(d) && !picked.includes(d))
    if (newDays.length) setPicked([...picked, ...newDays])
    setEditor(null)
  }
  const remove = a => {
    if (!window.confirm(`Remove ${blockTitle(a, workList)} for ${(a.workers || []).join(', ')} on ${dayLabel(a.date)}?`)) return
    setAssignments(list => (list || []).filter(x => x.id !== a.id))
  }
  const copyWeek = async () => {
    const txt = scheduleText(picked, weekAssign, meetings, workList, meName)
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { window.prompt('Copy the schedule:', txt) }
  }
  const copyLastWeek = () => {
    const prev = addDays(weekKey, -7)
    const from = (assignments || []).filter(a => a.date >= prev && a.date < weekKey)
    if (!from.length) return window.alert('Nothing was booked last week to copy.')
    if (!window.confirm(`Copy last week's ${from.length} block${from.length === 1 ? '' : 's'} onto this week? You can change or remove them after.`)) return
    const now = new Date().toISOString()
    const blocks = from.map(a => ({ ...a, id: uid(), date: addDays(a.date, 7), createdAt: now, editedAt: null }))
    save(blocks)
    setPicked([...picked, ...blocks.map(b => b.date)])
  }

  // Day view: the day you clicked, else today if it's on the schedule, else the first picked day
  const focus = picked.includes(dayFocus) ? dayFocus : picked.includes(today) ? today : picked[0] || ''
  const openDay = d => { setDayFocus(d); setView('day') }

  async function exportPdf() {
    if (!picked.length) return
    if (!window.desktop?.pdfFromHtml) { setExp({ busy: false, msg: '', err: 'Export works in the desktop app.' }); return }
    setExp({ busy: true, msg: '', err: '' })
    try {
      const logo = await logoDataUrl()
      const who = group === 'job' ? 'by job' : 'by person'
      let html, name
      if (view === 'day') {
        html = scheduleDayHtml({ date: focus, group, byPerson: dayByPerson(focus, weekAssign, people, workList), byGroup: dayByGroup(focus, weekAssign, workList), meetings: meetings[focus], logo })
        name = `Schedule ${focus} - Day - ${who}.pdf`
      } else {
        const wk = group === 'job' ? weekByGroup(picked, weekAssign, workList) : weekByPerson(picked, weekAssign, people, workList)
        html = scheduleWeekHtml({ dates: picked, group, week: wk, logo })
        name = `Schedule week of ${week[0]} - ${who}.pdf`
      }
      const base64 = await window.desktop.pdfFromHtml(html, { landscape: view === 'week' })
      const saved = await window.desktop.saveFile('Schedules', name, base64)
      if (!saved) throw new Error('The PDF could not be saved.')
      window.desktop.openFile(saved)
      setExp({ busy: false, err: '', msg: `Saved to ${saved} in your data folder.` })
    } catch (e) {
      setExp({ busy: false, msg: '', err: e.message || 'Export failed.' })
    }
  }

  const red = flags.filter(f => f.level === 'red').length, amber = flags.filter(f => f.level === 'amber').length
  const shownFlags = flags.filter(f => f.level !== 'info' || showInfo)
  const infoN = flags.filter(f => f.level === 'info').length

  return (
    <div style={{ padding: '16px 20px 40px', maxWidth: 1500, margin: '0 auto' }}>
      {/* Week and days */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: 24, fontWeight: 700, marginRight: 6 }}>📅 Crew Schedule</span>
        <button style={pill(false)} onClick={() => setWeekKey(addDays(weekKey, -7))}>‹</button>
        <span style={{ fontSize: 14, fontWeight: 700, minWidth: 170, textAlign: 'center' }}>{dayLabel(week[0])} – {dayLabel(week[6])}</span>
        <button style={pill(false)} onClick={() => setWeekKey(addDays(weekKey, 7))}>›</button>
        <button style={pill(false)} onClick={() => setWeekKey(weekKeyOf(new Date(), ws))}>This week</button>
        <span style={{ width: 8 }} />
        <button style={pill(view === 'day')} onClick={() => setView('day')} title="One day in full detail">Day</button>
        <button style={pill(view === 'week')} onClick={() => setView('week')} title="The week at a glance">Week</button>
        <span style={{ width: 4 }} />
        <button style={pill(group === 'person')} onClick={() => setGroup('person')}>By person</button>
        <button style={pill(group === 'job')} onClick={() => setGroup('job')}>By job</button>
        <div style={{ flex: 1 }} />
        <button style={pill(false)} onClick={copyLastWeek} title="Start from last week's plan">⧉ Copy last week</button>
        <button style={pill(false)} onClick={copyWeek} disabled={!picked.length} title="Copy the week as text, to text or email the crew">{copied ? '✓ Copied' : '📋 Copy as text'}</button>
        <button style={pill(false)} onClick={exportPdf} disabled={!picked.length || exp.busy} title={`Save the ${view} view (${group === 'job' ? 'by job' : 'by person'}) as a PDF`}>{exp.busy ? 'Exporting…' : '⤓ Export PDF'}</button>
        <button style={pill(showSettings)} onClick={() => setShowSettings(v => !v)} title="Office-time target and checks">⚙</button>
      </div>
      {(exp.msg || exp.err) && (
        <div style={{ marginBottom: 10, padding: '6px 12px', borderRadius: 8, fontSize: 12.5, background: exp.err ? 'var(--red-bg)' : 'var(--green-bg)', color: exp.err ? 'var(--red-dark)' : 'var(--green-dark)', display: 'flex', gap: 8 }}>
          <span style={{ flex: 1 }}>{exp.err || exp.msg}</span>
          <button style={linkBtn} onClick={() => setExp({ busy: false, msg: '', err: '' })}>✕</button>
        </div>
      )}

      {showSettings && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', marginBottom: 10, fontSize: 13 }}>
          <label>Your quoting &amp; admin target <input type="number" min="0" step="0.5" value={settings.officeTargetHours} onChange={e => setSettings({ ...settings, officeTargetHours: Number(e.target.value) || 0 })} style={{ ...inp, width: 64 }} /> h / week</label>
          <label>Flag after <input type="number" min="0" value={settings.officeEveryDays} onChange={e => setSettings({ ...settings, officeEveryDays: Number(e.target.value) || 0 })} style={{ ...inp, width: 52 }} /> days in a row with no office time</label>
          <label>Rest between blocks at least <input type="number" min="0" value={settings.minRestHours} onChange={e => setSettings({ ...settings, minRestHours: Number(e.target.value) || 0 })} style={{ ...inp, width: 52 }} /> h</label>
          <span style={small}>0 turns a check off.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ ...small, marginRight: 4 }}>Days on the schedule:</span>
        {week.map(d => {
          const on = picked.includes(d)
          const mN = (meetings[d]?.meetings || []).length
          return (
            <button key={d} onClick={() => togglePick(d)} style={{ ...pill(on), opacity: isWeekend(d) && !on ? 0.7 : 1, position: 'relative' }} title={on ? 'Take this day off the schedule' : 'Add this day to the schedule'}>
              {on ? '✓ ' : '+ '}{dayLabel(d)}{d === today ? ' (today)' : ''}
              {mN > 0 && <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 800, background: on ? 'var(--accent)' : 'var(--accent-bg)', color: 'var(--navy)', borderRadius: 8, padding: '0 5px' }}>{mN} mtg</span>}
            </button>
          )
        })}
        {!picked.length && <button style={{ ...pill(false), borderStyle: 'dashed' }} onClick={() => setPicked(week.filter(d => !isWeekend(d)))}>Pick Mon–Fri</button>}
      </div>

      {/* What the plan misses */}
      {picked.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {shownFlags.length === 0 && !infoN && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--green-bg)', color: 'var(--green-dark)', fontSize: 13, fontWeight: 700 }}>✓ Nothing flagged — office time is booked and nobody is double-booked.</div>}
          {(red > 0 || amber > 0) && <div style={{ fontSize: 12, fontWeight: 800, color: red ? '#8e1f14' : '#7a5a00', marginBottom: 4 }}>{red ? `${red} problem${red === 1 ? '' : 's'}` : ''}{red && amber ? ' · ' : ''}{amber ? `${amber} to look at` : ''}</div>}
          {shownFlags.map((f, i) => {
            const st = FLAG_STYLE[f.level]
            return <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 12px', marginBottom: 4, borderRadius: 8, background: st.bg, border: `1px solid ${st.border}`, color: st.color, fontSize: 13, fontWeight: f.level === 'info' ? 500 : 700 }}>
              <span>{st.icon}</span><span style={{ flex: 1 }}>{f.text}</span>
              {(f.kind === 'backend' || f.kind === 'backend-gap') && <button style={{ ...linkBtn, fontWeight: 700 }} onClick={() => setEditor({ initial: { date: f.date || picked[0], workers: [meName], kind: 'office', bucket: 'admin' } })}>+ Book office time</button>}
            </div>
          })}
          {infoN > 0 && <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => setShowInfo(v => !v)}>{showInfo ? 'Hide' : 'Show'} {infoN} note{infoN === 1 ? '' : 's'} (free crew, meetings on other days)</button>}
        </div>
      )}

      {!picked.length ? (
        <div style={{ padding: 40, textAlign: 'center', border: '2px dashed var(--border)', borderRadius: 12, color: 'var(--text-mid)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Blank week</div>
          <div style={{ fontSize: 13 }}>Pick the days above to start. Meetings for each day come in on their own.</div>
        </div>
      ) : view === 'day' ? (
        <DayDetail date={focus} picked={picked} today={today} group={group} meName={meName} meetings={meetings[focus]} workList={workList}
          byPerson={dayByPerson(focus, weekAssign, people, workList)} byGroup={dayByGroup(focus, weekAssign, workList)}
          onPickDay={setDayFocus} onAdd={initial => setEditor({ initial: { date: focus, ...initial } })}
          onEdit={a => setEditor({ initial: a, editing: true })} onRemove={remove} />
      ) : (
        <WeekGrid dates={picked} today={today} group={group} meName={meName} meetings={meetings}
          week={group === 'job' ? weekByGroup(picked, weekAssign, workList) : weekByPerson(picked, weekAssign, people, workList)}
          onOpenDay={openDay} onAdd={initial => setEditor({ initial })} onEdit={a => setEditor({ initial: a, editing: true })} />
      )}

      {/* Hours, then what's left to book */}
      {picked.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
          {people.map(p => {
            const h = hours[p] || { total: 0, backend: 0 }
            return <span key={p} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <b>{p.split(' ')[0]}</b> {h.total} h{p === meName ? <> · office <b style={{ color: h.backend < settings.officeTargetHours ? '#a12a1e' : 'var(--green-dark)' }}>{h.backend} h</b></> : ''}
            </span>
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 6 }}>
        <Panel title="Not booked this week" count={unscheduled.length}>
          {unscheduled.length === 0 && <div style={{ ...small, padding: 10 }}>Every active job has time booked.</div>}
          {unscheduled.map(w => (
            <div key={w.jobId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{w.name}</div>
                <div style={small}>{[w.customer, w.requiredBy && `required by ${dayLabel(w.requiredBy)}`, w.openTasks.length && `${w.openTasks.length} task${w.openTasks.length === 1 ? '' : 's'}`, w.openDefs.length && `${w.openDefs.length} deficienc${w.openDefs.length === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ')}</div>
              </div>
              {picked.length > 0 && <button style={pill(false)} onClick={() => setEditor({ initial: { date: picked[0], kind: 'job', jobId: w.jobId } })}>+ Book</button>}
            </div>
          ))}
          {waiting.length > 0 && <div style={{ ...small, padding: '6px 10px', borderTop: '1px solid var(--border)' }}>Waiting on others (not counted): {waiting.map(w => w.name).join(', ')}</div>}
        </Panel>
        <Panel title="Back-end waiting on you" count={backendOpenList.length}>
          {backendOpenList.length === 0 && <div style={{ ...small, padding: 10 }}>No open to-dos.</div>}
          {backendOpenList.slice(0, 14).map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 8, padding: '5px 10px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{t.text}</span><span style={small}>{t.from}</span>
            </div>
          ))}
          {backendOpenList.length > 14 && <div style={{ ...small, padding: '5px 10px' }}>+{backendOpenList.length - 14} more</div>}
        </Panel>
      </div>

      {editor && (
        <AssignModal initial={editor.initial} editing={!!editor.editing} picked={picked} week={week} people={people} meName={meName} workList={workList}
          onClose={() => setEditor(null)} onSave={save} />
      )}
    </div>
  )
}

function Panel({ title, count, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '7px 10px', fontSize: 13, fontWeight: 800, background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{title}</span><span style={{ color: 'var(--text-light)' }}>{count}</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>{children}</div>
    </div>
  )
}

const r1 = h => Math.round((Number(h) || 0) * 10) / 10
const cellBtn = { display: 'block', width: '100%', textAlign: 'left', background: 'var(--surface-2)', border: 'none', borderRadius: 5, padding: '3px 6px', margin: '2px 0', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: 'var(--text)' }

// Week: the summary grid — one row per person (or job), one column per day
function WeekGrid({ dates, today, group, meName, meetings, week, onOpenDay, onAdd, onEdit }) {
  const th = { padding: '7px 8px', fontSize: 12.5, fontWeight: 800, textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', position: 'sticky', top: 0 }
  const td = { padding: '5px 6px', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', verticalAlign: 'top', fontSize: 12 }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 180 + dates.length * 150 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 170 }}>{group === 'job' ? 'Job' : 'Person'}</th>
            {dates.map(d => {
              const mN = (meetings[d]?.meetings || []).length
              return <th key={d} style={{ ...th, borderLeft: '1px solid var(--border)', color: d === today ? 'var(--navy)' : undefined }}>
                <button style={{ ...linkBtn, fontSize: 12.5, fontWeight: 800, padding: 0, color: 'inherit' }} onClick={() => onOpenDay(d)} title="Open this day in detail">{dayLabel(d)}{d === today ? ' (today)' : ''}</button>
                {mN > 0 && <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 800, background: 'var(--accent-bg)', color: 'var(--navy)', borderRadius: 8, padding: '0 5px' }}>{mN} mtg</span>}
              </th>
            })}
            <th style={{ ...th, borderLeft: '1px solid var(--border)', textAlign: 'right', width: 70 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {week.rows.length === 0 && <tr><td colSpan={dates.length + 2} style={{ ...td, ...small, padding: 14 }}>Nothing booked yet.</td></tr>}
          {week.rows.map(r => group === 'job' ? (
            <tr key={r.group.key}>
              <td style={{ ...td, borderLeft: 'none', borderLeftColor: 'transparent' }}>
                <div style={{ fontWeight: 800, borderLeft: `3px solid ${KIND_COLOR[r.group.kind] || 'var(--gray)'}`, paddingLeft: 6 }}>{r.group.label}</div>
                {r.group.sub && <div style={{ ...small, paddingLeft: 9 }}>{r.group.sub}</div>}
              </td>
              {dates.map(d => (
                <td key={d} style={td}>
                  {(r.cells[d] || []).map(c => <button key={c.id} style={cellBtn} onClick={() => onEdit(c.raw)} title="Change this block">{c.workers.map(w => w.split(' ')[0]).join(', ')} <span style={small}>{r1(c.hours)} h</span></button>)}
                </td>
              ))}
              <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{r1(r.total)} h</td>
            </tr>
          ) : (
            <tr key={r.person}>
              <td style={{ ...td, borderLeft: 'none', fontWeight: 800, color: r.person === meName ? 'var(--navy)' : 'var(--text)' }}>{r.person}{r.person === meName ? ' (you)' : ''}</td>
              {dates.map(d => (
                <td key={d} style={td}>
                  {(r.cells[d] || []).map(c => <button key={c.id} style={{ ...cellBtn, borderLeft: `3px solid ${KIND_COLOR[c.kind] || 'var(--gray)'}` }} onClick={() => onEdit(c.raw)} title="Change this block">{c.label} <span style={small}>{r1(c.hours)} h</span></button>)}
                  <button style={{ ...linkBtn, fontSize: 11 }} onClick={() => onAdd({ date: d, workers: [r.person] })} title={`Book ${r.person} on ${dayLabel(d)}`}>+</button>
                </td>
              ))}
              <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{r1(r.total)} h</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, borderLeft: 'none', fontWeight: 800, background: 'var(--surface-2)' }}>Total{group === 'job' ? ' (crew h)' : ''}</td>
            {dates.map(d => <td key={d} style={{ ...td, fontWeight: 800, background: 'var(--surface-2)' }}>{r1(week.dayTotals[d] || 0)} h</td>)}
            <td style={{ ...td, textAlign: 'right', fontWeight: 800, background: 'var(--surface-2)' }}>{r1(week.total)} h</td>
          </tr>
        </tbody>
      </table>
      {group === 'job' && <div style={{ ...small, padding: '6px 10px' }}>Crew hours = block hours × people on the block. Click a day to see it in detail; click a block to change it.</div>}
    </div>
  )
}

// Day: everything about one day — times, jobs, tasks, deficiencies, notes
function DayDetail({ date, picked, today, group, meName, meetings, workList, byPerson, byGroup, onPickDay, onAdd, onEdit, onRemove }) {
  const ms = meetings?.meetings || []
  const ds = meetings?.dates || []
  const Block = ({ b, showWho }) => (
    <div onDoubleClick={() => onEdit(b.raw)} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, padding: '7px 10px', borderTop: '1px solid var(--border)', alignItems: 'start' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, borderLeft: `3px solid ${KIND_COLOR[b.kind] || 'var(--gray)'}`, paddingLeft: 6 }}>{b.time || '—'}<div style={{ ...small, fontWeight: 500 }}>{r1(b.hours)} h</div></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{b.title}</div>
        {(b.job || b.customer || (showWho && b.workers.length > 0)) && <div style={small}>{[b.job, b.customer, showWho ? b.workers.join(', ') : ''].filter(Boolean).join(' · ')}</div>}
        {(b.tasks.length > 0 || b.defs.length > 0) && (
          <ul style={{ margin: '3px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {b.tasks.map((t, i) => <li key={'t' + i}>{t}</li>)}
            {b.defs.map((t, i) => <li key={'d' + i} style={{ color: 'var(--red-dark)' }}>Deficiency: {t}</li>)}
          </ul>
        )}
        {b.notes && <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 2 }}>{b.notes}</div>}
      </div>
      <div style={{ whiteSpace: 'nowrap' }}>
        <button style={linkBtn} onClick={() => onEdit(b.raw)} title="Change">✎</button>
        <button style={{ ...linkBtn, color: '#a12a1e' }} onClick={() => onRemove(b.raw)} title="Remove">✕</button>
      </div>
    </div>
  )
  const card = { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', marginBottom: 10, overflow: 'hidden' }
  const head = { padding: '8px 10px', background: 'var(--surface-2)', display: 'flex', alignItems: 'baseline', gap: 8 }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        {picked.map(d => <button key={d} style={pill(d === date)} onClick={() => onPickDay(d)}>{dayLabel(d)}{d === today ? ' (today)' : ''}</button>)}
        <div style={{ flex: 1 }} />
        <button style={pill(false)} onClick={() => onAdd({})}>+ Assign</button>
      </div>
      {(ms.length > 0 || ds.length > 0) && (
        <div style={{ ...card, padding: '7px 10px', background: 'var(--accent-bg)' }}>
          {ms.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 6, fontSize: 13, padding: '2px 0' }}>
              <span>{MEET_ICON[m.kind] || '📅'}</span><span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{m.start || 'All day'}</span>
              <span style={{ flex: 1 }} title={m.detail || ''}>{m.title}</span>
              {m.link && <button style={linkBtn} onClick={() => window.desktop?.openExternal?.(m.link)}>Open</button>}
            </div>
          ))}
          {ds.map(x => <div key={x.id} style={{ ...small, padding: '1px 0' }}>{DATE_ICON[x.kind] || '•'} {x.title}</div>)}
        </div>
      )}
      {group === 'job' ? (
        byGroup.length === 0 ? <div style={{ ...card, ...small, padding: 14 }}>Nothing booked on {dayLabel(date)}.</div> : byGroup.map(r => (
          <div key={r.group.key} style={card}>
            <div style={head}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{r.group.label}</span>
              <span style={small}>{[r.group.sub, r.group.requiredBy && `required by ${dayLabel(r.group.requiredBy)}`, r.people.join(', ')].filter(Boolean).join(' · ')}</span>
              <div style={{ flex: 1 }} /><span style={{ fontWeight: 800, fontSize: 13 }}>{r1(r.personHours)} crew h</span>
            </div>
            {r.blocks.map(b => <Block key={b.id} b={b} showWho />)}
          </div>
        ))
      ) : byPerson.map(r => (
        <div key={r.person} style={card}>
          <div style={head}>
            <span style={{ fontSize: 15, fontWeight: 800, color: r.person === meName ? 'var(--navy)' : 'var(--text)' }}>{r.person}{r.person === meName ? ' (you)' : ''}</span>
            <div style={{ flex: 1 }} /><span style={{ fontWeight: 800, fontSize: 13 }}>{r1(r.hours)} h</span>
            <button style={linkBtn} onClick={() => onAdd({ workers: [r.person] })} title={`Book ${r.person}`}>+ Book</button>
          </div>
          {r.blocks.length === 0 ? <div style={{ ...small, padding: '7px 10px', borderTop: '1px solid var(--border)' }}>— nothing booked</div>
            : r.blocks.map(b => <Block key={b.id} b={{ ...b, workers: b.workers.filter(w => w !== r.person) }} showWho />)}
        </div>
      ))}
    </div>
  )
}

function AssignModal({ initial, editing, picked, week, people, meName, workList, onClose, onSave }) {
  const [workers, setWorkers] = useState(initial.workers || [])
  const [days, setDays] = useState([initial.date || picked[0]].filter(Boolean))
  const [kind, setKind] = useState(initial.kind || 'job')
  const [jobId, setJobId] = useState(initial.jobId || '')
  const [taskIds, setTaskIds] = useState(initial.taskIds || [])
  const [defIds, setDefIds] = useState(initial.defIds || [])
  const [bucket, setBucket] = useState(initial.bucket || 'admin')
  const [title, setTitle] = useState(initial.kind === 'job' ? (initial.title || '') : (initial.title || ''))
  const [start, setStart] = useState(initial.start || '')
  const [end, setEnd] = useState(initial.end || '')
  const [hrs, setHrs] = useState(initial.hours || '')
  const [notes, setNotes] = useState(initial.notes || '')
  const [q, setQ] = useState('')
  const job = workList.find(w => w.jobId === jobId)
  const dayChoices = [...new Set([...picked, ...week])].sort()
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const shown = workList.filter(w => !q || `${w.label} ${w.note}`.toLowerCase().includes(q.toLowerCase()))
  const preview = { start, end, hours: Number(hrs) || 0 }
  const ok = workers.length && days.length && (kind === 'job' ? !!jobId : kind === 'office' ? !!bucket : !!title.trim())

  const submit = () => {
    if (!ok) return
    const now = new Date().toISOString()
    const base = {
      workers, kind, jobId: kind === 'job' ? jobId : '', customerId: kind === 'job' ? (job?.customerId || '') : '',
      title: kind === 'other' ? title.trim() : (kind === 'job' ? title.trim() : ''), bucket: kind === 'office' ? bucket : '',
      taskIds: kind === 'job' ? taskIds : [], defIds: kind === 'job' ? defIds : [],
      start, end, hours: start && end ? hoursOf(preview) : Number(hrs) || 0, notes: notes.trim(),
    }
    if (editing) onSave([{ ...initial, ...base, date: days[0], editedAt: now }])
    else onSave(days.map(d => ({ id: uid(), date: d, ...base, createdAt: now })))
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Change block' : 'Assign work'} wide>
      <div style={{ display: 'grid', gap: 14, fontSize: 13, padding: '6px 20px 18px' }}>
        <div>
          <div style={lbl}>Who</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {people.map(p => <button key={p} style={pill(workers.includes(p))} onClick={() => toggle(workers, setWorkers, p)}>{p}{p === meName ? ' (you)' : ''}</button>)}
          </div>
        </div>
        <div>
          <div style={lbl}>{editing ? 'Day' : 'Day(s) — pick more to repeat it'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {dayChoices.map(d => <button key={d} style={{ ...pill(days.includes(d)), opacity: picked.includes(d) ? 1 : 0.65 }} onClick={() => editing ? setDays([d]) : toggle(days, setDays, d)}>{dayLabel(d)}</button>)}
          </div>
        </div>
        <div>
          <div style={lbl}>What</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[['job', '🔧 Job'], ['office', '🗂 Quoting / admin'], ['other', '• Other']].map(([k, l]) => <button key={k} style={pill(kind === k)} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          {kind === 'job' && (
            <div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs and customers…" style={{ ...inp, width: '100%', marginBottom: 6 }} />
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                {shown.length === 0 && <div style={{ ...small, padding: 8 }}>No active jobs match.</div>}
                {shown.map(w => (
                  <div key={w.jobId} onClick={() => { setJobId(w.jobId); setTaskIds([]); setDefIds([]) }} style={{ padding: '6px 9px', cursor: 'pointer', borderTop: '1px solid var(--border)', background: w.jobId === jobId ? 'var(--blue-bg)' : 'transparent' }}>
                    <div style={{ fontWeight: 700 }}>{w.name} {w.waiting && <span style={{ fontSize: 10.5, color: '#7a5a00', background: '#fff6e0', borderRadius: 8, padding: '0 6px', fontWeight: 700 }}>waiting</span>} {w.deficienciesOnly && <span style={{ fontSize: 10.5, color: 'var(--red-dark)', background: 'var(--red-bg)', borderRadius: 8, padding: '0 6px', fontWeight: 700 }}>deficiencies</span>}</div>
                    <div style={small}>{[w.customer, w.requiredBy && `required by ${dayLabel(w.requiredBy)}`, w.progress != null && `${w.progress}%`, w.openTasks.length && `${w.openTasks.length} tasks`, w.openDefs.length && `${w.openDefs.length} deficiencies`, w.note].filter(Boolean).join(' · ')}</div>
                  </div>
                ))}
              </div>
              {job && (job.openTasks.length > 0 || job.openDefs.length > 0) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ ...small, marginBottom: 4 }}>On this block (optional):</div>
                  {job.openTasks.map(t => <label key={t.id} style={chk}><input type="checkbox" checked={taskIds.includes(t.id)} onChange={() => toggle(taskIds, setTaskIds, t.id)} /> {t.text}{t.due ? <span style={small}> · due {t.due}</span> : ''}</label>)}
                  {job.openDefs.map(d => <label key={d.id} style={chk}><input type="checkbox" checked={defIds.includes(d.id)} onChange={() => toggle(defIds, setDefIds, d.id)} /> <span style={{ color: 'var(--red-dark)' }}>Deficiency:</span> {d.text}</label>)}
                </div>
              )}
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short label (optional), e.g. AHU piping" style={{ ...inp, width: '100%', marginTop: 8 }} />
            </div>
          )}
          {kind === 'office' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(BACKEND).map(([k, l]) => <button key={k} style={pill(bucket === k)} onClick={() => setBucket(k)}>{l}</button>)}
            </div>
          )}
          {kind === 'other' && <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Load Cat6 at RDP, site orientation, pickup" style={{ ...inp, width: '100%' }} />}
        </div>
        <div>
          <div style={lbl}>When</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {SHIFTS.map(s => <button key={s.id} style={pill(start === s.start && end === s.end)} onClick={() => { setStart(s.start); setEnd(s.end) }}>{s.label}</button>)}
            <input type="time" value={start} onChange={e => setStart(e.target.value)} style={inp} aria-label="Start" />
            <span>to</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={inp} aria-label="End" />
            {!(start && end) && <><span style={small}>or</span><input type="number" min="0" step="0.5" value={hrs} onChange={e => setHrs(e.target.value)} placeholder="hours" style={{ ...inp, width: 70 }} /></>}
            {start && end && <span style={small}>{hoursOf(preview)} h{end < start ? ' (runs past midnight)' : ''}</span>}
          </div>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for the crew (optional)" rows={2} style={{ ...inp, width: '100%', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={pill(false)} onClick={onClose}>Cancel</button>
          <button style={{ ...pill(true), opacity: ok ? 1 : 0.5 }} disabled={!ok} onClick={submit}>{editing ? 'Save' : days.length > 1 ? `Book ${days.length} days` : 'Book'}</button>
        </div>
      </div>
    </Modal>
  )
}
const lbl = { fontSize: 11.5, fontWeight: 800, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }
const chk = { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12.5, padding: '2px 0', cursor: 'pointer' }
