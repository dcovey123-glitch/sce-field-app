import React, { useState, useRef, useEffect } from 'react'
import { useFlags, setFlagJump } from '../api/flags.js'

const RED = '#c0392b'
const stop = e => e.stopPropagation()
const when = iso => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const inp = { fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontFamily: 'var(--font)', boxSizing: 'border-box' }
const sbtn = primary => ({ fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 6, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: primary ? RED : 'var(--surface)', color: primary ? '#fff' : 'var(--text-mid)', whiteSpace: 'nowrap' })

// ⚑ on a tile / title bar. Click to flag (with an optional note of what needs
// doing), click again to change the note or mark it done.
export function FlagButton({ refId, info, defaultNote = '', size = 14, label = false }) {
  const { flagOf, flag, unflag } = useFlags()
  const f = flagOf(refId)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const start = e => {
    stop(e); setNote(f ? f.note || '' : defaultNote)
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 330)), top: r.bottom + 230 > window.innerHeight ? Math.max(8, r.top - 150) : r.bottom + 4 })
    setOpen(o => !o)
  }
  const save = () => { flag(refId, info, note.trim()); setOpen(false) }
  return (
    <span ref={box} onClick={stop} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={start} title={f ? `Flagged${f.note ? ': ' + f.note : ''} — click to change or mark done` : 'Flag this — puts it on your ⚑ Flagged list (Notes and Assistant Update)'}
        style={{ background: f ? RED : 'none', color: f ? '#fff' : '#9aa3ad', border: f ? 'none' : '1px solid transparent', borderRadius: 4, cursor: 'pointer', fontSize: size, lineHeight: 1, padding: label ? '3px 8px' : '1px 4px', fontWeight: 700 }}>
        ⚑{label ? (f ? ' Flagged' : ' Flag') : ''}
      </button>
      {open && (
        <div style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 400, width: 320, background: 'var(--surface)', border: `1px solid ${RED}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.18)', padding: 10, cursor: 'default' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: RED, marginBottom: 5 }}>⚑ {f ? 'Flagged' : 'Flag'} — {info.title || 'this'}</div>
          <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="What needs doing? (optional)"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } if (e.key === 'Escape') setOpen(false) }}
            style={{ ...inp, width: '100%', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            {f && <button style={sbtn(false)} onClick={() => { unflag(refId); setOpen(false) }}>✓ Done — unflag</button>}
            <button style={sbtn(false)} onClick={() => setOpen(false)}>Cancel</button>
            <button style={sbtn(true)} onClick={save}>{f ? 'Save' : '⚑ Flag it'}</button>
          </div>
        </div>
      )}
    </span>
  )
}

// The flag's note where the thing itself is sorted (inside the open slip / PO)
export function FlagNote({ refId }) {
  const { flagOf, unflag } = useFlags()
  const f = flagOf(refId)
  if (!f) return null
  return (
    <div onClick={stop} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', padding: '5px 9px', background: '#fdecea', border: `1px solid ${RED}`, borderRadius: 6, fontSize: 12.5, color: '#8e1f14' }}>
      <b>⚑ Flagged {when(f.at)}</b><span style={{ flex: 1 }}>{f.note || '(no note)'}</span>
      <button style={sbtn(false)} onClick={() => unflag(refId)}>✓ Done</button>
    </div>
  )
}

const ICON = { po: '📑', slip: '🧾', email: '📧' }
const KIND = { po: 'PO / quote', slip: 'Slip', email: 'Email' }

function FlagRow({ f, onOpen, setNote, finish }) {
  const [note, setN] = useState(f.note || '')
  useEffect(() => { setN(f.note || '') }, [f.note])
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <span style={{ color: RED, fontSize: 16, lineHeight: '20px' }}>⚑</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
          {ICON[f.kind] || '•'} {f.title || 'Flagged item'}
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', marginLeft: 6 }}>{KIND[f.kind] || ''}{f.sub ? ` · ${f.sub}` : ''}</span>
        </div>
        {f.kind === 'email' && f.text && <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>{f.text}</div>}
        <input value={note} onChange={e => setN(e.target.value)} onBlur={() => note !== (f.note || '') && setNote(f.id, note)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="What needs doing?"
          style={{ ...inp, width: '100%', marginTop: 5, background: note ? '#fdecea' : 'var(--surface)', borderColor: note ? '#e3a49c' : 'var(--border)' }} />
        <div style={{ fontSize: 10.5, color: 'var(--text-light)', marginTop: 3 }}>Flagged {when(f.at)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {onOpen && <button style={sbtn(false)} onClick={() => onOpen(f)}>Open →</button>}
        <button style={{ ...sbtn(false), borderColor: '#1e7a34', color: '#1e7a34' }} onClick={() => finish(f.id)}>✓ Done</button>
      </div>
    </div>
  )
}

// The list: Notes → ⚑ Flagged, and the top of Assistant Update
export function FlaggedList({ navigate, compact = false, emptyText }) {
  const { active, done, setNote, finish, reopen, remove } = useFlags()
  const [showDone, setShowDone] = useState(false)
  const open = f => {
    if (!navigate) return
    if (f.kind === 'email') { navigate({ hub: 'review' }); return }
    setFlagJump(f)
    navigate({ hub: 'materials', view: 'ordered' })
  }
  if (compact && !active.length) return null
  return (
    <div style={{ border: `1px solid ${active.length ? RED : 'var(--border)'}`, borderRadius: 'var(--r, 10px)', overflow: 'hidden', marginBottom: 16, background: 'var(--surface)' }}>
      <div style={{ padding: '9px 14px', background: active.length ? '#fdecea' : 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: active.length ? '#8e1f14' : 'var(--text)' }}>⚑ Flagged ({active.length})</span>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Your to-do-now list — flag any order, PO, slip or email with ⚑. Newest first.</span>
      </div>
      {!active.length && <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-light)' }}>{emptyText || 'Nothing flagged. Use ⚑ on an order, slip or Assistant Update email to put it here.'}</div>}
      {active.map(f => <FlagRow key={f.id} f={f} onOpen={navigate ? open : null} setNote={setNote} finish={finish} />)}
      {!compact && done.length > 0 && (
        <>
          <button onClick={() => setShowDone(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'var(--surface-2)', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: 'var(--text-mid)' }}>
            Done — last 30 days ({done.length}) {showDone ? '▴' : '▾'}
          </button>
          {showDone && done.map(f => (
            <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 14px', borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-mid)' }}>
              <span style={{ color: '#1e7a34', fontWeight: 700 }}>✓</span>
              <span style={{ flex: 1 }}>{ICON[f.kind] || ''} <b>{f.title}</b>{f.note ? ` — ${f.note}` : ''} <span style={{ color: 'var(--text-light)' }}>· done {when(f.doneAt)}</span></span>
              <button style={sbtn(false)} onClick={() => reopen(f.id)}>↺ Flag again</button>
              <button style={sbtn(false)} onClick={() => remove(f.id)}>Remove</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
