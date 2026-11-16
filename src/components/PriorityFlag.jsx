import React from 'react'
import { norm, nextPriority, PRIORITY_LABEL } from '../api/priority.js'

// The little priority marker in front of a to-do. Click to change:
// Normal → High → Low → Normal. Normal is faint so it stays out of the way.
const LOOK = {
  high: { text: '!', color: '#fff', bg: '#c0392b', border: '#c0392b' },
  '': { text: '•', color: 'var(--text-light)', bg: 'transparent', border: 'var(--border)' },
  low: { text: '↓', color: '#1a5fa0', bg: '#e8f2fc', border: '#c9dbef' },
}

export default function PriorityFlag({ value, onChange, size = 16, disabled }) {
  const p = norm(value)
  const l = LOOK[p]
  return (
    <button type="button" disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange && onChange(nextPriority(p)) }}
      title={`Priority: ${PRIORITY_LABEL[p]} — click to change`}
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 4, padding: 0, lineHeight: 1,
        border: `1px solid ${l.border}`, background: l.bg, color: l.color,
        fontSize: Math.round(size * 0.68), fontWeight: 900, cursor: disabled ? 'default' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{l.text}</button>
  )
}
