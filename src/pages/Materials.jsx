import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useOrdersFeed, useOrdersPrevious, matchOrdersByPo, linkSlipToOrders, fileType, openQuotePdf, setFeedPo, setFeedPricing, setFeedPricingFor, feedPoState } from '../api/orders.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import WholesalerExportBar from '../components/WholesalerExportBar.jsx'
import QuoteCompare from '../components/QuoteCompare.jsx'
import { hasPoNumber, noPoState, slipKind, isArchived, isStockOnlyLine, closeOutLines, archiveBlockers, lineJobIds, lineIsAllocated, jobEntriesFromSlip, leftoverLinesForJob, slipSearchText, mergeIntoStock, feedPartLines , slipLineKey, lineJobsOf, lineUse, initialUse, lineRemaining, jobsOnSlip, lineWithRestInStock, isQuoteDoc, packingSlipsOnPo, packingSlipsForQuote, isReplacedQuote, sameOrder, orderBaseKey, orderBaseLabel, moveQuoteChargesToSlips, moveFeedChargesToSlips, takeFromStock } from '../api/slips.js'
import { orderParts, jobNamesOf, numKey } from '../api/orders.js'
import { billingCheck, poStatus, orderedOnPo, orderStatus } from '../api/billingCheck.js'
import { markReceivedByPo } from '../api/orders.js'
import { normalizeLines } from '../api/units.js'
import UnitFixModal, { findUnitFixes } from '../components/UnitFix.jsx'
import MaterialUsedTab, { QuickAddRow, partsList, STOCK_TARGET } from '../components/MaterialUsed.jsx'
import OrdersList from './Orders.jsx'
import { groupMonthDist } from '../api/monthDist.js'
import { buildPurchases, purchaseSearchText, STAGES } from '../api/purchases.js'
import { REQUESTS_KEY, quoteCandidates, catalogQuoteTotal } from '../api/requests.js'
import { addPlanLinesToOrderList, tagSlipsFromRequests } from '../api/materialPlan.js'
import StockCount, { lastFullCount } from '../components/StockCount.jsx'
import { EXPORT_EXTRA_KEY, exportWeekKey } from '../api/timesheetExport.js'
import { FlagButton, FlagNote } from '../components/Flags.jsx'
import { useFlags, readFlagJump, clearFlagJump } from '../api/flags.js'
import CatalogApprovals, { CATALOG_PENDING_KEY, NewItemForApproval } from '../components/CatalogApprovals.jsx'
import DupPartsModal, { findDuplicateParts, mergeDuplicates } from '../components/DupParts.jsx'
import { partNosOf, hasPartNo, isMerged, priceByRule, priceIntoMerged } from '../api/partAliases.js'
import BillingCheckModal, { BillingPill, BillingSummary, isReviewed } from '../components/BillingCheck.jsx'
import { hit } from '../api/search.js'
import { buildPriceIndex, priceSourceFor } from '../api/priceSource.js'
import { todayLocal } from '../api/albertaTime.js'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function money(v) {
  return `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Shared row bits ──────────────────────────────────────────────
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 16px', background: 'var(--surface)',
  borderBottom: '1px solid var(--border)', cursor: 'default',
}
const plainInputStyle = {
  fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: 'none', background: 'none', padding: '3px 4px', outline: 'none',
  fontFamily: 'var(--font)', width: '100%',
}
const inputStyle = {
  fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 6px',
  outline: 'none', fontFamily: 'var(--font)', width: '100%',
}
const textStyle = { fontSize: 14, fontWeight: 600, color: 'var(--text)', cursor: 'text', minWidth: 0 }
const placeholderTextStyle = { ...textStyle, color: 'var(--text-light)', fontWeight: 500 }
const delBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
  color: 'var(--text-light)', fontSize: 16, lineHeight: 1, flexShrink: 0, width: 22,
}
const colHeaderStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-light)',
  textTransform: 'uppercase',
}
const tabBtnStyle = active => ({
  flex: 1, padding: '10px 8px', background: 'none', border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  color: active ? 'var(--accent-dim)' : 'var(--text-mid)',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

// A controlled list rather than free text — keeps things like "Meter" vs "M" vs
// "KM" consistent, and matters a lot for parsed imports (a mislabeled unit can
// make a total look wildly wrong even when the math itself is fine).
// "General Stock" — a fixed, always-available pick in every order/slip job
// picker, for material bought for the shop/truck rather than a specific job.
// It's a tag like any job (it doesn't change what Receive does — received
// items still go into Stock), so orders and lines can be marked as stock buys.
export const GENERAL_STOCK_ID = 'general-stock'
const GENERAL_STOCK = { id: GENERAL_STOCK_ID, name: 'General Stock', customerName: 'Shop', isGeneralStock: true }
const isGeneralStock = j => j && j.id === GENERAL_STOCK_ID
const withGeneralStock = options => [GENERAL_STOCK, ...options.filter(o => !isGeneralStock(o))]
function jobLabel(j) { return isGeneralStock(j) ? 'General Stock' : `${j.customerName} — ${j.name}` }
const jobChipColors = j => isGeneralStock(j) ? { color: '#1e7a34', background: '#e6f4ea' } : { color: '#1a5fa0', background: '#e8f2fc' }
// Dropdown matches: typed text filters by customer/job name; with nothing
// typed yet, General Stock is offered straight away.
function matchJobs(jobOptions, q, exclude, limit) {
  const open = jobOptions.filter(j => !exclude.some(s => s.id === j.id))
  if (!q) return open.filter(isGeneralStock)
  return open.filter(j => hit([j.customerName, j.name], q)).slice(0, limit)
}
function JobOptionLabel({ job }) {
  if (isGeneralStock(job)) return <span style={{ fontWeight: 700, color: '#1e7a34' }}>📦 General Stock <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>(shop / truck stock)</span></span>
  return <><span style={{ color: 'var(--text-light)' }}>{job.customerName} — </span><span style={{ fontWeight: 700 }}>{job.name}</span></>
}

// Prices are always per EA / M / FT — wholesaler per-KM / per-1000-ft / per-100
// pricing is converted when a slip is read (see api/units.js)
const UOM_OPTIONS = ['EA', 'FT', 'M', 'ROLL', 'BOX', 'PKG', 'CASE', 'LOT']

function UomSelect({ value, onChange, style }) {
  const options = value && !UOM_OPTIONS.includes(value) ? [value, ...UOM_OPTIONS] : UOM_OPTIONS
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: 12, fontWeight: 600, color: value ? 'var(--text)' : 'var(--text-light)',
        border: '1px solid var(--border)', borderRadius: 4, padding: '3px 2px', outline: 'none',
        fontFamily: 'var(--font)', background: 'var(--surface)', width: '100%', ...style,
      }}
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function EditableField({ value, placeholder, onSave, style }) {
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
        autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={{ ...inputStyle, ...style }}
      />
    )
  }
  return (
    <span
      style={{ ...(value ? textStyle : placeholderTextStyle), ...style }}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
    >
      {value || placeholder}
    </span>
  )
}

function CollapsedAddRow({ label, indent, onClick }) {
  return (
    <div onClick={onClick} style={{ ...rowStyle, background: 'var(--surface-2)', cursor: 'pointer', paddingLeft: indent ? 34 : 16 }}>
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>+</span>
      <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// ── Shared: search box + category grouping helpers ────────────────
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Search…'}
        style={{ ...inputStyle, border: '1px solid var(--border)' }}
      />
    </div>
  )
}

// Categories are stored as "/"-delimited paths (e.g. "Conduit/PVC/Schedule 40"),
// so a category can have its own sub-categories, and those can have their own
// sub-categories too, to whatever depth is useful.
function buildCategoryTree(items) {
  const root = { name: '', fullPath: '', children: new Map(), items: [] }
  items.forEach(item => {
    const raw = (item.category || '').trim()
    if (!raw) { root.items.push(item); return }
    const segments = raw.split('/').map(s => s.trim()).filter(Boolean)
    let node = root
    let acc = ''
    segments.forEach(seg => {
      acc = acc ? `${acc}/${seg}` : seg
      if (!node.children.has(seg)) node.children.set(seg, { name: seg, fullPath: acc, children: new Map(), items: [] })
      node = node.children.get(seg)
    })
    node.items.push(item)
  })
  return root
}
function countAllItems(node) {
  let n = node.items.length
  node.children.forEach(c => { n += countAllItems(c) })
  return n
}
function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// A small "Category: X/Y/Z" line under a row — lets any item (including ones
// that just landed in Uncategorized from a parsed import) be filed or refiled
// into any category path directly, without needing to drag it through the tree.
// Suggests a category for an uncategorized item by finding the most similar
// already-categorized item (by shared significant words in the name/nickname)
// — so re-filing a pile of Uncategorized items means confirming suggestions
// rather than retyping every path from scratch.
function significantWords(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2))
}
function suggestCategoryFor(item, allItems) {
  const itemWords = new Set([...significantWords(item.name), ...significantWords(item.nickname)])
  if (itemWords.size === 0) return null

  let best = null
  let bestScore = 0
  allItems.forEach(c => {
    if (c.id === item.id || !c.category) return
    const cWords = new Set([...significantWords(c.name), ...significantWords(c.nickname)])
    if (cWords.size === 0) return
    const overlap = [...itemWords].filter(w => cWords.has(w)).length
    const score = overlap / Math.max(itemWords.size, cWords.size)
    if (score > bestScore) { bestScore = score; best = c }
  })
  return bestScore >= 0.5 ? best.category : null
}

function CategoryPathInput({ value, allCategories, onSave, placeholder, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [showDropdown, setShowDropdown] = useState(false)

  function commit(explicitValue) {
    setEditing(false)
    setShowDropdown(false)
    const v = (explicitValue !== undefined ? explicitValue : draft).trim()
    if (v !== (value || '')) onSave(v)
  }

  if (!editing) {
    return (
      <span onClick={() => { setDraft(value || ''); setEditing(true); setShowDropdown(true) }} style={style}>
        {value || placeholder}
      </span>
    )
  }

  const q = draft.trim().toLowerCase()
  const matches = q ? allCategories.filter(c => c.toLowerCase().includes(q) && c.toLowerCase() !== q).slice(0, 8) : []

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <input
        autoFocus value={draft}
        onChange={e => { setDraft(e.target.value); setShowDropdown(true) }}
        onBlur={() => setTimeout(() => commit(), 150)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); setShowDropdown(false) }
        }}
        placeholder={placeholder}
        style={{ ...style, border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 4px', outline: 'none', fontFamily: 'var(--font)', minWidth: 140 }}
      />
      {showDropdown && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 30, minWidth: 180,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
          maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}>
          {matches.map(c => (
            <div
              key={c} onMouseDown={() => commit(c)}
              style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
            >
              {c}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

function CategoryPathHint({ item, onUpdate, onExpandPath, allItems }) {
  const suggestion = !item.category && allItems ? suggestCategoryFor(item, allItems) : null
  const allCategories = allItems ? [...new Set(allItems.map(i => (i.category || '').trim()).filter(Boolean))].sort() : []
  function useSuggestion() {
    onUpdate({ category: suggestion })
    if (suggestion && onExpandPath) onExpandPath(suggestion)
  }
  return (
    <div style={{ padding: '0 16px 6px 34px', fontSize: 10, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span>Category:</span>
      <CategoryPathInput
        value={item.category}
        allCategories={allCategories}
        placeholder="Uncategorized — click to file"
        onSave={v => { onUpdate({ category: v }); if (v && onExpandPath) onExpandPath(v) }}
        style={{ fontSize: 10, fontWeight: item.category ? 600 : 400, cursor: 'text', color: item.category ? 'var(--text)' : 'var(--text-light)' }}
      />
      <span style={{ color: 'var(--text-light)' }}>(use "/" to nest, e.g. Conduit/PVC) — type to see matching categories</span>
      {suggestion && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, background: '#e8f2fc', borderRadius: 20, padding: '1px 8px' }}>
          <span style={{ color: '#1a5fa0' }}>Suggested: {suggestion}</span>
          <button onClick={useSuggestion} style={{ fontSize: 10, fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
            Use this
          </button>
        </span>
      )}
    </div>
  )
}

// Category sub-header: click text to expand/collapse, pencil renames the
// whole group (bulk-updates every item's category field at once)
function CategoryHeader({ name, count, expanded, onToggle, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v && v !== name) onRename(v)
    else setDraft(name)
  }

  return (
    <div>
      <div style={{ ...rowStyle, background: 'var(--surface-2)', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ color: 'var(--text-light)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 18 18" fill="none" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {editing ? (
          <input
            autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(name); setEditing(false) } }}
            style={{ ...inputStyle, flex: 1 }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
            {name}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-light)', flexShrink: 0 }}>{count}</span>
        {!editing && (
          <button
            onClick={e => { e.stopPropagation(); setDraft(name); setEditing(true) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 2, flexShrink: 0, display: 'flex' }}
            aria-label="Rename category"
          >
            <PencilIcon />
          </button>
        )}
        {!editing && onDelete && name !== 'Uncategorized' && (
          <button
            onClick={e => { e.stopPropagation(); setConfirmingDelete(true) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15, padding: '0 2px', flexShrink: 0 }}
            aria-label="Delete category"
          >
            ×
          </button>
        )}
      </div>
      {confirmingDelete && (
        <div style={{ padding: '10px 16px', background: '#fdf0f0', borderBottom: '1px solid var(--red)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
            Delete "{name}"{count ? ` — its items will move to Uncategorized, not be deleted` : ''}? Any sub-categories inside it get removed too.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setConfirmingDelete(false)}
              style={{ flex: 1, padding: '7px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              style={{ flex: 1, padding: '7px', background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              Delete category
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
      <path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ══════════════════════════════════════════════════════════════════
// CATALOG — base reference layer: Part No | Description | UOM | Ref cost
// ══════════════════════════════════════════════════════════════════
// Stacked Nickname (bold) + Part No (small, muted) — lets you quick-reference
// something by a name you chose instead of typing a part number every time.
function NicknameDescCell({ item, onUpdate }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <EditableField value={item.nickname} placeholder="+ nickname" onSave={v => onUpdate({ nickname: v })}
        style={{ fontSize: 11, fontWeight: 700, color: item.nickname ? 'var(--accent-dim)' : 'var(--text-light)' }} />
      <EditableField value={item.name} placeholder="Description" onSave={v => onUpdate({ name: v })} style={{ fontSize: 12.5 }} />
    </div>
  )
}

function NicknameDescInputs({ nickname, setNickname, name, setName, onKey }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="+ nickname" onKeyDown={onKey}
        style={{ ...plainInputStyle, fontSize: 11, fontWeight: 700 }} />
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Description" onKeyDown={onKey}
        style={{ ...plainInputStyle, fontSize: 12.5 }} />
    </div>
  )
}

const CAT_COLS = 'minmax(110px, 0.35fr) minmax(140px, 1fr) 52px 100px'
const catFieldStyle = { fontSize: 12.5 }

function CatColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 4px 34px', background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: CAT_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Part No:</span>
        <span style={colHeaderStyle}>Nickname / Description:</span>
        <span style={colHeaderStyle}>UOM:</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Ref cost</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

// "Priced from" — the newest slip / quote with this part, click to open the PDF
function PriceSourceLine({ src, refCost }) {
  const [msg, setMsg] = useState('')
  if (!src) return null
  const canOpen = src.kind === 'slip' ? !!(src.order && src.order.slipPath && window.desktop?.openFile) : !!window.desktop?.ordersOpenQuoteFile
  const differs = Number(refCost) > 0 && Math.abs(Number(refCost) - src.unit) > 0.005
  const label = `${String(src.supplier || '').split(/[\s(-]/)[0] || 'Supplier'} ${src.kind === 'quote' || src.docType === 'quote' ? 'quote' : 'slip'} #${src.number || '—'}${src.po ? ' · PO ' + String(src.po).replace(/^po\s*#?\s*/i, '') : ''}`
  async function open(e) {
    e.preventDefault(); e.stopPropagation(); setMsg('')
    if (src.kind === 'slip') { window.desktop.openFile(src.order.slipPath); return }
    const r = await openQuotePdf(src.quoteNo)
    if (r && r.ok === false) setMsg(r.reason === 'not-found' ? ' — PDF not found in Quote Slips' : ' — could not open the PDF')
  }
  return (
    <div style={{ padding: '0 16px 4px 34px', fontSize: 10.5, color: 'var(--text-light)' }}>
      Priced from{' '}
      {canOpen
        ? <a href="#" onClick={open} title="Open the PDF this price came from" style={{ color: 'var(--blue, #2563eb)', fontWeight: 700 }}>🧾 {label}</a>
        : <b>{label}</b>}
      {' '}· {src.date} · {money(src.unit)}{src.uom ? '/' + src.uom : ''}
      {differs && <span style={{ color: '#8a5d00', fontWeight: 700 }}> · Catalog says {money(Number(refCost))}</span>}
      {msg}
    </div>
  )
}

function PriceHistoryHint({ history }) {
  if (!history || history.length < 2) return null
  const recent = history.slice(-3).reverse()
  return (
    <div style={{ padding: '0 16px 6px 34px', fontSize: 10, color: 'var(--text-light)' }}>
      Recent: {recent.map((h, i) => `${money(h.cost)} (${h.date}${h.source ? `, ${h.source}` : ''})`).join('  ·  ')}
    </div>
  )
}

function AllocationHistoryHint({ log }) {
  const [expanded, setExpanded] = useState(false)
  if (!log || log.length === 0) return null
  const totalAllocated = log.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  return (
    <div style={{ padding: '0 16px 6px 34px' }}>
      <button onClick={() => setExpanded(x => !x)} style={{ fontSize: 10.5, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        {expanded ? '▾' : '▸'} {log.length} allocation{log.length === 1 ? '' : 's'} — {totalAllocated} total
      </button>
      {expanded && (
        <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {log.slice().reverse().map(l => (
            <div key={l.id} style={{ fontSize: 10.5, color: 'var(--text-light)' }}>
              {new Date(l.date).toLocaleDateString()} — {l.qty} to {l.customerName} — {l.jobName}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CatRow({ item, onUpdate, onDelete }) {
  return (
    <div>
      <div style={{ ...rowStyle, paddingLeft: 34 }}>
        <div style={{ display: 'grid', gridTemplateColumns: CAT_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <EditableField value={item.partNo} placeholder="—" onSave={v => onUpdate({ partNo: v })} style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} />
          <NicknameDescCell item={item} onUpdate={onUpdate} />
          <UomSelect value={item.uom} onChange={v => onUpdate({ uom: v })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
            <input type="number" step="0.01" value={item.refCost ?? ''} onChange={e => onUpdate({ refCost: e.target.value })}
              placeholder="0.00" style={{ ...plainInputStyle, ...catFieldStyle, textAlign: 'right' }} />
          </div>
        </div>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete catalog item" confirmText="Delete this catalog item?" />
      </div>
      <PriceHistoryHint history={item.priceHistory} />
    </div>
  )
}

function CatAddRow({ category, onAdd, startOpen, onCancel }) {
  const [open, setOpen] = useState(!!startOpen)
  const [name, setName] = useState('')
  const [partNo, setPartNo] = useState('')
  const [nickname, setNickname] = useState('')
  const [uom, setUom] = useState('')
  const [refCost, setRefCost] = useState('')

  function reset() { setName(''); setPartNo(''); setNickname(''); setUom(''); setRefCost('') }
  function submit() {
    const n = name.trim()
    if (n) onAdd({ name: n, partNo: partNo.trim(), nickname: nickname.trim(), uom: uom.trim(), refCost: refCost ? Number(refCost) : 0, category })
    reset(); setOpen(false); if (onCancel) onCancel()
  }
  function handleBlur(e) { if (!e.currentTarget.contains(e.relatedTarget)) submit() }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { reset(); setOpen(false); if (onCancel) onCancel() } }

  if (!open) return <CollapsedAddRow label="Add item" indent onClick={() => setOpen(true)} />

  return (
    <div onBlur={handleBlur} style={{ ...rowStyle, background: 'var(--surface-2)', paddingLeft: 34 }}>
      <div style={{ display: 'grid', gridTemplateColumns: CAT_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <input value={partNo} onChange={e => setPartNo(e.target.value)} placeholder="—" onKeyDown={onKey} style={{ ...plainInputStyle, fontSize: 11 }} />
        <NicknameDescInputs nickname={nickname} setNickname={setNickname} name={name} setName={setName} onKey={onKey} />
        <UomSelect value={uom} onChange={setUom} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <input type="number" step="0.01" value={refCost} onChange={e => setRefCost(e.target.value)} placeholder="0.00" onKeyDown={onKey}
            style={{ ...plainInputStyle, ...catFieldStyle, textAlign: 'right' }} />
        </div>
      </div>
    </div>
  )
}

function NewCategoryRow({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  function submit() {
    const n = name.trim()
    if (n) onAdd(n)
    setName(''); setOpen(false)
  }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setName(''); setOpen(false) } }
  if (!open) return <CollapsedAddRow label="Add category" onClick={() => setOpen(true)} />
  return (
    <div style={{ ...rowStyle, background: 'var(--surface-2)' }}>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Category name" onKeyDown={onKey}
        onBlur={submit} style={{ ...plainInputStyle, flex: 1 }} />
    </div>
  )
}

// One node in the category tree — renders its own header, any sub-category
// children (recursively, to any depth), then its direct items, then an
// "add item" / "add sub-category" pair.
function CategoryTreeNode({ node, expandedPaths, onToggle, onRename, onAddSubcategory, onDeleteCategory, onExpandPath, q, ColumnHeader, RowComponent, AddRowComponent, getRowProps, onAddItem, renderCount, allItems }) {
  const isExpanded = q ? true : expandedPaths.has(node.fullPath)
  const children = sortedChildren(node)
  const countLabel = renderCount ? renderCount(node) : countAllItems(node)
  const [addMode, setAddMode] = useState(null) // null | 'menu' | 'item' | 'subcategory'
  const [subName, setSubName] = useState('')

  function submitSub() {
    const n = subName.trim()
    if (n) onAddSubcategory(node.fullPath, n)
    setSubName(''); setAddMode(null)
  }

  return (
    <div>
      <CategoryHeader
        name={node.name} count={countLabel} expanded={isExpanded} onToggle={() => onToggle(node.fullPath)}
        onRename={v => onRename(node.fullPath, v)}
        onDelete={node.fullPath ? () => onDeleteCategory(node.fullPath) : undefined}
      />
      {isExpanded && (
        <div style={{ paddingLeft: 14 }}>
          {children.map(child => (
            <CategoryTreeNode
              key={child.fullPath} node={child} expandedPaths={expandedPaths} onToggle={onToggle} onRename={onRename}
              onAddSubcategory={onAddSubcategory} onDeleteCategory={onDeleteCategory} onExpandPath={onExpandPath} q={q}
              ColumnHeader={ColumnHeader} RowComponent={RowComponent} AddRowComponent={AddRowComponent}
              getRowProps={getRowProps} onAddItem={onAddItem} renderCount={renderCount} allItems={allItems}
            />
          ))}
          {node.items.length > 0 && <ColumnHeader />}
          {node.items.map(item => (
            <div key={item.id}>
              <RowComponent item={item} {...getRowProps(item)} />
              <CategoryPathHint item={item} onUpdate={getRowProps(item).onUpdate} onExpandPath={onExpandPath} allItems={allItems} />
            </div>
          ))}

          {addMode === 'item' && (
            <AddRowComponent category={node.fullPath} onAdd={onAddItem} startOpen onCancel={() => setAddMode(null)} />
          )}
          {addMode === 'subcategory' && (
            <div style={{ ...rowStyle, background: 'var(--surface-2)' }}>
              <input
                autoFocus value={subName} onChange={e => setSubName(e.target.value)} placeholder="Sub-category name"
                onKeyDown={e => { if (e.key === 'Enter') submitSub(); if (e.key === 'Escape') { setSubName(''); setAddMode(null) } }}
                onBlur={submitSub}
                style={{ ...plainInputStyle, flex: 1 }}
              />
            </div>
          )}
          {(addMode === null || addMode === 'menu') && (
            <div style={{ position: 'relative', padding: '4px 16px 6px 34px' }}>
              <button
                onClick={() => setAddMode(m => m === 'menu' ? null : 'menu')}
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--rs)', padding: '5px 12px', cursor: 'pointer' }}
              >
                +
              </button>
              {addMode === 'menu' && (
                <div style={{
                  position: 'absolute', top: '100%', left: 34, marginTop: 2, zIndex: 20,
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden',
                }}>
                  <button
                    onClick={() => setAddMode('item')}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Add item
                  </button>
                  <button
                    onClick={() => setAddMode('subcategory')}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Add sub-category
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Root wrapper: builds the tree from a flat item list, keeps expand state,
// and handles renaming (which rewrites the path prefix for every item under it).
function collectAllPaths(node, acc = []) {
  if (node.fullPath) acc.push(node.fullPath)
  node.children.forEach(c => collectAllPaths(c, acc))
  return acc
}

function CategoryTree({ items, extraPaths, onAddExtraPath, onRenameCategory, onDeleteCategory, onAddItem, getRowProps, ColumnHeader, RowComponent, AddRowComponent, q, renderCount }) {
  const [expanded, setExpanded] = useState(() => new Set())
  function toggle(path) {
    setExpanded(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })
  }
  // Filing an item into "Conduit/PVC" should open Conduit AND Conduit/PVC —
  // otherwise the item just seems to vanish from view when it moves there.
  function expandPath(fullPath) {
    setExpanded(s => {
      const n = new Set(s)
      const segments = fullPath.split('/').map(x => x.trim()).filter(Boolean)
      let acc = ''
      segments.forEach(seg => { acc = acc ? `${acc}/${seg}` : seg; n.add(acc) })
      return n
    })
  }

  const root = buildCategoryTree(items)
  // Manually-added empty categories/sub-categories still need to show up with 0 items
  extraPaths.forEach(path => {
    const segments = path.split('/').map(s => s.trim()).filter(Boolean)
    let node = root
    let acc = ''
    segments.forEach(seg => {
      acc = acc ? `${acc}/${seg}` : seg
      if (!node.children.has(seg)) node.children.set(seg, { name: seg, fullPath: acc, children: new Map(), items: [] })
      node = node.children.get(seg)
    })
  })

  const topChildren = sortedChildren(root)
  const uncategorizedNode = { name: 'Uncategorized', fullPath: '', children: new Map(), items: root.items }

  function expandAll() {
    setExpanded(new Set(['', ...collectAllPaths(root)])) // '' = Uncategorized
  }
  function collapseAll() {
    setExpanded(new Set())
  }

  return (
    <div>
      {topChildren.length > 0 && (
        <div style={{ display: 'flex', gap: 12, padding: '0 16px 8px', justifyContent: 'flex-end' }}>
          <button onClick={expandAll} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Expand all
          </button>
          <button onClick={collapseAll} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Collapse all
          </button>
        </div>
      )}
      {topChildren.map(node => (
        <CategoryTreeNode
          key={node.fullPath} node={node} q={q} expandedPaths={expanded} onToggle={toggle} onRename={onRenameCategory}
          onAddSubcategory={(parentPath, name) => onAddExtraPath(`${parentPath}/${name}`)}
          onDeleteCategory={onDeleteCategory} onExpandPath={expandPath}
          ColumnHeader={ColumnHeader} RowComponent={RowComponent} AddRowComponent={AddRowComponent}
          getRowProps={getRowProps} onAddItem={onAddItem} renderCount={renderCount} allItems={items}
        />
      ))}
      {root.items.length > 0 && (
        <CategoryTreeNode
          node={uncategorizedNode} q={q} expandedPaths={expanded} onToggle={toggle} onRename={() => {}}
          onAddSubcategory={(parentPath, name) => onAddExtraPath(name)}
          onDeleteCategory={onDeleteCategory} onExpandPath={expandPath}
          ColumnHeader={ColumnHeader} RowComponent={RowComponent} AddRowComponent={AddRowComponent}
          getRowProps={getRowProps} onAddItem={onAddItem} renderCount={renderCount} allItems={items}
        />
      )}
      {!q && <NewCategoryRow onAdd={name => onAddExtraPath(name)} />}
    </div>
  )
}

function sumAllValue(node, valueFn) {
  let v = node.items.reduce((s, i) => s + valueFn(i), 0)
  node.children.forEach(c => { v += sumAllValue(c, valueFn) })
  return v
}

const ORDER_FORM_COLS = '56px 52px minmax(110px, 0.5fr) minmax(140px, 1fr) minmax(90px, 0.6fr)'

function OrderFormColumnHeader({ allSelected, onToggleAll }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 2px' }}>
      <input type="checkbox" checked={allSelected} onChange={e => onToggleAll(e.target.checked)} style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }} />
      <div style={{ display: 'grid', gridTemplateColumns: ORDER_FORM_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Qty</span>
        <span style={colHeaderStyle}>UOM</span>
        <span style={colHeaderStyle}>Part No</span>
        <span style={colHeaderStyle}>Description</span>
        <span style={colHeaderStyle}>Nickname</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

function OrderFormRow({ item, stock, selected, onToggleSelected, onUpdate, onDelete }) {
  const onHand = findOnHandMatch(stock, item)
  return (
    <div>
      <div style={rowStyle}>
        <input type="checkbox" checked={selected} onChange={onToggleSelected} style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }} />
        <div style={{ display: 'grid', gridTemplateColumns: ORDER_FORM_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <input type="number" value={item.qty ?? ''} onChange={e => onUpdate({ qty: e.target.value })} style={{ ...plainInputStyle, textAlign: 'center' }} />
          <UomSelect value={item.uom} onChange={v => onUpdate({ uom: v })} />
          <input value={item.partNo || ''} onChange={e => onUpdate({ partNo: e.target.value })} placeholder="—" style={plainInputStyle} />
          <input value={item.desc || ''} onChange={e => onUpdate({ desc: e.target.value })} placeholder="Description" style={plainInputStyle} />
          <input value={item.nickname || ''} onChange={e => onUpdate({ nickname: e.target.value })} placeholder="—" style={plainInputStyle} />
        </div>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Remove line" confirmText="Remove this line?" />
      </div>
      {(item.jobName || item.source === 'phone') && (
        <div style={{ padding: '0 16px 4px 39px', fontSize: 11, color: 'var(--text-light)' }}>
          {item.source === 'phone' ? '📱 from phone · ' : ''}{item.jobName ? <>for <b style={{ color: item.jobId === '__stock__' ? '#1e7a34' : 'var(--text-mid)' }}>{item.jobName}</b></> : 'no job'}
        </div>
      )}
      {onHand && (
        <div style={{ padding: '0 16px 6px', fontSize: 11, color: '#9a6610', display: 'flex', alignItems: 'center', gap: 4 }}>
          ⚠ You already have {onHand.qty} {onHand.uom || ''} of this on hand in Stock
        </div>
      )}
    </div>
  )
}

// Cross-checks an order line against Stock by part number first, falling
// back to name/nickname — so you don't accidentally re-order something
// that's already sitting on the shelf.
function findOnHandMatch(stock, item) {
  if (!stock) return null
  const partNo = (item.partNo || '').trim().toLowerCase()
  const desc = (item.desc || '').trim().toLowerCase()
  if (partNo) {
    const m = stock.find(s => (s.partNo || '').trim().toLowerCase() === partNo)
    if (m && (Number(m.qty) || 0) > 0) return m
  }
  if (desc) {
    const m = stock.find(s =>
      (s.name || '').trim().toLowerCase() === desc ||
      (s.nickname && s.nickname.trim().toLowerCase() === desc)
    )
    if (m && (Number(m.qty) || 0) > 0) return m
  }
  return null
}

// Single-line entry with the same Catalog search-as-you-type used everywhere
// else in the app — pick a match to fill in part no/nickname, or just type
// something new if it isn't in the Catalog yet.
function OrderFormAddRow({ catalog, stock, onAdd }) {
  const [qty, setQty] = useState('')
  const [partNo, setPartNo] = useState('')
  const [desc, setDesc] = useState('')
  const [nickname, setNickname] = useState('')
  const [uom, setUom] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const q = desc.trim().toLowerCase()
  const matches = q ? catalog.filter(c => hit([c.name, c.nickname, ...partNosOf(c)], q)).slice(0, 6) : []

  function pick(c) {
    setDesc(c.name || '')
    setPartNo(c.partNo || '')
    setNickname(c.nickname || '')
    setUom(c.uom || '')
    setShowDropdown(false)
  }

  function submit() {
    if (!desc.trim() && !partNo.trim()) return
    onAdd({ qty: qty ? Number(qty) : 1, partNo: partNo.trim(), desc: desc.trim(), nickname: nickname.trim(), uom: uom.trim() })
    setQty(''); setPartNo(''); setDesc(''); setNickname(''); setUom(''); setShowDropdown(false)
  }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setShowDropdown(false) }

  return (
    <div style={{ ...rowStyle, background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: ORDER_FORM_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="1" onKeyDown={onKey} style={{ ...plainInputStyle, textAlign: 'center' }} />
        <UomSelect value={uom} onChange={setUom} />
        <input value={partNo} onChange={e => setPartNo(e.target.value)} placeholder="—" onKeyDown={onKey} style={plainInputStyle} />
        <div style={{ position: 'relative', minWidth: 0 }}>
          <input
            value={desc}
            onChange={e => { setDesc(e.target.value); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
            placeholder="Type an item…" onKeyDown={onKey} style={plainInputStyle}
          />
          {showDropdown && matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              zIndex: 20, maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
              {matches.map(m => {
                const onHand = findOnHandMatch(stock, { partNo: m.partNo, desc: m.name })
                return (
                  <div key={m.id} onMouseDown={() => pick(m)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {m.nickname ? (
                        <><span style={{ fontWeight: 700 }}>{m.nickname}</span><span style={{ color: 'var(--text-light)' }}> — {m.name}</span></>
                      ) : m.name}
                    </span>
                    {onHand && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, flexShrink: 0, borderRadius: 20, padding: '1px 7px', color: '#9a6610', background: '#fff3d6' }}>
                        {onHand.qty} {onHand.uom || ''} on hand
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Optional" onKeyDown={onKey} style={plainInputStyle} />
      </div>
      <button onClick={submit} style={{ ...delBtnStyle, color: 'var(--accent-dim)', fontSize: 17, fontWeight: 700 }} aria-label="Add line">+</button>
    </div>
  )
}

function OrderFormTab({ catalog, stock, parts = [], jobs = [] }) {
  const [wholesaler, setWholesaler] = useState('')
  const [date, setDate] = useState(() => todayLocal())
  // Kept between visits; items logged on the phone land here too
  const [items, setItems] = useLocalStore('materials_order_list', [])
  const [selectedIds, setSelectedIds] = useState(() => new Set(items.map(i => i.id)))
  // Anything that arrives (e.g. from the phone) starts ticked
  const seenRef = useRef(new Set(items.map(i => i.id)))
  useEffect(() => {
    const fresh = items.filter(i => !seenRef.current.has(i.id))
    if (!fresh.length) return
    fresh.forEach(i => seenRef.current.add(i.id))
    setSelectedIds(s => { const n = new Set(s); fresh.forEach(i => n.add(i.id)); return n })
  }, [items])

  function addItem(data) {
    const id = uid()
    setItems(list => [...list, { id, ...data }])
    setSelectedIds(s => new Set(s).add(id)) // new items default to included
  }
  function updateItem(id, patch) { setItems(list => list.map(i => i.id === id ? { ...i, ...patch } : i)) }
  function deleteItem(id) {
    setItems(list => list.filter(i => i.id !== id))
    setSelectedIds(s => { const n = new Set(s); n.delete(id); return n })
  }
  function toggleSelected(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(items.map(i => i.id)) : new Set())
  }

  const exportItems = items.filter(i => selectedIds.has(i.id))

  // Every job's plan lines set to 🚚 Order that aren't on this sheet or sent yet
  const jobsHub = useHubStore({ hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name, customersKey: 'job_customers', recordsKey: 'job_projects' })
  const [requests] = useLocalStore(REQUESTS_KEY, [])
  const reqRefs = new Set((Array.isArray(requests) ? requests : []).filter(r => !r.removedAt).flatMap(r => (r.items || []).flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId))))
  const sheetRefs = new Set(items.flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId)))
  const waiting = jobsHub.records.filter(j => !j.trashedAt && j.lifecycleStatus !== 'billed')
    .flatMap(j => (j.plannedMaterials || []).filter(l => l.source === 'order' && !reqRefs.has(j.id + ':' + l.id) && !sheetRefs.has(j.id + ':' + l.id)).map(l => ({ j, l })))
  const [showWaiting, setShowWaiting] = useState(true)
  function pullIn(list) {
    setItems(cur => {
      let next = cur
      const byJob = new Map()
      list.forEach(({ j, l }) => { if (!byJob.has(j.id)) byJob.set(j.id, { j, lines: [] }); byJob.get(j.id).lines.push(l) })
      byJob.forEach(({ j, lines }) => { next = addPlanLinesToOrderList(next, j, lines, uid) })
      const fresh = next.filter(x => !cur.some(c => c.id === x.id)).map(x => x.id)
      setSelectedIds(sel => { const n = new Set(sel); fresh.forEach(id => n.add(id)); return n })
      return next
    })
  }
  // sheet lines whose job lines have all gone out on a request
  const sentIds = items.filter(i => (i.planRefs || []).length && i.planRefs.every(p => reqRefs.has(p.jobId + ':' + p.lineId))).map(i => i.id)

  return (
    <div>
      {waiting.length > 0 && (
        <div style={{ margin: '10px 16px 0', border: '1px solid #e0a716', borderRadius: 8, background: '#fffaf0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
            <button onClick={() => setShowWaiting(v => !v)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#8a5d00', padding: 0 }}>
              {showWaiting ? '▾' : '▸'} 📋 Waiting to order — {waiting.length} line{waiting.length === 1 ? '' : 's'} on {new Set(waiting.map(x => x.j.id)).size} job{new Set(waiting.map(x => x.j.id)).size === 1 ? '' : 's'}
            </button>
            <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-light)' }}>From each job's 📋 Plan (lines set to 🚚 Order). Same parts are combined into one line, and each job's share is remembered.</span>
            <button onClick={() => pullIn(waiting)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>+ Add all to this order</button>
          </div>
          {showWaiting && waiting.map(({ j, l }) => (
            <div key={j.id + l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px', borderTop: '1px solid #f1e2bd', fontSize: 12.5 }}>
              <span style={{ width: 60, textAlign: 'right', fontWeight: 700 }}>{l.qty} {l.uom || ''}</span>
              <span style={{ flex: 1 }}>{l.item || l.partNo}{l.partNo && l.item ? <span style={{ color: 'var(--text-light)' }}> · {l.partNo}</span> : null}</span>
              <span style={{ color: 'var(--text-mid)' }}>for <b>{j.name}</b></span>
              <button onClick={() => pullIn([{ j, l }])} style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 5, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>+ Add</button>
            </div>
          ))}
        </div>
      )}
      {sentIds.length > 0 && (
        <div style={{ margin: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1e7a34' }}>
          ✓ {sentIds.length} line{sentIds.length === 1 ? '' : 's'} below already went out (sent or phoned in).
          <button onClick={() => { setItems(list => list.filter(i => !sentIds.includes(i.id))); setSelectedIds(sel => { const n = new Set(sel); sentIds.forEach(id => n.delete(id)); return n }) }}
            style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid #1e7a34', background: '#fff', color: '#1e7a34', cursor: 'pointer' }}>Clear them off the sheet</button>
        </div>
      )}
      <div style={{ padding: '10px 16px 0', fontSize: 11, color: 'var(--text-light)' }}>
        Build a material order: search Catalog &amp; Stock, enter the qty and the job (or Stock) it's for. Items you add on your phone land here too.
        Check off which items belong in a given export; different items can go to different wholesalers, or straight to a plain PDF.
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '10px 16px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 3 }}>Wholesaler (for plain PDF export)</div>
          <input value={wholesaler} onChange={e => setWholesaler(e.target.value)} placeholder="e.g. Guillevin, Westburne…" style={{ ...plainInputStyle, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 3 }}>Date</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...plainInputStyle, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px' }} />
        </div>
      </div>

      {items.length > 0 && <OrderFormColumnHeader allSelected={items.length > 0 && selectedIds.size === items.length} onToggleAll={toggleAll} />}
      {items.map(item => (
        <OrderFormRow
          key={item.id} item={item} stock={stock} selected={selectedIds.has(item.id)}
          onToggleSelected={() => toggleSelected(item.id)}
          onUpdate={patch => updateItem(item.id, patch)} onDelete={() => deleteItem(item.id)}
        />
      ))}
      <QuickAddRow parts={parts} jobs={jobs} allowStock buttonLabel="+ Add to order"
        onAdd={({ part, qty, job }) => addItem({ qty, partNo: part.partNo || '', desc: part.name || '', nickname: part.nickname || '', uom: part.uom || '', jobId: job ? job.id : '', jobName: job ? job.name : '', source: 'desktop' })} />
      <div style={{ padding: '0 16px' }}><details><summary style={{ fontSize: 11, color: 'var(--text-light)', cursor: 'pointer', padding: '6px 0' }}>Type a line by hand instead</summary><OrderFormAddRow catalog={catalog} stock={stock} onAdd={addItem} /></details></div>

      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 8 }}>
          {selectedIds.size} of {items.length} checked{selectedIds.size > 0 ? ' — export uses only the checked items' : ' — check items above to export'}
        </div>
        <WholesalerExportBar
          items={exportItems} wholesaler={wholesaler} date={date}
          jobs={[...new Map(exportItems.filter(i => i.jobName).map(i => [i.jobId || i.jobName, { id: i.jobId, name: i.jobName }])).values()]}
          subjectPrefix={`Material Order — ${date}`}
          saveFolder="Materials/Order Forms"
          emptyMessage="Check at least one item first."
        />
      </div>
    </div>
  )
}

// Runs the same similarity match used per-item, but across every uncategorized
// item in one list at once, checked against a combined Catalog + Stock pool —
// so Stock's categorization can inform Catalog's (or vice versa), then
// presents everything as one batch to confirm before touching anything.
function BulkCategorizeModal({ items, allItems, onApply, onClose }) {
  const suggestions = items
    .filter(i => !i.category)
    .map(i => ({ item: i, suggestion: suggestCategoryFor(i, allItems) }))
    .filter(s => s.suggestion)
  const uncategorizedCount = items.filter(i => !i.category).length

  const [checked, setChecked] = useState(() => new Set(suggestions.map(s => s.item.id)))

  function toggle(id) {
    setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function apply() {
    onApply(suggestions.filter(s => checked.has(s.item.id)))
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth={520}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Check uncategorized against categorized</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
          Found {suggestions.length} match{suggestions.length === 1 ? '' : 'es'} out of {uncategorizedCount} uncategorized item{uncategorizedCount === 1 ? '' : 's'} —
          checked against everything already categorized in both Catalog and Stock. Uncheck anything you don't want applied.
        </div>

        {suggestions.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
            No confident matches found.
          </div>
        )}

        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {suggestions.map(({ item, suggestion }) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.nickname || item.name}
                </div>
                <div style={{ fontSize: 11, color: '#1a5fa0' }}>→ {suggestion}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={apply} disabled={checked.size === 0}
            style={{ flex: 1, padding: 10, background: checked.size === 0 ? 'var(--gray-light)' : 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: checked.size === 0 ? 'default' : 'pointer', color: checked.size === 0 ? 'var(--text-light)' : 'var(--navy)' }}
          >
            Apply {checked.size} categor{checked.size === 1 ? 'y' : 'ies'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function CatalogTab({ catalog, setCatalog, stock, categoryPaths, onAddCategoryPath, onRenameCategory, onDeleteCategory, addToTrash }) {
  const [search, setSearch] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)

  function addItem(data) {
    if (data.category) onAddCategoryPath(data.category)
    setCatalog(list => [...list, { id: uid(), ...data }])
  }
  function updateItem(id, patch) {
    if (patch.category) onAddCategoryPath(patch.category)
    setCatalog(list => list.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  function deleteItem(id) {
    const item = catalog.find(i => i.id === id)
    if (item) addToTrash('catalog_item', item.nickname || item.name || 'Catalog item', item)
    setCatalog(list => list.filter(i => i.id !== id))
  }
  function applyBulkCategories(matches) {
    setCatalog(list => list.map(i => {
      const m = matches.find(x => x.item.id === i.id)
      return m ? { ...i, category: m.suggestion } : i
    }))
  }

  const q = search.trim().toLowerCase()
  const filtered = q ? catalog.filter(i => hit([i.name, i.nickname, i.category, ...partNosOf(i)], q)) : catalog
  const uncategorizedCount = catalog.filter(i => !i.category).length

  return (
    <div>
      <div style={{ padding: '10px 16px 0', fontSize: 11, color: 'var(--text-light)' }}>
        Reference pricing used when searching materials for Quotes and T&M jobs. No count or part number required.
      </div>
      <SearchBox value={search} onChange={setSearch} placeholder="Search catalog…" />
      {uncategorizedCount > 0 && (
        <div style={{ padding: '0 16px 10px' }}>
          <button
            onClick={() => setBulkOpen(true)}
            style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}
          >
            Check {uncategorizedCount} uncategorized against categorized
          </button>
        </div>
      )}
      {catalog.length === 0 && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          {q ? 'No matches.' : 'No catalog items yet.'}
        </div>
      )}
      <CategoryTree
        items={filtered}
        extraPaths={categoryPaths}
        onAddExtraPath={onAddCategoryPath}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onAddItem={addItem}
        getRowProps={item => ({ onUpdate: patch => updateItem(item.id, patch), onDelete: () => deleteItem(item.id) })}
        ColumnHeader={CatColumnHeader}
        RowComponent={CatRow}
        AddRowComponent={CatAddRow}
        q={q}
      />
      {bulkOpen && (
        <BulkCategorizeModal
          items={catalog}
          allItems={[...catalog, ...stock]}
          onApply={applyBulkCategories}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// STOCK — tracked, purchased inventory: Part No | Description | UOM | Price Per | Total on hand
// ══════════════════════════════════════════════════════════════════
const STK_COLS = 'minmax(110px, 0.35fr) minmax(140px, 1fr) 48px 86px 100px'

function StockColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 4px 34px', background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: STK_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Part No:</span>
        <span style={colHeaderStyle}>Nickname / Description:</span>
        <span style={colHeaderStyle}>UOM:</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Price per</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Total on hand</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

// Searches jobs the same way every other job-picker in the app does — type
// to filter by customer or job name, click to pick. Deducts from this stock
// item (paid-for portion first) and adds a matching materials entry onto
// the chosen job, same shape as picking materials from within the job itself.
function AllocateToJobModal({ item, onClose, onAllocate }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [query, setQuery] = useState('')
  const [selectedJob, setSelectedJob] = useState(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')

  if (jobsHub.loading) return null

  const onHand = Number(item.qty) || 0
  const jobOptions = jobsHub.records
    .filter(p => !p.trashedAt)
    .map(p => ({ ...p, customerName: jobsHub.customers.find(c => c.id === p.customerId)?.name || 'Unknown customer' }))

  const q = query.trim().toLowerCase()
  const matches = q ? jobOptions.filter(j => hit([j.customerName, j.name, j.co], q)).slice(0, 8) : []

  function pickJob(j) {
    setSelectedJob(j)
    setQuery(`${j.customerName} — ${j.name}`)
    setShowDropdown(false)
  }
  function handleQueryChange(v) {
    setQuery(v)
    setSelectedJob(null)
    setShowDropdown(true)
  }

  function confirm() {
    const usedQty = Number(qty)
    if (!selectedJob) { setError('Pick a job first.'); return }
    if (!usedQty || usedQty <= 0) { setError('Enter a quantity.'); return }
    if (usedQty > onHand) { setError(`Only ${onHand} on hand.`); return }

    // File it as a materials entry on the job, same shape as picking it from within the job itself
    const paidFor = Number(item.paidForQty) || 0
    const freeQty = Math.min(usedQty, paidFor)
    const costQty = usedQty - freeQty
    const cost = Number(item.cost) || 0
    // T&M jobs bill the customer for it even if it's paid-for stock (shop stock isn't theirs)
    const effectivePrice = selectedJob.type === 'tm' ? cost : usedQty > 0 ? (costQty * cost) / usedQty : 0

    const entries = selectedJob.materialEntries || []
    const newEntry = {
      id: uid(), kind: 'stock', partNo: item.partNo || '', item: item.nickname || item.name || 'Material',
      uom: item.uom || '', qty: usedQty, price: effectivePrice,
      stockId: item.id, stockQty: usedQty, stockFree: freeQty, stockUnit: cost,
    }
    const nextEntries = [...entries, newEntry]
    const actualMaterials = nextEntries.reduce((s, e) => s + (Number(e.qty) || 0) * (Number(e.price) || 0), 0)
    jobsHub.updateRecord(selectedJob.id, { materialEntries: nextEntries, actualMaterials })

    onAllocate(usedQty, freeQty, selectedJob)
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth={420}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Allocate to Job</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
          {item.nickname || item.name} — {onHand} {item.uom || 'on hand'}
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <input
            autoFocus value={query} onChange={e => handleQueryChange(e.target.value)}
            onFocus={() => !selectedJob && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search for a job…"
            style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontFamily: 'var(--font)', fontWeight: selectedJob ? 700 : 400, boxSizing: 'border-box' }}
          />
          {showDropdown && matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 20,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
              {matches.map(j => (
                <div key={j.id} onMouseDown={() => pickJob(j)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-light)' }}>{j.customerName} — </span>
                  <span style={{ fontWeight: 700 }}>{j.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 3 }}>Quantity to allocate</div>
          <input
            type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder={`Up to ${onHand}`}
            style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontFamily: 'var(--font)', boxSizing: 'border-box' }}
          />
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={confirm} style={{ flex: 1, padding: 10, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}>
            Allocate
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function StockRow({ item, order, onUpdate, onDelete }) {
  const [allocating, setAllocating] = useState(false)
  const total = (Number(item.qty) || 0) * (Number(item.cost) || 0)


  function allocateToJob(usedQty, freeQty, job) {
    const onHand = Number(item.qty) || 0
    const paidFor = Number(item.paidForQty) || 0
    const log = [...(item.allocationLog || []), {
      id: uid(), date: new Date().toISOString(), qty: usedQty,
      jobName: job?.name || 'Untitled job', customerName: job?.customerName || 'Unknown customer',
    }]
    onUpdate({ qty: Math.max(0, onHand - usedQty), paidForQty: Math.max(0, paidFor - freeQty), allocationLog: log })
  }

  return (
    <div>
      <div style={{ ...rowStyle, paddingLeft: 34 }}>
        <div style={{ display: 'grid', gridTemplateColumns: STK_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <EditableField value={item.partNo} placeholder="—" onSave={v => onUpdate({ partNo: v })} style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} />
          <NicknameDescCell item={item} onUpdate={onUpdate} />
          <UomSelect value={item.uom} onChange={v => onUpdate({ uom: v })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
            <input type="number" step="0.01" value={item.cost ?? ''} onChange={e => onUpdate({ cost: e.target.value })}
              placeholder="0.00" style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <input type="number" value={item.qty ?? ''} onChange={e => onUpdate({ qty: e.target.value })}
              placeholder="0" style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right', width: 50 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-mid)' }}>{money(total)}</span>
          </div>
        </div>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete stock item" confirmText="Delete this stock item?" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 8px 34px', flexWrap: 'wrap' }}>
        {order && (
          <span style={{ fontSize: 10, color: 'var(--blue-dark)', background: 'var(--blue-bg)', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>
            From order: {order.wholesaler || 'Unknown'} · {order.orderDate || '—'}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-light)' }}>
          Already paid for:
          <input
            type="number" value={item.paidForQty ?? 0}
            onChange={e => onUpdate({ paidForQty: Math.max(0, Math.min(Number(item.qty) || 0, Number(e.target.value) || 0)) })}
            style={{ width: 42, fontSize: 11, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 3px', fontFamily: 'var(--font)' }}
          />
          of {Number(item.qty) || 0} on hand
        </span>
        <button
          onClick={() => setAllocating(true)}
          disabled={(Number(item.qty) || 0) <= 0}
          style={{
            fontSize: 10.5, fontWeight: 700, color: (Number(item.qty) || 0) <= 0 ? 'var(--text-light)' : '#1a5fa0',
            background: (Number(item.qty) || 0) <= 0 ? 'var(--surface-2)' : '#e8f2fc',
            border: 'none', borderRadius: 20, padding: '3px 10px', cursor: (Number(item.qty) || 0) <= 0 ? 'default' : 'pointer',
          }}
        >
          Allocate to Job
        </button>
      </div>
      {(Number(item.paidForQty) || 0) > 0 && (
        <div style={{ padding: '0 16px 8px 34px', fontSize: 10, color: 'var(--text-light)' }}>
          Jobs draw from the paid-for amount first, at no cost — once that runs out, further use gets costed at ${(Number(item.cost) || 0).toFixed(2)}/{item.uom || 'unit'}.
        </div>
      )}
      <PriceHistoryHint history={item.priceHistory} />
      <AllocationHistoryHint log={item.allocationLog} />
      {allocating && (
        <AllocateToJobModal item={item} onClose={() => setAllocating(false)} onAllocate={allocateToJob} />
      )}

    </div>
  )
}

function StockAddRow({ category, onAdd, catalog, startOpen, onCancel }) {
  const [open, setOpen] = useState(!!startOpen)
  const [name, setName] = useState('')
  const [partNo, setPartNo] = useState('')
  const [nickname, setNickname] = useState('')
  const [qty, setQty] = useState('')
  const [uom, setUom] = useState('')
  const [cost, setCost] = useState('')
  const [alreadyPaidFor, setAlreadyPaidFor] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)

  const q = name.trim().toLowerCase()
  const matches = (catalog && q) ? catalog.filter(c => hit([c.name, c.nickname, ...partNosOf(c)], q)).slice(0, 6) : []

  function pick(c) {
    setName(c.name || '')
    setPartNo(c.partNo || '')
    setNickname(c.nickname || '')
    setUom(c.uom || '')
    if (c.refCost != null) setCost(String(c.refCost))
    setShowDropdown(false)
  }

  function reset() { setName(''); setPartNo(''); setNickname(''); setQty(''); setUom(''); setCost(''); setAlreadyPaidFor(true); setShowDropdown(false) }
  function submit() {
    const n = name.trim()
    const enteredQty = qty ? Number(qty) : 0
    if (n) onAdd({
      name: n, partNo: partNo.trim(), nickname: nickname.trim(), qty: enteredQty, uom: uom.trim(), cost: cost ? Number(cost) : 0,
      paidForQty: alreadyPaidFor ? enteredQty : 0, category,
    })
    reset(); setOpen(false); if (onCancel) onCancel()
  }
  function handleBlur(e) { if (!e.currentTarget.contains(e.relatedTarget)) submit() }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { reset(); setOpen(false); if (onCancel) onCancel() } }

  if (!open) return <CollapsedAddRow label="Add stock item manually" indent onClick={() => setOpen(true)} />

  return (
    <div onBlur={handleBlur} style={{ background: 'var(--surface-2)' }}>
      <div style={{ ...rowStyle, background: 'var(--surface-2)', paddingLeft: 34 }}>
        <div style={{ display: 'grid', gridTemplateColumns: STK_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <input value={partNo} onChange={e => setPartNo(e.target.value)} placeholder="—" onKeyDown={onKey} style={{ ...plainInputStyle, fontSize: 11 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, position: 'relative' }}>
            <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="+ nickname" onKeyDown={onKey}
              style={{ ...plainInputStyle, fontSize: 11, fontWeight: 700 }} />
            <input
              autoFocus value={name}
              onChange={e => { setName(e.target.value); if (catalog) setShowDropdown(true) }}
              onFocus={() => catalog && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
              placeholder={catalog ? 'Search Catalog or type new…' : 'Description'} onKeyDown={onKey}
              style={{ ...plainInputStyle, fontSize: 12.5 }}
            />
            {showDropdown && matches.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
                zIndex: 20, maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                {matches.map(m => (
                  <div key={m.id} onMouseDown={() => pick(m)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                    {m.nickname ? (
                      <><span style={{ fontWeight: 700 }}>{m.nickname}</span><span style={{ color: 'var(--text-light)' }}> — {m.name}</span></>
                    ) : m.name}
                    {m.refCost != null && <span style={{ color: 'var(--text-light)', float: 'right' }}>{money(m.refCost)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <UomSelect value={uom} onChange={setUom} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
            <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" onKeyDown={onKey}
              style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
          </div>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" onKeyDown={onKey}
            style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px 8px 34px', fontSize: 11, color: 'var(--text-light)', cursor: 'pointer' }}>
        <input type="checkbox" checked={alreadyPaidFor} onChange={e => setAlreadyPaidFor(e.target.checked)} />
        This is stock you already have — no cost to jobs until it runs out, then new purchases get costed normally
      </label>
    </div>
  )
}

function StockTab({ stock, setStock, orders, catalog, categoryPaths, onAddCategoryPath, onRenameCategory, onDeleteCategory, addToTrash }) {
  const [search, setSearch] = useState('')
  const [hideEmpty, setHideEmpty] = useLocalStore('material_stock_hide_empty', true)
  const [bulkOpen, setBulkOpen] = useState(false)

  function updateItem(id, patch) {
    if (patch.category) onAddCategoryPath(patch.category)
    setStock(list => list.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  function deleteItem(id) {
    const item = stock.find(i => i.id === id)
    if (item) addToTrash('stock_item', item.nickname || item.name || 'Stock item', item)
    setStock(list => list.filter(i => i.id !== id))
  }
  function addItem(data) {
    if (data.category) onAddCategoryPath(data.category)
    setStock(list => [...list, { id: uid(), ...data }])
  }
  function applyBulkCategories(matches) {
    setStock(list => list.map(i => {
      const m = matches.find(x => x.item.id === i.id)
      return m ? { ...i, category: m.suggestion } : i
    }))
  }

  const q = search.trim().toLowerCase()
  const withStock = hideEmpty ? stock.filter(i => (Number(i.qty) || 0) > 0) : stock
  const hiddenCount = stock.length - withStock.length
  const filtered = q ? withStock.filter(i => hit([i.name, i.partNo, i.nickname, i.category], q)) : withStock
  const uncategorizedCount = stock.filter(i => !i.category).length

  return (
    <div>
      <div style={{ padding: '10px 16px 0', fontSize: 11, color: 'var(--text-light)' }}>
        Tracked, on-hand material. Every item here should have a part number and, where possible, a linked order.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px 0', fontSize: 12, color: 'var(--text-mid)', cursor: 'pointer' }}>
        <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />
        Hide items with 0 on hand{hideEmpty && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
      </label>
      {uncategorizedCount > 0 && (
        <div style={{ padding: '8px 16px 0' }}>
          <button
            onClick={() => setBulkOpen(true)}
            style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}
          >
            Check {uncategorizedCount} uncategorized against categorized
          </button>
        </div>
      )}
      <SearchBox value={search} onChange={setSearch} placeholder="Search stock…" />
      <StockAddRow category="" onAdd={addItem} catalog={catalog} />
      {stock.length === 0 && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          {q ? 'No matches.' : 'No stock yet — upload an order or add an item manually.'}
        </div>
      )}
      {stock.length > 0 && filtered.length === 0 && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          {q ? 'No matches.' : 'Nothing with stock on hand right now — uncheck the box above to see everything.'}
        </div>
      )}
      <CategoryTree
        items={filtered}
        extraPaths={hideEmpty ? [] : categoryPaths}
        onAddExtraPath={onAddCategoryPath}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onAddItem={addItem}
        getRowProps={item => ({ onUpdate: patch => updateItem(item.id, patch), onDelete: () => deleteItem(item.id), order: orders.find(o => o.id === item.orderId) })}
        ColumnHeader={StockColumnHeader}
        RowComponent={StockRow}
        AddRowComponent={props => <StockAddRow {...props} catalog={catalog} />}
        q={q}
        renderCount={node => `${countAllItems(node)} · ${money(sumAllValue(node, i => (Number(i.qty) || 0) * (Number(i.cost) || 0)))}`}
      />
      {bulkOpen && (
        <BulkCategorizeModal
          items={stock}
          allItems={[...catalog, ...stock]}
          onApply={applyBulkCategories}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// CATALOG & STOCK — one list. Every part lives in the Catalog (reference
// price); Stock is a layer on top: what's actually on the shelf, how many,
// what it cost. "Only display stock items" hides everything not on hand.
// ══════════════════════════════════════════════════════════════════
const lcs = s => String(s || '').trim().toLowerCase()

// Pair each Catalog part with its Stock lots. A part can have several lots
// (e.g. CAT6 Box 1, Box 2…), each tracked on its own; the row shows the total.
// A stock lot with no Catalog part still gets a row (Materials creates the part).
function pairCatalogStock(catalog, stock) {
  const used = new Set()
  const free = x => !used.has(x.id)
  const all = stock || []
  const rows = (catalog || []).map(c => {
    const lots = all.filter(x => free(x) && (x.catalogId === c.id || (!x.catalogId && (
      (x.partNo && hasPartNo(c, x.partNo)) ||
      (!(x.partNo && partNosOf(c).length) && ((c.nickname && x.nickname && lcs(x.nickname) === lcs(c.nickname)) || (c.name && lcs(x.name) === lcs(c.name))))))))
    lots.forEach(x => used.add(x.id))
    return { cat: c, lots }
  })
  all.filter(free).forEach(x => rows.push({ cat: null, lots: [x] }))
  return rows.map(({ cat, lots }) => {
    // the lot to draw from first: the open one (least left), then any with stock
    const withQty = lots.filter(l => (Number(l.qty) || 0) > 0).sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0))
    const stk = withQty[0] || lots[0] || null
    const b = cat || stk
    return {
      id: cat ? `c:${cat.id}` : `s:${stk.id}`, cat, stk, lots,
      name: b.name || '', partNo: b.partNo || '', nickname: (cat ? cat.nickname : stk.nickname) || '', uom: b.uom || '',
      category: (cat && cat.category) || (stk && stk.category) || '',
      refCost: cat ? cat.refCost : stk.cost, priceHistory: (cat && cat.priceHistory) || (stk && stk.priceHistory),
      onHand: lots.reduce((a, l) => a + (Number(l.qty) || 0), 0),
      stockValue: lots.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0),
    }
  })
}

const PART_COLS = 'minmax(110px, 0.35fr) minmax(140px, 1fr) 52px 90px 100px'

function PartColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 4px 34px', background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: PART_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Part No:</span>
        <span style={colHeaderStyle}>Nickname / Description:</span>
        <span style={colHeaderStyle}>UOM:</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Ref cost</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>In stock</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

const pill = (on) => ({ fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '3px 10px', border: 'none', cursor: 'pointer', background: on ? '#e8f2fc' : 'var(--surface-2)', color: on ? '#1a5fa0' : 'var(--text-light)' })

function PartRow({ item, order, onUpdate, onUpdateStock, onAddStock, onDelete, tentative, onCount, priceFrom }) {
  const [counting, setCounting] = useState(null) // { qty, note } while the count box is open
  const [allocating, setAllocating] = useState(false) // false | lot id
  const [lotsOpen, setLotsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addQty, setAddQty] = useState('')
  const [addCost, setAddCost] = useState('')
  const [addPaid, setAddPaid] = useState(true)
  const s = item.stk
  const lots = item.lots || (s ? [s] : [])
  const multi = lots.length > 1
  const onHand = item.onHand || 0
  const lotFor = id => lots.find(l => l.id === id) || s

  function allocateToJob(lot, usedQty, freeQty, job) {
    const log = [...(lot.allocationLog || []), {
      id: uid(), date: new Date().toISOString(), qty: usedQty,
      jobName: job?.name || 'Untitled job', customerName: job?.customerName || 'Unknown customer',
    }]
    onUpdateStock({ qty: Math.max(0, (Number(lot.qty) || 0) - usedQty), paidForQty: Math.max(0, (Number(lot.paidForQty) || 0) - freeQty), allocationLog: log }, lot.id)
  }
  function submitAdd() {
    const q = Number(addQty) || 0
    if (q <= 0) { setAdding(false); return }
    const cost = addCost !== '' ? Number(addCost) || 0 : Number(item.refCost) || 0
    if (s && !multi) onUpdateStock({ qty: (Number(s.qty) || 0) + q, cost, paidForQty: (Number(s.paidForQty) || 0) + (addPaid ? q : 0) }, s.id)
    else onAddStock({ qty: q, cost, paidForQty: addPaid ? q : 0, ...(multi ? { nickname: `Lot ${lots.length + 1}` } : {}) })
    setAdding(false); setAddQty(''); setAddCost('')
  }

  return (
    <div>
      <div style={{ ...rowStyle, paddingLeft: 34 }}>
        <div style={{ display: 'grid', gridTemplateColumns: PART_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
          <EditableField value={item.partNo} placeholder="—" onSave={v => onUpdate({ partNo: v })} style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} />
          <NicknameDescCell item={item} onUpdate={onUpdate} />
          <UomSelect value={item.uom} onChange={v => onUpdate({ uom: v })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
            <input type="number" step="0.01" value={item.refCost ?? ''} onChange={e => onUpdate({ refCost: e.target.value })}
              placeholder="0.00" style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
          </div>
          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            {tentative
              ? <span title={`Count waiting for approval (${tentative.by || 'phone'}) — was ${onHand}`} style={{ fontSize: 11, fontWeight: 800, color: '#9a6610', background: '#fff3d6', borderRadius: 10, padding: '1px 6px', whiteSpace: 'nowrap' }}>⏳ {tentative.qty}</span>
              : s && onHand > 0
              ? <span style={{ fontSize: 12.5, fontWeight: 800, color: '#1e7a34' }}>{onHand}</span>
              : <button onClick={() => setAdding(a => !a)} title="Put some of this into Stock" style={{ ...pill(false), padding: '2px 8px' }}>{s ? '0 · +' : '+ Stock'}</button>}
            {onCount && <button onClick={() => setCounting(c => c ? null : { qty: '', note: '' })} title="Send a new count for approval (tentative until approved)" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-light)', padding: 0 }}>✎</button>}
          </div>
        </div>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete part"
          confirmText={s && onHand > 0 ? `Delete this part? It also removes the ${onHand} in Stock.` : 'Delete this part?'} />
      </div>

      {counting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 8px 34px', flexWrap: 'wrap', fontSize: 11.5, background: '#fffaf0' }}>
          <span style={{ fontWeight: 700, color: '#8a5d00' }}>Count (on hand now {onHand} {item.uom || ''}):</span>
          <input autoFocus type="number" value={counting.qty} onChange={e => setCounting(c => ({ ...c, qty: e.target.value }))} placeholder="Counted"
            onKeyDown={e => { if (e.key === 'Enter' && counting.qty !== '') { onCount(counting.qty, counting.note); setCounting(null) } if (e.key === 'Escape') setCounting(null) }}
            style={{ width: 70, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px' }} />
          <input value={counting.note} onChange={e => setCounting(c => ({ ...c, note: e.target.value }))} placeholder="Note (optional)"
            style={{ width: 180, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px' }} />
          <button disabled={counting.qty === ''} onClick={() => { onCount(counting.qty, counting.note); setCounting(null) }} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', border: 'none', borderRadius: 6, background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Send for approval</button>
          <button onClick={() => setCounting(null)} style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      {item.cat && isMerged(item.cat) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 6px 34px', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-mid)' }}>
          <span style={{ fontWeight: 700, color: '#1a5fa0' }}>🔗 Same part from:</span>
          {item.cat.parts.map(p => (
            <span key={p.partNo} style={{ background: '#e8f2fc', borderRadius: 10, padding: '1px 4px 1px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <b>{p.partNo}</b>{p.supplier ? ` ${p.supplier}` : ''} {Number(p.price) > 0 ? money(p.price) : '—'}
              <button title="Not the same part — take this part # off" onClick={() => {
                const parts = item.cat.parts.filter(x => x.partNo !== p.partNo)
                onUpdate(parts.length > 1
                  ? { parts, refCost: priceByRule(parts, item.cat.priceRule) }
                  : { parts: undefined, priceRule: undefined, partNo: (parts[0] && parts[0].partNo) || item.cat.partNo })
              }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 11, padding: 0 }}>✕</button>
            </span>
          ))}
          <span>Catalog price =</span>
          <select value={item.cat.priceRule || 'highest'} onChange={e => onUpdate({ priceRule: e.target.value, refCost: priceByRule(item.cat.parts, e.target.value) })}
            style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px' }}>
            <option value="highest">highest</option>
            <option value="average">average</option>
          </select>
        </div>
      )}

      {multi && onHand > 0 && (
        <div style={{ padding: '0 16px 6px 34px', fontSize: 11, color: 'var(--text-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '2px 8px' }}>📦 STOCK</span>
            <button onClick={() => setLotsOpen(o => !o)} style={{ ...pill(true), background: 'none', padding: 0 }}>{lotsOpen ? '▾' : '▸'} {onHand} {lots[0].uom || item.uom || ''} across {lots.length} lots</button>
            <span style={{ fontWeight: 700, color: 'var(--text-mid)' }}>= {money(item.stockValue)}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setAdding(a => !a)} style={pill(false)}>+ Add a lot</button>
            <button onClick={() => setAllocating(s.id)} style={pill(true)}>Allocate to Job</button>
          </div>
          {lotsOpen && lots.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0 0 14px', flexWrap: 'wrap' }}>
              <EditableField value={l.nickname} placeholder="Lot name" onSave={v => onUpdateStock({ nickname: v }, l.id)} style={{ fontSize: 11, fontWeight: 700, minWidth: 60 }} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>On hand
                <input type="number" value={l.qty ?? ''} onChange={e => onUpdateStock({ qty: e.target.value }, l.id)}
                  style={{ width: 60, fontSize: 11, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 3px', fontFamily: 'var(--font)' }} /> {l.uom || ''}
              </span>
              <span>@ {money(l.cost)}</span>
              {Number(l.paidForQty) > 0 && <span>{l.paidForQty} paid for</span>}
              {l.id === s.id && Number(l.qty) > 0 && <span style={{ color: '#1a5fa0', fontWeight: 700 }}>← used first</span>}
              <span style={{ flex: 1 }} />
              {Number(l.qty) > 0 && <button onClick={() => setAllocating(l.id)} style={pill(true)}>Allocate</button>}
            </div>
          ))}
        </div>
      )}

      {s && !multi && onHand > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 6px 34px', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-light)' }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '2px 8px' }}>📦 STOCK</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>On hand
            <input type="number" value={s.qty ?? ''} onChange={e => onUpdateStock({ qty: e.target.value }, s.id)}
              style={{ width: 54, fontSize: 11, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 3px', fontFamily: 'var(--font)' }} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>@ $
            <input type="number" step="0.01" value={s.cost ?? ''} onChange={e => onUpdateStock({ cost: e.target.value }, s.id)}
              style={{ width: 62, fontSize: 11, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 3px', fontFamily: 'var(--font)' }} />
          </span>
          <span style={{ fontWeight: 700, color: 'var(--text-mid)' }}>= {money(onHand * (Number(s.cost) || 0))}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>Already paid for
            <input type="number" value={s.paidForQty ?? 0}
              onChange={e => onUpdateStock({ paidForQty: Math.max(0, Math.min(onHand, Number(e.target.value) || 0)) }, s.id)}
              style={{ width: 42, fontSize: 11, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 3px', fontFamily: 'var(--font)' }} />
          </span>
          {order && <span style={{ fontSize: 10, color: 'var(--blue-dark)', background: 'var(--blue-bg)', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>From order: {order.wholesaler || 'Unknown'} · {order.orderDate || '—'}</span>}
          <span style={{ flex: 1 }} />
          <button onClick={() => setAdding(a => !a)} style={pill(false)}>+ Add to stock</button>
          <button onClick={() => setAllocating(s.id)} style={pill(true)}>Allocate to Job</button>
        </div>
      )}

      {adding && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px 8px 34px', flexWrap: 'wrap', fontSize: 11.5, background: 'var(--surface-2)' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-mid)' }}>Add to Stock:</span>
          <input autoFocus type="number" value={addQty} onChange={e => setAddQty(e.target.value)} placeholder="Qty"
            onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') setAdding(false) }}
            style={{ width: 60, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px' }} />
          <span>@ $</span>
          <input type="number" step="0.01" value={addCost} onChange={e => setAddCost(e.target.value)} placeholder={String((s ? s.cost : item.refCost) ?? '0.00')}
            onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
            style={{ width: 70, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-light)' }}>
            <input type="checkbox" checked={addPaid} onChange={e => setAddPaid(e.target.checked)} /> already paid for (no cost to jobs)
          </label>
          <button onClick={submitAdd} style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 12px', border: 'none', borderRadius: 6, background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Add</button>
          <button onClick={() => setAdding(false)} style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      <PriceSourceLine src={priceFrom} refCost={item.refCost} />
      <PriceHistoryHint history={item.priceHistory} />
      {s && <AllocationHistoryHint log={lots.flatMap(l => (l.allocationLog || []).map(x => ({ ...x, jobName: multi ? `${x.jobName} (${l.nickname || 'lot'})` : x.jobName })))} />}
      {allocating && s && (() => { const lot = lotFor(allocating); return <AllocateToJobModal item={lot} onClose={() => setAllocating(false)} onAllocate={(q, f, j) => allocateToJob(lot, q, f, j)} /> })()}
    </div>
  )
}

function PartAddRow({ category, onAdd, startOpen, onCancel }) {
  const [open, setOpen] = useState(!!startOpen)
  const [name, setName] = useState('')
  const [partNo, setPartNo] = useState('')
  const [nickname, setNickname] = useState('')
  const [uom, setUom] = useState('')
  const [refCost, setRefCost] = useState('')
  const [qty, setQty] = useState('')

  function reset() { setName(''); setPartNo(''); setNickname(''); setUom(''); setRefCost(''); setQty('') }
  function submit() {
    const n = name.trim()
    if (n) onAdd({ name: n, partNo: partNo.trim(), nickname: nickname.trim(), uom: uom.trim(), refCost: refCost ? Number(refCost) : 0, category, stockQty: Number(qty) || 0 })
    reset(); setOpen(false); if (onCancel) onCancel()
  }
  function handleBlur(e) { if (!e.currentTarget.contains(e.relatedTarget)) submit() }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { reset(); setOpen(false); if (onCancel) onCancel() } }

  if (!open) return <CollapsedAddRow label="Add item" indent onClick={() => setOpen(true)} />
  return (
    <div onBlur={handleBlur} style={{ ...rowStyle, background: 'var(--surface-2)', paddingLeft: 34 }}>
      <div style={{ display: 'grid', gridTemplateColumns: PART_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <input value={partNo} onChange={e => setPartNo(e.target.value)} placeholder="—" onKeyDown={onKey} style={{ ...plainInputStyle, fontSize: 11 }} />
        <NicknameDescInputs nickname={nickname} setNickname={setNickname} name={name} setName={setName} onKey={onKey} />
        <UomSelect value={uom} onChange={setUom} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <input type="number" step="0.01" value={refCost} onChange={e => setRefCost(e.target.value)} placeholder="0.00" onKeyDown={onKey}
            style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
        </div>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" title="How many you have on hand (leave blank if none)" onKeyDown={onKey}
          style={{ ...plainInputStyle, fontSize: 12.5, textAlign: 'right' }} />
      </div>
    </div>
  )
}

function PartsTab({ catalog, setCatalog, stock, setStock, orders, categoryPaths, onAddCategoryPath, onRenameCategory, onDeleteCategory, addToTrash, initialStockOnly }) {
  const [search, setSearch] = useState('')
  const [stockOnlySaved, setStockOnly] = useLocalStore('material_parts_stock_only', false)
  const [forced, setForced] = useState(!!initialStockOnly)
  const stockOnly = forced || stockOnlySaved
  const [bulkOpen, setBulkOpen] = useState(false)
  const rows = pairCatalogStock(catalog, stock)
  const feedForPrices = useOrdersFeed()
  const prevForPrices = useOrdersPrevious()
  const priceIdx = useMemo(() => buildPriceIndex(orders, [...(feedForPrices || []), ...(prevForPrices || [])]), [orders, feedForPrices, prevForPrices])
  const [catPending, setCatPending] = useLocalStore(CATALOG_PENDING_KEY, [])
  // Counts / new items from here go through the same approval as the phone's
  const tentativeFor = row => { const t = (catPending || []).filter(x => x.kind === 'count' && ((row.cat && x.catalogId === row.cat.id) || (row.stk && x.stockId === row.stk.id))); return t.length ? t[t.length - 1] : null }
  const pendId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  function sendCount(row, qty, note) {
    const c = row.cat || {}
    setCatPending(list => [...list, { id: pendId(), kind: 'count', catalogId: row.cat ? row.cat.id : null, stockId: row.stk ? row.stk.id : null, item: row.nickname || row.name, name: row.name, nickname: row.nickname || '', partNo: row.partNo || c.partNo || '', uom: row.uom || '', prevQty: row.onHand || 0, qty: Number(qty) || 0, note: note || '', by: 'Desktop', at: new Date().toISOString(), source: 'desktop' }])
  }
  const [newOpen, setNewOpen] = useState(false)
  const dups = findDuplicateParts(catalog, stock)
  const [dupOpen, setDupOpen] = useState(false)
  // set when you give a part the same nickname as another — the merge prompt
  // opens on just that group
  const [dupFocus, setDupFocus] = useState(null)
  const shownDups = dupFocus ? dups.filter(g => g.items.some(c => c.id === dupFocus)) : dups
  function applyMerge(picks) {
    const r = mergeDuplicates(catalog, stock, picks)
    r.trashed.forEach(c => addToTrash('catalog_item', c.nickname || c.name || 'Catalog item', c))
    setCatalog(r.catalog); setStock(r.stock)
  }

  const SHARED = ['partNo', 'name', 'nickname', 'uom', 'category']
  function updateRow(row, patch) {
    if (patch.category) onAddCategoryPath(patch.category)
    const nn = String(patch.nickname || '').trim().toLowerCase()
    if (row.cat && nn && !/^(box|lot)\s*\d+$/.test(nn) && (catalog || []).some(c => c.id !== row.cat.id && String(c.nickname || '').trim().toLowerCase() === nn)) {
      setDupFocus(row.cat.id); setDupOpen(true)
    }
    // several lots keep their own names (Box 1, Box 2…); the rest is shared
    const lotIds = new Set((row.lots || []).map(l => l.id))
    const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => SHARED.includes(k) && !(k === 'nickname' && lotIds.size > 1)))
    if (row.cat) setCatalog(list => list.map(i => i.id === row.cat.id ? { ...i, ...patch } : i))
    else if ('refCost' in patch) setStock(list => list.map(i => i.id === row.stk.id ? { ...i, cost: patch.refCost } : i))
    if (lotIds.size && Object.keys(shared).length) setStock(list => list.map(i => lotIds.has(i.id) ? { ...i, ...shared } : i))
  }
  function updateStock(row, patch, lotId) { const id = lotId || row.stk.id; setStock(list => list.map(i => i.id === id ? { ...i, ...patch } : i)) }
  function addStock(row, data) {
    const c = row.cat || { ...row.stk, id: row.stk.catalogId }
    setStock(list => [...list, { id: uid(), catalogId: c.id, name: c.name, partNo: c.partNo || '', nickname: c.nickname || '', uom: c.uom || '', category: c.category || '', ...data }])
  }
  function deleteRow(row) {
    if (row.cat) { addToTrash('catalog_item', row.cat.nickname || row.cat.name || 'Catalog item', row.cat); setCatalog(list => list.filter(i => i.id !== row.cat.id)) }
    const lots = row.lots || (row.stk ? [row.stk] : [])
    if (lots.length) { lots.forEach(l => addToTrash('stock_item', l.nickname || l.name || 'Stock item', l)); const ids = new Set(lots.map(l => l.id)); setStock(list => list.filter(i => !ids.has(i.id))) }
  }
  function addItem(data) {
    const { stockQty, ...c } = data
    if (c.category) onAddCategoryPath(c.category)
    const id = uid()
    setCatalog(list => [...list, { id, ...c }])
    if (stockQty > 0) setStock(list => [...list, { id: uid(), catalogId: id, name: c.name, partNo: c.partNo, nickname: c.nickname, uom: c.uom, category: c.category || '', qty: stockQty, cost: c.refCost || 0, paidForQty: stockQty }])
  }
  function applyBulkCategories(matches) {
    matches.forEach(m => updateRow(m.item, { category: m.suggestion }))
  }

  const q = search.trim().toLowerCase()
  const inStock = rows.filter(r => r.stk && r.onHand > 0)
  const base = stockOnly ? inStock : rows
  const filtered = q ? base.filter(i => hit([i.name, i.nickname, i.category, i.uom, ...(i.cat ? partNosOf(i.cat) : [i.partNo]), ...(i.lots || []).map(l => l.partNo)], q)) : base
  const uncategorizedCount = rows.filter(i => !i.category).length
  const stockValue = inStock.reduce((a, r) => a + (r.stockValue || 0), 0)
  const [counting, setCounting] = useState(false)
  const [countSession] = useLocalStore('stock_count', null)
  const lastCount = lastFullCount()

  if (counting) return <StockCount rows={rows} setStock={setStock} setCatalog={setCatalog} catPending={catPending} setCatPending={setCatPending} onClose={() => setCounting(false)} />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 0', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 220, fontSize: 11, color: 'var(--text-light)' }}>
          Every part and its reference price. Parts you have on the shelf show their Stock count — taking them on a job counts them down.
          {' '}<b style={{ color: 'var(--text-mid)' }}>Stock value {'$' + stockValue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>{lastCount ? ` · last count ${new Date(lastCount.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ' · never counted'}
        </span>
        <button onClick={() => setCounting(true)}
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', border: 'none', background: countSession ? '#e0a716' : 'var(--navy)', color: countSession ? 'var(--navy)' : '#fff' }}>
          🧮 {countSession ? `Count in progress (${Object.keys(countSession.counts || {}).length})` : 'Count stock'}
        </button>
        <button onClick={() => { if (forced) { setForced(false); setStockOnly(false) } else setStockOnly(!stockOnlySaved) }}
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
            border: stockOnly ? 'none' : '1px solid var(--border)', background: stockOnly ? '#1e7a34' : 'var(--surface)', color: stockOnly ? '#fff' : 'var(--text-mid)' }}>
          📦 {stockOnly ? 'Showing stock items only' : 'Only display stock items'}
        </button>
      </div>
      <CatalogApprovals pending={catPending} setPending={setCatPending} rows={rows} setCatalog={setCatalog} setStock={setStock} />
      {dups.length > 0 && (
        <div style={{ margin: '8px 16px 0', padding: '8px 10px', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 12, color: '#8a5d00', fontWeight: 700 }}>
            ⚠ {dups.length} part{dups.length === 1 ? ' is' : 's are'} in the Catalog more than once ({dups.reduce((a, g) => a + g.extras.length, 0)} extra entr{dups.reduce((a, g) => a + g.extras.length, 0) === 1 ? 'y' : 'ies'}): {dups.slice(0, 3).map(g => g.keep.nickname || g.keep.name).join(', ')}{dups.length > 3 ? '…' : ''}
          </span>
          <button onClick={() => setDupOpen(true)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Review &amp; merge</button>
        </div>
      )}
      {dupOpen && shownDups.length > 0 && <DupPartsModal key={dupFocus || 'all'} groups={shownDups} onApply={applyMerge} onClose={() => { setDupOpen(false); setDupFocus(null) }} />}
      <div style={{ padding: '6px 16px 0', fontSize: 11.5, color: 'var(--text-mid)' }}>
        {rows.length} part{rows.length === 1 ? '' : 's'} · <b style={{ color: '#1e7a34' }}>{inStock.length} in stock</b> · stock value {money(stockValue)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16 }}>
        <div style={{ flex: 1 }}><SearchBox value={search} onChange={setSearch} placeholder={stockOnly ? 'Search stock…' : 'Search catalog & stock…'} /></div>
        <button onClick={() => setNewOpen(o => !o)} title="Add something that isn't in the Catalog — it waits for approval (and a part #)"
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, border: '1px dashed #e0a716', background: '#fffaf0', color: '#8a5d00', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ New item (tentative)</button>
      </div>
      {newOpen && <NewItemForApproval initialName={search} onSend={it => { setCatPending(list => [...list, { ...it, id: pendId(), by: 'Desktop', at: new Date().toISOString(), source: 'desktop' }]); setNewOpen(false) }} onCancel={() => setNewOpen(false)} />}
      {uncategorizedCount > 0 && !stockOnly && (
        <div style={{ padding: '0 16px 10px' }}>
          <button onClick={() => setBulkOpen(true)}
            style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '6px 12px', cursor: 'pointer' }}>
            Check {uncategorizedCount} uncategorized against categorized
          </button>
        </div>
      )}
      {filtered.length === 0 && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          {q ? 'No matches.' : stockOnly ? 'Nothing on hand right now — turn off "stock items only" to see every part.' : 'No parts yet.'}
        </div>
      )}
      <CategoryTree
        items={filtered}
        extraPaths={stockOnly ? [] : categoryPaths}
        onAddExtraPath={onAddCategoryPath}
        onRenameCategory={onRenameCategory}
        onDeleteCategory={onDeleteCategory}
        onAddItem={addItem}
        getRowProps={row => ({
          onUpdate: patch => updateRow(row, patch), onDelete: () => deleteRow(row),
          onUpdateStock: (patch, lotId) => updateStock(row, patch, lotId), onAddStock: data => addStock(row, data),
          order: row.stk ? orders.find(o => o.id === row.stk.orderId) : null,
          tentative: tentativeFor(row), onCount: (qty, note) => sendCount(row, qty, note),
          priceFrom: priceSourceFor(priceIdx, row),
        })}
        ColumnHeader={PartColumnHeader}
        RowComponent={PartRow}
        AddRowComponent={PartAddRow}
        q={q}
        renderCount={stockOnly ? (node => `${countAllItems(node)} · ${money(sumAllValue(node, i => i.stockValue || 0))}`) : undefined}
      />
      {bulkOpen && (
        <BulkCategorizeModal items={rows} allItems={rows} onApply={applyBulkCategories} onClose={() => setBulkOpen(false)} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// ORDERED MATERIAL — upload a wholesaler slip, AI-parse it, review, commit to Stock
// ══════════════════════════════════════════════════════════════════

// Store the Anthropic key locally for direct client-side parsing when self-hosted.
// (In the live chat artifact preview, this isn't needed — Claude's API is available directly.)
function useApiKey() {
  return useLocalStore('anthropic_api_key', '')
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in the response.')
  }
  return JSON.parse(text.slice(start, end + 1))
}

export async function parseOrderPdf(base64, apiKey, mediaType = 'application/pdf') {
  const isImage = mediaType.startsWith('image/')
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
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          isImage
            ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
            : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text: 'First decide what kind of document this is and return it as "docType": "quote" if it is a QUOTE / QUOTATION / price quote (what will be ordered), "packing_slip" if it is a PACKING SLIP / PICKING TICKET / PICK-UP or DELIVERY slip (what was picked up — often with no prices), or "invoice" if it is an INVOICE / bill. This is a wholesaler document (quote, packing slip or invoice). Carefully identify the WHOLESALER/SUPPLIER company name — it is usually the largest or most prominent name on the page, often in a logo or letterhead at the top (this is the company that sent the document, not the customer it was sent to). Also extract the invoice or order number (sometimes labeled "Invoice #", "Order #", "Reference", etc.), any PURCHASE ORDER number if one is printed on the document (often labeled "PO #", "P.O.", "Purchase Order", or similar — this is separate from the invoice number and may not be present), the invoice/order date (YYYY-MM-DD), every line item with its part number (if shown), description, unit of measure exactly as printed (e.g. EA, FT, M, KM, ROLL, BOX, PKG, CASE, LOT — use whatever abbreviation is actually printed, do NOT guess or substitute a different unit, and NEVER convert or rescale the quantity to a different unit — e.g. if the document shows 500 M, output qty 500 and uom \'M\', do not convert to 0.5 KM or vice versa), quantity, unit price, and the line\'s total price exactly as printed (do not calculate it yourself — read the printed number; if unit price × quantity does not match the printed line total, the printed total is correct, e.g. due to a discount). For each line item also determine whether it is BACKORDERED — wholesalers mark this in different ways: a "B/O", "Backorder", or "BO" label or column, a quantity SHIPPED that is less than the quantity ORDERED (in which case treat the shipped/available amount as the real qty, and flag the line as backordered if any amount was held back), a separate "Backordered Items" section further down the document, or a note like "to follow" / "on order". If a line is fully backordered with nothing shipped, still include it with whatever quantity was ordered, but set backordered to true so it\'s clear nothing arrived yet. For every line also return orderedQty (quantity ordered), shippedQty (quantity shipped on THIS document) and backorderQty (quantity still to follow), as printed (0 if a column is blank). RELEASES: an order number with a suffix like -01, -02, -03 is one shipment (release) of a bigger order, and its slip often lists every line of the order. A line shipped on an EARLIER release that ships nothing on this one and has nothing backordered (shipped 0, B/O 0, or marked "previously shipped") must have previouslyShipped set to true — it is not part of this shipment. Then find the document\'s own printed SUBTOTAL (the pre-tax total of all line items, sometimes labeled "Subtotal" or "Merchandise Total" — this should match the sum of the line items), the TAX amount printed on the document (GST/PST/HST/sales tax — a single combined number is fine if that\'s how it\'s printed; use 0 if no tax line appears), and the final GRAND TOTAL actually charged (subtotal + tax, sometimes labeled "Total", "Amount Due", or "Balance Due"). Respond with ONLY raw JSON, no markdown fences, no explanation before or after, in this exact shape: {"docType":"packing_slip","wholesaler":"","invoiceNumber":"","poNumber":"","orderDate":"","subtotal":0,"tax":0,"invoiceTotal":0,"lineItems":[{"partNo":"","name":"","uom":"","qty":0,"cost":0,"totalPrice":0,"backordered":false,"orderedQty":0,"shippedQty":0,"backorderQty":0,"previouslyShipped":false}]}',
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
    throw new Error('This document has too many line items to parse in one go — the response got cut off partway through. Try splitting it into smaller uploads (e.g. by page), or let me know and the limit can be raised further.')
  }
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text)
  if (textBlocks.length === 0) throw new Error('The response had no text content to parse.')
  const cleaned = textBlocks.join('').replace(/```json|```/g, '').trim()
  try {
    const parsed = extractJson(cleaned)
    // a release (-02…) lists the whole order: keep only what shipped on it
    const all = parsed.lineItems || []
    const kept = all.filter(li => !li.previouslyShipped)
    return { ...parsed, lineItems: normalizeLines(kept), previouslyShippedCount: all.length - kept.length }
  } catch (e) {
    throw new Error(`Could not read the parsed result as JSON (${e.message})`)
  }
}

const REVIEW_COLS = 'minmax(96px, 0.35fr) minmax(140px, 1fr) 52px 48px 84px 86px'
const reviewInputStyle = { ...inputStyle, fontSize: 12.5, padding: '3px 5px' }

function ReviewColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 4px', marginBottom: 4, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: REVIEW_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Part No:</span>
        <span style={colHeaderStyle}>Description:</span>
        <span style={colHeaderStyle}>UOM:</span>
        <span style={colHeaderStyle}>Qty</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Unit Price</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Total Price</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

// Attaches a slip to one or more jobs — some trips cover several jobs on one
// invoice, so this is multi-select, same search-and-chip pattern used
// elsewhere (worker tagging on Daily Notes).
function JobMultiPicker({ selectedJobs, onAdd, onRemove, jobOptions }) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = matchJobs(jobOptions, q, selectedJobs, 8)

  function add(j) {
    onAdd(j)
    setQuery(''); setShowDropdown(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {selectedJobs.map(j => (
          <span key={j.id} style={{ fontSize: 11, fontWeight: 700, ...jobChipColors(j), borderRadius: 20, padding: '3px 6px 3px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            {jobLabel(j)}
            <button onClick={() => onRemove(j.id)} style={{ background: 'none', border: 'none', color: jobChipColors(j).color, cursor: 'pointer', fontSize: 13, padding: 0 }} aria-label={`Remove ${j.name}`}>×</button>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative', maxWidth: 320 }}>
        <input
          value={query} onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Search jobs, or pick General Stock…"
          style={{ width: '100%', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontFamily: 'var(--font)', boxSizing: 'border-box' }}
        />
        {showDropdown && matches.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 20,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
            maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {matches.map(j => (
              <div key={j.id} onMouseDown={() => add(j)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                <JobOptionLabel job={j} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Per-item version — lets you pick which of the slip-level jobs a specific
// line applies to (checkbox-style toggle chips), or search for a job that
// isn't on the slip-level list yet, which adds it there too.
function ItemJobAssigner({ slipJobs, itemJobIds, onToggle, onAddNewJob, jobOptions }) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = matchJobs(jobOptions, q, slipJobs, 6)

  function addNew(j) {
    onAddNewJob(j)
    setQuery(''); setShowDropdown(false); setSearching(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
      {slipJobs.map(j => {
        const active = itemJobIds.includes(j.id)
        return (
          <button
            key={j.id} onClick={() => onToggle(j.id)}
            style={{
              fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', cursor: 'pointer', border: 'none',
              ...(active ? jobChipColors(j) : { background: 'var(--surface-2)', color: 'var(--text-light)' }),
            }}
          >
            {active ? '✓ ' : ''}{j.name}
          </button>
        )
      })}
      {searching ? (
        <span style={{ position: 'relative' }}>
          <input
            autoFocus value={query} onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
            onBlur={() => setTimeout(() => { setShowDropdown(false); setSearching(false) }, 150)}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search a job…"
            style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px', width: 150, fontFamily: 'var(--font)' }}
          />
          {showDropdown && matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 20, width: 200,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
              {matches.map(j => (
                <div key={j.id} onMouseDown={() => addNew(j)} style={{ padding: '7px 9px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                  <JobOptionLabel job={j} />
                </div>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button
          onClick={() => setSearching(true)}
          style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '2px 8px', cursor: 'pointer' }}
        >
          + other job
        </button>
      )}
    </div>
  )
}

// Shows whether a slip / order lines up with Orders & POs by PO number.
function filingText(o) {
  const t = fileType(o.filedAs)
  if (!t) return ''
  return `${t.group}${o.ref ? ' ' + o.ref : ''}${o.refLabel && t.id === 'quote' ? ' · ' + o.refLabel : ''}`
}
// When the last line on an order is received, remember when — the weekly
// "material received" list on the timesheet export goes by this date.
function stampFullyReceived(o, lineItems) {
  const full = lineItems.length > 0 && lineItems.every(li => li.received || li.movedTo)
  if (full && !o.receivedAt) return { ...o, lineItems, receivedAt: new Date().toISOString() }
  if (!full && o.receivedAt) { const { receivedAt, ...rest } = o; return { ...rest, lineItems } }
  return { ...o, lineItems }
}
const money2 = v => '$' + (Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function OrdersPoHint({ matches, poNumber, saving, slipSubtotal }) {
  if (!String(poNumber || '').trim()) return null
  if (matches.length === 0) {
    return <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: -2, marginBottom: 10 }}>No order in Orders &amp; POs with this PO #.</div>
  }
  return (
    <div style={{ fontSize: 12, marginTop: -2, marginBottom: 10, padding: '7px 10px', borderRadius: 'var(--rs)', background: 'var(--green-bg)', border: '1px solid #b9e6d2', color: 'var(--green-dark)' }}>
      <b>📑 Matches Orders &amp; POs:</b>{' '}
      {matches.map((m, i) => (
        <span key={m.id}>{i > 0 && '; '}{m.supplier} — {m.description}{m.filedAs ? ` (filed: ${filingText(m)})` : ''}</span>
      ))}
      {(() => {
        const quoted = matches.reduce((a, m) => a + (Number(m.quoteTotal) || 0), 0)
        const slip = Number(slipSubtotal) || 0
        if (!quoted || !slip) return null
        const diff = slip - quoted
        const over = diff > Math.max(1, quoted * 0.01)
        return (
          <div style={{ marginTop: 3, color: over ? 'var(--red-dark)' : 'var(--text-mid)', fontWeight: over ? 700 : 500 }}>
            Quoted {money2(quoted)} before tax · this slip {money2(slip)}
            {over ? ` — ${money2(diff)} over the quote, check pricing` : Math.abs(diff) >= 1 ? ` (${diff > 0 ? '+' : '−'}${money2(Math.abs(diff))})` : ' — matches'}
          </div>
        )
      })()}
      {saving && <div style={{ marginTop: 2, color: 'var(--text-mid)' }}>Saving this slip marks {matches.length === 1 ? 'it' : 'them'} Received there.</div>}
    </div>
  )
}

function UploadOrderFlow({ apiKey, onCommit, preloadedFile, onDismissPreloaded, quotes = [] }) {
  const [stage, setStage] = useState('idle') // idle | parsing | review | error
  const [kind, setKind] = useState('order') // 'order' = Material Order, 'pricing' = Pricing Quote
  const [pricingTarget, setPricingTarget] = useState(null) // { type: 'catalog' } | { type: 'quote', quoteId, quoteNumber, title }
  const [quoteSearch, setQuoteSearch] = useState('')
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBase64, setPdfBase64] = useState(null)
  const [error, setError] = useState('')
  const [jobOptions, setJobOptions] = useState(withGeneralStock([]))
  useEffect(() => {
    if (!window.desktop) {
      // Browser preview: jobs from local storage
      try {
        const recs = JSON.parse(localStorage.getItem('fieldapp_job_projects') || '[]')
        const custs = JSON.parse(localStorage.getItem('fieldapp_job_customers') || '[]')
        setJobOptions(withGeneralStock(recs.filter(p => !p.trashedAt).map(p => ({ id: p.id, name: p.name, customerName: custs.find(c => c.id === p.customerId)?.name || '' }))))
      } catch { /* ignore */ }
      return
    }
    let cancelled = false
    window.desktop.loadJobsOnly().then(data => {
      if (cancelled || !data) return
      const options = (data.records || [])
        .filter(p => !p.trashedAt)
        .map(p => ({ id: p.id, name: p.name, customerName: (data.customers || []).find(c => c.id === p.customerId)?.name || 'Unknown customer' }))
      setJobOptions(withGeneralStock(options))
    })
    return () => { cancelled = true }
  }, [])
  const inputRef = useRef(null)

  // Orders & POs link: find the order this slip belongs to by PO #, and
  // pre-select the job it was filed under (once — removing it sticks).
  const feedRows = useOrdersFeed()
  const [savedOrders] = useLocalStore('material_orders', [])
  const poMatches = parsed ? matchOrdersByPo(feedRows, parsed.poNumber) : []
  const autoJobApplied = useRef(new Set())
  // Snapped on the phone for a job → that job is already picked
  const targetApplied = useRef(null)
  useEffect(() => {
    const t = preloadedFile?.target
    if (stage !== 'review' || !parsed || !t || t.type !== 'job' || targetApplied.current === preloadedFile) return
    targetApplied.current = preloadedFile
    const job = jobOptions.find(j => j.id === t.id) || { id: t.id, name: t.name || 'Job', customerName: t.customerName || '' }
    if (!(parsed.jobs || []).some(j => j.id === job.id)) setParsed(p => ({ ...p, jobs: [...(p.jobs || []), job] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, parsed, jobOptions, preloadedFile])
  useEffect(() => {
    if (stage !== 'review' || !parsed) return
    for (const m of poMatches) {
      const key = `${m.id}`
      if (autoJobApplied.current.has(key)) continue
      // every job the PO is filed to (one, several, or split by quote #)
      const found = []
      if (m.filedAs === 'stock') { const st = jobOptions.find(isGeneralStock); if (st) found.push(st) }
      jobNamesOf(m).forEach(name => {
        const want = name.trim().toLowerCase()
        const same = jobOptions.filter(j => (j.name || '').trim().toLowerCase() === want)
        const job = same.find(j => (j.customerName || '') === m.refLabel) || same[0] || null
        if (job) found.push(job)
      })
      autoJobApplied.current.add(key)
      if (found.length) setParsed(p => ({ ...p, jobs: [...(p.jobs || []), ...found.filter(j => !(p.jobs || []).some(x => x.id === j.id))] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, parsed?.poNumber, feedRows, jobOptions])

  async function runParse(base64, name, mediaType) {
    setFileName(name)
    setStage('parsing')
    setError('')
    try {
      setPdfBase64(base64)
      const result = await parseOrderPdf(base64, apiKey, mediaType)
      result.lineItems = (result.lineItems || []).map(li => ({ id: uid(), ...li }))
      setParsed(result)
      setStage('review')
    } catch (err) {
      setError(err.message || 'Could not parse this file.')
      setStage('error')
    }
  }

  useEffect(() => {
    if (preloadedFile && stage === 'idle') {
      if (preloadedFile.kindHint) setKind(preloadedFile.kindHint)
      // Snapped on the phone for a quote → a Pricing Quote for that quote
      const tq = preloadedFile.target
      if (tq && tq.type === 'quote') { setKind('pricing'); setPricingTarget({ type: 'quote', quoteId: tq.id, quoteNumber: tq.quoteNumber || '', title: tq.title || '' }) }
      // Already read in the background (phone slip) or by the morning email run
      if (preloadedFile.parsed) {
        const p0 = preloadedFile.parsed
        setFileName(preloadedFile.fileName || '')
        setPdfBase64(preloadedFile.base64 || null)
        setParsed({ ...p0, lineItems: (p0.lineItems || []).map(li => ({ id: uid(), ...li })) })
        setStage('review')
        return
      }
      if (!apiKey) {
        setError('Add your Anthropic API key below first — needed to parse the file.')
        setStage('error')
        return
      }
      runParse(preloadedFile.base64, preloadedFile.fileName, preloadedFile.mediaType)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadedFile])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!apiKey) {
      setError('Add your Anthropic API key below first — needed to parse the PDF.')
      setStage('error')
      return
    }
    const base64 = await fileToBase64(file)
    await runParse(base64, file.name, file.type || 'application/pdf')
  }

  function updateField(field, value) { setParsed(p => ({ ...p, [field]: value })) }
  function updateLine(id, patch) { setParsed(p => ({ ...p, lineItems: p.lineItems.map(l => l.id === id ? { ...l, ...patch } : l) })) }
  function deleteLine(id) { setParsed(p => ({ ...p, lineItems: p.lineItems.filter(l => l.id !== id) })) }
  function addJob(job) { setParsed(p => ({ ...p, jobs: [...(p.jobs || []), job] })) }
  function removeJob(jobId) { setParsed(p => ({ ...p, jobs: (p.jobs || []).filter(j => j.id !== jobId) })) }

  function commit(k) {
    onCommit({
      ...parsed, fileName, pdfBase64, kind: k, recordOnly: k === 'pricing',
      pricingTarget: k === 'pricing' ? (pricingTarget || { type: 'catalog' }) : null,
      webLink: preloadedFile?.webLink || '', source: preloadedFile?.source || 'upload',
    })
    setStage('idle'); setParsed(null); setFileName(''); setPdfBase64(null); setKind('order'); setPricingTarget(null); setQuoteSearch('')
    if (inputRef.current) inputRef.current.value = ''
    if (preloadedFile && onDismissPreloaded) onDismissPreloaded()
  }
  function cancel() {
    setStage('idle'); setParsed(null); setFileName(''); setPdfBase64(null); setError(''); setKind('order'); setPricingTarget(null); setQuoteSearch('')
    if (inputRef.current) inputRef.current.value = ''
    if (preloadedFile && onDismissPreloaded) onDismissPreloaded()
  }

  if (stage === 'review' && parsed) {
    return (
      <div style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 10 }}>
          Confirm slip — {fileName || parsed.wholesaler || 'from email'}
          {preloadedFile?.source === 'email' && <span style={{ fontWeight: 500, color: 'var(--text-light)' }}> · read from your email{preloadedFile.webLink ? <> — <a href="#" onClick={e => { e.preventDefault(); window.desktop?.openExternal ? window.desktop.openExternal(preloadedFile.webLink) : window.open(preloadedFile.webLink) }}>open email</a></> : null}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          <span style={colHeaderStyle}>Wholesaler</span>
          <input value={parsed.wholesaler || ''} onChange={e => updateField('wholesaler', e.target.value)} placeholder="Wholesaler name"
            style={reviewInputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={colHeaderStyle}>Invoice #</span>
            <input value={parsed.invoiceNumber || ''} onChange={e => updateField('invoiceNumber', e.target.value)} placeholder="—"
              style={reviewInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Document</span>
            <select value={parsed.docType || 'packing_slip'} onChange={e => updateField('docType', e.target.value)} style={reviewInputStyle}
              title="A quote is what was ordered; packing slips are what you picked up — they're checked against the quote">
              <option value="packing_slip">Packing slip</option>
              <option value="quote">Quote (what was ordered)</option>
              <option value="invoice">Invoice</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={colHeaderStyle}>PO #</span>
            <input value={parsed.poNumber || ''} onChange={e => updateField('poNumber', e.target.value)} placeholder="Add if not on slip"
              style={reviewInputStyle} />
          </div>
        </div>
        <OrdersPoHint matches={poMatches} poNumber={parsed.poNumber} saving slipSubtotal={parsed.subtotal} />
        {kind === 'order' && poMatches.length > 0 && <BillingSummary res={billingCheck({ ...parsed, id: '__review', kind: 'order' }, savedOrders, feedRows)} />}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Date</span>
            <input type="date" value={parsed.orderDate || ''} onChange={e => updateField('orderDate', e.target.value)} style={reviewInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Subtotal (pre-tax)</span>
            <input type="number" step="0.01" value={parsed.subtotal ?? ''} onChange={e => updateField('subtotal', e.target.value)} placeholder="0.00"
              style={{ ...reviewInputStyle, textAlign: 'right', width: 80 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Tax</span>
            <input type="number" step="0.01" value={parsed.tax ?? ''} onChange={e => updateField('tax', e.target.value)} placeholder="0.00"
              style={{ ...reviewInputStyle, textAlign: 'right', width: 70 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Invoice total</span>
            <input type="number" step="0.01" value={parsed.invoiceTotal ?? ''} onChange={e => updateField('invoiceTotal', e.target.value)} placeholder="0.00"
              style={{ ...reviewInputStyle, textAlign: 'right', width: 80 }} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={colHeaderStyle}>Attach to job(s)</div>
          <div style={{ marginTop: 3 }}>
            <JobMultiPicker selectedJobs={parsed.jobs || []} onAdd={addJob} onRemove={removeJob} jobOptions={jobOptions} />
          </div>
        </div>
        {parsed.lineItems.length > 0 && <ReviewColumnHeader />}
        {parsed.lineItems.map(li => {
          const computed = (Number(li.qty) || 0) * (Number(li.cost) || 0)
          const printed = Number(li.totalPrice) || 0
          const mismatch = li.totalPrice !== '' && li.totalPrice != null && Math.abs(computed - printed) > 0.02
          return (
            <div key={li.id} style={{ marginBottom: 8, padding: li.backordered ? '4px 6px' : 0, background: li.backordered ? '#fff8e6' : 'transparent', borderRadius: li.backordered ? 6 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: REVIEW_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
                  <input value={li.partNo || ''} onChange={e => updateLine(li.id, { partNo: e.target.value })} placeholder="—" style={reviewInputStyle} />
                  <input value={li.name || ''} onChange={e => updateLine(li.id, { name: e.target.value })} placeholder="Description" style={reviewInputStyle} />
                  <UomSelect value={li.uom} onChange={v => updateLine(li.id, { uom: v })} style={{ fontSize: 12.5 }} />
                  <input type="number" value={li.qty ?? ''} onChange={e => updateLine(li.id, { qty: e.target.value })} placeholder="0" style={{ ...reviewInputStyle, textAlign: 'center' }} />
                  <input type="number" step="0.01" value={li.cost ?? ''} onChange={e => updateLine(li.id, { cost: e.target.value })} placeholder="0.00" style={{ ...reviewInputStyle, textAlign: 'right' }} />
                  <input
                    type="number" step="0.01" value={li.totalPrice ?? ''} onChange={e => updateLine(li.id, { totalPrice: e.target.value })} placeholder="0.00"
                    title={mismatch ? `Qty × Unit price = ${money(computed)} — doesn't match this total` : undefined}
                    style={{ ...reviewInputStyle, textAlign: 'right', borderColor: mismatch ? 'var(--red)' : reviewInputStyle.border, background: mismatch ? '#fdf0f0' : reviewInputStyle.background }}
                  />
                </div>
                <ConfirmDeleteButton onConfirm={() => deleteLine(li.id)} style={delBtnStyle} ariaLabel="Remove line" confirmText="Remove this line?" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
                <input
                  value={li.nickname || ''} onChange={e => updateLine(li.id, { nickname: e.target.value })}
                  placeholder="Nickname (optional) — a quick name you'll recognize later"
                  style={{ ...reviewInputStyle, fontStyle: 'italic', flex: 1 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: li.backordered ? '#9a6610' : 'var(--text-light)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={!!li.backordered} onChange={e => updateLine(li.id, { backordered: e.target.checked })} />
                  Backordered
                </label>
              </div>
              <ItemJobAssigner
                slipJobs={parsed.jobs || []}
                itemJobIds={li.jobIds || []}
                onToggle={jobId => updateLine(li.id, { jobIds: (li.jobIds || []).includes(jobId) ? (li.jobIds || []).filter(id => id !== jobId) : [...(li.jobIds || []), jobId] })}
                onAddNewJob={job => { addJob(job); updateLine(li.id, { jobIds: [...(li.jobIds || []), job.id] }) }}
                jobOptions={jobOptions}
              />
            </div>
          )
        })}
        {parsed.lineItems.length > 0 && (() => {
          const linesTotal = parsed.lineItems.reduce((s, li) => s + (Number(li.totalPrice) || 0), 0)
          const subtotal = parsed.subtotal !== '' && parsed.subtotal != null ? Number(parsed.subtotal) : null
          const tax = Number(parsed.tax) || 0
          const invoiceTotal = Number(parsed.invoiceTotal) || 0
          // Line items are always pre-tax, so check against the subtotal, not the tax-inclusive invoice total
          const compareTo = subtotal != null ? subtotal : invoiceTotal
          const totalMismatch = compareTo > 0 && Math.abs(linesTotal - compareTo) > 0.02
          return (
            <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: totalMismatch ? 'var(--red)' : 'var(--text-mid)', fontWeight: 700 }}>
                  Line items total: {money(linesTotal)}
                  {totalMismatch && ` — doesn't match ${subtotal != null ? 'subtotal' : 'invoice total'} (${money(compareTo)})`}
                </span>
              </div>
              {tax > 0 && (
                <div style={{ color: 'var(--text-light)', marginTop: 2 }}>
                  + {money(tax)} tax = {money((subtotal != null ? subtotal : linesTotal) + tax)}
                </div>
              )}
            </div>
          )
        })()}
        {(() => {
          const lines = parsed.lineItems || []
          const unalloc = lines.filter(li => !(li.jobIds || []).length).length
          const oneJob = (parsed.jobs || []).length === 1 ? parsed.jobs[0] : null
          const qq = quoteSearch.trim().toLowerCase()
          const quoteMatches = qq ? quotes.filter(q => hit([q.quoteNumber, q.title, q.customerName], qq)).slice(0, 6) : []
          const opt = (k, label, desc) => (
            <button key={k} onClick={() => setKind(k)} style={{ flex: 1, textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: kind === k ? '2px solid var(--navy)' : '1px solid var(--border)', background: kind === k ? '#eef2f8' : 'var(--surface)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{desc}</div>
            </button>
          )
          return (
            <div style={{ marginTop: 14, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={colHeaderStyle}>What is this slip?</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {opt('order', '📦 Material Order', 'A quote or slip for material being bought — waits for a PO if it has none yet')}
                {opt('pricing', '💲 Quote for Pricing', 'Prices only — checked against the Catalog, or compared to one of your quotes. Never ordered.')}
              </div>
              {kind === 'order' && (
                <div style={{ fontSize: 11.5, marginTop: 8, color: unalloc && !oneJob ? '#8a5d00' : 'var(--text-mid)' }}>
                  {!unalloc ? 'Every line is on a job or General Stock. Job lines go into that job\'s Materials (actual cost) when you confirm.'
                    : oneJob ? `${unalloc} line${unalloc === 1 ? '' : 's'} with no job will go to ${jobLabel(oneJob)}.`
                    : `${unalloc} line${unalloc === 1 ? ' isn\'t' : 's aren\'t'} on a job or General Stock yet — fine to confirm, they'll show as "not allocated" until you place them.`}
                </div>
              )}
              {kind === 'pricing' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => setPricingTarget({ type: 'catalog' })}
                      style={{ fontSize: 12, borderRadius: 999, padding: '4px 11px', cursor: 'pointer', border: '1px solid ' + (!pricingTarget || pricingTarget.type === 'catalog' ? 'var(--navy)' : 'var(--border)'), background: !pricingTarget || pricingTarget.type === 'catalog' ? 'var(--navy)' : 'var(--surface)', color: !pricingTarget || pricingTarget.type === 'catalog' ? '#fff' : 'var(--text)' }}>
                      Material pricing — Catalog only
                    </button>
                    {pricingTarget?.type === 'quote' && (
                      <span style={{ fontSize: 12, borderRadius: 999, padding: '4px 11px', background: 'var(--navy)', color: '#fff', fontWeight: 700 }}>
                        Quote {pricingTarget.quoteNumber}{pricingTarget.title ? ` — ${pricingTarget.title}` : ''}
                        <button onClick={() => setPricingTarget({ type: 'catalog' })} style={{ marginLeft: 6, background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
                      </span>
                    )}
                    <span style={{ position: 'relative' }}>
                      <input value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)} placeholder="or tag to one of your quotes…"
                        style={{ ...reviewInputStyle, width: 220 }} />
                      {quoteMatches.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, width: 320, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
                          {quoteMatches.map(q => (
                            <div key={q.id} onMouseDown={() => { setPricingTarget({ type: 'quote', quoteId: q.id, quoteNumber: q.quoteNumber, title: q.title }); setQuoteSearch('') }}
                              style={{ padding: '7px 9px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                              <b>{q.quoteNumber}</b> {q.title} <span style={{ color: 'var(--text-light)' }}>· {q.customerName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
                    {pricingTarget?.type === 'quote' ? 'Prices go to the Catalog (with a price check), then you\'ll see this compared to the quote: price differences flagged, missing lines offered to add.' : 'Prices go to the Catalog with a price check. No Stock, no job.'}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={cancel} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => commit(kind)} style={{ flex: 2, padding: 10, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}>
            Confirm — {kind === 'pricing' ? (pricingTarget?.type === 'quote' ? `Pricing Quote for ${pricingTarget.quoteNumber}` : 'Pricing Quote (Catalog)') : 'Material Order'}
          </button>
        </div>
      </div>
    )
  }

  if (preloadedFile && stage === 'idle') return null // parsing kicks off automatically via useEffect, nothing to show at idle

  if (stage === 'error' && preloadedFile) {
    return (
      <div style={{ padding: 16, background: '#fdf0f0', borderBottom: '1px solid var(--red)' }}>
        <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>
        <button onClick={cancel} style={{ padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px',
        border: '1.5px dashed var(--border)', borderRadius: 'var(--rs)', cursor: 'pointer',
        color: 'var(--text-mid)', fontSize: 13, fontWeight: 600, background: 'var(--surface)',
      }}>
        {stage === 'parsing' ? 'Parsing…' : '+ Upload order PDF (packing slip / invoice)'}
        <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={handleFile} disabled={stage === 'parsing'} style={{ display: 'none' }} />
      </label>
      {stage === 'error' && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>
      )}
    </div>
  )
}

function orderTotal(order) {
  if (order.invoiceTotal != null && order.invoiceTotal !== '') return Number(order.invoiceTotal)
  const lineTotals = (order.lineItems || []).reduce((s, i) => s + (Number(i.totalPrice) || 0), 0)
  if (lineTotals > 0) return lineTotals
  return (order.lineItems || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0)
}

// Rendered straight into the page body: drawn inside a faded (archived /
// received) row it picked up the row's fade and the rows below covered it,
// so the job buttons in it couldn't be clicked.
function ModalOverlay({ onClose, children, maxWidth }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', borderRadius: 'var(--rs)', maxWidth: maxWidth || 460, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

const ORDER_DETAIL_COLS_R = '20px 52px 1fr 34px 28px 56px 60px'

function OrderDetailModal({ order, onClose, onUpdate, onReceiveItems, onPushPricing, isRecordOnly = false, jobOptions, focus = null }) {
  const total = orderTotal(order)
  const lineItems = order.lineItems || []
  // Opened from a problem on the slip: mark the lines that need fixing
  const pk = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const needsFix = li => {
    if (!focus) return false
    if (focus.kind === 'jobs') return !li.movedTo && !lineIsAllocated(li, order)
    if (focus.kind === 'receive') return !li.received && !li.movedTo && (Number(li.qty) || 0) > 0
    if (focus.kind === 'parts') return (focus.parts || []).some(x => x && (pk(x) === pk(li.partNo) || pk(x) === pk(li.name)))
    return false
  }
  const fixCount = lineItems.filter(needsFix).length
  const fixTag = focus && ({ jobs: 'needs a job (or General Stock) — pick below', receive: 'not received — tick it, then Receive', parts: 'this line' })[focus.kind]
  const fixHelp = focus && ({
    jobs: `${fixCount} line${fixCount === 1 ? '' : 's'} not used up — give each red line a job (or General Stock) below.`,
    receive: `${fixCount} line${fixCount === 1 ? '' : 's'} not received — tick what came in and press Receive. Leave backordered items (nothing shipped) unticked.`,
    parts: fixCount ? `The line${fixCount === 1 ? '' : 's'} in question ${fixCount === 1 ? 'is' : 'are'} marked in red.` : 'That item isn’t on this slip.',
    po: 'This slip has no PO # — type it in so it can be matched to its quote.',
  })[focus.kind]
  const firstFixRef = useRef(null)
  useEffect(() => { if (firstFixRef.current) firstFixRef.current.scrollIntoView({ block: 'center' }) }, [])
  const [poDraft, setPoDraft] = useState(order.poNumber || '')
  const slipJobs = order.jobs || []
  const [checked, setChecked] = useState(() => new Set(
    lineItems.map((li, i) => (li.received || (!li.backordered && !li.movedTo && (Number(li.qty) || 0) > 0)) ? i : null).filter(i => i !== null)
  ))
  const [confirming, setConfirming] = useState(false)

  const receivedCount = lineItems.filter(li => li.received).length
  const newlyChecked = [...checked].filter(i => !lineItems[i]?.received)

  function toggle(idx) {
    if (lineItems[idx].received || lineItems[idx].movedTo) return // locked once received / came on a later release
    setChecked(s => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n })
  }

  function updateLineJobIds(idx, jobIds) {
    onUpdate({ lineItems: lineItems.map((li, i) => i === idx ? { ...li, jobIds } : li) })
  }
  function toggleLineJob(idx, jobId) {
    const current = lineItems[idx].jobIds || []
    updateLineJobIds(idx, current.includes(jobId) ? current.filter(id => id !== jobId) : [...current, jobId])
  }
  function addNewJobToLine(idx, job) {
    // one change: the job joins the slip AND this line (two separate saves
    // raced each other and the second wiped out the first)
    const jobs = slipJobs.some(j => j.id === job.id) ? slipJobs : [...slipJobs, job]
    onUpdate({ jobs, lineItems: lineItems.map((li, i) => i === idx ? { ...li, jobIds: [...new Set([...(li.jobIds || []), job.id])] } : li) })
  }

  function confirmReceive() {
    onReceiveItems(newlyChecked)
    setConfirming(false)
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth={560}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
          Parsed from {order.fileName}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{order.wholesaler || 'Unknown wholesaler'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--text-mid)', marginBottom: 14 }}>
          <span><strong>Invoice #:</strong> {order.invoiceNumber || '—'}</span>
          {focus?.kind === 'po'
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><strong>PO #:</strong>
                <input autoFocus value={poDraft} onChange={e => setPoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && poDraft.trim()) { onUpdate({ poNumber: poDraft.trim() }); onClose() } }}
                  style={{ fontSize: 12, width: 110, border: '2px solid #c0392b', borderRadius: 4, padding: '2px 6px' }} />
                <button disabled={!poDraft.trim()} onClick={() => { onUpdate({ poNumber: poDraft.trim() }); onClose() }} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', border: 'none', borderRadius: 4, background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Save</button>
              </span>
            : <span><strong>PO #:</strong> {order.poNumber || '—'}</span>}
          <span><strong>Received:</strong> {receivedCount} of {lineItems.length}</span>
          <span><strong>Date:</strong> {order.orderDate || '—'}</span>
          {order.subtotal != null && order.subtotal !== '' && <span><strong>Subtotal:</strong> {money(order.subtotal)}</span>}
          {order.tax != null && order.tax !== '' && Number(order.tax) > 0 && <span><strong>Tax:</strong> {money(order.tax)}</span>}
          {order.invoiceTotal != null && order.invoiceTotal !== '' && <span><strong>Invoice total:</strong> {money(order.invoiceTotal)}</span>}
        </div>

        {fixHelp && (
          <div style={{ marginBottom: 10, padding: '7px 10px', background: '#fdecea', border: '1px solid #e3a49c', borderRadius: 6, fontSize: 12, fontWeight: 700, color: '#a12a1e' }}>
            ⚠ {fixHelp}
          </div>
        )}
        {lineItems.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0 4px', marginBottom: 4, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: ORDER_DETAIL_COLS_R, gap: 5, flex: 1, minWidth: 0 }}>
              <span />
              <span style={{ ...colHeaderStyle, fontSize: 9 }}>Part</span>
              <span style={{ ...colHeaderStyle, fontSize: 9 }}>Description</span>
              <span style={{ ...colHeaderStyle, fontSize: 9 }}>UOM</span>
              <span style={{ ...colHeaderStyle, fontSize: 9 }}>Qty</span>
              <span style={{ ...colHeaderStyle, fontSize: 9, textAlign: 'right' }}>Unit</span>
              <span style={{ ...colHeaderStyle, fontSize: 9, textAlign: 'right' }}>Total</span>
            </div>
          </div>
        )}
        {lineItems.map((li, idx) => {
          const bad = needsFix(li)
          const isFirst = bad && lineItems.findIndex(needsFix) === idx
          return (
          <div key={li.id || idx} ref={isFirst ? firstFixRef : undefined} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', background: bad ? '#fdecea' : li.backordered && !li.received ? '#fff8e6' : 'transparent', boxShadow: bad ? 'inset 3px 0 0 #c0392b' : 'none', paddingLeft: bad ? 6 : 0 }}>
            {bad && <div style={{ fontSize: 10, fontWeight: 800, color: '#a12a1e', marginBottom: 2 }}>⚠ {fixTag}{focus.kind === 'jobs' ? ` · ${lineRemaining(order, li)} ${li.uom || ''} left` : ''}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: ORDER_DETAIL_COLS_R, gap: 5, fontSize: 11, alignItems: 'center' }}>
              <input
                type="checkbox" checked={checked.has(idx)} disabled={li.received || !!li.movedTo}
                onChange={() => toggle(idx)}
                title={li.received ? (isRecordOnly ? 'Already marked received' : 'Already received — in Stock') : 'Check to include when marking received'}
                style={{ width: 14, height: 14, cursor: li.received ? 'default' : 'pointer' }}
              />
              <span style={{ color: 'var(--text-mid)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{li.partNo || '—'}</span>
              <span style={{ color: li.received ? 'var(--text-light)' : 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                {li.name || 'Item'}
                {li.movedTo && <span title="This backordered item came on the later release — it's received and charged from that slip" style={{ fontSize: 10, fontWeight: 800, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '1px 6px' }}>came on {li.movedTo}</span>}
                {li.backorderFilledBy && <span title="The rest of this line came on the later release" style={{ fontSize: 10, fontWeight: 800, color: '#1e7a34', background: '#e6f4ea', borderRadius: 10, padding: '1px 6px' }}>rest on {li.backorderFilledBy}</span>}
                {li.backordered && !li.received && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#9a6610', background: '#fff0cc', borderRadius: 10, padding: '1px 5px', flexShrink: 0 }}>B/O</span>
                )}
              </span>
              <span style={{ color: 'var(--text-mid)', textAlign: 'center' }}>{li.uom || '—'}</span>
              <span style={{ color: 'var(--text-mid)', textAlign: 'center' }}>{li.qty || 0}</span>
              <span style={{ color: 'var(--text-mid)', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(li.cost)}</span>
              <span style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(li.totalPrice != null ? li.totalPrice : (Number(li.qty) || 0) * (Number(li.cost) || 0))}</span>
            </div>
            <ItemJobAssigner
              slipJobs={slipJobs}
              itemJobIds={li.jobIds || []}
              onToggle={jobId => toggleLineJob(idx, jobId)}
              onAddNewJob={job => addNewJobToLine(idx, job)}
              jobOptions={jobOptions}
            />
          </div>
          )
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, marginTop: 6, borderTop: '2px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Order total</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{money(total)}</span>
        </div>

        {confirming && (
          <div style={{ marginTop: 12, padding: 10, background: '#fff8e6', border: '1px solid var(--accent)', borderRadius: 'var(--rs)' }}>
            <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>
              {isRecordOnly
                ? `Mark ${newlyChecked.length} item${newlyChecked.length === 1 ? '' : 's'} as received? This is for tracking only — nothing gets added to Stock.`
                : (() => {
                    const toStock = newlyChecked.filter(i => !lineJobsOf(order, lineItems[i]).length).length
                    const onJobs = newlyChecked.length - toStock
                    return `Mark ${newlyChecked.length} item${newlyChecked.length === 1 ? '' : 's'} as received? ${onJobs ? `${onJobs} on job${onJobs === 1 ? '' : 's'} stay${onJobs === 1 ? 's' : ''} with ${onJobs === 1 ? 'its job' : 'their jobs'}` : ''}${onJobs && toStock ? '; ' : ''}${toStock ? `${toStock} with no job go${toStock === 1 ? 'es' : ''} into Stock` : ''}. Prices update the Catalog's price history. Leave backordered items (nothing shipped) unticked.`
                  })()}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirming(false)} style={{ flex: 1, padding: '7px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmReceive} style={{ flex: 1, padding: '7px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', color: 'var(--navy)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {isRecordOnly ? 'Yes, mark received' : 'Yes, move to Stock'}
              </button>
            </div>
          </div>
        )}

        {isRecordOnly && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            {order.pricingPushedAt ? (
              <div style={{ fontSize: 11, color: '#1e7a34', display: 'flex', alignItems: 'center', gap: 6 }}>
                ✓ Pricing pushed to Catalog — {new Date(order.pricingPushedAt).toLocaleDateString()}
                <button onClick={onPushPricing} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Push again
                </button>
              </div>
            ) : (
              <button
                onClick={onPushPricing}
                style={{ width: '100%', padding: '9px', background: '#e8f2fc', border: '1px solid #1a5fa0', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#1a5fa0' }}
              >
                Push pricing to Catalog
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {order.slipPath && (
            <button
              onClick={() => window.desktop.openFile(order.slipPath)}
              style={{ flex: 1, padding: '9px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}
            >
              Open original slip
            </button>
          )}
          {newlyChecked.length > 0 && (
            <button
              onClick={() => setConfirming(true)}
              style={{ flex: 1, padding: '9px', background: '#e8f2fc', border: '1px solid #1a5fa0', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#1a5fa0' }}
            >
              Receive {newlyChecked.length} item{newlyChecked.length === 1 ? '' : 's'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'var(--navy)' }}
          >
            Close
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function OrderRow({ order, onUpdate, onDelete, onReceiveItems, onMarkReceivedNoStock, onPushPricing, onAddToExport, isInExportList, jobOptions, startViewing = false }) {
  const feedRows = useOrdersFeed()
  const poMatches = matchOrdersByPo(feedRows, order.poNumber)
  const [confirming, setConfirming] = useState(false)
  const [viewing, setViewing] = useState(startViewing)
  useEffect(() => { if (startViewing) setViewing(true) }, [startViewing])
  const [editingJobs, setEditingJobs] = useState(false)
  const total = orderTotal(order)
  const lineItems = order.lineItems || []
  const attachedJobs = order.jobs || []
  const receivedCount = lineItems.filter(li => li.received).length
  const fullyReceived = lineItems.length > 0 && receivedCount === lineItems.length
  const statusLabel = order.recordOnly || lineItems.length === 0 ? null
    : fullyReceived ? 'Received'
    : receivedCount === 0 ? 'Not received'
    : `${receivedCount} of ${lineItems.length} received`
  const statusColor = fullyReceived ? { bg: '#e6f4ea', fg: '#1e7a34' } : receivedCount === 0 ? { bg: '#fff3d6', fg: '#9a6610' } : { bg: '#e8f2fc', fg: '#1a5fa0' }

  function addJob(job) { onUpdate({ jobs: [...attachedJobs, job] }) }
  function removeJob(jobId) { onUpdate({ jobs: attachedJobs.filter(j => j.id !== jobId) }) }

  return (
    <div>
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              <EditableField value={order.wholesaler} placeholder="Wholesaler" onSave={v => onUpdate({ wholesaler: v })} />
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 3 }}>
              Invoice #
              <EditableField value={order.invoiceNumber} placeholder="—" onSave={v => onUpdate({ invoiceNumber: v })} style={{ fontSize: 11, fontWeight: 600 }} />
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 3 }}>
              PO #
              <EditableField value={order.poNumber} placeholder="+ add" onSave={v => onUpdate({ poNumber: v })} style={{ fontSize: 11, fontWeight: 600 }} />
            </span>
            {/* status lives on the checklist line under the row */}
            {/* the purchase (PO · quote) shows on the checklist line */}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <input type="date" value={order.orderDate || ''} onChange={e => onUpdate({ orderDate: e.target.value })}
              style={{ fontSize: 11, color: 'var(--text-light)', border: 'none', background: 'none', padding: 0, fontFamily: 'var(--font)' }} />
            <button
              onClick={() => setViewing(true)}
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              · {lineItems.length} item{lineItems.length === 1 ? '' : 's'} — view parsed details
            </button>
            {order.slipPath && (
              <button
                onClick={() => window.desktop.openFile(order.slipPath)}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                · Open slip{(order.extraFiles || []).length ? ' (p. 1)' : ''}
              </button>
            )}
            {(order.extraFiles || []).map((f, i) => (
              <button key={f} onClick={() => window.desktop.openFile(f)}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>· p. {i + 2}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {attachedJobs.map(j => (
              <span key={j.id} style={{ fontSize: 10, fontWeight: 700, ...jobChipColors(j), borderRadius: 20, padding: '2px 6px 2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                {jobLabel(j)}
                <button onClick={() => removeJob(j.id)} style={{ background: 'none', border: 'none', color: jobChipColors(j).color, cursor: 'pointer', fontSize: 12, padding: 0 }} aria-label={`Remove ${j.name}`}>×</button>
              </span>
            ))}
            <button
              onClick={() => setEditingJobs(x => !x)}
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '2px 8px', cursor: 'pointer' }}
            >
              {attachedJobs.length > 0 ? 'Edit jobs' : '+ Attach to job(s) / General Stock'}
            </button>
          </div>
          {editingJobs && (
            <div style={{ marginTop: 6 }}>
              <JobMultiPicker selectedJobs={attachedJobs} onAdd={addJob} onRemove={removeJob} jobOptions={jobOptions} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-mid)' }}>{money(total)}</span>
        <button style={delBtnStyle} onClick={() => setConfirming(true)} aria-label="Delete order">×</button>
      </div>
      {confirming && (
        <div style={{ padding: '10px 16px', background: '#fdf0f0', borderBottom: '1px solid var(--red)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
            Delete this order and its slip file? Any Stock items it fed will stay in Stock, but will no longer show a linked order.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setConfirming(false)}
              style={{ flex: 1, padding: '7px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              style={{ flex: 1, padding: '7px', background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
            >
              Delete order
            </button>
          </div>
        </div>
      )}
      {viewing && (
        <OrderDetailModal
          order={order}
          onClose={() => setViewing(false)}
          onUpdate={onUpdate}
          onReceiveItems={indices => (order.recordOnly ? onMarkReceivedNoStock(order, indices) : onReceiveItems(order, indices))}
          onPushPricing={() => onPushPricing(order)}
          isRecordOnly={!!order.recordOnly}
          jobOptions={jobOptions}
        />
      )}
    </div>
  )
}

// Backorders often show up as a separate slip with the same order number
// plus a short suffix (e.g. "48213" then "48213-01") — strip that trailing
// suffix so shipments belonging to the same original order can be grouped.
function baseOrderNumber(invoiceNumber) {
  const s = String(invoiceNumber || '').trim()
  if (!s) return s
  const match = s.match(/^(.+?)-([A-Za-z0-9]{1,3})$/)
  return match ? match[1] : s
}

function groupOrdersByBaseNumber(list) {
  const groups = new Map()
  list.forEach(o => {
    const key = `${(o.wholesaler || '').trim().toLowerCase()}::${baseOrderNumber(o.invoiceNumber).toLowerCase()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  })
  // Sort each group oldest-first (reads like a shipment timeline), then sort
  // the groups themselves by their most recent order, newest group first.
  const result = [...groups.values()].map(g => g.sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || '')))
  result.sort((a, b) => {
    const aMax = a.reduce((m, o) => o.orderDate > m ? o.orderDate : m, '')
    const bMax = b.reduce((m, o) => o.orderDate > m ? o.orderDate : m, '')
    return bMax.localeCompare(aMax)
  })
  return result
}

function monthLabelFor(monthKey) {
  if (!monthKey) return 'No date'
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Sections a list of orders by the month they were ordered in — undated
// orders get their own trailing "No date" section rather than being dropped.
function groupOrdersByMonth(list) {
  const groups = new Map()
  list.forEach(o => {
    const key = o.orderDate ? o.orderDate.slice(0, 7) : ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  })
  const monthKeys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1 // undated sinks to the bottom
    if (!b) return -1
    return b.localeCompare(a)
  })
  return monthKeys.map(monthKey => ({ monthKey, monthLabel: monthLabelFor(monthKey), orders: groups.get(monthKey) }))
}

// A staging list of orders picked out specifically to send to the boss —
// separate from the full Ordered list, since not everything there needs to
// go on a check-off list. Exports to a clean PDF.
function OrderMonthSections({ list, dimmed, onUpdateOrder, onDeleteOrder, onReceiveItems, onMarkReceivedNoStock, onPushPricing, onAddToExport, exportList, jobOptions }) {
  const monthGroups = groupOrdersByMonth(list)
  return monthGroups.map(({ monthKey, monthLabel, orders: monthOrders }) => (
    <div key={monthKey || 'undated'}>
      <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
        {monthLabel} <span style={{ fontWeight: 500, color: 'var(--text-light)', textTransform: 'none' }}>({monthOrders.length})</span>
      </div>
      {groupOrdersByBaseNumber(monthOrders).map((group, gi) => (
        <div key={gi} style={dimmed ? { opacity: 0.75 } : undefined}>
          {group.length > 1 && (
            <div style={{ padding: '8px 16px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--surface-2)' }}>
              Order #{baseOrderNumber(group[0].invoiceNumber)} — {group.length} shipments (backorder group)
            </div>
          )}
          {group.map(o => (
            <OrderRow
              key={o.id} order={o} onUpdate={patch => onUpdateOrder(o.id, patch)} onDelete={() => onDeleteOrder(o.id)}
              onReceiveItems={onReceiveItems} onMarkReceivedNoStock={onMarkReceivedNoStock} onPushPricing={onPushPricing}
              onAddToExport={onAddToExport} isInExportList={exportList.some(e => e.orderId === o.id)}
              jobOptions={jobOptions}
            />
          ))}
        </div>
      ))}
    </div>
  ))
}

function OrderedTab({ onClearFromJobs = () => {}, onLinkFeedPart = async () => null, orders, apiKey, onCommitOrder, onUpdateOrder, onDeleteOrder, onReceiveItems, onMarkReceivedNoStock, onPushPricing, onAddToExport, exportList, pendingSlips, onRemovePendingSlip, quotes = [], jobRecords = [], onMoveToStock, onWriteToJobs, feedChecked = {}, onCheckFeedPart, onCompareSlip }) {
  const [subTab, setSubTab] = useState('overview') // overview | orders | pricing | received | archive
  const [showDetailed, setShowDetailed] = useLocalStore('materials_orders_detailed', false)
  // Opened from the ⚑ Flagged list: find and open that slip / PO
  useEffect(() => {
    const j = readFlagJump()
    if (!j) return
    if (j.kind === 'slip') {
      const id = String(j.refId).replace(/^slip:/, '')
      const o = orders.find(x => x.id === id)
      if (o && isArchived(o)) setSubTab('archive')
      setOpenSlips(s => new Set([...s, id]))
    }
    if (j.q) setSearch(String(j.q))
    const t = setTimeout(clearFlagJump, 1500)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [reviewingSlip, setReviewingSlip] = useState(null)
  const [jobOptions, setJobOptions] = useState(withGeneralStock([]))
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const feedRows = useOrdersFeed()
  const [billingFor, setBillingFor] = useState(null) // order id
  const checkOf = o => billingCheck(o, orders, feedRows)
  // Quote ↔ slips balance for a material order (forced on the slip counts)
  const balOf = o => o.forceReceivedAt ? { balanced: true, forced: { by: 'slip', reason: o.forceReason || '', at: o.forceReceivedAt }, reasons: [] } : orderStatus(o, orders, feedRows)
  const [forcing, setForcing] = useState(null) // { id, reason, popup }
  // Click a problem → go where it gets fixed
  const [fix, setFix] = useState(null) // { id, kind: 'jobs'|'receive'|'parts'|'po', parts }
  const [quotePick, setQuotePick] = useState(null) // PO # with no quote — pick which document is the quote
  const goFix = (o, kind, parts) => { if (o) setFix({ id: o.id, kind, parts }) }
  const docsOnPoOf = o => { const k = normPoKey(o.poNumber); return k ? orders.filter(x => (x.kind || 'order') === 'order' && normPoKey(x.poNumber) === k) : [o] }
  function fixReason(o, reason, bl) {
    const r = String(reason || '')
    bl = bl || balOf(o)
    const m = r.match(/^Quote ([^:]+): /)
    const docs = docsOnPoOf(o)
    const quoteFor = () => (m && docs.find(d => isQuoteDoc(d) && String(d.invoiceNumber || '') === m[1].trim())) || (isQuoteDoc(o) ? o : docs.find(d => isQuoteDoc(d) && sameOrder(d, o)) || docs.find(isQuoteDoc))
    if (/no PO #/.test(r)) return goFix(o, 'po')
    if (/waiting for the packing slips/.test(r)) { const d = quoteFor() || o; return setForcing({ id: d.id, reason: '', popup: d.id !== o.id || !openSlips.has(o.id) }) }
    if (/billing differences not reviewed/.test(r)) { const first = (bl.open || [])[0]; return setBillingFor(first ? first.s.id : o.id) }
    if (/^(Quote [^:]+: )?still to come/.test(r)) {
      const d = quoteFor()
      const parts = (bl.toCome || []).map(i => i.partNo || i.desc)
      return d ? goFix(d, 'parts', parts) : setBillingFor(o.id)
    }
    if (/no quote for PO|quote \(lines or total\) isn/.test(r)) return setQuotePick(o.poNumber)
    if (/slips total/.test(r)) return setBillingFor(o.id)
    return checkOf(o).status !== 'none' ? setBillingFor(o.id) : goFix(o, 'receive')
  }
  // Once a PO balances, stamp its slips (so they can archive) and mark the
  // order Received in Orders & POs. Waits for the feed so nothing flips early.
  const markedPo = useRef(new Set())
  useEffect(() => {
    if (!feedRows || !feedRows.length) return
    orders.filter(o => slipKind(o) === 'order').forEach(o => {
      const b = balOf(o)
      if (!b.balanced) return
      if (!o.poBalancedAt) onUpdateOrder(o.id, { poBalancedAt: new Date().toISOString() })
      const k = normPoKey(o.poNumber)
      if (k && !markedPo.current.has(k) && (b.matches || []).some(m => m.status !== 'Received' && m.status !== 'Closed')) {
        markedPo.current.add(k); markReceivedByPo(o.poNumber)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, feedRows])
  // Mark a document as the quote (what was ordered) or a packing slip
  function setDocType(o, docType) {
    onUpdateOrder(o.id, { docType })
    // a quote on a PO that already has packing slips stops being job material
    if (docType === 'quote' && packingSlipsForQuote(orders, { ...o, docType }).some(x => x.id !== o.id)) { onUpdateOrder(o.id, { docType, replacedAt: new Date().toISOString() }); onClearFromJobs(o) }
    if (docType !== 'quote' && o.replacedAt) { onUpdateOrder(o.id, { docType, replacedAt: null }); onWriteToJobs({ ...o, docType }) }
  }
  // Quote → packing slips: once a PO's packing slips are in, they're the job
  // material (priced from the quote when they show no prices) and the quote
  // drops off the jobs. If the packing slips go away again, the quote is back.
  const syncedQuote = useRef(new Set())
  useEffect(() => {
    orders.filter(isQuoteDoc).forEach(qdoc => {
      const rep = isReplacedQuote(qdoc, orders)
      if (rep && !qdoc.replacedAt) { onUpdateOrder(qdoc.id, { replacedAt: new Date().toISOString() }); onClearFromJobs(qdoc) }
      else if (!rep && qdoc.replacedAt) { onUpdateOrder(qdoc.id, { replacedAt: null }); onWriteToJobs(qdoc) }
    })
    orders.filter(o => slipKind(o) === 'order' && !isQuoteDoc(o) && o.poNumber && !syncedQuote.current.has(o.id)).forEach(o => {
      const lines = o.lineItems || []
      if (!lines.some(li => !(Number(li.totalPrice) > 0) && !(Number(li.cost) > 0))) return
      const od = orderedOnPo(o.poNumber, orders, feedRows)
      if (!od.ordered.length) return
      const norm = x => String(x || '').toLowerCase().replace(/[^0-9a-z]/g, '')
      let changed = false
      const next = lines.map(li => {
        if (Number(li.totalPrice) > 0 || Number(li.cost) > 0) return li
        const m = od.ordered.find(x => (norm(x.partNo) && norm(x.partNo) === norm(li.partNo)) || (!norm(li.partNo) && norm(x.desc) === norm(li.name)))
        if (!m || !m.qty || !m.ext) return li
        changed = true
        const unit = Math.round(m.ext / m.qty * 10000) / 10000
        return { ...li, cost: unit, totalPrice: Math.round(unit * (Number(li.qty) || 0) * 100) / 100, priceFromQuote: true }
      })
      syncedQuote.current.add(o.id)
      if (changed) { onUpdateOrder(o.id, { lineItems: next }); onWriteToJobs({ ...o, lineItems: next }) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, feedRows])
  function forceReceive(o, reason) {
    const at = new Date().toISOString()
    const idx = (o.lineItems || []).map((li, i) => li.received ? null : i).filter(i => i !== null)
    onUpdateOrder(o.id, { forceReceivedAt: at, forceReason: reason || '', poBalancedAt: o.poBalancedAt || at, ...(!idx.length && !o.receivedAt ? { receivedAt: at } : {}) })
    if (idx.length) onReceiveItems(o, idx)
    if (o.poNumber) markReceivedByPo(o.poNumber)
    setForcing(null)
  }

  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false
    window.desktop.loadJobsOnly().then(data => {
      if (cancelled || !data) return
      const options = (data.records || [])
        .filter(p => !p.trashedAt)
        .map(p => ({ id: p.id, name: p.name, customerName: (data.customers || []).find(c => c.id === p.customerId)?.name || 'Unknown customer' }))
      setJobOptions(withGeneralStock(options))
    })
    return () => { cancelled = true }
  }, [])
  // Browser/preview: job names straight from the jobs store
  const allJobOptions = jobOptions.length > 1 ? jobOptions : withGeneralStock(jobRecords.filter(j => !j.trashedAt).map(j => ({ id: j.id, name: j.name, customerName: '' })))

  async function startReview(slip) {
    let base64 = null
    if (slip.filePath && window.desktop) {
      try { base64 = await window.desktop.readFileBytes(slip.filePath) } catch { base64 = null }
      if (!base64 && !slip.parsed) { alert('Could not read this file — it may have been moved or deleted.'); return }
    }
    const ext = ((slip.fileName || '').split('.').pop() || '').toLowerCase()
    const mediaType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    setReviewingSlip({ fileName: slip.fileName, base64, mediaType, queueId: slip.id, parsed: slip.parsed || null, kindHint: slip.kindHint || (slip.target?.type === 'quote' ? 'pricing' : ''), webLink: slip.webLink || '', source: slip.source || 'phone', target: slip.target || null })
  }
  function dismissReview() {
    if (reviewingSlip) onRemovePendingSlip(reviewingSlip.queueId)
    setReviewingSlip(null)
  }

  const q = search.trim().toLowerCase()
  const match = o => !q || hit(slipSearchText(o), q)
  const dateSort = (a, b) => (b.orderDate || '').localeCompare(a.orderDate || '')
  const live = orders.filter(o => !isArchived(o))
  const archived = orders.filter(isArchived).sort(dateSort)
  const matOrders = live.filter(o => slipKind(o) === 'order').sort(dateSort)
  const pricingSlips = live.filter(o => slipKind(o) === 'pricing').sort(dateSort)

  // Pricing quotes your morning email run put in Orders & POs (incl. Quote Slips PDFs)
  const quoteFor = p => p.filedAs === 'quote' && quotes.find(x => String(x.quoteNumber).trim().toLowerCase() === String(p.ref || '').trim().toLowerCase())
  const prevRows = useOrdersPrevious()
  const feedParts = [...(feedRows || []).filter(o => !o.archived), ...(prevRows || [])].flatMap(orderParts)
    .filter(p => p.number && !/^order/i.test(p.number) && (p.lines.length || p.total))
    // Pricing Quotes = quotes you got for pricing (no PO). Once a quote gets a
    // PO it's a purchase; its prices reach the Catalog when its slips come in.
    .filter(p => feedPoState(p.order) === 'pricing' || (feedPoState(p.order) !== 'po' && p.filedAs === 'quote'))
  const feedText = p => [p.order.supplier, p.number, p.order.poNumber, p.ref, p.refLabel, p.order.description, p.order.date, ...p.lines.map(l => `${l.partNo} ${l.desc}`)].join(' ').toLowerCase()
  const feedDoneOf = p => { const c = feedChecked[p.key]; return !!(c && c.catalogAt && (!quoteFor(p) || c.quoteComparedAt)) }
  const feedLive = feedParts.filter(p => !feedDoneOf(p))
  const feedDone = feedParts.filter(feedDoneOf)
  const feedMatch = p => !q || hit(feedText(p), q)

  const jobRec = id => jobRecords.find(j => j.id === id)
  const isComplete = j => !!j && (j.lifecycleStatus === 'unbilled' || j.lifecycleStatus === 'billed')

  function groupByJob(list) {
    const groups = new Map()
    const add = (key, label, sort, o) => {
      if (!groups.has(key)) groups.set(key, { key, label, sort, orders: [] })
      const g = groups.get(key)
      if (!g.orders.includes(o)) g.orders.push(o)
    }
    list.forEach(o => {
      const ids = new Set([...(o.jobs || []).map(j => j.id), ...(o.lineItems || []).flatMap(li => li.jobIds || [])])
      if (!ids.size) add('__none', 'Not allocated yet', 0, o)
      ids.forEach(id => {
        if (id === GENERAL_STOCK_ID) return add(id, 'General Stock', 2, o)
        const j = (o.jobs || []).find(x => x.id === id) || allJobOptions.find(x => x.id === id)
        add(id, j ? jobLabel(j) : 'Job', 1, o)
      })
    })
    return [...groups.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  }
  function pricingGroups(slips, parts) {
    const groups = new Map()
    const add = (key, label, sort, item) => {
      if (!groups.has(key)) groups.set(key, { key, label, sort, items: [] })
      groups.get(key).items.push(item)
    }
    slips.forEach(o => {
      const t = o.pricingTarget
      if (t?.type === 'quote') add('q:' + t.quoteNumber, `Quote ${t.quoteNumber}${t.title ? ' — ' + t.title : ''}`, 0, { slip: o })
      else add('catalog', 'Catalog pricing (no quote)', 3, { slip: o })
    })
    parts.forEach(p => {
      if (p.filedAs === 'quote') add('q:' + p.ref, `Quote ${p.ref}${p.refLabel ? ' — ' + p.refLabel : ''}`, 0, { part: p })
      else if (p.filedAs === 'job') add('j:' + p.ref, `Job: ${p.ref}${p.refLabel ? ' · ' + p.refLabel : ''}`, 1, { part: p })
      else if (p.filedAs === 'stock') add('stock', 'For Stock', 2, { part: p })
      else add('none', 'Not filed yet (file it on Orders & POs)', 4, { part: p })
    })
    return [...groups.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  }

  const pill = (text, bg, fg) => <span style={{ fontSize: 10, fontWeight: 700, background: bg, color: fg, borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>{text}</span>
  const smallBtn = { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-mid)' }
  const groupHead = (key, label, count, extra) => (
    <div onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', cursor: 'pointer', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{(key.startsWith('sqo:') ? !collapsed[key] : collapsed[key]) ? '▸' : '▾'}</span>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-light)' }}>({count})</span>
      {extra}
    </div>
  )
  // One checklist line per slip: each step ✓ done / ⚠ needs you / ○ not yet.
  // Click a step for its details; the ⋯ menu holds the less-used actions.
  const [menuFor, setMenuFor] = useState(null)
  const step = (state, text, title, onClick) => {
    const c = state === 'ok' ? { fg: '#1e7a34', icon: '✓' } : state === 'warn' ? { fg: '#9a6610', icon: '⚠' } : { fg: '#9aa3ad', icon: '○' }
    return (
      <span key={text} title={title || ''} onClick={onClick}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: state === 'warn' ? 700 : 600, color: c.fg, cursor: onClick ? 'pointer' : 'default', textDecoration: onClick && state === 'warn' ? 'underline dotted' : 'none' }}>
        <span>{c.icon}</span>{text}
      </span>
    )
  }
  const dot = <span style={{ color: 'var(--border)' }}>·</span>
  const purchaseOf = o => {
    if (!o.poNumber) return null
    const ms = matchOrdersByPo(feedRows, o.poNumber)
    const quotes = [...new Set(ms.flatMap(m => orderParts(m).map(p => p.number)).filter(n => n && !/^order/i.test(n)))]
    return { ms, quotes }
  }
  const quoteDocOnPo = o => { const k = normPoKey(o.poNumber); return k ? orders.find(x => isQuoteDoc(x) && normPoKey(x.poNumber) === k && sameOrder(x, o)) : null }
  // Sent to Jonathan is a toggle: sent comes off the timesheet export, not sent goes back on it
  const toggleSent = o => onUpdateOrder(o.id, o.sentAt
    ? { sentAt: undefined, sentWithWeek: undefined, sentManually: undefined }
    : { sentAt: new Date().toISOString(), sentManually: true })
  const statusStrip = o => {
    const wrap = { padding: '0 16px 8px', marginTop: -4, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--text-light)', position: 'relative' }
    const src = o.source === 'email' ? '✉' : o.source === 'phone' ? '📱' : ''
    if (slipKind(o) === 'pricing') {
      const t = o.pricingTarget?.type === 'quote' ? o.pricingTarget : null
      return (
        <div style={wrap}>
          {src && <span title={`from ${o.source}`}>{src}</span>}
          {step(o.pricingPushedAt ? 'ok' : 'todo', 'Catalog checked')}
          {t && <>{dot}{o.quoteComparedAt
            ? step(o.quoteCompare?.flagged ? 'warn' : 'ok', o.quoteCompare ? `Compared to ${t.quoteNumber}: ${o.quoteCompare.flagged} price diff, ${o.quoteCompare.added} added` : `Compared to ${t.quoteNumber}`, '', () => onCompareSlip(o))
            : step('warn', `Compare to ${t.quoteNumber} →`, 'Open the comparison', () => onCompareSlip(o))}</>}
          {isArchived(o) && <>{dot}{step('ok', 'archived')}</>}
        </div>
      )
    }
    const lines = o.lineItems || []
    const rec = lines.filter(li => li.received).length
    const bl = balOf(o)
    const bc = checkOf(o)
    const qd = isQuoteDoc(o)
    const psCount = qd ? packingSlipsForQuote(orders, o).length : 0
    const replaced = qd && psCount > 0
    const noQuote = !qd && bl.reasons.some(r => /^no quote for PO/.test(r))
    const flag = bc.status === 'flag' && !isReviewed(o, bc)
    const leftLines = lines.filter(li => !lineIsAllocated(li, o))
    const pur = purchaseOf(o)
    const menuBtn = { display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)', whiteSpace: 'nowrap' }
    return (
      <div style={wrap}>
        {src && <span title={`from ${o.source}`}>{src}</span>}
        {pur && (pur.ms.length
          ? <span title="The purchase this slip belongs to (Orders & POs)" style={{ fontSize: 11, color: '#1a5fa0', fontWeight: 700 }}>📑 PO {String(o.poNumber).replace(/^po\s*#?\s*/i, '')}{pur.quotes.length ? ` · Quote ${pur.quotes.join(', ')}` : ''}</span>
          : quoteDocOnPo(o) ? <span style={{ fontSize: 11, color: '#1a5fa0', fontWeight: 700 }}>📑 PO {String(o.poNumber).replace(/^po\s*#?\s*/i, '')}{isQuoteDoc(o) ? '' : ` · Quote ${quoteDocOnPo(o).invoiceNumber || ''}`}</span>
          : <span style={{ fontSize: 11 }}>PO {o.poNumber} (not in Orders &amp; POs)</span>)}
        {qd && <span title="This is the quote — what was ordered. Packing slips on this PO are checked against it." style={{ fontSize: 10, fontWeight: 800, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 20, padding: '2px 8px' }}>📄 QUOTE</span>}
        {qd
          ? (psCount
            ? step('ok', `${psCount} packing slip${psCount === 1 ? '' : 's'} in`, 'The packing slips are now the job material; this quote is what they’re checked against')
            : bl.forced
              ? step('ok', 'Closed without packing slips', bl.forced.reason || '')
              : step('warn', 'Waiting for packing slips — click to close without them', 'No slips coming? Close the order with a reason; the quote’s lines stay as the job material', () => setForcing({ id: o.id, reason: '' })))
          : step(rec === lines.length && lines.length ? 'ok' : rec ? 'warn' : 'todo', rec === lines.length ? 'Received' : rec ? `Received ${rec} of ${lines.length}` : 'Not received',
              rec === lines.length ? '' : 'Click to receive the rest', rec === lines.length ? undefined : () => goFix(o, 'receive'))}
        {dot}
        {flag
          ? step('warn', `Billing ${bc.over > 0 ? money(bc.over) + ' over' : bc.issues.length + ' diff'}`, 'Billed differently than ordered — click for details', () => setBillingFor(o.id))
          : bl.forced ? step('ok', 'Forced received', bl.forced.reason || '')
          : bl.separate ? step('ok', 'Own order on this PO', 'A different order (reference #) than the quote on this PO — nothing to check it against')
          : bl.balanced ? step('ok', 'Balanced', 'Quote and slips balance', bc.status !== 'none' ? () => setBillingFor(o.id) : undefined)
          : step('warn', 'Not balanced', bl.reasons.join('\n') + '\n— click to fix', () => fixReason(o, bl.reasons[0], bl))}
        {!replaced && <>{dot}
        {step(leftLines.length ? 'warn' : 'ok', leftLines.length ? `${leftLines.length} line${leftLines.length === 1 ? '' : 's'} not used up` : 'On jobs / Stock',
          leftLines.map(li => `${lineRemaining(o, li)} ${li.uom || ''} ${li.nickname || li.name} left`).join('\n') + (leftLines.length ? '\n— click to give them jobs' : ''),
          leftLines.length ? () => goFix(o, 'jobs') : undefined)}</>}
        {!qd && <>{dot}
        {step(o.sentAt ? 'ok' : 'todo', o.sentAt ? `Sent ${o.sentAt.slice(0, 10)} ⇄` : 'Not sent to Jonathan ⇄',
          o.sentAt ? 'Click to mark NOT sent — it goes back on the timesheet export' : 'Click to mark sent — it comes off the timesheet export',
          () => toggleSent(o))}</>}
        {noQuote && !isArchived(o) && <button style={{ ...smallBtn, borderColor: '#1a5fa0', color: '#1a5fa0' }} title="This document is the wholesaler's quote (what was ordered), not a packing slip" onClick={() => setDocType(o, 'quote')}>📄 This is the quote</button>}
        {isArchived(o) && <>{dot}{step('ok', 'archived')}</>}
        {!bl.balanced && !bl.forced && !isArchived(o) && bl.reasons.map((r, k) => (
          <button key={k} onClick={() => fixReason(o, r, bl)} title="Click to go fix it"
            style={{ fontSize: 10.5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9a6610', textDecoration: 'underline dotted', textAlign: 'left' }}>({r} →)</button>
        ))}
        <span style={{ flex: 1 }} />
        {forcing?.id === o.id && !forcing.popup ? (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input autoFocus value={forcing.reason} onChange={e => setForcing({ id: o.id, reason: e.target.value })} placeholder="Why? e.g. picked up at counter, no slip"
              onKeyDown={e => { if (e.key === 'Enter') forceReceive(o, forcing.reason); if (e.key === 'Escape') setForcing(null) }}
              style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', width: 230 }} />
            <button style={{ ...smallBtn, borderColor: '#9a6610', color: '#9a6610' }} onClick={() => forceReceive(o, forcing.reason)}>Force received</button>
            <button style={smallBtn} onClick={() => setForcing(null)}>Cancel</button>
          </span>
        ) : (
          <span style={{ position: 'relative' }}>
            <button style={{ ...smallBtn, padding: '1px 9px', fontSize: 13, lineHeight: 1 }} title="More" onClick={() => setMenuFor(m => m === o.id ? null : o.id)}>⋯</button>
            {menuFor === o.id && (
              <div onMouseLeave={() => setMenuFor(null)} style={{ position: 'absolute', right: 0, top: '100%', marginTop: 2, zIndex: 30, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 14px rgba(0,0,0,.14)', overflow: 'hidden' }}>
                {bc.status !== 'none' && <button style={menuBtn} onClick={() => { setMenuFor(null); setBillingFor(o.id) }}>Billing check…</button>}
                <button style={menuBtn} onClick={() => { setMenuFor(null); setDocType(o, qd ? 'packing_slip' : 'quote') }}>{qd ? 'This is a packing slip, not the quote' : '📄 This is the quote (what was ordered)'}</button>
                {!bl.balanced && <button style={menuBtn} onClick={() => { setMenuFor(null); setForcing({ id: o.id, reason: '' }) }}>Force received (no slip / quote)…</button>}
                <button style={{ ...menuBtn, borderBottom: 'none' }} onClick={() => { setMenuFor(null); onWriteToJobs(o) }}>↻ Update job materials</button>
              </div>
            )}
          </span>
        )}
      </div>
    )
  }
  // Each slip is one collapsed title bar (date · wholesaler · PO · quick note);
  // click it to open everything else under it.
  const orderRow = (o, dimmed, bare = false) => {
    const isOpen = bare || openSlips.has(o.id) || openDetailId === o.id
    return (
      <div key={o.id} style={dimmed ? { opacity: 0.8 } : undefined}>
        {!bare && <SlipTitleBar o={o} open={isOpen} onToggle={() => toggleSlip(o.id)} onNote={note => onUpdateOrder(o.id, { note })}
          onSetPo={!hasPoNumber(o) ? po => onUpdateOrder(o.id, { poNumber: po, ...(slipKind(o) === 'order' && !o.docType ? { docType: 'quote' } : {}) }) : undefined}
          onSetKind={k => onUpdateOrder(o.id, { kind: k, recordOnly: k === 'pricing' })} />}
        {isOpen && (
          <div style={{ borderLeft: '3px solid var(--accent)', marginLeft: 6 }}>
            <div style={{ padding: '0 16px' }}><FlagNote refId={'slip:' + o.id} /></div>
            <OrderRow order={o} onUpdate={patch => onUpdateOrder(o.id, patch)} onDelete={() => onDeleteOrder(o.id)}
              onReceiveItems={onReceiveItems} onMarkReceivedNoStock={onMarkReceivedNoStock} onPushPricing={onPushPricing}
              onAddToExport={onAddToExport} isInExportList={exportList.some(e => e.orderId === o.id)} jobOptions={allJobOptions} startViewing={openDetailId === o.id} />
            {statusStrip(o)}
          </div>
        )}
      </div>
    )
  }
  // All the paperwork for one order # together: the order, its releases /
  // backorders (-01, -02…) and its quote, under one heading.
  function grouped(items, slipOf, render) {
    const groups = [], at = new Map()
    items.forEach(it => {
      const s = slipOf(it)
      const k = s ? orderBaseKey(s) : ''
      if (k && at.has(k)) { groups[at.get(k)].push(it); return }
      if (k) at.set(k, groups.length)
      groups.push([it])
    })
    return groups.map(g => {
      if (g.length < 2) return render(g[0])
      const first = slipOf(g[0])
      const sufs = g.map(it => { const n = String(slipOf(it).invoiceNumber || '').trim(); const b = orderBaseLabel(slipOf(it)); return n.length > b.length ? n.slice(b.length).replace(/^[-/ .]/, '-') : 'original' })
      const sorted = g.slice().sort((a, b) => String(slipOf(a).invoiceNumber || '').localeCompare(String(slipOf(b).invoiceNumber || ''), undefined, { numeric: true }))
      return (
        <div key={'ord:' + orderBaseKey(first)} style={{ borderLeft: '3px solid #1a5fa0', margin: '4px 0' }}>
          <div style={{ padding: '5px 14px', fontSize: 11.5, fontWeight: 800, color: '#1a5fa0', background: '#f2f7fd' }}>
            🧾 Order {orderBaseLabel(first)} · {g.length} documents ({[...new Set(sufs)].sort().join(', ')})
          </div>
          {sorted.map(render)}
        </div>
      )
    })
  }
  const slipList = (list, dimOf) => grouped(list, o => o, o => orderRow(o, dimOf(o)))
  // Month (newest first) → distributor headings around any list
  const [sortBy, setSortBy] = useLocalStore('materials_orders_sort', 'month')
  const monthHead = m => <div key={'mh:' + m.key} style={{ padding: '7px 16px', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--navy)', background: '#eef1f5', borderTop: '1px solid var(--border)' }}>{m.label} <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>({m.count})</span></div>
  const distHead = d => <div key={'dh:' + d.key} style={{ padding: '5px 16px 5px 24px', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>{d.label} <span style={{ color: 'var(--text-light)', fontWeight: 500 }}>· {d.items.length}</span></div>
  const byMonthDist = (items, dateOf, nameOf, renderItems) => groupMonthDist(items, dateOf, nameOf).map(m => (
    <div key={'m:' + m.key}>{monthHead(m)}{m.dists.map(d => <div key={'d:' + m.key + d.key}>{distHead(d)}{renderItems(d.items)}</div>)}</div>
  ))
  const sortToggle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', fontSize: 11.5, color: 'var(--text-light)' }}>
      <span>Slips sorted by</span>
      {[['month', 'Month & distributor'], ['job', 'Job']].map(([v, l]) => (
        <button key={v} onClick={() => setSortBy(v)} style={{ ...smallBtn, background: sortBy === v ? 'var(--navy)' : 'var(--surface)', color: sortBy === v ? '#fff' : 'var(--text-mid)', border: sortBy === v ? 'none' : '1px solid var(--border)' }}>{l}</button>
      ))}
    </div>
  )
  const [poMoved, setPoMoved] = useState({})
  const [orderSecs, setOrderSecs] = useLocalStore('materials_order_sections', { po: true, waiting: true, none: false })
  const feedRow = (p, done) => {
    const c = feedChecked[p.key] || {}
    const qrec = quoteFor(p)
    return (
      <div key={p.key} style={{ ...rowStyle, flexWrap: 'wrap', opacity: done ? 0.8 : 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{p.order.supplier} · Quote{' '}
            <a href="#" onClick={e => { e.preventDefault(); openQuotePdf(p.number) }} style={{ color: 'var(--blue, #2563eb)' }}>{p.number}</a>
            <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-light)' }}> · {p.order.date || ''} · {p.order.status}{p.order.poNumber ? ` · PO ${p.order.poNumber}` : ''}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{p.order.description} · {p.lines.length} line{p.lines.length === 1 ? '' : 's'} · {money(p.total)} · 📑 from Orders &amp; POs</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {!done && <PoBox width={86} onSave={async po => { if (await setFeedPo(p.order.id, po)) setPoMoved(m => ({ ...m, [p.key]: po })) }} />}
          {c.catalogAt && pill('✓ Catalog checked', '#e6f4ea', '#1e7a34')}
          {c.quoteCompare && pill(`compared: ${c.quoteCompare.flagged} price diff · ${c.quoteCompare.added} added`, '#fdf0f0', '#a12a1e')}
          {p.lines.length > 0 && (
            <button onClick={() => onCheckFeedPart(p)} style={{ ...smallBtn, background: done ? 'var(--surface)' : 'var(--navy)', color: done ? 'var(--text-mid)' : '#fff', border: 'none' }}>
              {done ? 'Check again' : qrec ? `Check vs Catalog + compare to ${qrec.quoteNumber}` : 'Check vs Catalog'}
            </button>
          )}
        </div>
      </div>
    )
  }

  function materialOrdersList(list, dimmed) {
    if (!list.length) return <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{q ? 'No material orders match.' : 'No open material orders.'}</div>
    if (sortBy === 'month') return byMonthDist(list, o => o.orderDate, o => o.wholesaler, items => slipList(items, () => dimmed))
    return groupByJob(list).map(g => {
      const rec = jobRec(g.key)
      const left = isComplete(rec) ? leftoverLinesForJob(orders, rec, id => isComplete(jobRec(id))) : []
      const extra = (
        <>
          {isComplete(rec) && pill('job complete', '#f0efec', '#666')}
          {left.length > 0 && <>
            {pill(`⚠ ${left.length} line${left.length === 1 ? '' : 's'} not used on this job`, '#fff3d6', '#9a6610')}
            <button style={{ ...smallBtn, borderColor: '#9a6610', color: '#9a6610' }} onClick={e => {
              e.stopPropagation()
              if (!window.confirm(`Move ${left.length} leftover line${left.length === 1 ? '' : 's'} from ${g.label} into General Stock? Lines already received go into the Stock list now.`)) return
              const byOrder = new Map()
              left.forEach(x => { if (!byOrder.has(x.order.id)) byOrder.set(x.order.id, { order: x.order, idxs: [] }); byOrder.get(x.order.id).idxs.push(x.idx) })
              byOrder.forEach(({ order, idxs }) => onMoveToStock(order, idxs))
            }}>Move leftovers to Stock</button>
          </>}
        </>
      )
      return (
        <div key={g.key}>
          {groupHead('o:' + g.key, g.label, g.orders.length, extra)}
          {!collapsed['o:' + g.key] && slipList(g.orders, () => dimmed)}
        </div>
      )
    })
  }
  function pricingList(slips, parts, done) {
    const groups = pricingGroups(slips, parts)
    if (!groups.length) return <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{q ? 'No pricing quotes match.' : 'No pricing quotes waiting to be checked.'}</div>
    return groups.map(g => (
      <div key={g.key}>
        {groupHead('p:' + g.key, g.label, g.items.length)}
        {!collapsed['p:' + g.key] && byMonthDist(g.items, it => it.slip ? it.slip.orderDate : it.part.order.date, it => it.slip ? it.slip.wholesaler : it.part.order.supplier,
          items => grouped(items, it => it.slip || null, it => it.slip ? orderRow(it.slip, done) : feedRow(it.part, done)))}
      </div>
    ))
  }
  function archiveList(list, parts) {
    if (!list.length && !parts.length) return <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{q ? 'Nothing in the archive matches.' : 'Nothing archived yet. Material orders archive once they are sent to Jonathan, fully received and every line is on a job or Stock; pricing quotes once checked.'}</div>
    return (
      <>
        {list.filter(o => slipKind(o) === 'order').length > 0 && materialOrdersList(list.filter(o => slipKind(o) === 'order'), true)}
        {(list.some(o => slipKind(o) === 'pricing') || parts.length > 0) && pricingList(list.filter(o => slipKind(o) === 'pricing'), parts, true)}
      </>
    )
  }

  // ── Orders: each purchase (quote → PO) with its slips under it ──
  const [purchaseRows, setPurchaseRows] = useState(null)
  const [bulkClose, setBulkClose] = useState(null) // { before, reason } while the bulk close panel is open
  const slipsForPurchase = p => {
    const k = normPoKey(p.poNumber)
    return orders.filter(o => slipKind(o) === 'order' && ((k && normPoKey(o.poNumber) === k) || (o.feedId && o.feedId === p.id))).sort(dateSort)
  }
  // Orders & POs quote → its parsed lines as a quote here, to send each line to a job
  const [openDetailId, setOpenDetailId] = useState(null)
  const [openSlips, setOpenSlips] = useState(() => new Set())
  const toggleSlip = id => setOpenSlips(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const [linking, setLinking] = useState({}) // part key → 'busy' | message
  async function openPartDetails(part) {
    const have = orders.find(o => o.feedKey === part.key)
    if (have) { setOpenDetailId(have.id); return }
    setLinking(m => ({ ...m, [part.key]: 'busy' }))
    const r = await onLinkFeedPart(part)
    setLinking(m => ({ ...m, [part.key]: r && r.error ? r.error : '' }))
    if (r && r.id) setOpenDetailId(r.id)
  }
  // a PO # that arrives later goes onto the linked quote too
  useEffect(() => {
    orders.filter(o => o.feedId).forEach(o => {
      const row = (feedRows || []).find(r => r.id === o.feedId)
      if (row && row.poNumber && normPoKey(row.poNumber) !== normPoKey(o.poNumber)) onUpdateOrder(o.id, { poNumber: row.poNumber })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, feedRows])
  const purchasePos = new Set((purchaseRows || feedRows || []).map(r => normPoKey(r.poNumber)).filter(Boolean))
  // slips with no purchase in the list (counter pick-ups, no PO, PO not issued here)
  const purchaseIds = new Set((purchaseRows || feedRows || []).map(r => r.id))
  const notListed = matOrders.filter(o => hasPoNumber(o) && !purchasePos.has(normPoKey(o.poNumber)) && !(o.feedId && purchaseIds.has(o.feedId)))
  // POs whose quote was saved here (not in Orders & POs): their own purchase
  const savedQuotePos = [...new Set(notListed.filter(isQuoteDoc).map(o => normPoKey(o.poNumber)).filter(Boolean))]
  const looseSlips = notListed.filter(o => !savedQuotePos.includes(normPoKey(o.poNumber)))
  // Slips with a PO the email run never had: shown only when a new one turns up
  // (the ones already here were seen — they're in the Overview by PO)
  const [looseSeen, setLooseSeen] = useLocalStore('materials_loose_seen', null)
  useEffect(() => { if (looseSeen === null && orders.length) setLooseSeen(looseSlips.map(o => o.id)) }, [looseSeen, orders.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const newLoose = looseSeen === null ? [] : looseSlips.filter(o => !looseSeen.includes(o.id))
  const savedQuotePurchases = savedQuotePos.map(k => {
    const docs = orders.filter(o => slipKind(o) === 'order' && normPoKey(o.poNumber) === k).sort((a, b) => (isQuoteDoc(b) ? 1 : 0) - (isQuoteDoc(a) ? 1 : 0) || dateSort(a, b))
    const qd = docs.find(isQuoteDoc)
    return { k, docs, label: `PO ${String(qd.poNumber).replace(/^po\s*#?\s*/i, '')} · ${qd.wholesaler || ''} quote ${qd.invoiceNumber || ''}`.trim() }
  })
  const purchaseSlips = p => {
    const list = slipsForPurchase(p)
    // each quote # on the row that isn't opened here yet
    const unopened = orderParts(p).filter(pt => pt.number && !/^order/i.test(pt.number) && !orders.some(o => o.feedKey === pt.key))
    const buttons = unopened.length > 0 && (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        {unopened.map(pt => (
          <span key={pt.key} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button disabled={linking[pt.key] === 'busy'} onClick={() => openPartDetails(pt)}
              title="Read this quote's PDF and open its lines, so each line can go to its own job (like a slip)"
              style={{ ...smallBtn, borderColor: '#1a5fa0', color: '#1a5fa0', opacity: linking[pt.key] === 'busy' ? 0.6 : 1 }}>
              {linking[pt.key] === 'busy' ? 'Reading the quote…' : `📄 Parsed details & jobs${unopened.length > 1 || orderParts(p).length > 1 ? ' — ' + pt.number : ''}`}
            </button>
            {linking[pt.key] && linking[pt.key] !== 'busy' && <span style={{ fontSize: 11.5, color: '#a12a1e' }}>{linking[pt.key]}</span>}
          </span>
        ))}
      </div>
    )
    if (!list.length) return buttons || null
    return (
      <>
      {buttons}
      <div style={{ margin: '8px 0 0 0', border: '1px solid var(--border)', borderLeft: '3px solid #1e7a34', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '4px 12px', fontSize: 11, fontWeight: 800, color: '#1e7a34', background: '#f1f8f3' }}>🧾 {list.filter(isQuoteDoc).length ? '📄 quote + ' : ''}{list.filter(x => !isQuoteDoc(x)).length} packing slip{list.filter(x => !isQuoteDoc(x)).length === 1 ? '' : 's'} on this PO</div>
        {slipList(list, isArchived)}
      </div>
      </>
    )
  }
  const purchasesView = (
    <OrdersList embedded query={q} onRows={setPurchaseRows}
      rowFilter={r => feedPoState(r) === 'po'}
      onFixReason={(bal, reason) => { const sl = (bal.slips || [])[0]; if (/billing differences/.test(reason) && bal.open && bal.open[0]) setBillingFor(bal.open[0].s.id); else if (sl) fixReason(sl, reason, bal); else setQuotePick(bal.po) }}
      extraMatch={p => slipsForPurchase(p).some(match)}
      renderExtra={purchaseSlips}
      footer={<>
        {(() => {
          // Older POs whose quote was saved in Materials (not in the email-run list).
          // One line each — click to open; the finished ones are tucked away.
          const list = savedQuotePurchases.filter(g => g.docs.some(match)).map(g => {
            const st = g.docs.filter(isQuoteDoc).map(d => balOf(d))
            const done = st.every(b => b.balanced)
            const latest = g.docs.reduce((m, o) => (o.orderDate || '') > m ? (o.orderDate || '') : m, '')
            return { ...g, done, latest, why: (st.find(b => !b.balanced) || { reasons: [] }).reasons[0] || '' }
          }).sort((a, b) => b.latest.localeCompare(a.latest))
          if (!list.length) return null
          const open = list.filter(g => !g.done), done = list.filter(g => g.done)
          const setAll = on => setCollapsed(c => ({ ...c, ...Object.fromEntries(list.map(g => ['sqo:' + g.k, on])), sqDone: on }))
          const bc = bulkClose
          const toClose = bc ? open.filter(g => !bc.before || g.latest < bc.before) : []
          const closeNow = () => {
            const reason = (bc.reason || '').trim() || 'Closed in bulk — picked up, no packing slip saved'
            toClose.forEach(g => g.docs.filter(isQuoteDoc).filter(d => !balOf(d).balanced).forEach(d => forceReceive(d, reason)))
            setBulkClose(null)
          }
          const row = g => (
            <div key={g.k}>
              {groupHead('sqo:' + g.k, g.label + (g.latest ? ' · ' + g.latest : ''), g.docs.length,
                g.done ? pill('✓ done', '#e6f4ea', '#1e7a34') : (() => {
                  const d = g.docs.filter(isQuoteDoc).find(x => !balOf(x).balanced) || g.docs[0]
                  return <span title="Click to go fix it" onClick={e => { e.stopPropagation(); fixReason(d, g.why) }} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>{pill('⚠ ' + (g.why || 'open') + ' →', '#fff3d6', '#9a6610')}</span>
                })())}
              {(collapsed['sqo:' + g.k] || q) && slipList(g.docs, isArchived)}
            </div>
          )
          return (
            <div style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Older POs — quote saved in Materials ({open.length} open{done.length ? `, ${done.length} done` : ''})</span>
                <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Not in the morning email list (from before it, or it never saw them). Click a PO to open it</span>
                <span style={{ flex: 1 }} />
                <button style={smallBtn} onClick={() => setAll(true)}>Expand all</button>
                <button style={smallBtn} onClick={() => setAll(false)}>Collapse all</button>
                {open.length > 0 && <button style={{ ...smallBtn, borderColor: '#9a6610', color: '#9a6610' }} onClick={() => setBulkClose(b => b ? null : { before: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), reason: '' })}>Close old ones…</button>}
              </div>
              {bc && (
                <div style={{ padding: '10px 16px', background: '#fff8e6', borderBottom: '1px solid #e0a716', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Close every open PO here dated before</span>
                  <input type="date" value={bc.before} onChange={e => setBulkClose(b => ({ ...b, before: e.target.value }))} style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px' }} />
                  <b>({toClose.length} PO{toClose.length === 1 ? '' : 's'})</b>
                  <input value={bc.reason} onChange={e => setBulkClose(b => ({ ...b, reason: e.target.value }))} placeholder="Reason — e.g. picked up, no slip saved"
                    style={{ flex: 1, minWidth: 220, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 7px' }} />
                  <button disabled={!toClose.length} style={{ ...smallBtn, background: '#9a6610', color: '#fff', border: 'none', opacity: toClose.length ? 1 : 0.5 }}
                    onClick={() => { if (window.confirm(`Close ${toClose.length} PO${toClose.length === 1 ? '' : 's'} without packing slips? Their items are marked received — anything not already on a job goes into Stock.`)) closeNow() }}>
                    Close {toClose.length}
                  </button>
                  <button style={smallBtn} onClick={() => setBulkClose(null)}>Cancel</button>
                  <div style={{ flexBasis: '100%', color: 'var(--text-light)' }}>Each one shows “Closed without packing slips” with your reason, and moves to Done. A packing slip that turns up later still takes over.</div>
                </div>
              )}
              {byMonthDist(open, g => g.latest, g => (g.docs.find(isQuoteDoc) || g.docs[0] || {}).wholesaler, items => items.map(row))}
              {done.length > 0 && (
                <>
                  <div onClick={() => setCollapsed(c => ({ ...c, sqDone: !c.sqDone }))} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                    {collapsed.sqDone || q ? '▾' : '▸'} {done.length} done (balanced or closed)
                  </div>
                  {(collapsed.sqDone || q) && byMonthDist(done, g => g.latest, g => (g.docs.find(isQuoteDoc) || g.docs[0] || {}).wholesaler, items => items.map(row))}
                </>
              )}
            </div>
          )
        })()}
        {newLoose.filter(match).length > 0 && (
        <div style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>New slips with a PO that isn't in the list above ({newLoose.filter(match).length})</span>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>The email run didn't have this PO. They're in the Overview by PO too.</span>
            <button style={{ ...smallBtn, marginLeft: 'auto' }} onClick={() => setLooseSeen(s => [...new Set([...(s || []), ...newLoose.map(o => o.id)])])}>Got it — hide</button>
          </div>
          {materialOrdersList(newLoose.filter(match))}
        </div>
        )}
      </>} />
  )
  const toCheckCount = pricingSlips.length + feedLive.length
  const recvNoDate = orders.filter(o => slipKind(o) === 'order' && !o.recordOnly && !o.receivedAt && (o.lineItems || []).length && (o.lineItems || []).every(li => li.received) && !(isQuoteDoc(o) && o.replacedAt)).length
  // Slips billed differently than ordered, not looked at yet (archive included)
  const billingFlags = orders.filter(o => slipKind(o) === 'order' && !o.archivedNote).map(o => ({ o, r: checkOf(o) })).filter(x => x.r.status === 'flag' && !isReviewed(x.o, x.r))
  function billingBanner() {
    if (!billingFlags.length) return null
    const over = billingFlags.reduce((a, x) => a + x.r.over, 0)
    return (
      <div style={{ padding: '10px 16px', background: '#fdf0f0', borderBottom: '1px solid #e8b4ae' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#a12a1e', marginBottom: 4 }}>
          ⚠ {billingFlags.length} slip{billingFlags.length === 1 ? '' : 's'} billed differently than ordered{over > 0 ? ` — ${money(over)} over` : ''}
        </div>
        {billingFlags.map(({ o, r }) => (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0' }}>
            <span style={{ flex: 1 }}>{o.wholesaler}{o.invoiceNumber ? ` #${o.invoiceNumber}` : ''} · PO {o.poNumber} · {o.orderDate || ''} — {r.issues.length} difference{r.issues.length === 1 ? '' : 's'}{r.over > 0 ? `, ${money(r.over)} over` : ''}</span>
            <button style={smallBtn} onClick={() => setBillingFor(o.id)}>Check →</button>
          </div>
        ))}
      </div>
    )
  }
  const billingOrder = billingFor && orders.find(o => o.id === billingFor)
  const sectionTitle = t => <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--navy)' }}>{t}</div>

  return (
    <div>
      {pendingSlips.length > 0 && (
        <div style={{ padding: 12, background: '#e8f2fc', borderBottom: '1px solid #1a5fa0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', marginBottom: 6 }}>
            🧾 {pendingSlips.length} slip{pendingSlips.length === 1 ? '' : 's'} to confirm
          </div>
          {pendingSlips.map(slip => {
            const src = slip.source === 'email' ? '✉ email' : slip.source === 'upload' ? '📄 upload' : '📱 phone'
            const status = slip.parsed ? `ready — ${slip.parsed.wholesaler || 'slip'}${slip.parsed.invoiceNumber ? ' #' + slip.parsed.invoiceNumber : ''} · ${(slip.parsed.lineItems || []).length} lines`
              : slip.parseError ? `couldn't read automatically (${slip.parseError}) — Review to try again`
              : apiKey ? 'reading…' : 'add your API key in ⚙ Settings to read it'
            return (
              <div key={slip.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b>{src}</b> · {slip.fileName || 'slip'}{slip.target ? <b style={{ color: '#1a5fa0' }}> · for {slip.target.type === 'quote' ? `quote ${slip.target.quoteNumber || ''}` : slip.target.name}</b> : null} <span style={{ color: slip.parseError ? 'var(--red)' : 'var(--text-light)' }}>— {status}</span>
                </span>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button onClick={() => startReview(slip)} style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer' }}>Review &amp; confirm</button>
                  <button onClick={() => { if (window.confirm('Dismiss this slip? It will not be added anywhere.')) onRemovePendingSlip(slip.id) }} style={{ fontSize: 11, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <UploadOrderFlow apiKey={apiKey} onCommit={onCommitOrder} preloadedFile={reviewingSlip} onDismissPreloaded={dismissReview} quotes={quotes} />
      {billingOrder && <BillingCheckModal slip={billingOrder} res={checkOf(billingOrder)} onClose={() => setBillingFor(null)} onReviewed={patch => onUpdateOrder(billingOrder.id, patch)}
        onShowLine={pn => { const o = billingOrder; setBillingFor(null); goFix(o, 'parts', [pn]) }} />}
      {(() => {
        const fo = fix && orders.find(o => o.id === fix.id)
        if (!fo) return null
        return <OrderDetailModal key={fo.id + fix.kind} order={fo} focus={fix} onClose={() => setFix(null)} onUpdate={patch => onUpdateOrder(fo.id, patch)}
          onReceiveItems={idx => (fo.recordOnly ? onMarkReceivedNoStock(fo, idx) : onReceiveItems(fo, idx))} onPushPricing={() => onPushPricing(fo)}
          isRecordOnly={!!fo.recordOnly} jobOptions={allJobOptions} />
      })()}
      {forcing?.popup && (() => {
        const fo = orders.find(o => o.id === forcing.id)
        if (!fo) return null
        return (
          <ModalOverlay onClose={() => setForcing(null)} maxWidth={460}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Close without packing slips?</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 10 }}>{fo.wholesaler}{fo.invoiceNumber ? ` #${fo.invoiceNumber}` : ''} · PO {fo.poNumber || '—'} — no packing slips have come in for it. {isQuoteDoc(fo) ? 'The quote’s lines stay as the job material.' : ''}</div>
              <input autoFocus value={forcing.reason} onChange={e => setForcing({ ...forcing, reason: e.target.value })} placeholder="Why? e.g. picked up at counter, no slip"
                onKeyDown={e => { if (e.key === 'Enter') forceReceive(fo, forcing.reason); if (e.key === 'Escape') setForcing(null) }}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={smallBtn} onClick={() => setForcing(null)}>Cancel</button>
                <button style={{ ...smallBtn, borderColor: '#9a6610', color: '#9a6610', fontWeight: 700 }} onClick={() => forceReceive(fo, forcing.reason)}>Close it (received)</button>
              </div>
            </div>
          </ModalOverlay>
        )
      })()}
      {quotePick && (() => {
        const k = normPoKey(quotePick)
        const docs = orders.filter(x => (x.kind || 'order') === 'order' && k && normPoKey(x.poNumber) === k)
        return (
          <ModalOverlay onClose={() => setQuotePick(null)} maxWidth={560}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No quote for PO {quotePick}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 10 }}>Which of these is the wholesaler's quote (what was ordered)? The rest are checked against it. If the quote is in Orders &amp; POs instead, add PO {quotePick} to it there.</div>
              {docs.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{d.orderDate || ''} · <b>{d.wholesaler || 'Slip'}</b>{d.invoiceNumber ? ` #${d.invoiceNumber}` : ''} · {(d.lineItems || []).length} lines · {money(orderTotal(d))}{isQuoteDoc(d) ? ' · 📄 quote' : ''}</span>
                  {d.slipPath && <button style={smallBtn} onClick={() => window.desktop?.openFile?.(d.slipPath)}>Open</button>}
                  {!isQuoteDoc(d) && <button style={{ ...smallBtn, borderColor: '#1a5fa0', color: '#1a5fa0', fontWeight: 700 }} onClick={() => { setDocType(d, 'quote'); setQuotePick(null) }}>📄 This is the quote</button>}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button style={smallBtn} onClick={() => { setSearch(String(quotePick)); setQuotePick(null) }}>Show PO {quotePick} in the list</button>
                <button style={smallBtn} onClick={() => setQuotePick(null)}>Close</button>
              </div>
            </div>
          </ModalOverlay>
        )
      })()}
      <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search everything — supplier, invoice/PO/quote #, job, quote, part # or description (archive included)…"
          style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font)', boxSizing: 'border-box' }} />
      </div>
      {q ? (
        <>
          {sectionTitle('Orders')}
          {/* same purchases as the Overview (slips, email-run quotes/POs, sent orders, Catalog quotes), filtered */}
          <PurchasesOverview layout="orders" q={q} orders={orders} feedRows={feedRows} prevRows={prevRows}
            billingFlag={o => { const r = checkOf(o); return r.status === 'flag' && !isReviewed(o, r) }}
            renderSlip={o => orderRow(o, false)} onUpdateOrder={onUpdateOrder} onOpenParts={openPartDetails} partBusy={linking}
            openIn={(tab, text) => { if (tab === 'orders') setShowDetailed(true); setSubTab(tab); setSearch(String(text || '')) }} />
          {sectionTitle(`Pricing Quotes (${pricingSlips.filter(match).length + feedLive.filter(feedMatch).length})`)}
          {pricingList(pricingSlips.filter(match), feedLive.filter(feedMatch))}
          {sectionTitle(`Archive (${archived.filter(match).length + feedDone.filter(feedMatch).length})`)}
          {archiveList(archived.filter(match), feedDone.filter(feedMatch))}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setSubTab('overview')} style={laborTabBtnStyleM(subTab === 'overview')} title="Every purchase by stage — what needs you at the top">🧭 Overview</button>
            <button onClick={() => setSubTab('orders')} style={laborTabBtnStyleM(subTab === 'orders')} title="Everything being bought: with a PO, waiting for one, or without one">📑 Orders</button>
            <button onClick={() => setSubTab('pricing')} style={laborTabBtnStyleM(subTab === 'pricing')} title="Quotes tagged Quote for Pricing — prices checked against the Catalog, never ordered">💲 Quotes for Pricing{toCheckCount ? ` (${toCheckCount} to check)` : ''}</button>
            <button onClick={() => setSubTab('received')} style={laborTabBtnStyleM(subTab === 'received')}>📥 Received{recvNoDate ? ` (${recvNoDate} ⚠)` : ''}</button>
            <button onClick={() => setSubTab('archive')} style={laborTabBtnStyleM(subTab === 'archive')}>🗄 Archive ({archived.length + feedDone.length})</button>
          </div>
          {subTab === 'overview' && (
            <PurchasesOverview q={q} orders={orders} feedRows={feedRows} prevRows={prevRows}
              billingFlag={o => { const r = checkOf(o); return r.status === 'flag' && !isReviewed(o, r) }}
              renderSlip={o => orderRow(o, false)} onUpdateOrder={onUpdateOrder} onOpenParts={openPartDetails} partBusy={linking}
              openIn={(tab, text) => { setSubTab(tab); setSearch(String(text || '')) }} />
          )}
          {(subTab === 'orders' || subTab === 'pricing') && <DuplicateSlips orders={orders} onUpdateOrder={onUpdateOrder} onDeleteOrder={onDeleteOrder} />}
          {subTab === 'pricing' && <div style={{ padding: '7px 16px', fontSize: 12, color: 'var(--text-mid)', background: '#f3f7fc', borderBottom: '1px solid var(--border)' }}>
            Only quotes tagged <b>Quote for Pricing</b>: prices are checked against the Catalog (and compared to the quote they're tagged to). <b>→ Order</b> moves one back to Orders.
          </div>}
          {subTab === 'orders' && (
            <PurchasesOverview layout="orders" q={q} orders={orders} feedRows={feedRows} prevRows={prevRows}
              billingFlag={o => { const r = checkOf(o); return r.status === 'flag' && !isReviewed(o, r) }}
              renderSlip={o => orderRow(o, false)} onUpdateOrder={onUpdateOrder} onOpenParts={openPartDetails} partBusy={linking}
              openIn={(tab, text) => { if (tab === 'orders') setShowDetailed(true); setSubTab(tab); setSearch(String(text || '')) }} />
          )}
          {subTab === 'orders' && (
            <div style={{ padding: '0 12px 10px' }}>
              <button onClick={() => setShowDetailed(v => !v)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>
                {showDetailed ? '▾ Hide the detailed list' : '▸ Detailed list (filing, Mark received, balancing, older POs)'}
              </button>
            </div>
          )}
          {subTab === 'orders' && showDetailed && billingBanner()}
          {subTab === 'orders' && showDetailed && sortToggle}
          {subTab === 'orders' && showDetailed && (() => {
            const rowsAll = purchaseRows || feedRows || []
            const feedQ = r => !q || hit([r.supplier, r.contact, r.quoteNumber, r.poNumber, r.description, r.job, r.note, r.ref, r.refLabel, r.date, ...Object.values(r.quoteLines || {}).flat().map(l => `${l.partNo || ''} ${l.desc || l.name || ''}`)], q)
            const waitFeed = rowsAll.filter(r => !r.archived && feedPoState(r) === 'waiting' && feedQ(r))
            const noneFeed = rowsAll.filter(r => !r.archived && feedPoState(r) === 'none' && r.status !== 'Closed' && feedQ(r))
            const waitSlips = matOrders.filter(o => noPoState(o) === 'waiting' && match(o))
            const noneSlips = matOrders.filter(o => noPoState(o) === 'none' && match(o))
            const withPoCount = rowsAll.filter(r => feedPoState(r) === 'po' && !['Received', 'Closed'].includes(r.status) && feedQ(r)).length + looseSlips.filter(match).length + savedQuotePurchases.length
            const slipBlock = (list, empty) => list.length
              ? <div style={{ margin: '4px 10px 8px', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>{slipList(list, () => false)}</div>
              : (empty ? <div style={{ padding: '6px 16px 10px', fontSize: 12, color: 'var(--text-light)' }}>{empty}</div> : null)
            return (
              <>
                <OrderSection id="po" title="📑 Orders with PO" count={withPoCount} hint="Ordered — PO issued. Slips, balancing, jobs and the timesheet happen here." sec={orderSecs} setSec={setOrderSecs} tone="#e8f0fa">
                  {purchasesView}
                </OrderSection>
                <OrderSection id="waiting" title="⏳ Orders waiting for PO" count={waitFeed.length + waitSlips.length} hint="Quotes in for material we're buying. The PO from Jonathan's email (or + PO #) moves it up to Orders with PO." sec={orderSecs} setSec={setOrderSecs} tone="#fff6e0">
                  <OrdersList embedded listOnly query={q} rowFilter={r => !r.archived && feedPoState(r) === 'waiting'} renderExtra={purchaseSlips} emptyText="" />
                  {slipBlock(waitSlips, !waitFeed.length ? 'Nothing waiting for a PO.' : '')}
                </OrderSection>
                <OrderSection id="none" title="📂 Orders without PO" count={noneFeed.length + noneSlips.length} hint="Picked up, on jobs, or older than 30 days with no PO — add the PO when you find it." sec={orderSecs} setSec={setOrderSecs} tone="#f1f1ef">
                  <OrdersList embedded listOnly query={q} rowFilter={r => !r.archived && feedPoState(r) === 'none' && r.status !== 'Closed'} renderExtra={purchaseSlips} emptyText="" />
                  {slipBlock(noneSlips, !noneFeed.length ? 'None.' : '')}
                </OrderSection>
              </>
            )
          })()}
          {subTab === 'pricing' && pricingList(pricingSlips, feedLive)}
          {subTab === 'pricing' && <OlderQuotes rows={[...(feedRows || []).filter(r => !r.archived), ...(prevRows || [])]} quotes={quotes} jobRecords={jobRecords} q={q} />}
          {subTab === 'received' && <ReceivedTab orders={orders} onUpdateOrder={onUpdateOrder} renderRow={o => orderRow(o, false, true)} />}
          {subTab === 'archive' && sortToggle}
          {subTab === 'archive' && archiveList(archived, feedDone)}
        </>
      )}
    </div>
  )
}

// ── Slip title bar (collapsed view) ──
function SlipTitleBar({ o, open, onToggle, onNote, onSetPo, onSetKind }) {
  const { flagOf } = useFlags()
  const flagged = flagOf('slip:' + o.id)
  const [note, setNote] = useState(o.note || '')
  useEffect(() => { setNote(o.note || '') }, [o.note])
  const save = () => { if ((note || '').trim() !== (o.note || '').trim()) onNote(note.trim()) }
  const lines = o.lineItems || []
  const rec = lines.filter(li => li.received || li.movedTo).length
  const full = lines.length > 0 && rec === lines.length
  const total = lines.filter(li => !li.movedTo).reduce((a, li) => a + (Number(li.totalPrice) || (Number(li.qty) || 0) * (Number(li.cost) || 0)), 0)
  const dot = o.recordOnly ? '#999' : full ? '#1e7a34' : rec ? '#1a5fa0' : '#e0a716'
  const po = String(o.poNumber || '').replace(/^po\s*#?\s*/i, '')
  return (
    <div onClick={onToggle} title={open ? 'Click to close' : 'Click to open'}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: open ? '#fdf8ea' : 'var(--surface)', fontSize: 12.5, boxShadow: flagged ? 'inset 4px 0 0 #c0392b' : 'none' }}>
      <span style={{ fontSize: 11, color: 'var(--text-light)', width: 10 }}>{open ? '▾' : '▸'}</span>
      <FlagButton refId={'slip:' + o.id} info={{ kind: 'slip', title: `${o.wholesaler || 'Slip'}${o.invoiceNumber ? ' #' + o.invoiceNumber : ''}${isQuoteDoc(o) ? ' (quote)' : ''}`, sub: [po ? 'PO ' + po : 'no PO', o.orderDate].filter(Boolean).join(' · '), q: o.invoiceNumber || po, date: o.orderDate, archived: isArchived(o) }} />
      <span title={full ? 'Received' : rec ? `${rec} of ${lines.length} received` : 'Not received'} style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ width: 82, flexShrink: 0, color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums' }}>{o.orderDate || '—'}</span>
      <span style={{ flex: '0 1 260px', minWidth: 120, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {o.wholesaler || '—'}{isQuoteDoc(o) ? <span style={{ fontSize: 10, fontWeight: 800, color: '#1a5fa0', marginLeft: 6 }}>📄 QUOTE</span> : null}
        <span style={{ fontWeight: 400, color: 'var(--text-light)', fontSize: 11 }}>{o.invoiceNumber ? ` · #${o.invoiceNumber}` : ''}</span>
      </span>
      {po || !onSetPo
        ? <span style={{ width: 92, flexShrink: 0, color: po ? 'var(--text)' : 'var(--text-light)' }}>{po ? `PO ${po}` : 'no PO'}</span>
        : <PoBox onSave={onSetPo} />}
      {onSetKind && !po && (slipKind(o) === 'pricing'
        ? <button onClick={e => { e.stopPropagation(); onSetKind('order') }} title="Not just pricing — it's material being ordered (waits for a PO)" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>→ Order</button>
        : noPoState(o) === 'waiting' && <button onClick={e => { e.stopPropagation(); onSetKind('pricing') }} title="Tag as Quote for Pricing — prices only, never ordered" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>💲 Pricing</button>)}
      {flagged && flagged.note ? <span title={flagged.note} style={{ flex: 1, minWidth: 120, color: '#a12a1e', fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚑ {flagged.note}</span> : <input value={note} onChange={e => setNote(e.target.value)} onClick={e => e.stopPropagation()} onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } if (e.key === 'Escape') { setNote(o.note || ''); e.currentTarget.blur() } }}
        placeholder="Quick note…"
        style={{ flex: 1, minWidth: 120, fontSize: 12, border: '1px solid transparent', borderBottomColor: 'var(--border)', background: note ? '#fffbe6' : 'transparent', borderRadius: 4, padding: '3px 6px', fontFamily: 'var(--font)' }} />}
      <span style={{ width: 84, flexShrink: 0, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total ? money(total) : ''}</span>
    </div>
  )
}

// Same slip saved more than once: an exact copy (same invoice #, same lines)
// → delete the extra (it goes to Trash); photos of separate pages of one
// slip (same invoice #, different lines) → merge into one slip.
const normInv = v => String(v || '').toLowerCase().replace(/[^0-9a-z]/g, '')
const firstWord = v => String(v || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || ''
const lineSig = o => (o.lineItems || []).map(li => `${normInv(li.partNo || li.name).slice(0, 14)}x${Number(li.qty) || 0}`).sort().join('|')
const slipUsed = o => !!o.receivedAt || (o.jobs || []).length > 0 || (o.lineItems || []).some(li => li.received || (li.usedBy && Object.keys(li.usedBy).length))
export function findDuplicateSlips(orders) {
  const groups = new Map()
  ;(orders || []).forEach(o => {
    const inv = normInv(o.invoiceNumber)
    if (inv.length < 4) return
    const k = firstWord(o.wholesaler) + ':' + inv
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  })
  const out = []
  groups.forEach(list => {
    if (list.length < 2) return
    // keep: has a PO, then used on jobs / received, then the oldest saved
    const rank = o => (hasPoNumber(o) ? 4 : 0) + (slipUsed(o) ? 2 : 0) + (isArchived(o) ? 0 : 1)
    const sorted = list.slice().sort((a, b) => rank(b) - rank(a) || String(a.createdAt || a.orderDate || '').localeCompare(String(b.createdAt || b.orderDate || '')))
    const keep = sorted[0]
    const copies = sorted.slice(1).filter(o => lineSig(o) === lineSig(keep))
    // pages: only when no page is on a job yet (merging moves lines around)
    const onJobs = o => (o.jobs || []).length > 0 || (o.lineItems || []).some(li => li.usedBy && Object.keys(li.usedBy).length)
    const pages = sorted.slice(1).filter(o => lineSig(o) !== lineSig(keep) && !onJobs(o) && hasPoNumber(o) === hasPoNumber(keep))
    if (copies.length) out.push({ type: 'copy', keep, others: copies })
    if (pages.length && !onJobs(keep)) out.push({ type: 'pages', keep, others: pages })
  })
  return out
}
function DuplicateSlips({ orders, onUpdateOrder, onDeleteOrder }) {
  const [open, setOpen] = useState(false)
  const groups = findDuplicateSlips(orders)
  if (!groups.length) return null
  const label = o => {
    const jobs = (o.jobs || []).map(j => j.name).filter(Boolean)
    return `${o.orderDate || ''} · ${o.wholesaler || 'Slip'} #${o.invoiceNumber || ''}${hasPoNumber(o) ? ' · PO ' + String(o.poNumber).replace(/^po\s*#?\s*/i, '') : ' · no PO'} · ${(o.lineItems || []).length} line${(o.lineItems || []).length === 1 ? '' : 's'}${jobs.length ? ' · jobs: ' + jobs.join(', ') : ''}${isArchived(o) ? ' · archived' : ''}`
  }
  const fix = g => {
    if (g.type === 'copy') {
      if (!window.confirm(`Delete ${g.others.length} extra cop${g.others.length === 1 ? 'y' : 'ies'} of ${g.keep.wholesaler} #${g.keep.invoiceNumber}? They go to Trash; the one ${slipUsed(g.keep) ? 'on your jobs' : 'kept'} stays.`)) return
      g.others.forEach(o => onDeleteOrder(o.id))
    } else {
      if (!window.confirm(`Merge ${g.others.length + 1} pages of ${g.keep.wholesaler} #${g.keep.invoiceNumber} into one slip (${[g.keep, ...g.others].reduce((a, o) => a + (o.lineItems || []).length, 0)} lines)? The extra page records go to Trash; their photos stay attached.`)) return
      const extraFiles = [...(g.keep.extraFiles || []), ...g.others.flatMap(o => [o.slipPath, ...(o.extraFiles || [])]).filter(Boolean)]
      const lineItems = [...(g.keep.lineItems || []), ...g.others.flatMap(o => o.lineItems || [])]
      const poNumber = g.keep.poNumber || (g.others.find(hasPoNumber) || {}).poNumber || ''
      onUpdateOrder(g.keep.id, { lineItems, extraFiles, ...(poNumber && !hasPoNumber(g.keep) ? { poNumber } : {}), mergedPagesAt: new Date().toISOString() })
      g.others.forEach(o => onDeleteOrder(o.id))
    }
  }
  return (
    <div style={{ margin: '8px 16px 0', border: '1px solid #e0a716', borderRadius: 6, background: '#fffaf0' }}>
      <div onClick={() => setOpen(v => !v)} style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: '#8a5d00' }}>
        {open ? '▾' : '▸'} 🧹 {groups.length} slip{groups.length === 1 ? '' : 's'} saved more than once — {groups.filter(g => g.type === 'copy').length} exact cop{groups.filter(g => g.type === 'copy').length === 1 ? 'y' : 'ies'}, {groups.filter(g => g.type === 'pages').length} split into pages
      </div>
      {open && groups.map((g, i) => (
        <div key={i} style={{ padding: '7px 12px', borderTop: '1px solid #f0e2b8', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#9a6610', background: '#fff3d6', borderRadius: 20, padding: '2px 8px' }}>{g.type === 'copy' ? 'SAME SLIP TWICE' : 'PAGES OF ONE SLIP'}</span>
            <b style={{ flex: 1 }}>{g.keep.wholesaler} #{g.keep.invoiceNumber}</b>
            <button onClick={() => fix(g)} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>
              {g.type === 'copy' ? `Delete the extra${g.others.length === 1 ? '' : 's'}` : `Merge ${g.others.length + 1} pages`}
            </button>
          </div>
          <div style={{ marginTop: 3, color: '#1e7a34' }}>{g.type === 'copy' ? 'Keep: ' : 'Into: '}{label(g.keep)}</div>
          {g.others.map(o => <div key={o.id} style={{ color: g.type === 'copy' ? '#a12a1e' : 'var(--text-mid)' }}>{g.type === 'copy' ? 'Delete: ' : 'Page: '}{label(o)}</div>)}
        </div>
      ))}
    </div>
  )
}

// Quotes from the email run with no PO that aren't tagged for pricing —
// closed, or archived by the run (Previous). Tag one "Quote for Pricing for
// <quote / project>" and it joins the pricing list, ready to flip to an
// order (+ PO #) if the job comes back.
function OlderQuotes({ rows, quotes = [], jobRecords = [], q = '' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const list = (rows || []).filter(r => !String(r.poNumber || '').trim() && feedPoState(r) !== 'pricing'
      && (r.archived || r.status === 'Closed' || (r.age != null && r.age > 30)) && !['Ordered', 'Received'].includes(r.status))
    .filter(r => !q || hit([r.supplier, r.quoteNumber, r.poNumber, r.description, r.job, r.note, r.ref, r.date, ...Object.values(r.quoteLines || {}).flat().map(l => `${l.partNo || ''} ${l.desc || l.name || ''}`)], q))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const opts = [
    ...quotes.filter(x => !x.trashedAt).map(x => ({ v: 'q:' + (x.quoteNumber || x.title), ref: x.quoteNumber || x.title || '', label: `Quote ${x.quoteNumber || ''} — ${x.title || ''}`.trim() })),
    ...jobRecords.filter(j => !j.trashedAt).map(j => ({ v: 'j:' + j.id, ref: j.name || '', label: `Project — ${j.name || ''}` })),
  ].sort((a, b) => a.label.localeCompare(b.label))
  const tag = async (r, v) => {
    const o = opts.find(x => x.v === v)
    setBusy(r.id)
    await setFeedPricingFor(r.id, o ? { ref: o.ref, refLabel: o.label } : {})
    setBusy('')
  }
  const money = v => '$' + (Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div style={{ margin: '12px 12px 16px', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 14px', background: 'var(--surface-2)', cursor: 'pointer' }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{open || q ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: 15, fontWeight: 800 }}>🗂 Older quotes, not tagged ({list.length})</span>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Closed or archived quotes with no PO. Tag one as a pricing quote for a quote / project to keep it handy.</span>
      </div>
      {(open || q) && (list.length ? list.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--border)', fontSize: 12.5, flexWrap: 'wrap', opacity: busy === r.id ? 0.5 : 1 }}>
          <span style={{ width: 82, color: 'var(--text-light)' }}>{r.date || '—'}</span>
          <b style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.supplier || '—'}</b>
          <span style={{ width: 120 }}>{r.quoteNumber ? <a href="#" onClick={e => { e.preventDefault(); openQuotePdf(String(r.quoteNumber).split(/[,;]/)[0].trim()) }} style={{ color: 'var(--blue, #2563eb)' }}>Quote {r.quoteNumber}</a> : 'no quote #'}</span>
          <span style={{ flex: 1, minWidth: 140, color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[r.description, r.job, r.note].filter(Boolean).join(' — ')}>{r.description || ''}{r.job ? <span style={{ color: 'var(--text-light)' }}> — {r.job}</span> : null}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-light)' }}>{r.archived ? 'archived' : r.status}</span>
          <b style={{ width: 84, textAlign: 'right' }}>{Number(r.quoteTotal) ? money(r.quoteTotal) : ''}</b>
          <select value="" disabled={!!busy} onChange={e => e.target.value && tag(r, e.target.value)}
            style={{ fontSize: 11.5, padding: '3px 5px', border: '1px solid #1a5fa0', borderRadius: 5, color: '#1a5fa0', fontWeight: 700, maxWidth: 230 }}>
            <option value="">💲 Pricing quote for…</option>
            <option value="none">(no quote / project — just keep it)</option>
            {opts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
      )) : <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--text-light)', borderTop: '1px solid var(--border)' }}>{q ? 'No older quotes match.' : 'None — every older quote is tagged or has a PO.'}</div>)}
    </div>
  )
}

// ── Overview: every purchase in one stage, what needs you on top ──
const TONE = { bad: ['#fdecea', '#a12a1e'], warn: ['#fff3d6', '#8a5d00'], fix: ['#e8f2fc', '#1a5fa0'], info: ['#f0efec', '#555'] }
function PurchasesOverview({ layout = 'overview', q, orders, feedRows, prevRows, billingFlag, renderSlip, onUpdateOrder, openIn, onOpenParts, partBusy = {} }) {
  const [groupOpen, setGroupOpen] = useLocalStore('materials_orders_groups', {})
  // Push to this week's timesheet export (its slips, or the PO itself when it has none)
  const [exportExtra, setExportExtra] = useLocalStore(EXPORT_EXTRA_KEY, [])
  const wk = exportWeekKey()
  const onExport = p => p.liveSlips.length ? p.liveSlips.some(o => o.exportWeek === wk) : (exportExtra || []).some(x => x.feedId === (p.rows[0] || {}).id && x.week === wk)
  const pushExport = (p, on) => {
    if (p.liveSlips.length) {
      p.liveSlips.forEach(o => onUpdateOrder(o.id, on
        ? { exportWeek: wk, receivedAt: o.receivedAt || new Date().toISOString(), sentAt: undefined, sentManually: undefined, sentWithWeek: undefined, timesheetSkipWeeks: (o.timesheetSkipWeeks || []).filter(w => w !== wk) }
        : { exportWeek: undefined }))
      return
    }
    const r = p.rows[0]; if (!r) return
    setExportExtra(list => on
      ? [...(list || []).filter(x => !(x.feedId === r.id && x.week === wk)), { id: 'x:' + r.id + ':' + wk, feedId: r.id, week: wk, receivedAt: new Date().toISOString(), wholesaler: r.supplier || '', invoiceNumber: p.quotes[0] || '', poNumber: p.po || '', invoiceTotal: Number(p.total) || 0, jobs: p.forWhat ? [{ name: p.forWhat }] : [], timesheetNote: '' }]
      : (list || []).filter(x => !(x.feedId === r.id && x.week === wk)))
  }
  const [quoteMsg, setQuoteMsg] = useState(null) // { key, number, text, url }
  const [closing, setClosing] = useState(null) // { key, reason } while the close box is open
  // Ask the email run to find this purchase's PDF in email and file it
  const [finding, setFinding] = useState({}) // key → 'busy' | message
  const findInEmail = async p => {
    if (!window.desktop?.assistantFindPdf) { setFinding(f => ({ ...f, [p.key]: 'Needs the latest desktop app.' })); return }
    setFinding(f => ({ ...f, [p.key]: 'busy' }))
    const r = await window.desktop.assistantFindPdf({ po: p.po, quotes: p.quotes, invoices: p.invoices, supplier: p.supplier })
    const msg = r && r.ok ? '✓ Asked — the email run is searching. The PDF lands in Quote Slips (or Material Slips) in a few minutes; click the quote # again then.'
      : r?.error === 'no-token' ? 'Set up "Update me now" in Assistant Update first (it uses the same connection).'
      : r?.error === 'rate-limit' ? 'Too many runs right now — try again in a bit.'
      : r?.error === 'bad-token' ? 'The Assistant Update token was refused — paste a new one in Assistant Update.'
      : r?.error === 'offline' ? "Couldn't reach Claude — check the internet."
      : `Couldn't start the search (${r?.message || r?.error || 'unknown'}).`
    setFinding(f => ({ ...f, [p.key]: msg }))
  }
  // Open a quote PDF from Quote Slips; if it isn't there, say so and offer the email or picking the PDF
  const openQuote = async (key, row, number) => {
    setQuoteMsg(null)
    if (!window.desktop?.ordersOpenQuoteFile) return
    const r = await window.desktop.ordersOpenQuoteFile(number)
    if (r && r.ok) return
    const link = (row.quoteLinks || []).find(l => l && String(l.number).trim() === String(number).trim()) || (row.quoteLinks || [])[0]
    setQuoteMsg({ key, number, url: link && link.url,
      text: r?.reason === 'open-failed' ? `Found ${number} but Windows couldn't open it (${r.error}).`
        : r?.reason === 'no-folder' ? 'Choose the Field App folder first (Orders tab).'
        : `Quote ${number} isn't saved in Quote Slips yet.` })
  }
  const attachQuote = async number => {
    if (!window.desktop?.ordersAttachQuoteFile) return
    const r = await window.desktop.ordersAttachQuoteFile(number)
    if (r && r.ok) { setQuoteMsg(null); window.desktop.ordersOpenQuoteFile(number); window.dispatchEvent(new Event('orders-slips-changed')) }
    else if (r && r.reason !== 'canceled') setQuoteMsg(m => m && { ...m, text: `Couldn't add that PDF (${r.error || r.reason}).` })
  }
  const linkBtn = { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', whiteSpace: 'nowrap' }
  const [marks, setMarks] = useLocalStore('purchase_marks', {})
  const [secOpen, setSecOpen] = useLocalStore('materials_overview_sections', { waiting: true, ordered: true, received: true, sent: true, pricing: false, closed: false })
  const [stageOnly, setStageOnly] = useState('')
  const [openKey, setOpenKey] = useState('')
  const [requests, setRequests] = useLocalStore(REQUESTS_KEY, [])
  const [matching, setMatching] = useState('')
  const reqList = Array.isArray(requests) ? requests : []
  const updReq = (id, patch) => setRequests(l => (Array.isArray(l) ? l : []).map(r => r.id === id ? { ...r, ...patch } : r))
  const takenFeed = new Set(reqList.filter(r => r.matchedFeedId && !r.removedAt).map(r => r.matchedFeedId))
  const matchReq = async (req, row) => {
    updReq(req.id, { matchedFeedId: row.id, matchedAt: new Date().toISOString() })
    setMatching('')
    if (req.pricing && feedPoState(row) !== 'pricing') await setFeedPricing(row.id, true)
  }
  const all = buildPurchases({ slips: orders, feed: feedRows || [], previous: prevRows || [], marks: marks || {}, billingFlag, requests: reqList })
  const shown = all.filter(p => !q || hit(purchaseSearchText(p), q))
  const by = id => shown.filter(p => p.stage === id).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const attention = shown.filter(p => p.flags.length).sort((a, b) => STAGES.findIndex(s => s.id === a.stage) - STAGES.findIndex(s => s.id === b.stage))
  const money = v => Number(v) ? '$' + Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
  const setMark = (key, m) => setMarks(x => { const n = { ...(x || {}) }; if (m) n[key] = m; else delete n[key]; return n })
  const fix = (p, f) => {
    if (f.fix && f.fix.kind === 'applyPo') f.fix.ids.forEach(id => onUpdateOrder(id, { poNumber: f.fix.po }))
  }
  const chip = f => { const [bg, fg] = TONE[f.tone] || TONE.info; return <span key={f.id} style={{ fontSize: 10.5, fontWeight: 700, background: bg, color: fg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>{f.text}</span> }
  const stageOf = id => STAGES.find(s => s.id === id)

  const tile = (p, showStage) => {
    const open = openKey === p.key
    return (
      <div key={p.key} style={{ border: '1px solid ' + (open ? '#9fb8d6' : 'var(--border)'), borderRadius: 6, background: 'var(--surface)', overflow: 'hidden' }}>
        <div onClick={() => setOpenKey(open ? '' : p.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', cursor: 'pointer', background: open ? '#eef4fb' : 'var(--surface)', fontSize: 12.5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
          {showStage && <span title={stageOf(p.stage).hint} style={{ fontSize: 10.5, fontWeight: 700, color: '#1a5fa0', width: 104 }}>{stageOf(p.stage).icon} {stageOf(p.stage).label}</span>}
          <span style={{ width: 84, flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--text-light)', fontVariantNumeric: 'tabular-nums' }}>{p.date || '—'}</span>
          <b style={{ width: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.supplier || '—'}</b>
          <span style={{ width: 82, fontWeight: 700, color: p.po ? 'var(--navy)' : 'var(--text-light)' }}>{p.po ? 'PO ' + p.po : 'no PO'}</span>
          <span style={{ flex: 1, minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }} title={p.forWhat}>
            {p.forWhat || (p.quotes[0] ? 'Quote ' + p.quotes.join(', ') : p.invoices.join(', ')) || '—'}
          </span>
          {p.flags.map(chip)}
          <b style={{ width: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(p.total)}</b>
        </div>
        {open && (
          <div style={{ borderTop: '1px solid var(--border)', background: '#fbfcfe' }}>
            <div style={{ padding: '7px 12px', fontSize: 12, color: 'var(--text-mid)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span><b>Why it's {stageOf(p.stage).label}:</b> {p.why}</span>
              {p.invoices.length > 0 && <span style={{ color: 'var(--text-light)' }}>· Slip {p.liveSlips.filter(o => !isQuoteDoc(o) && o.invoiceNumber).map((o, i) => (
                <span key={o.id}>{i > 0 && ', '}{o.slipPath && window.desktop?.openFile
                  ? <a href="#" onClick={e => { e.preventDefault(); window.desktop.openFile(o.slipPath) }} style={{ color: 'var(--blue, #2563eb)', fontWeight: 700 }}>{o.invoiceNumber}</a>
                  : o.invoiceNumber}</span>))}</span>}
              <span style={{ flex: 1 }} />
              {p.flags.filter(f => f.fix).map(f => <button key={f.id} onClick={() => fix(p, f)} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none', background: '#1a5fa0', color: '#fff', cursor: 'pointer' }}>Fix: {f.text.replace('Slip missing', 'put')} on the slip</button>)}
              {p.stage !== 'pricing' && (p.po || p.quotes.length) && (!p.liveSlips.length || (quoteMsg && quoteMsg.key === p.key)) && (
                <button disabled={finding[p.key] === 'busy'} onClick={() => findInEmail(p)} title={`Search your email for ${p.po ? 'PO ' + p.po : 'quote ' + p.quotes.join(', ')} and save the PDF`}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid #1a5fa0', background: 'var(--surface)', color: '#1a5fa0', cursor: 'pointer', opacity: finding[p.key] === 'busy' ? 0.6 : 1 }}>
                  {finding[p.key] === 'busy' ? 'Starting…' : '🔍 Search email for the PDF'}
                </button>)}
              {['received', 'sent', 'closed'].includes(p.stage) && !p.oldRecord && (onExport(p)
                ? <button onClick={() => pushExport(p, false)} title="Take it back off this week's timesheet export" style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid #1e7a34', background: 'var(--surface)', color: '#1e7a34', cursor: 'pointer' }}>✓ On this week's export ✕</button>
                : <button onClick={() => pushExport(p, true)} title="Put it on this week's timesheet (Received material) — editable there" style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>📤 Push to export</button>)}
              {p.stage !== 'closed' && p.stage !== 'pricing' && (closing && closing.key === p.key
                ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                    <input autoFocus value={closing.reason} onChange={e => setClosing({ ...closing, reason: e.target.value })} placeholder="Why? e.g. picked up, no slip"
                      onKeyDown={e => { if (e.key === 'Enter') { setMark(p.key, { closed: true, reason: closing.reason.trim(), at: new Date().toISOString() }); setClosing(null) } if (e.key === 'Escape') setClosing(null) }}
                      style={{ fontSize: 12, width: 220, border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px' }} />
                    <button onClick={() => { setMark(p.key, { closed: true, reason: closing.reason.trim(), at: new Date().toISOString() }); setClosing(null) }} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>Close</button>
                    <button onClick={() => setClosing(null)} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Cancel</button>
                  </span>
                : <button onClick={() => setClosing({ key: p.key, reason: '' })} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Close it…</button>)}
              {p.mark && p.mark.closed && <button onClick={() => setMark(p.key, null)} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>↺ Reopen</button>}
            </div>
            {finding[p.key] && finding[p.key] !== 'busy' && <div style={{ padding: '0 12px 6px', fontSize: 12, color: finding[p.key].startsWith('✓') ? '#1e7a34' : '#a12a1e' }}>{finding[p.key]}</div>}
            {p.notes.length > 0 && <div style={{ padding: '0 12px 6px', fontSize: 12, color: '#7a5a00' }}>📝 {p.notes.join(' · ')}</div>}
            {(p.requests || []).map(rq => {
              const matched = rq.matchedFeedId && p.rows.some(r => r.id === rq.matchedFeedId)
              const cands = matched ? [] : quoteCandidates(rq, feedRows || [], takenFeed)
              const best = cands.find(c => c.score > 0)
              const items = rq.items || []
              return (
                <div key={rq.id} style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{rq.fromCatalog ? '📒' : '📨'}</span>
                    <span style={{ flex: 1, minWidth: 200 }}>
                      {rq.fromCatalog
                        ? <><b>Quote from our Catalog</b>{rq.wholesaler ? <> · buying from {rq.wholesaler}</> : null} · {String(rq.sentAt || '').slice(0, 10)} · {items.length} item{items.length === 1 ? '' : 's'} · <b>{money(catalogQuoteTotal(rq))}</b></>
                        : <><b>{rq.pricing ? 'Pricing list' : 'Order'} {rq.phoned ? 'phoned in' : 'sent'}</b> to {rq.wholesaler || 'PDF only'} · {String(rq.sentAt || '').slice(0, 10)} · {items.length} item{items.length === 1 ? '' : 's'}</>}
                      {rq.file && window.desktop?.openFile && <> · <a href="#" onClick={e => { e.preventDefault(); window.desktop.openFile(rq.file) }} style={{ color: 'var(--blue, #2563eb)', fontWeight: 700 }}>order form</a></>}
                      {matched && <span style={{ color: '#1e7a34', fontWeight: 700 }}> · ✓ matched to this quote</span>}
                    </span>
                    {rq.fromCatalog && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text-light)' }}>PO</span>
                      <input defaultValue={rq.poNumber || ''} placeholder="add when you have it" key={rq.poNumber || ''}
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (rq.poNumber || '')) updReq(rq.id, { poNumber: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        style={{ fontSize: 12, width: 130, border: '1px solid ' + (rq.poNumber ? '#1e7a34' : '#e0a716'), borderRadius: 5, padding: '3px 7px' }} />
                    </span>}
                    {!matched && !rq.fromCatalog && <button onClick={() => setMatching(matching === rq.id ? '' : rq.id)} style={{ ...linkBtn, borderColor: '#1a5fa0', color: '#1a5fa0' }}>🔗 Match the quote…</button>}
                    {!matched && !rq.fromCatalog && <button onClick={() => updReq(rq.id, { pricing: !rq.pricing })} title={rq.pricing ? 'It is material being bought' : 'Prices only — never ordered'} style={linkBtn}>{rq.pricing ? '→ Order' : '💲 Move to Pricing'}</button>}
                    {matched && <button onClick={() => updReq(rq.id, { matchedFeedId: null, matchedAt: null })} style={linkBtn}>Unmatch</button>}
                    {!matched && <button onClick={() => updReq(rq.id, { removedAt: new Date().toISOString() })} title="Not sent, or not needed any more" style={linkBtn}>Remove</button>}
                  </div>
                  {!matched && !rq.fromCatalog && best && matching !== rq.id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '4px 8px', background: '#eef4fb', borderRadius: 5, flexWrap: 'wrap' }}>
                      <span style={{ flex: 1 }}>Looks like <b>{best.r.supplier} quote {best.r.quoteNumber}</b> ({best.r.date}{best.overlap ? `, ${best.overlap} matching part${best.overlap === 1 ? '' : 's'}` : ''}){best.r.quoteTotal ? ' · ' + money(best.r.quoteTotal) : ''}</span>
                      <button onClick={() => matchReq(rq, best.r)} style={{ ...linkBtn, background: '#1a5fa0', color: '#fff', borderColor: '#1a5fa0' }}>Match it</button>
                    </div>
                  )}
                  {matching === rq.id && (
                    <div style={{ marginTop: 4, border: '1px solid var(--border)', borderRadius: 5, maxHeight: 220, overflow: 'auto', background: 'var(--surface)' }}>
                      {cands.length ? cands.slice(0, 15).map(c => (
                        <div key={c.r.id} onClick={() => matchReq(rq, c.r)} style={{ display: 'flex', gap: 8, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ width: 80, color: 'var(--text-light)' }}>{c.r.date}</span>
                          <b style={{ width: 90 }}>{c.r.supplier}</b>
                          <span style={{ flex: 1 }}>Quote {c.r.quoteNumber}{c.r.description ? ' — ' + c.r.description : ''}</span>
                          {c.overlap > 0 && <span style={{ color: '#1e7a34', fontWeight: 700 }}>{c.overlap} part{c.overlap === 1 ? '' : 's'} match</span>}
                          <span style={{ width: 80, textAlign: 'right' }}>{money(c.r.quoteTotal)}</span>
                        </div>
                      )) : <div style={{ padding: 8, color: 'var(--text-light)' }}>No quotes from the email run since this went out. When it comes in (the morning run picks it up), match it here.</div>}
                    </div>
                  )}
                  {items.length > 0 && <div style={{ marginTop: 3, color: 'var(--text-light)' }}>{items.slice(0, 6).map(i => `${i.qty || ''} ${i.uom || ''} ${i.partNo || i.desc}${rq.fromCatalog ? ' @ ' + (Number(i.price) ? money(Number(i.price)) : 'no price') : ''}`.trim()).join(' · ')}{items.length > 6 ? ` · +${items.length - 6} more` : ''}</div>}
                </div>
              )
            })}
            {p.rows.map(r => {
              const nums = (Array.isArray(r.quoteLinks) && r.quoteLinks.length ? r.quoteLinks.map(l => l && l.number) : String(r.quoteNumber || '').split(/[,;]+/))
                .map(n => String(n || '').trim()).filter(n => n && !/^order\s/i.test(n))
              const parts = r._prev ? [] : orderParts(r).filter(pt => pt.number && !/^order/i.test(pt.number))
              return (
                <div key={r.id} style={{ padding: '5px 12px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>📑</span>
                    <span style={{ flex: 1, minWidth: 200 }}>{r.supplier} · {nums.length ? <>Quote {nums.map((n, i) => (
                      <span key={n}>{i > 0 && ', '}<a href="#" onClick={e => { e.preventDefault(); openQuote(p.key, r, n) }} title="Open the quote PDF"
                        style={{ color: 'var(--blue, #2563eb)', fontWeight: 700, textDecoration: 'underline' }}>{n}</a></span>))}</> : (r.quoteNumber || '—')}
                      {r.poNumber ? ' · PO ' + r.poNumber : ''} · {r._prev ? 'archived by the email run' : r.status}
                      {r.description ? <span style={{ color: 'var(--text-light)' }}> — {r.description}</span> : null}</span>
                    {parts.map(pt => {
                      const opened = orders.some(o => o.feedKey === pt.key)
                      return (
                        <button key={pt.key} disabled={partBusy[pt.key] === 'busy'} onClick={() => opened ? openIn('orders', pt.number) : onOpenParts && onOpenParts(pt)}
                          title={opened ? 'Its lines are already open as a quote — go to it' : "Read this quote's PDF and open its lines, so each line can go to a job"}
                          style={{ ...linkBtn, borderColor: '#1a5fa0', color: '#1a5fa0' }}>
                          {partBusy[pt.key] === 'busy' ? 'Reading…' : `📄 Parsed details${parts.length > 1 ? ' — ' + pt.number : ''}${opened ? ' →' : ''}`}
                        </button>
                      )
                    })}
                    {!r._prev && <button onClick={() => openIn(p.stage === 'pricing' ? 'pricing' : 'orders', r.poNumber || nums[0] || '')} style={linkBtn}>Open in list →</button>}
                  </div>
                  {parts.map(pt => partBusy[pt.key] && partBusy[pt.key] !== 'busy' ? <div key={pt.key} style={{ fontSize: 11.5, color: '#a12a1e', marginTop: 3 }}>{partBusy[pt.key]}</div> : null)}
                  {quoteMsg && quoteMsg.key === p.key && nums.includes(quoteMsg.number) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '5px 8px', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 5, fontSize: 11.5, color: '#7a5a00', flexWrap: 'wrap' }}>
                      <span style={{ flex: 1 }}>{quoteMsg.text}</span>
                      {quoteMsg.url && window.desktop?.openExternal && <button style={linkBtn} onClick={() => window.desktop.openExternal(quoteMsg.url)}>Open the email</button>}
                      <button style={{ ...linkBtn, borderColor: '#1a5fa0', color: '#1a5fa0' }} onClick={() => findInEmail(p)}>🔍 Search email for it</button>
                      <button style={linkBtn} onClick={() => attachQuote(quoteMsg.number)}>Pick the PDF…</button>
                      <button style={linkBtn} onClick={() => setQuoteMsg(null)}>✕</button>
                    </div>
                  )}
                </div>
              )
            })}
            {p.slips.length > 0 && <div style={{ borderTop: '1px solid var(--border)' }}>{p.slips.map(o => <div key={o.id}>{renderSlip(o)}</div>)}</div>}
          </div>
        )}
      </div>
    )
  }

  if (layout === 'orders') {
    const GROUPS = [
      { id: 'requested', title: '📨 Sent — waiting for quote', hint: 'Orders and pricing lists you sent — match the quote when it comes back, or move it to Pricing', test: p => p.stage === 'requested' },
      { id: 'ordered', title: '📦 Ordered Material', hint: 'PO issued — not yet picked up, or in and not sent to Jonathan', test: p => p.po && ['ordered', 'received', 'sent'].includes(p.stage) },
      { id: 'waiting', title: '⏳ Waiting on PO', hint: 'Quotes for material being bought', test: p => p.stage === 'waiting' },
      { id: 'complete', title: '✓ Complete Orders', hint: 'Sent, every line on a job or Stock', test: p => p.po && p.stage === 'closed' },
      { id: 'nopo', title: '🧾 Non-PO Purchase', hint: 'Picked up or put on jobs with no PO — add it when you find it', test: p => !p.po && !['pricing', 'waiting'].includes(p.stage) },
    ]
    return (
      <div style={{ padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GROUPS.map(g => {
          const L = shown.filter(g.test).sort((a, b) => (b.flags.length ? 1 : 0) - (a.flags.length ? 1 : 0) || String(b.date).localeCompare(String(a.date)))
          const need = L.filter(p => p.flags.length).length
          const open = q ? L.length > 0 : !!(groupOpen || {})[g.id]
          return (
            <div key={g.id} style={{ border: '1px solid ' + (need ? '#e3a49c' : 'var(--border)'), borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
              <div onClick={() => setGroupOpen(x => ({ ...(x || {}), [g.id]: !open }))} title={g.hint}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: open ? 'var(--surface-2)' : 'var(--surface)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
                <span style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 800, flex: 1 }}>{g.title}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-mid)' }}>{L.length} item{L.length === 1 ? '' : 's'}</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, minWidth: 130, textAlign: 'right', color: need ? '#a12a1e' : '#1e7a34' }}>{need ? `⚠ ${need} need${need === 1 ? 's' : ''} attention` : '✓ none need attention'}</span>
              </div>
              {open && <div style={{ padding: 6, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {L.length ? L.map(p => tile(p, g.id === 'ordered')) : <div style={{ padding: 6, fontSize: 12, color: 'var(--text-light)' }}>None.</div>}
              </div>}
            </div>
          )
        })}
      </div>
    )
  }

  const flaggedIn = id => shown.filter(p => p.stage === id && p.flags.length).length
  const list = stageOnly ? by(stageOnly) : null
  return (
    <div style={{ padding: '10px 12px 24px' }}>
      {/* the glance: how many in each stage, how many need you */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 6, marginBottom: 12 }}>
        {STAGES.map(s => {
          const n = by(s.id).length, f = flaggedIn(s.id), on = stageOnly === s.id
          return (
            <button key={s.id} onClick={() => setStageOnly(on ? '' : s.id)} title={s.hint}
              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: on ? '2px solid var(--navy)' : '1px solid var(--border)', background: on ? '#eef4fb' : 'var(--surface)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)' }}>{s.icon} {s.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{n}</span>
                {f > 0 && s.id !== 'closed' && <span style={{ fontSize: 11, fontWeight: 800, color: '#a12a1e' }}>⚠ {f}</span>}
              </div>
            </button>
          )
        })}
      </div>

      {list ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 2px 6px' }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>{stageOf(stageOnly).icon} {stageOf(stageOnly).label} ({list.length})</span>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{stageOf(stageOnly).hint}</span>
            <button onClick={() => setStageOnly('')} style={{ marginLeft: 'auto', fontSize: 11.5, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', padding: '3px 10px', cursor: 'pointer' }}>Show all stages</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{list.map(p => tile(p))}</div>
        </>
      ) : (
        <>
          <div style={{ border: '1px solid ' + (attention.length ? '#e3a49c' : 'var(--border)'), borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', background: attention.length ? '#fdecea' : '#e6f4ea', fontSize: 13.5, fontWeight: 800, color: attention.length ? '#8e1f14' : '#1e7a34' }}>
              {attention.length ? `⚠ Needs you (${attention.length})` : '✓ Nothing needs you right now'}
            </div>
            {attention.length > 0 && <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>{attention.map(p => tile(p, true))}</div>}
          </div>
          {STAGES.map(s => {
            const L = by(s.id)
            const open = q ? L.length > 0 : !!((secOpen || {})[s.id] ?? s.id === 'requested')
            return (
              <div key={s.id} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div onClick={() => setSecOpen(x => ({ ...(x || {}), [s.id]: !open }))} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 12px', background: 'var(--surface-2)', cursor: 'pointer' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{s.icon} {s.label} ({L.length})</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{s.hint}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>{s.id !== 'closed' && L.length ? money(L.reduce((a, p) => a + (Number(p.total) || 0), 0)) : ''}</span>
                </div>
                {open && <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>{L.length ? L.map(p => tile(p)) : <div style={{ padding: 6, fontSize: 12, color: 'var(--text-light)' }}>None.</div>}</div>}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// A collapsible section of Materials → Orders
function OrderSection({ id, title, count, hint, sec, setSec, tone, children }) {
  const open = !!(sec && sec[id])
  return (
    <div style={{ margin: '10px 12px 0', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
      <div onClick={() => setSec(s => ({ ...(s || {}), [id]: !open }))} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 14px', background: tone || 'var(--surface-2)', cursor: 'pointer', borderBottom: open ? '1px solid var(--border)' : 'none' }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title} ({count})</span>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{hint}</span>
      </div>
      {open && children}
    </div>
  )
}

// "+ PO #" — typing a PO turns a pricing quote into an order
function PoBox({ onSave, width = 92 }) {
  const [v, setV] = useState('')
  const [editing, setEditing] = useState(false)
  if (!editing) return (
    <button onClick={e => { e.stopPropagation(); setEditing(true) }} title="Give it a PO — it becomes an order"
      style={{ width, flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '2px 6px', border: '1px dashed #1a5fa0', borderRadius: 12, background: 'none', color: '#1a5fa0', cursor: 'pointer' }}>+ PO #</button>
  )
  const save = () => { const x = v.trim().replace(/^po\s*#?\s*/i, ''); if (x) onSave(x); setEditing(false); setV('') }
  return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)} onClick={e => e.stopPropagation()} placeholder="PO #"
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setV('') } }} onBlur={save}
      style={{ width, flexShrink: 0, boxSizing: 'border-box', fontSize: 12, border: '2px solid #1a5fa0', borderRadius: 4, padding: '2px 6px' }} />
  )
}

// ── Received: every slip with material received, newest first ──
// The timesheet to Jonathan lists a slip once ALL its lines are received —
// dated by when it was received, and carried to later weeks until sent.
// This tab shows each slip's timesheet status so it can be checked.
const tsWeek = d => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x }
function ReceivedTab({ orders, onUpdateOrder, renderRow }) {
  const [open, setOpen] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [q, setQ] = useState('')
  const thisWeek = tsWeek(new Date())
  // every slip with anything received — old ones included
  // (a quote whose packing slips came in isn't listed — its slips are, so nothing shows twice)
  const rows = orders.filter(o => (o.lineItems || []).some(li => li.received) && !(isQuoteDoc(o) && o.replacedAt))
    .map(o => {
      const lines = o.lineItems || []
      const rec = lines.filter(li => li.received || li.movedTo).length
      const full = rec === lines.length
      const date = o.receivedAt || ''
      let status, tone
      if (isQuoteDoc(o) && o.replacedAt) { status = 'Quote — listed through its packing slips'; tone = 'mute' }
      else if (!full) { status = `Partly received (${rec} of ${lines.length}) — goes on the timesheet once every line is received`; tone = 'warn' }
      else if (!date) { status = 'No received date — not on any timesheet'; tone = 'bad' }
      else if (o.sentAt) { status = `Sent to Jonathan ${String(o.sentAt).slice(0, 10)}`; tone = 'ok' }
      else {
        const wk = tsWeek(date)
        status = wk < thisWeek ? `Not sent yet — on this week's timesheet (carried over from week of ${wk.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })})` : `On this week's timesheet — not sent yet`
        tone = 'todo'
      }
      const total = lines.reduce((a, li) => a + (Number(li.totalPrice) || (Number(li.qty) || 0) * (Number(li.cost) || 0)), 0)
      return { o, rec, full, date, status, tone, total, sortKey: date || ('0000' + (o.orderDate || '')) }
    })
    .filter(r => !q.trim() || hit(slipSearchText(r.o), q))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  const noDate = rows.filter(r => r.tone === 'bad')
  const toneStyle = { ok: ['#e6f4ea', '#1e7a34'], todo: ['#e8f2fc', '#1a5fa0'], warn: ['#fff3d6', '#9a6610'], bad: ['#fdecea', '#a12a1e'], mute: ['#f0efec', '#666'] }
  const setDate = (o, d) => onUpdateOrder(o.id, { receivedAt: d ? new Date(d + 'T12:00:00').toISOString() : undefined })
  const toggle = id => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pickedRows = noDate.filter(r => picked.has(r.o.id))
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, verticalAlign: 'middle' }
  const btn = { fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }
  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 8 }}>
        Every slip with material received, newest first. A slip goes on the weekly timesheet to Jonathan once <b>all</b> its lines are received, dated by its received date, and stays on each week's sheet until it's sent.
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search received slips — supplier, invoice, PO, part…"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', marginBottom: 10 }} />
      {noDate.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fdecea', border: '1px solid #e8b4ae', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>
          <b style={{ color: '#a12a1e' }}>⚠ {noDate.length} slip{noDate.length === 1 ? ' is' : 's are'} fully received but ha{noDate.length === 1 ? 's' : 've'} no received date, so {noDate.length === 1 ? 'it is' : 'they are'} not on any timesheet.</b>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={btn} onClick={() => setPicked(new Set(noDate.map(r => r.o.id)))}>Select all {noDate.length}</button>
            <button style={btn} disabled={!pickedRows.length} onClick={() => { pickedRows.forEach(r => setDate(r.o, r.o.orderDate || todayLocal())); setPicked(new Set()) }}>
              Give {pickedRows.length || 'selected'} their slip date
            </button>
            <button style={btn} disabled={!pickedRows.length} onClick={() => { const today = todayLocal(); pickedRows.forEach(r => setDate(r.o, today)); setPicked(new Set()) }}>
              Received today (this week's timesheet)
            </button>
            <button style={btn} disabled={!pickedRows.length} onClick={() => { const at = new Date().toISOString(); pickedRows.forEach(r => onUpdateOrder(r.o.id, { receivedAt: new Date((r.o.orderDate || at.slice(0, 10)) + 'T12:00:00').toISOString(), sentAt: at, sentManually: true })); setPicked(new Set()) }}>
              Already billed — mark sent
            </button>
            <span style={{ color: 'var(--text-light)' }}>Or set a date on each row below.</span>
          </div>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <thead><tr style={{ background: 'var(--surface-2)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-mid)' }}>
          <th style={cell}></th><th style={cell}>Received</th><th style={cell}>Supplier</th><th style={cell}>Invoice / slip</th><th style={cell}>PO</th><th style={cell}>Lines</th><th style={{ ...cell, textAlign: 'right' }}>Total</th><th style={cell}>Timesheet</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const [bg, fg] = toneStyle[r.tone]
            return (
              <React.Fragment key={r.o.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(x => x === r.o.id ? null : r.o.id)}>
                  <td style={cell} onClick={e => e.stopPropagation()}>{r.tone === 'bad' && <input type="checkbox" checked={picked.has(r.o.id)} onChange={() => toggle(r.o.id)} />}</td>
                  <td style={cell} onClick={e => e.stopPropagation()}>
                    <input type="date" value={r.date ? new Date(r.date).toLocaleDateString('en-CA') : ''} onChange={e => setDate(r.o, e.target.value)}
                      title="When it was received — sets which week's timesheet it goes on" style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', background: r.date ? 'var(--surface)' : '#fdecea' }} />
                  </td>
                  <td style={cell}><b>{r.o.wholesaler || '—'}</b>{isQuoteDoc(r.o) ? <span style={{ fontSize: 10, fontWeight: 800, color: '#1a5fa0', marginLeft: 6 }}>📄 QUOTE</span> : null}</td>
                  <td style={cell}>{r.o.invoiceNumber || '—'}<div style={{ fontSize: 10.5, color: 'var(--text-light)' }}>slip {r.o.orderDate || '—'}</div></td>
                  <td style={cell}>{r.o.poNumber || '—'}</td>
                  <td style={cell}>{r.rec}/{(r.o.lineItems || []).length}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{money(r.total)}</td>
                  <td style={cell}><span style={{ fontSize: 11, fontWeight: 700, background: bg, color: fg, borderRadius: 10, padding: '2px 8px', display: 'inline-block' }}>{r.status}</span>
                    {(r.tone === 'ok' || r.tone === 'todo') && (
                      <button onClick={() => onUpdateOrder(r.o.id, r.o.sentAt ? { sentAt: undefined, sentWithWeek: undefined, sentManually: undefined } : { sentAt: new Date().toISOString(), sentManually: true })}
                        title={r.o.sentAt ? 'Mark NOT sent — it goes back on the timesheet export' : 'Mark sent — it comes off the timesheet export'}
                        style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>
                        {r.o.sentAt ? '↺ Not sent' : '✓ Mark sent'}
                      </button>)}</td>
                </tr>
                {open === r.o.id && <tr><td colSpan={8} style={{ padding: 0, borderBottom: '2px solid var(--border)' }}>{renderRow(r.o)}</td></tr>}
              </React.Fragment>
            )
          })}
          {!rows.length && <tr><td colSpan={8} style={{ ...cell, textAlign: 'center', color: 'var(--text-light)', padding: 18 }}>{q ? 'No received slips match.' : 'Nothing received yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// Where slip/quote links on the timesheet PDF point (Jonathan opens them in OneDrive)
function OneDriveLinkSettings() {
  const [info, setInfo] = useState(null)
  const [val, setVal] = useState('')
  useEffect(() => { window.desktop?.onedriveInfo?.().then(i => { setInfo(i); setVal(i?.webBase || '') }) }, [])
  if (!window.desktop?.onedriveInfo) return null
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', marginBottom: 6 }}>OneDrive web address (for links on the timesheet PDF)</div>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="https://yourcompany-my.sharepoint.com/personal/you_company_com/Documents"
        onBlur={async () => { const i = await window.desktop.onedriveSetWebBase(val === info?.detected ? '' : val); setInfo(i); setVal(i.webBase || '') }}
        style={{ ...inputStyle, width: '100%' }} />
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
        {info?.detected ? `Found automatically from OneDrive on this computer${val && val !== info.detected ? ' (you changed it)' : ''}.` : 'Couldn\u2019t find it automatically: paste the address from OneDrive in your browser (up to and including /Documents).'}
        {' '}Slips go into <b>Field App/Material Slips/&lt;week&gt;</b> when you export a timesheet. Share the <b>Material Slips</b> and <b>Quote Slips</b> folders with Jonathan once (Can view) so the links open for him.
      </div>
    </div>
  )
}

const normPoKey = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^po/, '').replace(/^0+/, '')

const laborTabBtnStyleM = active => ({
  flex: 1, padding: '10px 8px', background: 'none', border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  color: active ? 'var(--accent-dim)' : 'var(--text-mid)',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

// ══════════════════════════════════════════════════════════════════
// Materials hub
// ══════════════════════════════════════════════════════════════════
export default function Materials({ screen }) {
  const [catalog, setCatalog] = useLocalStore('material_catalog', [])
  // Latest Catalog, so several receives in a row (bulk close) each build on the last
  const catalogRef = useRef(catalog)
  catalogRef.current = catalog
  const [stock, setStock] = useLocalStore('material_stock', [])
  const [orders, setOrders] = useLocalStore('material_orders', [])
  const [pendingSlips, setPendingSlips] = useLocalStore('materials_pending_slips', [])
  const [pendingUsed, setPendingUsed] = useLocalStore('materials_used_pending', [])
  const [catPendingTab] = useLocalStore(CATALOG_PENDING_KEY, [])
  const [, setTrashBin] = useLocalStore('trash_bin_items', [])
  // Jobs (slip lines → job Materials) and Quotes (pricing quotes → quote compare)
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes', reloadOnFocus: true,
  })
  const quoteList = quotesStore.records.filter(q => !q.trashedAt && !q.invalidated && q.quoteNumber)
    .map(q => ({ id: q.id, quoteNumber: q.quoteNumber, title: q.title || '', customerName: quotesStore.customers.find(c => c.id === q.customerId)?.name || '' }))
  const [compareFor, setCompareFor] = useState(null) // { quoteId, lines, label, orderId?, feedKey? }
  const parts = partsList(catalog, stock)
  const activeJobs = jobsStore.records.filter(j => !j.trashedAt && j.lifecycleStatus !== 'billed')
    .map(j => ({ id: j.id, name: j.name, customerName: jobsStore.customers.find(c => c.id === j.customerId)?.name || '' }))
    .sort((a, b) => (a.customerName + a.name).localeCompare(b.customerName + b.name))
  // Orders & POs quotes already checked against Catalog / compared (by part key)
  const [feedChecked, setFeedChecked] = useLocalStore('materials_feed_quotes_checked', {})

  function addToTrash(type, label, payload) {
    setTrashBin(list => [...list, { id: uid(), type, label, payload, deletedAt: new Date().toISOString() }])
  }
  // Shared between Catalog and Stock so the category structure — headers and
  // sub-headers — is identical in both, even where one has items and the other doesn't.
  const [categoryPaths, setCategoryPaths] = useLocalStore('material_category_paths', [])

  function addCategoryPath(path) {
    setCategoryPaths(list => list.includes(path) ? list : [...list, path])
  }

  // Renaming a category renames it everywhere it's used — the items in both
  // Catalog and Stock that live under it, and the shared path list itself —
  // so the two never drift apart.
  function renameCategoryEverywhere(oldFullPath, newSegmentName) {
    const parentPath = oldFullPath.includes('/') ? oldFullPath.slice(0, oldFullPath.lastIndexOf('/')) : ''
    const newFullPath = parentPath ? `${parentPath}/${newSegmentName}` : newSegmentName
    const rewrite = cat => {
      if (cat === oldFullPath) return newFullPath
      if (cat.startsWith(oldFullPath + '/')) return newFullPath + cat.slice(oldFullPath.length)
      return cat
    }
    setCatalog(list => list.map(i => (i.category || '') ? { ...i, category: rewrite(i.category) } : i))
    setStock(list => list.map(i => (i.category || '') ? { ...i, category: rewrite(i.category) } : i))
    setCategoryPaths(list => list.map(rewrite))
  }

  // Deleting a category never deletes the actual items — they just fall back
  // to Uncategorized. Any sub-categories under it get removed from the shared
  // path list too, in both Catalog and Stock.
  function deleteCategoryEverywhere(fullPath) {
    const matches = cat => cat === fullPath || cat.startsWith(fullPath + '/')
    setCatalog(list => list.map(i => matches(i.category || '') ? { ...i, category: '' } : i))
    setStock(list => list.map(i => matches(i.category || '') ? { ...i, category: '' } : i))
    setCategoryPaths(list => list.filter(p => !matches(p)))
  }
  const [apiKey, setApiKey] = useApiKey()
  const feedRowsMain = useOrdersFeed()
  // The morning email run puts Jonathan's PO on its Orders & POs row. A pricing
  // quote saved here with the same quote # picks that PO up and becomes an order.
  useEffect(() => {
    if (!feedRowsMain || !feedRowsMain.length) return
    const byQuote = new Map()
    feedRowsMain.forEach(r => {
      const po = String(r.poNumber || '').replace(/^po\s*#?\s*/i, '').trim()
      if (!po) return
      String(r.quoteNumber || '').split(/[,;/]|\s+&\s+/).map(numKey).filter(k => k.length >= 4).forEach(k => byQuote.set(k, { po, supplier: r.supplier || '' }))
    })
    if (!byQuote.size) return
    const sameSupplier = (a, b) => { const f = x => String(x || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0]; return !f(a) || !f(b) || f(a) === f(b) }
    orders.forEach(o => {
      if (hasPoNumber(o) || isArchived(o)) return
      const hit = byQuote.get(numKey(o.invoiceNumber))
      if (hit && sameSupplier(hit.supplier, o.wholesaler)) updateOrder(o.id, { poNumber: hit.po, poFrom: 'email' })
    })
  }, [feedRowsMain]) // eslint-disable-line react-hooks/exhaustive-deps
  // Prices saved per KM / per 1000 ft / per 100 → per M / FT / EA
  const unitFixes = findUnitFixes({ orders, catalog, stock, jobs: jobsStore.records, quotes: quotesStore.records })
  const [unitFixOpen, setUnitFixOpen] = useState(false)
  function applyUnitFixes(divide) {
    const f = unitFixes
    const num = v => Number(v) || 0
    const r = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d
    const byOrder = new Map()
    f.orderFixes.forEach(x => { if (!byOrder.has(x.order.id)) byOrder.set(x.order.id, new Map()); byOrder.get(x.order.id).set(x.idx, x) })
    if (byOrder.size) setOrders(list => list.map(o => byOrder.has(o.id) ? { ...o, lineItems: (o.lineItems || []).map((li, i) => byOrder.get(o.id).has(i) ? { ...li, ...byOrder.get(o.id).get(i).n } : li) } : o))
    jobsStore.records.forEach(j => {
      let changed = false
      const next = (j.materialEntries || []).map(e => {
        if (e.slipOrderId && byOrder.has(e.slipOrderId)) {
          for (const [idx, x] of byOrder.get(e.slipOrderId)) {
            if (e.orderKey !== slipLineKey(e.slipOrderId, x.li, idx)) continue
            changed = true
            const scale = num(x.li.qty) ? num(x.n.qty) / num(x.li.qty) : 1
            return { ...e, qty: r(num(e.qty) * scale, 3), uom: x.n.uom, price: x.n.cost }
          }
        }
        const jf = f.jobFixes.find(x => x.job.id === j.id && x.e.id === e.id)
        if (!jf) return e
        changed = true
        const div = divide['j:' + j.id + '/' + e.id]
        return { ...e, uom: jf.to.uom, price: div ? jf.to.price : e.price, ...(div && e.stockUnit != null ? { stockUnit: r(num(e.stockUnit) * jf.to.price / (num(e.price) || 1)) } : {}) }
      })
      if (changed) jobsStore.updateRecord(j.id, { materialEntries: next, actualMaterials: Math.round(next.reduce((a, e) => a + num(e.qty) * num(e.price), 0) * 100) / 100 })
    })
    const fixList = (list, fixes, kind, priceKey) => {
      const m = new Map(fixes.map(x => [x.item.id, x]))
      return list.map(i => {
        const x = m.get(i.id)
        if (!x) return i
        const div = divide[kind + ':' + i.id]
        const per = x.from.price ? x.from.price / (x.to.price || x.from.price) : 1
        return { ...i, uom: x.to.uom, [priceKey]: div ? x.to.price : i[priceKey],
          ...(div && i.priceHistory ? { priceHistory: i.priceHistory.map(h => ({ ...h, cost: r(num(h.cost) / per) })) } : {}) }
      })
    }
    if (f.catFixes.length) setCatalog(list => fixList(list, f.catFixes, 'c', 'refCost'))
    if (f.stockFixes.length) setStock(list => fixList(list, f.stockFixes, 's', 'cost'))
  }
  const [discrepancies, setDiscrepancies] = useState([])
  const [justAdded, setJustAdded] = useState([])
  const startView = screen?.view === 'exportlist' ? 'ordered' : screen?.view
  // plan lines set to 🚚 Order that haven't gone on the sheet or out yet
  const [planList] = useLocalStore('materials_order_list', [])
  const [planReqs] = useLocalStore(REQUESTS_KEY, [])
  const planWaiting = (() => {
    const out = new Set([...(Array.isArray(planList) ? planList : []).flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId)),
      ...(Array.isArray(planReqs) ? planReqs : []).filter(r => !r.removedAt).flatMap(r => (r.items || []).flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId)))])
    return jobsStore.records.filter(j => !j.trashedAt && j.lifecycleStatus !== 'billed').flatMap(j => (j.plannedMaterials || []).filter(l => l.source === 'order' && !out.has(j.id + ':' + l.id))).length
  })()
  const [tab, setTab] = useState(startView === 'stock' ? 'catalog' : (startView || 'used'))
  const startStockOnly = startView === 'stock'
  // opened again from Home / the nav (e.g. Orders & POs) — go to that tab
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    if (startView) setTab(startView === 'stock' ? 'catalog' : startView)
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // One time: slips filed as "pricing / record only" that have a PO are
  // orders. Ones more than 30 days old were records of past pick-ups —
  // they go straight to the Archive (nothing goes into Stock); newer ones
  // join the open orders.
  const [poSplitDone, setPoSplitDone] = useLocalStore('materials_po_split_v1', false)
  useEffect(() => {
    if (poSplitDone) return
    const cutoff = Date.now() - 30 * 86400000
    const at = new Date().toISOString()
    setOrders(list => list.map(o => {
      if (!o.recordOnly || !hasPoNumber(o) || o.kind === 'order') return o
      const old = Date.parse(o.orderDate || o.createdAt || 0) < cutoff
      return old ? { ...o, kind: 'order', archivedAt: o.archivedAt || at, archivedNote: 'Old record-only slip with a PO — moved from Pricing Quotes' }
        : { ...o, kind: 'order', recordOnly: false }
    }))
    setPoSplitDone(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Catalog is the full parts list; Stock is a layer on it. Any stock item
  // with no Catalog twin (received from an order, added before the merge)
  // gets one, and each stock item remembers which Catalog part it is.
  useEffect(() => {
    const rows = pairCatalogStock(catalog, stock)
    const link = rows.filter(r => r.cat).flatMap(r => r.lots.filter(l => l.catalogId !== r.cat.id).map(l => ({ cat: r.cat, stk: l })))
    const orphans = rows.filter(r => !r.cat && r.stk)
    if (!link.length && !orphans.length) return
    const newCat = orphans.map(r => ({
      id: uid(), name: r.stk.name || r.stk.partNo || 'Part', partNo: r.stk.partNo || '', nickname: r.stk.nickname || '',
      uom: r.stk.uom || '', refCost: Number(r.stk.cost) || 0, category: r.stk.category || '', priceHistory: r.stk.priceHistory,
    }))
    const idFor = new Map([...link.map(r => [r.stk.id, r.cat.id]), ...orphans.map((r, i) => [r.stk.id, newCat[i].id])])
    if (newCat.length) setCatalog(list => [...list, ...newCat])
    setStock(list => list.map(x => idFor.has(x.id) ? { ...x, catalogId: idFor.get(x.id) } : x))
  }, [catalog, stock])

  function findStockMatch(list, li) {
    if (li.partNo) {
      const m = list.find(s => s.partNo && s.partNo.toLowerCase() === li.partNo.toLowerCase())
      if (m) return m
    }
    if (li.nickname) {
      const m = list.find(s => s.nickname && s.nickname.toLowerCase() === li.nickname.toLowerCase())
      if (m) return m
    }
    return list.find(s => s.name && li.name && s.name.toLowerCase() === li.name.toLowerCase())
  }

  function slipFileName(parsed) {
    const safe = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
    const date = parsed.orderDate || todayLocal()
    const wholesaler = safe(parsed.wholesaler) || 'Unknown wholesaler'
    const invoice = safe(parsed.invoiceNumber)
    const ext = (parsed.fileName || '').split('.').pop()?.toLowerCase() || 'pdf'
    return `${date} - ${wholesaler}${invoice ? ` - Inv ${invoice}` : ''}.${ext}`
  }

  async function commitOrder(parsed) {
    let slipPath = null
    if (window.desktop && parsed.pdfBase64) {
      try {
        slipPath = await window.desktop.saveFile('Materials/Stock Material Order Slips', slipFileName(parsed), parsed.pdfBase64)
      } catch { /* filing the copy failing shouldn't block the rest of the import */ }
    }

    const order = {
      id: uid(), wholesaler: parsed.wholesaler, invoiceNumber: parsed.invoiceNumber, poNumber: parsed.poNumber, orderDate: parsed.orderDate,
      invoiceTotal: parsed.invoiceTotal, subtotal: parsed.subtotal, tax: parsed.tax, fileName: parsed.fileName, lineItems: parsed.lineItems, slipPath,
      jobs: parsed.jobs || [],
      received: false, recordOnly: !!parsed.recordOnly, createdAt: new Date().toISOString(),
      kind: parsed.kind || (parsed.recordOnly ? 'pricing' : 'order'),
      pricingTarget: parsed.pricingTarget || null, webLink: parsed.webLink || '', source: parsed.source || 'upload',
      docType: parsed.docType || '',
    }
    // One job on the slip: any line not placed yet goes to it
    if (order.kind === 'order' && (order.jobs || []).length === 1) {
      order.lineItems = (order.lineItems || []).map(li => (li.jobIds || []).length ? li : { ...li, jobIds: [order.jobs[0].id] })
    }
    // How much of each line each job has used: a one-job line is all that
    // job's; a line on several jobs starts unused (each job takes what it uses)
    if (order.kind === 'order') order.lineItems = (order.lineItems || []).map(li => ({ ...li, usedBy: initialUse(order, li) }))

    // If this looks like a backorder-fulfillment slip (same wholesaler, same
    // base order number as an existing order), automatically resolve whatever
    // it covers on that original order — so a second slip for the same order
    // clears out the backordered items there instead of leaving them stuck.
    // Goes through receiveOrder so Stock/Catalog actually get updated, not
    // just the received flag.
    const matchKey = `${(order.wholesaler || '').trim().toLowerCase()}::${baseOrderNumber(order.invoiceNumber).toLowerCase()}`
    const priorOrder = orders.find(o =>
      o.id !== order.id && `${(o.wholesaler || '').trim().toLowerCase()}::${baseOrderNumber(o.invoiceNumber).toLowerCase()}` === matchKey
      && (o.lineItems || []).some(li => li.backordered && !li.received)
    )
    let reconciledCount = 0
    if (priorOrder) {
      // The backordered items arrived on THIS release. They're received (and
      // charged to jobs) from this slip only. On the earlier slip, a line that
      // shipped nothing is marked "came on -02" (no Stock, no cost, no job);
      // a partly shipped line keeps the part that did ship.
      const keyOf = li => (li.partNo || li.name || '').trim().toLowerCase()
      const label = String(order.invoiceNumber || '').trim()
      const priorLines = (priorOrder.lineItems || []).map(li => ({ ...li }))
      order.lineItems = (order.lineItems || []).map(nl => {
        const i = priorLines.findIndex(pl => pl.backordered && !pl.received && !pl.movedTo && keyOf(pl) && keyOf(pl) === keyOf(nl))
        if (i < 0) return nl
        const pl = priorLines[i]
        reconciledCount++
        const shippedBefore = pl.shippedQty != null ? Number(pl.shippedQty) || 0 : ((Number(pl.totalPrice) || 0) > 0 && (Number(nl.qty) || 0) < (Number(pl.qty) || 0) ? Number(pl.qty) || 0 : 0)
        priorLines[i] = shippedBefore > 0
          ? { ...pl, backordered: false, backorderFilledBy: label }       // the shipped part stays here
          : { ...pl, backordered: false, movedTo: label, usedBy: {} }       // nothing shipped here — it's all on the new slip
        // the job(s) the backordered line was for carry over to the new line
        const jobs = lineJobsOf(priorOrder, pl)
        return (nl.jobIds || []).length || !jobs.length ? nl : { ...nl, jobIds: jobs, fromRelease: String(priorOrder.invoiceNumber || '') }
      })
      if (reconciledCount > 0) {
        const updated = { ...priorOrder, lineItems: priorLines }
        setOrders(list => list.map(o => o.id === priorOrder.id ? stampFullyReceived(updated, priorLines) : o))
        writeSlipToJobs(updated)
        order.jobs = [...new Map([...(order.jobs || []), ...(priorOrder.jobs || [])].map(j => [j.id, j])).values()]
        order.lineItems = order.lineItems.map(li => li.fromRelease ? { ...li, usedBy: initialUse(order, li) } : li)
      }
    }

    setOrders(list => [...list, order])
    if (order.kind === 'order') writeSlipToJobs(order)
    if (order.kind === 'pricing') {
      // Prices to the Catalog with a price check; then the quote comparison
      pushOrderPricingToCatalog(order)
      if (order.pricingTarget?.type === 'quote') {
        setCompareFor({ quoteId: order.pricingTarget.quoteId, orderId: order.id, label: `${order.wholesaler || 'Slip'}${order.invoiceNumber ? ` #${order.invoiceNumber}` : ''}`, lines: order.lineItems || [] })
      }
    }
    // Orders & POs: the slip for this PO is in — mark that order Received there.
    if (order.poNumber && order.kind === 'order') {
      linkSlipToOrders({ poNumber: order.poNumber, wholesaler: order.wholesaler, invoiceNumber: order.invoiceNumber, materialsOrderId: order.id, balanced: poStatus(order.poNumber, [...orders, order], feedRowsMain).balanced })
    }
    if (reconciledCount > 0) {
      alert(`This is a backorder release of order #${baseOrderNumber(order.invoiceNumber)} — ${reconciledCount} backordered item${reconciledCount === 1 ? '' : 's'} from the earlier slip ${reconciledCount === 1 ? 'is' : 'are'} on this slip now. Receive them here; the earlier slip shows ${reconciledCount === 1 ? 'it' : 'them'} as "came on ${String(order.invoiceNumber || '').trim()}" so nothing is counted twice.`)
    }
    // Stock/Catalog aren't touched here for this NEW order — that only happens
    // once it's marked Received (goods have actually arrived), via receiveOrder below.
  }

  // Slip lines ticked to a job become that job's actual material (Materials →
  // "From slips & orders"). Re-running replaces this slip's lines on each job.
  // A job already closed with slip material not closed out (not used on it,
  // not pushed to Stock) gets a deficiency so it's dealt with; it clears by
  // itself once the material is closed out on the job.
  useEffect(() => {
    if (jobsStore.loading || !orders.length) return
    const closed = j => ['deficiencies', 'unbilled', 'billed'].includes(j.lifecycleStatus)
    jobsStore.records.filter(j => !j.trashedAt && closed(j)).forEach(j => {
      const left = leftoverLinesForJob(orders, j)
      const defs = j.deficiencies || []
      const open = defs.find(d => d.kind === 'material-closeout' && !d.resolved)
      if (left.length && !open) {
        const entry = { id: uid(), kind: 'material-closeout', resolved: false, createdAt: new Date().toISOString(),
          text: `Material not closed out: ${left.length} slip line${left.length === 1 ? '' : 's'} not used on this job or pushed to Stock (${[...new Set(left.map(x => x.order.invoiceNumber || x.order.wholesaler))].join(', ')}). Open the job and close out its material.`,
          prevLifecycle: j.lifecycleStatus }
        jobsStore.updateRecord(j.id, { deficiencies: [...defs, entry], ...(j.lifecycleStatus === 'unbilled' ? { lifecycleStatus: 'deficiencies' } : {}) })
      } else if (!left.length && open) {
        const at = new Date().toISOString()
        const nextDefs = defs.map(d => d === open ? { ...d, resolved: true, resolvedAt: at, resolvedNote: 'Material closed out' } : d)
        const othersOpen = nextDefs.some(d => !d.resolved)
        jobsStore.updateRecord(j.id, { deficiencies: nextDefs, ...(j.lifecycleStatus === 'deficiencies' && open.prevLifecycle === 'unbilled' && !othersOpen ? { lifecycleStatus: 'unbilled' } : {}) })
      }
    })
  }, [orders, jobsStore.loading, jobsStore.records]) // eslint-disable-line react-hooks/exhaustive-deps

  // A job charged from a parsed quote whose packing slips have come in: the
  // slips take over (same qty), so nothing's charged twice and the slip line
  // can be split between the job and Stock.
  const feedForCharges = useOrdersFeed()
  // A quote / slip that came back for an order built from job plans: tag its
  // untagged lines to those jobs (each job's share as it asked)
  const [sentRequests] = useLocalStore(REQUESTS_KEY, [])
  useEffect(() => {
    const next = tagSlipsFromRequests(orders, Array.isArray(sentRequests) ? sentRequests : [], feedForCharges)
    if (next) setOrders(next)
  }, [orders, sentRequests, feedForCharges]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (jobsStore.loading || !orders.length) return
    let acc = orders, changed = false, taken = []
    const total = list => Math.round(list.reduce((a, e) => a + (Number(e.qty) || 1) * (Number(e.price) || 0), 0) * 100) / 100
    jobsStore.records.filter(j => !j.trashedAt).forEach(j => {
      let job = j, any = false
      for (const step of [o => moveQuoteChargesToSlips(o, job, uid), o => moveFeedChargesToSlips(o, job, feedForCharges, uid)]) {
        const r = step(acc)
        if (!r) continue
        acc = r.orders; changed = changed || r.ordersChanged; taken = [...taken, ...r.stockTaken]
        job = { ...job, materialEntries: r.entries }; any = true
      }
      if (any) jobsStore.updateRecord(j.id, { materialEntries: job.materialEntries, actualMaterials: total(job.materialEntries) })
    })
    if (!changed) return
    setOrders(acc)
    if (taken.length) setStock(list => taken.reduce((a, x) => takeFromStock(a, x.li, x.qty), list || []))
  }, [orders, jobsStore.loading, jobsStore.records, feedForCharges]) // eslint-disable-line react-hooks/exhaustive-deps

  function writeSlipToJobs(order) {
    // The rule: a quote is what was ordered (the total), packing slips are what
    // came. Once a slip is in for a quote, only the slips charge jobs — the
    // quote's job lines move over to the slip (see moveQuoteChargesToSlips).
    if (isReplacedQuote(order, orders)) return
    const withEntries = jobsStore.records.filter(j => (j.materialEntries || []).some(e => e.slipOrderId === order.id)).map(j => j.id)
    const jobIds = [...new Set([...jobsOnSlip(order), ...withEntries])]
    const total = list => list.reduce((s2, e) => s2 + (Number(e.qty) || 1) * (Number(e.price) || 0), 0)
    jobIds.forEach(jobId => {
      if (!jobsStore.records.some(j => j.id === jobId)) return
      jobsStore.updateRecord(jobId, cur => {
        const keep = (cur.materialEntries || []).filter(e => e.slipOrderId !== order.id)
        const next = [...keep, ...jobEntriesFromSlip(order, jobId, uid)]
        return { materialEntries: next, actualMaterials: Math.round(total(next) * 100) / 100 }
      })
    })
  }
  // Orders & POs quote → a quote here with its parsed lines, so each line can go
  // to a job like a slip. The quote PDF (Quote Slips) is read the same way as a
  // slip; if it isn't there, the lines the email run read are used. Lines already
  // ticked on a job (Jobs → From Orders & POs) move onto it, so nothing doubles.
  async function linkFeedPart(part) {
    const o = part.order
    let lineItems = null, read = {}
    try {
      if (window.desktop?.ordersListQuoteSlips && apiKey) {
        const list = await window.desktop.ordersListQuoteSlips()
        const k = numKey(part.number)
        const f = list && list.ok && k ? list.files.find(x => String(x.key || '').includes(k)) : null
        if (f) {
          const b64 = await window.desktop.ordersReadQuoteSlip(f.name)
          if (b64) { read = await parseOrderPdf(b64, apiKey); lineItems = read.lineItems || [] }
        }
      }
    } catch (e) { read = { error: e.message } }
    if (!lineItems || !lineItems.length) {
      lineItems = normalizeLines((part.lines || []).map(l => ({ partNo: l.partNo, name: l.desc, uom: String(l.uom || '').toUpperCase(), qty: l.qty, cost: l.qty ? Math.round(l.ext / l.qty * 10000) / 10000 : l.ext, totalPrice: l.ext })))
    }
    if (!lineItems.length) return { error: apiKey ? `Couldn't find quote ${part.number} in Quote Slips${read.error ? ` (${read.error})` : ''} — open the quote link above and pick the PDF, then try again.` : 'Add your Anthropic API key in ⚙ Settings so the quote PDF can be read.' }
    lineItems = lineItems.map(li => ({ id: uid(), ...li }))
    // jobs it's filed to, and lines already ticked on those jobs
    const norm = x => String(x || '').trim().toLowerCase()
    const jobs = jobsStore.records.filter(j => !j.trashedAt && part.refs && part.filedAs === 'job' && part.refs.some(r => norm(r) === norm(j.name)))
    const ticked = jobsStore.records.map(j => ({ j, es: (j.materialEntries || []).filter(e => e.kind === 'order' && !e.slipOrderId && (e.orderKey === part.key || String(e.orderKey || '').startsWith(part.key + '#L'))) })).filter(x => x.es.length)
    const np = x => String(x || '').toLowerCase().replace(/[^0-9a-z]/g, '')
    ticked.forEach(({ j, es }) => es.forEach(e => {
      const whole = e.orderKey === part.key
      lineItems = lineItems.map(li => {
        if (!whole && !(np(li.partNo) && np(li.partNo) === np(e.partNo)) && np(li.name) !== np(e.item)) return li
        const use = { ...(li.usedBy || {}), [j.id]: whole ? Number(li.qty) || 0 : Math.min(Number(e.qty) || 0, Number(li.qty) || 0) }
        return { ...li, jobIds: [...new Set([...(li.jobIds || []), j.id])], usedBy: use }
      })
    }))
    const jobList = [...new Map([...jobs, ...ticked.map(x => x.j)].map(j => [j.id, { id: j.id, name: j.name, customerName: (jobsStore.customers.find(c => c.id === j.customerId) || {}).name || '' }])).values()]
    if (jobList.length === 1 && !ticked.length) lineItems = lineItems.map(li => ({ ...li, jobIds: [jobList[0].id] }))
    const doc = {
      id: uid(), kind: 'order', docType: 'quote', feedKey: part.key, feedId: o.id,
      wholesaler: read.wholesaler || o.supplier || '', invoiceNumber: part.number, poNumber: o.poNumber || '', orderDate: read.orderDate || o.date || '',
      subtotal: read.subtotal || part.total || '', tax: read.tax || '', invoiceTotal: read.invoiceTotal || '',
      lineItems, jobs: jobList, received: false, createdAt: new Date().toISOString(), source: 'orders', fileName: `Quote ${part.number}`,
    }
    doc.lineItems = doc.lineItems.map(li => li.usedBy ? li : { ...li, usedBy: initialUse(doc, li) })
    setOrders(list => [...list, doc])
    // the job's quote ticks become this quote's lines (one place to charge them)
    ticked.forEach(({ j }) => jobsStore.updateRecord(j.id, cur => {
      const next = (cur.materialEntries || []).filter(e => !(e.kind === 'order' && !e.slipOrderId && (e.orderKey === part.key || String(e.orderKey || '').startsWith(part.key + '#L'))))
      return { materialEntries: next, actualMaterials: Math.round(next.reduce((a, e) => a + (Number(e.qty) || 1) * (Number(e.price) || 0), 0) * 100) / 100 }
    }))
    writeSlipToJobs(doc)
    return { id: doc.id }
  }
  // A quote whose packing slips came in: its lines come off the jobs
  function clearSlipFromJobs(order) {
    const total = list => list.reduce((s2, e) => s2 + (Number(e.qty) || 1) * (Number(e.price) || 0), 0)
    jobsStore.records.filter(j => (j.materialEntries || []).some(e => e.slipOrderId === order.id)).forEach(j => {
      jobsStore.updateRecord(j.id, cur => {
        const next = (cur.materialEntries || []).filter(e => e.slipOrderId !== order.id)
        return { materialEntries: next, actualMaterials: Math.round(total(next) * 100) / 100 }
      })
    })
  }
  // Leftovers from a finished job (or anything) → General Stock; received
  // lines are added to the Stock list right away.
  function moveLinesToStock(order, idxs) {
    const idxSet = new Set(idxs)
    const lines = (order.lineItems || []).filter((li, i) => idxSet.has(i))
    // Only what's left of each line goes to Stock; what the jobs used stays theirs
    setOrders(list => list.map(o => o.id === order.id ? { ...o, lineItems: (o.lineItems || []).map((li, i) => idxSet.has(i) ? lineWithRestInStock(o, li) : li) } : o))
    const received = lines.filter(li => li.received).map(li => ({ ...li, qty: lineRemaining(order, li) })).filter(li => li.qty > 0)
    if (received.length) setStock(list => mergeIntoStock(list, order, received, uid))
  }

  // Moves a placed order's line items into Stock, and feeds Catalog — the same
  // logic that used to run at commit time, now gated behind confirming receipt.
  function receiveOrder(order, indices) {
    const flags = []
    const added = []
    const source = order.wholesaler || 'Order'
    const priceDate = order.orderDate || todayLocal()
    const allLineItems = order.lineItems || []
    const idxSet = new Set(indices)
    const lineItems = allLineItems.filter((li, i) => idxSet.has(i))
    if (lineItems.length === 0) return

    // Only lines tagged to Stock alone go into the Stock list. Everything else
    // stays with its job (or waits to be put on one) — leftovers reach Stock
    // when the job is closed out.
    const stockLines = lineItems.filter(li => isStockOnlyLine(order, li) && (Number(li.qty) || 0) > 0)
    if (stockLines.length) setStock(list => mergeIntoStock(list, order, stockLines, uid))

    {
      // Worked out from the current Catalog right here (not inside a state
      // updater) so the price flags below are filled in before they're shown
      let next = catalogRef.current
      // only lines that actually came, with a printed price, feed the Catalog
      lineItems.filter(li => (Number(li.qty) || 0) > 0 && (Number(li.cost) || 0) > 0 && !li.priceFromQuote).forEach(li => {
        const match = findCatalogMatchIn(next, li)
        const historyEntry = { date: priceDate, cost: Number(li.cost) || 0, source }
        if (match && isMerged(match)) {
          // One part, several wholesaler part #s — that supplier's price is
          // updated and the Catalog price re-worked (highest or average)
          const { item, flag } = priceIntoMerged(match, li, source, priceDate)
          const priceHistory = [...(match.priceHistory || []), { ...historyEntry, partNo: li.partNo || '' }].slice(-20)
          next = next.map(c => c.id === match.id ? { ...item, priceHistory } : c)
          if (flag) flags.push({ id: uid(), ...flag, catalogId: match.id })
        } else if (match) {
          const priceHistory = [...(match.priceHistory || []), historyEntry].slice(-20)
          next = next.map(c => c.id === match.id ? { ...c, priceHistory } : c)
          if (match.refCost != null && Number(match.refCost) !== Number(li.cost)) {
            flags.push({ id: uid(), item: li.name, catalogCost: match.refCost, newCost: li.cost, catalogId: match.id })
          }
        } else {
          const newItem = {
            id: uid(), partNo: li.partNo, nickname: li.nickname || '', name: li.name, uom: li.uom,
            refCost: Number(li.cost) || 0, category: '', priceHistory: [historyEntry],
          }
          next = [...next, newItem]
          added.push({ id: newItem.id, name: li.name })
        }
      })
      catalogRef.current = next
      setCatalog(next)
    }

    if (flags.length) setDiscrepancies(d => [...d, ...flags])
    if (added.length) setJustAdded(a => [...a, ...added])
    setOrders(list => list.map(o => o.id === order.id
      ? stampFullyReceived(o, (o.lineItems || []).map((li, i) => idxSet.has(i) ? { ...li, received: true, ...(lineJobsOf(o, li).length || (li.jobIds || []).length ? {} : { jobIds: [GENERAL_STOCK_ID], usedBy: { [GENERAL_STOCK_ID]: Number(li.qty) || 0 } }) } : li))
      : o))
  }

  // For record-only orders — tracks which items have been checked off as
  // received, same as a regular order, but never touches Stock (or Catalog
  // pricing, which has its own dedicated "Push pricing" action already).
  function markReceivedNoStock(order, indices) {
    const idxSet = new Set(indices)
    setOrders(list => list.map(o => o.id === order.id
      ? stampFullyReceived(o, (o.lineItems || []).map((li, i) => idxSet.has(i) ? { ...li, received: true } : li))
      : o))
  }

  // For record-only orders — pushes pricing straight to Catalog with no Stock
  // impact at all, for things you've already got pricing on but no current
  // stock of. Same Catalog logic as receiving an order, just without the
  // Stock half of it.
  function pushOrderPricingToCatalog(order) {
    const flags = []
    const added = []
    const source = order.wholesaler || 'Order'
    const priceDate = order.orderDate || todayLocal()
    const lineItems = order.lineItems || []
    if (lineItems.length === 0) return

    {
      // Worked out from the current Catalog right here (not inside a state
      // updater) so the price flags below are filled in before they're shown
      let next = catalogRef.current
      lineItems.forEach(li => {
        const match = findCatalogMatchIn(next, li)
        const historyEntry = { date: priceDate, cost: Number(li.cost) || 0, source }
        if (match && isMerged(match)) {
          // One part, several wholesaler part #s — that supplier's price is
          // updated and the Catalog price re-worked (highest or average)
          const { item, flag } = priceIntoMerged(match, li, source, priceDate)
          const priceHistory = [...(match.priceHistory || []), { ...historyEntry, partNo: li.partNo || '' }].slice(-20)
          next = next.map(c => c.id === match.id ? { ...item, priceHistory } : c)
          if (flag) flags.push({ id: uid(), ...flag, catalogId: match.id })
        } else if (match) {
          const priceHistory = [...(match.priceHistory || []), historyEntry].slice(-20)
          next = next.map(c => c.id === match.id ? { ...c, priceHistory } : c)
          if (match.refCost != null && Number(match.refCost) !== Number(li.cost)) {
            flags.push({ id: uid(), item: li.name, catalogCost: match.refCost, newCost: li.cost, catalogId: match.id })
          }
        } else {
          const newItem = {
            id: uid(), partNo: li.partNo, nickname: li.nickname || '', name: li.name, uom: li.uom,
            refCost: Number(li.cost) || 0, category: '', priceHistory: [historyEntry],
          }
          next = [...next, newItem]
          added.push({ id: newItem.id, name: li.name })
        }
      })
      catalogRef.current = next
      setCatalog(next)
    }

    if (flags.length) setDiscrepancies(d => [...d, ...flags])
    if (added.length) setJustAdded(a => [...a, ...added])
    setOrders(list => list.map(o => o.id === order.id ? { ...o, pricingPushedAt: new Date().toISOString() } : o))
  }

  function findCatalogMatchIn(list, li) {
    if (li.partNo) {
      const m = list.find(c => hasPartNo(c, li.partNo))
      if (m) return m
    }
    if (li.nickname) {
      const m = list.find(c => c.nickname && c.nickname.toLowerCase() === li.nickname.toLowerCase())
      if (m) return m
    }
    return list.find(c => c.name && li.name && c.name.toLowerCase() === li.name.toLowerCase())
  }

  // A supplier quote/price sheet — checked against Catalog exactly like a
  // stock order, but never touches Stock and has no Received step at all.
  function updateOrder(id, patch) {
    const old = orders.find(o => o.id === id)
    // A pricing quote that gets a PO becomes an order: this quote is what was
    // ordered, and its packing slips are checked against it
    if (old && 'poNumber' in patch && !hasPoNumber(old) && hasPoNumber(patch)) {
      if (slipKind(old) === 'pricing') patch = { ...patch, kind: 'order', recordOnly: false, docType: old.docType || 'quote', convertedToOrderAt: new Date().toISOString() }
      else if (noPoState(old) === 'waiting' && !old.docType) patch = { docType: 'quote', ...patch }
    }
    if (old && patch.lineItems && !('receivedAt' in patch)) {
      const full = patch.lineItems.length > 0 && patch.lineItems.every(li => li.received || li.movedTo)
      if (full && !old.receivedAt) patch = { ...patch, receivedAt: new Date().toISOString() }
    }
    if (!old || slipKind(old) !== 'order' || !(patch.lineItems || patch.jobs)) {
      setOrders(list => list.map(o => o.id === id ? { ...o, ...patch } : o))
      return
    }
    // Job tags changed: keep each line's usage in step (a job taken off a
    // line drops its usage; a line now on just one job that nobody has used
    // goes all to that job), then refresh the jobs' Materials.
    const merged = { ...old, ...patch }
    const keyOf = ids => [...ids].sort().join(',')
    merged.lineItems = (merged.lineItems || []).map((li, i) => {
      const before = old.lineItems?.[i] ? lineJobsOf(old, old.lineItems[i]) : []
      const after = lineJobsOf(merged, li)
      if (keyOf(before) === keyOf(after)) return li
      const use = Object.fromEntries(Object.entries(lineUse(old, old.lineItems?.[i] || li)).filter(([k]) => k === GENERAL_STOCK_ID || after.includes(k)))
      const used = Object.values(use).reduce((a, v) => a + (Number(v) || 0), 0)
      if (after.length === 1 && used === 0) use[after[0]] = Number(li.qty) || 0
      return { ...li, usedBy: use }
    })
    setOrders(list => list.map(o => o.id === id ? merged : o))
    writeSlipToJobs(merged)
  }

  function deleteOrder(id) {
    const order = orders.find(o => o.id === id)
    if (!order) return
    // Soft delete — the slip file stays on disk untouched so a restore still has it
    addToTrash('order', `${order.wholesaler || 'Order'} — ${order.orderDate || ''}`, order)
    setOrders(list => list.filter(o => o.id !== id))
    // Disassociate — the stock those items became stays put, it just no longer references a deleted order
    setStock(list => list.map(s => s.orderId === id ? { ...s, orderId: null } : s))
  }

  function resolveDiscrepancy(id, updateCatalog) {
    const d = discrepancies.find(x => x.id === id)
    if (d && updateCatalog) {
      setCatalog(list => list.map(c => c.id === d.catalogId ? { ...c, refCost: d.newCost } : c))
    }
    setDiscrepancies(list => list.filter(x => x.id !== id))
  }

  // Orders & POs quote (from the morning email run) → Catalog price check,
  // then compare to the quote it's filed under (if it's one of yours).
  function checkFeedPart(part) {
    const lines = feedPartLines(part)
    pushOrderPricingToCatalog({ id: 'feed:' + part.key, wholesaler: part.order.supplier, orderDate: part.order.date, lineItems: lines })
    setFeedChecked(m => ({ ...m, [part.key]: { ...(m[part.key] || {}), catalogAt: new Date().toISOString() } }))
    const q = part.filedAs === 'quote' && quotesStore.records.find(x => String(x.quoteNumber || '').trim().toLowerCase() === String(part.ref || '').trim().toLowerCase())
    if (q) setCompareFor({ quoteId: q.id, feedKey: part.key, label: `${part.order.supplier} quote ${part.number}`, lines })
  }
  const compareQuote = compareFor && quotesStore.records.find(q => q.id === compareFor.quoteId)

  return (
    <div>
      {compareQuote && (
        <QuoteCompare
          lines={compareFor.lines.map(l => ({ partNo: l.partNo, name: l.name, uom: l.uom, qty: l.qty, cost: l.cost }))}
          quote={compareQuote} sourceLabel={compareFor.label}
          onClose={() => setCompareFor(null)}
          onApply={async (fn, stats) => {
            await quotesStore.updateRecord(compareQuote.id, fn)
            const stamp = { quoteComparedAt: new Date().toISOString(), quoteCompare: stats }
            if (compareFor.orderId) updateOrder(compareFor.orderId, stamp)
            if (compareFor.feedKey) setFeedChecked(m => ({ ...m, [compareFor.feedKey]: { ...(m[compareFor.feedKey] || {}), ...stamp } }))
            setCompareFor(null)
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button style={tabBtnStyle(tab === 'used')} onClick={() => setTab('used')}>Material Used{pendingUsed.length ? ` (${pendingUsed.length})` : ''}</button>
        <button style={tabBtnStyle(tab === 'ordered')} onClick={() => setTab('ordered')}>Orders &amp; Slips{pendingSlips.length ? ` (${pendingSlips.length})` : ''}</button>
        <button style={tabBtnStyle(tab === 'catalog')} onClick={() => setTab('catalog')}>Catalog &amp; Stock{catPendingTab.length ? ` (${catPendingTab.length})` : ''}</button>
        <button style={tabBtnStyle(tab === 'orderform')} onClick={() => setTab('orderform')}>Material Order{planWaiting ? ` (${planWaiting} waiting)` : ''}</button>
        <button
          onClick={() => setTab('settings')}
          title="Settings — Anthropic API key for parsing order PDFs"
          style={{
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, marginRight: 10,
            padding: '6px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 700,
            border: tab === 'settings' ? 'none' : '1px solid var(--border)',
            background: tab === 'settings' ? 'var(--accent)' : 'var(--surface-2)',
            color: tab === 'settings' ? 'var(--navy)' : 'var(--text-mid)',
          }}
        >
          ⚙ Settings
        </button>
      </div>
      {unitFixes.count > 0 && (
        <div style={{ background: '#fff8e6', borderBottom: '1px solid #e0a716', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 12, color: '#8a5d00', fontWeight: 700 }}>
            ⚠ {unitFixes.count} price{unitFixes.count === 1 ? '' : 's'} saved per KM / per 1000 ft / per 100 — these throw job and quote costs off.
          </span>
          <button onClick={() => setUnitFixOpen(true)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Review &amp; fix</button>
        </div>
      )}
      {unitFixOpen && <UnitFixModal fixes={unitFixes} onApply={applyUnitFixes} onClose={() => setUnitFixOpen(false)} />}
      {discrepancies.length > 0 && (
        <div style={{ background: '#fff8e6', borderBottom: '1px solid var(--accent)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', marginBottom: 6 }}>
            Price discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} found vs Catalog
          </div>
          {discrepancies.map(d => d.merged ? (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>🔗 {d.item}: {d.supplier || 'supplier'}{d.partNo ? ` (${d.partNo})` : ''} {money(d.catalogCost)} → {money(d.newCost)} · Catalog price now {money(d.refCost)} ({d.rule}){Math.abs((d.prevRef || 0) - (d.refCost || 0)) > 0.005 ? `, was ${money(d.prevRef)}` : ', unchanged'}</span>
              <button onClick={() => resolveDiscrepancy(d.id, false)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer' }}>OK</button>
            </div>
          ) : (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{d.item}: catalog {money(d.catalogCost)} → order {money(d.newCost)}</span>
              <button onClick={() => resolveDiscrepancy(d.id, true)} style={{ fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer' }}>Update catalog</button>
              <button onClick={() => resolveDiscrepancy(d.id, false)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer' }}>Ignore</button>
            </div>
          ))}
        </div>
      )}
      {justAdded.length > 0 && (
        <div style={{ background: '#e8f2fc', borderBottom: '1px solid var(--border)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Added to Catalog automatically</span>
            <button onClick={() => setJustAdded([])} style={{ fontSize: 11, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
          </div>
          {justAdded.map(item => (
            <div key={item.id} style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 2 }}>{item.name}</div>
          ))}
        </div>
      )}
      {tab === 'catalog' && (
        <PartsTab
          catalog={catalog} setCatalog={setCatalog} stock={stock} setStock={setStock} orders={orders}
          categoryPaths={categoryPaths} onAddCategoryPath={addCategoryPath} onRenameCategory={renameCategoryEverywhere} onDeleteCategory={deleteCategoryEverywhere}
          addToTrash={addToTrash} initialStockOnly={startStockOnly}
        />
      )}
      {tab === 'orderform' && <OrderFormTab catalog={catalog} stock={stock} parts={parts} jobs={activeJobs} />}
      {tab === 'used' && <MaterialUsedTab parts={parts} jobs={activeJobs} pending={pendingUsed} setPending={setPendingUsed} stock={stock} setStock={setStock} jobsStore={jobsStore} />}
      {tab === 'ordered' && (
        <OrderedTab
          orders={orders} apiKey={apiKey} onCommitOrder={commitOrder} onUpdateOrder={updateOrder} onDeleteOrder={deleteOrder} onReceiveItems={receiveOrder}
          onMarkReceivedNoStock={markReceivedNoStock}
          onPushPricing={pushOrderPricingToCatalog}
          exportList={[]}
          pendingSlips={pendingSlips} onRemovePendingSlip={id => setPendingSlips(list => list.filter(s => s.id !== id))}
          quotes={quoteList} jobRecords={jobsStore.records} onMoveToStock={moveLinesToStock} onWriteToJobs={writeSlipToJobs} onClearFromJobs={clearSlipFromJobs} onLinkFeedPart={linkFeedPart}
          feedChecked={feedChecked} onCheckFeedPart={checkFeedPart}
          onCompareSlip={o => o.pricingTarget?.type === 'quote' && setCompareFor({ quoteId: o.pricingTarget.quoteId, orderId: o.id, label: o.wholesaler || 'Slip', lines: o.lineItems || [] })}
        />
      )}
      {tab === 'settings' && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', marginBottom: 6 }}>Anthropic API key</div>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..."
            style={{ ...inputStyle, width: '100%' }} />
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
            Saved on this computer only, used to parse uploaded order PDFs. Get a key from console.anthropic.com if you don't have one yet.
          </div>
          <OneDriveLinkSettings />
        </div>
      )}
    </div>
  )
}
