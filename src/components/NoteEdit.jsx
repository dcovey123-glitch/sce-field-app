import React, { useState } from 'react'

// Click-to-edit note for a confirmed time entry. Shows the note (or a
// "+ note" prompt); Enter or clicking away saves, Escape cancels.
export default function NoteEdit({ value, onSave, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')

  function start() { setDraft(value || ''); setEditing(true) }
  function commit() {
    setEditing(false)
    const v = draft.trim()
    if (v !== (value || '')) onSave(v)
  }

  if (editing) {
    return (
      <input
        autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        placeholder="Add a note…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: 12, border: '1px solid var(--accent)', borderRadius: 6, fontFamily: 'var(--font)', ...style }}
      />
    )
  }
  return (
    <span
      onClick={e => { e.stopPropagation(); start() }}
      title="Click to edit note"
      style={{ cursor: 'text', fontSize: 12, color: value ? 'var(--text-mid)' : 'var(--text-light)', fontStyle: value ? 'normal' : 'italic', ...style }}
    >
      {value ? `📝 ${value}` : '+ note'}
    </span>
  )
}
