import {
  TM_MATERIAL_MARKUP, billingWhen, billingEntries, tmTotal, tmBilledAmount, unbilledAmount, effectiveJobTotal,
  progressBillPatch, tmBillPatch, undoLastBillingPatch,
} from '../api/billing.js'
export { TM_MATERIAL_MARKUP, billingWhen, billingEntries, tmTotal, tmBilledAmount, unbilledAmount, effectiveJobTotal }
import React, { useState, useEffect, useRef } from 'react'
import FlagBanner from '../components/FlagBanner.jsx'
import { quoteMaterialsTotal, quoteLaborTotal, quoteGrandTotal, normalizeQuote, scopeTotal, allowancesTotal, splitLines } from '../api/quoteMath.js'
import { quotePlannedMaterials } from '../api/plannedMaterials.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import FileAttachments, { FileTile } from '../components/FileAttachments.jsx'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import WholesalerExportBar from '../components/WholesalerExportBar.jsx'
import JobTasks from '../components/JobTasks.jsx'
import { missingSlipCharges, addMissingSlipCharges } from '../api/materialsAudit.js'
import { planLineStatus, planSummary, stockFree, findStockFor, addPlanLinesToOrderList, ORDER_LIST_KEY, REQUESTS_KEY as PLAN_REQUESTS_KEY } from '../api/materialPlan.js'
import { useOrdersFeed, partsForJob, openQuotePdf } from '../api/orders.js'
import PostTimeToLabor, { unpostedCount } from '../components/PostTimeToLabor.jsx'
import { jobDeficiencies, openLaborFlags, LABOR_FLAG_KINDS } from '../api/jobHealth.js'
import { closeBlockers, statusPatch } from '../api/jobClose.js'
import SlipLinesForJob from '../components/SlipLinesForJob.jsx'
import { drawFromStock, adjustStockDraw, chargesFullStock, stockLinePrice } from '../api/stockDraw.js'
import { normPo } from '../api/orders.js'
import { partNosOf } from '../api/partAliases.js'
import { slipKind, lineJobsOf, lineUse, lineRemaining, slipEntry, slipLineKey, sameItem, leftoverLinesForJob, closeOutLines, mergeIntoStock, moveQuoteChargesToSlips, moveFeedChargesToSlips, takeFromStock, setSlipLineUse } from '../api/slips.js'
import { hit } from '../api/search.js'
import { todayLocal, monthLocal } from '../api/albertaTime.js'
import NoteGroups from '../components/NoteGroups.jsx'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export const SECTIONS = [
  { id: 'general',   label: 'General Information' },
  { id: 'tasks',     label: 'Tasks' },
  { id: 'labor',     label: 'Labor' },
  { id: 'materials', label: 'Materials' },
  { id: 'quote',     label: 'Quote' },
  { id: 'files',     label: 'Files' },
  { id: 'notes',     label: 'Notes' },
]

// Column widths shared between the project header, rows, and add-row
// so everything lines up: Type | CO# | Project name | Notes
const PROJECT_COLS = '74px 150px minmax(140px, 1fr) minmax(90px, 0.7fr)'

export const TYPE_META = {
  quoted: { bg: 'var(--accent-bg)', color: 'var(--accent-dim)', label: 'Quoted' },
  tm:     { bg: 'var(--blue-bg)',   color: 'var(--blue-dark)',  label: 'T&M' },
  warranty: { bg: '#fdecea', color: '#a12a1e', label: 'Warranty / Deficiency' },
}

// Strong colour cue for the two job types — Quoted (fixed price) vs T&M (billed on hours + materials)
export const TYPE_BAR = { quoted: '#e8a020', tm: '#1a5fa0', warranty: '#b3261e' }
// Short label for list badges
export const TYPE_SHORT = { quoted: 'QUOTED', tm: 'T&M', warranty: 'WARRANTY' }

// ── Shared row bits ──────────────────────────────────────────────
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 16px', background: 'var(--surface)',
  borderBottom: '1px solid var(--border)', cursor: 'pointer',
}
const nestedRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '5px 16px', background: 'var(--surface)',
  borderBottom: '1px solid var(--border)', cursor: 'pointer',
}
const textStyle = { fontSize: 14, fontWeight: 600, color: 'var(--text)', cursor: 'text', minWidth: 0 }
const truncatedTextStyle = { ...textStyle, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const truncatedPlaceholderStyle = { ...truncatedTextStyle, color: 'var(--text-light)', fontWeight: 500 }
const placeholderTextStyle = { ...textStyle, color: 'var(--text-light)', fontWeight: 500 }
const inputStyle = {
  fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 6px',
  outline: 'none', fontFamily: 'var(--font)', width: '100%',
}
const plainInputStyle = {
  fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: 'none', background: 'none', padding: '3px 4px', outline: 'none',
  fontFamily: 'var(--font)', width: '100%',
}
const chevronWrapStyle = {
  color: 'var(--text-light)', display: 'flex', alignItems: 'center', flexShrink: 0,
  transition: 'transform 0.15s',
}
const delBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
  color: 'var(--text-light)', fontSize: 16, lineHeight: 1, flexShrink: 0, width: 22,
}
const colHeaderStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-light)',
  textTransform: 'uppercase',
}

function ChevronDown({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
      <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
      <path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Editable single-value text (click to edit in place)
// A plain <input> that types locally and only commits on blur — see the same
// note in Quotes.jsx. Every field here writes through to real files on disk
// (async), so binding value straight to the store and committing on every
// keystroke lets that round trip land mid-typing and throw the cursor to the end.
function BufferedInput({ value, onCommit, ...inputProps }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  return (
    <input
      title={draft !== '' && draft != null && String(draft).length > 6 ? String(draft) : undefined}
      {...inputProps}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft !== (value ?? '')) onCommit(draft)
      }}
    />
  )
}

function EditableField({ value, placeholder, onSave, textStyleOverride, placeholderStyleOverride }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v !== value) onSave(v)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={inputStyle}
      />
    )
  }
  return (
    <span
      style={value ? (textStyleOverride || textStyle) : (placeholderStyleOverride || placeholderTextStyle)}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      title={value || undefined}
    >
      {value || placeholder}
    </span>
  )
}

// Click the name to toggle open its children, click the pencil to rename
function NameCell({ value, placeholder, onSave, onToggle, suffix }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v !== value) onSave(v)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={inputStyle}
      />
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span
        onClick={e => { e.stopPropagation(); onToggle() }}
        style={{
          ...(value ? textStyle : placeholderTextStyle),
          flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {value || placeholder}
      </span>
      {suffix}
      <button
        onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 2, flexShrink: 0, display: 'flex' }}
        aria-label="Rename project"
      >
        <PencilIcon />
      </button>
    </div>
  )
}

// Quoted / T&M selector — small pill, tap to change without opening the row
function TypeBadge({ value, onChange }) {
  const meta = TYPE_META[value]
  // Once a job has a type it is fixed here — changing it is a deliberate
  // action on the job's General Information page, never an accidental click.
  if (meta) {
    return (
      <span style={{
        fontSize: value === 'warranty' ? 9.5 : 11, fontWeight: 800, borderRadius: 20, padding: '3px 6px', textAlign: 'center', width: '100%',
        boxSizing: 'border-box', background: TYPE_BAR[value], color: '#fff', letterSpacing: value === 'warranty' ? 0 : '.02em',
      }}>
        {TYPE_SHORT[value] || 'QUOTED'}
      </span>
    )
  }
  return (
    <select
      value={value || ''}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
      style={{
        fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 20,
        padding: '3px 6px', outline: 'none', cursor: 'pointer', appearance: 'none',
        WebkitAppearance: 'none', MozAppearance: 'none', textAlign: 'center', width: '100%',
        background: meta ? meta.bg : 'var(--gray-light)',
        color: meta ? meta.color : 'var(--text-light)',
        fontFamily: 'var(--font)',
      }}
    >
      <option value="">Type</option>
      <option value="quoted">Quoted</option>
      <option value="tm">T&amp;M</option>
      <option value="warranty">Warranty / Deficiency</option>
    </select>
  )
}

// ── Add-customer row (single field) ──────────────────────────────
function CollapsedAddRow({ label, indent, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ ...rowStyle, background: 'var(--surface-2)', paddingLeft: indent ? 16 + indent : 16 }}
    >
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0, width: indent ? 16 : 'auto', textAlign: 'center' }}>+</span>
      <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// DEFICIENCIES — shared helpers used by the job page and the Deficiencies window
// ══════════════════════════════════════════════════════════════════
export function daysSince(isoDate) {
  if (!isoDate) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000))
}

export function DeficiencyRow({ item, onUpdate, onDelete }) {
  const age = daysSince(item.createdAt)
  const ageColor = age >= 14 ? 'var(--red)' : age >= 7 ? '#9a6610' : 'var(--text-light)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px 34px', borderBottom: '1px solid var(--border)' }}>
      <input
        type="checkbox" checked={!!item.resolved} onChange={e => onUpdate({ resolved: e.target.checked, resolvedAt: e.target.checked ? new Date().toISOString() : null })}
        style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, color: item.resolved ? 'var(--text-light)' : 'var(--text)',
        textDecoration: item.resolved ? 'line-through' : 'none',
      }}>
        {item.text}
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: item.resolved ? 'var(--text-light)' : ageColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {item.resolved
          ? (item.resolvedAt ? `Resolved after ${daysSince(item.createdAt) - daysSince(item.resolvedAt)}d` : 'Resolved')
          : `${age}d open`}
      </span>
      <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete deficiency" confirmText="Delete this deficiency?" />
    </div>
  )
}

function AddCustomerRow({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')

  function submit() {
    const v = val.trim()
    if (v) onAdd(v)
    setVal('')
    setOpen(false)
  }

  if (!open) {
    return <CollapsedAddRow label="Add customer" onClick={() => setOpen(true)} />
  }

  return (
    <div style={{ ...rowStyle, background: 'var(--surface-2)', cursor: 'default' }}>
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>+</span>
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Add customer"
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setVal(''); setOpen(false) } }}
        onBlur={submit}
        style={{ ...plainInputStyle }}
      />
    </div>
  )
}

// ── Add-project row (CO# / Name / Notes, column-aligned) ────────────
function ProjectAddRow({ onAdd, indent }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('')
  const [co, setCo] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setType(''); setCo(''); setName(''); setNotes('')
  }

  function submit() {
    const n = name.trim()
    if (n) onAdd({ type, co: co.trim(), name: n, notes: notes.trim() })
    reset()
    setOpen(false)
  }

  function handleBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) submit()
  }

  const onKey = e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { reset(); setOpen(false) }
  }

  if (!open) {
    return <CollapsedAddRow label="Add project" indent={indent} onClick={() => setOpen(true)} />
  }

  return (
    <div onBlur={handleBlur} style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16 + indent, background: 'var(--surface-2)' }}>
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0, width: 16, textAlign: 'center' }}>+</span>
      <div style={{ display: 'grid', gridTemplateColumns: PROJECT_COLS, gap: 8, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <TypeBadge value={type} onChange={setType} />
        <input autoFocus value={co} onChange={e => setCo(e.target.value)} placeholder="CO/PO #" onKeyDown={onKey} style={plainInputStyle} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" onKeyDown={onKey} style={plainInputStyle} />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" onKeyDown={onKey} style={{ ...plainInputStyle, color: 'var(--text-mid)' }} />
      </div>
    </div>
  )
}

// ── Column header labels above a customer's project list ────────────
export function ProjectColumnHeader({ indent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 2px', paddingLeft: 16 + indent, background: 'var(--surface-2)' }}>
      <span style={{ width: 38, flexShrink: 0 }} />
      <div style={{ display: 'grid', gridTemplateColumns: PROJECT_COLS, gap: 8, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Type</span>
        <span style={colHeaderStyle}>CO / PO #</span>
        <span style={colHeaderStyle}>Project</span>
        <span style={colHeaderStyle}>Notes</span>
      </div>
      <span style={{ width: 206, flexShrink: 0 }} />
    </div>
  )
}

// ── Section row (leaf — clicking one navigates to a new page) ───────
function SectionRow({ label, onOpen, indent }) {
  return (
    <div style={{ ...nestedRowStyle, paddingLeft: 16 + indent, background: 'var(--surface)' }} onClick={onOpen}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={chevronWrapStyle}><ChevronDown open={false} /></span>
    </div>
  )
}

// ── Project row + its dropped-down section list ─────────────────────
function ModalOverlay({ onClose, children, maxWidth = 380 }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', borderRadius: 'var(--rs)', maxWidth, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
      >
        {children}
      </div>
    </div>
  )
}

const modalBtnStyleJ = (primary, disabled) => ({
  flex: 1, padding: '10px', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13,
  cursor: disabled ? 'default' : 'pointer',
  border: primary ? 'none' : '1px solid var(--border)',
  background: disabled ? 'var(--gray-light)' : primary ? 'var(--accent)' : 'var(--surface)',
  color: disabled ? 'var(--text-light)' : primary ? 'var(--navy)' : 'var(--text)',
})

// Red = not started, Yellow = in progress, Green = completed (moved to the
// Completed list) — clicking toward green opens CompletionModal for confirmation.
const STATUS_CYCLE = ['red', 'yellow', 'blue', 'green']
const STATUS_COLORS = { red: 'var(--red)', yellow: '#e0a716', blue: '#1a5fa0', green: 'var(--green)' }
const STATUS_LABELS = { red: 'Red', yellow: 'Yellow', blue: 'Blue', green: 'Green' }

function StatusDot({ status, onCycle }) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.red
  const label = STATUS_LABELS[status] || STATUS_LABELS.red
  return (
    <button
      onClick={e => { e.stopPropagation(); onCycle() }}
      title={`${label} — click to cycle`}
      aria-label={label}
      style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', padding: 0, flexShrink: 0, cursor: 'pointer', background: color }}
    />
  )
}

// Full confirmation gate before a job moves to Completed — mirrors the Quotes approval modal
function CompletionModal({ project, onConfirm, onClose, onUpdate }) {
  const [jobDone, setJobDone] = useState(false)
  const [billed, setBilled] = useState('unbilled')
  const [orders] = useLocalStore('material_orders', [])
  // same rules as the status dropdown (api/jobClose.js)
  const { laborFlags, leftovers } = closeBlockers(project, orders)
  const canConfirm = jobDone && !laborFlags.length && !leftovers.length

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
          Mark "{project.name || 'this project'}" as Completed?
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-mid)' }}>
          <input type="checkbox" checked={jobDone} onChange={e => setJobDone(e.target.checked)} style={{ marginTop: 2 }} />
          This job is fully complete
        </label>
        <div style={{ display: 'flex', gap: 14, marginBottom: 16, fontSize: 13, color: 'var(--text-mid)' }}>
          <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="radio" checked={billed === 'unbilled'} onChange={() => setBilled('unbilled')} /> Still to bill</label>
          <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="radio" checked={billed === 'billed'} onChange={() => setBilled('billed')} /> Fully billed</label>
        </div>
        {laborFlags.length > 0 && (
          <div style={{ marginBottom: 14, padding: '8px 10px', background: '#fdf3f1', border: '1px solid #e3a49c', borderRadius: 6, fontSize: 12, color: '#7a2a1e' }}>
            <b style={{ color: '#a12a1e' }}>⚑ {laborFlags.length} flagged labor entr{laborFlags.length === 1 ? 'y' : 'ies'}</b> — resolve {laborFlags.length === 1 ? 'it' : 'them'} in Labor before completing:
            {laborFlags.map(e => <div key={e.id} style={{ marginTop: 3 }}>• {e.date || 'undated'} · {e.worker || '—'} — <b>{e.flag.kind}</b>{e.flag.note ? ': ' + e.flag.note : ''}</div>)}
          </div>
        )}
        {leftovers.length > 0 && onUpdate && (
          <div style={{ marginBottom: 14 }}>
            <MaterialCloseout project={project} onUpdate={onUpdate} title="Before completing: close out this job's slip material" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={modalBtnStyleJ(false)} onClick={onClose}>Cancel</button>
          <button style={modalBtnStyleJ(true, !canConfirm)} disabled={!canConfirm} onClick={() => onConfirm(billed)}>Mark Complete</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// Simple reversible confirm — used to move a completed job back to active
function SimpleCompletionConfirm({ project, onConfirm, onClose }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
          Move "{project.name || 'this project'}" back to active jobs?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={modalBtnStyleJ(false)} onClick={onClose}>Cancel</button>
          <button style={modalBtnStyleJ(true)} onClick={onConfirm}>Move back</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// ✓ / ✗ beside a job: caught up on everything, or what's still waiting
function JobHealthMark({ project }) {
  const [orders] = useLocalStore('material_orders', [])
  const [requests] = useLocalStore('material_requests', [])
  const [orderSheet] = useLocalStore('materials_order_list', [])
  const [stock] = useLocalStore('material_stock', [])
  const [usedPending] = useLocalStore('materials_used_pending', [])
  const arr = v => Array.isArray(v) ? v : []
  const issues = jobDeficiencies(project, {
    orders: arr(orders), requests: arr(requests), orderSheet: arr(orderSheet), stock: arr(stock), usedPending: arr(usedPending),
    status: effectiveLifecycleStatus(project), unposted: unpostedCount(project),
  })
  const ok = issues.length === 0
  return (
    <span title={ok ? 'Project current' : `${issues.length} thing${issues.length === 1 ? '' : 's'} not caught up:\n• ${issues.join('\n• ')}`}
      style={{ width: 15, height: 15, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, lineHeight: 1, cursor: 'help',
        background: ok ? '#1e7a34' : '#c0392b', color: '#fff' }}>
      {ok ? '✓' : '✕'}
    </span>
  )
}

export function ProjectBlock({ project, customer, expanded, onToggle, onUpdate, onDelete, onOpenSection, onRequestStatusClick, indent, onClose }) {
  const visibleSections = SECTIONS
  const status = project.status || 'red'
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [showAiReport, setShowAiReport] = useState(false)
  const showValue = project.type === 'quoted' && project.coValue !== undefined && project.coValue !== null && project.coValue !== ''
  const hasLinkedQuote = (project.linkedQuoteIds && project.linkedQuoteIds.length > 0) || !!project.linkedQuoteId
  const linkedIds = project.linkedQuoteIds || (project.linkedQuoteId ? [project.linkedQuoteId] : [])
  const multiQuote = linkedIds.length > 1
  const quoteCOs = project.linkedQuoteCOs || {}
  const allPerQuoteCOsFilled = linkedIds.every(id => quoteCOs[id]?.co && quoteCOs[id]?.coValue !== undefined && quoteCOs[id]?.coValue !== null && quoteCOs[id]?.coValue !== '')
  const missingBits = [
    !project.co && 'CO/PO #',
    !project.dateStart && 'Start date',
    project.type === 'quoted' && !showValue && !project.noCoNeeded && 'CO Value',
    project.type === 'quoted' && !hasLinkedQuote && !project.noQuoteNeeded && 'Linked quote',
    project.type === 'quoted' && !project.coAttachment && !project.noCoNeeded && 'CO not attached',
    project.type === 'quoted' && multiQuote && !allPerQuoteCOsFilled && !project.noCoNeeded && 'CO #/value on one or more linked quotes',
  ].filter(Boolean)
  const missingInfo = missingBits.length > 0
  return (
    <div>
      <div
        onClick={onToggle}
        title={missingInfo ? `Missing: ${missingBits.join(', ')}` : undefined}
        style={{
          ...nestedRowStyle, paddingLeft: 16 + indent,
          background: missingInfo ? '#fff8e6' : (project.type === 'tm' ? '#eef5fc' : project.type === 'quoted' ? '#fffaf0' : project.type === 'warranty' ? '#fdf1ef' : 'var(--surface-2)'),
          boxShadow: TYPE_BAR[project.type] ? `inset 5px 0 0 ${TYPE_BAR[project.type]}` : 'none',
          display: 'grid', alignItems: 'center', columnGap: 8,
          gridTemplateColumns: '38px 74px 150px minmax(140px, 1fr) minmax(90px, 0.7fr) 22px 22px 46px 92px',
        }}
      >
        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <StatusDot
            status={status}
            onCycle={() => onUpdate({ status: STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length] })}
          />
          <JobHealthMark project={project} />
        </span>
        <TypeBadge value={project.type} onChange={v => onUpdate({ type: v })} />
        <span title={project.co || ''} style={{ minWidth: 0, overflow: 'hidden' }}>
          <EditableField
            value={project.co} placeholder="CO/PO #" onSave={v => onUpdate({ co: v })}
            textStyleOverride={{ ...truncatedTextStyle, fontSize: 13 }} placeholderStyleOverride={truncatedPlaceholderStyle}
          />
        </span>
        <NameCell
          value={project.name}
          placeholder="Project name"
          onSave={v => onUpdate({ name: v })}
          onToggle={onToggle}
        />
        <span onClick={e => e.stopPropagation()}>
          <WorkCompletedToggle
            text={project.notes}
            expanded={notesExpanded}
            onToggle={() => setNotesExpanded(x => !x)}
            placeholder="Add note"
          />
        </span>
        <ConfirmDeleteButton
          onConfirm={onDelete} style={{ ...delBtnStyle, justifySelf: 'center' }} ariaLabel="Delete project"
          confirmText={`Delete "${project.name || 'this project'}"? This can't be undone.`}
        />
        <span style={{ ...chevronWrapStyle, justifySelf: 'center' }}><ChevronDown open={expanded} /></span>
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20,
          padding: '3px 6px', whiteSpace: 'nowrap', flexShrink: 0, justifySelf: 'center', textAlign: 'center',
        }}>
          {Number(project.progress) || 0}%
        </span>
        {effectiveJobTotal(project) > 0 ? (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
              {money(unbilledAmount(project))}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>of {money(effectiveJobTotal(project))}</span>
          </span>
        ) : <span />}
      </div>
      {notesExpanded && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ padding: '4px 16px 12px', paddingLeft: 16 + indent + 16, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}
        >
          <BufferedTextarea
            autoFocus
            value={project.notes}
            onCommit={v => onUpdate({ notes: v })}
            placeholder="Quick notes — nothing timestamped or logged, just a scratchpad for this job"
            rows={4}
            style={workTextareaStyle}
          />
        </div>
      )}
      {expanded && (
        <div>
          <div style={{ padding: `10px ${indent + 18}px 4px 16px`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LifecycleStatusDropdown project={project} onUpdate={onUpdate} />
            {customer && (
              <button
                onClick={() => setShowAiReport(true)}
                style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '7px 14px', cursor: 'pointer' }}
              >
                📄 AI Report (Summary + PDF)
              </button>
            )}
          </div>
          {visibleSections.map(s => (
            <SectionRow key={s.id} label={s.id === 'tasks' && (project.tasks || []).length ? `Tasks — ${(project.tasks || []).filter(t => !t.done).length} to do, ${(project.tasks || []).filter(t => t.done).length} done` : s.label} indent={indent + 18} onOpen={() => onOpenSection(s.id)} />
          ))}
          {showAiReport && customer && (
            <CustomerSummaryModal project={project} customer={customer} onClose={() => setShowAiReport(false)} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Customer row + its dropped-down project list ───────────────────
function CustomerBlock({ customer, projects, expanded, onToggle, onRename, onEdit,
                          onAddProject, onUpdateProject, onDeleteProject,
                          expandedProjectId, onToggleProject, onOpenSection, onRequestStatusClick }) {
  const valuedProjects = projects.filter(p => effectiveJobTotal(p) > 0)
  const totalValue = valuedProjects.reduce((s, p) => s + effectiveJobTotal(p), 0)
  const totalUnbilled = valuedProjects.reduce((s, p) => s + unbilledAmount(p), 0)

  return (
    <div>
      <div style={rowStyle} onClick={onToggle}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <NameCell value={customer.name} placeholder="Customer name" onSave={onRename} onToggle={onToggle} />
        </span>
        {totalValue > 0 && (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0, flexShrink: 0, marginRight: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}>{money(totalUnbilled)}</span>
            <span style={{ fontSize: 9, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>of {money(totalValue)}</span>
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 11, fontWeight: 700, padding: '4px 8px', flexShrink: 0 }}
        >
          Edit
        </button>
      </div>
      {expanded && (
        <div>
          {projects.length > 0 && <ProjectColumnHeader indent={18} />}
          {projects.length === 0 && (
            <div style={{ padding: '8px 16px 8px 34px', color: 'var(--text-light)', fontSize: 13, background: 'var(--surface-2)' }}>
              No projects yet — add one below.
            </div>
          )}
          {projects.map(p => (
            <ProjectBlock
              key={p.id}
              project={p}
              customer={customer}
              indent={18}
              expanded={expandedProjectId === p.id}
              onToggle={() => onToggleProject(p.id)}
              onUpdate={patch => onUpdateProject(p.id, patch)}
              onDelete={() => onDeleteProject(p.id)}
              onOpenSection={sectionId => onOpenSection(p.id, sectionId)}
              onRequestStatusClick={onRequestStatusClick}
            />
          ))}
          <ProjectAddRow indent={18} onAdd={data => onAddProject(data)} />
        </div>
      )}
    </div>
  )
}

// ── General Information form bits ───────────────────────────────
const fieldRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
}
const fieldLabelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', flexShrink: 0 }
const dateInputStyle = {
  fontSize: 13, fontWeight: 600, color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)', background: 'var(--surface)',
}
const sectionGroupLabelStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)',
  textTransform: 'uppercase', padding: '14px 16px 4px', background: 'var(--surface-2)',
}

function FieldRow({ label, children }) {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </div>
  )
}

function DateField({ value, onChange }) {
  return (
    <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={dateInputStyle} />
  )
}

function ProgressSlider({ value, onChange, color }) {
  const v = value || 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, maxWidth: 220 }}>
      <input
        type="range" min={0} max={100} step={5} value={v}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: color || 'var(--accent)' }}
      />
      <span style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text)', width: 34, textAlign: 'right', flexShrink: 0 }}>{v}%</span>
    </div>
  )
}

// Editable currency amount — click to edit, shown in a given color
function EditableCurrency({ value, onSave, color }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  function commit() {
    setEditing(false)
    const num = parseFloat(draft)
    const v = isNaN(num) ? 0 : num
    if (v !== value) onSave(v)
    else setDraft(String(value ?? 0))
  }

  if (editing) {
    return (
      <input
        autoFocus type="number" inputMode="decimal"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(String(value ?? 0)); setEditing(false) }
        }}
        style={{ ...inputStyle, width: 90, color, fontWeight: 700 }}
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(String(value ?? 0)); setEditing(true) }}
      style={{ cursor: 'text', fontWeight: 700, color, fontSize: 14 }}
    >
      ${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

function CostCompareRow({ label, quoted, actual, onSaveQuoted, isQuoted }) {
  const actualFmt = (actual || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {isQuoted ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <EditableCurrency value={quoted} onSave={onSaveQuoted} color="var(--blue)" />
          <span style={{ color: 'var(--text-light)', fontSize: 13 }}>/</span>
          <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 14 }}>${actualFmt}</span>
        </div>
      ) : (
        <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 14 }}>${actualFmt}</span>
      )}
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  // "2026-08-31" is a local day — read it as noon so it doesn't slip a day in Alberta
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Bills up to the current Progress %, accounting for what's already been billed
function TypeBanner({ project }) {
  if (project.type === 'warranty') {
    return (
      <div style={{ padding: '9px 16px', background: '#fbe3e0', color: '#7d1d14', borderBottom: `3px solid ${TYPE_BAR.warranty}`, fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>
        WARRANTY / DEFICIENCY — our cost, not billed. Log the hours and materials so you know what it cost.
      </div>
    )
  }
  if (project.type !== 'quoted' && project.type !== 'tm') return null
  const tm = project.type === 'tm'
  return (
    <div style={{
      padding: '9px 16px', background: tm ? '#dbe9fb' : '#fdf0d5', color: tm ? '#12457a' : '#7a4f00',
      borderBottom: `3px solid ${TYPE_BAR[project.type]}`, fontSize: 12, fontWeight: 700, letterSpacing: '.02em',
    }}>
      {tm
        ? 'T&M JOB — billed on hours + materials, invoiced monthly or at the end of the job'
        : 'QUOTED JOB — fixed price, billed by progress against the job value'}
    </div>
  )
}

// Changing a job between Quoted and T&M changes how it is totalled and billed,
// so it is a deliberate, confirmed action rather than a stray click on a list.
const TYPE_EXPLAIN = {
  tm: 'Its total will come from the hours and materials entered instead of a fixed job value, and billing will be by amount to date.',
  quoted: 'Its total will come from the Job / CO value, and billing will be by progress percentage.',
  warranty: 'It becomes our cost — hours and materials are still logged, but nothing is billed and it drops out of what is left to bill.',
}
const TYPE_NAME = { quoted: 'Quoted', tm: 'T&M', warranty: 'Warranty / Deficiency' }

function JobTypeRow({ project, onUpdate }) {
  const [confirming, setConfirming] = useState(null) // the type being switched to
  const current = project.type
  const others = ['quoted', 'tm', 'warranty'].filter(t => t !== current)
  const billed = current === 'tm' ? tmBilledAmount(project) > 0 : (Number(project.billedProgress) || 0) > 0
  const pill = t => ({ fontSize: 11, fontWeight: 700, background: TYPE_META[t].bg, color: TYPE_META[t].color, border: 'none', borderRadius: 20, padding: '4px 10px', cursor: 'pointer' })
  return (
    <>
      <FieldRow label="Job type">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: TYPE_BAR[current] || 'var(--text-light)', borderRadius: 20, padding: '3px 10px' }}>
            {TYPE_NAME[current] || 'Not set'}
          </span>
          {current ? (
            confirming === null && (
              <button
                onClick={() => setConfirming('')}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}
              >
                Change…
              </button>
            )
          ) : (
            others.map(t => <button key={t} onClick={() => onUpdate({ type: t })} style={pill(t)}>{TYPE_NAME[t]}</button>)
          )}
        </span>
      </FieldRow>
      {confirming === '' && (
        <div style={{ margin: '0 16px 10px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-mid)', fontWeight: 600 }}>Switch to:</span>
          {others.map(t => <button key={t} onClick={() => setConfirming(t)} style={pill(t)}>{TYPE_NAME[t]}</button>)}
          <button onClick={() => setConfirming(null)} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {confirming && (
        <div style={{ margin: '0 16px 10px', border: '1px solid var(--red)', borderRadius: 'var(--rs)', padding: 12, background: 'var(--red-bg)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-dark)', marginBottom: 4 }}>
            Switch this job to {TYPE_NAME[confirming]}?
          </div>
          <div style={{ fontSize: 12, color: 'var(--red-dark)', marginBottom: 10 }}>
            {TYPE_EXPLAIN[confirming]}
            {billed ? (confirming === 'warranty' ? ' It already has invoices recorded — use Undo last billing first if those were never really sent.' : ' It has already been invoiced, so check the billed amounts afterwards.') : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirming(null)} style={{ flex: 1, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { onUpdate({ type: confirming }); setConfirming(null) }} style={{ flex: 1, padding: 8, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Switch to {TYPE_NAME[confirming]}</button>
          </div>
        </div>
      )}
    </>
  )
}

// When an invoice is being recorded late (it actually went out in an earlier
// month), this gives the date to file it under: the last day of that month.
// No month → today, as before.

// "Invoiced on…" — record the invoice under the month it really went out,
// instead of this month. Opens a month/year picker.
function InvoicedOnButton({ label, onPick, defaultMonth }) {
  const [open, setOpen] = useState(false)
  const thisMonth = monthLocal()
  const [month, setMonth] = useState(defaultMonth && defaultMonth <= thisMonth ? defaultMonth : thisMonth)
  const btn = { fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 'var(--rs)', cursor: 'pointer', whiteSpace: 'nowrap' }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Already invoiced in an earlier month? Pick the month so it files there, not this month."
        style={{ ...btn, color: 'var(--green)', background: 'var(--surface)', border: '1px solid var(--green)' }}>
        Invoiced on…
      </button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-mid)' }}>Invoiced in</span>
      <input type="month" value={month} max={thisMonth} onChange={e => setMonth(e.target.value)}
        style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)' }} />
      <button onClick={() => { if (month) { onPick(month); setOpen(false) } }} disabled={!month}
        style={{ ...btn, color: '#fff', background: 'var(--green)', border: 'none' }}>
        {label}
      </button>
      <button onClick={() => setOpen(false)} style={{ ...btn, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)' }}>Cancel</button>
    </span>
  )
}

// The job's billing record, oldest first, each with the % it was billed from.
// billingHistory is the one true record (the Billing screen reads and edits it).

function BillingList({ entries, tm }) {
  if (!entries.length) return null
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {entries.slice().reverse().map(e => (
        <div key={e.id || e._i} style={{ fontSize: 11, color: 'var(--text-light)' }}>
          {formatDate(e.date)} — {tm ? `sent for billing ${money(e.amount)}` : `billed ${e.fromPercent}% → ${e.percent}%${e.amount ? ` · ${money(e.amount)}` : ''}`}
        </div>
      ))}
    </div>
  )
}

function BillTM({ project, onBill, onUndoLast }) {
  const rates = getLaborRates(project)
  const lt = laborTotals(project.laborEntries || [], rates)
  const labor = Number(project.actualLabor) || 0
  const mats = Number(project.actualMaterials) || 0
  const markup = Math.round(mats * TM_MATERIAL_MARKUP * 100) / 100
  const total = tmTotal(project)
  const billed = tmBilledAmount(project)
  const owing = unbilledAmount(project)
  const canBill = owing > 0.004
  const log = billingEntries(project)
  const line = { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mid)', padding: '2px 0' }
  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={line}><span>Labor — {lt.hours} hr at charge-out rates</span><span>{money(labor)}</span></div>
        <div style={line}><span>Materials (cost)</span><span>{money(mats)}</span></div>
        <div style={line}><span>Materials markup ({Math.round(TM_MATERIAL_MARKUP * 100)}%)</span><span>{money(markup)}</span></div>
        <div style={{ ...line, fontWeight: 800, color: 'var(--text)', fontSize: 13, borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 5 }}><span>T&M total to date</span><span>{money(total)}</span></div>
        <div style={line}><span>Already sent for billing</span><span>{money(billed)}</span></div>
        <div style={{ ...line, fontWeight: 800, color: 'var(--blue)', fontSize: 13 }}><span>Un-billed</span><span>{money(owing)}</span></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        {log.length > 0 && (
          <ConfirmDeleteButton
            onConfirm={onUndoLast} triggerLabel="Undo last billing" ariaLabel="Undo last billing"
            confirmText="Undo the most recent billing entry? The amount goes back to un-billed so you can send it again."
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }}
          />
        )}
        {canBill && <InvoicedOnButton label={`Save — ${money(owing)}`} defaultMonth={(project.dateComplete || '').slice(0, 7)} onPick={m => onBill(m)} />}
        <button
          onClick={() => canBill && onBill()} disabled={!canBill}
          style={{
            padding: '6px 14px', borderRadius: 'var(--rs)', border: 'none', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            cursor: canBill ? 'pointer' : 'default', background: canBill ? 'var(--green)' : 'var(--gray-light)', color: canBill ? '#fff' : 'var(--text-light)',
          }}
        >
          {canBill ? `Sent for billing — ${money(owing)}` : total > 0 ? 'Up to date' : 'Add hours or materials to bill'}
        </button>
      </div>
      <BillingList entries={log} tm />
    </div>
  )
}

function BillToProgress({ progress, jobValue, billedProgress, entries, onBill, onUndoLast, dateComplete }) {
  const current = progress || 0
  const billed = billedProgress || 0
  const delta = Math.max(0, current - billed)
  const canBill = delta > 0
  const value = Number(jobValue) || 0
  const amount = value * (delta / 100)
  const unbilled = value * (1 - billed / 100)
  const isFullyBilled = value > 0 && billed >= 100
  const hasHistory = entries.length > 0

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      {value > 0 && (
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)' }}>Un-billed</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
            {money(unbilled)} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-light)' }}>of {money(value)}</span>
          </span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)' }}>
          Billed to date: <strong style={{ color: 'var(--text)' }}>{billed}%</strong>
          {progress > billed && (
            <span style={{ color: 'var(--text-light)', fontWeight: 500 }}> · progress at {current}%</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasHistory && (
            <ConfirmDeleteButton
              onConfirm={onUndoLast} triggerLabel="Undo last billing" ariaLabel="Undo last billing"
              confirmText="Undo the most recent billing entry? This reopens Billing Complete if it was locked, so you can re-bill correctly."
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }}
            />
          )}
          {isFullyBilled ? (
            <span style={{ padding: '6px 14px', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 700, color: 'var(--text-light)', background: 'var(--surface-2)' }}>
              Billing Complete
            </span>
          ) : (
            <>
            {canBill && <InvoicedOnButton label={`Save — to ${current}%${value > 0 ? ` · ${money(amount)}` : ''}`} defaultMonth={(dateComplete || '').slice(0, 7)} onPick={m => onBill(current, amount, m)} />}
            <button
              onClick={() => canBill && onBill(current, amount)}
              disabled={!canBill}
              style={{
                padding: '6px 14px', borderRadius: 'var(--rs)', border: 'none', fontSize: 12, fontWeight: 700,
                cursor: canBill ? 'pointer' : 'default', whiteSpace: 'nowrap',
                background: canBill ? 'var(--green)' : 'var(--gray-light)',
                color: canBill ? '#fff' : 'var(--text-light)',
              }}
            >
              {canBill ? `Sent for billing — to ${current}%${value > 0 ? ` · ${money(amount)}` : ''}` : 'Up to date'}
            </button>
            </>
          )}
        </div>
      </div>
      {value <= 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#9a6610' }}>
          Set a job value below to have this work out the dollar amount to send for billing.
        </div>
      )}
      <BillingList entries={entries} />
    </div>
  )
}

async function fileToBase64Job(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function parseCoDocument(base64, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text: 'This is a Change Order (CO) or Purchase Order (PO) document. Extract the CO/PO number, the total dollar value as printed (read the actual printed number, do not calculate it), and the date on the document (YYYY-MM-DD) if shown. Respond with ONLY raw JSON, no markdown fences, no explanation, in this exact shape: {"coNumber":"","coValue":0,"coDate":""}',
          },
        ],
      }],
    }),
  })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try {
      const errBody = await res.json()
      if (errBody?.error?.message) detail = errBody.error.message
    } catch { /* ignore — use the status-based message */ }
    throw new Error(detail)
  }
  const data = await res.json()
  if (data.stop_reason === 'max_tokens') {
    throw new Error('This document is too long to read in one go.')
  }
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text)
  if (textBlocks.length === 0) throw new Error('The response had no text content to parse.')
  const cleaned = textBlocks.join('').replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Could not read the parsed result as JSON.')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (e) {
    throw new Error(`Could not read the parsed result as JSON (${e.message})`)
  }
}

// The actual attached CO document, if any, is the source of truth for CO Value —
// manual entry is only allowed while nothing's attached. Uploading checks the
// parsed value against whatever's already there and flags a mismatch before
// committing, rather than silently overwriting it.
function CoRow({ project, customer, onUpdate }) {
  const [apiKey] = useLocalStore('anthropic_api_key', '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null) // { coNumber, coValue, coDate, fileName, base64, existingValue }
  const inputRef = useRef(null)
  const attachment = project.coAttachment

  async function commitAttachment(parsed) {
    let filePath = null
    if (window.desktop && customer?.folder && project?.folder) {
      try {
        const safe = s => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
        const fileName = `CO - ${safe(parsed.coNumber) || 'Attached'} - ${safe(parsed.fileName)}`
        filePath = await window.desktop.saveFile(`Jobs/${customer.folder}/${project.folder}/Files`, fileName, parsed.base64)
      } catch { /* filing a copy failing shouldn't block attaching the value itself */ }
    }
    onUpdate({
      coAttachment: { fileName: parsed.fileName, filePath, coNumber: parsed.coNumber, coValue: parsed.coValue, coDate: parsed.coDate },
      coValue: parsed.coValue,
    })
    setConflict(null)
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!apiKey) { setError('Add your Anthropic API key first — in Materials → Settings.'); if (inputRef.current) inputRef.current.value = ''; return }
    setBusy(true); setError('')
    try {
      const base64 = await fileToBase64Job(file)
      const parsed = await parseCoDocument(base64, apiKey)
      const existingValue = project.coValue
      const hasExisting = existingValue !== undefined && existingValue !== null && existingValue !== ''
      const payload = { ...parsed, fileName: file.name, base64 }
      if (hasExisting && Number(existingValue) !== Number(parsed.coValue)) {
        setConflict({ ...payload, existingValue })
      } else {
        await commitAttachment(payload)
      }
    } catch (err) {
      setError(err.message || 'Could not read this document.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function removeAttachment() {
    onUpdate({ coAttachment: null })
  }

  return (
    <div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>CO / PO #</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
          <EditableField value={project.co} placeholder="CO/PO #" onSave={v => onUpdate({ co: v })} />
        </div>
      </div>

      {project.type === 'quoted' && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          {attachment ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <FileTile
                file={{ name: attachment.fileName, path: attachment.filePath }}
                onOpen={() => attachment.filePath && window.desktop.openFile(attachment.filePath)}
                onRemove={removeAttachment}
              />
              <div style={{ minWidth: 0, paddingTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                  CO Value: <span style={{ color: 'var(--blue)' }}>{money(attachment.coValue)}</span>
                </div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.03em', display: 'inline-block', marginTop: 3 }}>
                  From attached CO
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
                  {attachment.coNumber ? `CO #${attachment.coNumber} · ` : ''}{attachment.coDate || ''}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>CO Value:</span>
                  <EditableCurrency value={project.coValue} onSave={v => onUpdate({ coValue: v })} color="var(--blue)" />
                </span>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? 'Reading…' : '+ Attach CO document'}
                  <input ref={inputRef} type="file" accept="application/pdf" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
                </label>
              </div>
              {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--text-light)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!project.noCoNeeded} onChange={e => onUpdate({ noCoNeeded: e.target.checked })} />
                No CO to attach for this job
              </label>
            </div>
          )}

          {conflict && (
            <div style={{ marginTop: 10, padding: 10, background: '#fff8e6', border: '1px solid var(--accent)', borderRadius: 'var(--rs)' }}>
              <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>
                This document shows <strong>{money(conflict.coValue)}</strong>, but the manual entry here was <strong>{money(conflict.existingValue)}</strong>. Use the attached document's value?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConflict(null)} style={{ flex: 1, padding: '7px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Cancel — keep manual
                </button>
                <button onClick={() => commitAttachment(conflict)} style={{ flex: 1, padding: '7px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', color: 'var(--navy)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Use {money(conflict.coValue)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RateRow({ rate, onUpdate, onDelete }) {
  return (
    <div style={fieldRowStyle}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <EditableField value={rate.label} placeholder="Rate name" onSave={v => onUpdate({ label: v })} />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <EditableCurrency value={rate.rate} onSave={v => onUpdate({ rate: v })} color="var(--text)" />
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>/hr</span>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete rate" confirmText="Delete this rate tier?" />
      </div>
    </div>
  )
}

function RateAddRow({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('')

  function reset() { setLabel(''); setRate('') }
  function submit() {
    const l = label.trim()
    if (l) onAdd({ label: l, rate: rate ? Number(rate) : 0 })
    reset()
    setOpen(false)
  }
  function handleBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) submit()
  }
  const onKey = e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { reset(); setOpen(false) }
  }

  if (!open) {
    return (
      <div onClick={() => setOpen(true)} style={{ ...fieldRowStyle, cursor: 'pointer', background: 'var(--surface-2)' }}>
        <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700 }}>+</span>
        <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 500 }}>Add rate</span>
      </div>
    )
  }

  return (
    <div onBlur={handleBlur} style={{ ...fieldRowStyle, background: 'var(--surface-2)' }}>
      <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Rate name" onKeyDown={onKey}
        style={{ ...plainInputStyle, flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>$</span>
        <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder="0.00" onKeyDown={onKey}
          style={{ ...plainInputStyle, width: 70, textAlign: 'right' }} />
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>/hr</span>
      </div>
    </div>
  )
}

// Shows either "this job is related to X" (if it's a sub-job) or the reverse
// list of sub-jobs related to this one — mounts its own light jobs-hub
// instance just to look these up, same pattern used elsewhere in this file.
function RelatedJobBanner({ project, navigate }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  if (jobsHub.loading) return null

  function goTo(id) {
    const p = jobsHub.records.find(x => x.id === id)
    if (!p) return
    const cust = jobsHub.customers.find(c => c.id === p.customerId)
    navigate({ hub: 'jobs', view: 'section', customerId: cust?.id, projectId: p.id, section: 'general' })
  }

  if (project.relatedJobId) {
    const parent = jobsHub.records.find(p => p.id === project.relatedJobId && !p.trashedAt)
    if (!parent) return null
    return (
      <div style={{ margin: '12px 16px 0', padding: '8px 12px', background: '#e8f2fc', borderRadius: 'var(--rs)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#1a5fa0' }}>Related to job:</span>
        <button onClick={() => goTo(parent.id)} style={{ fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {parent.name} →
        </button>
      </div>
    )
  }

  const subJobs = jobsHub.records.filter(p => p.relatedJobId === project.id && !p.trashedAt)
  if (subJobs.length === 0) return null
  return (
    <div style={{ margin: '12px 16px 0', padding: '8px 12px', background: '#e8f2fc', borderRadius: 'var(--rs)', fontSize: 12 }}>
      <span style={{ color: '#1a5fa0' }}>Related sub-jobs:</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {subJobs.map(sj => (
          <button key={sj.id} onClick={() => goTo(sj.id)} style={{ fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {sj.name} →
          </button>
        ))}
      </div>
    </div>
  )
}

// Moves a job to a different customer entirely — physically relocates its
// folder and files, not just a reference. Confirms first since it's a real
// move, then follows the job to its new location.
function MoveToCustomerButton({ project, navigate }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState('')

  if (jobsHub.loading) return null

  const currentCustomer = jobsHub.customers.find(c => c.id === project.customerId)
  const q = query.trim().toLowerCase()
  const matches = q ? jobsHub.customers.filter(c =>
    c.id !== project.customerId && !c.trashedAt && hit(c.name, q)
  ).slice(0, 8) : []

  async function confirmMove(newCustomer) {
    setMoving(true); setError('')
    const result = await jobsHub.moveRecordToCustomer(project.id, newCustomer.id)
    setMoving(false)
    if (!result.ok) { setError(result.error); return }
    setPicking(false); setConfirming(null); setQuery('')
    navigate({ hub: 'jobs', view: 'section', customerId: newCustomer.id, projectId: project.id, section: 'general' })
  }

  return (
    <div style={{ margin: '12px 16px 0' }}>
      {!picking ? (
        <button
          onClick={() => setPicking(true)}
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', background: 'var(--surface-2)', border: 'none', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}
        >
          Move to a different customer
        </button>
      ) : (
        <div style={{ position: 'relative', maxWidth: 320 }}>
          <input
            autoFocus value={query} onChange={e => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => { if (!confirming) setPicking(false) }, 150)}
            placeholder={`Search customers (currently ${currentCustomer?.name || 'unknown'})…`}
            style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font)', boxSizing: 'border-box' }}
          />
          {matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 20,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
              {matches.map(c => (
                <div key={c.id} onMouseDown={() => setConfirming(c)} style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirming && (
        <div style={{ marginTop: 10, padding: 12, background: '#e8f2fc', border: '1px solid #1a5fa0', borderRadius: 'var(--rs)', maxWidth: 320 }}>
          <div style={{ fontSize: 12, color: '#1a5fa0', marginBottom: 8 }}>
            Move "{project.name}" from {currentCustomer?.name || 'this customer'} to <strong>{confirming.name}</strong>? Its files move with it.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirming(null)} disabled={moving} style={{ flex: 1, padding: 7, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => confirmMove(confirming)} disabled={moving} style={{ flex: 1, padding: 7, background: '#1a5fa0', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {moving ? 'Moving…' : 'Move it'}
            </button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// quoteInfo (Quoted jobs only): what was quoted, so the summary is written
// against the agreed scope. See quotedJobInfo() below.
export async function generateWorkSummary(project, apiKey, quoteInfo = null) {
  const entries = project.laborEntries || []
  const workLines = entries
    .filter(e => (e.workCompleted || '').trim())
    .map(e => `${e.date || 'undated'}: ${e.workCompleted.trim()}`)
  const noteLines = (project.notesLog || []).map(n => `${new Date(n.timestamp).toLocaleDateString()}: ${n.text}`)
  const materialLines = (project.materialEntries || []).map(m => `${m.qty || 0} ${m.uom || ''} ${m.item || 'material'}`.trim())

  const context = [
    `Job: ${project.name || 'Untitled job'}${project.co ? ` (CO ${project.co})` : ''}`,
    workLines.length ? `Work log entries:\n${workLines.join('\n')}` : '',
    noteLines.length ? `Job notes:\n${noteLines.join('\n')}` : '',
    materialLines.length ? `Materials used:\n${materialLines.join('\n')}` : '',
    quoteInfo && quoteInfo.scopeText ? `Quoted scope of work (this is a fixed-price job):\n${quoteInfo.scopeText}` : '',
  ].filter(Boolean).join('\n\n')

  const hasQuoteScope = !!(quoteInfo && quoteInfo.scopeText)
  if (!context.trim() || (!workLines.length && !noteLines.length && !hasQuoteScope)) {
    return 'Work was completed on this job as scoped. See the materials and labor details below for a full breakdown.'
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: hasQuoteScope
          ? `This electrical contracting job was done for a fixed, quoted price. Using the quoted scope and the internal job records below, write a short, professional summary of the work performed for the customer — the kind that would go in a document sent directly to them. 2-4 sentences, plain and clear, no bullet points, no headers, no markdown formatting. Describe the work in terms of the quoted scope, in a way a homeowner or business owner (not an electrician) would understand. Only say work was completed if the work log or notes support it; if the records only cover part of the scope, describe what was done without claiming the rest is finished. Don't mention prices, internal notes, worker names, or anything not appropriate to share with a customer. Don't invent details.\n\n${context}`
          : `Based on the following internal job records for an electrical contracting job, write a short, professional summary of the work performed — the kind that would go in a document sent directly to the customer. 2-4 sentences, plain and clear, no bullet points, no headers, no markdown formatting. Describe what was done in a way a homeowner or business owner (not an electrician) would understand. Don't mention internal notes, worker names, or anything not appropriate to share with a customer. Don't invent details that aren't supported by the records below — stick to what's actually described.\n\n${context}`,
      }],
    }),
  })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try {
      const errBody = await res.json()
      if (errBody?.error?.message) detail = errBody.error.message
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  return text || 'Work was completed on this job as scoped. See the materials and labor details below for a full breakdown.'
}

export async function generateDailySummaries(project, apiKey) {
  const entries = (project.laborEntries || []).filter(e => (e.workCompleted || '').trim())
  if (!entries.length) return {}
  const list = entries.map(e => `${e.id}|${e.date || 'undated'}|${e.workCompleted.trim()}`).join('\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Below are labor entries from an electrical job, one per line as id|date|what was done. For EACH entry write one short, customer-friendly sentence (max ~25 words) saying what was done that day, based only on that entry. No worker names, no invented details, no markdown. Reply with ONLY a JSON object mapping each id to its sentence.\n\n${list}`,
      }],
    }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('bad daily summary format')
  return JSON.parse(m[0])
}

export function CustomerSummaryModal(props) {
  return props.project.type === 'quoted' ? <QuotedSummaryModal {...props} /> : <TMSummaryModal {...props} />
}

function TMSummaryModal({ project, customer, onClose }) {
  const [apiKey] = useLocalStore('anthropic_api_key', '')
  const [stage, setStage] = useState('generating') // generating | ready | error
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [daily, setDaily] = useState({})
  const isTM = project.type === 'tm'

  const materials = (project.materialEntries || []).map(m => ({
    ...m, markedUpPrice: (Number(m.price) || 0) * 1.15,
  }))
  const materialsTotal = materials.reduce((s, m) => s + (Number(m.qty) || 0) * m.markedUpPrice, 0)

  const rates = getLaborRates(project)
  const laborEntries = (project.laborEntries || []).map(e => ({
    ...e, rateLabel: rates.find(r => r.id === e.rateId)?.label || 'Labor', rateAmount: rates.find(r => r.id === e.rateId)?.rate || 0,
  }))
  const laborTotal = laborEntries.reduce((s, e) => s + (Number(e.hours) || 0) * e.rateAmount, 0)
  const grandTotal = materialsTotal + laborTotal

  useEffect(() => {
    if (!apiKey) {
      setError('Set an Anthropic API key in Materials → Settings first — this summary uses it to write the work description.')
      setStage('error')
      return
    }
    let cancelled = false
    generateWorkSummary(project, apiKey)
      .then(async text => {
        let d = {}
        if (isTM) {
          try { d = await generateDailySummaries(project, apiKey) } catch { /* fall back to raw entry text below */ }
          for (const e of (project.laborEntries || [])) {
            if ((e.workCompleted || '').trim() && !(d[e.id] || '').trim()) d[e.id] = e.workCompleted.trim()
          }
        }
        if (!cancelled) { setDaily(d); setSummary(text); setStage('ready') }
      })
      .catch(err => { if (!cancelled) { setError(err.message || 'Could not generate the summary.'); setStage('error') } })
    return () => { cancelled = true }
    // Written once when the summary opens — re-running on every edit would make a new AI call each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function exportPdf() {
    setExporting(true)
    try {
      // Pull in any photos already attached to this job's Files, so the
      // report shows the actual work, not just numbers.
      let photoTiles = ''
      if (window.desktop && customer) {
        try {
          const folderPath = `Jobs/${customer.folder}/${project.folder}/Files`
          const files = await window.desktop.listFiles(folderPath)
          const { extOf, IMAGE_EXTS } = await import('../components/FileAttachments.jsx')
          const images = (files || []).filter(f => IMAGE_EXTS.includes(extOf(f.name))).slice(0, 12)
          const photoDataUrls = await Promise.all(images.map(async f => {
            try {
              const base64 = await window.desktop.readFileBytes(f.path)
              const ext = extOf(f.name)
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
              return `data:${mime};base64,${base64}`
            } catch {
              return null // one unreadable photo shouldn't block the rest of the report
            }
          }))
          photoTiles = photoDataUrls.filter(Boolean).map(url => `<img src="${url}" class="photo" />`).join('')
        } catch {
          // No Files folder yet, or nothing in it — report just goes out without a Photos section
        }
      }

      const materialRows = materials.map(m => `
        <tr>
          <td>${m.item || 'Material'}</td>
          <td style="text-align:center">${m.qty || 0} ${m.uom || ''}</td>
          <td style="text-align:right">$${m.markedUpPrice.toFixed(2)}</td>
          <td style="text-align:right">$${((Number(m.qty) || 0) * m.markedUpPrice).toFixed(2)}</td>
        </tr>
      `).join('')
      const laborRows = laborEntries.map(e => `
        <tr>
          <td>${e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
          <td>${e.rateLabel}</td>
          <td style="text-align:center">${e.hours || 0}</td>
          <td style="text-align:right">$${e.rateAmount.toFixed(2)}/hr</td>
          <td style="text-align:right">$${((Number(e.hours) || 0) * e.rateAmount).toFixed(2)}</td>
        </tr>
        ${isTM && (daily[e.id] || '').trim() ? `<tr><td colspan="5" style="font-size:11px;color:#555;padding-top:0">${daily[e.id].trim().replace(/</g, '&lt;')}</td></tr>` : ''}
      `).join('')
      const noteRows = (project.notesLog || []).slice().reverse().map(n => `
        <div class="note"><span class="note-date">${new Date(n.timestamp).toLocaleDateString()}</span> — ${n.text}</div>
      `).join('')

      const html = `
        <html><head><meta charset="utf-8"><style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #1a1a1a; font-size: 13px; }
          h1 { font-size: 20px; margin-bottom: 2px; }
          .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
          .summary { font-size: 13px; line-height: 1.6; margin-bottom: 26px; padding: 14px 16px; background: #f6f8fa; border-radius: 6px; }
          h2 { font-size: 14px; margin: 22px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
          th { text-align: left; background: #f0f0f0; padding: 7px 9px; border-bottom: 2px solid #ccc; }
          td { padding: 6px 9px; border-bottom: 1px solid #e0e0e0; }
          .total-line { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; padding: 10px 0; border-top: 2px solid #333; margin-top: 4px; }
          .note { font-size: 12px; padding: 5px 0; border-bottom: 1px solid #eee; }
          .note-date { font-weight: bold; color: #555; }
          .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
          .photo { width: 140px; height: 140px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
        </style></head><body>
          <h1>${customer?.name || 'Customer'}</h1>
          <div class="meta">${project.name || 'Job'}${project.co ? ` · CO ${project.co}` : ''} · ${new Date().toLocaleDateString()}</div>
          <div class="summary">${summary}</div>

          ${materials.length > 0 ? `
          <h2>Materials</h2>
          <table>
            <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>${materialRows}</tbody>
          </table>
          <div style="text-align:right; font-size:12px; font-weight:bold; margin-bottom: 10px;">Materials subtotal: $${materialsTotal.toFixed(2)}</div>
          ` : ''}

          ${laborEntries.length > 0 ? `
          <h2>Labor</h2>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th style="text-align:center">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>${laborRows}</tbody>
          </table>
          <div style="text-align:right; font-size:12px; font-weight:bold; margin-bottom: 10px;">Labor subtotal: $${laborTotal.toFixed(2)}</div>
          ` : ''}

          <div class="total-line"><span>Total</span><span>$${grandTotal.toFixed(2)}</span></div>

          ${photoTiles ? `<h2>Photos</h2><div class="photo-grid">${photoTiles}</div>` : ''}

          ${noteRows ? `<h2>Notes</h2>${noteRows}` : ''}
        </body></html>
      `

      const pdfBase64 = await window.desktop.pdfFromHtml(html)
      const fileName = `${(project.name || 'Job').replace(/[^\w\s-]/g, '')} - Customer Summary.pdf`
      const savedPath = await window.desktop.saveFile(`Jobs/${customer.folder}/${project.folder}/Files`, fileName, pdfBase64)
      if (savedPath) window.desktop.openFile(savedPath)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not generate the PDF.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth={520}>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Customer Summary</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
          {project.name} — materials at cost +15%, labor at charge-out rate.
        </div>

        {stage === 'generating' && (
          <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Writing the summary…</div>
        )}

        {stage === 'error' && (
          <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 14 }}>{error}</div>
        )}

        {stage === 'ready' && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
              Summary — edit as needed before exporting
            </div>
            <textarea
              value={summary} onChange={e => setSummary(e.target.value)}
              style={{ width: '100%', minHeight: 110, fontSize: 13, lineHeight: 1.5, border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'var(--font)', boxSizing: 'border-box', marginBottom: 14 }}
            />
            {isTM && laborEntries.some(e => (daily[e.id] || '').trim()) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
                  What was done each day — edit as needed
                </div>
                {laborEntries.filter(e => (daily[e.id] || '').trim() || (e.workCompleted || '').trim()).map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ width: 78, fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', paddingTop: 7, flexShrink: 0 }}>
                      {e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString() : 'Undated'}
                    </div>
                    <textarea
                      value={daily[e.id] || ''} onChange={ev => setDaily(d => ({ ...d, [e.id]: ev.target.value }))}
                      rows={2}
                      style={{ flex: 1, fontSize: 12, lineHeight: 1.4, border: '1px solid var(--border)', borderRadius: 6, padding: 6, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mid)', marginBottom: 14, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--rs)' }}>
              <span>{materials.length} material line{materials.length === 1 ? '' : 's'} · {laborEntries.length} labor entr{laborEntries.length === 1 ? 'y' : 'ies'}</span>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>Total: ${grandTotal.toFixed(2)}</span>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
          </>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          {stage === 'ready' && (
            <button
              onClick={exportPdf} disabled={exporting}
              style={{ flex: 1, padding: 10, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}
            >
              {exporting ? 'Generating PDF…' : 'Export as PDF'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

// ── AI Report for Quoted (fixed-price) jobs ──
// Pulls from the linked quote(s): the quoted scope (Complete Quote draft when
// there is one, otherwise each scope's text), and the contract price — the
// CO value you entered for that quote, else the quote's total.

function coLabel(co) {
  const c = String(co || '').trim()
  return !c ? '' : /^co\b/i.test(c) ? c : `CO ${c}`
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function quotedJobInfo(project, allQuotes) {
  const ids = project.linkedQuoteIds || (project.linkedQuoteId ? [project.linkedQuoteId] : [])
  const quoteCOs = project.linkedQuoteCOs || {}
  const quotes = ids.map(id => (allQuotes || []).find(q => q.id === id && !q.trashedAt)).filter(Boolean).map(raw => {
    const q = normalizeQuote(raw)
    const draft = q.completeQuote
    const sections = draft && (draft.blocks || []).some(b => (b.scopeText || '').trim())
      ? draft.blocks.map(b => ({ name: b.heading || '', lines: splitLines(b.scopeText) }))
      : (q.scopes || []).map((sc, i) => ({ name: sc.name || `Scope ${i + 1}`, lines: splitLines(sc.scopeText) }))
    const co = quoteCOs[q.id] || {}
    const coValue = co.coValue !== undefined && co.coValue !== null && co.coValue !== '' ? Number(co.coValue) : null
    return {
      id: q.id, number: q.quoteNumber || '', title: q.title || '', co: co.co || '',
      value: coValue != null ? coValue : quoteGrandTotal(q), valueFrom: coValue != null ? 'CO value' : 'quote total',
      sections: sections.filter(sec => sec.lines.length),
    }
  })
  const multi = quotes.length > 1
  const scopeText = quotes.map(q => q.sections.map(sec => {
    const head = multi || q.sections.length > 1 ? `${multi ? `${q.title || q.number} — ` : ''}${sec.name}:\n` : ''
    return head + sec.lines.map(l => `- ${l}`).join('\n')
  }).join('\n\n')).filter(Boolean).join('\n\n')
  // One quote: the job's own CO/job value wins when it's set (it's what was agreed).
  const jobValue = effectiveJobTotal(project)
  const contractTotal = quotes.length === 1 && jobValue > 0 ? jobValue
    : quotes.length ? quotes.reduce((s, q) => s + (Number(q.value) || 0), 0) : jobValue
  return { quotes, scopeText, contractTotal }
}

async function jobPhotoTiles(project, customer) {
  if (!window.desktop || !customer) return ''
  try {
    const files = await window.desktop.listFiles(`Jobs/${customer.folder}/${project.folder}/Files`)
    const { extOf, IMAGE_EXTS } = await import('../components/FileAttachments.jsx')
    const images = (files || []).filter(f => IMAGE_EXTS.includes(extOf(f.name))).slice(0, 12)
    const urls = await Promise.all(images.map(async f => {
      try {
        const base64 = await window.desktop.readFileBytes(f.path)
        const ext = extOf(f.name)
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        return `data:${mime};base64,${base64}`
      } catch { return null }
    }))
    return urls.filter(Boolean).map(url => `<img src="${url}" class="photo" />`).join('')
  } catch { return '' }
}

const QUOTED_REPORT_PARTS = [
  { id: 'scope', label: 'Scope of work (as quoted)', on: true },
  { id: 'work', label: 'Work completed, by day', on: true },
  { id: 'price', label: 'Contract price', on: true },
  { id: 'billing', label: 'Billing progress to date', on: false },
  { id: 'breakdown', label: 'Labor & materials breakdown', on: false },
  { id: 'photos', label: 'Photos from the job Files', on: true },
  { id: 'notes', label: 'Job notes', on: false },
]

function QuotedSummaryModal({ project, customer, onClose }) {
  const [apiKey] = useLocalStore('anthropic_api_key', '')
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const [stage, setStage] = useState('generating') // generating | ready | error
  const [summary, setSummary] = useState('')
  const [scopeText, setScopeText] = useState('')
  const [daily, setDaily] = useState({})
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [parts, setParts] = useState(() => Object.fromEntries(QUOTED_REPORT_PARTS.map(p => [p.id, p.on])))

  const info = quotesStore.loading ? null : quotedJobInfo(project, quotesStore.records)
  const workEntries = (project.laborEntries || []).filter(e => (e.workCompleted || '').trim())
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const billedPct = Number(project.billedProgress) || 0

  // Same cost view the T&M report uses, only shown if you tick "breakdown".
  const materials = (project.materialEntries || []).map(m => ({ ...m, markedUpPrice: (Number(m.price) || 0) * 1.15 }))
  const materialsTotal = materials.reduce((s, m) => s + (Number(m.qty) || 0) * m.markedUpPrice, 0)
  const rates = getLaborRates(project)
  const laborEntries = (project.laborEntries || []).map(e => ({
    ...e, rateLabel: rates.find(r => r.id === e.rateId)?.label || 'Labor', rateAmount: rates.find(r => r.id === e.rateId)?.rate || 0,
  }))
  const laborTotal = laborEntries.reduce((s, e) => s + (Number(e.hours) || 0) * e.rateAmount, 0)

  useEffect(() => {
    if (quotesStore.loading) return
    if (!apiKey) {
      setError('Set an Anthropic API key in Materials → Settings first — this summary uses it to write the work description.')
      setStage('error')
      return
    }
    let cancelled = false
    const qi = quotedJobInfo(project, quotesStore.records)
    setScopeText(qi.scopeText)
    ;(async () => {
      try {
        const text = await generateWorkSummary(project, apiKey, qi)
        let d = {}
        try { d = await generateDailySummaries(project, apiKey) } catch { /* fall back to the raw entries */ }
        for (const e of (project.laborEntries || [])) {
          if ((e.workCompleted || '').trim() && !(d[e.id] || '').trim()) d[e.id] = e.workCompleted.trim()
        }
        if (!cancelled) { setSummary(text); setDaily(d); setStage('ready') }
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Could not generate the summary.'); setStage('error') }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotesStore.loading])

  async function exportPdf() {
    setExporting(true)
    try {
      const photoTiles = parts.photos ? await jobPhotoTiles(project, customer) : ''
      const scopeBlock = (() => {
        // Headings (lines ending in ":") break the bullets into groups.
        let out = '', open = false
        splitLines(scopeText).forEach(l => {
          const isHead = /:$/.test(l) && !/^[-•]/.test(l)
          if (isHead) { if (open) { out += '</ul>'; open = false } out += `<div class="scope-head">${escHtml(l.replace(/:$/, ''))}</div>` }
          else { if (!open) { out += '<ul>'; open = true } out += `<li>${escHtml(l.replace(/^[-•]\s*/, ''))}</li>` }
        })
        return open ? out + '</ul>' : out
      })()
      const workRows = workEntries.map(e => `
        <tr><td style="width:110px;white-space:nowrap">${e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString() : '—'}</td><td>${escHtml((daily[e.id] || e.workCompleted || '').trim())}</td></tr>`).join('')
      const quotes = info ? info.quotes : []
      const priceRows = quotes.length > 1 ? quotes.map(q => `
        <tr><td>${escHtml(q.title || q.number)}${q.number ? ` <span class="muted">(${escHtml(q.number)})</span>` : ''}${q.co ? ` <span class="muted">· ${escHtml(coLabel(q.co))}</span>` : ''}</td><td style="text-align:right">$${(Number(q.value) || 0).toFixed(2)}</td></tr>`).join('') : ''
      const contract = info ? info.contractTotal : effectiveJobTotal(project)
      const quoteRef = quotes.length === 1 ? `${quotes[0].number}${quotes[0].co ? ` · ${coLabel(quotes[0].co)}` : ''}` : coLabel(project.co)

      const html = `
        <html><head><meta charset="utf-8"><style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #1a1a1a; font-size: 13px; }
          h1 { font-size: 20px; margin-bottom: 2px; }
          .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
          .muted { color: #777; font-size: 11px; }
          .summary { font-size: 13px; line-height: 1.6; margin-bottom: 22px; padding: 14px 16px; background: #f6f8fa; border-radius: 6px; }
          h2 { font-size: 14px; margin: 22px 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
          ul { margin: 4px 0 10px 18px; padding: 0; } li { margin: 3px 0; line-height: 1.45; }
          .scope-head { font-weight: bold; margin-top: 8px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
          th { text-align: left; background: #f0f0f0; padding: 7px 9px; border-bottom: 2px solid #ccc; }
          td { padding: 6px 9px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
          .total-line { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; padding: 10px 0; border-top: 2px solid #333; margin-top: 4px; }
          .note { font-size: 12px; padding: 5px 0; border-bottom: 1px solid #eee; }
          .note-date { font-weight: bold; color: #555; }
          .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
          .photo { width: 140px; height: 140px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; }
        </style></head><body>
          <h1>${escHtml(customer?.name || 'Customer')}</h1>
          <div class="meta">${escHtml(project.name || 'Job')}${quoteRef ? ` · ${escHtml(quoteRef)}` : ''} · ${new Date().toLocaleDateString()}</div>
          <div class="summary">${escHtml(summary).replace(/\n/g, '<br>')}</div>

          ${parts.scope && scopeBlock ? `<h2>Scope of Work</h2>${scopeBlock}` : ''}

          ${parts.work && workRows ? `<h2>Work Completed</h2><table><tbody>${workRows}</tbody></table>` : ''}

          ${parts.price ? `
          <h2>Contract Price</h2>
          ${priceRows ? `<table><tbody>${priceRows}</tbody></table>` : ''}
          <div class="total-line"${priceRows ? '' : ' style="border-top:none;margin-top:0"'}><span>Total contract price${quotes.length === 1 && quotes[0].title ? ` — ${escHtml(quotes[0].title)}` : ''}</span><span>$${(Number(contract) || 0).toFixed(2)}</span></div>
          <div class="muted">Taxes not included.</div>
          ${parts.billing && billedPct > 0 ? `<div style="margin-top:8px;font-size:12px">Billed to date: <b>${billedPct}%</b> ($${((Number(contract) || 0) * billedPct / 100).toFixed(2)}) · Remaining: $${((Number(contract) || 0) * (1 - billedPct / 100)).toFixed(2)}</div>` : ''}
          ` : ''}

          ${parts.breakdown && (materials.length || laborEntries.length) ? `
          <h2>Labor &amp; Materials Breakdown</h2>
          ${materials.length ? `<table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>${materials.map(m => `<tr><td>${escHtml(m.item || 'Material')}</td><td style="text-align:center">${m.qty || 0} ${escHtml(m.uom || '')}</td><td style="text-align:right">$${((Number(m.qty) || 0) * m.markedUpPrice).toFixed(2)}</td></tr>`).join('')}</tbody></table>
          <div style="text-align:right;font-size:12px;font-weight:bold;margin-bottom:10px">Materials: $${materialsTotal.toFixed(2)}</div>` : ''}
          ${laborEntries.length ? `<table><thead><tr><th>Date</th><th>Type</th><th style="text-align:center">Hours</th><th style="text-align:right">Total</th></tr></thead><tbody>${laborEntries.map(e => `<tr><td>${e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString() : '—'}</td><td>${escHtml(e.rateLabel)}</td><td style="text-align:center">${e.hours || 0}</td><td style="text-align:right">$${((Number(e.hours) || 0) * e.rateAmount).toFixed(2)}</td></tr>`).join('')}</tbody></table>
          <div style="text-align:right;font-size:12px;font-weight:bold;margin-bottom:10px">Labor: $${laborTotal.toFixed(2)}</div>` : ''}
          ` : ''}

          ${photoTiles ? `<h2>Photos</h2><div class="photo-grid">${photoTiles}</div>` : ''}

          ${parts.notes && (project.notesLog || []).length ? `<h2>Notes</h2>${(project.notesLog || []).slice().reverse().map(n => `<div class="note"><span class="note-date">${new Date(n.timestamp).toLocaleDateString()}</span> — ${escHtml(n.text)}</div>`).join('')}` : ''}
        </body></html>
      `
      const pdfBase64 = await window.desktop.pdfFromHtml(html)
      const fileName = `${(project.name || 'Job').replace(/[^\w\s-]/g, '')} - Customer Summary.pdf`
      const savedPath = await window.desktop.saveFile(`Jobs/${customer.folder}/${project.folder}/Files`, fileName, pdfBase64)
      if (savedPath) window.desktop.openFile(savedPath)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not generate the PDF.')
    } finally {
      setExporting(false)
    }
  }

  const quotes = info ? info.quotes : []
  const label10 = { fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }
  const boxStyle = { width: '100%', fontSize: 13, lineHeight: 1.5, border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'var(--font)', boxSizing: 'border-box', marginBottom: 14 }

  return (
    <ModalOverlay onClose={onClose} maxWidth={600}>
      <div style={{ padding: 20, maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Customer Summary — Quoted job</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
          {project.name} — built from {quotes.length ? quotes.map(q => q.number || q.title).join(', ') : 'this job (no linked quote found)'} and your work log.
        </div>

        {(stage === 'generating' || quotesStore.loading) && (
          <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Reading the quote and writing the summary…</div>
        )}
        {stage === 'error' && <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 14 }}>{error}</div>}

        {stage === 'ready' && (
          <>
            {!quotes.length && (
              <div style={{ fontSize: 12, color: '#9a6610', background: '#fff8e6', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                This job has no linked quote, so there's no quoted scope to pull in. Link one under General Information, or type the scope below.
              </div>
            )}
            <div style={label10}>Summary — edit as needed</div>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} style={{ ...boxStyle, minHeight: 100 }} />

            <div style={label10}>Scope of work (from the quote) — one bullet per line; a line ending in ":" is a heading</div>
            <textarea value={scopeText} onChange={e => setScopeText(e.target.value)} rows={6} style={{ ...boxStyle, fontSize: 12.5 }} placeholder="No scope text on the linked quote — type one here if you want it in the report" />

            {workEntries.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={label10}>Work completed each day — edit as needed (no hours or rates are shown)</div>
                {workEntries.map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ width: 78, fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', paddingTop: 7, flexShrink: 0 }}>
                      {e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString() : 'Undated'}
                    </div>
                    <textarea value={daily[e.id] || ''} onChange={ev => setDaily(d => ({ ...d, [e.id]: ev.target.value }))} rows={2}
                      style={{ flex: 1, fontSize: 12, lineHeight: 1.4, border: '1px solid var(--border)', borderRadius: 6, padding: 6, fontFamily: 'var(--font)', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--rs)', marginBottom: 12 }}>
              {quotes.length > 1 && quotes.map(q => (
                <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-mid)', padding: '2px 0' }}>
                  <span>{q.number} {q.title}{q.co ? ` · ${coLabel(q.co)}` : ''} <span style={{ color: 'var(--text-light)' }}>({q.valueFrom})</span></span>
                  <span>{money(q.value)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, color: 'var(--text)', paddingTop: 2 }}>
                <span>Contract price{quotes.length === 1 ? ` (${effectiveJobTotal(project) > 0 ? 'job CO value' : quotes[0].valueFrom})` : ''}</span>
                <span>{money(info ? info.contractTotal : 0)}</span>
              </div>
              {billedPct > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 2 }}>Billed to date: {billedPct}%</div>}
            </div>

            <div style={label10}>Put in the PDF</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', marginBottom: 14 }}>
              {QUOTED_REPORT_PARTS.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!parts[p.id]} onChange={e => setParts(x => ({ ...x, [p.id]: e.target.checked }))} />
                  {p.label}
                </label>
              ))}
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
          </>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          {stage === 'ready' && (
            <button onClick={exportPdf} disabled={exporting}
              style={{ flex: 1, padding: 10, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}>
              {exporting ? 'Generating PDF…' : 'Export as PDF'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

export const LIFECYCLE_OPTIONS = [
  { value: 'onGoing', label: 'Active Jobs' },
  { value: 'deficiencies', label: 'Completed Projects w/ Deficiencies' },
  { value: 'unbilled', label: 'Complete (Unbilled)' },
  { value: 'billed', label: 'Complete (Billed)' },
]

// The single source of truth for a job's lifecycle bucket. Jobs completed
// under the old system (before this existed) have completed=true but no
// lifecycleStatus set — those come back null, meaning "needs review."
export function effectiveLifecycleStatus(project) {
  // 'closed' and 'complete' are legacy values from earlier versions of this
  // status system, before Unbilled/Billed became explicit choices — neither
  // one carries a real billed/unbilled decision, so treat them as needing
  // review rather than guessing which bucket they belong in.
  if (project.lifecycleStatus === 'closed' || project.lifecycleStatus === 'complete') return null
  if (project.lifecycleStatus) return project.lifecycleStatus
  if (!project.completed) return 'onGoing'
  return null
}

// Slip material still sitting with a job (received, not used up, not pushed
// to Stock). A job can't be closed until each line is used on it or pushed
// to Stock — that's how leftovers reach Stock.
export function MaterialCloseout({ project, onUpdate, onAllDone, title, compact = false }) {
  const [matOrders, setMatOrders] = useLocalStore('material_orders', [])
  const [, setStock] = useLocalStore('material_stock', [])
  const [openC, setOpenC] = useState(false)
  const left = leftoverLinesForJob(matOrders || [], project)
  if (!left.length) return null
  if (compact && !openC) return (
    <div onClick={() => setOpenC(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderTop: '1px solid var(--border)', background: '#fffaf0', cursor: 'pointer', fontSize: 12 }}>
      <span style={{ fontSize: 10, color: 'var(--text-light)' }}>▸</span>
      <span style={{ fontWeight: 800, color: '#8a5d00' }}>📦 {left.length} slip line{left.length === 1 ? '' : 's'} not all used here</span>
      <span style={{ flex: 1, color: 'var(--text-light)' }}>{left.slice(0, 3).map(x => `${Math.round(x.remaining * 100) / 100} ${x.li.nickname || x.li.name}`).join(', ')}{left.length > 3 ? '…' : ''}</span>
      <span style={{ color: '#8a5d00', fontWeight: 700 }}>Used on job / → Stock</span>
    </div>
  )
  const apply = (items, mode) => {
    const r = closeOutLines(matOrders, project, items, mode, project.materialEntries || [], uid)
    setMatOrders(r.orders)
    if (r.stockLines.length) setStock(list => r.stockLines.reduce((acc, x) => mergeIntoStock(acc, x.order, [x.li], uid), list || []))
    const total = r.entries.reduce((a, e) => a + (Number(e.qty) || 1) * (Number(e.price) || 0), 0)
    onUpdate({ materialEntries: r.entries, actualMaterials: Math.round(total * 100) / 100 })
    if (items.length === left.length && onAllDone) setTimeout(onAllDone, 0)
  }
  const b = (primary) => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--navy)' : 'var(--surface)', color: primary ? '#fff' : 'var(--text-mid)' })
  return (
    <div style={{ marginTop: compact ? 0 : 8, padding: '8px 10px', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: compact ? 0 : 'var(--rs)' }}>
      <div onClick={compact ? () => setOpenC(false) : undefined} style={{ fontSize: 12, fontWeight: 800, color: '#8a5d00', marginBottom: 4, cursor: compact ? 'pointer' : 'default' }}>
        {compact ? '▾ ' : ''}{title || `Material to close out — ${left.length} slip line${left.length === 1 ? '' : 's'} not used up`}
      </div>
      <div style={{ fontSize: 11, color: '#7a5a00', marginBottom: 6 }}>For each line: was the rest used on this job, or does it go back to Stock?</div>
      {left.map(x => (
        <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderTop: '1px solid #f0e2b8', fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{Math.round(x.remaining * 100) / 100} {x.li.uom || ''}</b> {x.li.nickname || x.li.name}
            <span style={{ color: 'var(--text-light)' }}> · {x.order.wholesaler || 'Slip'}{x.order.invoiceNumber ? ' #' + x.order.invoiceNumber : ''}{x.li.received ? '' : ' · not received yet'}</span>
          </span>
          <button style={b(false)} onClick={() => apply([x], 'use')}>Used on job</button>
          <button style={b(false)} onClick={() => apply([x], 'stock')}>→ Stock</button>
        </div>
      ))}
      {left.length > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
          <button style={b(false)} onClick={() => apply(left, 'use')}>All used on this job</button>
          <button style={b(true)} onClick={() => apply(left, 'stock')}>All the rest → Stock</button>
        </div>
      )}
    </div>
  )
}

export function LifecycleStatusDropdown({ project, onUpdate }) {
  const openDeficiencies = (project.deficiencies || []).filter(d => !d.resolved)
  const current = effectiveLifecycleStatus(project)
  const needsReview = project.completed && !project.lifecycleStatus
  const [confirmedLabel, setConfirmedLabel] = useState('')
  const [matOrdersGate] = useLocalStore('material_orders', [])
  const [pendingClose, setPendingClose] = useState('') // status waiting on the material close-out
  const [flagBlock, setFlagBlock] = useState('') // close blocked by flagged labor
  const laborFlags = openLaborFlags(project)

  function handleChange(value) {
    // Closing a job: its slip material must be used on it or pushed to Stock first
    const closing = value === 'deficiencies' || value === 'unbilled' || value === 'billed'
    if (closing && openLaborFlags(project).length) { setFlagBlock(value); return }
    setFlagBlock('')
    if (closing && current === 'onGoing' && leftoverLinesForJob(matOrdersGate || [], project).length) { setPendingClose(value); return }
    setPendingClose('')
    doChange(value)
  }
  function doChange(value) {
    const patch = statusPatch(project, value)
    onUpdate(patch)
    const label = LIFECYCLE_OPTIONS.find(o => o.value === value)?.label || value
    setConfirmedLabel(`✓ Moved to ${label} — go back to see it filed there`)
    setTimeout(() => setConfirmedLabel(''), 4000)
  }

  return (
    <div style={{ margin: '0 16px 12px' }}>
      {needsReview && (
        <div style={{ marginBottom: 8, padding: '8px 10px', background: '#fff8e6', border: '1px solid var(--accent)', borderRadius: 'var(--rs)', fontSize: 12, color: '#9a6610' }}>
          This job was completed under the old system — pick a status below to file it correctly.
        </div>
      )}
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>Job status</div>
      <select
        value={current || ''}
        onChange={e => handleChange(e.target.value)}
        style={{ fontSize: 13, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', width: '100%', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
      >
        {!current && <option value="" disabled>Choose a status…</option>}
        {LIFECYCLE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {confirmedLabel && (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#1e7a34' }}>{confirmedLabel}</div>
      )}
      {(flagBlock || (laborFlags.length > 0 && current !== 'onGoing' && current)) && laborFlags.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#fdf3f1', border: '1px solid #e3a49c', borderRadius: 'var(--rs)', fontSize: 12, color: '#7a2a1e' }}>
          <b style={{ color: '#a12a1e' }}>⚑ {flagBlock ? `Can't move this job to ${(LIFECYCLE_OPTIONS.find(o => o.value === flagBlock) || {}).label || 'closed'} yet` : 'Closed job with flagged labor'}</b> — resolve the flagged labor first (Labor section):
          {laborFlags.map(e => <div key={e.id} style={{ marginTop: 3 }}>• {e.date || 'undated'} · {e.worker || '—'} · {e.hours || 0} h — <b>{e.flag.kind}</b>{e.flag.note ? ': ' + e.flag.note : ''}</div>)}
        </div>
      )}
      {pendingClose && (
        leftoverLinesForJob(matOrdersGate || [], project).length
          ? <MaterialCloseout project={project} onUpdate={onUpdate} onAllDone={() => { const v = pendingClose; setPendingClose(''); doChange(v) }}
              title={`Before this job can be ${(LIFECYCLE_OPTIONS.find(o => o.value === pendingClose) || {}).label || 'closed'}: close out its slip material`} />
          : <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1e7a34', fontWeight: 700 }}>
              ✓ Material closed out
              <button onClick={() => { const v = pendingClose; setPendingClose(''); doChange(v) }} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>Finish closing the job</button>
            </div>
      )}
      {!pendingClose && current && current !== 'onGoing' && <MaterialCloseout project={project} onUpdate={onUpdate} title="Closed job with slip material not closed out" />}
      {openDeficiencies.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-light)' }}>
          {openDeficiencies.length} open deficienc{openDeficiencies.length === 1 ? 'y' : 'ies'} on this job — marking it Complete (Unbilled or Billed) closes {openDeficiencies.length === 1 ? 'it' : 'them'} off
        </div>
      )}
    </div>
  )
}

// The work order request this job came from (filled from the email's
// attached form by Assistant Update). Read-only; the PDF copy is in Files.
function WorkOrderBlock({ wo, project, customer }) {
  const [msg, setMsg] = useState('')
  const target = () => {
    const when = String(wo.emailDate || '').slice(0, 10)
    const where = [wo.building, wo.room].filter(Boolean).join(' ').replace(/[^\w\s-]/g, '').trim()
    return { customerFolder: customer?.folder, folder: project?.folder, destBase: `Work Order${when ? ` ${when}` : ''}${where ? ` - ${where}` : ''}` }
  }
  async function getOriginal() {
    setMsg('Looking…')
    const r = await window.desktop.workOrderCopyToRecord({ match: { receivedAt: wo.receivedAt || '', date: wo.emailDate || '', fileName: wo.fileName || '' }, ...target() })
    if (r?.ok) setMsg(r.skipped ? 'Already in Files.' : `Saved to Files: ${r.name}`)
    else if (r?.reason === 'ambiguous') setMsg('More than one work order came in that day. Pick it by hand.')
    else if (r?.reason === 'no-folder') setMsg("Can't find the Field App folder.")
    else setMsg("Not in Work Orders. Pick it by hand (save it from Outlook first).")
  }
  async function pickOriginal() {
    const r = await window.desktop.workOrderPickToRecord(target())
    if (r?.ok) setMsg(r.skipped ? 'Already in Files.' : `Saved to Files: ${r.name}`)
    else if (r && r.reason !== 'canceled') setMsg('Could not copy that file.')
  }
  const urgent = wo.urgent && /^y/i.test(String(wo.urgent))
  const bits = [
    ['Requested by', [wo.requester, wo.phone].filter(Boolean).join(' · ')],
    ['Date', wo.date], ['Location', [wo.building, wo.room && `room ${wo.room}`].filter(Boolean).join(' ')],
    ['Department', wo.department], ['Quote required', wo.quoteRequired], ['PO #', wo.po],
  ].filter(([, v]) => v)
  return (
    <div style={{ margin: '8px 16px', padding: '10px 12px', border: `1px solid ${urgent ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--rs)', background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-light)', flex: 1 }}>Work order</span>
        {urgent && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: 'var(--red)', borderRadius: 10, padding: '1px 7px' }}>URGENT</span>}
        {wo.emailLink && window.desktop?.openExternal && (
          <button onClick={() => window.desktop.openExternal(wo.emailLink)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Open email →</button>
        )}
      </div>
      {wo.description && <div style={{ fontSize: 13.5, color: 'var(--text)', marginBottom: 6, whiteSpace: 'pre-wrap' }}>{wo.description}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12 }}>
        {bits.map(([k, v]) => (
          <React.Fragment key={k}><span style={{ color: 'var(--text-light)' }}>{k}</span><span style={{ color: 'var(--text-mid)' }}>{v}</span></React.Fragment>
        ))}
      </div>
      {window.desktop?.workOrderCopyToRecord && customer?.folder && project?.folder && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={getOriginal} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface)', cursor: 'pointer' }}>📎 Get original</button>
          <button onClick={pickOriginal} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Pick file…</button>
          {msg && <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{msg}</span>}
        </div>
      )}
    </div>
  )
}

function GeneralInfoSection({ project, customer, onUpdate, navigate }) {
  const actualMaterials = project.actualMaterials || 0
  const actualLabor = project.actualLabor || 0
  const isQuoted = project.type === 'quoted'
  const rates = getLaborRates(project)

  function billToProgress(toPercent, amount, monthKey) {
    const patch = progressBillPatch(project, toPercent, amount, monthKey)
    if (patch) onUpdate(patch)
  }

  // T&M: send everything done so far (hours + materials with markup) that
  // hasn't been sent for billing yet — monthly or at the end of the job.
  function billTM(monthKey) {
    const patch = tmBillPatch(project, monthKey)
    if (patch) onUpdate(patch)
  }

  // Undoes the most recent billing entry — see undoLastBillingPatch.
  function undoLastBilling() {
    const patch = undoLastBillingPatch(project)
    if (patch) onUpdate(patch)
  }

  function updateRate(id, patch) {
    onUpdate({ laborRates: rates.map(r => r.id === id ? { ...r, ...patch } : r) })
  }
  function deleteRate(id) {
    onUpdate({ laborRates: rates.filter(r => r.id !== id) })
  }
  function addRate({ label, rate }) {
    onUpdate({ laborRates: [...rates, { id: uid(), label, rate }] })
  }

  return (
    <div>
      <TypeBanner project={project} />
      <RelatedJobBanner project={project} navigate={navigate} />
      <MoveToCustomerButton project={project} navigate={navigate} />
      <JobTypeRow project={project} onUpdate={onUpdate} />
      <FieldRow label="Project name">
        <EditableField value={project.name} placeholder="Project name" onSave={v => onUpdate({ name: v })} />
      </FieldRow>
      <CoRow project={project} customer={customer} onUpdate={onUpdate} />
      {project.workOrder && <WorkOrderBlock wo={project.workOrder} project={project} customer={customer} />}

      <div data-fix="status">
        <FieldRow label="Status">
          <LifecycleStatusDropdown project={project} onUpdate={onUpdate} />
        </FieldRow>
      </div>

      <div style={sectionGroupLabelStyle}>Dates</div>
      <div data-fix="dateApproved">
        <FieldRow label="Date approved">
          <DateField value={project.dateApproved} onChange={v => onUpdate({ dateApproved: v })} />
        </FieldRow>
      </div>
      <FieldRow label="Scheduled to start">
        <DateField value={project.dateStart} onChange={v => onUpdate({ dateStart: v })} />
      </FieldRow>
      <FieldRow label="To be completed by">
        <DateField value={project.dateComplete} onChange={v => onUpdate({ dateComplete: v })} />
      </FieldRow>

      <div style={sectionGroupLabelStyle}>Progress</div>
      {project.type === 'warranty' ? (
        <>
          <FieldRow label="Cost to us so far">
            <span style={{ fontSize: 14, fontWeight: 800, color: '#a12a1e' }}>{money((Number(project.actualLabor) || 0) + (Number(project.actualMaterials) || 0))}</span>
          </FieldRow>
          <div style={{ padding: '0 16px 10px', fontSize: 11, color: 'var(--text-light)', marginTop: -6 }}>
            Labor at your charge-out rates plus materials at cost. Not billed — for your own records.
          </div>
        </>
      ) : project.type === 'tm' ? (
        <>
          <FieldRow label="T&M total to date">
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{money(tmTotal(project))}</span>
          </FieldRow>
          <div style={{ padding: '0 16px 10px', fontSize: 11, color: 'var(--text-light)', marginTop: -6 }}>
            Worked out from the hours and materials you enter — labor at your charge-out rates, materials plus {Math.round(TM_MATERIAL_MARKUP * 100)}%. It updates as you add entries.
          </div>
          <FieldRow label="Estimate (reference only)">
            <EditableCurrency value={project.jobValue || ''} onSave={v => onUpdate({ jobValue: v })} color="var(--text)" />
          </FieldRow>
        </>
      ) : (
        <div data-fix="value">
          <FieldRow label="Job value">
            <EditableCurrency value={project.jobValue || (effectiveJobTotal(project) > 0 ? effectiveJobTotal(project) : '')} onSave={v => onUpdate({ jobValue: v })} color="var(--text)" />
          </FieldRow>
          {!project.jobValue && effectiveJobTotal(project) > 0 && (
            <div style={{ padding: '0 16px 10px', fontSize: 11, color: 'var(--text-light)', marginTop: -6 }}>
              Using CO Value since no job value has been set directly — edit above to override.
            </div>
          )}
        </div>
      )}
      <FieldRow label="Progress">
        <ProgressSlider value={project.progress} onChange={v => onUpdate({ progress: v })} />
      </FieldRow>
      <div data-fix="billing">
      {project.type === 'warranty' ? null : project.type === 'tm' ? (
        <BillTM project={project} onBill={m => billTM(typeof m === 'string' ? m : undefined)} onUndoLast={undoLastBilling} />
      ) : (
        <BillToProgress
          progress={project.progress}
          jobValue={effectiveJobTotal(project)}
          billedProgress={project.billedProgress}
          entries={billingEntries(project)}
          onBill={billToProgress}
          onUndoLast={undoLastBilling}
          dateComplete={project.dateComplete}
        />
      )}
      </div>

      <div style={sectionGroupLabelStyle}>{isQuoted ? 'Materials & labor — quoted / actual' : 'Materials & labor — actual'}</div>
      <CostCompareRow
        label="Materials"
        quoted={project.quotedMaterials}
        actual={actualMaterials}
        onSaveQuoted={v => onUpdate({ quotedMaterials: v })}
        isQuoted={isQuoted}
      />
      <CostCompareRow
        label="Labor"
        quoted={project.quotedLabor}
        actual={actualLabor}
        onSaveQuoted={v => onUpdate({ quotedLabor: v })}
        isQuoted={isQuoted}
      />
      <div style={{ padding: '8px 16px 18px', fontSize: 11, color: 'var(--text-light)' }}>
        Actual materials and labor will total automatically once entries are added in those sections.
      </div>

      <div style={sectionGroupLabelStyle}>Labor rates</div>
      {rates.map(r => (
        <RateRow key={r.id} rate={r} onUpdate={patch => updateRate(r.id, patch)} onDelete={() => deleteRate(r.id)} />
      ))}
      <RateAddRow onAdd={addRate} />
      <div style={{ padding: '8px 16px 18px', fontSize: 11, color: 'var(--text-light)' }}>
        These rates populate the dropdown when logging hours in Labor.
      </div>
    </div>
  )
}

// ── Labor section ────────────────────────────────────────────────
const LABOR_COLS = '92px 52px 90px 86px 1fr'

// Default rate tier used until a project has its own set (edited from General Information)
const DEFAULT_LABOR_RATES = [
  { id: 'journeyman', label: 'Journeyman', rate: 90 },
]

export function getLaborRates(project) {
  return project.laborRates && project.laborRates.length ? project.laborRates : DEFAULT_LABOR_RATES
}

function laborTotals(entries, rates) {
  let hours = 0, cost = 0
  entries.forEach(e => {
    const h = Number(e.hours) || 0
    const rate = rates.find(r => r.id === e.rateId)?.rate || 0
    hours += h
    cost += h * rate
  })
  return { hours, cost }
}

function RateSelector({ value, onChange, rates }) {
  return (
    <select
      value={value || ''}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 4,
        padding: '4px 3px', outline: 'none', cursor: 'pointer', width: '100%',
        background: 'var(--surface)', color: value ? 'var(--text)' : 'var(--text-light)',
        fontFamily: 'var(--font)',
      }}
    >
      <option value="">Rate</option>
      {rates.map(r => (
        <option key={r.id} value={r.id}>{r.label}</option>
      ))}
    </select>
  )
}

function LaborColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 4px', background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: LABOR_COLS, gap: 8, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Date</span>
        <span style={colHeaderStyle}>Hrs</span>
        <span style={colHeaderStyle}>Worker</span>
        <span style={colHeaderStyle}>Rate</span>
        <span style={colHeaderStyle}>Work completed</span>
      </div>
      <span style={{ width: 58, flexShrink: 0 }} />
    </div>
  )
}

function WorkCompletedToggle({ text, expanded, onToggle, placeholder }) {
  return (
    <span
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', minWidth: 0 }}
    >
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 14, fontWeight: text ? 500 : 500, color: text ? 'var(--text-mid)' : 'var(--text-light)',
      }}>
        {text ? text.split('\n')[0] : placeholder}
      </span>
      <span style={chevronWrapStyle}><ChevronDown open={expanded} /></span>
    </span>
  )
}

function BufferedTextarea({ value, onCommit, ...areaProps }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  return (
    <textarea
      {...areaProps}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft !== (value ?? '')) onCommit(draft)
      }}
    />
  )
}

const workTextareaStyle = {
  width: '100%', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, padding: 8, outline: 'none',
  resize: 'vertical', minHeight: 76,
}

function LaborEntryRow({ entry, rates, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [flagging, setFlagging] = useState(false)   // the flag editor is open
  const [resolving, setResolving] = useState(false) // asking how it was dealt with
  const [kind, setKind] = useState('')
  const [note, setNote] = useState('')
  const [resNote, setResNote] = useState('')
  const f = entry.flag && !entry.flag.resolvedAt ? entry.flag : null
  const resolved = entry.flag && entry.flag.resolvedAt ? entry.flag : null
  const openEditor = () => { setKind((f && f.kind) || ''); setNote((f && f.note) || ''); setFlagging(true) }
  const saveFlag = () => {
    if (!kind && !note.trim()) return
    onUpdate({ flag: { kind: kind || 'Flag', note: note.trim(), at: (f && f.at) || new Date().toISOString() } })
    setFlagging(false)
  }
  const chip = on => ({ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (on ? '#c0392b' : 'var(--border)'), background: on ? '#fdecea' : 'var(--surface)', color: on ? '#a12a1e' : 'var(--text-mid)' })
  const btnS = primary => ({ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--navy)' : 'var(--surface)', color: primary ? '#fff' : 'var(--text-mid)' })
  return (
    <div style={f ? { boxShadow: 'inset 4px 0 0 #c0392b' } : undefined}>
      <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16, ...(f ? { background: '#fdf3f1' } : {}) }}>
        <div style={{ display: 'grid', gridTemplateColumns: LABOR_COLS, gap: 8, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <BufferedInput type="date" value={entry.date} onCommit={v => onUpdate({ date: v })}
            style={{ ...dateInputStyle, fontSize: 11, padding: '3px 4px', width: '100%' }} />
          <BufferedInput type="number" inputMode="decimal" value={entry.hours} onCommit={v => onUpdate({ hours: v })}
            placeholder="0" style={{ ...plainInputStyle, textAlign: 'center' }} />
          <BufferedInput value={entry.worker} onCommit={v => onUpdate({ worker: v })}
            placeholder="Worker" style={plainInputStyle} />
          <RateSelector value={entry.rateId} onChange={v => onUpdate({ rateId: v })} rates={rates} />
          <WorkCompletedToggle
            text={entry.workCompleted}
            expanded={expanded}
            onToggle={() => setExpanded(x => !x)}
            placeholder="Add details"
          />
        </div>
        <button onClick={() => f ? setResolving(r => !r) : (flagging ? setFlagging(false) : openEditor())}
          title={f ? `Flagged: ${f.kind}${f.note ? ' — ' + f.note : ''} (click to resolve)` : 'Flag this entry — overtime not billed, took longer than planned… The job can\'t be closed until it\'s resolved.'}
          style={{ width: 30, flexShrink: 0, background: f ? '#c0392b' : 'none', color: f ? '#fff' : 'var(--text-light)', border: f ? 'none' : '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 12, padding: '2px 0' }}>⚑</button>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete entry" confirmText="Delete this labor entry?" />
      </div>
      {f && !flagging && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px', background: '#fdf3f1', borderBottom: '1px solid #f0cdc7', fontSize: 12.5, flexWrap: 'wrap' }}>
          <b style={{ color: '#a12a1e' }}>⚑ {f.kind}</b>
          {f.note && <span style={{ color: '#7a2a1e', flex: 1, minWidth: 160 }}>{f.note}</span>}
          {!f.note && <span style={{ flex: 1 }} />}
          <span style={{ color: 'var(--text-light)', fontSize: 11 }}>flagged {formatDateTime(f.at).split(',')[0]}</span>
          <button onClick={openEditor} style={{ ...btnS(false), padding: '3px 9px', fontSize: 11 }}>Edit</button>
          <button onClick={() => setResolving(r => !r)} style={{ ...btnS(true), padding: '3px 10px', fontSize: 11, background: '#1e7a34' }}>✓ Resolve…</button>
        </div>
      )}
      {f && resolving && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 8px', background: '#eef8f1', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <input autoFocus value={resNote} onChange={e => setResNote(e.target.value)} placeholder="How was it dealt with? e.g. billed 6 h OT on invoice 1042"
            onKeyDown={e => { if (e.key === 'Enter') { onUpdate({ flag: { ...f, resolvedAt: new Date().toISOString(), resolvedNote: resNote.trim() } }); setResolving(false); setResNote('') } }}
            style={{ flex: 1, minWidth: 220, fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px' }} />
          <button onClick={() => { onUpdate({ flag: { ...f, resolvedAt: new Date().toISOString(), resolvedNote: resNote.trim() } }); setResolving(false); setResNote('') }} style={{ ...btnS(true), background: '#1e7a34' }}>✓ Resolved</button>
          <button onClick={() => setResolving(false)} style={btnS(false)}>Cancel</button>
        </div>
      )}
      {flagging && (
        <div style={{ padding: '8px 16px 10px', background: '#fdf3f1', borderBottom: '1px solid #f0cdc7' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#a12a1e', marginBottom: 6 }}>⚑ Flag this labor entry — the job can't be closed until it's resolved</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {LABOR_FLAG_KINDS.map(k => <button key={k} onClick={() => setKind(k)} style={chip(kind === k)}>{k}</button>)}
          </div>
          <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note — e.g. 6 h overtime Saturday not on the timesheet; or waited 3 h on the gate techs"
            style={{ ...workTextareaStyle, minHeight: 48 }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={saveFlag} disabled={!kind && !note.trim()} style={{ ...btnS(true), background: '#c0392b', opacity: !kind && !note.trim() ? 0.5 : 1 }}>⚑ {f ? 'Save flag' : 'Flag it'}</button>
            <button onClick={() => setFlagging(false)} style={btnS(false)}>Cancel</button>
            {f && <button onClick={() => { onUpdate({ flag: null }); setFlagging(false) }} style={{ ...btnS(false), marginLeft: 'auto' }}>Remove flag (made by mistake)</button>}
          </div>
        </div>
      )}
      {resolved && !f && (
        <div style={{ padding: '2px 16px 4px', fontSize: 11, color: 'var(--text-light)', background: 'var(--surface)' }}>
          ✓ Flag resolved {formatDateTime(resolved.resolvedAt).split(',')[0]} — {resolved.kind}{resolved.note ? ': ' + resolved.note : ''}{resolved.resolvedNote ? ' → ' + resolved.resolvedNote : ''}
        </div>
      )}
      {expanded && (
        <div style={{ padding: '4px 16px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <BufferedTextarea
            autoFocus
            value={entry.workCompleted}
            onCommit={v => onUpdate({ workCompleted: v })}
            placeholder="Work completed — add details, one line at a time if you like"
            rows={4}
            style={workTextareaStyle}
          />
        </div>
      )}
    </div>
  )
}

function LaborAddRow({ rates, onAdd }) {
  const [date, setDate] = useState('')
  const [hours, setHours] = useState('')
  const [worker, setWorker] = useState('')
  const [rateId, setRateId] = useState('')
  const [work, setWork] = useState('')
  const [expanded, setExpanded] = useState(false)

  function submit() {
    if (!date && !hours && !worker.trim() && !work.trim()) return
    onAdd({ date, hours: hours ? Number(hours) : 0, worker: worker.trim(), rateId, workCompleted: work.trim() })
    setDate(''); setHours(''); setWorker(''); setRateId(''); setWork(''); setExpanded(false)
  }

  return (
    <div>
      <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16, background: 'var(--surface-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: LABOR_COLS, gap: 8, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ ...dateInputStyle, fontSize: 11, padding: '3px 4px', width: '100%' }} />
          <input type="number" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)}
            placeholder="Hrs" style={{ ...plainInputStyle, textAlign: 'center' }} />
          <input value={worker} onChange={e => setWorker(e.target.value)}
            placeholder="Worker" style={plainInputStyle} />
          <RateSelector value={rateId} onChange={setRateId} rates={rates} />
          <WorkCompletedToggle
            text={work}
            expanded={expanded}
            onToggle={() => setExpanded(x => !x)}
            placeholder="Work completed"
          />
        </div>
        <button onClick={submit} style={{ ...delBtnStyle, color: 'var(--accent-dim)', fontSize: 17, fontWeight: 700 }} aria-label="Add entry">+</button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 16px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <textarea
            autoFocus
            value={work}
            onChange={e => setWork(e.target.value)}
            placeholder="Work completed — add details, one line at a time if you like"
            rows={4}
            style={workTextareaStyle}
          />
        </div>
      )}
    </div>
  )
}

function LaborActual({ project, onUpdate }) {
  const entries = project.laborEntries || []
  const rates = getLaborRates(project)

  function addEntry(data) {
    const next = [...entries, { id: uid(), ...data }]
    onUpdate({ laborEntries: next, actualLabor: laborTotals(next, rates).cost })
  }
  function updateEntry(id, patch) {
    const next = entries.map(e => e.id === id ? { ...e, ...patch } : e)
    onUpdate({ laborEntries: next, actualLabor: laborTotals(next, rates).cost })
  }
  function deleteEntry(id) {
    const next = entries.filter(e => e.id !== id)
    onUpdate({ laborEntries: next, actualLabor: laborTotals(next, rates).cost })
  }

  const sorted = entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const { hours: totalHours, cost: totalCost } = laborTotals(entries, rates)

  const byRate = rates
    .map(r => ({ ...r, hours: entries.filter(e => e.rateId === r.id).reduce((s, e) => s + (Number(e.hours) || 0), 0) }))
    .filter(r => r.hours > 0)

  const flagged = openLaborFlags(project)
  return (
    <div>
      {flagged.length > 0 && (
        <div style={{ margin: '10px 16px 4px', padding: '8px 12px', border: '1px solid #e3a49c', background: '#fdf3f1', borderRadius: 8, fontSize: 12.5, color: '#7a2a1e' }}>
          <b style={{ color: '#a12a1e' }}>⚑ {flagged.length} labor entr{flagged.length === 1 ? 'y' : 'ies'} flagged</b> — this job can't be closed until {flagged.length === 1 ? "it's" : "they're"} resolved.
        </div>
      )}
      {entries.length > 0 && <LaborColumnHeader />}
      {entries.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          No entries yet — add today's hours below.
        </div>
      )}
      {sorted.map(e => (
        <LaborEntryRow key={e.id} entry={e} rates={rates} onUpdate={patch => updateEntry(e.id, patch)} onDelete={() => deleteEntry(e.id)} />
      ))}
      <LaborAddRow rates={rates} onAdd={addEntry} />
      {entries.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>Total hours: {totalHours}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {byRate.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {byRate.map(r => (
                <div key={r.id} style={{ fontSize: 11, color: 'var(--text-light)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.label} · ${r.rate.toFixed(2)}/hr</span>
                  <span>{r.hours}h</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const laborTabBtnStyle = active => ({
  flex: 1, padding: '10px 8px', background: 'none', border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  color: active ? 'var(--accent-dim)' : 'var(--text-mid)',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

// Time captured by the crew clock. It only reaches laborEntries / actualLabor
// (and so the T&M total) when posted and confirmed in PostTimeToLabor.
export function trackedTimeTotal(project) {
  return (project.trackedTime || []).reduce((s, e) => s + (Number(e.totalHours) || 0), 0)
}

function LaborSection({ project, onUpdate }) {
  const [tab, setTab] = useState('actual')
  const isQuoted = project.type === 'quoted'
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })

  if (!isQuoted) {
    return <LaborActual project={project} onUpdate={onUpdate} />
  }

  function importLabor(quote, items) {
    const entries = project.laborEntries || []
    let rates = getLaborRates(project)
    const newEntries = items.map(li => {
      const existing = rates.find(r => Number(r.rate) === Number(li.rate))
      let rateId
      if (existing) {
        rateId = existing.id
      } else {
        const newRate = { id: uid(), label: `$${Number(li.rate || 0).toFixed(0)}/hr`, rate: Number(li.rate) || 0 }
        rates = [...rates, newRate]
        rateId = newRate.id
      }
      return { id: uid(), date: '', hours: Number(li.qty) || 0, worker: '', rateId, workCompleted: `Quoted: ${li.desc || ''}` }
    })
    const nextEntries = [...entries, ...newEntries]
    onUpdate({ laborRates: rates, laborEntries: nextEntries, actualLabor: laborTotals(nextEntries, rates).cost })
  }

  return (
    <div>
      <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setTab('actual')} style={laborTabBtnStyle(tab === 'actual')}>Labor Actual</button>
        <button onClick={() => setTab('quoted')} style={laborTabBtnStyle(tab === 'quoted')}>Quoted</button>
      </div>
      {tab === 'actual' && <LaborActual project={project} onUpdate={onUpdate} />}
      {tab === 'quoted' && (
        <QuotedTabShell project={project} quotesStore={quotesStore} ViewComponent={QuotedLaborView} onImport={importLabor} />
      )}
    </div>
  )
}

// ── Section page (final destination — sections built out one at a time) ──
// ── Materials section ────────────────────────────────────────────
// Qty | Part No. | Description | UOM | Price per | Cost
const MATERIAL_COLS = '48px minmax(96px, 0.45fr) minmax(140px, 1fr) 48px 86px 86px'

// Stock items are purchased material with a real cost, always tracked against
// the project. Custom entries may or may not carry a cost — if it's something
// already paid for personally, leave the price at $0.00.
function materialsTotal(entries) {
  return entries.reduce((sum, e) => {
    const qty = Number(e.qty) || 1
    const price = Number(e.price) || 0
    return sum + qty * price
  }, 0)
}

function money(v) {
  return `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Job Value is a newer field most existing jobs won't have filled in yet —
// fall back to CO Value (already set on most quoted jobs) so the Un-billed/
// Total display actually has something to show for jobs created before this.
// T&M jobs have no fixed price — what can be billed is the running total of
// hours at the charge-out rate plus materials with the standard markup.
// What has already been invoiced on a T&M job, as dollars. Jobs billed before
// this existed only have a history of entries, so fall back to summing those.


function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, color: 'var(--text-light)' }}>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Price entry — shows a "$" prefix, always editable
function MoneyInput({ value, onChange, onKeyDown }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--text-light)', flexShrink: 0 }}>$</span>
      <input
        type="number" step="0.01" inputMode="decimal" value={draft}
        onFocus={() => setFocused(true)}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { setFocused(false); if (draft !== (value ?? '')) onChange(draft) }}
        onKeyDown={onKeyDown} placeholder="0.00" style={{ ...plainInputStyle, textAlign: 'right' }}
      />
    </div>
  )
}

// Computed line cost — always shown as a $0.00-formatted, read-only value
function CostDisplay({ qty, price }) {
  const cost = (Number(qty) || 1) * (Number(price) || 0)
  return <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{money(cost)}</span>
}

function MaterialColumnHeader({ indent = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `8px 16px 4px ${16 + indent}px`, background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Qty</span>
        <span style={colHeaderStyle}>Part no.</span>
        <span style={colHeaderStyle}>Description</span>
        <span style={colHeaderStyle}>UOM</span>
        <span style={colHeaderStyle}>Price per</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Cost</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

// Same material entered twice: a line typed in / taken from stock / ticked on
// the PO quote that matches a line on a packing slip (same qty and price, a
// word in common). Returns the slip entry it matches, or null.
const nameWords = t => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9"/ ]/g, ' ').split(/\s+/).filter(w => w.length >= 3))
function findSlipDuplicate(e, entries) {
  if (String(e.orderKey || '').startsWith('slip:')) return null
  const q = Number(e.qty) || 0, pr = Number(e.price) || 0
  if (!q) return null
  const mine = nameWords(`${e.partNo || ''} ${e.item || ''}`)
  return entries.find(x => x !== e && String(x.orderKey || '').startsWith('slip:') && Math.abs((Number(x.qty) || 0) - q) < 0.001
    && Math.abs((Number(x.price) || 0) - pr) < 0.011 && [...nameWords(`${x.partNo || ''} ${x.item || ''}`)].some(w => mine.has(w))) || null
}
function DupWarning({ entry, slip, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 16px 5px 16px', background: '#fdecea', fontSize: 11.5, color: '#a12a1e' }}>
      <span style={{ flex: 1 }}>⚠ Counted twice? Same qty and price as <b>{slip.item}</b> on {slip.source || 'a packing slip'}.</span>
      <ConfirmDeleteButton onConfirm={onRemove} ariaLabel="Remove duplicate" confirmText={`Remove "${entry.item}" from this job? The packing slip line stays.${entry.stockId ? ' Its qty goes back into Stock.' : ''}`}
        triggerLabel="Remove this one" label="Remove" style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 5, border: '1px solid #c0392b', background: '#fff', color: '#c0392b', cursor: 'pointer' }} />
    </div>
  )
}
// Read-only: lines from slips (set in "Slips — what came in" above) and PO quotes
function FromSlipsList({ entries, dupOf, onDelete, onSlipQty }) {
  const [open, setOpen] = useState(true)
  if (!entries.length) return null
  const sum = materialsTotal(entries)
  const groups = new Map()
  entries.forEach(e => { const k = e.source || (String(e.orderKey || '').startsWith('slip:') ? 'Packing slip' : 'PO quote'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e) })
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 16px', background: '#f3f7fc', cursor: 'pointer' }}>
        <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-mid)' }}>🧾 From slips &amp; orders ({entries.length})</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-light)' }}>Change the qty to what was used here — the rest shows below to use or send to Stock</span>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{money(sum)}</span>
      </div>
      {open && [...groups.entries()].map(([src, list]) => (
        <div key={src}>
          <div style={{ padding: '4px 16px 2px', fontSize: 10.5, fontWeight: 700, color: '#1a5fa0' }}>{src}</div>
          {list.map(e => {
            const fromQuote = !String(e.orderKey || '').startsWith('slip:')
            const dup = fromQuote ? dupOf(e) : null
            return (
              <div key={e.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 16px', fontSize: 12.5 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center', color: 'var(--text-mid)' }}>
                    {e.slipOrderId && onSlipQty
                      ? <BufferedInput type="number" inputMode="decimal" value={e.qty} onCommit={v => onSlipQty(e, v)} onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur() }}
                          title="Qty used on this job — what's left stays on the slip to use or send to Stock" style={{ ...plainInputStyle, textAlign: 'center', background: '#fff' }} />
                      : <span style={{ textAlign: 'center' }}>{e.qty}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.partNo || '—'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }} title={e.item}>{e.item}</span>
                    <span style={{ textAlign: 'center' }}>{e.uom || '—'}</span>
                    <span>{money(e.price)}</span>
                    <CostDisplay qty={e.qty} price={e.price} />
                  </div>
                  {fromQuote
                    ? <ConfirmDeleteButton onConfirm={() => onDelete(e.id)} style={delBtnStyle} ariaLabel="Remove line" confirmText="Take this PO-quote line off the job?" />
                    : <span style={{ width: 22, flexShrink: 0 }} />}
                </div>
                {dup && <DupWarning entry={e} slip={dup} onRemove={() => onDelete(e.id)} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Searchable Stock picker for a plan line: type part #, nickname or words
// (any order); best matches for the line come first. Enter picks the top one.
function StockPickSearch({ stock, line, onPick, onClose }) {
  const [q, setQ] = useState(line.partNo || '')
  const [hi, setHi] = useState(0)
  const wrapRef = useRef(null)
  useEffect(() => {
    const away = ev => { if (wrapRef.current && !wrapRef.current.contains(ev.target)) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  const all = (stock || []).filter(x => Number(x.qty) > 0)
  let list = q.trim() ? all.filter(x => hit([x.nickname, x.name, x.partNo, x.category], q)) : all
  // nothing for the part #? fall back to the line's own words
  if (!list.length && q === (line.partNo || '') && line.item) list = all.filter(x => hit([x.nickname, x.name, x.partNo, x.category], line.item.split(/\s+/).slice(0, 2).join(' ')))
  list = list.slice().sort((a, b) => String(a.nickname || a.name).localeCompare(String(b.nickname || b.name))).slice(0, 40)
  const pick = x => x && onPick(x.id)
  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input autoFocus value={q} onChange={ev => { setQ(ev.target.value); setHi(0) }} placeholder="Search Stock — part #, name, nickname…"
        onKeyDown={ev => {
          if (ev.key === 'Escape') onClose()
          if (ev.key === 'ArrowDown') { ev.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
          if (ev.key === 'ArrowUp') { ev.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          if (ev.key === 'Enter') { ev.preventDefault(); pick(list[hi]) }
        }}
        style={{ fontSize: 12, width: 260, border: '1px solid var(--blue, #2563eb)', borderRadius: 6, padding: '4px 8px' }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 2, width: 420, maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.14)' }}>
        {list.length ? list.map((x, i) => (
          <div key={x.id} onMouseDown={ev => { ev.preventDefault(); pick(x) }} onMouseEnter={() => setHi(i)}
            style={{ display: 'flex', gap: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, background: i === hi ? '#e8f2fc' : 'transparent', borderBottom: '1px solid var(--border)' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{x.nickname || x.name}</b>
              <span style={{ color: 'var(--text-light)' }}>{x.partNo ? ' · ' + x.partNo : ''}{x.nickname && x.name && x.name !== x.nickname ? ' · ' + x.name : ''}</span>
            </span>
            <span style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#1e7a34' }}>{x.qty} {x.uom || ''}</span>
          </div>
        )) : <div style={{ padding: 10, fontSize: 12, color: 'var(--text-light)' }}>No Stock item matches “{q}”.</div>}
      </div>
    </span>
  )
}

function MaterialEntryRow({ entry, onUpdate, onDelete }) {
  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <BufferedInput type="number" inputMode="decimal" value={entry.qty} onCommit={v => onUpdate({ qty: v })}
          placeholder="1" style={{ ...plainInputStyle, textAlign: 'center' }} />
        <BufferedInput value={entry.partNo} onCommit={v => onUpdate({ partNo: v })}
          placeholder="—" style={plainInputStyle} />
        <BufferedInput value={entry.item} onCommit={v => onUpdate({ item: v })}
          placeholder="Description" style={plainInputStyle} />
        <BufferedInput value={entry.uom} onCommit={v => onUpdate({ uom: v })}
          placeholder="—" style={{ ...plainInputStyle, textAlign: 'center' }} />
        <MoneyInput value={entry.price ?? ''} onChange={v => onUpdate({ price: v })} />
        <CostDisplay qty={entry.qty} price={entry.price} />
      </div>
      {(entry.stockId || entry.stockPick) && (
        <span title={entry.stockId ? 'Taken out of Stock — changing the qty or deleting this line puts the difference back' : 'Picked from Stock — taken off the shelf when moved to Actual'}
          style={{ fontSize: 9.5, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '1px 6px', flexShrink: 0, textTransform: 'uppercase' }}>Stock</span>
      )}
      <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete item" confirmText={entry.stockId ? 'Delete this material entry? Its qty goes back into Stock.' : 'Delete this material entry?'} />
    </div>
  )
}

// Materials search now pulls from the real Catalog + Stock lists (Materials hub),
// searching Catalog first for reference pricing, then Stock for what's actually on hand.
function useMaterialSearchList() {
  const [catalog, setCatalog] = useLocalStore('material_catalog', [])
  const [stock, setStock] = useLocalStore('material_stock', [])

  const fromStock = stock.map(s => ({ id: s.id, name: s.name, partNo: s.partNo, nickname: s.nickname, uom: s.uom, price: s.cost, qty: s.qty, paidForQty: s.paidForQty, source: 'stock' }))
  // If the same item exists in both, only surface the Stock version — it's
  // strictly more useful here (still has the price, and is the one that can
  // actually be deducted), and showing both invites picking the wrong one.
  const stockKeys = new Set(fromStock.map(s => (s.partNo || s.name || '').toLowerCase()))
  const fromCatalog = catalog
    .filter(c => !stockKeys.has((c.partNo || c.name || '').toLowerCase()))
    .map(c => ({ id: c.id, name: c.name, partNo: c.partNo, alts: partNosOf(c).join(' '), nickname: c.nickname, uom: c.uom, price: c.refCost, source: 'catalog' }))
  return { list: [...fromStock, ...fromCatalog], stock, setCatalog, setStock }
}

function MaterialAddRow({ onAdd, drawStock = true, fullPrice = false }) {
  const [qty, setQty] = useState('')
  const [partNo, setPartNo] = useState('')
  const [item, setItem] = useState('')
  const [uom, setUom] = useState('')
  const [price, setPrice] = useState('')
  const [kind, setKind] = useState('custom')
  const [pickedStockId, setPickedStockId] = useState(null)
  const [pickedPaidForQty, setPickedPaidForQty] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [askCatalog, setAskCatalog] = useState(false)

  const { list: searchList, stock, setCatalog, setStock } = useMaterialSearchList()
  const q = item.trim().toLowerCase()
  const matches = q ? searchList.filter(s =>
    hit([s.name, s.nickname, s.partNo, s.alts], q)
  ).slice(0, 6) : []

  function pick(stockItem) {
    setItem(stockItem.name)
    setPartNo(stockItem.partNo || '')
    setUom(stockItem.uom || '')
    setPrice(stockItem.price != null ? String(stockItem.price) : '')
    setKind('stock')
    setPickedStockId(stockItem.source === 'stock' ? stockItem.id : null)
    setPickedPaidForQty(stockItem.source === 'stock' ? (Number(stockItem.paidForQty) || 0) : 0)
    setShowDropdown(false)
  }

  function handleItemChange(v) {
    setItem(v)
    setKind('custom') // typing manually — only an explicit pick marks it stock
    setPickedStockId(null)
    setPickedPaidForQty(0)
    setShowDropdown(true)
  }

  const [justAdded, setJustAdded] = useState(null) // null | { deducted: bool, remaining: number }

  function finalize(addToCatalog) {
    const usedQty = qty ? Number(qty) : 1
    const enteredPrice = price ? Number(price) : 0
    const base = { kind, item: item.trim(), partNo: partNo.trim(), uom: uom.trim(), qty: usedQty, price: enteredPrice, addToCatalog: !!addToCatalog }

    // Picked straight from Stock — it's being used on this job, so take it off
    // the shelf (the paid-for amount first, at no cost). The line remembers
    // what it drew, so editing or deleting it later puts the difference back.
    let remaining = null, freeQty = 0
    if (pickedStockId && drawStock) {
      const res = drawFromStock(stock, pickedStockId, usedQty)
      if (res.fields) {
        freeQty = res.fields.stockFree
        remaining = res.remaining
        setStock(res.list)
        onAdd({ ...base, ...res.fields, stockUnit: enteredPrice, price: fullPrice ? enteredPrice : usedQty > 0 ? Math.round(((usedQty - freeQty) * enteredPrice / usedQty) * 10000) / 10000 : 0 })
      } else onAdd(base)
    } else if (pickedStockId) {
      onAdd({ ...base, stockPick: pickedStockId }) // planned list: nothing leaves Stock yet
    } else onAdd(base)
    // A genuinely new/custom item they chose to keep for future reference
    if (addToCatalog && kind === 'custom') {
      setCatalog(list => [...list, {
        id: uid(), name: item.trim(), partNo: partNo.trim(), uom: uom.trim(), refCost: price ? Number(price) : 0, category: '',
      }])
    }
    setJustAdded({ deducted: !!pickedStockId && drawStock && remaining != null, remaining, freeQty })
    setTimeout(() => setJustAdded(null), 3000)
    setQty(''); setPartNo(''); setItem(''); setUom(''); setPrice('')
    setKind('custom'); setPickedStockId(null); setPickedPaidForQty(0); setShowDropdown(false); setAskCatalog(false)
  }

  function submit() {
    if (!item.trim()) return
    if (kind === 'custom') setAskCatalog(true) // not from stock — check if it should be saved for next time
    else finalize(false)
  }

  const onKey = e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') setShowDropdown(false)
  }

  if (askCatalog) {
    return (
      <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16, background: 'var(--surface-2)', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
          Add "<strong>{item}</strong>" to your catalog for future reference?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => finalize(false)}
            style={{ flex: 1, padding: '8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
          >
            No, just this job
          </button>
          <button
            onClick={() => finalize(true)}
            style={{ flex: 1, padding: '8px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--navy)' }}
          >
            Yes, add to catalog
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16, background: 'var(--surface-2)', position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: MATERIAL_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
          placeholder="1" onKeyDown={onKey} style={{ ...plainInputStyle, textAlign: 'center' }} />
        <input value={partNo} onChange={e => setPartNo(e.target.value)}
          placeholder="—" onKeyDown={onKey} style={plainInputStyle} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, position: 'relative' }}>
          <SearchIcon />
          <input
            value={item}
            onChange={e => handleItemChange(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
            placeholder="Type an item…"
            onKeyDown={onKey}
            style={plainInputStyle}
          />
          {showDropdown && matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              zIndex: 20, maxHeight: 160, overflowY: 'auto',
            }}>
              {matches.map(m => (
                <div
                  key={`${m.source}-${m.id || m.partNo || m.name}`}
                  onMouseDown={() => pick(m)}
                  style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {m.nickname ? (
                      <>
                        <span style={{ fontWeight: 700 }}>{m.nickname}</span>
                        <span style={{ color: 'var(--text-light)' }}> — {m.name}</span>
                      </>
                    ) : m.name}
                  </span>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, flexShrink: 0, borderRadius: 20, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '.03em',
                    color: m.source === 'stock' ? '#1e7a34' : 'var(--text-light)',
                    background: m.source === 'stock' ? '#e6f4ea' : 'var(--surface-2)',
                  }}>
                    {m.source === 'stock' ? `Stock · ${m.qty || 0} on hand${Number(m.paidForQty) > 0 ? ` (${m.paidForQty} free)` : ''}`
                      : 'Catalog'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <input value={uom} onChange={e => setUom(e.target.value)}
          placeholder="—" onKeyDown={onKey} style={{ ...plainInputStyle, textAlign: 'center' }} />
        <MoneyInput value={price} onChange={setPrice} onKeyDown={onKey} />
        <CostDisplay qty={qty} price={price} />
      </div>
      <button onClick={submit} style={{ ...delBtnStyle, color: 'var(--accent-dim)', fontSize: 17, fontWeight: 700 }} aria-label="Add item">+</button>
      {justAdded && (
        <div style={{ position: 'absolute', bottom: '100%', right: 8, marginBottom: 4, fontSize: 11, fontWeight: 700, color: '#fff', background: justAdded.deducted ? '#1e7a34' : 'var(--navy)', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.2)' }}>
          {justAdded.deducted ? `✓ Added — Stock now ${justAdded.remaining}${justAdded.freeQty > 0 ? ' · free' : ''}` : '✓ Added to job'}
        </div>
      )}
    </div>
  )
}

// ── Orders & POs filed to this job ──
// Every quote (or each quote of a split PO) filed to this job in Orders & POs
// shows here. Tick the whole quote, or open it and tick only the lines you
// used (and change the qty if you used part of a line). Ticked lines count in
// the job's materials cost (entries with kind 'order').
const lineKey = (p, l) => `${p.key}#L${l.n}`
const belongsTo = (e, p) => e.orderKey === p.key || String(e.orderKey || '').startsWith(p.key + '#L')

function OrderLinesForJob({ project, entries, onSetEntries }) {
  const rows = useOrdersFeed()
  const [msg, setMsg] = useState(null)
  const [open, setOpen] = useState({})
  // One purchase, one place to charge it: once packing slips are in for a
  // PO, the job is charged from the slip lines (what actually came) and the
  // quote here is just what was expected.
  const [matOrders, setMatOrders] = useLocalStore('material_orders', [])
  // a quote opened in Materials (Parsed details & jobs) is charged from there
  const parts = partsForJob(rows, project.name).filter(p => !matOrders.some(m => m.feedKey === p.key))
  const slipsFor = p => {
    const k = normPo(p.order.poNumber)
    return k ? matOrders.filter(m => slipKind(m) === 'order' && normPo(m.poNumber) === k) : []
  }
  // Quote lines charged before the slips came in → move to the slip lines
  function switchToSlips(p) {
    const slips = slipsFor(p)
    const quoteEntries = entries.filter(e => belongsTo(e, p))
    let rest = entries.filter(e => !belongsTo(e, p))
    const nextOrders = matOrders.map(o => ({ ...o, lineItems: [...(o.lineItems || [])] }))
    quoteEntries.forEach(e => {
      for (const o of nextOrders.filter(x => slips.some(s => s.id === x.id))) {
        const idx = o.lineItems.findIndex(li => sameItem({ partNo: li.partNo, name: li.name }, { partNo: e.partNo, name: e.item }))
        if (idx < 0) continue
        const li = o.lineItems[idx]
        const use = { ...lineUse(o, li) }
        if (Number(use[project.id]) > 0) break // the slip already charges this job
        const take = Math.min(Number(e.qty) || 0, lineRemaining(o, li))
        if (take <= 0) break
        use[project.id] = take
        o.lineItems[idx] = { ...li, usedBy: use, ...(lineJobsOf(o, li).includes(project.id) ? {} : { jobIds: [...new Set([...lineJobsOf(o, li), project.id])] }) }
        rest = [...rest.filter(x => x.orderKey !== slipLineKey(o.id, li, idx)), slipEntry(o, o.lineItems[idx], idx, take, uid)]
        break
      }
    })
    setMatOrders(nextOrders)
    onSetEntries(rest)
  }
  const orderEntries = entries.filter(e => e.kind === 'order' && !e.slipOrderId)
  const byKey = new Map(orderEntries.map(e => [e.orderKey, e]))
  const stale = orderEntries.filter(e => !parts.some(p => belongsTo(e, p)))
  if (parts.length === 0 && stale.length === 0) return null

  function label(p) {
    const o = p.order
    return [o.supplier, p.number && (/^order/i.test(p.number) ? p.number : `Quote ${p.number}`), o.poNumber && `PO ${o.poNumber}`].filter(Boolean).join(' · ')
  }
  function lineEntry(p, l, qty) {
    const unit = l.qty ? l.ext / l.qty : l.ext
    return {
      id: uid(), kind: 'order', orderKey: lineKey(p, l), qty: qty != null ? qty : (l.qty || 1), uom: l.uom || '',
      partNo: l.partNo || '', item: l.desc || l.partNo || 'Material', price: Math.round(unit * 10000) / 10000,
      source: label(p),
    }
  }
  // Whole quote on/off. With line items, "on" means every line.
  function toggleWhole(p, on) {
    const rest = entries.filter(e => !belongsTo(e, p))
    if (!on) { onSetEntries(rest); return }
    if (p.lines.length) {
      onSetEntries([...rest, ...p.lines.map(l => lineEntry(p, l))])
    } else {
      const o = p.order
      onSetEntries([...rest, {
        id: uid(), kind: 'order', orderKey: p.key, qty: 1, uom: 'lot',
        partNo: p.number || '', item: [label(p), o.description].filter(Boolean).join(' — '),
        price: Number(p.total) || 0, source: label(p),
      }])
    }
  }
  function toggleLine(p, l, on) {
    // Picking lines replaces a whole-quote entry made before lines were known.
    const rest = entries.filter(e => e.orderKey !== lineKey(p, l) && e.orderKey !== p.key)
    onSetEntries(on ? [...rest, lineEntry(p, l)] : rest)
  }
  function setQty(e, v) {
    onSetEntries(entries.map(x => x.id === e.id ? { ...x, qty: v === '' ? '' : Number(v) } : x))
  }
  function setAmount(e, v) {
    onSetEntries(entries.map(x => x.id === e.id ? { ...x, price: Number(v) || 0 } : x))
  }
  async function openPdf(number) {
    setMsg(null)
    const r = await openQuotePdf(number)
    if (!r || !r.ok) setMsg(`Quote ${number} isn't in Quote Slips yet.`)
  }
  const cost = e => (Number(e.qty) || 0) * (Number(e.price) || 0)

  const applied = orderEntries.reduce((a, e) => a + cost(e), 0)
  const small = { fontSize: 11.5, color: 'var(--text-light)' }
  const num = { padding: '3px 5px', fontSize: 12, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 16px 4px' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: '.04em' }}>📑 From Orders &amp; POs</span>
        <span style={{ flex: 1, ...small }}>Purchases for this job. Before the slips come in, tick the quote (or only the lines used); once they're in, the slips are what's charged.</span>
        {orderEntries.length > 0 && <span style={{ fontSize: 12, fontWeight: 700 }}>{money(applied)} applied</span>}
      </div>
      {parts.map(p => {
        const o = p.order
        const mine = orderEntries.filter(e => belongsTo(e, p))
        const whole = byKey.get(p.key)
        const picked = p.lines.filter(l => byKey.has(lineKey(p, l)))
        const all = whole || (p.lines.length > 0 && picked.length === p.lines.length)
        const some = !all && picked.length > 0
        const partApplied = mine.reduce((a, e) => a + cost(e), 0)
        const isOpen = !!open[p.key]
        const slips = slipsFor(p)
        const slipNote = slips.length > 0 && (
          <div style={{ fontSize: 11.5, color: '#1e7a34', marginTop: 2 }}>
            🧾 {slips.length} slip{slips.length === 1 ? '' : 's'} in ({slips.map(s => `${s.invoiceNumber ? 'Inv ' + s.invoiceNumber : 'slip'} ${money((s.lineItems || []).reduce((a, li) => a + (Number(li.totalPrice) || 0), 0))}`).join(', ')}) — charge this job from the slip lines below.
            {mine.length > 0 && (
              <span style={{ color: '#9a6610', fontWeight: 700 }}> ⚠ {money(partApplied)} was also charged from the quote.{' '}
                <button onClick={() => switchToSlips(p)} style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999, border: '1px solid #9a6610', background: '#fff', color: '#9a6610', cursor: 'pointer' }}>Switch to slips</button>
              </span>
            )}
          </div>
        )
        return (
          <div key={p.key} style={{ borderTop: '1px solid var(--border-light, #eef0f3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px' }}>
              {slips.length > 0 ? <span title="Charged from the slips" style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>📑</span> :
              <input type="checkbox" checked={!!all} ref={el => { if (el) el.indeterminate = some }}
                onChange={ev => toggleWhole(p, ev.target.checked)}
                title={all ? 'Counted in materials cost — untick to remove' : 'Add the whole quote to materials cost'}
                style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                  {o.supplier}
                  {p.number && <> · {/^order/i.test(p.number) ? '' : 'Quote '}
                    <a href="#" onClick={ev => { ev.preventDefault(); openPdf(p.number) }} title="Open the quote PDF"
                      style={{ color: 'var(--blue, #2563eb)', fontWeight: 700, textDecoration: 'underline' }}>{p.number}</a></>}
                  {o.poNumber && <> · PO {o.poNumber}</>}
                  <span style={{ color: 'var(--text-light)' }}> · {o.status}</span>
                </div>
                <div style={{ ...small, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.description}
                  {p.lines.length > 0 && (
                    <button onClick={() => setOpen(s => ({ ...s, [p.key]: !s[p.key] }))}
                      style={{ marginLeft: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--blue, #2563eb)', fontSize: 11.5, fontWeight: 700 }}>
                      {isOpen ? '▾' : '▸'} {p.lines.length} line{p.lines.length === 1 ? '' : 's'}{some ? ` · ${picked.length} picked` : ''}{slips.length ? ' (quoted)' : ''}
                    </button>
                  )}
                </div>
                {slipNote}
              </div>
              {whole ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>$
                  <input type="number" step="0.01" value={whole.price} onChange={ev => setAmount(whole, ev.target.value)}
                    title="Amount counted for this job (pre-tax)" style={{ ...num, width: 90 }} />
                </span>
              ) : (
                <span style={{ fontSize: 12.5, flexShrink: 0, color: mine.length ? 'var(--text)' : (p.total ? 'var(--text-mid)' : 'var(--text-light)') }}>
                  {mine.length ? <b>{money(partApplied)}</b> : (p.total ? money(p.total) : 'total not in yet')}
                  {mine.length > 0 && p.total ? <span style={small}> of {money(p.total)}</span> : null}
                </span>
              )}
            </div>
            {isOpen && p.lines.length > 0 && (
              <div style={{ padding: '0 16px 8px 42px' }}>
                {whole && <div style={{ ...small, marginBottom: 4 }}>Added as one line — untick the quote above to pick lines instead.</div>}
                {p.lines.map(l => {
                  const e = byKey.get(lineKey(p, l))
                  return (
                    <div key={l.n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: whole ? 0.5 : 1 }}>
                      <input type="checkbox" disabled={!!whole || (slips.length > 0 && !e)} checked={!!e} onChange={ev => toggleLine(p, l, ev.target.checked)}
                        title={slips.length > 0 && !e ? 'Slips are in — use the slip lines below' : undefined}
                        style={{ width: 14, height: 14, cursor: whole ? 'default' : 'pointer', flexShrink: 0 }} />
                      {e ? (
                        <input type="number" step="any" value={e.qty} onChange={ev => setQty(e, ev.target.value)}
                          title={`Qty used (quoted ${l.qty} ${l.uom})`} style={{ ...num, width: 64 }} />
                      ) : (
                        <span style={{ width: 64, textAlign: 'right', fontSize: 12, color: 'var(--text-mid)' }}>{l.qty}</span>
                      )}
                      <span style={{ width: 34, fontSize: 11, color: 'var(--text-light)' }}>{l.uom}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${l.partNo} ${l.desc}`}>
                        {l.desc}{l.partNo ? <span style={{ color: 'var(--text-light)' }}> · {l.partNo}</span> : null}
                      </span>
                      <span style={{ width: 80, textAlign: 'right', fontSize: 12, color: e ? 'var(--text)' : 'var(--text-light)', fontWeight: e ? 700 : 400 }}>
                        {money(e ? cost(e) : l.ext)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {stale.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', opacity: 0.8 }}>
          <input type="checkbox" checked onChange={() => onSetEntries(entries.filter(x => x.id !== e.id))}
            title="No longer filed to this job — untick to remove" style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <div style={{ flex: 1, fontSize: 12.5 }}>{e.source ? `${e.source} — ` : ''}{e.item} <span style={{ color: 'var(--text-light)' }}>(no longer filed to this job)</span></div>
          <span style={{ fontSize: 12.5 }}>{money(cost(e))}</span>
        </div>
      ))}
      {msg && <div style={{ fontSize: 12, color: 'var(--text-mid)', padding: '0 16px 8px' }}>📄 {msg}</div>}
      <div style={{ height: 6 }} />
    </div>
  )
}

function MaterialsActual({ project, onUpdate }) {
  const entries = project.materialEntries || []
  const [stock, setStock] = useLocalStore('material_stock', [])
  const [matOrders, setMatOrders] = useLocalStore('material_orders', [])
  // Charged from a parsed quote whose packing slips have since come in: charge
  // from the slips instead (so the qty can be changed and the rest sent to Stock)
  const feedForCharges = useOrdersFeed()
  useEffect(() => {
    let acc = matOrders || [], job = project, any = false, ordersChanged = false, taken = []
    for (const step of [o => moveQuoteChargesToSlips(o, job, uid), o => moveFeedChargesToSlips(o, job, feedForCharges, uid)]) {
      const r = step(acc)
      if (!r) continue
      acc = r.orders; ordersChanged = ordersChanged || r.ordersChanged; taken = [...taken, ...r.stockTaken]
      job = { ...job, materialEntries: r.entries }; any = true
    }
    if (!any) return
    if (ordersChanged) setMatOrders(acc)
    if (taken.length) setStock(list => taken.reduce((a, x) => takeFromStock(a, x.li, x.qty), list || []))
    onUpdate({ materialEntries: job.materialEntries, actualMaterials: materialsTotal(job.materialEntries) })
  }, [project.id, matOrders, feedForCharges, (project.materialEntries || []).length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Qty on a slip line changed here: the slip's line follows
  function setSlipQty(e, v) {
    const r = setSlipLineUse(matOrders || [], e, project.id, v, uid)
    if (!r) return
    setMatOrders(r.orders)
    const next = r.entry ? entries.map(x => x.id === e.id ? r.entry : x) : entries.filter(x => x.id !== e.id)
    onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })
  }
  const listed = entries.filter(e => e.kind !== 'order')
  const setEntries = next => onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })

  function addEntry(data) {
    const next = [...entries, { id: uid(), ...data }]
    onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })
  }
  function updateEntry(id, patch) {
    const e0 = entries.find(e => e.id === id)
    let extra = {}
    // A line that came out of Stock: changing its qty moves the difference in/out of Stock
    if (e0?.stockId && 'qty' in patch) {
      const res = adjustStockDraw(stock, e0, patch.qty)
      if (res.list !== stock) setStock(res.list)
      extra = res.patch
      if (chargesFullStock(project) && e0.stockUnit != null) extra = { ...extra, price: Number(e0.stockUnit) || 0 }
    }
    if (e0?.stockId && 'price' in patch && !('qty' in patch)) extra = { stockUnit: Number(patch.price) || 0, stockFree: 0 }
    const next = entries.map(e => e.id === id ? { ...e, ...patch, ...extra } : e)
    onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })
  }
  function deleteEntry(id) {
    const e0 = entries.find(e => e.id === id)
    if (e0?.stockId) {
      const res = adjustStockDraw(stock, e0, 0) // deleting a stock line puts it back on the shelf
      if (res.list !== stock) setStock(res.list)
    }
    const next = entries.filter(e => e.id !== id)
    onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })
  }

  const total = materialsTotal(entries)
  // Lines that came in on slips / PO quotes — on the job (and in the total),
  // listed here too so everything billed shows in one place
  const fromSlips = entries.filter(e => e.kind === 'order')
  const dupOf = e => findSlipDuplicate(e, entries)
  // T&M: stock lines taken at no cost before ("already paid for") get their price back
  const tmFree = chargesFullStock(project) ? entries.filter(e => e.stockId && Number(e.stockFree) > 0 && Number(e.stockUnit) > 0 && (Number(e.price) || 0) < Number(e.stockUnit)) : []
  useEffect(() => {
    if (!tmFree.length) return
    const ids = new Set(tmFree.map(e => e.id))
    const next = entries.map(e => ids.has(e.id) ? { ...e, price: Number(e.stockUnit) || 0 } : e)
    onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) })
  }, [tmFree.length, project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <OrderLinesForJob project={project} entries={entries} onSetEntries={setEntries} />
      <SlipLinesForJob project={project} entries={entries} onSetEntries={setEntries} />
      <MaterialColumnHeader />
      {listed.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          No materials logged yet — add a stock or custom item below.
        </div>
      )}
      {listed.map(e => (
        <div key={e.id}>
          <MaterialEntryRow entry={e} onUpdate={patch => updateEntry(e.id, patch)} onDelete={() => deleteEntry(e.id)} />
          {dupOf(e) && <DupWarning entry={e} slip={dupOf(e)} onRemove={() => deleteEntry(e.id)} />}
        </div>
      ))}
      {(() => {
        const miss = project.lifecycleStatus === 'billed' ? [] : missingSlipCharges(matOrders || [], project)
        if (!miss.length) return null
        const total = miss.reduce((a, m) => a + m.value, 0)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', background: '#fff8e6', borderTop: '1px solid #e0a716', borderBottom: '1px solid #e0a716', fontSize: 12.5 }}>
            <span style={{ flex: 1, color: '#8a5d00' }}>⚠ <b>{miss.length} slip line{miss.length === 1 ? '' : 's'}</b> tagged to this job {miss.length === 1 ? "isn't" : "aren't"} on its list{total ? ` (${'$' + total.toFixed(2)})` : ''}: {miss.slice(0, 4).map(m => `${m.qty} ${m.li.partNo || m.li.name}`).join(', ')}{miss.length > 4 ? '…' : ''}</span>
            <button onClick={() => { const next = addMissingSlipCharges(matOrders || [], project, uid); if (next) onUpdate({ materialEntries: next, actualMaterials: materialsTotal(next) }) }}
              style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#1e7a34', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>✓ Add to job</button>
          </div>
        )
      })()}
      <FromSlipsList entries={fromSlips} dupOf={dupOf} onDelete={deleteEntry} onSlipQty={setSlipQty} />
      <MaterialCloseout project={project} onUpdate={onUpdate} compact title="Left on this job's slips — used here, or back to Stock?" />
      <MaterialAddRow onAdd={addEntry} fullPrice={chargesFullStock(project)} />
      {entries.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>Actual materials cost</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>{money(total)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Editable shopping list pre-filled from the approved quote. Add, edit or
// remove lines freely as the job changes; nothing here counts toward actual
// cost until a line is moved to Materials Actual.
const PLAN_TONE = {
  ok: { bg: '#e6f4ea', fg: '#1e7a34' }, info: { bg: '#e8f0fb', fg: '#1a5fa0' }, warn: { bg: '#fff3d6', fg: '#8a5d00' },
  bad: { bg: '#fdecea', fg: '#a12a1e' }, muted: { bg: 'var(--surface-2)', fg: 'var(--text-mid)' },
}

// The job's material plan: everything it needs, each line from 📦 Stock
// (reserved off the shelf) or 🚚 Order (onto the shared order sheet, then
// sent / phoned in, quoted, PO, received) — with where each line is at.
function MaterialsPlanned({ project, onUpdate, quotesStore, customer }) {
  const planned = project.plannedMaterials || []
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const actual = project.materialEntries || []
  const [stock, setStock] = useLocalStore('material_stock', [])
  const [orders] = useLocalStore('material_orders', [])
  const [requests] = useLocalStore(PLAN_REQUESTS_KEY, [])
  const [orderList, setOrderList] = useLocalStore(ORDER_LIST_KEY, [])
  const feedRows = useOrdersFeed()
  const jobsAll = useHubStore({ hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name, customersKey: 'job_customers', recordsKey: 'job_projects' }).records
  const [msg, setMsg] = useState('')
  const [pickFor, setPickFor] = useState('')
  const setPlanned = next => onUpdate(cur => ({ plannedMaterials: typeof next === 'function' ? next(cur.plannedMaterials || []) : next }))
  const ctx = { orders: orders || [], requests: requests || [], feedRows: feedRows || [], orderList: orderList || [], stock: stock || [], jobs: jobsAll }
  const statusOf = e => planLineStatus(e, project, ctx)
  const statuses = planned.map(statusOf)
  const sum = planSummary(statuses)

  function addEntry(data) { setPlanned(l => [...l, { id: uid(), kind: 'custom', source: data.stockPick ? 'stock' : '', ...data }]) }
  function updateEntry(id, patch) { setPlanned(l => l.map(e => e.id === id ? { ...e, ...patch } : e)) }
  function deleteEntry(id) { setPlanned(l => l.filter(e => e.id !== id)) }
  // 📦 From Stock: reserve the best match on the shelf (or let you pick)
  function setSource(ids, source) {
    setPlanned(l => l.map(e => {
      if (!ids.includes(e.id)) return e
      if (source === 'stock') { const m = e.stockPick ? null : findStockFor(stock, e); return { ...e, source, ...(m ? { stockPick: m.id } : {}) } }
      const { stockPick, ...rest } = e
      return { ...rest, source }
    }))
  }
  function toOrderSheet(ids) {
    const lines = planned.filter(e => ids.includes(e.id))
    setOrderList(list => addPlanLinesToOrderList(list, project, lines, uid))
    setPlanned(l => l.map(e => ids.includes(e.id) ? { ...e, source: 'order', queuedAt: new Date().toISOString() } : e))
    setMsg(`${lines.length} line${lines.length === 1 ? '' : 's'} on the order sheet (Materials → Order Form), with any other jobs' lines for the same parts. Send or phone it in from there.`)
    setSelectedIds(new Set())
  }
  function moveToActual(ids) {
    const moving = planned.filter(e => ids.includes(e.id))
    if (!moving.length) return
    // Lines picked from Stock come off the shelf now that they're actually used
    let stockList = stock
    const moved = moving.map(e => {
      const { stockPick, source, queuedAt, ...rest } = e
      if (!stockPick) return { ...rest, id: uid() }
      const res = drawFromStock(stockList, stockPick, Number(e.qty) || 0)
      if (!res.fields) return { ...rest, id: uid() }
      stockList = res.list
      const q = Number(e.qty) || 0, unit = Number(e.price) || res.fields.stockUnit || 0
      return { ...rest, kind: 'stock', id: uid(), ...res.fields, stockUnit: unit, price: stockLinePrice(project, q, res.fields.stockFree, unit) }
    })
    if (stockList !== stock) setStock(stockList)
    onUpdate(cur => {
      const nextActual = [...(cur.materialEntries || []), ...moved]
      return { plannedMaterials: (cur.plannedMaterials || []).filter(e => !ids.includes(e.id)), materialEntries: nextActual, actualMaterials: materialsTotal(nextActual) }
    })
  }
  // Received order lines are charged from their packing slips already
  const clearReceived = () => setPlanned(l => l.filter(e => statusOf(e).id !== 'received'))
  function syncFromQuote() {
    const linked = getLinkedQuotes(project, quotesStore)
    const have = new Set([...planned, ...actual].map(e => e.sourceLineId).filter(Boolean))
    const fresh = linked.flatMap(q => quotePlannedMaterials(q)).filter(e => !e.sourceLineId || !have.has(e.sourceLineId)).map(e => ({ ...e, source: '' }))
    if (fresh.length === 0) { setMsg('Nothing new — every material line from the linked quote is already here.'); return }
    setPlanned(l => [...l, ...fresh])
    setMsg(`${fresh.length} line${fresh.length === 1 ? '' : 's'} added from the quote — set each to 📦 Stock or 🚚 Order.`)
  }

  const toggleSel = id => setSelectedIds(set => { const n2 = new Set(set); n2.has(id) ? n2.delete(id) : n2.add(id); return n2 })
  const checked = planned.filter(e => selectedIds.has(e.id))
  const exportItems = checked.map(e => ({ partNo: e.partNo, desc: e.item, uom: e.uom, qty: e.qty, planRefs: [{ jobId: project.id, jobName: project.name, lineId: e.id, qty: Number(e.qty) || 0 }] }))
  const jobFolder = customer ? `Jobs/${customer.folder}/${project.folder}/Files` : 'Jobs/Materials Orders'
  const total = materialsTotal(planned)
  const btn = { fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: '#fff', color: 'var(--navy)', cursor: 'pointer', whiteSpace: 'nowrap' }
  const seg = on => ({ fontSize: 11, fontWeight: 700, padding: '3px 8px', border: '1px solid var(--border)', background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--text-mid)', cursor: 'pointer' })
  const chip = (label, val, tone) => val ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 12, background: PLAN_TONE[tone].bg, color: PLAN_TONE[tone].fg }}>{val} {label}</span> : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', background: 'var(--surface)' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{sum.total} line{sum.total === 1 ? '' : 's'}</span>
        {chip('need you', sum.needs, 'warn')}
        {chip('from Stock', sum.stock, 'ok')}
        {chip('being ordered', sum.ordering, 'info')}
        {chip('on PO', sum.onPo, 'info')}
        {chip('received', sum.received, 'ok')}
        <span style={{ flex: 1 }} />
        <button style={btn} onClick={syncFromQuote}>↻ Add missing from quote</button>
        {sum.received > 0 && <button style={btn} onClick={clearReceived} title="Received lines are already charged from their packing slips">Clear received ({sum.received})</button>}
      </div>
      {msg && <div onClick={() => setMsg('')} style={{ padding: '6px 16px', fontSize: 12, background: '#e8f0fb', color: '#1a5fa0', cursor: 'pointer' }}>{msg}</div>}
      <MaterialColumnHeader indent={27} />
      {planned.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          Nothing planned yet. Lines fill in when a quote is approved — or use "Add missing from quote", or add them below.
        </div>
      )}
      {planned.map((e, i) => {
        const st = statuses[i]
        const tone = PLAN_TONE[st.tone] || PLAN_TONE.muted
        const sf = e.source === 'stock' && e.stockPick ? stockFree(stock, jobsAll, e.stockPick, e.id) : null
        const done = st.id === 'received'
        return (
          <div key={e.id} style={{ borderBottom: '1px solid var(--border)', background: done ? 'var(--surface-2)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSel(e.id)} aria-label="Select" style={{ width: 15, height: 15, margin: '0 0 0 12px', cursor: 'pointer', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <MaterialEntryRow entry={e} onUpdate={patch => updateEntry(e.id, patch)} onDelete={() => deleteEntry(e.id)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 7px 40px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex' }}>
                <button onClick={() => setSource([e.id], 'stock')} style={{ ...seg(e.source === 'stock'), borderRadius: '6px 0 0 6px' }}>📦 Stock</button>
                <button onClick={() => setSource([e.id], 'order')} style={{ ...seg(e.source === 'order'), borderRadius: '0 6px 6px 0', borderLeft: 'none' }}>🚚 Order</button>
              </span>
              <span title={st.detail || ''} style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 12, background: tone.bg, color: tone.fg }}>{st.label}</span>
              {st.detail && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{st.detail}</span>}
              {e.source === 'stock' && (
                pickFor === e.id
                  ? <StockPickSearch stock={stock} line={e} onPick={id => { updateEntry(e.id, { stockPick: id }); setPickFor('') }} onClose={() => setPickFor('')} />
                  : <a href="#" onClick={ev => { ev.preventDefault(); setPickFor(e.id) }} style={{ fontSize: 11.5, color: 'var(--blue, #2563eb)' }}>{sf ? (sf.item.nickname || sf.item.name) : 'pick item'}</a>
              )}
              <span style={{ flex: 1 }} />
              {e.source === 'order' && st.id === 'toorder' && <button onClick={() => toOrderSheet([e.id])} style={{ ...btn, padding: '3px 9px', fontSize: 11 }}>→ Order sheet</button>}
              {!done && e.source !== 'order' && <button onClick={() => moveToActual([e.id])} title={e.source === 'stock' ? 'Pulled off the shelf and used — comes off Stock' : 'Used — move to Materials Actual'} style={{ ...btn, padding: '3px 9px', fontSize: 11 }}>{e.source === 'stock' ? '✓ Pulled → Actual' : '→ Actual'}</button>}
            </div>
          </div>
        )
      })}
      <MaterialAddRow onAdd={data => addEntry(data)} drawStock={false} />
      {planned.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>Planned materials (at cost)</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{money(total)}</span>
        </div>
      )}
      {planned.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-light)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedIds.size === planned.length} onChange={ev => setSelectedIds(ev.target.checked ? new Set(planned.map(e => e.id)) : new Set())} style={{ width: 14, height: 14 }} />
              Select all
            </label>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text-light)' }}>{selectedIds.size} of {planned.length} checked</span>
            {checked.length > 0 && <>
              <button style={btn} onClick={() => setSource(checked.map(e => e.id), 'stock')}>📦 From Stock</button>
              <button style={btn} onClick={() => toOrderSheet(checked.map(e => e.id))}>🚚 Add to order sheet</button>
              <button style={btn} onClick={() => moveToActual(checked.filter(e => statusOf(e).id !== 'received').map(e => e.id))}>→ Actual</button>
            </>}
          </div>
          <details>
            <summary style={{ fontSize: 11.5, color: 'var(--text-light)', cursor: 'pointer' }}>Or send just this job's checked lines now</summary>
            <div style={{ marginTop: 8 }}>
              <WholesalerExportBar
                items={exportItems} date={todayLocal()}
                subjectPrefix={`Material order — ${customer ? customer.name + ' — ' : ''}${project.name || 'Job'}`}
                saveFolder={jobFolder} jobs={[{ id: project.id, name: project.name }]}
                emptyMessage="Check at least one planned line first."
              />
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

function MaterialsSection({ project, onUpdate, customer }) {
  const [tab, setTab] = useState('actual')
  const isQuoted = project.type === 'quoted'
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })


  function importMaterials(quote, items) {
    const entries = project.materialEntries || []
    const newEntries = items.map(m => ({
      id: uid(), kind: 'quoted', partNo: m.partNo || '', item: m.desc || '', uom: m.uom || '',
      qty: Number(m.qty) || 0, price: Number(m.rate) || 0,
    }))
    const nextEntries = [...entries, ...newEntries]
    onUpdate({ materialEntries: nextEntries, actualMaterials: materialsTotal(nextEntries) })
  }

  return (
    <div>
      <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setTab('actual')} style={laborTabBtnStyle(tab === 'actual')}>Materials Actual</button>
        <button onClick={() => setTab('planned')} style={laborTabBtnStyle(tab === 'planned')}>📋 Plan{(project.plannedMaterials || []).length ? ` (${(project.plannedMaterials || []).length})` : ''}</button>
        {isQuoted && <button onClick={() => setTab('quoted')} style={laborTabBtnStyle(tab === 'quoted')}>Quoted</button>}
      </div>
      {tab === 'actual' && <MaterialsActual project={project} onUpdate={onUpdate} />}
      {tab === 'planned' && <MaterialsPlanned project={project} onUpdate={onUpdate} quotesStore={quotesStore} customer={customer} />}
      {tab === 'quoted' && (
        <QuotedTabShell project={project} quotesStore={quotesStore} ViewComponent={QuotedMaterialsView} onImport={importMaterials} />
      )}
    </div>
  )
}

// ── Notes section ────────────────────────────────────────────────
function formatDateTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const irrelevantBtn = { fontSize: 10.5, fontWeight: 700, color: '#8a6d1f', background: '#fff8e6', border: '1px solid #e8cf8a', borderRadius: 20, padding: '2px 9px', cursor: 'pointer' }
// Notes filed from email get an "Irrelevant" button: it removes the note from
// the app only — the email itself is never touched, and since it was already
// decided in Assistant Update it won't come back.
const needsMeBtn = { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer', marginRight: 6, whiteSpace: 'nowrap' }
function NoteEntryRow({ note, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const fromEmail = note.source === 'email'

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v && v !== note.text) onUpdate({ text: v })
    else setDraft(note.text)
  }

  return (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 600 }}>{formatDateTime(note.timestamp)}{fromEmail ? ' · 📧 from email' : ''}</span>
        <span style={{ flex: 1 }} />
        {note.needsMe && note.addressedAt ? (
          <button onClick={() => onUpdate({ addressedAt: null })} title="Put it back on Needs you"
            style={{ ...needsMeBtn, border: '1px solid #9fd3ae', background: '#eef8f1', color: '#1e7a34' }}>✓ Addressed {formatDateTime(note.addressedAt).split(',')[0]}</button>
        ) : note.needsMe ? (
          <button onClick={() => onUpdate({ needsMe: false })} title="On your Needs you list (☀ Today) — click to take it off"
            style={{ ...needsMeBtn, border: '1px solid #e0a716', background: '#fff8e6', color: '#8a5d00' }}>⚑ On Needs you</button>
        ) : (
          <button onClick={() => onUpdate({ needsMe: true, needsMeAt: new Date().toISOString(), addressedAt: null })} title="Put this on your Needs you list (☀ Today) until you've dealt with it"
            style={needsMeBtn}>⚑ Move to Needs you</button>
        )}
        {fromEmail && (
          <ConfirmDeleteButton
            onConfirm={onDelete} ariaLabel="Irrelevant — remove this email note" triggerLabel="Irrelevant" label="Remove"
            confirmText="Remove this email note from the app? The email itself stays in Outlook."
            style={irrelevantBtn} wrapperStyle={{ marginRight: 6 }}
          />
        )}
        <ConfirmDeleteButton
          onConfirm={onDelete} ariaLabel="Delete note" confirmText="Delete this note?"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15, padding: '0 4px' }}
        />
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          rows={3}
          style={workTextareaStyle}
        />
      ) : (
        <div
          onClick={() => { setDraft(note.text); setEditing(true) }}
          style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap', cursor: 'text' }}
        >
          {note.text}
        </div>
      )}
    </div>
  )
}

const TIME_BUCKET_LABELS = { planning: 'Project planning / helping', shop: 'Shop / yard', travel: 'Travel / pickup', admin: 'Admin / quoting' }

function NotesSection({ project, onUpdate }) {
  const notes = project.notesLog || []
  const timeNotes = (project.trackedTime || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const [draft, setDraft] = useState('')

  function addNote(needsMe) {
    const text = draft.trim()
    if (!text) return
    const entry = { id: uid(), timestamp: new Date().toISOString(), text, ...(needsMe === true ? { needsMe: true, needsMeAt: new Date().toISOString() } : {}) }
    onUpdate({ notesLog: [entry, ...notes] })
    setDraft('')
  }
  function updateNote(id, patch) {
    onUpdate({ notesLog: notes.map(n => n.id === id ? { ...n, ...patch } : n) })
  }
  function deleteNote(id) {
    onUpdate({ notesLog: notes.filter(n => n.id !== id) })
  }

  const canAdd = draft.trim().length > 0

  return (
    <div>
      <div style={{ padding: 16 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Type a note…"
          rows={3}
          style={workTextareaStyle}
        />
        <button
          onClick={() => addNote(false)}
          disabled={!canAdd}
          style={{
            marginTop: 8, padding: '8px 16px', borderRadius: 'var(--rs)', border: 'none', fontSize: 13, fontWeight: 700,
            cursor: canAdd ? 'pointer' : 'default',
            background: canAdd ? 'var(--accent)' : 'var(--gray-light)',
            color: canAdd ? 'var(--navy)' : 'var(--text-light)',
          }}
        >
          Add note
        </button>
        <button onClick={() => addNote(true)} disabled={!canAdd} title="Add it and put it on your Needs you list (☀ Today) until you've dealt with it"
          style={{ marginTop: 8, marginLeft: 8, padding: '8px 14px', borderRadius: 'var(--rs)', fontSize: 13, fontWeight: 700, cursor: canAdd ? 'pointer' : 'default',
            border: '1px solid ' + (canAdd ? '#e0a716' : 'var(--border)'), background: canAdd ? '#fff8e6' : 'var(--surface)', color: canAdd ? '#8a5d00' : 'var(--text-light)' }}>
          ⚑ Add + put on Needs you
        </button>
        {notes.some(n => n.needsMe && !n.addressedAt) && <div style={{ fontSize: 11.5, color: '#8a5d00', marginTop: 6 }}>⚑ {notes.filter(n => n.needsMe && !n.addressedAt).length} note{notes.filter(n => n.needsMe && !n.addressedAt).length === 1 ? '' : 's'} on your Needs you list — tick them off there (☀ Today) when they're dealt with.</div>}
      </div>
      <NoteGroups notes={[...notes].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))} emptyText="No notes yet — add one above."
        renderRow={n => <NoteEntryRow key={n.id} note={n} onUpdate={patch => updateNote(n.id, patch)} onDelete={() => deleteNote(n.id)} />} />
      {timeNotes.length > 0 && (
        <div>
          {timeNotes.length > 0 && (
            <div style={{ padding: '10px 16px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
              ⏱ Tracked time — what was done each day (edit in Time Tracking)
            </div>
          )}
          {timeNotes.map(t => (
            <div key={t.id} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 2 }}>
                {new Date((t.date || '') + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}{(Number(t.totalHours) || 0).toFixed(2)} h{(t.workers || []).length ? ' · ' + t.workers.join(', ') : ''}
                {t.category ? ' · ' + (TIME_BUCKET_LABELS[t.category] || t.category) : ''}
              </div>
              <div>{t.note || <i style={{ color: 'var(--text-light)' }}>(no description)</i>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Same math as Quotes' own totals — materials/allowances/sub trades/other get
// 15% markup, labor doesn't. Duplicated here (not shared across files) same as
// the rest of this app's small per-page building blocks.
function qsMaterialsListText(items, label) {
  const qtyW = Math.max(3, ...items.map(i => String(i.qty || '').length))
  const partW = Math.max(7, ...items.map(i => String(i.partNo || '').length))
  const header = `${'QTY'.padEnd(qtyW)}  ${'PART NO'.padEnd(partW)}  DESCRIPTION`
  const rule = '-'.repeat(header.length)
  const lines = items.map(i =>
    `${String(i.qty || '').padEnd(qtyW)}  ${(i.partNo || '').padEnd(partW)}  ${i.desc || 'Item'}`
  )
  return ['MATERIALS TO ORDER', label || '', '', header, rule, ...lines].join('\n')
}

function qsMaterialsExportFileName(label) {
  const safe = String(label || 'Materials').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
  const date = todayLocal()
  return `${date} - ${safe} - Materials to Order.txt`
}

function qsTextToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)))
}

function QSCopyMaterialsButton({ materialsList, label, folderPath }) {
  const [state, setState] = useState('idle') // idle | working | done
  async function doExport() {
    setState('working')
    try {
      const text = qsMaterialsListText(materialsList, label)
      const base64 = qsTextToBase64(text)
      const fileName = qsMaterialsExportFileName(label)
      if (window.desktop) {
        const savedPath = await window.desktop.saveFile(folderPath, fileName, base64)
        if (savedPath) window.desktop.openFile(savedPath)
      } else {
        const link = document.createElement('a')
        link.href = `data:text/plain;base64,${base64}`
        link.download = fileName
        link.click()
      }
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }
  return (
    <button
      onClick={doExport}
      disabled={state === 'working'}
      style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
        border: state === 'done' ? 'none' : '1px solid var(--border)',
        background: state === 'done' ? 'var(--green)' : 'var(--surface)',
        color: state === 'done' ? '#fff' : 'var(--text-mid)', flexShrink: 0,
      }}
    >
      {state === 'working' ? 'Exporting…' : state === 'done' ? 'Exported ✓' : 'Export'}
    </button>
  )
}

// Falls back to the old single-quote field for jobs linked before it became a list
function getLinkedQuotes(project, quotesStore) {
  const ids = project.linkedQuoteIds || (project.linkedQuoteId ? [project.linkedQuoteId] : [])
  return ids.map(id => quotesStore.records.find(q => q.id === id)).filter(q => q && !q.trashedAt)
}

const quoteSubTabBtnStyle = active => ({
  padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: active ? 'none' : '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'var(--surface)',
  color: active ? 'var(--navy)' : 'var(--text-mid)', whiteSpace: 'nowrap', flexShrink: 0,
})

function QuotedMaterialsView({ quote, onImport }) {
  const scopes = quote.scopes || []
  const showScopeNames = scopes.length > 1
  const allMaterials = scopes.flatMap(sc => sc.materials || [])
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  if (allMaterials.length === 0) {
    return <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>This quote has no material lines.</div>
  }

  function toggleSelected(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(allMaterials.map(m => m.id)) : new Set())
  }
  const exportItems = allMaterials.filter(m => selectedIds.has(m.id)).map(m => ({ partNo: m.partNo, desc: m.desc, uom: m.uom, qty: m.qty }))

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-light)', cursor: 'pointer' }}>
          <input type="checkbox" checked={selectedIds.size === allMaterials.length} onChange={e => toggleAll(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
          Select all
        </label>
        <button
          onClick={() => onImport(allMaterials)}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 'var(--rs)', border: 'none', background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}
        >
          Import into Materials Actual
        </button>
      </div>
      {scopes.map((sc, i) => (sc.materials || []).length > 0 && (
        <div key={sc.id || i} style={{ marginBottom: 14 }}>
          {showScopeNames && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{sc.name || `Scope ${i + 1}`}</div>}
          {(sc.materials || []).map((m, j) => (
            <div key={m.id || j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleSelected(m.id)} style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-mid)', flexShrink: 0 }}>{m.partNo || '—'}</span>
              <span style={{ flex: 1, color: 'var(--text)' }}>{m.desc || 'Item'}</span>
              <span style={{ color: 'var(--text-mid)', flexShrink: 0 }}>{m.qty || 0} {m.uom || ''}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ paddingTop: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6 }}>
          {selectedIds.size} of {allMaterials.length} checked — check the ones you want to send off for pricing or ordering.
        </div>
        <WholesalerExportBar
          items={exportItems} date={todayLocal()}
          subjectPrefix="Material pricing request"
          saveFolder="Quotes/Materials Pricing Requests"
          emptyMessage="Check at least one material first."
        />
      </div>
    </div>
  )
}

function QuotedLaborView({ quote, onImport }) {
  const scopes = quote.scopes || []
  const showScopeNames = scopes.length > 1
  const allLabor = scopes.flatMap(sc => sc.labor || [])
  if (allLabor.length === 0) {
    return <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>This quote has no labor lines.</div>
  }
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          onClick={() => onImport(allLabor)}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 'var(--rs)', border: 'none', background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}
        >
          Import into Labor Actual
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10 }}>
        Imports the quoted hours as a starting point under matching rate tiers — worker names and actual dates still need filling in as real time gets logged.
      </div>
      {scopes.map((sc, i) => (sc.labor || []).length > 0 && (
        <div key={sc.id || i} style={{ marginBottom: 14 }}>
          {showScopeNames && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{sc.name || `Scope ${i + 1}`}</div>}
          {(sc.labor || []).map((l, j) => (
            <div key={l.id || j} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, color: 'var(--text)' }}>{l.desc || 'Labor'}</span>
              <span style={{ color: 'var(--text-mid)', flexShrink: 0 }}>{l.qty || 0} hrs @ ${Number(l.rate || 0).toFixed(0)}/hr</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Shared shell for the "Quoted" tab in both Materials and Labor — handles
// picking which linked quote to look at when there's more than one.
function QuotedTabShell({ project, quotesStore, ViewComponent, onImport }) {
  const [activeId, setActiveId] = useState(null)
  if (quotesStore.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }
  const linkedQuotes = getLinkedQuotes(project, quotesStore)
  if (linkedQuotes.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
        No quote linked yet — attach one in this job's Quote section.
      </div>
    )
  }
  const active = linkedQuotes.find(q => q.id === activeId) || linkedQuotes[0]
  return (
    <div>
      {linkedQuotes.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 16px 0' }}>
          {linkedQuotes.map(q => (
            <button key={q.id} onClick={() => setActiveId(q.id)} style={quoteSubTabBtnStyle((activeId || linkedQuotes[0].id) === q.id)}>
              {q.quoteNumber}{q.linkType === 'subjob' ? ' (sub)' : ''}
            </button>
          ))}
        </div>
      )}
      <ViewComponent quote={active} onImport={items => onImport(active, items)} />
    </div>
  )
}

// Quote totals come from the shared calculator (handles old and new quote layouts).
const qsQuoteMaterialsTotal = quoteMaterialsTotal
const qsQuoteLaborTotal = quoteLaborTotal
const qsGrandTotal = quoteGrandTotal

const qsLineRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--text-mid)', padding: '2px 0' }

function QuoteSummaryLines({ label, items }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      {items.map((i, idx) => (
        <div key={i.id || idx} style={qsLineRowStyle}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i.desc || 'Item'} {i.qty ? `× ${i.qty}` : ''}
          </span>
          <span style={{ flexShrink: 0, fontWeight: 600, color: 'var(--text)' }}>{money((Number(i.qty) || 0) * (Number(i.rate) || 0))}</span>
        </div>
      ))}
    </div>
  )
}

// Read-only breakdown of what was actually priced — materials to order,
// labor budgeted, and totals — aggregated across every quote linked to this job.
function QuoteSummaryPanel({ quotes, project, customer }) {
  const multiQuote = quotes.length > 1
  const grandTotal = quotes.reduce((a, q) => a + qsGrandTotal(q), 0)
  const allMaterials = quotes.flatMap(q => (normalizeQuote(q).scopes || []).flatMap(sc => sc.materials || []))

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-light)', textTransform: 'uppercase' }}>
        Priced summary — read-only
      </div>

      {allMaterials.length > 0 && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Materials to order</div>
            <QSCopyMaterialsButton
              materialsList={allMaterials}
              label={project?.name}
              folderPath={`Jobs/${customer.folder}/${project.folder}/Files`}
            />
          </div>
          {allMaterials.map((i, idx) => (
            <div key={i.id || idx} style={{ ...qsLineRowStyle }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.desc || 'Item'}</span>
              <span style={{ flexShrink: 0, fontWeight: 600, color: 'var(--text)' }}>{i.qty || 0}</span>
            </div>
          ))}
        </div>
      )}

      {quotes.map(rawQuote => {
        const quote = normalizeQuote(rawQuote)
        const scopes = quote.scopes || []
        const showScopeNames = scopes.length > 1
        const allowTotal = allowancesTotal(quote)
        return (
          <div key={quote.id}>
            {multiQuote && (
              <div style={{ padding: '8px 12px 0', fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)' }}>
                {quote.quoteNumber} — {quote.title || 'Untitled quote'}
              </div>
            )}
            {scopes.map((sc, i) => (
              <div key={sc.id || i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                {showScopeNames && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{sc.name || `Scope ${i + 1}`}</div>
                )}
                <QuoteSummaryLines label="Labor" items={sc.labor} />
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>
                  <span style={{ color: 'var(--text-mid)' }}>Scope total</span>
                  <span style={{ color: 'var(--text)' }}>{money(scopeTotal(quote, sc))}</span>
                </div>
              </div>
            ))}
            {allowTotal !== 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>
                <span style={{ color: 'var(--text-mid)' }}>Allowances</span>
                <span style={{ color: 'var(--text)' }}>{money(allowTotal)}</span>
              </div>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--surface-2)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Total priced</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{money(grandTotal)}</span>
      </div>
    </div>
  )
}

const linkChoiceBtnStyle = active => ({
  flex: 1, padding: 10, borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  border: active ? 'none' : '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'var(--surface)',
  color: active ? 'var(--navy)' : 'var(--text)',
})

// Links this job to one or more Quotes (bidirectional — writes to both records).
// A job can have one quote marked as the primary job, plus any number of sub-job quotes.
function QuoteLinkSection({ project, customer, navigate, onUpdateProject }) {
  const quotesStore = useHubStore({
    hub: 'quotes',
    recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers',
    recordsKey: 'quote_quotes',
  })
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [linking, setLinking] = useState(false)
  const [search, setSearch] = useState('')
  const [linkType, setLinkType] = useState('primary')
  const [pendingQuoteId, setPendingQuoteId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [splitting, setSplitting] = useState(null) // quoteId currently mid-split

  if (quotesStore.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }

  // Falls back to the old single-quote field for jobs linked before this became a list
  const linkedIds = project.linkedQuoteIds || (project.linkedQuoteId ? [project.linkedQuoteId] : [])
  const linkedQuotes = linkedIds.map(id => quotesStore.records.find(q => q.id === id)).filter(Boolean)

  function totalsFor(quotes) {
    return {
      quotedMaterials: quotes.reduce((a, q) => a + qsQuoteMaterialsTotal(q), 0),
      quotedLabor: quotes.reduce((a, q) => a + qsQuoteLaborTotal(q), 0),
    }
  }

  // Gives a linked quote its own full, independent job — same status, CO, and
  // Labor/Materials tracking as any other job — tagged as related back to
  // this one rather than staying merged into its record.
  async function splitIntoOwnJob(quoteId) {
    const lq = linkedQuotes.find(q => q.id === quoteId)
    if (!lq) return
    setSplitting(quoteId)
    try {
      const newProject = await jobsHub.addRecord(project.customerId, {
        name: lq.title || lq.quoteNumber,
        co: lq.quoteNumber,
        type: 'quoted',
        notes: lq.notes || '',
        linkedQuoteIds: [quoteId],
        relatedJobId: project.id,
      })
      const newIds = linkedIds.filter(id => id !== quoteId)
      const newQuotes = linkedQuotes.filter(q => q.id !== quoteId)
      onUpdateProject(project.id, { linkedQuoteIds: newIds, ...totalsFor(newQuotes) })
      await quotesStore.updateRecord(quoteId, { linkedJobId: newProject.id })
    } finally {
      setSplitting(null)
    }
  }

  async function link(quoteId, type) {
    setBusy(true)
    setError('')
    try {
      const q = quotesStore.records.find(x => x.id === quoteId)
      if (type === 'subjob') {
        // Gets its own independent job — same as any other job — tagged as
        // related back to this one, rather than merged into this project's record.
        const newProject = await jobsHub.addRecord(project.customerId, {
          name: q?.title || q?.quoteNumber || 'Sub-job',
          co: q?.quoteNumber || '',
          type: 'quoted',
          notes: q?.notes || '',
          linkedQuoteIds: [quoteId],
          relatedJobId: project.id,
        })
        await quotesStore.updateRecord(quoteId, { linkedJobId: newProject.id, linkType: 'subjob' })
      } else {
        await quotesStore.updateRecord(quoteId, { linkedJobId: project.id, linkType: type })
        const newIds = [...linkedIds, quoteId]
        const newQuotes = q ? [...linkedQuotes, q] : linkedQuotes
        onUpdateProject(project.id, { linkedQuoteIds: newIds, ...totalsFor(newQuotes) })
      }
      setLinking(false); setPendingQuoteId(null); setSearch('')
    } catch (err) {
      setError(err.message || 'Something went wrong linking this quote.')
    } finally {
      setBusy(false)
    }
  }

  // In case a linked quote's pricing changes afterward — re-pull the latest totals
  function refreshFromQuotes() {
    onUpdateProject(project.id, totalsFor(linkedQuotes))
  }

  function unlinkOne(quoteId) {
    quotesStore.updateRecord(quoteId, { linkedJobId: null, linkType: null })
    const newIds = linkedIds.filter(id => id !== quoteId)
    const newQuotes = linkedQuotes.filter(q => q.id !== quoteId)
    onUpdateProject(project.id, { linkedQuoteIds: newIds, ...totalsFor(newQuotes) })
  }

  const quoteCOs = project.linkedQuoteCOs || {}
  function updateQuoteCO(quoteId, patch) {
    onUpdateProject(project.id, { linkedQuoteCOs: { ...quoteCOs, [quoteId]: { ...quoteCOs[quoteId], ...patch } } })
  }

  if (linkedQuotes.length > 0 && !linking) {
    return (
      <div style={{ padding: 16 }}>
        {linkedQuotes.length > 1 && (
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10 }}>
            More than one quote is linked — each can carry its own CO #/value below if this job is being billed under separate change orders.
          </div>
        )}
        {linkedQuotes.map(lq => {
          const lqCustomer = quotesStore.customers.find(c => c.id === lq.customerId)
          const co = quoteCOs[lq.id] || {}
          return (
            <div key={lq.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {lq.quoteNumber} — {lq.title || 'Untitled quote'}
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent-dim)', background: 'var(--accent-bg)', borderRadius: 20, padding: '1px 7px' }}>
                      {lq.linkType === 'subjob' ? 'sub-job' : 'primary'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                    {lqCustomer?.name} · {lq.approved ? 'Approved' : 'Not approved yet'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => navigate({ hub: 'quotes', view: 'quoteDetail', customerId: lqCustomer?.id, quoteId: lq.id })}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Open →
                  </button>
                  {linkedQuotes.length > 1 && (
                    <button
                      onClick={() => splitIntoOwnJob(lq.id)}
                      disabled={splitting === lq.id}
                      style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: splitting === lq.id ? 'default' : 'pointer' }}
                    >
                      {splitting === lq.id ? 'Splitting…' : 'Split into own job'}
                    </button>
                  )}
                  <button onClick={() => unlinkOne(lq.id)} style={{ fontSize: 11, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer' }}>Unlink</button>
                </div>
              </div>
              {linkedQuotes.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-light)' }}>CO #</span>
                    <EditableField value={co.co} placeholder="—" onSave={v => updateQuoteCO(lq.id, { co: v })} style={{ fontSize: 11, fontWeight: 700 }} />
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-light)' }}>CO Value</span>
                    <EditableCurrency value={co.coValue} onSave={v => updateQuoteCO(lq.id, { coValue: v })} color="var(--blue)" />
                  </span>
                </div>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
          <button onClick={() => setLinking(true)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            + Link another quote
          </button>
          <button onClick={refreshFromQuotes} style={{ fontSize: 11, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} title="Re-pull Quoted Materials/Labor from linked quotes' current pricing">
            Refresh totals
          </button>
        </div>
        <QuoteSummaryPanel quotes={linkedQuotes} project={project} customer={customer} />
      </div>
    )
  }

  if (!linking) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 12 }}>No quote linked yet.</div>
        <button
          onClick={() => setLinking(true)}
          style={{ padding: '8px 16px', borderRadius: 'var(--rs)', border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent-dim)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          Link to a quote
        </button>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16, fontSize: 12, color: 'var(--text-light)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!project.noQuoteNeeded} onChange={e => onUpdateProject(project.id, { noQuoteNeeded: e.target.checked })} />
          No quote to attach for this job
        </label>
      </div>
    )
  }

  if (pendingQuoteId) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>How is this linked?</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button style={linkChoiceBtnStyle(linkType === 'primary')} onClick={() => setLinkType('primary')}>This is the job</button>
          <button style={linkChoiceBtnStyle(linkType === 'subjob')} onClick={() => setLinkType('subjob')}>Sub-job of it</button>
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ flex: 1, padding: 10, borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={() => setPendingQuoteId(null)} disabled={busy}>Back</button>
          <button style={{ flex: 1, padding: 10, borderRadius: 'var(--rs)', border: 'none', background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }} onClick={() => link(pendingQuoteId, linkType)} disabled={busy}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        </div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const matches = q
    ? quotesStore.records.filter(qt => hit([qt.title, qt.quoteNumber], q)).slice(0, 8)
    : []

  return (
    <div style={{ padding: 16 }}>
      <input
        autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes by title or number…"
        style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', width: '100%', border: '1px solid var(--accent)', borderRadius: 4, padding: '6px 8px', outline: 'none', fontFamily: 'var(--font)', marginBottom: 10 }}
      />
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {matches.map(qt => {
          const cust = quotesStore.customers.find(c => c.id === qt.customerId)
          return (
            <div
              key={qt.id} onClick={() => setPendingQuoteId(qt.id)}
              style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', marginBottom: 6, fontSize: 13 }}
            >
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{qt.quoteNumber} — {qt.title || 'Untitled quote'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{cust?.name}</div>
            </div>
          )
        })}
        {q && matches.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-light)' }}>No matches.</div>}
      </div>
      {linkedQuotes.length > 0 && (
        <button
          onClick={() => { setLinking(false); setSearch('') }}
          style={{ marginTop: 10, fontSize: 11, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}

export function SectionPage({ customer, project, sectionId, onUpdateProject, navigate }) {
  const section = SECTIONS.find(s => s.id === sectionId)
  const typeMeta = TYPE_META[project.type]
  return (
    <div>
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{customer.name} · CO {project.co || '—'} · {project.name || 'Untitled project'}</span>
          {typeMeta && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: typeMeta.bg, color: typeMeta.color, textTransform: 'none', letterSpacing: 0 }}>
              {typeMeta.label}
            </span>
          )}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
          {section?.label || 'Section'}
        </div>
      </div>
      <FlagBanner record={project} onUpdate={patch => onUpdateProject(project.id, patch)} />

      {sectionId === 'general' ? (
        <GeneralInfoSection project={project} customer={customer} onUpdate={patch => onUpdateProject(project.id, patch)} navigate={navigate} />
      ) : sectionId === 'labor' ? (
        <>
          <LaborSection project={project} onUpdate={patch => onUpdateProject(project.id, patch)} />
          <PostTimeToLabor project={project} onUpdate={patch => onUpdateProject(project.id, patch)} />
        </>
      ) : sectionId === 'materials' ? (
        <MaterialsSection project={project} customer={customer} onUpdate={patch => onUpdateProject(project.id, patch)} />
      ) : sectionId === 'tasks' ? (
        <JobTasks project={project} onUpdate={patch => onUpdateProject(project.id, patch)} />
      ) : sectionId === 'notes' ? (
        <NotesSection project={project} onUpdate={patch => onUpdateProject(project.id, patch)} />
      ) : sectionId === 'files' ? (
        <FileAttachments folderPath={`Jobs/${customer.folder}/${project.folder}/Files`} />
      ) : sectionId === 'quote' ? (
        <QuoteLinkSection project={project} customer={customer} navigate={navigate} onUpdateProject={onUpdateProject} />
      ) : (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          {`We'll build the ${section?.label || 'this'} section here — tell me what you want on it.`}
        </div>
      )}
    </div>
  )
}

// ── Jobs hub ─────────────────────────────────────────────────────
// ── Customer detail page (Edit) — placeholder body, with verified delete ──
function CustomerDetailPage({ customer, projectCount, onDelete, onGoBack }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div>
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase' }}>
          Customer
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
          {customer.name || 'Untitled customer'}
        </div>
      </div>

      <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
        Details for this customer will go here — tell me what to add.
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            style={{
              width: '100%', padding: '12px', background: 'none', border: '1px solid var(--red)',
              borderRadius: 'var(--rs)', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            Delete customer
          </button>
        ) : (
          <div style={{ border: '1px solid var(--red)', borderRadius: 'var(--rs)', padding: 14, background: 'var(--red-bg)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-dark)', marginBottom: 4 }}>
              Delete {customer.name || 'this customer'}?
            </div>
            <div style={{ fontSize: 12, color: 'var(--red-dark)', marginBottom: 12 }}>
              {projectCount > 0
                ? `This will also delete ${projectCount} project${projectCount === 1 ? '' : 's'} under this customer. This can't be undone.`
                : "This can't be undone."}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{ flex: 1, padding: '10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete(); onGoBack() }}
                style={{ flex: 1, padding: '10px', background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Projects sort by CO# (natural/numeric-aware), items with no CO# sink to the bottom
export function sortByCO(list) {
  return [...list].sort((a, b) => {
    const aHas = !!(a.co && a.co.trim())
    const bHas = !!(b.co && b.co.trim())
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (!aHas && !bHas) return 0
    return a.co.localeCompare(b.co, undefined, { numeric: true, sensitivity: 'base' })
  })
}

// ── Choose-a-data-folder prompt (desktop app, first run only) ─────
function ChooseFolderPrompt({ onChoose }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        Pick a folder for your data
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 20, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
        Everything you add — customers, jobs, files — will be saved as real folders and files right there, organized by customer and project.
      </div>
      <button
        onClick={onChoose}
        style={{ padding: '12px 24px', borderRadius: 'var(--rs)', border: 'none', background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
      >
        Choose folder…
      </button>
    </div>
  )
}

const jobsListMemory = { customer: null, project: null }

export default function Jobs({ screen, navigate, goBack }) {
  const store = useHubStore({
    hub: 'jobs',
    recordFileName: 'project.json',
    getRecordFolderName: project => project.name,
    customersKey: 'job_customers',
    recordsKey: 'job_projects',
  })
  const { customers, records: projects, loading, needsFolder, chooseFolder,
          addCustomer: hubAddCustomer, updateCustomer,
          addRecord, updateRecord } = store

  // Only needed here to clean up the other side of a Job↔Quote link when a
  // job gets deleted directly — otherwise the quote is left pointing at a
  // job that no longer exists, and thinks it's still linked when it isn't.
  const quotesStore = useHubStore({
    hub: 'quotes',
    recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers',
    recordsKey: 'quote_quotes',
  })

  // remembered while the app is open, so coming back from a job's section
  // finds the same customer and job still open
  const [expandedCustomerId, setExpCust] = useState(() => jobsListMemory.customer)
  const [expandedProjectId,  setExpProj]  = useState(() => jobsListMemory.project)
  const setExpandedCustomerId = fn => setExpCust(cur => (jobsListMemory.customer = typeof fn === 'function' ? fn(cur) : fn))
  const setExpandedProjectId = fn => setExpProj(cur => (jobsListMemory.project = typeof fn === 'function' ? fn(cur) : fn))
  const [statusTarget, setStatusTarget] = useState(null)

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }
  if (needsFolder) {
    return <ChooseFolderPrompt onChoose={chooseFolder} />
  }

  const view = screen?.view || 'list'

  if (view === 'section') {
    const customer = customers.find(c => c.id === screen.customerId)
    const project  = projects.find(p => p.id === screen.projectId)
    if (!customer || !project) return null
    return <SectionPage customer={customer} project={project} sectionId={screen.section} onUpdateProject={updateRecord} navigate={navigate} />
  }

  if (view === 'customerDetail') {
    const customer = customers.find(c => c.id === screen.customerId)
    if (!customer) return null
    const projectCount = projects.filter(p => p.customerId === customer.id).length
    return (
      <CustomerDetailPage
        customer={customer}
        projectCount={projectCount}
        onDelete={() => deleteCustomer(customer.id)}
        onGoBack={goBack}
      />
    )
  }

  function addCustomer(name) {
    hubAddCustomer({ name })
  }
  function renameCustomer(id, name) {
    updateCustomer(id, { name })
  }
  function deleteCustomer(id) {
    updateCustomer(id, { trashedAt: new Date().toISOString() })
    if (expandedCustomerId === id) setExpandedCustomerId(null)
  }
  function addProject(customerId, { type, co, name, notes }) {
    addRecord(customerId, { type, co, name, notes })
  }
  function updateProject(id, patch) {
    updateRecord(id, patch)
  }
  function deleteProject(id) {
    // Any quote linked to this job needs to be unlinked first, or it's left
    // thinking it's still attached to a job that no longer exists.
    if (!quotesStore.loading) {
      quotesStore.records
        .filter(q => q.linkedJobId === id)
        .forEach(q => quotesStore.updateRecord(q.id, { linkedJobId: null, linkType: null }))
    }
    // Soft delete — moves to Trash for 30 days rather than removing anything
    // right away. The files on disk are untouched until it's actually purged.
    updateRecord(id, { trashedAt: new Date().toISOString() })
    if (expandedProjectId === id) setExpandedProjectId(null)
  }
  function openSection(customerId, projectId, sectionId) {
    navigate({ hub: 'jobs', view: 'section', customerId, projectId, section: sectionId })
  }

  // Red -> Yellow is a quick, no-fuss status bump. Yellow -> Green is the real
  // "mark complete and move it" action, so that's the only click that opens the
  // confirmation gate. Clicking an already-completed job's dot opens the revert confirm.
  function handleStatusClick(project) {
    if (project.completed) {
      setStatusTarget(project)
    } else if (project.status === 'yellow') {
      setStatusTarget(project)
    } else {
      updateProject(project.id, { status: 'yellow' })
    }
  }

  return (
    <div>
      {customers.filter(c => !c.trashedAt).length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          No customers yet — add one below.
        </div>
      )}
      {customers.filter(c => !c.trashedAt).map(c => (
        <CustomerBlock
          key={c.id}
          customer={c}
          projects={sortByCO(projects.filter(p => p.customerId === c.id && !p.completed && !p.trashedAt))}
          expanded={expandedCustomerId === c.id}
          onToggle={() => window.desktop ? window.desktop.openCustomerWindow(c.id) : setExpandedCustomerId(id => id === c.id ? null : c.id)}
          onRename={name => renameCustomer(c.id, name)}
          onEdit={() => navigate({ hub: 'jobs', view: 'customerDetail', customerId: c.id })}
          onAddProject={data => addProject(c.id, data)}
          onUpdateProject={updateProject}
          onDeleteProject={deleteProject}
          expandedProjectId={expandedProjectId}
          onToggleProject={pid => setExpandedProjectId(id => id === pid ? null : pid)}
          onOpenSection={(pid, sectionId) => openSection(c.id, pid, sectionId)}
          onRequestStatusClick={handleStatusClick}
        />
      ))}
      <AddCustomerRow onAdd={addCustomer} />

      {statusTarget && !statusTarget.completed && (
        <CompletionModal
          project={projects.find(p => p.id === statusTarget.id) || statusTarget}
          onClose={() => setStatusTarget(null)}
          onUpdate={patch => updateProject(statusTarget.id, patch)}
          onConfirm={value => {
            updateProject(statusTarget.id, statusPatch(projects.find(p => p.id === statusTarget.id) || statusTarget, value))
            setStatusTarget(null)
          }}
        />
      )}
      {statusTarget && statusTarget.completed && (
        <SimpleCompletionConfirm
          project={statusTarget}
          onClose={() => setStatusTarget(null)}
          onConfirm={() => {
            updateProject(statusTarget.id, statusPatch(statusTarget, 'onGoing'))
            setStatusTarget(null)
          }}
        />
      )}
    </div>
  )
}
