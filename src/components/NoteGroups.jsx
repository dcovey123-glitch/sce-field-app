import React from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { splitNotes } from '../api/notes.js'

// Job / quote notes in two collapsible groups: yours, and what the assistant
// filed from email. Open/closed is remembered (yours open, assistant closed to start).
export default function NoteGroups({ notes, renderRow, emptyText = 'No notes yet.' }) {
  const [open, setOpen] = useLocalStore('note_groups_open', { manual: true, assistant: false })
  const { manual, assistant } = splitNotes(notes)
  if (!manual.length && !assistant.length) return <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{emptyText}</div>
  const groups = [
    { id: 'manual', title: '✍ Manual Notes', hint: 'Notes you added', L: manual },
    { id: 'assistant', title: '🤖 Assistant Notes', hint: 'Filed from email in Assistant Update', L: assistant },
  ]
  return (
    <div>
      {groups.map(g => {
        const on = !!(open || {})[g.id]
        const needs = g.L.filter(n => n.needsMe && !n.addressedAt).length
        return (
          <div key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
            <div onClick={() => setOpen(x => ({ ...(x || {}), [g.id]: !on }))} title={g.hint}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', cursor: 'pointer', background: 'var(--surface-2)' }}>
              <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{on ? '▾' : '▸'}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{g.title} ({g.L.length})</span>
              {needs > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#8a5d00' }}>⚑ {needs} on Needs you</span>}
              {!on && g.L[0] && <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>latest: {String(g.L[0].text || '').split('\n')[0]}</span>}
            </div>
            {on && (g.L.length ? g.L.map(renderRow) : <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-light)' }}>None.</div>)}
          </div>
        )
      })}
    </div>
  )
}
