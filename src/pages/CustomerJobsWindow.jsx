import React, { useState, useEffect } from 'react'
import ProposalPill from '../components/ProposalPill.jsx'
import CustomerNotes from '../components/CustomerNotes.jsx'
import { linkedQuotesCustomer, sharedKey, useSharedCustomerLinks } from '../api/sharedCustomer.js'
import { useHubStore } from '../api/useHubStore.js'
import { SectionPage, ProjectBlock, ProjectColumnHeader, effectiveLifecycleStatus, topLevelJobs } from './Jobs.jsx'
import { quoteGrandTotal, QuoteAddRow, nextQuoteNumber, sortByQuoteNumber, EditableField, QuoteDetailPage, ApprovalDot, ApprovalModal, SimpleApprovalConfirm, InvalidateQuoteModal } from './Quotes.jsx'
import { generateQuoteDocxBase64, quoteExportFileName } from '../api/exportQuote.js'
import { todayLocal } from '../api/albertaTime.js'
import { money, fmtDate } from '../api/format.js'

// Blank-last date sort, newest first among the ones that have a date.
function sortByDateDesc(list, key) {
  return [...list].sort((a, b) => {
    const aHas = !!a[key], bHas = !!b[key]
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (!aHas && !bHas) return 0
    return b[key].localeCompare(a[key])
  })
}

// initialProjectId (from Home's Active Jobs list) opens straight onto that
// job, with the customer's main list one Back-press behind it.
function useWindowNav(initialProjectId, initialQuoteId) {
  const [screen, setScreen] = useState(() => initialQuoteId ? { view: 'quoteDetail', quoteId: initialQuoteId }
    : initialProjectId ? { view: 'section', projectId: initialProjectId, section: 'general' } : { view: 'main' })
  const [history, setHistory] = useState(() => (initialProjectId || initialQuoteId) ? [{ view: 'main' }] : [])
  function navigate(next) {
    setHistory(h => [...h, screen])
    setScreen(next)
  }
  function goBack() {
    setHistory(h => {
      if (h.length === 0) { setScreen({ view: 'main' }); return h }
      setScreen(h[h.length - 1])
      return h.slice(0, -1)
    })
  }
  return { screen, navigate, goBack, canGoBack: history.length > 0 }
}

function TopBar({ title, subtitle, onBack, canGoBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'var(--navy)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
      {canGoBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }} aria-label="Back">
          ←
        </button>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.65)', marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
  )
}

// Bottom-right "+" — New Job (auto Time & Material) or New Quote, without
// needing to scroll down and find the right section's own add row.
function FabMenu({ onNewJob, onNewQuote }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(null) // 'job' | 'quote'
  const [name, setName] = useState('')

  function submit() {
    if (!name.trim()) return
    if (mode === 'job') onNewJob(name.trim())
    if (mode === 'quote') onNewQuote(name.trim())
    setName(''); setMode(null); setOpen(false)
  }

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 50 }}>
      {mode && (
        <div style={{ position: 'absolute', bottom: 60, right: 0, width: 260, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            {mode === 'job' ? 'New Job (Time & Material)' : 'New Quote'}
          </div>
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setMode(null); setName('') } }}
            placeholder={mode === 'job' ? 'Job name…' : 'Quote title…'}
            style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font)', boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setMode(null); setName('') }} style={{ flex: 1, padding: 7, background: 'var(--surface-2)', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={submit} style={{ flex: 1, padding: 7, background: 'var(--accent)', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'var(--navy)' }}>
              Create
            </button>
          </div>
        </div>
      )}
      {open && !mode && (
        <div style={{ position: 'absolute', bottom: 60, right: 0, width: 180, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
          <button onClick={() => setMode('job')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            🔧 New Job
          </button>
          <button onClick={() => setMode('quote')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}>
            📋 New Quote
          </button>
        </div>
      )}
      <button
        onClick={() => { if (mode) { setMode(null); setName('') } else setOpen(x => !x) }}
        aria-label="Add"
        style={{
          width: 52, height: 52, borderRadius: '50%', border: 'none', background: 'var(--accent)', color: 'var(--navy)',
          fontSize: 26, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          transform: (open || mode) ? 'rotate(45deg)' : 'none', transition: 'transform .15s',
        }}
      >
        +
      </button>
    </div>
  )
}

// The one standard job-list view, used by every section below — real
// ProjectBlock, click a job to expand it and reach its own General
// Information / Labor / Materials / Quote / Files / Notes, exactly like
// Active Jobs always has. Deficiencies themselves are not shown here — just
// the job name — the full deficiency list lives in its own popup window.
function NeedsReviewSection({ projects, updateProject }) {
  const sorted = sortByDateDesc(projects, 'dateComplete')
  function assign(project, value) {
    const patch = { lifecycleStatus: value, completed: true, dateComplete: project.dateComplete || todayLocal() }
    updateProject(project.id, patch)
  }
  return sorted.map(p => (
    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.name || 'Untitled job'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
          {p.co ? `CO ${p.co} · ` : ''}{p.dateComplete ? `Completed ${fmtDate(p.dateComplete, 'medium')}` : 'No completion date set'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => updateProject(p.id, { lifecycleStatus: 'onGoing', completed: false })} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'var(--surface-2)', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Active
        </button>
        <button onClick={() => assign(p, 'deficiencies')} style={{ fontSize: 11, fontWeight: 700, color: '#9a6610', background: '#fff8e6', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Deficiencies
        </button>
        <button onClick={() => assign(p, 'unbilled')} style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Unbilled
        </button>
        <button onClick={() => assign(p, 'billed')} style={{ fontSize: 11, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Billed
        </button>
      </div>
    </div>
  ))
}

// The job you had open stays open when you come back from one of its
// sections (and the list scrolls back to it) — remembered per customer for as
// long as this window is open.
const lastOpenJob = new Map()
function ProjectListSection({ projects, sortKey, customer, updateProject, deleteProject, navigate, emptyText }) {
  const [expandedProjectId, setExpandedState] = useState(() => lastOpenJob.get(customer.id) || null)
  const setExpandedProjectId = fn => setExpandedState(cur => { const next = typeof fn === 'function' ? fn(cur) : fn; lastOpenJob.set(customer.id, next); return next })
  useEffect(() => {
    const id = lastOpenJob.get(customer.id)
    if (!id) return
    const el = document.querySelector(`[data-job-row="${id}"]`)
    if (el) el.scrollIntoView({ block: 'start' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = sortByDateDesc(topLevelJobs(projects), sortKey)
  if (sorted.length === 0) {
    return <div style={{ padding: '14px 18px', color: 'var(--text-light)', fontSize: 13 }}>{emptyText}</div>
  }
  return (
    <div>
      <ProjectColumnHeader indent={0} />
      {sorted.map(p => (
        <div key={p.id} data-job-row={p.id}>
        <ProjectBlock
          project={p} customer={customer} indent={0}
          expanded={expandedProjectId === p.id}
          onToggle={() => setExpandedProjectId(id => id === p.id ? null : p.id)}
          onUpdate={patch => updateProject(p.id, patch)}
          onDelete={() => deleteProject(p.id)}
          onOpenSection={sectionId => navigate({ view: 'section', projectId: p.id, section: sectionId })}
          onOpenJobSection={(jobId, sectionId) => navigate({ view: 'section', projectId: jobId, section: sectionId })}
          onRequestStatusClick={() => {}}
        />
        </div>
      ))}
    </div>
  )
}

function QuoteRowSimple({ q, customerFolder, onOpen, onUpdateNotes, onUpdateReason, onRequestApprove, onRequestBack, onInvalidate, onDuplicate, onUpdateTitle }) {
  const [invalidating, setInvalidating] = useState(false)
  return (
    <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <ApprovalDot quote={q} onClick={() => onRequestApprove(q)} />
        {!q.approved && q.status === 'yellow' && (
          <button
            onClick={() => onRequestBack(q)}
            title="Back to not sent" aria-label="Back to not sent"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 0, display: 'flex' }}
          >
            <svg width="10" height="10" viewBox="0 0 18 18" fill="none">
              <path d="M11.5 4L6.5 9L11.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-light)', flexShrink: 0 }}>{q.quoteNumber} —</span>
          <div onClick={e => e.stopPropagation()} style={{ flex: 1, minWidth: 0 }}>
            <EditableField
              value={q.title} placeholder="Untitled — click to name" onSave={onUpdateTitle}
              textStyleOverride={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              placeholderStyleOverride={{ fontSize: 13, fontWeight: 700, color: 'var(--text-light)', cursor: 'text' }}
            />
          </div>
        </div>
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 2 }}>
          {q.invalidated ? (
            <EditableField
              value={q.invalidReason} placeholder="Reason for invalidating" onSave={onUpdateReason}
              textStyleOverride={{ fontSize: 12, fontWeight: 500, color: 'var(--red)' }}
              placeholderStyleOverride={{ fontSize: 12, fontWeight: 500, color: 'var(--text-light)' }}
            />
          ) : (
            <EditableField
              value={q.notes} placeholder="Add note" onSave={onUpdateNotes}
              textStyleOverride={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)' }}
              placeholderStyleOverride={{ fontSize: 12, fontWeight: 500, color: 'var(--text-light)' }}
            />
          )}
        </div>
      </div>
      <ProposalPill customerFolder={customerFolder} quote={q} />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap', flexShrink: 0 }}>{money(quoteGrandTotal(q))}</span>
      {onDuplicate && (
        <button
          onClick={e => { e.stopPropagation(); onDuplicate(q) }}
          title="Duplicate this quote as a new one" aria-label="Duplicate quote"
          style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 15, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
        >
          ⧉
        </button>
      )}
      {!q.invalidated && (
        <button
          onClick={e => { e.stopPropagation(); setInvalidating(true) }}
          title="Invalidate quote" aria-label="Invalidate quote"
          style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 15, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
        >
          ⊘
        </button>
      )}
      {invalidating && (
        <div onClick={e => e.stopPropagation()}>
          <InvalidateQuoteModal quote={q} onClose={() => setInvalidating(false)} onConfirm={reason => onInvalidate(reason)} />
        </div>
      )}
    </div>
  )
}

// Same three-way split as the original Quotes page — active, then Approved
// and Invalidated tucked into their own collapsed sub-sections — each sorted
// by quote number exactly the same way (numeric-aware, blank-last).
function QuotesSection({ quotes, customerFolder, onAdd, onOpenQuote, updateQuoteNotes, updateQuoteReason, onRequestApprove, onRequestBack, onInvalidateQuote, onDuplicate, updateQuoteTitle }) {
  const [showApproved, setShowApproved] = useState(false)
  const [showInvalidated, setShowInvalidated] = useState(false)
  const active = sortByQuoteNumber(quotes.filter(q => !q.approved && !q.invalidated))
  const approved = sortByQuoteNumber(quotes.filter(q => q.approved && !q.invalidated))
  const invalidated = sortByQuoteNumber(quotes.filter(q => q.invalidated))

  return (
    <div>
      {active.length === 0 && (
        <div style={{ padding: '14px 18px', color: 'var(--text-light)', fontSize: 13 }}>No active quotes for this customer.</div>
      )}
      {active.map(q => <QuoteRowSimple key={q.id} q={q} customerFolder={customerFolder} onOpen={() => onOpenQuote(q.id)} onUpdateNotes={v => updateQuoteNotes(q.id, v)} onUpdateReason={v => updateQuoteReason(q.id, v)} onRequestApprove={onRequestApprove} onRequestBack={onRequestBack} onInvalidate={reason => onInvalidateQuote(q.id, reason)} onDuplicate={onDuplicate} onUpdateTitle={v => updateQuoteTitle(q.id, v)} />)}
      <QuoteAddRow onAdd={onAdd} indent={0} />

      {approved.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowApproved(x => !x)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 18px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}
          >
            <svg width="9" height="9" viewBox="0 0 18 18" fill="none" style={{ transform: showApproved ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Approved — moved to Jobs ({approved.length})
          </button>
          {showApproved && approved.map(q => <QuoteRowSimple key={q.id} q={q} customerFolder={customerFolder} onOpen={() => onOpenQuote(q.id)} onUpdateNotes={v => updateQuoteNotes(q.id, v)} onUpdateReason={v => updateQuoteReason(q.id, v)} onRequestApprove={onRequestApprove} onRequestBack={onRequestBack} onInvalidate={reason => onInvalidateQuote(q.id, reason)} onDuplicate={onDuplicate} onUpdateTitle={v => updateQuoteTitle(q.id, v)} />)}
        </div>
      )}

      {invalidated.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowInvalidated(x => !x)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 18px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase' }}
          >
            <svg width="9" height="9" viewBox="0 0 18 18" fill="none" style={{ transform: showInvalidated ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Invalidated ({invalidated.length})
          </button>
          {showInvalidated && invalidated.map(q => <QuoteRowSimple key={q.id} q={q} customerFolder={customerFolder} onOpen={() => onOpenQuote(q.id)} onUpdateNotes={v => updateQuoteNotes(q.id, v)} onUpdateReason={v => updateQuoteReason(q.id, v)} onRequestApprove={onRequestApprove} onRequestBack={onRequestBack} onInvalidate={reason => onInvalidateQuote(q.id, reason)} onDuplicate={onDuplicate} onUpdateTitle={v => updateQuoteTitle(q.id, v)} />)}
        </div>
      )}
    </div>
  )
}

// Opened on one field (from the Snapshot's "Worth fixing" list): scroll it
// into view and flash it once the job has loaded.
function useFocusField(focus, ready) {
  const done = React.useRef(false)
  useEffect(() => {
    if (!focus || !ready || done.current) return
    let tries = 0
    const t = setInterval(() => {
      const el = document.querySelector(`[data-fix="${CSS.escape(focus)}"]`)
      if (!el && ++tries < 20) return
      clearInterval(t)
      done.current = true
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.style.transition = 'outline-color 0.6s'
      el.style.outline = '3px solid #e0a716'
      el.style.outlineOffset = '-3px'
      el.style.borderRadius = '6px'
      setTimeout(() => { el.style.outlineColor = 'transparent' }, 4000)
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = '' }, 4700)
    }, 150)
    return () => clearInterval(t)
  }, [focus, ready])
}

export default function CustomerJobsWindow({ customerId, initialProjectId = null, initialQuoteId = null, initialFocus = null }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes', reloadOnFocus: true,
  })
  const { screen, navigate, goBack, canGoBack } = useWindowNav(initialProjectId, initialQuoteId)
  useFocusField(initialFocus, !jobsHub.loading && !quotesHub.loading)
  const [approvalTarget, setApprovalTarget] = useState(null)
  useSharedCustomerLinks(jobsHub, quotesHub) // hook: must stay above the early returns below
  const [activeTab, setActiveTab] = useState('active') // which category pill is open (null = none)

  if (jobsHub.loading || quotesHub.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
  }
  const customer = jobsHub.customers.find(c => c.id === customerId)
  if (!customer) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Customer not found.</div>
  }

  const allProjects = jobsHub.records.filter(p => p.customerId === customerId && !p.trashedAt)
  // Lists and counts: combined sub-jobs ride inside their main job's row
  const listed = topLevelJobs(allProjects)
  const active = listed.filter(p => effectiveLifecycleStatus(p) === 'onGoing')
  const deficient = listed.filter(p => effectiveLifecycleStatus(p) === 'deficiencies')
  const unbilled = listed.filter(p => effectiveLifecycleStatus(p) === 'unbilled')
  const billed = listed.filter(p => effectiveLifecycleStatus(p) === 'billed')
  const needsReview = listed.filter(p => effectiveLifecycleStatus(p) === null)

  // Jobs and Quotes keep separate customer records, tied together by a shared id
  // (name match only as a fallback for records not stamped yet).
  const quotesCustomer = linkedQuotesCustomer(customer, quotesHub.customers)
  const quotes = quotesCustomer ? quotesHub.records.filter(q => q.customerId === quotesCustomer.id && !q.trashedAt) : []

  function updateProject(id, patch) {
    jobsHub.updateRecord(id, patch)
  }
  function deleteProject(id) {
    jobsHub.updateRecord(id, { trashedAt: new Date().toISOString() })
  }
  function addJob(name) {
    jobsHub.addRecord(customerId, { type: 'tm', name })
  }
  async function addQuote({ title, notes }) {
    let qc = quotesCustomer
    if (!qc) {
      qc = await quotesHub.addCustomer({ name: customer.name, nextQuoteNum: 1, sharedId: sharedKey(customer) })
      if (!qc) return
    }
    const { quoteNumber, num } = nextQuoteNumber(qc, quotesHub.records)
    quotesHub.addRecord(qc.id, { quoteNumber, title, notes, approved: false, linkedJobId: null, linkType: null })
    quotesHub.updateCustomer(qc.id, { nextQuoteNum: num + 1 })
  }
  // Copies a quote's content (scopes, lines, adjustments…) into a brand-new,
  // un-approved quote with the next quote number. Fresh ids everywhere so the
  // copy never shares line items with the original.
  async function duplicateQuote(src) {
    let qc = quotesCustomer
    if (!qc) {
      qc = await quotesHub.addCustomer({ name: customer.name, nextQuoteNum: 1, sharedId: sharedKey(customer) })
      if (!qc) return
    }
    const reId = v => Array.isArray(v) ? v.map(reId)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' && typeof x === 'string' ? Math.random().toString(36).slice(2, 10) : reId(x)]))
      : v
    const {
      id, folder, customerFolder, customerId: _cid, quoteNumber: _qn, title, notes: _notes,
      approved, status, linkedJobId, linkType, invalidated, invalidReason, revision, revisionLog, trashedAt, notesLog,
      completeQuote, // the copy gets a fresh Complete Quote draft
      ...content
    } = JSON.parse(JSON.stringify(src))
    const { quoteNumber, num } = nextQuoteNumber(qc, quotesHub.records)
    const copy = await quotesHub.addRecord(qc.id, {
      ...reId(content), quoteNumber, title: `${title || 'Untitled'} (copy)`, notes: '',
      approved: false, linkedJobId: null, linkType: null,
    })
    quotesHub.updateCustomer(qc.id, { nextQuoteNum: num + 1 })
    if (copy) setActiveTab('quotes')
  }
  function updateQuoteTitle(quoteId, title) {
    quotesHub.updateRecord(quoteId, { title: (title || '').trim() })
  }
  function updateQuoteNotes(quoteId, notes) {
    quotesHub.updateRecord(quoteId, { notes })
  }
  function updateQuoteReason(quoteId, invalidReason) {
    quotesHub.updateRecord(quoteId, { invalidReason })
  }
  function invalidateQuote(quoteId, reason) {
    quotesHub.updateRecord(quoteId, { invalidated: true, invalidReason: reason })
  }
  function updateQuote(quoteId, patch) {
    quotesHub.updateRecord(quoteId, patch)
  }
  function handleDotClick(quote) {
    if (quote.approved) {
      setApprovalTarget(quote)
    } else if (quote.status === 'yellow') {
      setApprovalTarget(quote)
    } else {
      updateQuote(quote.id, { status: 'yellow' })
    }
  }

  if (screen.view === 'section') {
    const project = allProjects.find(p => p.id === screen.projectId)
    if (!project) {
      return (
        <div>
          <TopBar title={customer.name} onBack={goBack} canGoBack={canGoBack} />
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)' }}>Job not found.</div>
        </div>
      )
    }
    return (
      <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
        <TopBar title={customer.name} onBack={goBack} canGoBack={canGoBack} />
        <SectionPage customer={customer} project={project} sectionId={screen.section} onUpdateProject={updateProject} navigate={navigate} />
      </div>
    )
  }

  if (screen.view === 'quoteDetail') {
    const quote = quotesHub.records.find(q => q.id === screen.quoteId)
    if (!quote) {
      return (
        <div>
          <TopBar title={customer.name} onBack={goBack} canGoBack={canGoBack} />
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)' }}>Quote not found.</div>
        </div>
      )
    }
    const linkedJob = quote.linkedJobId ? jobsHub.records.find(p => p.id === quote.linkedJobId && !p.trashedAt) : null
    return (
      <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
        <TopBar title={customer.name} onBack={goBack} canGoBack={canGoBack} />
        <QuoteDetailPage
          customer={quotesCustomer || customer}
          quote={quote}
          onUpdate={patch => quotesHub.updateRecord(quote.id, patch)}
          linkedJob={linkedJob}
          onOpenJob={linkedJob ? () => {
            if (linkedJob.customerId === customerId) {
              navigate({ view: 'section', projectId: linkedJob.id, section: 'general' })
            } else if (window.desktop) {
              window.desktop.openCustomerWindow(linkedJob.customerId)
            }
          } : undefined}
          onExport={async () => {
            const base64 = await generateQuoteDocxBase64({ customer: quotesCustomer || customer, quote })
            const fileName = quoteExportFileName({ customer: quotesCustomer || customer, quote })
            if (window.desktop) {
              const savedPath = await window.desktop.saveFile(`Quotes/${(quotesCustomer || customer).folder}/${quote.folder}/Files`, fileName, base64)
              if (savedPath) window.desktop.openFile(savedPath)
            }
          }}
        />
      </div>
    )
  }

  const tabs = [
    ...(needsReview.length > 0 ? [{ id: 'review', label: '⚠ Review', count: needsReview.length, color: '#9a6610', bg: '#fff8e6' }] : []),
    { id: 'active', label: 'Active Jobs', count: active.length, color: '#1a5fa0', bg: '#e8f2fc' },
    { id: 'deficiencies', label: 'Completed w/ Deficiencies', count: deficient.length, color: '#9a6610', bg: '#fff8e6' },
    { id: 'unbilled', label: 'Complete (Unbilled)', count: unbilled.length, color: '#1a5fa0', bg: '#e8f2fc' },
    { id: 'billed', label: 'Complete (Billed)', count: billed.length, color: '#1e7a34', bg: '#e6f4ea' },
    { id: 'quotes', label: 'Quotes', count: quotes.length, color: '#4a5568', bg: '#eef1f4' },
    { id: 'photos', label: 'Photos', color: '#4a5568', bg: '#eef1f4', opensWindow: true },
    { id: 'documents', label: 'Documents', color: '#4a5568', bg: '#eef1f4', opensWindow: true },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <TopBar title={customer.name} subtitle={(() => {
        const addr = [customer.address, customer.city, customer.province, customer.postal].filter(Boolean).join(', ')
        return [customer.contactName, customer.phone, customer.email, addr].filter(Boolean).join('  ·  ')
      })()} onBack={goBack} canGoBack={canGoBack} />

      {/* Category pills — click one to show its list below; clicking another swaps, clicking the open one closes it */}
      <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 5, padding: '10px 14px', overflowX: 'auto', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {tabs.map(t => {
          const on = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => t.opensWindow ? window.desktop && window.desktop.openFilesWindow(customerId, t.id) : setActiveTab(on ? null : t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 20, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                border: `1.5px solid ${t.color}`, background: on ? t.color : t.bg, color: on ? '#fff' : t.color,
              }}
            >
              {t.label}
              {t.count !== undefined && (
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '0 6px', borderRadius: 10, background: on ? 'rgba(255,255,255,.25)' : '#fff', color: on ? '#fff' : t.color }}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div>
        {activeTab === 'review' && needsReview.length > 0 && (
          <>
            <div style={{ padding: '8px 18px', fontSize: 12, color: '#9a6610' }}>
              These were marked complete under the old system, before Unbilled/Billed existed as real choices — pick a status for each directly below, or open the job if you need to check something first.
            </div>
            <NeedsReviewSection projects={needsReview} updateProject={updateProject} />
          </>
        )}
        {activeTab === 'active' && (
          <ProjectListSection projects={active} sortKey="dateStart" customer={customer} updateProject={updateProject} deleteProject={deleteProject} navigate={navigate} emptyText="No active jobs." />
        )}
        {activeTab === 'deficiencies' && (
          <>
            {deficient.length > 0 && (
              <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => window.desktop && window.desktop.openDeficienciesWindow(customerId)}
                  style={{ fontSize: 11, fontWeight: 700, color: '#9a6610', background: 'none', border: '1px solid #9a6610', borderRadius: 20, padding: '4px 10px', cursor: 'pointer' }}
                >
                  View Deficiencies →
                </button>
              </div>
            )}
            <ProjectListSection projects={deficient} sortKey="dateComplete" customer={customer} updateProject={updateProject} deleteProject={deleteProject} navigate={navigate} emptyText="Nothing here." />
          </>
        )}
        {activeTab === 'unbilled' && (
          <ProjectListSection projects={unbilled} sortKey="dateComplete" customer={customer} updateProject={updateProject} deleteProject={deleteProject} navigate={navigate} emptyText="Nothing here." />
        )}
        {activeTab === 'billed' && (
          <ProjectListSection projects={billed} sortKey="dateComplete" customer={customer} updateProject={updateProject} deleteProject={deleteProject} navigate={navigate} emptyText="Nothing here." />
        )}
        {activeTab === 'quotes' && (
          <QuotesSection
            onDuplicate={duplicateQuote} updateQuoteTitle={updateQuoteTitle}
            quotes={quotes} customerFolder={(quotesCustomer || {}).folder} onAdd={addQuote} onOpenQuote={quoteId => navigate({ view: 'quoteDetail', quoteId })}
            updateQuoteNotes={updateQuoteNotes} updateQuoteReason={updateQuoteReason} onInvalidateQuote={invalidateQuote}
            onRequestApprove={handleDotClick} onRequestBack={quote => updateQuote(quote.id, { status: 'red' })}
          />
        )}
        {!activeTab && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Pick a category above.</div>
        )}
      </div>

      <CustomerNotes customer={customer} updateCustomer={patch => jobsHub.updateCustomer(customer.id, patch)} />

      {approvalTarget && !approvalTarget.approved && !(approvalTarget.linkedJobId && jobsHub.records.some(p => p.id === approvalTarget.linkedJobId && !p.trashedAt)) && (
        <ApprovalModal
          quote={approvalTarget}
          quoteCustomerName={quotesCustomer?.name || customer.name}
          quoteCustomer={quotesCustomer || customer}
          jobsStore={jobsHub}
          onClose={() => setApprovalTarget(null)}
          onDone={async (patch) => {
            await updateQuote(approvalTarget.id, patch)
            setApprovalTarget(null)
          }}
        />
      )}
      {approvalTarget && (approvalTarget.approved || (approvalTarget.linkedJobId && jobsHub.records.some(p => p.id === approvalTarget.linkedJobId && !p.trashedAt))) && (
        <SimpleApprovalConfirm
          quote={approvalTarget}
          approving={!approvalTarget.approved}
          linkedJobName={approvalTarget.linkedJobId ? jobsHub.records.find(p => p.id === approvalTarget.linkedJobId)?.name : null}
          onClose={() => setApprovalTarget(null)}
          onConfirm={() => {
            if (approvalTarget.approved) {
              updateQuote(approvalTarget.id, { approved: false, status: 'yellow' })
            } else {
              updateQuote(approvalTarget.id, { approved: true })
            }
            setApprovalTarget(null)
          }}
        />
      )}
      <FabMenu onNewJob={addJob} onNewQuote={title => addQuote({ title, notes: '' })} />
    </div>
  )
}
