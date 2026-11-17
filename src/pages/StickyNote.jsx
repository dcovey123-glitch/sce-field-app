import React, { useEffect, useRef, useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'

// 📝 The sticky note — its own small always-on-top window (electron/main.cjs).
// A yellow icon until clicked; open, it's a note you can type in, with more
// than one page. Drag it anywhere by the icon or the top strip. It floats
// above whichever app window you're using and hides when you leave the app.
// Notes are kept in sticky_notes: [{ id, text, at }].

export const STICKY_KEY = 'sticky_notes'
const uid = () => Math.random().toString(36).slice(2, 10)
const YELLOW = '#fff3a8', EDGE = '#e6cf4a', INK = '#4a3f00'

export default function StickyNote() {
  const [notes, setNotes] = useLocalStore(STICKY_KEY, [])
  const list = Array.isArray(notes) && notes.length ? notes : [{ id: 'first', text: '', at: '' }]
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const cur = list[Math.min(page, list.length - 1)]
  const area = useRef(null)

  // a see-through page, so only the note itself shows
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.body.style.minHeight = '0'
    document.body.style.overflow = 'hidden'
    window.desktop?.stickyGetState?.().then(st => { if (st) setOpen(!!st.open) })
  }, [])
  useEffect(() => { if (open && area.current) area.current.focus() }, [open, page])
  // Make sure this window has the keyboard (Windows can leave it with the main window)
  const takeKeyboard = () => {
    if (document.hasFocus()) return
    window.desktop?.stickyFocus?.().then(() => { if (area.current && document.activeElement !== area.current) area.current.focus() })
  }

  // Drag by hand (a frameless window); a press that doesn't move is a click
  const drag = useRef(null)
  const onDown = e => {
    if (e.button !== 0) return
    drag.current = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = e => {
    const d = drag.current
    if (!d) return
    const dx = e.screenX - d.sx, dy = e.screenY - d.sy
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    d.moved = true
    window.desktop?.stickyMoveTo?.(d.wx + dx, d.wy + dy)
  }
  const onUp = (e, click) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) window.desktop?.stickyDragEnd?.()
    else if (click) click()
  }
  const setOpenNow = async v => { setOpen(v); await window.desktop?.stickySetOpen?.(v) }
  // Resize from the bottom-right grip (the window can't be resized by its edges)
  const size = useRef(null)
  const onGripDown = e => {
    if (e.button !== 0) return
    e.stopPropagation()
    size.current = { sx: e.screenX, sy: e.screenY, w: window.innerWidth, h: window.innerHeight }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onGripMove = e => {
    const r = size.current
    if (!r) return
    window.desktop?.stickyResizeTo?.(r.w + e.screenX - r.sx, r.h + e.screenY - r.sy)
  }
  const onGripUp = () => {
    if (!size.current) return
    size.current = null
    window.desktop?.stickyResizeEnd?.()
  }

  const save = text => setNotes(prev => {
    const base = Array.isArray(prev) && prev.length ? prev : [{ id: 'first', text: '', at: '' }]
    const i = Math.min(page, base.length - 1)
    return base.map((n, k) => k === i ? { ...n, text, at: new Date().toISOString() } : n)
  })
  const addPage = () => { setNotes(prev => [...(Array.isArray(prev) && prev.length ? prev : list), { id: uid(), text: '', at: new Date().toISOString() }]); setPage(list.length) }
  const removePage = () => {
    if (cur.text.trim() && !window.confirm('Delete this note page?')) return
    setNotes(prev => { const base = Array.isArray(prev) ? prev : []; const next = base.filter(n => n.id !== cur.id); return next.length ? next : [{ id: uid(), text: '', at: '' }] })
    setPage(p => Math.max(0, p - 1))
  }
  const filled = list.filter(n => n.text.trim()).length

  if (!open) {
    return (
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={e => onUp(e, () => setOpenNow(true))}
        title="Sticky note — click to open, drag to move"
        style={{ position: 'fixed', inset: 0, borderRadius: 10, background: YELLOW, border: `2px solid ${EDGE}`, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', fontSize: 22, boxShadow: 'inset 0 -6px 0 rgba(0,0,0,.05)' }}>
        📝
        {filled > 0 && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 10, fontWeight: 800, color: INK }}>{filled}</span>}
      </div>
    )
  }

  const btn = { border: 'none', background: 'none', cursor: 'pointer', color: INK, fontSize: 14, fontWeight: 800, padding: '0 4px', lineHeight: 1 }
  return (
    <div onPointerDownCapture={takeKeyboard} style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: YELLOW, border: `2px solid ${EDGE}`, borderRadius: 10, boxSizing: 'border-box', overflow: 'hidden', fontFamily: 'var(--font)' }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={e => onUp(e)}
        title="Drag to move"
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px 5px 10px', background: '#ffe97a', borderBottom: `1px solid ${EDGE}`, cursor: 'grab', userSelect: 'none' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: INK, flex: 1 }}>📝 Sticky note</span>
        <button style={btn} disabled={page <= 0} onPointerDown={e => e.stopPropagation()} onClick={() => setPage(p => Math.max(0, p - 1))} title="Previous page">‹</button>
        <span style={{ fontSize: 11, fontWeight: 700, color: INK, minWidth: 28, textAlign: 'center' }}>{Math.min(page, list.length - 1) + 1}/{list.length}</span>
        <button style={btn} disabled={page >= list.length - 1} onPointerDown={e => e.stopPropagation()} onClick={() => setPage(p => Math.min(list.length - 1, p + 1))} title="Next page">›</button>
        <button style={btn} onPointerDown={e => e.stopPropagation()} onClick={addPage} title="New page">+</button>
        <button style={{ ...btn, fontSize: 12 }} onPointerDown={e => e.stopPropagation()} onClick={removePage} title="Delete this page">🗑</button>
        <button style={{ ...btn, fontSize: 16 }} onPointerDown={e => e.stopPropagation()} onClick={() => setOpenNow(false)} title="Fold up to the icon">–</button>
      </div>
      <textarea ref={area} key={cur.id} defaultValue={cur.text} onChange={e => save(e.target.value)} placeholder="Write anything…"
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', padding: '10px 12px', fontSize: 14, lineHeight: 1.45, color: '#2b2400', fontFamily: 'var(--font)' }} />
      <div style={{ padding: '2px 22px 5px 10px', fontSize: 10, color: '#8a7a2a', textAlign: 'right', minHeight: 12 }}>
        {cur.at ? `saved ${new Date(cur.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
      </div>
      <div onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} title="Drag to resize"
        style={{ position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, cursor: 'nwse-resize', touchAction: 'none',
          background: `linear-gradient(135deg, transparent 50%, ${EDGE} 50%, ${EDGE} 58%, transparent 58%, transparent 70%, ${EDGE} 70%, ${EDGE} 78%, transparent 78%)` }} />
    </div>
  )
}
