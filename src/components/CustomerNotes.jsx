import React, { useState, useEffect, useRef } from 'react'
import { addTodo, setTodoDone, removeTodo, clearDoneTodos, openTodos, doneTodos } from '../api/customerNotes.js'

// Customer General Notes — at the bottom of every tab in the customer window.
// A to-do list (open ones also show on the Home Hit List) and a quick-notes
// box, both kept on the customer.
// updateCustomer(patch | (customer) => patch) — the jobs hub's updateCustomer.
export default function CustomerNotes({ customer, updateCustomer }) {
  const [text, setText] = useState('')
  const [hover, setHover] = useState('')
  const [showDone, setShowDone] = useState(false)
  const open = openTodos(customer.todos)
  const done = doneTodos(customer.todos)
  const todos = fn => updateCustomer(c => ({ todos: fn(c.todos) }))

  const add = () => {
    if (!text.trim()) return
    const t = text
    todos(l => addTodo(l, t))
    setText('')
  }

  const row = (x, isDone) => (
    <div key={x.id} onMouseEnter={() => setHover(x.id)} onMouseLeave={() => setHover('')}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0', fontSize: 13, lineHeight: 1.4 }}>
      <input type="checkbox" checked={isDone} onChange={e => { const d = e.target.checked; todos(l => setTodoDone(l, x.id, d)) }} style={{ marginTop: 3, cursor: 'pointer' }} />
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', color: isDone ? 'var(--text-light)' : 'var(--text)', textDecoration: isDone ? 'line-through' : 'none' }}>{x.text}</span>
      {hover === x.id && <button onClick={() => todos(l => removeTodo(l, x.id))} title="Remove" style={{ border: 'none', background: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>}
    </div>
  )

  return (
    <div style={{ margin: '18px 14px 24px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)', overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8, background: 'var(--surface)' }}>
        <span style={{ fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: 15, flex: 1 }}>Customer General Notes</span>
        {open.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{open.length} to do · on your Hit List</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '10px 14px 12px' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>To-do</div>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder={`Add a to-do for ${customer.name || 'this customer'}, press Enter…`}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, fontFamily: 'var(--font)', background: 'var(--surface)' }} />
          {open.map(x => row(x, false))}
          {!open.length && <div style={{ fontSize: 12, color: 'var(--text-light)', padding: '3px 0' }}>Nothing to do for this customer.</div>}
          {done.length > 0 && (
            <div style={{ marginTop: 4, display: 'flex', gap: 12 }}>
              <button onClick={() => setShowDone(s => !s)} style={linkBtn}>{showDone ? 'Hide' : 'Show'} done ({done.length})</button>
              {showDone && <button onClick={() => todos(clearDoneTodos)} style={linkBtn}>Clear done</button>}
            </div>
          )}
          {showDone && done.map(x => row(x, true))}
        </div>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>Quick notes</div>
          <NotesBox value={customer.generalNotes || ''} onSave={v => updateCustomer({ generalNotes: v })} />
        </div>
      </div>
    </div>
  )
}

const linkBtn = { border: 'none', background: 'none', color: '#1a5fa0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }

// Saves a moment after you stop typing, and when you click away
function NotesBox({ value, onSave }) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const timer = useRef(null)
  const last = useRef(value)
  const latest = useRef(value)
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  useEffect(() => { if (!focused) { setDraft(value); last.current = value; latest.current = value } }, [value, focused])
  const save = v => { clearTimeout(timer.current); if (v !== last.current) { last.current = v; saveRef.current(v) } }
  // Leaving the tab mid-typing still saves
  useEffect(() => () => { clearTimeout(timer.current); if (latest.current !== last.current) saveRef.current(latest.current) }, [])
  return (
    <textarea value={draft} rows={6}
      onFocus={() => setFocused(true)}
      onChange={e => { const v = e.target.value; setDraft(v); latest.current = v; clearTimeout(timer.current); timer.current = setTimeout(() => save(v), 1200) }}
      onBlur={() => { setFocused(false); save(draft) }}
      placeholder="Gate codes, who to call, site quirks, things to remember…"
      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.45, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font)', resize: 'vertical', background: 'var(--surface)' }} />
  )
}
