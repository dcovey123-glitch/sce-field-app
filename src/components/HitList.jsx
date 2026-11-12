import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { customerTodosForHitList, setTodoDone, addTodo } from '../api/customerNotes.js'

// Home: a quick to-do list. Type a line, Enter to add, tick it when it's done.
// Done items drop to the bottom (struck through) until you clear them.
// Open to-dos from each customer's General Notes show here too, tagged with
// the customer — tick one here and it's ticked on the customer; click the
// customer's name to open it.
//
// full: the Hit List in its own window (⤢ on Home). Same list, more room —
// customer to-dos grouped under each customer, double-click a line of yours
// to edit it, and you can add a to-do straight onto a customer.
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
  const openCustomer = id => { if (window.desktop?.openCustomerWindow) window.desktop.openCustomerWindow(id) }
  const list = Array.isArray(items) ? items : []
  const open = list.filter(x => !x.doneAt)
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
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
        {tag && <span onClick={() => openCustomer(t.customerId)} title={`Open ${t.customerName}`}
          style={{ fontSize: 10.5, fontWeight: 800, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '0 6px', marginRight: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t.customerName}</span>}
        {t.text}
      </span>
      {full && t.at && <span style={{ fontSize: 11, color: 'var(--text-light)', whiteSpace: 'nowrap', marginTop: 2 }}>{ago(t.at)}</span>}
    </div>
  )
  const clearDone = done.length > 0 && (
    <button onClick={() => setItems(l => (Array.isArray(l) ? l : []).filter(x => !x.doneAt))}
      style={{ marginTop: 4, border: 'none', background: 'none', color: '#1a5fa0', fontSize: full ? 12.5 : 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Clear done ({done.length})</button>
  )
  const total = open.length + custTodos.length

  if (full) {
    // Customer to-dos grouped under each customer, customers A–Z
    const byCust = new Map()
    custTodos.forEach(t => { if (!byCust.has(t.customerId)) byCust.set(t.customerId, { name: t.customerName, items: [] }); byCust.get(t.customerId).items.push(t) })
    const groups = [...byCust.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
    const customers = (jobsHub.customers || []).filter(c => !c.trashedAt).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
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
            Double-click one of yours to edit it. Customer to-dos come from each customer's General Notes — ticking one here ticks it there.
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
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {open.map(x => row(x, false))}
        {custTodos.map(t => custRow(t, true))}
        {!open.length && !done.length && !custTodos.length && <div style={{ fontSize: 11.5, color: 'var(--text-light)', padding: '4px 2px' }}>Nothing on the list.</div>}
        {done.map(x => row(x, true))}
      </div>
      {clearDone}
    </div>
  )
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
