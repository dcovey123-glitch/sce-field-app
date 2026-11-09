import React, { useState, useEffect, useCallback } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { FlagButton, FlaggedList } from '../components/Flags.jsx'
import { todayLocal } from '../api/albertaTime.js'
import { fileAssistantNote } from '../api/notes.js'
import { money, fmtDate as fmtDateShared } from '../api/format.js'
import { CALENDAR_KEY, eventFromEmail, hm12 } from '../api/calendar.js'

// ── Morning Review ──
// Claude's morning email run reads your SCE inbox, picks out emails that
// mention one of your jobs or quotes, and drafts a short note for each
// ("Field App/email-notes.json"). Nothing goes into a job or quote until you
// approve it here. Your approve/skip choices are saved next to it in
// "email-notes-app.json" so the run never suggests the same email twice.

const isDesktop = typeof window !== 'undefined' && !!window.desktop
const TASK_PAGE = 'https://claude.ai/scheduled-task/trig_017BJPGVyAXthPiRLTbjX2hp'

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

const fmtDate = d => fmtDateShared(d, 'weekday') || d || ''

const btn = (kind) => ({
  padding: '6px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'primary' ? '1px solid var(--navy)' : '1px solid var(--border)',
  background: kind === 'primary' ? 'var(--navy)' : 'var(--surface)',
  color: kind === 'primary' ? '#fff' : 'var(--text)',
})

export function pendingNotes(feed, local) {
  const decided = (local && local.decisions) || {}
  return ((feed && feed.items) || []).filter(i => i && i.id && !decided[i.id])
}

// Count for the Home badge.
export async function loadReviewCount() {
  if (!isDesktop || !window.desktop.emailNotesLoad) return 0
  try {
    const res = await window.desktop.emailNotesLoad()
    return pendingNotes(res && res.feed, res && res.local).length
  } catch {
    return 0
  }
}

// Find the job or quote a suggestion points at: "job:<id>" / "quote:<id>" /
// "misc" or ''.
function resolveTarget(target, jobs, quotes) {
  if (!target) return ''
  if (target.kind === 'misc') return 'misc'
  if (target.kind === 'quote' && target.quoteNumber) {
    const q = quotes.find(x => norm(x.quoteNumber) === norm(target.quoteNumber))
    if (q) return `quote:${q.id}`
  }
  if (target.kind === 'job' && target.name) {
    const j = jobs.find(x => norm(x.name) === norm(target.name))
    if (j) return `job:${j.id}`
  }
  return ''
}


// Miscellaneous email notes are filed onto Daily Notes, on the day the email
// came in (one assistant section per day, entries in time order).
const ordinal = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'))
function miscDayTitle(day) {
  const [y, m, d] = day.split('-').map(Number)
  const mon = new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short' })
  return `${mon} ${ordinal(d)}${y !== new Date().getFullYear() ? ` ${y}` : ''} - Misc Notes`
}
// The email's arrival time ("3:42 PM"), when the run recorded it.
function emailTime(item) {
  const t = item && (item.time || item.receivedAt || (item.workOrder && item.workOrder.receivedAt))
  const d = t ? new Date(t) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
}
function emailDay(item) {
  const t = item && (item.time || item.receivedAt)
  const d = t ? new Date(t) : null
  if (d && !Number.isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return String((item && item.date) || new Date().toISOString()).slice(0, 10)
}
function dayHeading(day) {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - dt) / 86400000)
  const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return diff === 0 ? `Today · ${label}` : diff === 1 ? `Yesterday · ${label}` : label
}

// Job fields an email suggestion may fill in. Only fields that are still
// empty on the job are ever filled — nothing you typed gets overwritten.
const FIELD_LABELS = { co: 'CO/PO #', jobValue: 'Job value', dateApproved: 'Date approved', dateStart: 'Scheduled to start', dateComplete: 'To be completed by' }
const fieldShown = (k, v) => k === 'jobValue' ? money(v) : v
const isBlank = v => v === undefined || v === null || String(v).trim() === ''

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A copy of a work order request form (read from the email's attachment),
// saved as a PDF in the job's Files.
function workOrderHtml(wo, item, jobName, customerName) {
  const row = (k, v) => v ? `<tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; padding: 34px; color: #1a1a1a; font-size: 13px; }
    h1 { font-size: 19px; margin: 0 0 4px; } .meta { color: #666; font-size: 12px; margin-bottom: 18px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
    th { text-align: left; width: 170px; background: #f2f4f7; padding: 7px 9px; border: 1px solid #ddd; font-size: 12px; }
    td { padding: 7px 9px; border: 1px solid #ddd; }
    .desc { border: 1px solid #ddd; padding: 12px; min-height: 60px; white-space: pre-wrap; line-height: 1.5; }
    .foot { margin-top: 22px; font-size: 10.5px; color: #888; }
  </style></head><body>
    <h1>Work Order Request</h1>
    <div class="meta">${escHtml(customerName || '')}${jobName ? ` · ${escHtml(jobName)}` : ''}</div>
    <table>
      ${row('Requester', wo.requester)}${row('Date', wo.date)}${row('Department', wo.department)}${row('Telephone', wo.phone)}
      ${row('Building', wo.building)}${row('Room / Unit', wo.room)}${row('Urgent', wo.urgent)}${row('Quote required', wo.quoteRequired)}${row('PO #', wo.po)}
    </table>
    <div style="font-weight:bold;margin-bottom:6px">Request</div>
    <div class="desc">${escHtml(wo.description || '')}</div>
    <div class="foot">Copied from “${escHtml(wo.fileName || 'work order')}” attached to ${escHtml(item.from || 'the email')}${item.subject ? ` — “${escHtml(item.subject)}”` : ''}${item.date ? `, ${escHtml(item.date)}` : ''}.</div>
  </body></html>`
}

// Type-to-search box over every job, every quote, and Miscellaneous.
function ProjectPicker({ value, options, onChange, placeholder }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const cur = options.find(o => o.value === value)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = (words.length
    ? options.filter(o => { const hay = `${o.label} ${o.sub || ''}`.toLowerCase(); return words.every(w => hay.includes(w)) })
    : options).slice(0, 40)
  function pick(o) { onChange(o.value); setQ(''); setOpen(false) }
  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 520, minWidth: 260 }}>
      <input
        value={open ? q : (cur ? cur.label : '')}
        placeholder={cur ? cur.label : placeholder}
        onFocus={() => { setOpen(true); setQ(''); setHi(0) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); pick(list[hi]); e.currentTarget.blur() }
          else if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
        }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', fontSize: 13, border: `1px solid ${value ? 'var(--border)' : 'var(--red)'}`, borderRadius: 'var(--rs)', background: 'var(--surface)' }}
      />
      {cur && !open && cur.sub && <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>{cur.sub}</div>}
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 2, maxHeight: 300, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', boxShadow: '0 8px 24px rgba(15,30,46,.18)' }}>
          {list.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--text-light)' }}>No match — try fewer words, or pick Miscellaneous.</div>}
          {list.map((o, i) => (
            <div key={o.value} onMouseDown={e => { e.preventDefault(); pick(o) }} onMouseEnter={() => setHi(i)}
              style={{ padding: '6px 10px', cursor: 'pointer', background: i === hi ? 'var(--blue-bg, #e8f0fe)' : 'transparent', borderBottom: '1px solid var(--border-light, #f1f3f5)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{o.icon} {o.label}</div>
              {o.sub && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{o.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A date the morning run found in this email (site visit, meeting, shutdown,
// delivery…): one click puts it on the Calendar — nothing goes on by itself.
function EmailEventBar({ item, jobId }) {
  const [events, setEvents] = useLocalStore(CALENDAR_KEY, [])
  const ev = item.event
  const added = (events || []).find(e => e.emailId === item.id)
  const when = `${fmtDateShared(ev.date, 'weekday')}${ev.start ? ', ' + hm12(ev.start) : ''}${ev.end ? '–' + hm12(ev.end) : ''}`
  return (
    <div style={{ marginTop: 6, padding: '7px 10px', background: '#eef4fb', border: '1px solid #c9dbef', borderRadius: 'var(--rs)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span>📅 <b>{when}</b> — {ev.title || item.subject}{ev.place ? ` · ${ev.place}` : ''}</span>
      <span style={{ flex: 1 }} />
      {added
        ? <><span style={{ color: '#1e7a34', fontWeight: 700 }}>✓ On the calendar</span>
            <button style={{ ...btn(), padding: '3px 9px' }} onClick={() => setEvents(list => (list || []).filter(e => e.id !== added.id))}>Remove</button></>
        : <button style={{ ...btn('primary'), padding: '4px 11px' }} onClick={() => {
            const e = eventFromEmail(item, uid)
            if (e) setEvents(list => [...(list || []), { ...e, jobId: jobId || '' }])
          }}>+ Add to calendar</button>}
    </div>
  )
}

function NoteCard({ item, jobs, quotes, options, onApprove, onSkip, busy }) {
  const isNewJob = item.target && item.target.kind === 'newJob'
  // A "new job" suggestion whose job already exists (e.g. made by hand) just files into it.
  const firstPick = () => {
    if (isNewJob) {
      const existing = jobs.find(x => norm(x.name) === norm(item.target.name))
      return existing ? `job:${existing.id}` : 'new'
    }
    return resolveTarget(item.target, jobs, quotes)
  }
  const [pick, setPick] = useState(firstPick)
  const [text, setText] = useState(item.note || '')
  const [newName, setNewName] = useState(isNewJob ? (item.target.name || '') : '')
  const fieldKeys = Object.keys(item.fields || {}).filter(k => FIELD_LABELS[k] && !isBlank(item.fields[k]))
  const [useFields, setUseFields] = useState(() => Object.fromEntries(fieldKeys.map(k => [k, true])))
  const [useWO, setUseWO] = useState(!!item.workOrder)
  // Jobs/quotes may finish loading after the card first shows.
  useEffect(() => {
    if (!pick) setPick(firstPick())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length, quotes.length])

  const cardOptions = isNewJob
    ? [{ value: 'new', icon: '➕', label: `New T&M job: ${newName || item.target.name || 'Untitled'}`, sub: item.target.customer || '' }, ...options]
    : options
  const job = pick && pick.startsWith('job:') ? jobs.find(j => `job:${j.id}` === pick) : null
  const isJobTarget = pick === 'new' || !!job
  const fillable = fieldKeys.filter(k => pick === 'new' || (job && isBlank(job[k])))

  const t = item.target
  const suggested = t && t.kind !== 'misc'
    ? (t.kind === 'quote' ? `Quote ${t.quoteNumber || ''}` : `${t.kind === 'newJob' ? 'New job' : 'Job'} ${t.name || ''}`) + (item.targetLabel ? ` · ${item.targetLabel}` : '')
    : ''

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', paddingTop: 7 }}>File under</span>
        <ProjectPicker value={pick} options={cardOptions} onChange={setPick}
          placeholder={suggested ? `Not found: ${suggested} — type to search` : 'Type a job, quote # or customer…'} />
        {item.confidence === 'low' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', paddingTop: 8 }}>check the match</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FlagButton label refId={'email:' + item.id} defaultNote={text} info={{ kind: 'email', title: item.subject || 'Email', sub: [item.from, suggested || (item.target && item.target.kind === 'misc' ? 'Misc' : '')].filter(Boolean).join(' · '), text, date: item.date }} />
        <span>📧 {item.from || 'Unknown sender'}{item.subject ? ` — “${item.subject}”` : ''} · {fmtDate(item.date)}{emailTime(item) ? `, ${emailTime(item)}` : ''}</span>
      </div>
      {pick === 'new' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>Job name</span>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 220, maxWidth: 420, padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>T&amp;M · {item.target.customer}</span>
        </div>
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(6, Math.max(2, Math.ceil((text || '').length / 110)))}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, lineHeight: 1.4, border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontFamily: 'inherit', resize: 'vertical' }} />
      {item.event && <EmailEventBar item={item} jobId={job ? job.id : ''} />}
      {isJobTarget && (fillable.length > 0 || item.workOrder) && (
        <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--rs)', fontSize: 12.5 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-light)', marginBottom: 4 }}>
            Also fill in on the job {pick === 'new' ? '' : '(empty fields only)'}
          </div>
          {fillable.map(k => (
            <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', padding: '2px 0' }}>
              <input type="checkbox" checked={!!useFields[k]} onChange={e => setUseFields(f => ({ ...f, [k]: e.target.checked }))} />
              <span style={{ color: 'var(--text-mid)', minWidth: 130 }}>{FIELD_LABELS[k]}</span>
              <b>{fieldShown(k, item.fields[k])}</b>
            </label>
          ))}
          {item.workOrder && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', padding: '2px 0' }}>
              <input type="checkbox" checked={useWO} onChange={e => setUseWO(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <span style={{ color: 'var(--text-mid)' }}>Work order</span>{' '}
                <b>{[item.workOrder.building, item.workOrder.room && `room ${item.workOrder.room}`].filter(Boolean).join(' ') || 'details'}</b>
                {item.workOrder.urgent && /^y/i.test(item.workOrder.urgent) ? <span style={{ color: 'var(--red)', fontWeight: 800 }}> · URGENT</span> : ''}
                <span style={{ color: 'var(--text-light)' }}> — saved on the job, with a PDF copy in its Files</span>
              </span>
            </label>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button style={{ ...btn('primary'), opacity: pick && text.trim() && !busy && (pick !== 'new' || newName.trim()) ? 1 : 0.5 }}
          disabled={!pick || !text.trim() || busy || (pick === 'new' && !newName.trim())}
          onClick={() => onApprove(item, pick, text.trim(), {
            newName: newName.trim(),
            fields: Object.fromEntries(fillable.filter(k => useFields[k]).map(k => [k, item.fields[k]])),
            workOrder: useWO ? item.workOrder : null,
          })}>{pick === 'new' ? '✓ Approve — create job & add note' : pick === 'misc' ? '✓ Approve — add to Daily Notes' : '✓ Approve — add note'}</button>
        {pick !== 'misc' && (
          <button style={{ ...btn(), opacity: text.trim() && !busy ? 1 : 0.5 }} disabled={!text.trim() || busy} title={`Adds it to Notes → Daily Notes on ${miscDayTitle(emailDay(item)).replace(' - Misc Notes', '')}`}
            onClick={() => onApprove(item, 'misc', text.trim(), {})}>🗂 File on Daily Notes</button>
        )}
        <button style={btn()} disabled={busy} title="Not needed — clears it from the list without saving it anywhere" onClick={() => onSkip(item)}>✕ Dismiss — not needed</button>
      </div>
    </div>
  )
}

export default function MorningReview({ onCountChange , navigate }) {
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [filter, setFilter] = useState('')

  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const jobs = (jobsHub.records || []).filter(p => !p.trashedAt && p.name).sort((a, b) => a.name.localeCompare(b.name))
  const quotes = (quotesHub.records || []).filter(q => !q.trashedAt && q.quoteNumber)
    .sort((a, b) => b.quoteNumber.localeCompare(a.quoteNumber, undefined, { numeric: true }))
  const custName = { job: {}, quote: {} }
  ;(jobsHub.customers || []).forEach(c => { custName.job[c.id] = c.name })
  ;(quotesHub.customers || []).forEach(c => { custName.quote[c.id] = c.name })
  const [, setDailyNotes] = useLocalStore('daily_notes', {})
  const isDone = j => j.closed === true || j.lifecycleStatus === 'billed'
  const options = [
    { value: 'misc', icon: '🗂', label: 'Miscellaneous', sub: 'Notes → Daily Notes, on the day the email came in' },
    ...jobs.slice().sort((a, b) => (isDone(a) - isDone(b)) || a.name.localeCompare(b.name)).map(j => ({
      value: `job:${j.id}`, icon: '🔧', label: j.name,
      sub: ['Job', custName.job[j.customerId], j.co && `CO/PO ${j.co}`, isDone(j) && 'closed'].filter(Boolean).join(' · '),
    })),
    ...quotes.map(q => ({
      value: `quote:${q.id}`, icon: '📄', label: `${q.quoteNumber}${q.title ? ` — ${q.title}` : ''}`,
      sub: ['Quote', custName.quote[q.customerId], q.approved && 'approved', q.invalidated && 'void'].filter(Boolean).join(' · '),
    })),
  ]

  const load = useCallback(async () => {
    if (!isDesktop || !window.desktop.emailNotesLoad) { setState({ loading: false, error: 'not-desktop' }); return }
    try {
      const res = await window.desktop.emailNotesLoad()
      setState({ loading: false, ...res })
    } catch (err) {
      setState({ loading: false, error: 'bad-feed', detail: err.message })
    }
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  // ── "Update me now": start the email run on demand, then watch for its result ──
  const canRunNow = isDesktop && !!window.desktop.assistantUpdateNow
  const [run, setRun] = useState({ phase: 'idle' }) // idle | starting | running | done | error

  // Opens the "SCE email daily catch" page (click Run now there), then
  // watches for the new results. If an API key is ever saved, it starts the
  // run directly instead and falls back to the page if that fails.
  function openTaskPage() {
    window.desktop.openExternal(TASK_PAGE)
    setRun({ phase: 'running', startedAt: new Date().toISOString(), manual: true })
  }
  async function updateNow() {
    if (!canRunNow) { load(); return }
    const status = await window.desktop.assistantStatus()
    if (!status.hasToken) { openTaskPage(); return }
    setRun({ phase: 'starting' })
    const res = await window.desktop.assistantUpdateNow()
    if (res.ok) { setRun({ phase: 'running', startedAt: res.startedAt }); return }
    if (res.error === 'rate-limit') { setRun({ phase: 'error', msg: 'Too many updates in the last hour. Try again a bit later.' }); return }
    openTaskPage()
  }

  // While a run is going, re-read the feed every 20 s until it's newer than
  // when we pressed the button (OneDrive usually syncs it down within a minute).
  useEffect(() => {
    if (run.phase !== 'running') return
    const started = Date.parse(run.startedAt)
    let stopped = false
    async function check() {
      try {
        const res = await window.desktop.emailNotesLoad()
        if (stopped) return
        const updated = Date.parse(res?.feed?.updatedAt || '')
        if (updated && updated >= started) {
          setState({ loading: false, ...res })
          setRun({ phase: 'done', at: res.feed.updatedAt })
          return
        }
        if (Date.now() - started > 25 * 60000) {
          setRun({ phase: 'error', msg: "The update is taking longer than usual. It will show up here as soon as it's done." })
        }
      } catch { /* try again next tick */ }
    }
    const interval = setInterval(check, 20000)
    return () => { stopped = true; clearInterval(interval) }
  }, [run.phase, run.startedAt])

  const pending = pendingNotes(state.feed, state.local)
  const decided = (state.local && state.local.decisions) || {}
  useEffect(() => { if (onCountChange && !state.loading) onCountChange(pending.length) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending.length, state.loading])

  async function decide(id, decision) {
    const local = { version: 1, decisions: {}, ...(state.local || {}) }
    const next = { ...local, decisions: { ...(local.decisions || {}), [id]: { ...decision, at: new Date().toISOString() } } }
    setState(s => ({ ...s, local: next }))
    const ok = await window.desktop.emailNotesSaveLocal(next)
    if (!ok) alert('Could not save that. Check that the Field App folder is still there.')
  }

  // Saves the original work order (from Field App/Work Orders) into a job's
  // Files, or a PDF copy of its details when the original isn't there. Best effort — the job
  // and note are already saved if this fails.
  async function saveWorkOrderCopy(rec, wo, item) {
    if (!wo || !window.desktop?.pdfFromHtml || !rec?.folder) return
    const cust = (jobsHub.customers || []).find(c => c.id === rec.customerId)
    if (!cust) return
    const when = (item.date || todayLocal()).slice(0, 10)
    const where = [wo.building, wo.room].filter(Boolean).join(' ').replace(/[^\w\s-]/g, '').trim()
    const destBase = `Work Order ${when}${where ? ` - ${where}` : ''}`
    // The original file, if the Power Automate flow saved it into Field App/Work Orders.
    try {
      if (window.desktop?.workOrderCopyToRecord) {
        const r = await window.desktop.workOrderCopyToRecord({
          match: { receivedAt: wo.receivedAt || '', date: wo.emailDate || item.date || '', fileName: wo.fileName || '' },
          customerFolder: cust.folder, folder: rec.folder, destBase,
        })
        if (r?.ok) return
      }
    } catch { /* fall back to the PDF copy */ }
    try {
      const base64 = await window.desktop.pdfFromHtml(workOrderHtml(wo, item, rec.name, cust.name))
      await window.desktop.saveFile(`Jobs/${cust.folder}/${rec.folder}/Files`, `${destBase} (copy).pdf`, base64)
    } catch { /* leave it — the note and details are already on the job */ }
  }

  async function approve(item, pick, text, extra = {}) {
    setBusy(true)
    try {
      const by = [item.from, item.subject && `“${item.subject}”`, item.date && fmtDate(item.date)].filter(Boolean).join(' · ')
      const noteEntry = { id: uid(), timestamp: new Date().toISOString(), text: by ? `${text}\n\n📧 ${by}` : text, source: 'email', emailId: item.id, ...(item.webLink ? { webLink: item.webLink } : {}) }
      const wo = extra.workOrder ? { ...extra.workOrder, emailLink: item.webLink || '', emailDate: item.date || '' } : null

      if (pick === 'new') {
        const custName = item.target?.customer || ''
        const cust = (jobsHub.customers || []).find(c => !c.trashedAt && norm(c.name) === norm(custName))
          || (jobsHub.customers || []).find(c => !c.trashedAt && /residence/i.test(c.name) && /residence/i.test(custName))
        if (!cust) { alert(`Couldn't find the customer “${custName}” in Jobs. Pick an existing job instead, or add that customer first.`); return }
        const rec = await jobsHub.addRecord(cust.id, {
          type: 'tm', name: extra.newName || item.target.name || 'New job', lifecycleStatus: 'onGoing', completed: false,
          ...Object.fromEntries(Object.entries(extra.fields || {}).map(([k, v]) => [k, k === 'jobValue' ? Number(v) : v])), ...(wo ? { workOrder: wo } : {}), notesLog: [noteEntry],
        })
        if (!rec) { alert('The job could not be created. Check that the data folder is still there.'); return }
        await saveWorkOrderCopy(rec, wo, item)
        await decide(item.id, { status: 'approved', target: { kind: 'job', name: rec.name, created: true }, text })
        return
      }
      if (pick.startsWith('job:') && (Object.keys(extra.fields || {}).length || wo)) {
        const rec = (jobsHub.records || []).find(r => r.id === pick.slice(4))
        if (rec) {
          const patch = {}
          Object.entries(extra.fields || {}).forEach(([k, v]) => { if (isBlank(rec[k])) patch[k] = k === 'jobValue' ? Number(v) : v })
          if (wo && !rec.workOrder) patch.workOrder = wo
          if (Object.keys(patch).length) await jobsHub.updateRecord(rec.id, patch)
          if (wo) await saveWorkOrderCopy(rec, wo, item)
        }
      }
      if (pick === 'misc') {
        const day = emailDay(item)
        const title = miscDayTitle(day)
        const time = emailTime(item)
        const head = [time, item.from, item.subject && `“${item.subject}”`].filter(Boolean).join(' · ')
        const entry = { id: item.id, at: item.time || item.receivedAt || '', block: `${head ? `${head}\n` : ''}${text}` }
        setDailyNotes(all => fileAssistantNote(all, day, entry))
        await decide(item.id, { status: 'approved', target: { kind: 'misc', name: title }, text })
        return
      }
      const [kind, id] = pick.split(':')
      const hub = kind === 'quote' ? quotesHub : jobsHub
      const rec = (hub.records || []).find(r => r.id === id)
      if (!rec) { alert('That job or quote could not be found.'); return }
      const log = rec.notesLog || []
      if (!log.some(n => n.emailId === item.id)) {
        await hub.updateRecord(id, { notesLog: [noteEntry, ...log] })
      }
      await decide(item.id, { status: 'approved', target: { kind, name: kind === 'quote' ? rec.quoteNumber : rec.name }, text })
    } finally {
      setBusy(false)
    }
  }
  async function skip(item) {
    await decide(item.id, { status: 'skipped' })
  }

  const recentDone = ((state.feed && state.feed.items) || []).filter(i => decided[i.id])
    .sort((a, b) => (decided[b.id].at || '').localeCompare(decided[a.id].at || '')).slice(0, 20)

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r, 10px)', overflow: 'hidden', marginBottom: 16 }

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Assistant Update</div>
          <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
            Notes drafted from your SCE email for your jobs and quotes. Approve to add one to the project's notes (edit it first if you like), file it as a Misc note, or dismiss what you don't need.
            {state.feed?.updatedAt ? ` Updated ${new Date(state.feed.updatedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}
          </div>
        </div>
        <button
          style={{ ...btn('primary'), opacity: run.phase === 'starting' || run.phase === 'running' ? 0.6 : 1 }}
          disabled={run.phase === 'starting' || run.phase === 'running'}
          onClick={updateNow}
        >
          {run.phase === 'starting' ? '↻ Starting…' : run.phase === 'running' ? '↻ Updating…' : '↻ Update me now'}
        </button>
      </div>

      {run.phase === 'running' && (
        <div style={{ ...card, padding: '10px 14px', fontSize: 13, color: 'var(--text-mid)', background: '#e8f2fc', borderColor: '#1a5fa0' }}>
          {run.manual
            ? <>Your SCE email daily catch just opened in your browser. Click <b>Run now</b> there. It usually takes 5–10 minutes, and this page fills in by itself when it's done. Your Orders &amp; POs update at the same time. <a href="#" onClick={e => { e.preventDefault(); window.desktop.openExternal(TASK_PAGE) }}>Open it again</a> · <a href="#" onClick={e => { e.preventDefault(); setRun({ phase: 'idle' }) }}>Cancel</a></>
            : <>Your assistant is going through your email now. It usually takes 5–10 minutes, and this page fills in by itself when it's done. Your Orders &amp; POs update at the same time.</>}
        </div>
      )}
      {run.phase === 'done' && (
        <div style={{ ...card, padding: '10px 14px', fontSize: 13, color: '#1e7a34', background: '#e6f4ea', borderColor: '#1e7a34' }}>
          ✓ Up to date as of {new Date(run.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
        </div>
      )}
      {run.phase === 'error' && run.msg && (
        <div style={{ ...card, padding: '10px 14px', fontSize: 13, color: '#9a6610', background: '#fff8e6', borderColor: '#9a6610' }}>{run.msg}</div>
      )}

      <FlaggedList navigate={navigate} compact />
      {state.loading && <div style={{ color: 'var(--text-light)' }}>Loading…</div>}
      {!state.loading && !state.folder && (
        <div style={{ ...card, padding: 16, fontSize: 13 }}>Can't find the Field App folder. Open Orders &amp; POs and use “Choose folder”.</div>
      )}
      {!state.loading && state.folder && !state.feed && (
        <div style={{ ...card, padding: 16, fontSize: 13, color: 'var(--text-mid)' }}>No suggestions yet — they arrive with the weekday morning email run.</div>
      )}

      {state.feed && (
        <div style={card}>
          <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>To review ({pending.length})</span>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{pending.length ? 'By the day the email came in, newest first' : 'All caught up.'}</span>
          </div>
          {pending.length > 5 && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by project, sender, subject or text…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)' }} />
            </div>
          )}
          {(() => {
            const shown = pending
              .map(i => ({ i, day: emailDay(i), at: i.time || i.receivedAt || '' }))
              .sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
              .filter(({ i }) => { const w = filter.trim().toLowerCase().split(/\s+/).filter(Boolean); if (!w.length) return true
                const hay = [i.from, i.subject, i.note, i.targetLabel, i.target && (i.target.name || i.target.quoteNumber || i.target.kind)].join(' ').toLowerCase()
                return w.every(x => hay.includes(x)) })
            const out = []
            shown.forEach(({ i, day }, n) => {
              if (n === 0 || shown[n - 1].day !== day) {
                const count = shown.filter(x => x.day === day).length
                out.push(
                  <div key={`day-${day}`} style={{ padding: '6px 14px', background: 'var(--navy, #0f1e2e)', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '.03em' }}>
                    {dayHeading(day)} <span style={{ fontWeight: 600, opacity: 0.7 }}>· {count} {count === 1 ? 'email' : 'emails'}</span>
                  </div>
                )
              }
              out.push(<NoteCard key={i.id} item={i} jobs={jobs} quotes={quotes} options={options} onApprove={approve} onSkip={skip} busy={busy} />)
            })
            return out
          })()}
        </div>
      )}

      {recentDone.length > 0 && (
        <div style={card}>
          <button onClick={() => setShowDone(v => !v)}
            style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            Recently handled ({recentDone.length}) {showDone ? '▴' : '▾'}
          </button>
          {showDone && recentDone.map(i => {
            const d = decided[i.id]
            return (
              <div key={i.id} style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12.5, display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 700, color: d.status === 'approved' ? 'var(--green-dark)' : 'var(--text-light)', minWidth: 70 }}>
                  {d.status === 'approved' ? '✓ Added' : 'Dismissed'}
                </span>
                <span style={{ flex: 1 }}>
                  {d.status === 'approved' && d.target ? <b>{d.target.name}: </b> : null}
                  {d.text || i.note}
                </span>
                <button style={{ ...btn(), padding: '2px 8px', fontSize: 11.5 }} title="Put it back in the review list (an approved note stays in the project; delete it there if needed)"
                  onClick={async () => {
                    const local = { ...(state.local || {}) }
                    const decisions = { ...(local.decisions || {}) }
                    delete decisions[i.id]
                    const next = { ...local, decisions }
                    setState(s => ({ ...s, local: next }))
                    await window.desktop.emailNotesSaveLocal(next)
                  }}>Undo</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
