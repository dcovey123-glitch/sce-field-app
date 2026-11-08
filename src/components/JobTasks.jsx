import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { useCrewRoster } from '../api/crewRoster.js'
import {
  TEMPLATES_KEY, uid, newTask, tasksOf, isOverdue, isDueToday, addTasks, changeTask, removeTask, setDone, moveTask,
  tasksFromQuote, fmtDay,
} from '../api/tasks.js'

const inp = { fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }
const btn = (primary) => ({ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
  border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--navy)' : 'var(--surface)', color: primary ? '#fff' : 'var(--text-mid)' })
const small = { fontSize: 11, color: 'var(--text-light)' }

// One task line. Used on the job and on the To do page.
export function TaskRow({ t, onPatch, onToggle, onRemove, onMove, people = [], jobLabel, onOpenJob, compact }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(t.text)
  const over = isOverdue(t), dueToday = isDueToday(t)
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: t.done ? 'var(--surface-2)' : 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '6px 12px' : '8px 14px' }}>
        <input type="checkbox" checked={!!t.done} onChange={e => onToggle(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }} title={t.done ? 'Not done after all' : 'Done — records today and who'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', fontSize: 13.5, color: t.done ? 'var(--text-light)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none' }}>
            {t.text || '(no description)'}
            {t.notes && !open && <span style={{ ...small, marginLeft: 6 }}>📝</span>}
          </div>
          {(jobLabel || t.who || t.due || t.done) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2, ...small }}>
              {jobLabel && <a href="#" onClick={e => { e.preventDefault(); onOpenJob && onOpenJob() }} style={{ color: 'var(--blue, #2563eb)', fontWeight: 600 }}>{jobLabel}</a>}
              {t.who && !t.done && <span>👷 {t.who}</span>}
              {t.due && !t.done && <span style={{ fontWeight: 700, color: over ? '#c0392b' : dueToday ? '#9a6610' : 'var(--text-light)' }}>{over ? 'Overdue · ' : dueToday ? 'Today · ' : 'By '}{fmtDay(t.due)}</span>}
              {t.done && <span style={{ color: '#1e7a34', fontWeight: 600 }}>✓ Done {fmtDay(t.doneAt)}{t.doneBy ? ' — ' + t.doneBy : ''}</span>}
              {t.fromPhone && <span>📱</span>}
            </div>
          )}
        </div>
        {!t.done && onMove && <span style={{ display: 'flex', flexDirection: 'column' }}>
          <button onClick={() => onMove(-1)} title="Up" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-light)', padding: 0, lineHeight: 1 }}>▲</button>
          <button onClick={() => onMove(1)} title="Down" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-light)', padding: 0, lineHeight: 1 }}>▼</button>
        </span>}
        <button onClick={() => setOpen(o => !o)} title="Details" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-light)' }}>{open ? '▴' : '▾'}</button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px 42px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={text} onChange={e => setText(e.target.value)} onBlur={() => text.trim() && text !== t.text && onPatch({ text: text.trim() })}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} style={{ ...inp, width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={small}>Who&nbsp;
              <select value={t.who || ''} onChange={e => onPatch({ who: e.target.value })} style={{ ...inp, padding: '4px 6px' }}>
                <option value="">Anyone</option>
                {[...new Set([...people, ...(t.who ? [t.who] : [])])].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={small}>By&nbsp;<input type="date" value={t.due || ''} onChange={e => onPatch({ due: e.target.value })} style={{ ...inp, padding: '4px 6px' }} /></label>
            {t.done && <label style={small}>Done on&nbsp;<input type="date" value={String(t.doneAt || '').slice(0, 10)} onChange={e => e.target.value && onPatch({ doneAt: e.target.value + 'T12:00:00' })} style={{ ...inp, padding: '4px 6px' }} /></label>}
            <span style={{ flex: 1 }} />
            {onRemove && <button onClick={onRemove} style={{ ...btn(false), color: '#a12a1e' }}>Delete</button>}
          </div>
          <NotesBox value={t.notes || ''} onSave={v => onPatch({ notes: v })} />
          <div style={small}>Added {fmtDay(t.createdAt)}{t.createdBy ? ' by ' + t.createdBy : ''}</div>
        </div>
      )}
    </div>
  )
}

function NotesBox({ value, onSave }) {
  const [v, setV] = useState(value)
  return <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} rows={2} placeholder="Notes — what was found, what's left, materials needed…" style={{ ...inp, width: '100%', resize: 'vertical' }} />
}

// The Tasks section on a job
export default function JobTasks({ project, onUpdate }) {
  const crew = useCrewRoster()
  const me = crew.meName
  const people = crew.active.map(p => p.name)
  const tasks = tasksOf(project)
  const open = tasks.filter(t => !t.done)
  const done = tasks.filter(t => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
  const [text, setText] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [picker, setPicker] = useState('') // '' | 'quote' | 'template' | 'save'
  const [templates, setTemplates] = useLocalStore(TEMPLATES_KEY, [])
  const tpls = Array.isArray(templates) ? templates : []

  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const ids = project.linkedQuoteIds || (project.linkedQuoteId ? [project.linkedQuoteId] : [])
  const quotes = ids.map(id => quotesStore.records.find(q => q.id === id)).filter(q => q && !q.trashedAt)
  const fromQuote = quotes.flatMap(tasksFromQuote).filter(s => !tasks.some(t => t.text === s))

  const add = (lines) => {
    const items = lines.map(s => String(s).trim()).filter(Boolean).map(s => newTask(s, me))
    if (items.length) onUpdate(addTasks(items))
  }
  const submit = () => {
    // a pasted list adds one task per line
    add(text.split(/\r?\n/))
    setText('')
  }

  return (
    <div style={{ padding: '8px 16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '4px 0 10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{open.length} to do</span>
        <span style={small}>{done.length} done{done.length ? ` · last ${fmtDay(done[0].doneAt)}` : ''}</span>
        {open.some(isOverdue) && <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#c0392b', borderRadius: 10, padding: '1px 8px' }}>{open.filter(isOverdue).length} overdue</span>}
        {tasks.length > 0 && !open.length && <span style={{ fontSize: 12, fontWeight: 700, color: '#1e7a34' }}>✓ Everything's done — ready to bill?</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="Add a task — Enter to add (paste a list for one task per line)"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          style={{ ...inp, flex: 1, resize: 'vertical', minHeight: 34 }} />
        <button onClick={submit} style={btn(true)}>+ Add</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {fromQuote.length > 0 && <button onClick={() => setPicker(p => p === 'quote' ? '' : 'quote')} style={btn(picker === 'quote')}>📄 From the quote ({fromQuote.length})</button>}
        <button onClick={() => setPicker(p => p === 'template' ? '' : 'template')} style={btn(picker === 'template')}>📋 Use a checklist{tpls.length ? ` (${tpls.length})` : ''}</button>
        {tasks.length > 0 && <button onClick={() => setPicker(p => p === 'save' ? '' : 'save')} style={btn(picker === 'save')}>💾 Save as checklist</button>}
      </div>

      {picker === 'quote' && <PickLines title="Tasks from the quote's scope — untick any you don't want" lines={fromQuote} onAdd={l => { add(l); setPicker('') }} onCancel={() => setPicker('')} />}
      {picker === 'template' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'var(--surface-2)' }}>
          {!tpls.length && <div style={small}>No checklists yet. Build a job's tasks, then "Save as checklist" to reuse them (e.g. GFCI change-over, service call).</div>}
          {tpls.map(tp => (
            <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <b style={{ fontSize: 13 }}>{tp.name}</b><span style={small}>{tp.items.length} tasks</span><span style={{ flex: 1 }} />
              <button onClick={() => { add(tp.items); setPicker('') }} style={btn(true)}>Add these</button>
              <button onClick={() => setTemplates(l => (l || []).filter(x => x.id !== tp.id))} style={btn(false)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      {picker === 'save' && <SaveTemplate tasks={tasks} onSave={(name) => { setTemplates(l => [...(Array.isArray(l) ? l : []), { id: uid(), name, items: tasks.map(t => t.text) }]); setPicker('') }} onCancel={() => setPicker('')} />}

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {!open.length && <div style={{ padding: 14, ...small, fontSize: 12.5 }}>{tasks.length ? 'Nothing left to do.' : 'No tasks yet — add what has to be done on this job.'}</div>}
        {open.map(t => (
          <TaskRow key={t.id} t={t} people={people}
            onPatch={p => onUpdate(changeTask(t.id, p))}
            onToggle={on => onUpdate(setDone(t.id, on, me))}
            onRemove={() => onUpdate(removeTask(t.id))}
            onMove={d => onUpdate(moveTask(t.id, d))} />
        ))}
        {done.length > 0 && (
          <>
            <button onClick={() => setShowDone(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '7px 14px', border: 'none', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>
              Done ({done.length}) {showDone ? '▴' : '▾'}
            </button>
            {showDone && done.map(t => (
              <TaskRow key={t.id} t={t} people={people}
                onPatch={p => onUpdate(changeTask(t.id, p))}
                onToggle={on => onUpdate(setDone(t.id, on, me))}
                onRemove={() => onUpdate(removeTask(t.id))} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function PickLines({ title, lines, onAdd, onCancel }) {
  const [on, setOn] = useState(() => new Set(lines.map((_, i) => i)))
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'var(--surface-2)' }}>
      <div style={{ ...small, marginBottom: 6 }}>{title}</div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {lines.map((l, i) => (
          <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={on.has(i)} onChange={() => setOn(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })} />
            <span>{l}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={() => onAdd(lines.filter((_, i) => on.has(i)))} style={btn(true)}>Add {on.size} task{on.size === 1 ? '' : 's'}</button>
        <button onClick={onCancel} style={btn(false)}>Cancel</button>
      </div>
    </div>
  )
}

function SaveTemplate({ tasks, onSave, onCancel }) {
  const [name, setName] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'var(--surface-2)', flexWrap: 'wrap' }}>
      <span style={small}>Save these {tasks.length} tasks as a checklist called</span>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GFCI change-over" onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()) }} style={{ ...inp, width: 220 }} />
      <button disabled={!name.trim()} onClick={() => onSave(name.trim())} style={btn(true)}>Save</button>
      <button onClick={onCancel} style={btn(false)}>Cancel</button>
    </div>
  )
}
