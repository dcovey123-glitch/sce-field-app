import React, { useState } from 'react'

// Drop-in replacement for a plain "×" delete button — same look, but requires
// a second tap on a small popover before actually deleting anything. Self-
// contained (manages its own confirm state), so it can be swapped in
// anywhere without needing to restructure the surrounding row.
export default function ConfirmDeleteButton({ onConfirm, style, wrapperStyle, ariaLabel = 'Delete', confirmText = 'Delete this? This can\'t be undone.', label = 'Delete', triggerLabel = '×', popoverAlign = 'right' }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, ...wrapperStyle }}>
      <button
        onClick={e => { e.stopPropagation(); setConfirming(true) }}
        style={style}
        aria-label={ariaLabel}
      >
        {triggerLabel}
      </button>
      {confirming && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', [popoverAlign]: 0, marginTop: 4, zIndex: 50,
            background: '#fff', border: '1px solid #c0392b', borderRadius: 8,
            padding: 8, boxShadow: '0 4px 12px rgba(0,0,0,.18)', width: 170,
          }}
        >
          <div style={{ fontSize: 11, color: '#c0392b', marginBottom: 6, fontWeight: 600, lineHeight: 1.3 }}>{confirmText}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setConfirming(false)}
              style={{ flex: 1, fontSize: 11, padding: '5px 6px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              onClick={() => { setConfirming(false); onConfirm() }}
              style={{ flex: 1, fontSize: 11, padding: '5px 6px', border: 'none', borderRadius: 4, background: '#c0392b', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              {label}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
