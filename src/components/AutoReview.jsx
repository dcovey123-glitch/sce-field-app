import React, { useState } from 'react'
import { automationById } from '../api/automations.js'

// The one banner every "ask first" automation uses: what it wants to change,
// ✓ Apply (all, or one at a time), Skip (not offered again), and its switch
// (Ask / Auto / Off) right there. Nothing is saved until you press Apply.
//   items: [{ key, text, sub? }]
export default function AutoReview({ id, items, onApply, onSkip, mode, onMode, applyLabel = '✓ Apply', compact = false }) {
  const [open, setOpen] = useState(false)
  if (!items || !items.length) return null
  const a = automationById(id) || { name: id, modes: ['ask', 'auto', 'off'] }
  const shown = open ? items : items.slice(0, 3)
  const b = (primary) => ({
    fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
    border: primary ? '1px solid var(--navy)' : '1px solid var(--border)', background: primary ? 'var(--navy)' : '#fff', color: primary ? '#fff' : 'var(--text-mid)',
  })
  return (
    <div style={{ margin: compact ? '6px 0' : '8px 16px', border: '1px solid #e8cf8a', background: '#fffaf0', borderRadius: 'var(--rs, 6px)', padding: '8px 12px', fontSize: 12.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, color: '#8a5d00' }}>⚙ {a.name}</span>
        <span style={{ color: 'var(--text-mid)' }}>— {items.length} change{items.length === 1 ? '' : 's'} waiting for your OK</span>
        <span style={{ flex: 1 }} />
        <button style={b(true)} onClick={() => onApply(items.map(x => x.key))}>{applyLabel}{items.length > 1 ? ` all (${items.length})` : ''}</button>
        <button style={b(false)} onClick={() => onSkip(items.map(x => x.key))} title="Leave things as they are — these won't be offered again">Skip{items.length > 1 ? ' all' : ''}</button>
        {onMode && (
          <select value={mode} onChange={e => onMode(e.target.value)} title="Ask first: shows changes for your OK · Automatic: saves them by itself · Off: you do it by hand"
            style={{ fontSize: 11, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', color: 'var(--text-mid)' }}>
            {a.modes.includes('ask') && <option value="ask">Ask first</option>}
            {a.modes.includes('auto') && <option value="auto">Automatic</option>}
            {a.modes.includes('off') && <option value="off">Off</option>}
          </select>
        )}
      </div>
      {items.length > 0 && (
        <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
          {shown.map(x => (
            <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>{x.text}{x.sub && <span style={{ color: 'var(--text-light)', fontSize: 11.5 }}> · {x.sub}</span>}</span>
              {items.length > 1 && <>
                <button style={{ ...b(false), padding: '2px 8px' }} onClick={() => onApply([x.key])}>✓</button>
                <button style={{ ...b(false), padding: '2px 8px' }} onClick={() => onSkip([x.key])}>Skip</button>
              </>}
            </div>
          ))}
          {items.length > 3 && (
            <a href="#" onClick={e => { e.preventDefault(); setOpen(o => !o) }} style={{ fontSize: 11.5, color: 'var(--blue, #2563eb)' }}>
              {open ? 'Show less' : `Show all ${items.length}`}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
