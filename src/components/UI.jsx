import { useEffect, useRef } from 'react'
import s from './UI.module.css'

// ── Bottom Sheet ────────────────────────────────────────────────
export function Sheet({ open, onClose, title, children }) {
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Scroll sheet to top every time it opens
  useEffect(() => {
    if (open && ref.current) {
      ref.current.scrollTop = 0
    }
  }, [open, title]) // re-run when title changes (different sheet opened)

  if (!open) return null
  return (
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.sheet} ref={ref}>
        <div className={s.drag} />
        <div className={s.sheetHdr}>
          <span className={s.sheetTitle}>{title}</span>
          <button className={s.sheetClose} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Modal (centered, for detail views on desktop) ───────────────
export function Modal({ open, onClose, title, wide, children }) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={s.modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${s.modal} ${wide ? s.modalWide : ''}`}>
        <div className={s.modalHdr}>
          <span className={s.sheetTitle}>{title}</span>
          <button className={s.sheetClose} onClick={onClose}>×</button>
        </div>
        <div className={s.modalBody}>{children}</div>
      </div>
    </div>
  )
}

// ── Slide-in detail panel ───────────────────────────────────────
export function Detail({ open, onClose, title, actions, children }) {
  if (!open) return null
  return (
    <div className={`${s.detail} ${open ? s.detailOpen : ''}`}>
      <div className={s.detailHdr}>
        <button className={s.detailBack} onClick={onClose}>‹</button>
        <div className={s.detailTitle}>{title}</div>
        <div className={s.detailActions}>{actions}</div>
      </div>
      {children}
    </div>
  )
}

// ── Badge ───────────────────────────────────────────────────────
const BADGE_VARIANTS = {
  green:  { bg: 'var(--green-bg)',   color: 'var(--green-dark)' },
  amber:  { bg: 'var(--accent-bg)',  color: '#9a6610' },
  blue:   { bg: 'var(--blue-bg)',    color: 'var(--blue-dark)' },
  red:    { bg: 'var(--red-bg)',     color: 'var(--red-dark)' },
  purple: { bg: 'var(--purple-bg)',  color: 'var(--purple)' },
  gray:   { bg: 'var(--gray-light)', color: 'var(--text-mid)' },
}
export function Badge({ label, variant = 'gray' }) {
  const v = BADGE_VARIANTS[variant] || BADGE_VARIANTS.gray
  return (
    <span className={s.badge} style={{ background: v.bg, color: v.color }}>
      {label}
    </span>
  )
}

// ── Form elements ───────────────────────────────────────────────
export function FormSection({ title, children }) {
  return (
    <div className={s.fsec}>
      {title && <div className={s.fsecTitle}>{title}</div>}
      {children}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className={s.fg}>
      <label className={s.flbl}>{label}</label>
      {children}
      {hint && <div className={s.fhint}>{hint}</div>}
    </div>
  )
}

export function Input({ ...props }) {
  return <input className={s.fin} {...props} />
}

export function Select({ children, ...props }) {
  return <select className={s.fin} {...props}>{children}</select>
}

export function Textarea({ ...props }) {
  return <textarea className={`${s.fin} ${s.fta}`} {...props} />
}

export function Row({ children, cols = 2 }) {
  return <div className={s.frow} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{children}</div>
}

export function BtnRow({ children }) {
  return <div className={s.brow}>{children}</div>
}

export function Btn({ variant = 'default', children, ...props }) {
  return (
    <button className={`${s.btn} ${variant === 'primary' ? s.btnP : variant === 'danger' ? s.btnD : ''}`} {...props}>
      {children}
    </button>
  )
}

// ── Empty state ─────────────────────────────────────────────────
export function Empty({ children }) {
  return <div className={s.empty}>{children}</div>
}

// ── Section label ───────────────────────────────────────────────
export function SectionLabel({ children, count, action }) {
  return (
    <div className={s.slbl}>
      <span>{children}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {count !== undefined && <span className={s.cnt}>{count}</span>}
        {action}
      </div>
    </div>
  )
}

// ── Sub tabs ────────────────────────────────────────────────────
export function SubTabs({ tabs, active, onChange }) {
  return (
    <div className={s.stabs}>
      {tabs.map(t => (
        <button key={t.value} className={`${s.stab} ${active === t.value ? s.stabActive : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── FAB ─────────────────────────────────────────────────────────
export function FAB({ onClick, label = '+' }) {
  return <button className={s.fab} onClick={onClick}>{label}</button>
}
