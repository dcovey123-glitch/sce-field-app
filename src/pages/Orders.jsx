import React, { useState, useEffect, useCallback } from 'react'
import { mergeOrders, groupOrders, groupByFiling, previousOrders, FILE_TYPES, fileType, STALE_DAYS, quoteNumbersOf, checkQuoteSlips, orderParts, checkPoEmails, refsOf, isFiledOrder, refreshFeed } from '../api/orders.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { poStatus } from '../api/billingCheck.js'
import { groupMonthDist } from '../api/monthDist.js'
import { FlagButton, FlagNote } from '../components/Flags.jsx'
import { useFlags, readFlagJump } from '../api/flags.js'
import { EXPORT_EXTRA_KEY, exportWeekKey, normPoKeyTs } from '../api/timesheetExport.js'
import { money, fmtDate as fmtDateShared } from '../api/format.js'
import { useApiKey } from '../api/ai.js'

// ── Orders & POs: wholesaler quotes → Jonathan's PO → order → received ──
// The list comes from Claude's morning email run (orders.json in the
// "Field App" OneDrive folder). Changes made here are saved next to it in
// orders-app.json, and the next run leaves those rows alone.

const isDesktop = typeof window !== 'undefined' && !!window.desktop

const STATUS_STYLE = {
  'Requested':    { bg: 'var(--gray-light)', fg: 'var(--text-mid)' },
  'Quote in':     { bg: 'var(--blue-bg)',    fg: 'var(--blue-dark)' },
  'PO requested': { bg: 'var(--purple-bg)',  fg: 'var(--purple)' },
  'Ordered':      { bg: 'var(--accent-bg)',  fg: 'var(--accent-dim)' },
  'Received':     { bg: 'var(--green-bg)',   fg: 'var(--green-dark)' },
  'Closed':       { bg: 'var(--gray-light)', fg: 'var(--text-light)' },
}

const fmtDate = d => fmtDateShared(d) || d || ''

function fmtUpdated(iso, mtime) {
  const t = iso ? Date.parse(iso) : mtime
  if (!t || isNaN(t)) return ''
  return new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const btn = (kind) => ({
  padding: '6px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 'var(--rs)', cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'primary' ? '1px solid var(--navy)' : '1px solid var(--border)',
  background: kind === 'primary' ? 'var(--navy)' : 'var(--surface)',
  color: kind === 'primary' ? '#fff' : 'var(--text)',
})

function StatusPill({ status }) {
  const st = STATUS_STYLE[status] || STATUS_STYLE.Requested
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

// Filing panel: what this order is for (a quote, a job, stock…) plus a note.
function FileEditor({ o, refOptions, onSave, onCancel }) {
  const [filedAs, setFiledAs] = useState(o.filedAs || 'quote')
  const [ref, setRef] = useState(refsOf(o).length > 1 ? '' : (o.ref || ''))
  // "Material for job" can be several jobs — chips, plus the one being typed
  const [jobs, setJobs] = useState(() => refsOf(o).length > 1 ? refsOf(o) : [])
  const addJob = () => { const r = ref.trim(); if (r && !jobs.some(j => j.toLowerCase() === r.toLowerCase())) setJobs(js => [...js, r]); setRef('') }
  const [note, setNote] = useState(o.note || '')
  const t = fileType(filedAs)
  const options = refOptions[filedAs] || []
  const listId = `orders-ref-${o.id}`
  // One PO can cover several quotes: let each quote # go to its own job.
  const numbers = quoteNumbersOf(o)
  const [parts, setParts] = useState(() => {
    const init = {}
    for (const n of numbers) {
      const pf = (o.partFilings || {})[n]
      init[n] = pf && 'filedAs' in pf ? { filedAs: pf.filedAs || '', ref: pf.ref || '' } : { filedAs: 'same', ref: '' }
    }
    return init
  })
  const [split, setSplit] = useState(() => numbers.some(n => { const pf = (o.partFilings || {})[n]; return pf && 'filedAs' in pf }))
  const setPart = (n, patch) => setParts(p => ({ ...p, [n]: { ...p[n], ...patch } }))

  function labelFor(type, r) {
    const m = (refOptions[type] || []).find(x => x.value.toLowerCase() === r.toLowerCase())
    return m ? m.label : ''
  }

  function save() {
    const r = ref.trim()
    const outParts = {}
    if (split) {
      for (const n of numbers) {
        const pp = parts[n]
        if (!pp || pp.filedAs === 'same') continue
        const pt = fileType(pp.filedAs)
        const pr = (pp.ref || '').trim()
        outParts[n] = { filedAs: pp.filedAs, ref: pt && pt.refLabel ? pr : '', refLabel: pt && pt.refLabel ? labelFor(pp.filedAs, pr) : '' }
      }
    }
    // Several jobs: everything chosen plus whatever is still typed in the box
    const many = filedAs === 'job' ? [...new Set([...jobs, r].filter(Boolean))] : []
    if (many.length > 1) {
      onSave({ filedAs: 'job', ref: many[0], refs: many, refLabel: '', note: note.trim(), parts: outParts })
      return
    }
    // A quote/job filing with no name is no filing (common when only splitting).
    const one = many[0] || r
    const mainType = t.refLabel && !one ? '' : filedAs
    onSave({ filedAs: mainType, ref: mainType && t.refLabel ? one : '', refs: [], refLabel: mainType && t.refLabel ? labelFor(filedAs, one) : '', note: note.trim(), parts: outParts })
  }

  const field = { padding: '6px 9px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface)' }
  return (
    <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }}
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>{split ? 'Anything not split, file as' : 'File as'}</span>
        <select value={filedAs} onChange={e => setFiledAs(e.target.value)} style={field}>
          {FILE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
        </select>
        {t.refLabel && (
          <>
            <input
              autoFocus list={listId} value={ref} onChange={e => setRef(e.target.value)}
              placeholder={filedAs === 'quote' ? 'Quote # (e.g. Q-RDP-2026-094)' : filedAs === 'job' ? 'Job name' : 'Label'}
              onKeyDown={e => { if (e.key === 'Enter') { if (filedAs === 'job' && jobs.length) addJob(); else save() } }}
              style={{ ...field, width: 260 }}
            />
            <datalist id={listId}>
              {options.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
            </datalist>
            {filedAs === 'job' && (
              <button style={btn()} onClick={addJob} title="This PO covers material for more than one job">+ Another job</button>
            )}
          </>
        )}
        {split && <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>(leave the name blank if every quote # is split off below)</span>}
      </div>
      {filedAs === 'job' && jobs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '-2px 0 8px' }}>
          <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Jobs on this PO:</span>
          {jobs.map(j => (
            <span key={j} style={{ fontSize: 12, fontWeight: 700, padding: '2px 4px 2px 9px', borderRadius: 20, background: 'var(--blue-bg)', color: 'var(--blue-dark)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {j}<button onClick={() => setJobs(js => js.filter(x => x !== j))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--blue-dark)', fontSize: 12, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      {numbers.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', cursor: 'pointer' }}>
            <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} style={{ width: 14, height: 14 }} />
            Split by quote # — this order covers {numbers.length} quotes; send each to its own job
          </label>
          {split && (
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              {numbers.map(n => {
                const pp = parts[n] || { filedAs: 'same', ref: '' }
                const pt = fileType(pp.filedAs)
                const plist = `orders-part-${o.id}-${n}`
                return (
                  <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 20 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 90 }}>{n}</span>
                    <select value={pp.filedAs} onChange={e => setPart(n, { filedAs: e.target.value })} style={field}>
                      <option value="same">Same as the order</option>
                      {FILE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                    </select>
                    {pt && pt.refLabel && (
                      <>
                        <input list={plist} value={pp.ref} onChange={e => setPart(n, { ref: e.target.value })}
                          placeholder={pp.filedAs === 'quote' ? 'Quote #' : pp.filedAs === 'job' ? 'Job name' : 'Label'}
                          onKeyDown={e => { if (e.key === 'Enter') save() }}
                          style={{ ...field, width: 240 }} />
                        <datalist id={plist}>
                          {(refOptions[pp.filedAs] || []).map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                        </datalist>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          style={{ ...field, flex: 1 }}
        />
        <button style={btn('primary')} onClick={save}>Save</button>
        {(o.filedAs || o.note || Object.keys(o.partFilings || {}).length > 0) && <button style={btn()} onClick={() => onSave({ filedAs: '', ref: '', refLabel: '', note: '', parts: {} })} title="Remove the filing and note">Clear</button>}
        <button style={btn()} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function FiledChip({ o }) {
  const t = fileType(o.filedAs)
  if (!t) return isFiledOrder(o) ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'var(--blue-bg)', color: 'var(--blue-dark)', whiteSpace: 'nowrap' }}>📁 Split by quote #</span> : null
  const many = refsOf(o)
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap',
        background: o.filingSuggested ? 'var(--surface)' : 'var(--blue-bg)', color: 'var(--blue-dark)',
        border: o.filingSuggested ? '1px dashed var(--blue)' : '1px solid transparent' }}
      title={o.filingSuggested ? 'Suggested from your email — use Edit filing to confirm or change' : t.label}>
      📁 {t.label}{many.length > 1 ? `s: ${many.join(' + ')}` : o.ref ? `: ${o.ref}` : ''}{many.length < 2 && o.refLabel ? ` · ${o.refLabel}` : ''}{o.filingSuggested ? ' (suggested)' : ''}
    </span>
  )
}

// Collapsed title bar for one PO / quote: status · date · supplier · PO · what · quick note · quoted
function OrderTitleBar({ o, open, onToggle, onNote, bal }) {
  const { flagOf } = useFlags()
  const flagged = flagOf('po:' + o.id)
  const [note, setNote] = useState(o.note || '')
  useEffect(() => { setNote(o.note || '') }, [o.note])
  const done = o.status === 'Received' || o.status === 'Closed'
  const warn = !done && bal && !bal.balanced && !bal.forced
  const save = () => { if ((note || '').trim() !== (o.note || '')) onNote(note.trim()) }
  const cell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  return (
    <div onClick={onToggle} title={open ? 'Click to close' : 'Click to open'}
      style={{ display: 'grid', gridTemplateColumns: '14px 24px 86px 86px 150px 92px minmax(120px, 1fr) minmax(160px, 1.3fr) 84px', gap: 8, alignItems: 'center', padding: '5px 10px', boxShadow: flagged ? 'inset 4px 0 0 #c0392b' : 'none', border: '1px solid ' + (open ? '#9fb8d6' : '#c9d7e8'), borderRadius: open ? '6px 6px 0 0' : 6, background: open ? '#d3e1f1' : '#e6eef8', cursor: 'pointer', opacity: done && !open ? 0.7 : 1, fontSize: 12.5 }}>
      <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
      <FlagButton refId={'po:' + o.id} info={{ kind: 'po', title: o.description || 'Material', sub: [o.supplier, o.poNumber ? 'PO ' + o.poNumber : 'no PO', o.quoteNumber ? 'Quote ' + o.quoteNumber : ''].filter(Boolean).join(' · '), q: o.poNumber || String(o.quoteNumber || '').split(/[,;]/)[0].trim(), date: o.date, archived: !!o.archived }} />
      <span style={cell}><StatusPill status={o.status} /></span>
      <span style={{ ...cell, color: 'var(--text-mid)' }}>{o.date ? String(o.date).slice(0, 10) : '—'}</span>
      <span style={{ ...cell, fontWeight: 700 }} title={o.supplier || ''}>{o.supplier || '—'}</span>
      <span style={{ ...cell, fontWeight: 800, color: o.poNumber ? 'var(--navy)' : 'var(--text-light)' }}>{o.poNumber ? `PO ${o.poNumber}` : 'no PO'}{warn ? <span title={(bal.reasons || []).join('\n')} style={{ color: '#9a6610', marginLeft: 4 }}>⚠</span> : null}</span>
      <span style={{ ...cell, color: 'var(--text)' }} title={[o.description, o.job].filter(Boolean).join(' — ')}>{o.description || 'Material'}{o.job ? <span style={{ color: 'var(--text-light)' }}> — {o.job}</span> : null}</span>
      {flagged && flagged.note ? <span title={flagged.note} style={{ ...cell, color: '#a12a1e', fontWeight: 700, fontSize: 12 }}>⚑ {flagged.note}</span> : <input value={note} placeholder="Quick note…" onClick={e => e.stopPropagation()} onChange={e => setNote(e.target.value)} onBlur={save}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setNote(o.note || ''); e.currentTarget.blur() } }}
        style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 7px', background: note ? 'var(--yellow, #fff8d6)' : 'var(--surface)', minWidth: 0, fontFamily: 'var(--font)' }} />}
      <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-mid)' }}>{Number(o.quoteTotal) ? money(o.quoteTotal) : ''}</span>
    </div>
  )
}

function OrderRow(props) {
  const { o, isOpen, onToggleOpen, onSetNote, balanceOf } = props
  if (!onToggleOpen) return <OrderRowBody {...props} />
  const open = isOpen(o.id)
  const bal = o.poNumber && balanceOf ? balanceOf(o) : null
  return (
    <div>
      <OrderTitleBar o={o} open={open} bal={bal} onToggle={() => onToggleOpen(o.id)} onNote={n => onSetNote(o.id, n)} />
      {open && <div style={{ border: '1px solid #9fb8d6', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden', marginBottom: 4 }}><OrderRowBody {...props} /></div>}
    </div>
  )
}

function OrderRowBody({ o, exportStateOf, onPushExport, onSetPricing, onSetStatus, onSetFiling, onForceReceived, onSetPo, balanceOf, refOptions, hideFiled, embedded, renderExtra, onFixReason }) {
  const [editing, setEditing] = useState(false)
  const [poDraft, setPoDraft] = useState(null) // typing a PO # by hand
  const [forcing, setForcing] = useState(null) // reason text while the force box is open
  const bal = o.poNumber && balanceOf ? balanceOf(o) : null
  const done = o.status === 'Received' || o.status === 'Closed'
  const quoted = Number(o.quoteTotal) ? `Quoted ${money(o.quoteTotal)}` : ''
  const before = [o.supplier, o.contact].filter(Boolean).join(' · ')
  const after = [quoted, fmtDate(o.date)].filter(Boolean).join(' · ')
  // Quote numbers on this row: from the run's links, or split the quote # text.
  const numbers = (Array.isArray(o.quoteLinks) && o.quoteLinks.length
    ? o.quoteLinks.map(l => l && l.number)
    : String(o.quoteNumber || '').split(/[,;]+/)
  ).map(n => String(n || '').trim()).filter(Boolean)
  const [quoteMsg, setQuoteMsg] = useState(null)
  const [msgNumber, setMsgNumber] = useState('')
  // No PDF in Quote Slips yet: pick it (e.g. saved from Outlook) and file it there.
  const attachQuote = async () => {
    if (!window.desktop?.ordersAttachQuoteFile || !msgNumber) return
    const r = await window.desktop.ordersAttachQuoteFile(msgNumber)
    if (r && r.ok) { setQuoteMsg(null); openQuote(msgNumber); window.dispatchEvent(new Event('orders-slips-changed')) }
    else if (r && r.reason !== 'canceled') setQuoteMsg(`Couldn't add that PDF (${r.error || r.reason}).`)
  }
  // Open the supplier's quote PDF from "Field App/Quote Slips" (saved there by
  // the Power Automate flow). If the order isn't filed yet (or only suggested),
  // open the filing box too so it can go under a job or quote right away.
  const openQuote = async number => {
    setQuoteMsg(null)
    setMsgNumber(number)
    if (!window.desktop?.ordersOpenQuoteFile) return
    const r = await window.desktop.ordersOpenQuoteFile(number)
    if (r && r.ok) {
      if (!o.archived && (!isFiledOrder(o) || o.filingSuggested)) setEditing(true)
      return
    }
    const why = r?.reason === 'open-failed'
      ? `Found ${number} but Windows couldn't open it (${r.error}). Set a default PDF viewer, or open it from the Quote Slips folder.`
      : r?.reason === 'no-folder'
        ? 'Choose the Field App folder first.'
        : `Quote ${number} isn't in Quote Slips yet. Save the PDF from the email (or Downloads) and pick it here, and it's filed in Quote Slips for good.`
    setQuoteMsg(why)
  }
  const quoteLabel = numbers.length
    ? <>{o.quoteNumber && /^order/i.test(o.quoteNumber) ? '' : 'Quote '}{numbers.map((n, i) => (
        <span key={n + i}>{i > 0 && ', '}
          <a href="#" onClick={e => { e.preventDefault(); openQuote(n) }}
            title="Open the quote PDF from Quote Slips" style={{ color: 'var(--blue, #2563eb)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
            {n}
          </a>
        </span>
      ))}</>
    : null
  const meta = [before, quoteLabel, after].filter(Boolean)

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', opacity: done ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <StatusPill status={o.status} />
            {poDraft !== null ? (
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input autoFocus value={poDraft} onChange={e => setPoDraft(e.target.value)} placeholder="PO #"
                  onKeyDown={e => { if (e.key === 'Enter') { onSetPo(o.id, poDraft); setPoDraft(null) } if (e.key === 'Escape') setPoDraft(null) }}
                  style={{ width: 90, fontSize: 12, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                <button style={btn('primary')} onClick={() => { onSetPo(o.id, poDraft); setPoDraft(null) }}>Save</button>
                <button style={btn()} onClick={() => setPoDraft(null)}>Cancel</button>
              </span>
            ) : o.poNumber ? (
              <span onClick={() => !o.archived && setPoDraft(o.poNumber)} title={o.poFromApp ? 'PO # you added — click to change' : 'Click to change the PO #'}
                style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: 'var(--navy)', color: '#fff', cursor: o.archived ? 'default' : 'pointer' }}>PO {o.poNumber}{o.poFromApp ? ' ✎' : ''}</span>
            ) : !o.archived && (
              <button onClick={() => setPoDraft('')} title="Got a PO from Jonathan? Add it here"
                style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, border: '1px dashed var(--navy)', background: 'none', color: 'var(--navy)', cursor: 'pointer' }}>+ PO #</button>
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{o.description || 'Material'}</span>
            {o.job && <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>— {o.job}</span>}
            {!hideFiled && <FiledChip o={o} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
            {meta.map((m, i) => <span key={i}>{i > 0 && ' · '}{m}</span>)}
          </div>
          {Object.keys(o.partFilings || {}).length > 0 && (
            <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(o.partFilings).map(([n, pf]) => {
                const pt = fileType(pf.filedAs)
                return (
                  <span key={n} style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--blue-bg)', color: 'var(--blue-dark)' }}>
                    {n} → {pt ? pt.label : 'not filed'}{pf.ref ? `: ${pf.ref}` : ''}
                  </span>
                )
              })}
            </div>
          )}
          {quoteMsg && (
            <div style={{ fontSize: 12, marginTop: 5, padding: '5px 8px', background: 'var(--surface-2, #f3f4f6)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>📄 {quoteMsg}</span>
              {window.desktop?.ordersAttachQuoteFile && msgNumber && <button style={btn('primary')} onClick={attachQuote}>Pick the PDF…</button>}
              <button style={btn()} onClick={() => window.desktop?.ordersOpenQuoteSlips?.()}>Open Quote Slips</button>
              <button style={btn()} onClick={() => setQuoteMsg(null)}>OK</button>
            </div>
          )}
          {o.nextStep && !done && !o.archived && (
            <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 5 }}>
              <b style={{ color: 'var(--text)' }}>Next:</b> {o.nextStep}
            </div>
          )}
          {embedded ? null : bal && bal.slips.length > 0 ? (
            <div style={{ fontSize: 12, color: 'var(--green-dark)', marginTop: 5 }}>
              🧾 Slips in Materials:{' '}
              {bal.slips.map((sl, i) => {
                const lines = sl.lineItems || []
                const rec = lines.filter(li => li.received).length
                const tot = lines.reduce((a, li) => a + (Number(li.totalPrice) || 0), 0)
                return <span key={sl.id}>{i > 0 && ' · '}{sl.wholesaler || ''}{sl.invoiceNumber ? ` Inv ${sl.invoiceNumber}` : ''} ${tot.toFixed(2)}{rec === lines.length && lines.length ? ' (received)' : ` (${rec} of ${lines.length} received)`}</span>
              })}
            </div>
          ) : o.slip && (
            <div style={{ fontSize: 12, color: 'var(--green-dark)', marginTop: 5 }}>
              🧾 Packing slip{o.slip.invoiceNumber ? ` Inv ${o.slip.invoiceNumber}` : ''} saved in Materials {fmtDate(o.slip.at)}
            </div>
          )}
          {bal && !o.archived && (o.status === 'Ordered' || o.status === 'Received' || bal.slips.length > 0) && (
            <div style={{ fontSize: 12, marginTop: 5, color: bal.forced ? '#9a6610' : bal.balanced ? 'var(--green-dark)' : '#9a6610' }}>
              ⚖ {bal.forced ? `Forced received${bal.forced.reason ? ` — ${bal.forced.reason}` : ''}`
                : bal.balanced ? `Quote and ${bal.slips.length} slip${bal.slips.length === 1 ? '' : 's'} balance`
                : <>Not balanced yet: {bal.reasons.map((r, k) => {
                    const go = /waiting for the packing slips/.test(r) && !onFixReason ? () => setForcing('') : onFixReason ? () => (/waiting for the packing slips/.test(r) && !(bal.slips || []).length ? setForcing('') : onFixReason(bal, r)) : null
                    return <span key={k}>{k > 0 && ' · '}{go
                      ? <button onClick={go} title="Click to go fix it" style={{ font: 'inherit', color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline dotted' }}>{r} →</button>
                      : r}</span>
                  })}</>}
            </div>
          )}
          {forcing !== null && (
            <div style={{ fontSize: 12, marginTop: 6, padding: '7px 9px', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 'var(--rs)' }}>
              <div style={{ marginBottom: 5 }}>The quote and slips don't balance yet{bal && bal.reasons.length ? ` (${bal.reasons.join(' · ')})` : ''}. Force it received anyway?</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <input autoFocus value={forcing} onChange={e => setForcing(e.target.value)} placeholder="Why? e.g. picked up at the counter, no slip"
                  onKeyDown={e => { if (e.key === 'Enter') { onForceReceived(o.id, forcing); setForcing(null) } if (e.key === 'Escape') setForcing(null) }}
                  style={{ flex: 1, minWidth: 200, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px' }} />
                <button style={btn('primary')} onClick={() => { onForceReceived(o.id, forcing); setForcing(null) }}>Force received</button>
                <button style={btn()} onClick={() => setForcing(null)}>Cancel</button>
              </div>
            </div>
          )}
          <FlagNote refId={'po:' + o.id} />
          {o.note && !editing && (
            <div style={{ fontSize: 12.5, marginTop: 5, padding: '5px 8px', background: 'var(--yellow)', border: '1px solid var(--yellow-border)', borderRadius: 'var(--rs)' }}>
              📝 {o.note}
            </div>
          )}
          {editing && (
            <FileEditor o={o} refOptions={refOptions}
              onSave={f => { onSetFiling(o.id, f); setEditing(false) }}
              onCancel={() => setEditing(false)} />
          )}
        </div>
        {!editing && !o.archived && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button style={btn()} onClick={() => setEditing(true)} title="File under a quote or job, and add a note">{o.filedAs || o.note || Object.keys(o.partFilings || {}).length ? (o.filingSuggested ? 'Confirm filing' : 'Edit filing') : 'File / note'}</button>
            {o.status === 'Ordered' && <button style={btn('primary')} title={bal && !bal.balanced ? 'The quote and slips don\u2019t balance yet: you can force it' : undefined}
              onClick={() => (!bal || bal.balanced) ? onSetStatus(o.id, 'Received') : setForcing('')}>Mark received</button>}
            {onPushExport && o.status === 'Received' && (exportStateOf(o) === 'on'
              ? <button style={{ ...btn(), borderColor: '#1e7a34', color: '#1e7a34' }} onClick={() => onPushExport(o, false)} title="Take it back off this week's timesheet export">✓ On this week's export ✕</button>
              : <button style={btn('primary')} onClick={() => onPushExport(o, true)} title="Put it on this week's timesheet (Received material) — you can edit it there">📤 Push to export</button>)}
            {onSetPricing && !o.poNumber && (o.pricingOnly
              ? <button style={btn()} onClick={() => onSetPricing(o.id, false)} title="Move back to Orders — waiting for a PO">→ Order (waiting for PO)</button>
              : <button style={btn()} onClick={() => onSetPricing(o.id, true)} title="Only for prices — moves to Pricing, checked against the Catalog">💲 Quote for Pricing</button>)}
            {!done && o.status !== 'Ordered' && <button style={btn()} onClick={() => onSetStatus(o.id, 'Closed')} title="Not ordering this one">Close</button>}
            {o.changedHere && <button style={btn()} onClick={() => onSetStatus(o.id, null)} title="Undo your change and go back to what the email run found">Reopen</button>}
          </div>
        )}
      </div>
      {renderExtra && renderExtra(o)}
    </div>
  )
}

function Section({ title, hint, rows, tone, collapsed, onToggle, ...rowProps }) {
  if (rows.length === 0) return null
  return (
    <div style={{ marginBottom: rowProps.onToggleOpen ? 10 : 18, border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: rowProps.onToggleOpen ? '6px 12px' : '9px 14px', background: tone || 'var(--surface-2)', borderBottom: collapsed ? 'none' : '1px solid var(--border)', cursor: onToggle ? 'pointer' : 'default' }}
      >
        <span style={{ fontFamily: 'var(--font-d)', fontSize: rowProps.onToggleOpen ? 14 : 16, fontWeight: 700, color: 'var(--text)' }}>{title} ({rows.length})</span>
        {hint && <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{hint}</span>}
        {onToggle && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-light)' }}>{collapsed ? 'Show ▾' : 'Hide ▴'}</span>}
      </div>
      {!collapsed && rowProps.onToggleOpen && (
        // one full-width tile per PO, newest first — click a tile to open it
        <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 3, background: 'var(--surface)' }}>
          {rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(o => <OrderRow key={o.id} o={o} {...rowProps} />)}
        </div>
      )}
      {!collapsed && !rowProps.onToggleOpen && groupMonthDist(rows, o => o.date, o => o.supplier).map(m => (
        <div key={m.key}>
          <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--navy)', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>{m.label} <span style={{ color: 'var(--text-light)', fontWeight: 600 }}>({m.count})</span></div>
          {m.dists.map(d => (
            <div key={d.key}>
              <div style={{ padding: '4px 14px 4px 22px', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', borderBottom: '1px solid var(--border)' }}>{d.label} <span style={{ color: 'var(--text-light)', fontWeight: 500 }}>· {d.items.length}</span></div>
              {d.items.map(o => <OrderRow key={o.id} o={o} {...rowProps} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// embedded: shown inside Materials → Orders, with each purchase's slips under
// it (renderExtra), the slips with no PO here after the list (footer), and
// Materials' search box instead of this one (query / extraMatch).
export default function Orders({ onAttentionChange, embedded = false, query, extraMatch, renderExtra, footer, onRows, onFixReason, rowFilter, listOnly = false, emptyText = '' }) {
  const [state, setState] = useState({ loading: true })
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [view, setView] = useState(() => { const j = readFlagJump(); if (j && j.kind === 'po' && j.archived) return 'previous'; try { return localStorage.getItem('fieldapp_orders_view') || 'status' } catch { return 'status' } })
  function pickView(v) { setView(v); try { localStorage.setItem('fieldapp_orders_view', v) } catch { /* ignore */ } }

  // Quotes and jobs from the app, offered when filing an order.
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })

  const load = useCallback(async () => {
    if (!isDesktop) { setState({ loading: false, error: 'not-desktop' }); return }
    try {
      const res = await window.desktop.ordersLoad()
      setState({ loading: false, ...res })
    } catch (err) {
      setState({ loading: false, error: 'bad-feed', detail: err.message })
    }
  }, [])

  // ↻ Refresh: re-read the feed, then pick up any quote PDFs that landed in
  // Quote Slips since the last check (new quotes and revised ones).
  const [apiKey] = useApiKey()
  const [slipCheck, setSlipCheck] = useState({ busy: false, msg: '' })
  const [poMsg, setPoMsg] = useState(null) // { applied, unmatched, missing }
  const refresh = useCallback(async () => {
    await load()
    if (!isDesktop) return
    // Jonathan's emails saved by Power Automate → PO numbers onto the quotes
    try {
      const pr = await checkPoEmails()
      setPoMsg(pr)
      if (pr.applied.length) await load()
    } catch { /* ignore */ }
    setSlipCheck({ busy: true, msg: 'Checking Quote Slips for new quotes…' })
    try {
      const r = await checkQuoteSlips(apiKey)
      const parts = []
      if (r.added.length) parts.push(`${r.added.length} new (${r.added.join(', ')})`)
      if (r.revised.length) parts.push(`${r.revised.length} revised (${r.revised.join(', ')})`)
      let msg
      if (r.reason === 'old-app') msg = ''
      else if (r.reason === 'no-quote-slips') msg = 'No Quote Slips folder yet, so only the morning email run updates this list.'
      else if (r.reason) msg = ''
      else if (r.needKey) msg = `${r.pending} new PDF${r.pending === 1 ? '' : 's'} in Quote Slips, but reading them needs your Anthropic API key (the same one Materials uses for slips).`
      else msg = parts.length ? `Picked up from Quote Slips: ${parts.join(', ')}.` : 'Quote Slips checked: nothing new since last time.'
      if (r.errors.length) msg += ` Couldn't read ${r.errors.map(e => e.file).join(', ')} (${r.errors[0].error}).`
      setSlipCheck({ busy: false, msg, at: new Date().toISOString() })
      if (parts.length) await load()
    } catch (e) {
      setSlipCheck({ busy: false, msg: `Couldn't check Quote Slips: ${e.message || e}` })
    }
  }, [load, apiKey])

  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    // another list (or Materials) saved a change: pick it up
    window.addEventListener('orders-local-changed', load)
    return () => { window.removeEventListener('focus', load); window.removeEventListener('orders-local-changed', load) }
  }, [load])

  // Once a quote is filed to a job or one of Dustin's quotes, put a copy of
  // its PDF in that record's Files folder (skipped if it's already there).
  const [copyMsg, setCopyMsg] = useState('')
  const copiedRef = React.useRef(new Set())
  const [slipsTick, setSlipsTick] = useState(0)
  useEffect(() => {
    const bump = () => { copiedRef.current = new Set(); setSlipsTick(t => t + 1) }
    window.addEventListener('orders-slips-changed', bump)
    return () => window.removeEventListener('orders-slips-changed', bump)
  }, [])
  useEffect(() => {
    if (!isDesktop || !window.desktop?.ordersCopyQuoteToRecord || !state.feed) return
    const jobs = (jobsHub.records || []).filter(r => !r.trashedAt && r.folder && r.customerFolder)
    const quotes = (quotesHub.records || []).filter(r => !r.trashedAt && r.folder && r.customerFolder)
    if (!jobs.length && !quotes.length) return
    const norm = x => String(x || '').trim().toLowerCase()
    let cancelled = false
    ;(async () => {
      const copied = []
      for (const o of mergeOrders(state.feed, state.local)) {
        for (const part of orderParts(o)) {
          if (!part.number || !part.ref) continue
          if (!part.ownFiling && o.filingSuggested) continue // only filings you've set or confirmed
          for (const pref of part.refs.length ? part.refs : [part.ref]) {
          const rec = part.filedAs === 'job' ? jobs.find(j => norm(j.name) === norm(pref))
            : part.filedAs === 'quote' ? quotes.find(q => norm(q.quoteNumber) === norm(pref)) : null
          if (!rec) continue
          const hub = part.filedAs === 'job' ? 'Jobs' : 'Quotes'
          const key = `${part.key}>${hub}/${rec.customerFolder}/${rec.folder}`
          if (copiedRef.current.has(key)) continue
          copiedRef.current.add(key)
          const r = await window.desktop.ordersCopyQuoteToRecord({ number: part.number, hub, customerFolder: rec.customerFolder, folder: rec.folder })
          if (r && r.ok && !r.skipped) copied.push(`${part.number} → ${part.filedAs === 'job' ? rec.name : rec.quoteNumber}`)
          if (r && !r.ok && r.reason === 'not-found') copiedRef.current.delete(key) // try again once the PDF lands in Quote Slips
          if (cancelled) return
          }
        }
      }
      if (copied.length && !cancelled) setCopyMsg(`Quote PDF copied to Files: ${copied.join(', ')}.`)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.feed, state.local, jobsHub.records, quotesHub.records, slipsTick])

  // Check Quote Slips once when the page opens (only unseen PDFs are read).
  const checkedOnOpen = React.useRef(false)
  useEffect(() => {
    if (checkedOnOpen.current || state.loading || !state.feed) return
    checkedOnOpen.current = true
    refresh()
  }, [state.loading, state.feed, refresh])

  const refOptions = {
    quote: (quotesHub.records || [])
      .filter(q => !q.trashedAt && q.quoteNumber)
      .sort((a, b) => b.quoteNumber.localeCompare(a.quoteNumber, undefined, { numeric: true }))
      .map(q => ({ value: q.quoteNumber, label: q.title || '' })),
    job: (jobsHub.records || [])
      .filter(p => !p.trashedAt && p.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => ({ value: p.name, label: p.co ? `CO/PO ${p.co}` : '' })),
  }

  const rows = state.feed ? mergeOrders(state.feed, state.local) : []
  const q = (embedded ? String(query || '') : search).trim().toLowerCase()
  const base = rowFilter ? rows.filter(rowFilter) : rows
  const shown = q
    ? base.filter(o => [o.supplier, o.contact, o.quoteNumber, o.poNumber, o.description, o.job, o.nextStep, o.note, o.ref, o.refLabel].join(' ').toLowerCase().includes(q) || (extraMatch && extraMatch(o)))
    : base
  useEffect(() => { if (onRows) onRows(rows) }, [state.feed, state.local]) // eslint-disable-line react-hooks/exhaustive-deps
  const g = groupOrders(shown)

  useEffect(() => {
    if (onAttentionChange && state.feed) onAttentionChange(groupOrders(rows).decide.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.feed, state.local])

  async function saveLocal(mutate) {
    // start from what's on disk — several lists can be open at once
    let fresh = state.local
    try { const r = await window.desktop.ordersLoad(); if (r && r.local) fresh = r.local } catch { /* use what we have */ }
    const local = { version: 1, overrides: {}, ...(fresh || {}) }
    const overrides = { ...(local.overrides || {}) }
    mutate(overrides)
    const next = { ...local, overrides }
    setState(s => ({ ...s, local: next }))
    const ok = await window.desktop.ordersSaveLocal(next)
    if (!ok) alert('Could not save that change. Check that the Field App folder is still there.')
    else { try { window.dispatchEvent(new Event('orders-local-changed')) } catch { /* ignore */ } refreshFeed(true) }
  }

  function setStatus(id, status) {
    saveLocal(ov => {
      const cur = { ...(ov[id] || {}) }
      if (status) { cur.status = status; cur.at = new Date().toISOString() } else { delete cur.status; delete cur.at; delete cur.forced; delete cur.balancedAt }
      if (Object.keys(cur).length) ov[id] = cur; else delete ov[id]
    })
  }

  // PO # typed by hand (e.g. Jonathan's reply came after the morning run)
  function setPo(id, po) {
    const v = String(po || '').trim().replace(/^po\s*#?\s*/i, '')
    saveLocal(ov => {
      const cur = { ...(ov[id] || {}) }
      if (v) cur.poNumber = v; else delete cur.poNumber
      if (Object.keys(cur).length) ov[id] = cur; else delete ov[id]
    })
  }

  function forceReceived(id, reason) {
    saveLocal(ov => {
      const at = new Date().toISOString()
      ov[id] = { ...(ov[id] || {}), status: 'Received', at, forced: { at, reason: String(reason || '').trim() } }
    })
  }

  function setNote(id, note) {
    saveLocal(ov => {
      const cur = { ...(ov[id] || {}) }
      if (note) cur.note = note; else delete cur.note
      if (Object.keys(cur).length) ov[id] = cur; else delete ov[id]
    })
  }
  const [openRows, setOpenRows] = useState(() => { const j = readFlagJump(); return new Set(j && j.kind === 'po' ? [String(j.refId).replace(/^po:/, '')] : []) })
  const toggleOpen = id => setOpenRows(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function setFiling(id, f) {
    saveLocal(ov => {
      const cur = { ...(ov[id] || {}) }
      for (const k of ['filedAs', 'ref', 'refLabel']) cur[k] = f[k] || ''
      if (Array.isArray(f.refs) && f.refs.length > 1) cur.refs = f.refs; else delete cur.refs
      if (f.note) cur.note = f.note; else delete cur.note
      if (f.parts && Object.keys(f.parts).length) cur.parts = f.parts; else delete cur.parts
      if (Object.keys(cur).length) ov[id] = cur; else delete ov[id]
    })
  }

  async function chooseFolder() {
    await window.desktop.ordersChooseFolder()
    load()
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: embedded ? 17 : 22, fontWeight: 700, color: 'var(--text)' }}>{embedded ? 'Orders — quote → PO → slips → jobs' : <>Orders &amp; POs</>}</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
          {state.feed
            ? <>Updated from your SCE email {fmtUpdated(state.feed.updatedAt, state.feedMtime)} (every weekday morning). ↻ Refresh also picks up new quote PDFs from Quote Slips{state.local?.lastSlipCheck ? <>, last checked {fmtUpdated(state.local.lastSlipCheck)}</> : ''}.</>
            : 'Quotes from wholesalers, Jonathan\'s POs, and what\'s been picked up.'}
        </div>
      </div>
      {state.feed && !embedded && (
        <input
          value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier, quote #, PO #, job…"
          style={{ width: 260, padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface)' }}
        />
      )}
      {state.feed && (
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
          {[['status', 'By status'], ['filed', 'By quote / job'], ['previous', 'Previous']].map(([v, label]) => (
            <button key={v} onClick={() => pickView(v)}
              style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer',
                background: view === v ? 'var(--navy)' : 'var(--surface)', color: view === v ? '#fff' : 'var(--text)' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      <button style={btn()} onClick={() => setOpenRows(new Set(rows.map(r => r.id)))} title="Open every PO">Expand all</button>
      <button style={btn()} onClick={() => setOpenRows(new Set())} title="Close every PO to its title bar">Collapse all</button>
      <button style={{ ...btn(), opacity: slipCheck.busy ? 0.6 : 1 }} disabled={slipCheck.busy} onClick={refresh}>{slipCheck.busy ? '↻ Checking…' : '↻ Refresh'}</button>
      {state.feed?.trackerUrl && <button style={btn()} onClick={() => window.desktop.openExternal(state.feed.trackerUrl)}>Open tracker doc</button>}
      {state.folder && <button style={btn()} onClick={() => window.desktop.ordersOpenFolder()} title={state.folder}>Folder</button>}
      {copyMsg && (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--green-dark)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>📎 {copyMsg}</span>
          <button style={btn()} onClick={() => setCopyMsg('')}>OK</button>
        </div>
      )}
      {slipCheck.msg && (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-mid)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '6px 10px' }}>
          {slipCheck.msg}
        </div>
      )}
      {poMsg && (poMsg.applied.length > 0 || poMsg.unmatched.length > 0 || poMsg.missing) && (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-mid)', background: poMsg.applied.length ? 'var(--green-bg)' : 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>
            {poMsg.missing && <>📧 No “PO Emails” folder in Field App yet — set up the Power Automate flow for Jonathan's emails, and Refresh picks up his POs.</>}
            {poMsg.applied.length > 0 && <>📧 From Jonathan's emails: {poMsg.applied.map(a => `PO ${a.po} → ${a.row}`).join(' · ')}. </>}
            {poMsg.unmatched.length > 0 && <>⚠ {poMsg.unmatched.map(u => `PO ${u.po}${u.subject ? ` (“${u.subject}”)` : ''}: ${u.note}`).join(' · ')}</>}
          </span>
          <button style={btn()} onClick={() => setPoMsg(null)}>OK</button>
        </div>
      )}
    </div>
  )

  // Material-order slips in Materials, to check each PO's quote ↔ slips balance
  const [matOrders, setMatOrders] = useLocalStore('material_orders', [])
  const [exportExtra, setExportExtra] = useLocalStore(EXPORT_EXTRA_KEY, [])
  // Push a done order onto this week's timesheet export (its slips, or the PO itself)
  const slipsOnPo = o => { const k = normPoKeyTs(o.poNumber); return k ? (matOrders || []).filter(m => normPoKeyTs(m.poNumber) === k && m.kind !== 'pricing' && !(m.docType === 'quote' && m.replacedAt)) : [] }
  const exportStateOf = o => {
    const wk = exportWeekKey()
    const sl = slipsOnPo(o)
    if (sl.length) return sl.some(m => m.exportWeek === wk) ? 'on' : 'off'
    return (exportExtra || []).some(x => x.feedId === o.id && x.week === wk) ? 'on' : 'off'
  }
  function pushToExport(o, on) {
    const wk = exportWeekKey()
    const sl = slipsOnPo(o)
    if (sl.length) {
      const ids = new Set(sl.map(m => m.id))
      const at = new Date().toISOString()
      setMatOrders(list => list.map(m => !ids.has(m.id) ? m : on
        ? { ...m, exportWeek: wk, receivedAt: m.receivedAt || at, sentAt: undefined, sentManually: undefined, sentWithWeek: undefined, timesheetSkipWeeks: (m.timesheetSkipWeeks || []).filter(w => w !== wk) }
        : { ...m, exportWeek: undefined }))
      return
    }
    if (on) setExportExtra(list => [...(list || []).filter(x => !(x.feedId === o.id && x.week === wk)), {
      id: 'x:' + o.id + ':' + wk, feedId: o.id, week: wk, receivedAt: new Date().toISOString(), wholesaler: o.supplier || '',
      invoiceNumber: (quoteNumbersOf(o)[0] || o.quoteNumber || ''), poNumber: o.poNumber || '', invoiceTotal: Number(o.quoteTotal) || 0,
      jobs: (o.refs && o.refs.length ? o.refs : [o.ref || o.job]).filter(Boolean).map(name => ({ name })), description: o.description || '', timesheetNote: '',
    }])
    else setExportExtra(list => (list || []).filter(x => !(x.feedId === o.id && x.week === wk)))
  }
  const balanceOf = o => poStatus(o.poNumber, matOrders, rows)
  // A PO whose quote and slips now balance gets marked Received
  const autoMarked = React.useRef(new Set())
  useEffect(() => {
    if (!state.feed) return
    const ids = rows.filter(o => o.status === 'Ordered' && o.poNumber && !autoMarked.current.has(o.id) && balanceOf(o).balanced).map(o => o.id)
    if (!ids.length) return
    ids.forEach(id => autoMarked.current.add(id))
    saveLocal(ov => { const at = new Date().toISOString(); ids.forEach(id => { ov[id] = { ...(ov[id] || {}), status: 'Received', at, balancedAt: at } }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.feed, state.local, matOrders])
  if (state.loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading orders…</div>

  if (state.error === 'not-desktop') {
    if (embedded) return <div>{footer}</div>
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Orders &amp; POs is only available in the desktop app.</div>
  }

  if (!state.feed) {
    return (
      <div style={{ padding: 16, maxWidth: embedded ? 'none' : 640 }}>
        {header}
        <div style={{ padding: 18, border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--surface)', fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.55 }}>
          {state.error === 'bad-feed'
            ? <p style={{ marginBottom: 10 }}>The orders file in <b>{state.folder}</b> couldn't be read. It may still be syncing — try Refresh in a minute.</p>
            : <p style={{ marginBottom: 10 }}>Can't find the <b>Field App</b> folder from your SCE OneDrive on this PC yet.</p>}
          <ol style={{ paddingLeft: 18, marginBottom: 14 }}>
            <li>Make sure OneDrive is signed in with your SCE account (dustincovey@sceelectric.com) and syncing.</li>
            <li>In OneDrive on the web, the folder is <b>My files → Field App</b>. If it isn't showing on this PC, open it there and choose <b>Sync</b> or <b>Add shortcut to My files</b>.</li>
            <li>Then press <b>Choose folder</b> and pick that Field App folder (it holds <code>orders.json</code>).</li>
          </ol>
          <button style={btn('primary')} onClick={chooseFolder}>Choose folder</button>
        </div>
        {embedded && footer}
      </div>
    )
  }

  function setPricing(id, on) {
    saveLocal(ov => {
      const cur = { ...(ov[id] || {}) }
      if (on) cur.pricingOnly = true; else delete cur.pricingOnly
      if (Object.keys(cur).length) ov[id] = cur; else delete ov[id]
    })
  }
  const rowProps = { exportStateOf, onPushExport: pushToExport, onSetPricing: embedded ? setPricing : null, onSetStatus: setStatus, onSetFiling: setFiling, onForceReceived: forceReceived, onSetPo: setPo, balanceOf, refOptions, embedded, renderExtra, onFixReason, isOpen: id => openRows.has(id), onToggleOpen: toggleOpen, onSetNote: setNote }
  const nothing = shown.length === 0

  // just the tiles (a section inside Materials → Orders)
  if (listOnly) {
    const list = shown.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    return (
      <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {list.length ? list.map(o => <OrderRow key={o.id} o={o} {...rowProps} />)
          : emptyText ? <div style={{ padding: '10px 6px', fontSize: 12.5, color: 'var(--text-light)' }}>{q ? 'Nothing matches.' : emptyText}</div> : null}
        {footer}
      </div>
    )
  }

  return (
    <div style={{ padding: embedded ? '12px 16px' : 16, maxWidth: embedded ? 'none' : 1100 }}>
      {header}
      {nothing && view !== 'previous' && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{q ? 'Nothing matches that search.' : 'No orders yet.'}</div>}
      {view === 'previous' ? (
        (() => {
          const prev = previousOrders(state.previous).filter(o => !q || [o.supplier, o.contact, o.quoteNumber, o.poNumber, o.description, o.job].join(' ').toLowerCase().includes(q))
          return prev.length === 0
            ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>{q ? 'Nothing in Previous matches that search.' : 'Nothing archived yet.'}</div>
            : <Section title="Previous" hint={state.previous?.note || 'Archived orders — read only'} rows={prev} {...rowProps} />
        })()
      ) : view === 'status' ? (
        <>
        <Section title="Needs a decision" hint={`Quotes with no PO after ${STALE_DAYS}+ days — order or close`} rows={g.decide} tone="var(--red-bg)" {...rowProps} />
        <Section title="Waiting" hint="Pricing asked for, quote in, or PO asked for" rows={g.waiting} {...rowProps} />
        <Section title="On order" hint="Jonathan has issued a PO — mark received when it's picked up or delivered" rows={g.ordered} tone="var(--accent-bg)" {...rowProps} />
        <Section title="Done" rows={g.done} collapsed={!showDone && !q} onToggle={() => setShowDone(v => !v)} {...rowProps} />
        </>
      ) : (
        groupByFiling(shown.filter(o => showDone || q || (o.status !== 'Received' && o.status !== 'Closed'))).map(grp => (
          <Section key={grp.key} title={grp.title} hint={grp.subtitle} rows={grp.rows}
            tone={grp.type ? 'var(--blue-bg)' : undefined} {...rowProps} hideFiled={!!grp.type} />
        ))
      )}
      {view === 'filed' && g.done.length > 0 && !q && (
        <button style={{ ...btn(), marginTop: 4 }} onClick={() => setShowDone(v => !v)}>
          {showDone ? 'Hide received and closed' : `Show received and closed (${g.done.length})`}
        </button>
      )}
      {view !== 'previous' && footer}
    </div>
  )
}
