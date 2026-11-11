import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { customerTodosForHitList, setTodoDone } from '../api/customerNotes.js'

// Home: a quick to-do list. Type a line, Enter to add, tick it when it's done.
// Done items drop to the bottom (struck through) until you clear them.
// Open to-dos from each customer's General Notes show here too, tagged with
// the customer — tick one here and it's ticked on the customer; click the
// customer's name to open it.
const uid = () => Math.random().toString(36).slice(2, 10)

export default function HitList() {
  const [items, setItems] = useLocalStore('hit_list', [])
  const [text, setText] = useState('')
  const [hover, setHover] = useState('')
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
    setItems(l => [...(Array.isArray(l) ? l : []), { id: uid(), text: t, at: new Date().toISOString() }])
    setText('')
  }
  const upd = (id, patch) => setItems(l => (Array.isArray(l) ? l : []).map(x => x.id === id ? { ...x, ...patch } : x))
  const del = id => setItems(l => (Array.isArray(l) ? l : []).filter(x => x.id !== id))

  const row = (x, isDone) => (
    <div key={x.id} onMouseEnter={() => setHover(x.id)} onMouseLeave={() => setHover('')}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 2px', fontSize: 12.5, lineHeight: 1.35 }}>
      <input type="checkbox" checked={isDone} onChange={e => upd(x.id, { doneAt: e.target.checked ? new Date().toISOString() : undefined })} style={{ marginTop: 2, cursor: 'pointer' }} />
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', color: isDone ? 'var(--text-light)' : 'var(--text)', textDecoration: isDone ? 'line-through' : 'none' }}>{x.text}</span>
      {hover === x.id && <button onClick={() => del(x.id)} title="Remove" style={{ border: 'none', background: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>}
    </div>
  )

  return (
    <div data-hitlist onClick={e => e.stopPropagation()} style={{ width: 236, boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 4px 18px rgba(15,30,46,.10)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ flex: 1, fontFamily: 'var(--font-d)', fontWeight: 700, fontSize: 13 }}>🎯 Hit List</span>
        {open.length + custTodos.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{open.length + custTodos.length} to do</span>}
      </div>
      <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="Add a line, press Enter…"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, fontFamily: 'var(--font)' }} />
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {open.map(x => row(x, false))}
        {custTodos.map(t => (
          <div key={t.customerId + t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 2px', fontSize: 12.5, lineHeight: 1.35 }}>
            <input type="checkbox" checked={false} onChange={() => tickCustomer(t)} title="Done — ticks it off on the customer too" style={{ marginTop: 2, cursor: 'pointer' }} />
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              <span onClick={() => openCustomer(t.customerId)} title={`Open ${t.customerName}`}
                style={{ fontSize: 10.5, fontWeight: 800, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '0 6px', marginRight: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t.customerName}</span>
              {t.text}
            </span>
          </div>
        ))}
        {!open.length && !done.length && !custTodos.length && <div style={{ fontSize: 11.5, color: 'var(--text-light)', padding: '4px 2px' }}>Nothing on the list.</div>}
        {done.map(x => row(x, true))}
      </div>
      {done.length > 0 && (
        <button onClick={() => setItems(l => (Array.isArray(l) ? l : []).filter(x => !x.doneAt))}
          style={{ marginTop: 4, border: 'none', background: 'none', color: '#1a5fa0', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Clear done ({done.length})</button>
      )}
    </div>
  )
}
