import React from 'react'
import { fmtDate } from '../api/format.js'

// ── Flags ──
// A flag is a note pinned to a job or quote (from the Snapshot) that stays
// at the top of it until you mark it done. Every flag is also written into the
// record's notes log, so the history is kept after it's cleared.
//   record.flags = [{ id, text, at, from, context, doneAt? }]

export function openFlags(record) {
  return ((record && record.flags) || []).filter(f => !f.doneAt)
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

// The patch that adds a flag (and its note) to a job or quote.
export function addFlagPatch(record, text, context = '') {
  const at = new Date().toISOString()
  const flag = { id: uid(), text, at, from: 'snapshot', ...(context ? { context } : {}) }
  const note = { id: uid(), timestamp: at, text: `🚩 ${text}${context ? `\n\n(Flagged from Snapshot: ${context})` : ''}`, source: 'flag', flagId: flag.id }
  return { flags: [...((record && record.flags) || []), flag], notesLog: [note, ...((record && record.notesLog) || [])] }
}

export function resolveFlagPatch(record, flagId) {
  return { flags: ((record && record.flags) || []).map(f => f.id === flagId ? { ...f, doneAt: new Date().toISOString() } : f) }
}

const fmt = iso => fmtDate(iso)

export default function FlagBanner({ record, onUpdate, style }) {
  const flags = openFlags(record)
  if (!flags.length) return null
  return (
    <div style={{ margin: '8px 16px', border: '1px solid #e0a716', background: '#fff8e6', borderRadius: 'var(--rs, 8px)', overflow: 'hidden', ...style }}>
      {flags.map((f, i) => (
        <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', borderTop: i ? '1px solid #f1d590' : 'none' }}>
          <span style={{ fontSize: 15, lineHeight: '18px' }}>🚩</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#4a3a0a', fontWeight: 600, whiteSpace: 'pre-wrap' }}>{f.text}</div>
            <div style={{ fontSize: 11, color: '#8a6d1f' }}>Flagged {fmt(f.at)}{f.context ? ` · ${f.context}` : ''}</div>
          </div>
          {onUpdate && (
            <button onClick={() => onUpdate(resolveFlagPatch(record, f.id))}
              style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--rs, 8px)', border: '1px solid #c99a1c', background: '#fff', color: '#6b520f', cursor: 'pointer' }}>
              ✓ Done
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
