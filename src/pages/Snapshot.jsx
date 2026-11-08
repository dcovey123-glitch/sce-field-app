import React, { useState, useEffect, useMemo } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { effectiveLifecycleStatus, effectiveJobTotal, unbilledAmount, tmBilledAmount } from './Jobs.jsx'
import { quoteGrandTotal } from '../api/quoteMath.js'
import { linkedJobsCustomer } from '../api/sharedCustomer.js'
import { openFlags, addFlagPatch } from '../components/FlagBanner.jsx'
import logoUrl from '../assets/logo_sce_new.jpg'

const JONATHAN = 'Jonathandumont@sceelectric.com'

async function logoDataUrl() {
  try {
    if (logoUrl.startsWith('data:')) return logoUrl
    const buf = await (await fetch(logoUrl)).arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return `data:image/jpeg;base64,${btoa(bin)}`
  } catch { return '' }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The Snapshot as a printable report (Letter), for sending on.
function snapshotReportHtml(snap, takenAt, opts, logo) {
  const when = takenAt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const tiles = [
    ['Left to bill on active jobs', money0(snap.leftToBill), `${snap.jobsWithMoney} jobs`],
    [`Billed in ${longMonth(snap.thisMonth)}`, money0(snap.billing[snap.thisMonth]), `${longMonth(snap.lastMonth)}: ${money0(snap.billing[snap.lastMonth])}`],
    ['Quotes sent, waiting', money0(snap.sentTotal), `${snap.sentCount} quotes`],
    ['Quoted, not sent yet', money0(snap.unsentTotal), `${snap.unsentCount} quotes`],
  ].map(([l, v, n]) => `<div class="tile"><div class="tl">${esc(l)}</div><div class="tv">${esc(v)}</div><div class="tn">${esc(n)}</div></div>`).join('')
  const jobs = snap.onBooks.map(r => `<tr>
    <td><b>${esc(r.p.name)}</b>${opts.jobNotes && r.p.notes ? `<div class="sub">${esc(String(r.p.notes).trim().slice(0, 160))}</div>` : ''}</td>
    <td>${esc(r.customer?.name)}</td><td>${esc(r.status)}</td><td>${esc(r.p.co || '')}</td>
    <td class="n">${r.value ? money(r.value) : '—'}${r.fromQuote ? '<div class="sub">from quote</div>' : ''}</td>
    <td class="n">${money(r.billed)}</td><td class="n"><b>${money(r.left)}</b></td>
    <td>${esc(fmtDay(r.p.dateStart))}</td><td>${esc(fmtDay(r.p.dateComplete))}</td></tr>`).join('')
  const quotes = snap.open.filter(r => !r.dupOf).map(r => `<tr>
    <td style="white-space:nowrap"><b>${esc(r.q.quoteNumber)}</b></td><td>${esc(r.q.title)}</td><td>${esc(r.customer?.name)}</td>
    <td class="n"><b>${r.total ? money(r.total) : 'Not priced'}</b></td><td style="white-space:nowrap">${esc(r.state === 'No sent date' ? 'Not sent' : r.state)}</td>
    <td>${esc(fmtDay(r.q.sentDate))}</td><td class="n">${r.sent && r.age != null ? r.age : ''}</td></tr>`).join('')
  const maxBill = Math.max(1, ...snap.months.map(m => snap.billing[m]))
  const bills = snap.months.map(m => `<tr><td style="width:70px">${esc(fmtMonth(m))}</td>
    <td><div class="bar"><span style="width:${(snap.billing[m] / maxBill) * 100}%"></span></div></td>
    <td class="n" style="width:90px"><b>${money0(snap.billing[m])}</b></td></tr>`).join('')
  const dates = snap.upcoming.map(u => `<tr><td style="white-space:nowrap"><b>${esc(fmtDayLong(u.date))}</b></td>
    <td><b>${esc(u.what)}</b>${u.details.map(d => `<div>${esc(d)}</div>`).join('')}</td></tr>`).join('')
  const notes = snap.recentEmail.map(({ i, text }) => `<tr><td style="white-space:nowrap">${esc(fmtDay(i.date))}</td>
    <td><b>${esc(i.target?.name || i.target?.quoteNumber || i.targetLabel || 'Miscellaneous')}</b><div>${esc(text)}</div></td></tr>`).join('')
  const checks = snap.checks.map(c => `<tr><td><b>${esc(c.what)}</b></td><td>${esc(c.issue)}</td><td class="n">${c.amount ? money(c.amount) : ''}</td></tr>`).join('')
  const section = (title, sub, head, rows, cols) => `<h2>${esc(title)}</h2>${sub ? `<div class="h2s">${esc(sub)}</div>` : ''}
    <table>${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${rows || `<tr><td colspan="${cols}" class="sub">Nothing to show.</td></tr>`}</tbody></table>`
  const th = (cells) => cells.map(c => `<th${c.startsWith('>') ? ' class="n"' : ''}>${esc(c.replace(/^>/, ''))}</th>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SCE Electric - Snapshot</title><style>
    * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; color: #1a2330; font-size: 10.5px; margin: 0; }
    .hdr { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #0f1e2e; padding-bottom: 10px; margin-bottom: 12px; }
    .hdr img { height: 46px; } .hdr h1 { margin: 0; font-size: 20px; } .hdr .m { color: #5b6878; font-size: 11px; margin-top: 2px; }
    .lead { font-size: 12px; margin: 0 0 12px; line-height: 1.5; }
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 6px; }
    .tile { border: 1px solid #d5dbe3; border-radius: 6px; padding: 8px 10px; } .tl { color: #5b6878; font-size: 10px; } .tv { font-size: 18px; font-weight: 700; margin: 2px 0; } .tn { color: #5b6878; font-size: 9.5px; }
    h2 { font-size: 13px; margin: 16px 0 2px; color: #0f1e2e; break-after: avoid; } .h2s { color: #5b6878; font-size: 9.5px; margin-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { break-inside: avoid; }
    th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #5b6878; border-bottom: 1.5px solid #0f1e2e; padding: 4px 5px; }
    td { padding: 5px; border-bottom: 1px solid #e3e7ec; vertical-align: top; } .n { text-align: right; white-space: nowrap; }
    .sub { color: #6b7685; font-size: 9px; margin-top: 1px; }
    .bar { height: 10px; background: #eef1f4; border-radius: 3px; overflow: hidden; } .bar span { display: block; height: 100%; background: #0f1e2e; }
    .foot { margin-top: 16px; padding-top: 6px; border-top: 1px solid #d5dbe3; color: #8a95a3; font-size: 9px; }
  </style></head><body>
    <div class="hdr">${logo ? `<img src="${logo}" alt="SCE Electric" />` : ''}<div><h1>On the Books</h1><div class="m">Dustin Covey · ${esc(when)}</div></div></div>
    <p class="lead"><b>${money0(snap.leftToBill)}</b> left to bill on ${snap.jobsWithMoney} jobs. <b>${money0(snap.sentTotal)}</b> quoted and waiting on customers${snap.unsentTotal > 0 ? `, plus <b>${money0(snap.unsentTotal)}</b> quoted but not sent yet` : ''}.</p>
    <div class="tiles">${tiles}</div>
    ${section('On the books', 'Every job not marked Complete (Billed).', th(['Job', 'Customer', 'Status', 'CO / PO', '>Value', '>Billed', '>Left to bill', 'Start', 'Finish']), jobs, 9)}
    ${section('Open quotes', 'Not approved or voided, largest first.', th(['Quote', 'Project', 'Customer', '>Amount', 'Status', 'Sent', '>Days out']), quotes, 7)}
    ${opts.billing ? section('Billed by month', 'From each job\'s billing history.', '', bills, 3) : ''}
    ${opts.dates ? section('Coming up', `Next ${AHEAD_DAYS} days.`, th(['Date', 'What']), dates, 2) : ''}
    ${opts.notes ? section('Project notes from email', `Last ${EMAIL_NOTE_DAYS} days.`, th(['Date', 'Note']), notes, 2) : ''}
    ${opts.checks ? section('Worth fixing', 'Where the numbers in the app need a correction.', th(['Job or quote', "What's off", '>Amount']), checks, 3) : ''}
    <div class="foot">SCE Electric Western Canada Ltd. · Snapshot from the field app · ${esc(when)}</div>
  </body></html>`
}

// ── Snapshot: what's on the books right now ──
// Built live from the app's own jobs, quotes, billing history and notes, plus
// the email notes the morning run drafted (Field App/email-notes.json).
// Nothing here is stored; open it again and it's current.

const DAY = 86400000
// Past this, a quote that comes back will likely need re-pricing (a note, not a problem)
const REPRICE_DAYS = 60
const AHEAD_DAYS = 120
const EMAIL_NOTE_DAYS = 21

const money = v => `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money0 = v => `$${Math.round(Number(v) || 0).toLocaleString('en-US')}`
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseDay = s => { if (!s) return null; const t = Date.parse(String(s).length === 10 ? s + 'T12:00:00' : s); return isNaN(t) ? null : new Date(t) }
const fmtDay = s => { const d = parseDay(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '' }
const fmtDayLong = s => { const d = parseDay(s); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '' }
const longMonth = k => { const d = parseDay(k + '-15'); return d ? d.toLocaleDateString('en-US', { month: 'long' }) : k }
const fmtMonth = k => { const d = parseDay(k + '-15'); return d ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : k }

const QUOTE_CHIP = { 'Sent': ['#1e7a34', '#e6f4ea'], 'Not sent': ['#9a6610', '#fff4dd'], 'No sent date': ['#9a6610', '#fff4dd'], 'Pulled back': ['#b42318', '#fdecea'] }
const STATUS_LABEL = { onGoing: 'Active', deficiencies: 'Deficiencies', unbilled: 'Complete (unbilled)', billed: 'Complete (billed)' }

// Dates written in notes: "Nov 9", "November 9th", "Nov 9/10", "Dec 31, 2026", "2026-11-09".
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DATE_RE = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[/&-]\s*\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+(20\d\d))?|(20\d\d)-(\d\d)-(\d\d))\b/gi
function datesIn(text, written) {
  const out = []
  const base = parseDay(written) || new Date()
  for (const m of String(text || '').matchAll(DATE_RE)) {
    let d
    if (m[4]) d = new Date(Number(m[4]), Number(m[5]) - 1, Number(m[6]), 12)
    else {
      const mi = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3))
      let y = m[3] ? Number(m[3]) : base.getFullYear()
      d = new Date(y, mi, Number(m[2]), 12)
      // "Jan 5" written in December means next year.
      if (!m[3] && d < new Date(base.getTime() - 60 * DAY)) d = new Date(y + 1, mi, Number(m[2]), 12)
    }
    if (!isNaN(d)) out.push({ date: d, text: m[0] })
  }
  return out
}
// The sentence around a date, for context.
function around(text, hit) {
  const s = String(text || '').replace(/\n+📧[\s\S]*$/, '')
  const i = s.indexOf(hit)
  if (i < 0) return s.slice(0, 160)
  const start = Math.max(0, s.lastIndexOf('.', i - 1) + 1, s.lastIndexOf('\n', i - 1) + 1)
  let end = s.indexOf('.', i + hit.length)
  const nl = s.indexOf('\n', i + hit.length)
  if (end < 0 || (nl >= 0 && nl < end)) end = nl
  if (end < 0) end = s.length
  return s.slice(start, end + 1).trim().slice(0, 220)
}

export default function Snapshot() {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes', reloadOnFocus: true,
  })
  const [generalNotes] = useLocalStore('general_notes', [])
  const [dailyNotes] = useLocalStore('daily_notes', {})
  const [todos] = useLocalStore('todos', [])
  const [email, setEmail] = useState({ feed: null, local: null })
  const [takenAt, setTakenAt] = useState(() => new Date())
  const [exportOpen, setExportOpen] = useState(false)
  // Things you've dismissed from the Snapshot (date lines, email notes, fixes).
  // Kept until you restore them; a fix comes back if its wording/amount changes.
  const [dismissed, setDismissed] = useLocalStore('snapshot_dismissed', {})
  const [showHidden, setShowHidden] = useState({ dates: false, email: false, checks: false })
  const dismiss = key => setDismissed(d => ({ ...(d || {}), [key]: new Date().toISOString() }))
  const restore = key => setDismissed(d => { const n = { ...(d || {}) }; delete n[key]; return n })
  const [exportOpts, setExportOpts] = useLocalStore('snapshot_export_opts', { billing: true, dates: true, notes: false, checks: false, jobNotes: true })
  const [exportState, setExportState] = useState({ busy: false, msg: '', err: '' })

  async function loadEmail() {
    if (!window.desktop?.emailNotesLoad) return
    try { const r = await window.desktop.emailNotesLoad(); setEmail({ feed: r?.feed || null, local: r?.local || null }) } catch { /* the rest still works */ }
  }
  useEffect(() => { loadEmail() }, [])
  function refresh() { setTakenAt(new Date()); loadEmail(); jobsHub.reload?.(); quotesHub.reload?.() }

  const loading = jobsHub.loading || quotesHub.loading

  const snap = useMemo(() => {
    if (loading) return null
    const today = new Date(takenAt); today.setHours(0, 0, 0, 0)
    const jc = Object.fromEntries((jobsHub.customers || []).map(c => [c.id, c]))
    const qc = Object.fromEntries((quotesHub.customers || []).map(c => [c.id, c]))
    const jobs = (jobsHub.records || []).filter(p => !p.trashedAt && jc[p.customerId] && !jc[p.customerId].trashedAt)
    const quotes = (quotesHub.records || []).filter(q => !q.trashedAt && q.quoteNumber)
    const linkedQuoteIds = new Set()
    jobs.forEach(p => [...(p.linkedQuoteIds || []), p.linkedQuoteId].filter(Boolean).forEach(id => linkedQuoteIds.add(id)))

    // Approved quotes by the job they're linked to (a quote names its job).
    const jobIds = new Set(jobs.map(p => p.id))
    const quotesByJob = {}
    quotes.filter(q => q.approved && !q.invalidated && q.linkedJobId).forEach(q => { (quotesByJob[q.linkedJobId] ||= []).push(q) })
    const quotedFor = id => (quotesByJob[id] || []).reduce((s, q) => s + quoteGrandTotal(q), 0)

    // Jobs on the books: anything not marked Complete (Billed).
    const onBooks = jobs.filter(p => effectiveLifecycleStatus(p) !== 'billed').map(p => {
      const st = effectiveLifecycleStatus(p)
      let value = effectiveJobTotal(p)
      let left = unbilledAmount(p)
      let fromQuote = false
      // No value typed on a quoted job: use its approved quote(s).
      if (!value && p.type !== 'tm' && p.type !== 'warranty' && quotedFor(p.id) > 0) {
        value = quotedFor(p.id); fromQuote = true
        left = value * (1 - (Number(p.billedProgress) || 0) / 100)
      }
      const billed = p.type === 'tm' ? tmBilledAmount(p) : value * (Number(p.billedProgress) || 0) / 100
      return { p, customer: jc[p.customerId], status: st ? STATUS_LABEL[st] : 'Needs review', value, billed, left, fromQuote }
    }).sort((a, b) => (a.status === b.status ? b.left - a.left : ['Active', 'Deficiencies', 'Complete (unbilled)', 'Needs review'].indexOf(a.status) - ['Active', 'Deficiencies', 'Complete (unbilled)', 'Needs review'].indexOf(b.status)))

    // Open quotes: not approved, not voided.
    const open = quotes.filter(q => !q.approved && !q.invalidated).map(q => {
      const total = quoteGrandTotal(q)
      const sent = q.status === 'yellow' && !!q.sentDate
      const state = sent ? 'Sent' : q.status === 'yellow' ? 'No sent date' : q.sentDate ? 'Pulled back' : 'Not sent'
      const age = sent ? Math.floor((today - parseDay(q.sentDate)) / DAY) : null
      return { q, customer: qc[q.customerId], total, sent, state, age, dupOf: null }
    }).sort((a, b) => b.total - a.total)
    // Two open quotes for the same customer, close in price, sharing words in the
    // title: likely an old and a new version. Only the newer one is counted.
    const words = t => new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !['with', 'from', 'work', 'additional', 'submit', 'proposal', 'upgrade', 'upgrades', 'classroom', 'classrooms', 'replacement', 'repair', 'repairs', 'install', 'new'].includes(w)))
    open.forEach(a => open.forEach(b => {
      if (a === b || a.dupOf || b.dupOf || a.q.customerId !== b.q.customerId || !a.total || !b.total) return
      const wa = words(a.q.title), shared = [...words(b.q.title)].filter(w => wa.has(w)).length
      const close = Math.abs(a.total - b.total) / Math.max(a.total, b.total) <= 0.1
      if (shared >= 2 && close) {
        const older = String(a.q.quoteNumber).localeCompare(String(b.q.quoteNumber), undefined, { numeric: true }) < 0 ? a : b
        older.dupOf = (older === a ? b : a).q.quoteNumber
      }
    }))

    // Billing by month (last 6 months).
    const months = []
    for (let i = 5; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); months.push(ymd(d).slice(0, 7)) }
    const billing = Object.fromEntries(months.map(m => [m, 0]))
    jobs.forEach(p => (p.billingHistory || []).forEach(h => { const k = h.monthKey || String(h.date || '').slice(0, 7); if (k in billing) billing[k] += Number(h.amount) || 0 }))
    const thisMonth = months[5], lastMonth = months[4]

    // Upcoming dates: job dates, plus dates written in notes and email.
    const horizon = new Date(today.getTime() + AHEAD_DAYS * DAY)
    const upcoming = []
    // One line per date and job; details and sources from several places are combined.
    const add = (d, what, detail, source, job) => {
      if (!d || d < today || d > horizon) return
      const key = `${ymd(d)}|${what}`.toLowerCase()
      const hit = upcoming.find(u => u.key === key)
      const det = String(detail || '').trim()
      if (hit) {
        if (det && !hit.details.some(x => x.toLowerCase() === det.toLowerCase())) hit.details.push(det)
        if (!hit.sources.includes(source)) hit.sources.push(source)
        return
      }
      upcoming.push({ key, date: ymd(d), what, details: det ? [det] : [], sources: [source], job })
    }
    onBooks.forEach(({ p, customer }) => {
      add(parseDay(p.dateStart), p.name, 'Scheduled start', 'Job dates', { p, customer })
      add(parseDay(p.dateComplete), p.name, 'To be completed by', 'Job dates', { p, customer })
      const notes = [{ text: p.notes, at: p.updatedAt }, ...(p.notesLog || []).map(n => ({ text: n.text, at: n.timestamp }))]
      notes.forEach(n => datesIn(n.text, n.at).forEach(h => add(h.date, p.name, around(n.text, h.text), 'Job notes', { p, customer })))
    })
    open.forEach(({ q }) => [q.notes, ...(q.notesLog || []).map(n => n.text)].forEach(t => datesIn(t, q.sentDate).forEach(h => add(h.date, `${q.quoteNumber} ${q.title || ''}`.trim(), around(t, h.text), 'Quote notes'))))
    ;(generalNotes || []).forEach(n => datesIn(n.content, n.updatedAt).forEach(h => add(h.date, n.title || 'General note', around(n.content, h.text), 'General notes')))
    Object.entries(dailyNotes || {}).forEach(([day, secs]) => (Array.isArray(secs) ? secs : []).forEach(s => datesIn(s.text, day).forEach(h => add(h.date, `Daily note ${fmtDay(day)}`, around(s.text, h.text), 'Daily notes'))))
    ;(todos || []).filter(t => !t.done).forEach(t => datesIn(t.text, t.createdAt).forEach(h => add(h.date, 'To-do', t.text, 'To-do list')))
    const emailItems = (email.feed?.items || [])
    emailItems.forEach(i => {
      const what = i.target?.name || i.target?.quoteNumber || i.targetLabel || i.subject || 'Email'
      if (i.fields?.dateStart) add(parseDay(i.fields.dateStart), what, 'Start date (from email)', `Email · ${i.from || ''}`)
      if (i.fields?.dateComplete) add(parseDay(i.fields.dateComplete), what, 'Required by (from email)', `Email · ${i.from || ''}`)
      datesIn(i.note, i.date).forEach(h => add(h.date, what, around(i.note, h.text), `Email · ${i.from || ''}`))
    })
    upcoming.sort((a, b) => a.date.localeCompare(b.date))

    // Recent email notes.
    const decided = email.local?.decisions || {}
    const cutoff = ymd(new Date(today.getTime() - EMAIL_NOTE_DAYS * DAY))
    const recentEmail = emailItems.filter(i => String(i.date || '').slice(0, 10) >= cutoff && decided[i.id]?.status !== 'skipped')
      .map(i => ({ i, reviewed: !!decided[i.id], text: decided[i.id]?.text || i.note }))
      .sort((a, b) => String(b.i.time || b.i.date).localeCompare(String(a.i.time || a.i.date)))

    // Things that don't add up.
    const checks = []
    jobs.filter(p => effectiveLifecycleStatus(p) === 'billed' && unbilledAmount(p) > 50)
      .forEach(p => checks.push({ what: p.name, issue: `Marked billed, but ${money(unbilledAmount(p))} hasn't been billed.`, amount: unbilledAmount(p), p, customer: jc[p.customerId], focus: 'billing', fix: 'Bill it or fix the billing' }))
    onBooks.filter(r => !r.value && r.status !== 'Needs review')
      .forEach(r => checks.push({ what: r.p.name, issue: 'No job value entered, so nothing shows to bill.', amount: 0, p: r.p, customer: r.customer, focus: 'value', fix: 'Enter the job value' }))
    onBooks.filter(r => r.status === 'Needs review')
      .forEach(r => checks.push({ what: r.p.name, issue: 'Old status from before Billed/Unbilled existed. Mark it Billed or Unbilled.', amount: 0, p: r.p, customer: r.customer, focus: 'status', fix: 'Set the status' }))
    onBooks.filter(r => r.fromQuote)
      .forEach(r => checks.push({ what: r.p.name, issue: `No job value entered. Using the approved quote total, ${money(r.value)}.`, amount: r.value, p: r.p, customer: r.customer, focus: 'value', fix: 'Enter the job value' }))
    onBooks.filter(r => r.p.type === 'quoted' && Number(r.p.jobValue) > 0 && quotedFor(r.p.id) > 0).forEach(r => {
      const qt = quotedFor(r.p.id)
      if (Math.abs(qt - Number(r.p.jobValue)) > 1) checks.push({ what: r.p.name, issue: `Job value is ${money(r.p.jobValue)}; approved quote${(quotesByJob[r.p.id] || []).length > 1 ? 's add' : ' is'} up to ${money(qt)}.`, amount: Math.abs(qt - Number(r.p.jobValue)), p: r.p, customer: r.customer, focus: 'value', fix: 'Check the job value' })
    })
    quotes.filter(q => q.approved && !q.invalidated && quoteGrandTotal(q) > 0 && !linkedQuoteIds.has(q.id) && !(q.linkedJobId && jobIds.has(q.linkedJobId)))
      .forEach(q => checks.push({ what: `${q.quoteNumber} ${q.title || ''}`.trim(), issue: q.linkedJobId ? 'Approved, but its job is in the trash.' : 'Approved, but no job is linked to it.', amount: quoteGrandTotal(q), q, fix: 'Open the quote' }))
    open.filter(r => r.dupOf)
      .forEach(r => checks.push({ what: `${r.q.quoteNumber} ${r.q.title || ''}`.trim(), issue: `Looks like an older version of ${r.dupOf}. Not counted in the totals. Void it if it's replaced.`, amount: r.total, q: r.q, fix: 'Open the quote' }))
    open.filter(r => r.state === 'No sent date' && !r.dupOf)
      .forEach(r => checks.push({ what: `${r.q.quoteNumber} ${r.q.title || ''}`.trim(), issue: 'Marked sent, but has no sent date. Counted as not sent.', amount: r.total, q: r.q, fix: 'Add the sent date' }))
    // How long a quote has been out is shown in Open quotes as a note only —
    // old quotes do come back, they just need re-pricing then.
    // A CO number but no approval date (CANA's Procore CCO date goes there).
    onBooks.filter(r => r.p.type === 'quoted' && /^\d{2,4}$/.test(String(r.p.co || '').trim()) && !r.p.dateApproved)
      .forEach(r => checks.push({ what: r.p.name, issue: `CO ${r.p.co} has no Date approved. Use the day the CCO came through Procore.`, amount: 0, p: r.p, customer: r.customer, focus: 'dateApproved', fix: 'Add the date approved' }))
    // Open deficiencies on any job.
    jobs.filter(p => !['unbilled', 'billed'].includes(effectiveLifecycleStatus(p))).forEach(p => (p.deficiencies || []).filter(d => !d.resolved).forEach(d => checks.push({
      what: p.name, issue: `Open deficiency: ${String(d.text || '').trim() || 'no description'}`, amount: 0, p, customer: jc[p.customerId], defic: true, fix: 'Open deficiencies',
    })))

    const leftToBill = onBooks.reduce((s, r) => s + r.left, 0)
    const sentQuotes = open.filter(r => r.sent && !r.dupOf)
    const unsentQuotes = open.filter(r => !r.sent && !r.dupOf && r.total > 0)
    return {
      onBooks, open, billing, months, thisMonth, lastMonth, upcoming, recentEmail, checks,
      leftToBill, jobsWithMoney: onBooks.filter(r => r.left > 0).length,
      sentTotal: sentQuotes.reduce((s, r) => s + r.total, 0), sentCount: sentQuotes.length,
      unsentTotal: unsentQuotes.reduce((s, r) => s + r.total, 0), unsentCount: unsentQuotes.length,
    }
  }, [loading, jobsHub.records, jobsHub.customers, quotesHub.records, quotesHub.customers, generalNotes, dailyNotes, todos, email, takenAt])

  const keyOf = {
    dates: u => `date:${u.key}`,
    email: r => `email:${r.i.id}`,
    checks: c => `check:${c.what}|${c.issue}`,
  }
  const view = useMemo(() => {
    if (!snap) return null
    const d = dismissed || {}
    const split = (list, kind) => ({ shown: list.filter(x => !d[keyOf[kind](x)]), hidden: list.filter(x => d[keyOf[kind](x)]) })
    const dates = split(snap.upcoming, 'dates'), mail = split(snap.recentEmail, 'email'), checks = split(snap.checks, 'checks')
    return { ...snap, upcoming: dates.shown, recentEmail: mail.shown, checks: checks.shown, hidden: { dates: dates.hidden, email: mail.hidden, checks: checks.hidden } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, dismissed])

  const openJob = (p, customer, focus) => { if (p && customer && window.desktop?.openCustomerWindow) window.desktop.openCustomerWindow(customer.id, p.id, focus ? { focus } : undefined) }
  // Each "Worth fixing" line opens the exact place to fix it.
  const canFix = c => !!window.desktop && (c.q ? !!quoteJobsCustomer(c.q) : !!(c.p && c.customer))
  function quoteJobsCustomer(q) {
    const qcust = (quotesHub.customers || []).find(c => c.id === q.customerId)
    return linkedJobsCustomer(qcust, (jobsHub.customers || []).filter(c => !c.trashedAt))
  }
  async function exportPdf(email) {
    if (!snap) return
    if (!window.desktop?.pdfFromHtml) { setExportState({ busy: false, msg: '', err: 'Export works in the desktop app.' }); return }
    setExportState({ busy: true, msg: '', err: '' })
    try {
      const html = snapshotReportHtml(view, takenAt, exportOpts, await logoDataUrl())
      const base64 = await window.desktop.pdfFromHtml(html)
      const day = ymd(takenAt)
      const saved = await window.desktop.saveFile('Snapshots', `Snapshot ${day} - On the Books.pdf`, base64)
      if (!saved) throw new Error('The PDF could not be saved.')
      if (email && window.desktop.draftEmail) {
        const when = takenAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        const text = ['Hi Jonathan,', '', `Attached is the On the Books snapshot as of ${when} — open jobs, quotes and what's left to bill.`, '', 'Thanks,', 'Dustin'].join('\n')
        const r = await window.desktop.draftEmail({ to: JONATHAN, subject: `On the Books snapshot - ${when}`, text, attachments: [saved] })
        if (r && !r.ok) throw new Error(r.error || 'Could not open an email.')
        setExportState({ busy: false, err: '', msg: r && r.method === 'eml' ? 'Email to Jonathan is ready in Outlook with the snapshot attached — check it and press Send.' : 'An email to Jonathan is open, and the PDF is highlighted in File Explorer. Drag it into the email to attach it.' })
      } else {
        window.desktop.openFile(saved)
        setExportState({ busy: false, err: '', msg: `Saved to ${saved} in your data folder.` })
      }
    } catch (e) {
      setExportState({ busy: false, msg: '', err: e.message || 'Export failed.' })
    }
  }

  function openFix(c) {
    if (!window.desktop) return
    if (c.q) { const jc = quoteJobsCustomer(c.q); if (jc) window.desktop.openCustomerWindow(jc.id, null, { quoteId: c.q.id }); return }
    if (c.defic && window.desktop.openDeficienciesWindow) { window.desktop.openDeficienciesWindow(c.customer.id); return }
    openJob(c.p, c.customer, c.focus)
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r, 10px)', overflow: 'hidden' }
  const head = { padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }
  const h2 = { fontSize: 15, fontWeight: 800, color: 'var(--text)' }
  const sub = { fontSize: 12, color: 'var(--text-light)' }
  const th = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-light)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--surface)' }
  const td = { padding: '8px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border-light, #eef1f4)', verticalAlign: 'top', color: 'var(--text-mid)' }
  const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  const chip = (text, color, bg) => <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color, background: bg, whiteSpace: 'nowrap' }}>{text}</span>
  const statusChip = s => s === 'Active' ? chip(s, '#1e7a34', '#e6f4ea') : s === 'Deficiencies' ? chip(s, '#9a6610', '#fff4dd') : s === 'Needs review' ? chip(s, '#b42318', '#fdecea') : chip(s, '#1a5fa0', '#e8f2fc')
  const clickable = { cursor: 'pointer' }

  const xBtn = (onClick, title = 'Dismiss from the Snapshot') => (
    <button onClick={e => { e.stopPropagation(); onClick() }} title={title} aria-label={title}
      style={{ alignSelf: 'flex-start', flexShrink: 0, width: 22, height: 22, lineHeight: '18px', fontSize: 14, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = 'var(--text-light)' }}>×</button>
  )
  const hiddenToggle = kind => (view?.hidden[kind].length > 0) && (
    <button onClick={() => setShowHidden(h => ({ ...h, [kind]: !h[kind] }))} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--accent-dim, #1a5fa0)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {showHidden[kind] ? 'Hide dismissed' : `Show ${view.hidden[kind].length} dismissed`}
    </button>
  )
  // ── Flags: pin a note to the job or quote behind any line ──
  const normName = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const liveJob = id => (jobsHub.records || []).find(p => p.id === id)
  const liveQuote = id => (quotesHub.records || []).find(q => q.id === id)
  function flagTargetFor(kind, x) {
    if (kind === 'job' && x) return { hub: 'jobs', id: x.id, label: x.name }
    if (kind === 'quote' && x) return { hub: 'quotes', id: x.id, label: `${x.quoteNumber}${x.title ? ` ${x.title}` : ''}` }
    if (kind === 'email') {
      const t = x.i.target || {}
      if (t.kind === 'job' && t.name) { const j = (jobsHub.records || []).find(p => !p.trashedAt && normName(p.name) === normName(t.name)); if (j) return flagTargetFor('job', j) }
      if (t.kind === 'quote' && t.quoteNumber) { const q = (quotesHub.records || []).find(q => !q.trashedAt && normName(q.quoteNumber) === normName(t.quoteNumber)); if (q) return flagTargetFor('quote', q) }
      return null
    }
    if (kind === 'date') return x.job ? flagTargetFor('job', x.job.p) : null
    if (kind === 'check') return x.p ? flagTargetFor('job', x.p) : x.q ? flagTargetFor('quote', x.q) : null
    return null
  }
  const [flagFor, setFlagFor] = useState(null) // { hub, id, label, context }
  const [flagText, setFlagText] = useState('')
  async function saveFlag() {
    const text = flagText.trim()
    if (!flagFor || !text) return
    const hub = flagFor.hub === 'jobs' ? jobsHub : quotesHub
    const rec = flagFor.hub === 'jobs' ? liveJob(flagFor.id) : liveQuote(flagFor.id)
    if (!rec) { setFlagFor(null); return }
    await hub.updateRecord(rec.id, addFlagPatch(rec, text, flagFor.context))
    setFlagFor(null); setFlagText('')
  }
  const flagBtn = (target, context) => target && (
    <button onClick={e => { e.stopPropagation(); setFlagFor({ ...target, context }); setFlagText('') }} title={`Flag a note on ${target.label}`} aria-label={`Flag a note on ${target.label}`}
      style={{ alignSelf: 'flex-start', flexShrink: 0, height: 22, padding: '0 6px', fontSize: 12, background: 'none', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', opacity: 0.75 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.opacity = 1 }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.opacity = 0.75 }}>🚩</button>
  )
  // Open flags already on a job or quote, shown beside its name.
  const flagChip = rec => {
    const f = openFlags(rec)
    if (!f.length) return null
    return <span title={f.map(x => `🚩 ${x.text}`).join('\n')} style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, padding: '1px 7px', borderRadius: 20, background: '#fff4dd', color: '#9a6610', border: '1px solid #f1d590', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>🚩 {f.length}</span>
  }

  const restoreBtn = key => (
    <button onClick={e => { e.stopPropagation(); restore(key) }} style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Restore</button>
  )

  if (!snap) return <div style={{ padding: 30, color: 'var(--text-light)' }}>Building your snapshot…</div>
  const maxBill = Math.max(1, ...snap.months.map(m => snap.billing[m]))

  return (
    <div style={{ padding: 20, maxWidth: 1200, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontFamily: 'var(--font-d)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Snapshot</div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 2 }}>
            <b>{money0(snap.leftToBill)}</b> left to bill on {snap.jobsWithMoney} jobs. <b>{money0(snap.sentTotal)}</b> quoted and waiting on customers
            {snap.unsentTotal > 0 && <>, plus <b>{money0(snap.unsentTotal)}</b> quoted but not sent yet</>}.
          </div>
          <div style={sub}>As of {takenAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, from your jobs, quotes, billing, notes and email notes.</div>
        </div>
        <div style={{ position: 'relative' }}>
          <button onClick={() => { setExportOpen(o => !o); setExportState({ busy: false, msg: '', err: '' }) }} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', border: '1px solid var(--navy)', background: 'var(--surface)', color: 'var(--navy)' }}>📄 Export ▾</button>
          {exportOpen && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 32px rgba(15,30,46,.22)', padding: 12, display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>Export a PDF</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>Always includes the totals, jobs on the books and open quotes. Also include:</div>
              {[['jobNotes', 'Job notes under each job'], ['billing', 'Billed by month'], ['dates', 'Coming up'], ['notes', 'Project notes from email'], ['checks', 'Worth fixing (app corrections)']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-mid)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!exportOpts[k]} onChange={e => setExportOpts(o => ({ ...o, [k]: e.target.checked }))} />{label}
                </label>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <button disabled={exportState.busy} onClick={() => exportPdf(true)} style={{ flex: 1, padding: '7px 10px', fontSize: 12, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', border: '1px solid var(--navy)', background: 'var(--navy)', color: '#fff', opacity: exportState.busy ? 0.6 : 1 }}>✉ Email to Jonathan</button>
                <button disabled={exportState.busy} onClick={() => exportPdf(false)} style={{ padding: '7px 10px', fontSize: 12, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', opacity: exportState.busy ? 0.6 : 1 }}>Save PDF</button>
              </div>
              {exportState.busy && <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>Making the PDF…</div>}
              {exportState.msg && <div style={{ fontSize: 11.5, color: '#1e7a34' }}>{exportState.msg}</div>}
              {exportState.err && <div style={{ fontSize: 11.5, color: '#b42318' }}>{exportState.err}</div>}
            </div>
          )}
        </div>
        <button onClick={refresh} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', border: '1px solid var(--navy)', background: 'var(--navy)', color: '#fff' }}>↻ Refresh</button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {[
          ['Left to bill on active jobs', money0(snap.leftToBill), `${snap.jobsWithMoney} jobs`],
          [`Billed in ${longMonth(snap.thisMonth)}`, money0(snap.billing[snap.thisMonth]), `${longMonth(snap.lastMonth)} was ${money0(snap.billing[snap.lastMonth])}`],
          ['Quotes sent, waiting', money0(snap.sentTotal), `${snap.sentCount} quotes out`],
          ['Quoted, not sent yet', money0(snap.unsentTotal), `${snap.unsentCount} quotes`],
        ].map(([label, value, note]) => (
          <div key={label} style={{ ...card, padding: '12px 14px' }}>
            <div style={sub}>{label}</div>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 26, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={sub}>{note}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={head}><span style={h2}>On the books</span><span style={sub}>Every job not marked Complete (Billed). Click a job to open it.</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Job', 'Customer', 'Status', 'CO / PO', 'Value', 'Billed', 'Left to bill', 'Start', 'Finish', ''].map((h, i) => <th key={i} style={{ ...th, textAlign: ['Value', 'Billed', 'Left to bill'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {snap.onBooks.length === 0 && <tr><td style={td} colSpan={10}>Nothing on the books.</td></tr>}
              {snap.onBooks.map(r => (
                <tr key={r.p.id} onClick={() => openJob(r.p, r.customer)} style={clickable}>
                  <td style={{ ...td, fontWeight: 700, color: 'var(--text)' }}>{r.p.name}{flagChip(liveJob(r.p.id) || r.p)}{r.p.notes && <div style={{ fontWeight: 400, color: 'var(--text-light)', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{String(r.p.notes).trim().slice(0, 140)}</div>}</td>
                  <td style={td}>{r.customer?.name}</td>
                  <td style={td}>{statusChip(r.status)}</td>
                  <td style={td}>{r.p.co || ''}</td>
                  <td style={num}>{r.value ? money(r.value) : '—'}{r.fromQuote && <div style={{ fontSize: 10.5, color: 'var(--text-light)' }}>from quote</div>}</td>
                  <td style={num}>{money(r.billed)}</td>
                  <td style={{ ...num, fontWeight: 800, color: 'var(--text)' }}>{money(r.left)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDay(r.p.dateStart)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDay(r.p.dateComplete)}</td>
                  <td style={{ ...td, width: 34 }}>{flagBtn(flagTargetFor('job', r.p), 'On the books')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={head}><span style={h2}>Open quotes</span><span style={sub}>Not approved or voided, largest first. One line per quote.</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Quote', 'Project', 'Customer', 'Amount', 'Status', 'Sent', 'Days out', ''].map((h, i) => <th key={i} style={{ ...th, textAlign: ['Amount', 'Days out'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {snap.open.length === 0 && <tr><td style={td} colSpan={8}>No open quotes.</td></tr>}
              {snap.open.map(r => (
                <tr key={r.q.id} style={r.dupOf ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...td, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.q.quoteNumber}{flagChip(liveQuote(r.q.id) || r.q)}</td>
                  <td style={td}>{r.q.title}</td>
                  <td style={td}>{r.customer?.name}</td>
                  <td style={{ ...num, fontWeight: 700, color: 'var(--text)' }}>{r.total ? money(r.total) : 'Not priced'}</td>
                  <td style={td}>{chip(r.state, ...QUOTE_CHIP[r.state])}{r.dupOf && <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>Older version of {r.dupOf}, not counted</div>}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDay(r.q.sentDate)}</td>
                  <td style={{ ...num, color: 'var(--text-mid)' }}>{r.sent && r.age != null ? r.age : ''}{r.sent && r.age > REPRICE_DAYS && <div style={{ fontSize: 10.5, color: 'var(--text-light)', fontWeight: 500, whiteSpace: 'nowrap' }}>re-price if it comes back</div>}</td>
                  <td style={{ ...td, width: 34 }}>{flagBtn(flagTargetFor('quote', r.q), 'Open quotes')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        <div style={card}>
          <div style={head}><span style={h2}>Coming up</span><span style={sub}>Next {AHEAD_DAYS} days, from job dates and dates written in your notes and email.</span>{hiddenToggle('dates')}</div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {view.upcoming.length === 0 && <div style={{ ...td, borderBottom: 'none' }}>No dates found.</div>}
            {[...view.upcoming, ...(showHidden.dates ? view.hidden.dates : [])].map((u, k) => {
              const key = keyOf.dates(u), gone = !!dismissed?.[key]
              return (
              <div key={key} onClick={() => u.job && openJob(u.job.p, u.job.customer)} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderBottom: '1px solid var(--border-light, #eef1f4)', ...(u.job ? clickable : {}), ...(gone ? { opacity: 0.5 } : {}) }}>
                <div style={{ width: 92, flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{fmtDayLong(u.date)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{u.what}</div>
                  {u.details.map((d, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-mid)' }}>{d}</div>)}
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{u.sources.join(' · ')}</div>
                </div>
                {flagBtn(flagTargetFor('date', u), `Coming up ${fmtDay(u.date)}`)}
                {gone ? restoreBtn(key) : xBtn(() => dismiss(key))}
              </div>
            )})}
          </div>
        </div>

        <div style={card}>
          <div style={head}><span style={h2}>Billed by month</span><span style={sub}>From each job's billing history.</span></div>
          <div style={{ padding: '14px 14px 10px', display: 'grid', gap: 8 }}>
            {snap.months.map(m => (
              <div key={m} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-light)', fontWeight: 700 }}>{fmtMonth(m)}</span>
                <span style={{ height: 16, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(snap.billing[m] / maxBill) * 100}%`, background: m === snap.thisMonth ? 'var(--accent)' : 'var(--navy)', borderRadius: 4 }} />
                </span>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--text)' }}>{money0(snap.billing[m])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={head}><span style={h2}>Project notes from email</span><span style={sub}>Last {EMAIL_NOTE_DAYS} days from the morning email run. Notes you dismissed in Assistant Update are left out.</span>{hiddenToggle('email')}</div>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {!window.desktop?.emailNotesLoad && <div style={td}>Only available in the desktop app.</div>}
          {window.desktop?.emailNotesLoad && view.recentEmail.length === 0 && <div style={td}>No email notes in the last {EMAIL_NOTE_DAYS} days.</div>}
          {[...view.recentEmail, ...(showHidden.email ? view.hidden.email : [])].map(r => { const { i, reviewed, text } = r; const key = keyOf.email(r), gone = !!dismissed?.[key]; return (
            <div key={i.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light, #eef1f4)', display: 'flex', gap: 12, ...(gone ? { opacity: 0.5 } : {}) }}>
              <div style={{ width: 92, flexShrink: 0, fontSize: 12, color: 'var(--text-light)' }}>{fmtDay(i.date)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                  {i.target?.name || i.target?.quoteNumber || i.targetLabel || 'Miscellaneous'} {!reviewed && chip('Not reviewed', '#9a6610', '#fff4dd')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>{text}</div>
                <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{i.from}{i.subject ? ` · “${i.subject}”` : ''}</div>
              </div>
              {i.webLink && window.desktop?.openExternal && (
                <button onClick={() => window.desktop.openExternal(i.webLink)} style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Open email →</button>
              )}
              {flagBtn(flagTargetFor('email', r), `Email from ${i.from || 'unknown'}${i.date ? `, ${fmtDay(i.date)}` : ''}`)}
              {gone ? restoreBtn(key) : xBtn(() => dismiss(key))}
            </div>
          )})}
        </div>
      </div>

      <div style={card}>
        <div style={head}><span style={h2}>Worth fixing</span><span style={sub}>Where the app's numbers don't add up, plus open deficiencies. Click one to go straight to it.</span>{hiddenToggle('checks')}</div>
        <style>{'.snap-fix:hover td { background: var(--surface-2); }'}</style>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Job or quote', "What's off", 'Amount', ''].map((h, i) => <th key={i} style={{ ...th, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {view.checks.length === 0 && <tr><td style={td} colSpan={4}>Nothing to fix.</td></tr>}
              {[...view.checks, ...(showHidden.checks ? view.hidden.checks : [])].map(c => {
                const ok = canFix(c)
                const key = keyOf.checks(c), gone = !!dismissed?.[key]
                return (
                  <tr key={key} onClick={() => ok && openFix(c)} style={{ ...(ok ? clickable : {}), ...(gone ? { opacity: 0.5 } : {}) }} className={ok ? 'snap-fix' : undefined}>
                    <td style={{ ...td, fontWeight: 700, color: ok ? 'var(--accent-dim, #1a5fa0)' : 'var(--text)', textDecoration: ok ? 'underline' : 'none', textUnderlineOffset: 3 }}>{c.what}</td>
                    <td style={td}>{c.issue}</td>
                    <td style={num}>{c.amount ? money(c.amount) : ''}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {ok && <button onClick={e => { e.stopPropagation(); openFix(c) }} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>{c.fix || 'Open'} →</button>}
                        {flagBtn(flagTargetFor('check', c), `Worth fixing: ${c.issue}`)}
                        {gone ? restoreBtn(key) : xBtn(() => dismiss(key))}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {flagFor && (
        <div onClick={() => setFlagFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 100%)', background: 'var(--surface)', borderRadius: 12, boxShadow: '0 20px 48px rgba(15,30,46,.3)', padding: 16, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🚩 Flag a note on {flagFor.hub === 'jobs' ? 'job' : 'quote'}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-mid)' }}>{flagFor.label}</div>
            {flagFor.context && <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>From: {flagFor.context}</div>}
            <textarea autoFocus value={flagText} onChange={e => setFlagText(e.target.value)} rows={4} placeholder="What needs attention?"
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveFlag(); if (e.key === 'Escape') setFlagFor(null) }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--rs)', resize: 'vertical' }} />
            <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>Shows at the top of the {flagFor.hub === 'jobs' ? 'job' : 'quote'} until you mark it done, and is saved in its notes.</div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => setFlagFor(null)} style={{ padding: '7px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
              <button disabled={!flagText.trim()} onClick={saveFlag} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', border: '1px solid var(--navy)', background: 'var(--navy)', color: '#fff', cursor: 'pointer', opacity: flagText.trim() ? 1 : 0.5 }}>🚩 Flag it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
