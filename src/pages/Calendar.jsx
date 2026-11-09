import React, { useMemo, useState } from 'react'
import { useCalendar } from '../api/useCalendar.js'
import { monthGrid, upcoming, newEvent, dayMarks } from '../api/calendar.js'
import { todayLocal } from '../api/albertaTime.js'
import { fmtDate, money } from '../api/format.js'
import { weekStartDay } from '../api/weekStart.js'

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const KIND = {
  event: { icon: '📅', color: '#1a5fa0', label: 'Yours' },
  email: { icon: '✉', color: '#5b3fa0', label: 'From email' },
  outlook: { icon: '🗓', color: '#0f6cbd', label: 'Outlook' },
  task: { icon: '☐', color: '#8a5d00', label: 'Task due' },
  jobstart: { icon: '▶', color: '#1e7a34', label: 'Job start' },
  jobdue: { icon: '⚑', color: '#a12a1e', label: 'Required by' },
}

// The month grid, shared by the Calendar window and the Home card
export function MonthGrid({ year, month, days, selected, today, onPick, compact = false, onHover }) {
  const grid = monthGrid(year, month, weekStartDay())
  const names = grid[0].map(c => fmtDate(c.date, 'weekday').slice(0, compact ? 1 : 3))
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: compact ? 1 : 2, marginBottom: 2 }}>
        {names.map((n, i) => <div key={i} style={{ fontSize: compact ? 9.5 : 11, fontWeight: 700, color: 'var(--text-light)', textAlign: 'center' }}>{n}</div>)}
      </div>
      {grid.map((row, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: compact ? 1 : 2, marginBottom: compact ? 1 : 2 }}>
          {row.map(c => {
            const d = days[c.date]
            const m = dayMarks(d)
            const isSel = c.date === selected, isToday = c.date === today
            const first = !compact && d && d.schedule[0]
            return (
              <div key={c.date} onClick={() => onPick(c.date)}
                onMouseEnter={e => onHover && onHover(c.date, e.currentTarget)} onMouseLeave={() => onHover && onHover(null)}
                style={{
                  cursor: 'pointer', borderRadius: compact ? 4 : 6, padding: compact ? '2px 0 3px' : '4px 5px', minHeight: compact ? 0 : 62,
                  background: isSel ? 'var(--accent-bg, #fff4d6)' : 'var(--surface)', border: `1px solid ${isToday ? 'var(--accent, #e9a21f)' : isSel ? '#e9c46a' : 'var(--border)'}`,
                  opacity: c.inMonth ? 1 : 0.45, textAlign: compact ? 'center' : 'left', overflow: 'hidden',
                }}>
                <div style={{ fontSize: compact ? 11 : 12, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent-dim, #9a6610)' : 'var(--text)' }}>{c.day}</div>
                <div style={{ display: 'flex', gap: 2, justifyContent: compact ? 'center' : 'flex-start', minHeight: 5, marginTop: 1 }}>
                  {m.schedule > 0 && <Dot c="#1a5fa0" />}
                  {m.time && <Dot c="#1e7a34" />}
                  {m.other > 0 && <Dot c="#9aa5b1" />}
                </div>
                {first && <div style={{ fontSize: 10.5, color: KIND[first.kind]?.color || 'var(--text-mid)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{first.start ? first.start.replace(/ (a|p)\.m\./, '$1') + ' ' : ''}{first.title}</div>}
                {!compact && d && d.schedule.length > 1 && <div style={{ fontSize: 10, color: 'var(--text-light)' }}>+{d.schedule.length - 1} more</div>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
const Dot = ({ c }) => <span style={{ width: 5, height: 5, borderRadius: 3, background: c, display: 'inline-block' }} />

export default function Calendar({ date, onDate }) {
  const today = todayLocal()
  const selected = date && date !== 'today' ? date : today
  const [ym, setYm] = useState(() => selected.slice(0, 7))
  const [tab, setTab] = useState('day')
  const [y, m] = ym.split('-').map(Number)
  const grid = monthGrid(y, m, weekStartDay())
  const from = [grid[0][0].date, addDays(today, -1)].sort()[0]
  const to = [grid[grid.length - 1][6].date, addDays(today, 60), selected].sort().pop()
  const { days, events, setEvents, jobOptions, outlookUpdatedAt } = useCalendar([from, selected].sort()[0], to)
  const pick = d => { onDate(d); setTab('day'); if (d.slice(0, 7) !== ym) setYm(d.slice(0, 7)) }
  const shiftMonth = k => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(d.toISOString().slice(0, 7)) }
  const up = useMemo(() => upcoming(days, today), [days, today])

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, alignItems: 'flex-start', minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ width: 430, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, position: 'sticky', top: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
          <div style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: 16 }}>{fmtDate(ym, 'monthYear')}</div>
          <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
          <button onClick={() => pick(today)} style={{ ...navBtn, width: 'auto', padding: '0 10px', fontSize: 12 }}>Today</button>
        </div>
        <MonthGrid year={y} month={m} days={days} selected={selected} today={today} onPick={pick} />
        <div style={{ display: 'flex', gap: 10, fontSize: 10.5, color: 'var(--text-light)', marginTop: 8, flexWrap: 'wrap' }}>
          <span><Dot c="#1a5fa0" /> schedule</span><span><Dot c="#1e7a34" /> time clocked</span><span><Dot c="#9aa5b1" /> work, notes, slips, billing</span>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-light)', marginTop: 4 }}>
          Outlook: {outlookUpdatedAt ? `brought in ${fmtDate(outlookUpdatedAt, 'when')} by the morning email run` : 'not brought in yet — the morning email run adds it'}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => setTab('day')} style={tabBtn(tab === 'day')}>Day</button>
          <button onClick={() => setTab('upcoming')} style={tabBtn(tab === 'upcoming')}>Upcoming ({up.length})</button>
        </div>
        {tab === 'day'
          ? <DayView date={selected} day={days[selected]} events={events} setEvents={setEvents} jobOptions={jobOptions} onPrev={() => pick(addDays(selected, -1))} onNext={() => pick(addDays(selected, 1))} />
          : <Upcoming list={up} onPick={pick} />}
      </div>
    </div>
  )
}

function Upcoming({ list, onPick }) {
  if (!list.length) return <Empty text="Nothing scheduled in the next 60 days." />
  let last = ''
  return (
    <div style={card}>
      {list.map(s => {
        const head = s.date !== last ? (last = s.date) : null
        return (
          <React.Fragment key={s.date + s.id}>
            {head && <div onClick={() => onPick(s.date)} style={{ padding: '8px 14px 4px', fontSize: 12, fontWeight: 800, color: 'var(--text-mid)', cursor: 'pointer', background: 'var(--surface-2)' }}>{fmtDate(s.date, 'weekdayLong')}</div>}
            <ScheduleRow s={s} onClick={() => onPick(s.date)} />
          </React.Fragment>
        )
      })}
    </div>
  )
}

function ScheduleRow({ s, onClick, onDelete }) {
  const k = KIND[s.kind] || KIND.event
  return (
    <div onClick={onClick} style={{ display: 'flex', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--border)', alignItems: 'baseline', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 12, color: 'var(--text-mid)' }}>{s.start ? `${s.start}${s.end ? '–' + s.end : ''}` : 'All day'}</span>
      <span title={k.label} style={{ color: k.color }}>{k.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
        {s.detail && <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{s.detail}</div>}
      </div>
      {s.link && <button onClick={e => { e.stopPropagation(); window.desktop?.openExternal(s.link) }} style={linkBtn}>Open</button>}
      {onDelete && s.editable && <button onClick={e => { e.stopPropagation(); onDelete() }} title="Remove from the calendar" style={{ ...linkBtn, color: '#a12a1e' }}>✕</button>}
    </div>
  )
}

function DayView({ date, day, events, setEvents, jobOptions, onPrev, onNext }) {
  const [adding, setAdding] = useState(false)
  const d = day || { schedule: [], time: [], work: [], notes: [], materials: [], money: [] }
  const hours = Math.round(d.time.reduce((a, w) => a + w.hours, 0) * 100) / 100
  const nothing = !d.schedule.length && !d.time.length && !d.work.length && !d.notes.length && !d.materials.length && !d.money.length
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onPrev} style={navBtn}>‹</button>
        <div style={{ fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: 18, flex: 1 }}>{fmtDate(date, 'long')}</div>
        <button onClick={onNext} style={navBtn}>›</button>
        <button onClick={() => setAdding(a => !a)} style={{ padding: '7px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--navy)', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>+ Add</button>
      </div>
      {adding && <AddEvent date={date} jobOptions={jobOptions} onCancel={() => setAdding(false)} onAdd={e => { setEvents(list => [...(list || []), e]); setAdding(false) }} />}
      {nothing && !adding && <Empty text="Nothing on this day yet. Use + Add to put something on it." />}

      {d.schedule.length > 0 && <Section title="Schedule">
        {d.schedule.map(s => <ScheduleRow key={s.id} s={s} onDelete={() => setEvents(list => (list || []).filter(e => e.id !== s.id))} />)}
      </Section>}

      {d.time.length > 0 && <Section title={`Time — ${hours} h`}>
        {d.time.map(w => (
          <div key={w.worker} style={{ borderTop: '1px solid var(--border)', padding: '7px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}><span>{w.worker}</span><span>{w.hours} h</span></div>
            {w.lines.map((l, i) => (
              <div key={l.id + i} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text-mid)', marginTop: 3 }}>
                <span style={{ width: 120, flexShrink: 0, color: 'var(--text-light)' }}>{l.start ? `${l.start}–${l.end}` : ''}</span>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ color: 'var(--text)', fontWeight: 600 }}>{l.project}</b>{l.note ? ` — ${l.note}` : ''}</span>
                <span>{l.hours} h</span>
              </div>
            ))}
          </div>
        ))}
      </Section>}

      {d.work.length > 0 && <Section title="Work done">
        {d.work.map(w => <Line key={w.id} title={w.title} detail={w.detail} />)}
      </Section>}

      {d.notes.length > 0 && <Section title="Notes">
        {d.notes.map(nt => (
          <div key={nt.id} style={{ borderTop: '1px solid var(--border)', padding: '7px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: nt.kind === 'assistant' ? '#5b3fa0' : 'var(--text-mid)' }}>{nt.kind === 'assistant' ? '🤖 ' : '📝 '}{nt.title}{nt.workers.length ? ` · ${nt.workers.join(', ')}` : ''}</div>
            <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', marginTop: 2, maxHeight: 180, overflowY: 'auto' }}>{nt.text}</div>
          </div>
        ))}
      </Section>}

      {d.materials.length > 0 && <Section title="Material in">
        {d.materials.map(x => <Line key={x.id} title={`📦 ${x.title}`} detail={x.detail} />)}
      </Section>}

      {d.money.length > 0 && <Section title="Billing & quotes">
        {d.money.map(x => <Line key={x.id} title={x.title} detail={[x.amount ? money(x.amount) : '', x.detail].filter(Boolean).join(' · ')} />)}
      </Section>}
    </div>
  )
}

function AddEvent({ date, jobOptions, onAdd, onCancel }) {
  const [f, setF] = useState({ date, title: '', start: '', end: '', jobId: '', notes: '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ok = f.title.trim() && f.date
  const open = jobOptions.filter(j => !j.completed && !['billed', 'unbilled', 'closed'].includes(j.lifecycleStatus))
  const save = () => { const e = newEvent(f, uid); if (e) onAdd(e) }
  return (
    <div style={{ ...card, padding: 12, marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      <input autoFocus value={f.title} onChange={e => set('title', e.target.value)} onKeyDown={e => e.key === 'Enter' && ok && save()} placeholder="What's on (e.g. Site walk — Arts Vault)" style={{ ...inp, gridColumn: '1 / -1' }} />
      <input type="date" value={f.date} onChange={e => set('date', e.target.value)} style={inp} />
      <input type="time" value={f.start} onChange={e => set('start', e.target.value)} title="Start (leave blank for all day)" style={inp} />
      <input type="time" value={f.end} onChange={e => set('end', e.target.value)} title="End" style={inp} />
      <select value={f.jobId} onChange={e => set('jobId', e.target.value)} style={{ ...inp, gridColumn: '1 / -1' }}>
        <option value="">No job</option>
        {open.map(j => <option key={j.id} value={j.id}>{j.customerName ? j.customerName + ' — ' : ''}{j.name}</option>)}
      </select>
      <input value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Notes (optional)" style={{ ...inp, gridColumn: '1 / -1' }} />
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12.5 }}>Cancel</button>
        <button disabled={!ok} onClick={save} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: ok ? 'var(--accent)' : 'var(--border)', color: 'var(--navy)', fontWeight: 800, cursor: ok ? 'pointer' : 'default', fontSize: 12.5 }}>Add to calendar</button>
      </div>
    </div>
  )
}

const Section = ({ title, children }) => (
  <div style={{ ...card, marginBottom: 12 }}>
    <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>{title}</div>
    {children}
  </div>
)
const Line = ({ title, detail }) => (
  <div style={{ borderTop: '1px solid var(--border)', padding: '7px 14px' }}>
    <div style={{ fontSize: 13 }}>{title}</div>
    {detail && <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{detail}</div>}
  </div>
)
const Empty = ({ text }) => <div style={{ ...card, padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-light)' }}>{text}</div>
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }
const navBtn = { width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 15, fontWeight: 700 }
const tabBtn = on => ({ padding: '7px 14px', borderRadius: 20, border: `1px solid ${on ? 'var(--navy)' : 'var(--border)'}`, background: on ? 'var(--navy)' : 'var(--surface)', color: on ? '#fff' : 'var(--text)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' })
const linkBtn = { border: 'none', background: 'none', color: '#1a5fa0', cursor: 'pointer', fontSize: 12, fontWeight: 700 }
const inp = { fontSize: 13, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font)', minWidth: 0 }
