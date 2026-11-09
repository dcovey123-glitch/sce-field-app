import React, { useState, useEffect } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { clockEntriesInRange, pushClockTime } from '../api/timesheetFromClock.js'
import { weekKeyOf, weekdayName } from '../api/weekStart.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { EXPORT_EXTRA_KEY, normPoKeyTs, entryCustomer, weekMainCustomer, dayMainCustomer, billShares, dayByCustomer, MAIN_CUSTOMER, tsHours, orderTotalForReport, receivedInWeek } from '../api/timesheetExport.js'
export { entryCustomer, weekMainCustomer, dayMainCustomer, billShares, dayByCustomer }
import FileAttachments, { FileTile } from '../components/FileAttachments.jsx'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import logoUrl from '../assets/logo_sce_new.jpg'
import { useCrewRoster, pickerNames } from '../api/crewRoster.js'
import { useOrdersFeed, matchOrdersByPo, quoteNumbersOf } from '../api/orders.js'
import { todayLocal } from '../api/albertaTime.js'
import { money, fmtDate } from '../api/format.js'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WORKERS_DEFAULT = ['Dustin Covey']

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ── Week helpers (Sun–Sat unless changed — api/weekStart.js) ─────────
function weekKey(date) { return weekKeyOf(date || new Date()) }
function weekLabel(key) {
  const d = new Date(key + 'T00:00:00')
  const end = new Date(d); end.setDate(end.getDate() + 6)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' – ' + end.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}
function offsetWeekKey(baseKey, offsetWeeks) {
  const d = new Date(baseKey + 'T00:00:00')
  d.setDate(d.getDate() + offsetWeeks * 7)
  return weekKey(d)
}
function dayDate(wk, dayIdx) {
  const d = new Date(wk + 'T00:00:00')
  d.setDate(d.getDate() + dayIdx)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}
function emptyDay() { return [{ reg: '', ot: '', project: '', notes: '' }] }

// people: [{ name, id? }] — usually just "me" from the Crew roster
function emptyWeek(people = WORKERS_DEFAULT.map(name => ({ name }))) {
  return {
    workers: people.map(p => ({ name: p.name, ...(p.id ? { workerId: p.id } : {}), days: DAYS.map(() => emptyDay()), expenses: [] })),
  }
}

// ── Expense row (with real file-backed receipt attachments) ────────
function ExpenseRow({ exp, onChange, onDelete }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={exp.date} onChange={e => onChange({ ...exp, date: e.target.value })}
          placeholder="Date" style={{ width: 80, minWidth: 0, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12 }} />
        <input value={exp.desc} onChange={e => onChange({ ...exp, desc: e.target.value })}
          placeholder="Description" style={{ flex: 1, minWidth: 80, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12 }} />
        <input value={exp.amount} onChange={e => onChange({ ...exp, amount: e.target.value })}
          placeholder="$0.00" style={{ width: 70, minWidth: 0, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, textAlign: 'right' }} />
        <ConfirmDeleteButton
          onConfirm={onDelete} ariaLabel="Delete expense" confirmText="Delete this expense?"
          style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
        />
      </div>
      {exp.id && (
        <div style={{ marginTop: 6 }}>
          <FileAttachments folderPath={`Timesheets/Receipts/${exp.id}/Files`} />
        </div>
      )}
    </div>
  )
}

// ── One worker's sheet for the week ─────────────────────────────────
function WorkerSheet({ worker, weekKey: wk, onChange, onRemove, isOnly, findPerson, weekMain = MAIN_CUSTOMER, customerOptions = [] }) {
  function normDay(d) { return Array.isArray(d) ? d : [d] }
  const normDays = worker.days.map(normDay)

  const totalReg = normDays.reduce((a, entries) => a + entries.reduce((b, d) => b + (parseFloat(d.reg) || 0), 0), 0)
  const totalOT = normDays.reduce((a, entries) => a + entries.reduce((b, d) => b + (parseFloat(d.ot) || 0), 0), 0)

  function updateEntry(dayIdx, entryIdx, field, val) {
    const days = normDays.map((entries, i) => i !== dayIdx ? entries :
      entries.map((e, j) => j !== entryIdx ? e : { ...e, [field]: val }))
    onChange({ ...worker, days })
  }
  function addEntry(dayIdx) {
    const days = normDays.map((entries, i) => i !== dayIdx ? entries : [...entries, { reg: '', ot: '', project: '', notes: '' }])
    onChange({ ...worker, days })
  }
  function removeEntry(dayIdx, entryIdx) {
    const days = normDays.map((entries, i) => {
      if (i !== dayIdx) return entries
      if (entries.length <= 1) return [{ reg: '', ot: '', project: '', notes: '' }]
      return entries.filter((_, j) => j !== entryIdx)
    })
    onChange({ ...worker, days })
  }

  const expenses = worker.expenses || []
  const expTotal = expenses.reduce((a, e) => a + (parseFloat(e.amount) || 0), 0)

  function addExpense() { onChange({ ...worker, expenses: [...expenses, { id: uid(), date: '', desc: '', amount: '' }] }) }
  function updateExpense(idx, updated) { onChange({ ...worker, expenses: expenses.map((e, i) => i === idx ? updated : e) }) }
  function removeExpense(idx) { onChange({ ...worker, expenses: expenses.filter((_, i) => i !== idx) }) }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ background: 'var(--navy)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {worker.workerId ? (
          // Picked from the Crew roster — rename people on the Crew page so every week stays in step
          <div title="Rename on the Crew page" style={{ color: '#fff', fontFamily: 'var(--font-d)', fontSize: 14, fontWeight: 700, flex: 1 }}>{worker.name}</div>
        ) : (
          <input
            value={worker.name}
            onChange={e => {
              const p = findPerson && findPerson(e.target.value)
              onChange({ ...worker, name: e.target.value, ...(p ? { workerId: p.id } : {}) })
            }}
            style={{ background: 'none', border: 'none', color: '#fff', fontFamily: 'var(--font-d)', fontSize: 14, fontWeight: 700, outline: 'none', flex: 1 }}
            placeholder="Worker name"
          />
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Reg / OT</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{totalReg}h {totalOT > 0 ? `/ ${totalOT}h OT` : ''}</div>
          </div>
          <button onClick={addExpense} style={{ background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 'var(--rs)', color: 'rgba(255,255,255,.75)', fontSize: 11, fontWeight: 600, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Expense</button>
          {!isOnly && (
            <ConfirmDeleteButton
              onConfirm={onRemove} triggerLabel="Remove" ariaLabel="Remove worker"
              confirmText={`Remove ${worker.name || 'this worker'} from this week? Their hours and expenses for the week go with them.`}
              style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 'var(--rs)', color: 'rgba(255,255,255,.6)', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
            />
          )}
        </div>
      </div>

      <div>
        {DAYS.map((_, i) => {
          const entries = normDays[i]
          const dayReg = entries.reduce((a, d) => a + (parseFloat(d.reg) || 0), 0)
          const dayOT = entries.reduce((a, d) => a + (parseFloat(d.ot) || 0), 0)
          const hasData = entries.some(d => d.reg || d.ot || d.project || d.notes)
          return (
            <div key={i} style={{ borderBottom: '1px solid var(--border)', background: hasData ? 'var(--surface)' : 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px 4px', gap: 8 }}>
                <div style={{ width: 42, flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>{weekdayName(wk, i, true)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-light)' }}>{dayDate(wk, i)}</div>
                </div>
                {(dayReg > 0 || dayOT > 0) && (
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', marginLeft: 4 }}>
                    {dayReg > 0 && <span>{dayReg}h</span>}
                    {dayOT > 0 && <span style={{ color: '#9a6610' }}> +{dayOT}h OT</span>}
                  </div>
                )}
                <button onClick={() => addEntry(i)}
                  style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 12, fontSize: 10, fontWeight: 700, color: 'var(--text-light)', padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  + Job
                </button>
              </div>

              {entries.map((d, j) => (
                <div key={j} style={{ padding: '0 12px 8px', paddingLeft: entries.length > 1 ? 20 : 12 }}>
                  {entries.length > 1 && (
                    <div style={{ fontSize: 10, color: 'var(--text-light)', fontWeight: 600, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ background: 'var(--navy)', color: '#fff', borderRadius: 9, width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{j + 1}</span>
                      Job {j + 1}
                      {j > 0 && (
                        <ConfirmDeleteButton
                          onConfirm={() => removeEntry(i, j)} ariaLabel="Remove job entry" confirmText="Remove this entry?"
                          style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 14, cursor: 'pointer', padding: '0 2px', marginLeft: 'auto' }}
                        />
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>Reg</span>
                      <input type="number" step="0.5" min="0" max="24" value={d.reg}
                        onChange={e => updateEntry(i, j, 'reg', e.target.value)}
                        placeholder="0" style={{ width: 52, padding: '5px 6px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 13, textAlign: 'center' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: '#9a6610', whiteSpace: 'nowrap' }}>OT</span>
                      <input type="number" step="0.5" min="0" max="24" value={d.ot}
                        onChange={e => updateEntry(i, j, 'ot', e.target.value)}
                        placeholder="0" style={{ width: 52, padding: '5px 6px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 13, textAlign: 'center', color: '#9a6610' }} />
                    </div>
                    {d.fromSession && (
                      <span title="Filled in from the crew clock when the day was confirmed. Edit freely — confirming the same day again replaces these rows."
                        style={{ fontSize: 10, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '2px 7px', whiteSpace: 'nowrap' }}>⏱ clock</span>
                    )}
                    <input value={d.project} onChange={e => updateEntry(i, j, 'project', e.target.value)}
                      placeholder="Project / Site"
                      style={{ flex: 1, minWidth: 100, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12 }} />
                  </div>
                  {!entryCustomer(d) && tsHours(d) > 0 && (() => {
                    const auto = dayMainCustomer(entries, weekMain)
                    const opts = [...new Set([auto, ...customerOptions, ...(d.billTo ? [d.billTo] : [])])]
                    const more = d.billMore || []
                    const setMore = v => updateEntry(i, j, 'billMore', v)
                    const shares = billShares(d, auto)
                    const share = c => { const f = (shares.find(x => x.customer === c) || {}).frac || 0; return `(${Math.round(f * tsHours(d) * 100) / 100} h)` }
                    return (
                      <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-light)', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span>Not a job — bills to</span>
                        <select value={d.billTo || ''} onChange={e => updateEntry(i, j, 'billTo', e.target.value)}
                          style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, maxWidth: 280 }}>
                          <option value="">{auto} (main customer that day)</option>
                          {opts.filter(c => c !== auto || d.billTo === c).map(c => c === '──' ? <option key="sep" disabled>──── all customers ────</option> : <option key={c} value={c}>{c}</option>)}
                        </select>
                        {more.length > 0 && <span>{share(d.billTo || auto)}</span>}
                        <button onClick={() => setMore([...more, { to: '', hrs: '' }])} title="Split this time over another customer"
                          style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>+ split</button>
                      </div>
                      {more.map((x, k) => (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-light)', margin: '0 0 4px 92px' }}>
                          <span>and</span>
                          <select value={x.to} onChange={e => setMore(more.map((y, q) => q === k ? { ...y, to: e.target.value } : y))}
                            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, maxWidth: 280 }}>
                            <option value="">— pick a customer —</option>
                            {[...new Set([auto, ...customerOptions])].map(c => c === '──' ? <option key="sep" disabled>──── all customers ────</option> : <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input value={x.hrs} onChange={e => setMore(more.map((y, q) => q === k ? { ...y, hrs: e.target.value } : y))} placeholder="even"
                            title="Hours for this customer — leave blank to share evenly" style={{ width: 46, fontSize: 11, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, textAlign: 'right' }} />
                          <span>h {x.to ? share(x.to) : ''}</span>
                          <button onClick={() => setMore(more.filter((_, q) => q !== k))} title="Remove"
                            style={{ fontSize: 12, border: 'none', background: 'none', color: '#9aa3ad', cursor: 'pointer' }}>×</button>
                        </div>
                      ))}
                      </>
                    )
                  })()}
                  <input value={d.notes} onChange={e => updateEntry(i, j, 'notes', e.target.value)}
                    placeholder="Notes (optional)"
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 11, color: 'var(--text-mid)', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '9px 14px', background: 'var(--surface-2)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Regular: <strong>{totalReg} hrs</strong></span>
        {totalOT > 0 && <span style={{ fontSize: 12, color: '#9a6610' }}>Overtime: <strong>{totalOT} hrs</strong></span>}
        <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Total: <strong>{totalReg + totalOT} hrs</strong></span>
        {expTotal > 0 && <span style={{ fontSize: 12, color: '#37474f', marginLeft: 'auto' }}>Expenses: <strong>${expTotal.toFixed(2)}</strong></span>}
      </div>

      {expenses.length > 0 && (
        <div style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ padding: '8px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Expenses</span>
            <button onClick={addExpense} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 12, fontSize: 10, fontWeight: 700, color: 'var(--text-light)', padding: '2px 8px', cursor: 'pointer' }}>+ Add</button>
          </div>
          <div style={{ padding: '0 12px 10px' }}>
            {expenses.map((exp, idx) => (
              <ExpenseRow key={exp.id || idx} exp={exp}
                onChange={updated => updateExpense(idx, updated)}
                onDelete={() => removeExpense(idx)} />
            ))}
            {expenses.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Total: ${expTotal.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export: builds the same styled HTML document as before, now saved as a real file ──
const EXPORT_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
  .page{padding:28px 34px;max-width:820px;margin:0 auto}
  .doc-hdr{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:2.5px solid #1a237e;margin-bottom:24px}
  .doc-hdr-logo{height:52px;width:auto}
  .doc-hdr-right{text-align:right}
  .doc-hdr-title{font-size:18px;font-weight:800;color:#1a237e;letter-spacing:-.01em;line-height:1.1}
  .doc-hdr-meta{font-size:11px;color:#999;margin-top:3px}
  .worker-block{border:1.5px solid #d0d4e8;border-radius:7px;overflow:hidden;margin-bottom:18px;page-break-inside:avoid;break-inside:avoid}
  .wk-head{background:#1a237e;padding:9px 14px;display:flex;align-items:baseline;justify-content:space-between}
  .wk-name{font-size:13px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.05em}
  .wk-total{font-size:11px;color:rgba(255,255,255,.75);font-weight:600;white-space:nowrap;margin-left:12px}
  .wk-table{width:100%;border-collapse:collapse}
  .wk-table thead th{background:#eef0f8;color:#555;padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:left;border-bottom:1px solid #d0d4e8}
  .wk-table td{padding:6px 12px;border-bottom:1px solid #f0f0f4;font-size:12px;vertical-align:middle}
  .wk-table tr:last-child td{border-bottom:none}
  .wk-table tr:nth-child(even) td{background:#fafbfe}
  .sub-row td{background:#f6f7fb!important;font-size:11px}
  .wk-totals{background:#f0f2fa;border-top:1.5px solid #c5cae9;padding:7px 14px;display:flex;gap:18px;font-size:12px;color:#444}
  .wk-totals strong{color:#1a237e}
  .exp-head{border-top:1.5px solid #d0d4e8;background:#f8f9fb;padding:5px 14px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#888}
  .exp-table{width:100%;border-collapse:collapse}
  .exp-table td{padding:5px 12px;border-bottom:1px solid #f0f0f4;font-size:11.5px}
  .exp-table tr:last-child td{border-bottom:none}
  .exp-total-row td{background:#eef0f8!important;font-weight:700;border-top:1px solid #c5cae9}
  .doc-footer{margin-top:24px;padding-top:10px;border-top:1px solid #eee;display:flex;align-items:center;justify-content:space-between}
  .doc-footer-logo{height:26px;opacity:.35}
  .doc-footer-text{font-size:10px;color:#ccc}
  @media print{ .page{padding:14px 18px} .worker-block{page-break-inside:avoid;break-inside:avoid} }
`

async function fetchLogoBase64() {
  try {
    const res = await fetch(logoUrl)
    if (res.ok && logoUrl.startsWith('data:')) return logoUrl
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return `data:image/jpeg;base64,${btoa(binary)}`
  } catch {
    return ''
  }
}

function buildExportHtml({ title, meta, workerBlocksHtml, footerNote, appendix, logoDataUrl }) {
  return `<!DOCTYPE html><html><head>
<title>SCE Electric - ${title}</title>
<style>${EXPORT_STYLES}</style>
</head><body><div class="page">
  <div class="doc-hdr">
    <img class="doc-hdr-logo" src="${logoDataUrl}" alt="SCE Electric" />
    <div class="doc-hdr-right">
      <div class="doc-hdr-title">${title}</div>
      <div class="doc-hdr-meta">${meta}</div>
    </div>
  </div>
  ${workerBlocksHtml}
  <div class="doc-footer">
    <img class="doc-footer-logo" src="${logoDataUrl}" alt="SCE Electric" />
    <div class="doc-footer-text">SCE Electric Western Canada Ltd. &nbsp;·&nbsp; ${footerNote || title}</div>
  </div>
</div>${appendix || ''}
</body></html>`
}

function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)))
}

// ── Main Timesheets hub ──────────────────────────────────────────
// A receipt pulled in from the phone, not yet tied to a specific worker's
// expense entry — pick who it belongs to, confirm the amount/description
// (pre-filled if entered on the phone), and it becomes a real expense with
// the receipt attached, same as one added directly on this screen.
function PendingExpenseRow({ receipt, workerNames, onAssign, onDismiss }) {
  const [worker, setWorker] = useState(workerNames[0] || '')
  const [newWorkerName, setNewWorkerName] = useState('')
  const [amount, setAmount] = useState(receipt.amount || '')
  const [desc, setDesc] = useState(receipt.desc || '')
  const [assigning, setAssigning] = useState(false)

  async function confirm() {
    const finalWorker = worker === '__new__' ? newWorkerName.trim() : worker
    if (!finalWorker) { alert('Pick or name a worker first.'); return }
    setAssigning(true)
    await onAssign({ workerName: finalWorker, amount, desc })
    setAssigning(false)
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: 12, marginBottom: 8, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <FileTile
          file={{ name: receipt.fileName, path: receipt.filePath }}
          onOpen={() => receipt.filePath && window.desktop.openFile(receipt.filePath)}
          onRemove={onDismiss}
        />
        <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{receipt.fileName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-light)' }}>Tap the thumbnail to view full size</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <select value={worker} onChange={e => setWorker(e.target.value)} style={{ flex: '1 1 140px', padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
          {workerNames.map(n => <option key={n} value={n}>{n || '(unnamed worker)'}</option>)}
          <option value="__new__">+ New worker…</option>
        </select>
        {worker === '__new__' && (
          <input value={newWorkerName} onChange={e => setNewWorkerName(e.target.value)} placeholder="Worker name"
            style={{ flex: '1 1 140px', padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
          style={{ width: 100, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description"
          style={{ flex: 1, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onDismiss} style={{ flex: 1, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
          Discard
        </button>
        <button onClick={confirm} disabled={assigning} style={{ flex: 1, padding: 8, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', color: 'var(--navy)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {assigning ? 'Adding…' : 'Add to Timesheet'}
        </button>
      </div>
    </div>
  )
}

function escHtml(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function receivedMaterialHtml(list, links = {}) {
  if (!list.length) return ''
  const files = links.files || {}, quotes = links.quotes || {}, qmap = links.qmap || {}
  const a = (url, text) => url ? `<a href="${escHtml(url)}" style="color:#1a3fa0;text-decoration:underline">${escHtml(text)}</a>` : escHtml(text)
  const anyLink = list.some(o => files[o.id] || (qmap[o.id] || []).some(n => quotes[n]))
  const th = 'padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;background:#eef0f8;text-align:left;border-bottom:1px solid #d0d4e8'
  const rows = list.map(o => {
    const jobs = (o.jobs || []).map(j => j.name).filter(Boolean).join(', ')
    return `<tr>
      <td style="width:80px;color:#888">${fmtDate(o.receivedAt)}</td>
      <td><strong>${escHtml(o.wholesaler || '—')}</strong></td>
      <td>${a(files[o.id], o.invoiceNumber || (files[o.id] ? 'slip' : '—'))}</td>
      <td>${escHtml(o.poNumber || '—')}</td>
      <td>${(qmap[o.id] || []).length ? qmap[o.id].map(n => a(quotes[n], n)).join(', ') : '—'}</td>
      <td style="color:#555">${escHtml(jobs || '—')}</td>
      <td style="font-size:10px;white-space:nowrap;color:${o.forceReceivedAt ? '#9a6610' : o.poBalancedAt ? '#1e7a34' : '#888'}">${o.forceReceivedAt ? 'Forced' + (o.forceReason ? ': ' + escHtml(o.forceReason) : '') : o.poBalancedAt ? '✓ Balanced' : '—'}</td>
      <td style="text-align:right;font-weight:700;white-space:nowrap">${money(orderTotalForReport(o))}</td>
    </tr>${o.timesheetNote ? `<tr><td></td><td colspan="7" style="padding-top:0;font-size:11px;color:#7a5a00;font-style:italic">Note: ${escHtml(o.timesheetNote)}</td></tr>` : ''}`
  }).join('')
  const total = list.reduce((a, o) => a + orderTotalForReport(o), 0)
  return `<div class="worker-block">
    <div class="wk-head">
      <span class="wk-name">Material received this week</span>
      <span class="wk-total">${list.length} order${list.length === 1 ? '' : 's'} · <strong style="color:#fff">${money(total)}</strong> before GST</span>
    </div>
    <table class="wk-table">
      <thead><tr>
        <th style="${th}">Received</th><th style="${th}">Wholesaler</th><th style="${th}">Invoice #</th>
        <th style="${th}">PO #</th><th style="${th}">Quote</th><th style="${th}">Job(s)</th><th style="${th}">Quote ↔ slips</th><th style="${th};text-align:right">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="wk-totals"><span>All items on these orders have been received.${anyLink ? ' Click an invoice # or quote # to open it in OneDrive.' : ''}</span></div>
  </div>`
}

function ReceivedRow({ o, off, patch, skipW, unskipW, money, day, btn }) {
  const [note, setNote] = useState(o.timesheetNote || '')
  const jobs = (o.jobs || []).map(j => j.name).filter(Boolean).join(', ')
  return (
    <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', opacity: off ? 0.65 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ width: 52, color: 'var(--text-light)' }}>{day(o.receivedAt)}</span>
        <b style={{ minWidth: 120 }}>{o.wholesaler || '—'}</b>
        <span style={{ color: 'var(--text-mid)' }}>{o.invoiceNumber ? '#' + o.invoiceNumber : 'no #'} · PO {o.poNumber || '—'}</span>
        <span style={{ flex: 1, minWidth: 120, color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={jobs}>{jobs || 'no job'}</span>
        <b>{money(orderTotalForReport(o))}</b>
        {off
          ? <button style={{ ...btn, color: '#1a5fa0', borderColor: '#1a5fa0' }} onClick={() => patch(o.id, { timesheetSkipWeeks: unskipW(o) })}>↺ Put back</button>
          : <>
              <button style={btn} title="Off this week's export — it comes back next week if it still isn't sent" onClick={() => patch(o.id, { timesheetSkipWeeks: skipW(o) })}>✕ Remove</button>
              {o.sentWithWeek && <span title="This slip went out with this week's timesheet export" style={{ fontSize: 10.5, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 10, padding: '1px 8px' }}>sent with this timesheet</span>}
              <button style={btn} title="Jonathan already has it (sent another way) — take it off this timesheet for good" onClick={() => patch(o.id, { sentAt: o.sentAt || new Date().toISOString(), sentManually: true, sentWithWeek: undefined })}>✓ Already sent</button>
            </>}
      </div>
      {!off && (
        <input value={note} onChange={e => setNote(e.target.value)} onBlur={() => note.trim() !== (o.timesheetNote || '') && patch(o.id, { timesheetNote: note.trim() || undefined })}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="Note for Jonathan (prints under this slip on the timesheet)"
          style={{ marginTop: 5, marginLeft: 62, width: 'calc(100% - 62px)', boxSizing: 'border-box', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', background: note ? '#fffbe6' : 'var(--surface)', fontFamily: 'var(--font)' }} />
      )}
    </div>
  )
}

// Received material on this week's export: see it, take a slip off, add a note
function ReceivedExportModal({ wk, orders, setOrders, included, onClose }) {
  const list = receivedInWeek(orders, wk)
  const removed = receivedInWeek(orders, wk, { skipped: true })
  const patch = (id, p) => setOrders(l => l.map(o => o.id === id ? { ...o, ...p } : o))
  const skipW = o => [...new Set([...(o.timesheetSkipWeeks || []), wk])]
  const unskipW = o => (o.timesheetSkipWeeks || []).filter(w => w !== wk)
  const day = iso => fmtDate(iso)
  const btn = { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer', whiteSpace: 'nowrap' }
  const total = list.reduce((a, o) => a + orderTotalForReport(o), 0)
  const rp = { patch, skipW, unskipW, money, day, btn }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 4vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '86vh', overflowY: 'auto', background: 'var(--surface)', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,.3)', color: 'var(--text)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--navy, #1a2340)', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>Received material on this export</span>
          <span style={{ fontSize: 12.5 }}>{list.length} slip{list.length === 1 ? '' : 's'} · <b>{money(total)}</b></span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>Close</button>
        </div>
        {!included && <div style={{ padding: '8px 16px', fontSize: 12, background: '#fff3d6', color: '#8a5d00' }}>The Received material box is unticked, so none of this goes on the export right now.</div>}
        <div style={{ padding: '6px 16px', fontSize: 11.5, color: 'var(--text-light)' }}>Received this week, plus anything received earlier that hasn't gone to Jonathan yet.</div>
        {!list.length && <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-light)' }}>Nothing on this week's export.</div>}
        {list.map(o => <ReceivedRow key={o.id} o={o} {...rp} />)}
        {removed.length > 0 && (
          <>
            <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-light)' }}>Removed from this week ({removed.length})</div>
            {removed.map(o => <ReceivedRow key={o.id} o={o} off {...rp} />)}
          </>
        )}
      </div>
    </div>
  )
}

export default function Timesheets() {
  const feedRows = useOrdersFeed()
  const [sheets, setSheets] = useLocalStore('timesheets', {})
  const [pendingExpenses, setPendingExpenses] = useLocalStore('timesheets_pending_expenses', [])
  const currentKey = weekKey()
  const [activeKey, setActiveKey] = useState(currentKey)
  const [showHistory, setShowHistory] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailNote, setEmailNote] = useState('')
  const [materialOrdersRaw, setMaterialOrdersRaw] = useLocalStore('material_orders', [])
  // + POs pushed from Orders → Done that have no slips (one line each)
  const [exportExtra, setExportExtra] = useLocalStore(EXPORT_EXTRA_KEY, [])
  const materialOrders = [...(materialOrdersRaw || []), ...(exportExtra || [])]
  const setMaterialOrders = fn => {
    const all = typeof fn === 'function' ? fn(materialOrders) : fn
    setMaterialOrdersRaw(all.filter(o => !String(o.id).startsWith('x:')))
    setExportExtra(all.filter(o => String(o.id).startsWith('x:')))
  }
  const [includeReceived, setIncludeReceived] = useLocalStore('timesheets_include_received_material', true)
  const [showReceived, setShowReceived] = useState(false)
  const [newPerson, setNewPerson] = useState(null) // name being typed for + New person

  const crew = useCrewRoster()
  const week = sheets[activeKey] || emptyWeek([crew.me || { name: crew.meName }])
  // Bill-to picker: this week's customers first, then every customer in Jobs
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const weekCusts = [...new Set([MAIN_CUSTOMER, ...(week.workers || []).flatMap(w => (w.days || []).flatMap(day => (Array.isArray(day) ? day : [day]).map(entryCustomer))).filter(Boolean)])]
  const allCusts = [...new Set((jobsHub.customers || []).filter(c => !c.trashedAt).map(c => (c.name || '').trim()).filter(Boolean))]
    .filter(c => !weekCusts.includes(c)).sort((a, b) => a.localeCompare(b))
  const customerOptions = allCusts.length ? [...weekCusts, '──', ...allCusts] : weekCusts

  // 🧹 Clear the week back to a blank sheet (same people, hours wiped).
  // Expenses and their receipts are kept. Undo is there until you leave the page.
  const [clearAsk, setClearAsk] = useState(false)
  const [undoWeek, setUndoWeek] = useState(null) // { key, week }
  function clearWeek() {
    setUndoWeek({ key: activeKey, week })
    saveWeek({ ...week, workers: (week.workers || []).map(w => ({ ...w, days: DAYS.map(() => emptyDay()) })) })
    setClearAsk(false); setPullMsg('')
  }
  function undoClear() {
    if (!undoWeek) return
    setSheets(sh => ({ ...sh, [undoWeek.key]: undoWeek.week }))
    setUndoWeek(null)
  }

  // ⏱ Pull in the crew-clock time for the week on screen
  const [nonJobLog] = useLocalStore('time_nonjob_log', [])
  const [pullMsg, setPullMsg] = useState('')
  function pullClockTime() {
    const end = new Date(activeKey + 'T00:00:00'); end.setDate(end.getDate() + 6)
    const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    const entries = clockEntriesInRange({ jobs: jobsHub.records || [], customers: jobsHub.customers || [], nonJob: nonJobLog, from: activeKey, to })
    const r = pushClockTime(sheets, { entries, dayPool: entries, me: crew.me ? { name: crew.me.name, id: crew.me.id } : null, findPerson: crew.findByName })
    if (!r.dates.length || !r.fresh) { setPullMsg(entries.length ? 'Already on — every clock entry this week is on the timesheet.' : 'No confirmed clock time this week.'); return }
    setSheets(r.sheets)
    setPullMsg(`✓ Pulled ${r.hours} h from Time Tracking (${r.dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short' })).join(', ')}). Pulling again replaces these rows — no doubles.`)
  }

  // (a) A PO closed as received with a slip missing: the export carries the
  // whole PO. When some of its slips are on this week's list but add up to
  // less than the PO total, a "balance" line makes up the rest (editable /
  // removable in the Received material list like any other line).
  const balKey = (pk, wk) => 'x:bal:' + pk + ':' + wk
  useEffect(() => {
    if (!includeReceived) return
    const onList = receivedInWeek(materialOrders, activeKey).filter(o => !String(o.id).startsWith('x:'))
    const adds = []
    for (const pk of [...new Set(onList.map(o => normPoKeyTs(o.poNumber)).filter(k => k.length >= 3))]) {
      if ((exportExtra || []).some(x => x.id === balKey(pk, activeKey) || (x.week === activeKey && normPoKeyTs(x.poNumber) === pk))) continue
      const rows = (feedRows || []).filter(r => normPoKeyTs(r.poNumber) === pk)
      const slipsOfPo = (materialOrdersRaw || []).filter(o => normPoKeyTs(o.poNumber) === pk && o.kind !== 'pricing' && !o.recordOnly)
      const forced = rows.some(r => r.forcedReceived) || slipsOfPo.some(o => o.forceReceivedAt)
      if (!forced) continue
      const quoteDocs = slipsOfPo.filter(o => o.docType === 'quote')
      const packing = slipsOfPo.filter(o => o.docType !== 'quote')
      if (!packing.length) continue // the quote itself is what's on the export
      const poTotal = Math.max(rows.reduce((m, r) => Math.max(m, Number(r.quoteTotal) || 0), 0),
        quoteDocs.reduce((t, o) => t + (orderTotalForReport(o) || Number(o.subtotal) || 0), 0))
      const sum = packing.reduce((t, o) => t + orderTotalForReport(o), 0)
      const bal = Math.round((poTotal - sum) * 100) / 100
      if (bal <= 1) continue
      const first = onList.find(o => normPoKeyTs(o.poNumber) === pk)
      adds.push({ id: balKey(pk, activeKey), feedId: 'bal:' + pk, week: activeKey, receivedAt: first.receivedAt || new Date().toISOString(),
        wholesaler: first.wholesaler || (rows[0] || {}).supplier || '', invoiceNumber: 'Balance of PO — slip missing', poNumber: first.poNumber,
        invoiceTotal: bal, jobs: first.jobs || [], forceReceivedAt: first.forceReceivedAt || (rows.find(r => r.forcedReceived) ? new Date().toISOString() : undefined), forceReason: 'slip missing',
        timesheetNote: `PO total ${money(poTotal)} less slips on hand ${money(sum)}`, auto: true })
    }
    if (adds.length) setExportExtra(l => [...(l || []).filter(x => !adds.some(a => a.id === x.id)), ...adds])
  }, [activeKey, includeReceived, feedRows, materialOrdersRaw, exportExtra]) // eslint-disable-line react-hooks/exhaustive-deps
  const onWeek = name => (week.workers || []).some(w => (w.name || '').trim().toLowerCase() === (name || '').trim().toLowerCase())
  const addable = crew.active.filter(p => !onWeek(p.name))

  function saveWeek(updated) {
    setSheets(s => ({ ...s, [activeKey]: updated }))
  }
  function updateWorker(idx, updated) {
    const workers = week.workers.map((w, i) => i === idx ? updated : w)
    saveWeek({ ...week, workers })
  }
  // Add a crew member to this week. value = a roster person id, or '__new__'
  // (desktop app has no prompt(): the new name is typed in a box under the picker)
  function addWorker(value) {
    let person = crew.roster.find(p => p.id === value)
    if (value === '__new__') { setNewPerson(''); return }
    if (value && value.startsWith('__name__:')) {
      const typed = value.slice(9)
      if (!typed.trim()) return
      person = crew.addPerson(typed)
    }
    if (!person) return
    if (onWeek(person.name)) return
    saveWeek({ ...week, workers: [...week.workers, { name: person.name, workerId: person.id, days: DAYS.map(() => ({ reg: '', ot: '', project: '', notes: '' })), expenses: [] }] })
  }
  function removeWorker(idx) {
    saveWeek({ ...week, workers: week.workers.filter((_, i) => i !== idx) })
  }

  // Assigns a phone-uploaded receipt to a real expense on the currently
  // viewed week — creating the worker if they're new to this week, then
  // moving the receipt file into that expense's own Files folder.
  async function assignPendingExpense(receipt, { workerName, amount, desc }) {
    const expenseId = uid()
    // Same person as on the Crew roster (adds them there if they're new)
    const person = crew.addPerson(workerName)
    if (person) workerName = person.name
    let workers = week.workers.slice()
    let idx = workers.findIndex(w => (w.name || '').trim().toLowerCase() === workerName.trim().toLowerCase())
    if (idx === -1) {
      workers = [...workers, { name: workerName, ...(person ? { workerId: person.id } : {}), days: DAYS.map(() => ({ reg: '', ot: '', project: '', notes: '' })), expenses: [] }]
      idx = workers.length - 1
    }
    const newExpense = { id: expenseId, date: todayLocal(), desc, amount }
    workers = workers.map((w, i) => i === idx ? { ...w, expenses: [...(w.expenses || []), newExpense] } : w)
    saveWeek({ ...week, workers })

    if (isDesktop && receipt.filePath) {
      try {
        const base64 = await window.desktop.readFileBytes(receipt.filePath)
        await window.desktop.saveFile(`Timesheets/Receipts/${expenseId}/Files`, receipt.fileName, base64)
        await window.desktop.removeFile(receipt.filePath)
      } catch { /* expense is already saved either way — just missing the receipt copy if this failed */ }
    }
    setPendingExpenses(list => list.filter(r => r.id !== receipt.id))
  }
  function dismissPendingExpense(receipt) {
    if (isDesktop && receipt.filePath) {
      window.desktop.removeFile(receipt.filePath).catch(() => {})
    }
    setPendingExpenses(list => list.filter(r => r.id !== receipt.id))
  }

  async function exportWeek() {
    setExporting(true)
    setEmailError('')
    setEmailNote('')
    try {
      const w = week
      const label = weekLabel(activeKey)
      const now = new Date().toLocaleDateString('en-CA')
      const logoDataUrl = await fetchLogoBase64()

      const weekMain = weekMainCustomer(w.workers)
      const allWorkerExpenses = (w.workers || []).flatMap(wk => (wk.expenses || []).map(e => ({ ...e, _workerName: wk.name })))
      const receiptMap = {}
      if (isDesktop) {
        await Promise.all(allWorkerExpenses.filter(e => e.id).map(async e => {
          try {
            const files = await window.desktop.listFiles(`Timesheets/Receipts/${e.id}/Files`)
            const withData = await Promise.all((files || []).map(async f => {
              const isImg = /\.(jpg|jpeg|png|webp|heic)$/i.test(f.name)
              if (!isImg) return { ...f, b64: null }
              const base64 = await window.desktop.readFileBytes(f.path)
              return { ...f, b64: base64 ? `data:image/jpeg;base64,${base64}` : null }
            }))
            receiptMap[e.id] = withData
          } catch { /* skip this expense's receipts if anything goes wrong reading them */ }
        }))
      }

      const workerBlocksHtml = (w.workers || []).filter(wk => wk.name.trim()).map(worker => {
        const normDays = worker.days.map(d => Array.isArray(d) ? d : [d])
        const workerReg = normDays.reduce((a, entries) => a + entries.reduce((b, d) => b + (parseFloat(d.reg) || 0), 0), 0)
        const workerOT = normDays.reduce((a, entries) => a + entries.reduce((b, d) => b + (parseFloat(d.ot) || 0), 0), 0)
        const workerTotal = workerReg + workerOT
        const totalLabel = workerOT > 0
          ? `${workerReg}h reg&nbsp;+&nbsp;${workerOT}h OT&nbsp;=&nbsp;<strong style="color:#fff">${workerTotal}h</strong>`
          : `<strong style="color:#fff">${workerTotal}h</strong>`

        const dayRows = normDays.map((entries, i) => {
          const hasAny = entries.some(d => d.reg || d.ot)
          if (!hasAny) return ''
          const dayReg = entries.reduce((a, d) => a + (parseFloat(d.reg) || 0), 0)
          const dayOT = entries.reduce((a, d) => a + (parseFloat(d.ot) || 0), 0)
          const dayCell = `<strong>${weekdayName(activeKey, i)}</strong> <span style="font-weight:400;color:#aaa;font-size:10px">${dayDate(activeKey, i)}</span>`
          const cust = dayByCustomer(entries, weekMain)
          const custHtml = cust.length === 1
            ? `<span style="color:#333">${escHtml(cust[0].customer)}</span>`
            : cust.map(c => `<div style="color:#333">${escHtml(c.customer)} <span style="color:#1a237e;font-weight:700">— ${c.reg + c.ot}h</span>${c.ot ? ` <span style="color:#b71c1c;font-size:10px">(${c.ot}h OT)</span>` : ''}</div>`).join('')
          return `<tr>
              <td style="width:140px">${dayCell}</td>
              <td style="width:60px;text-align:center;color:#1a237e;font-weight:700">${dayReg > 0 ? dayReg + 'h' : '<span style="color:#ddd">—</span>'}</td>
              <td style="width:60px;text-align:center;color:${dayOT > 0 ? '#b71c1c' : '#ddd'};font-weight:${dayOT > 0 ? 700 : 400}">${dayOT > 0 ? dayOT + 'h' : '—'}</td>
              <td>${custHtml}</td>
            </tr>`
        }).join('')

        const totalsBar = `<div class="wk-totals">
          <span>Regular: <strong>${workerReg}h</strong></span>
          ${workerOT > 0 ? `<span style="color:#b71c1c">Overtime: <strong>${workerOT}h</strong></span>` : ''}
          <span>Total: <strong>${workerTotal}h</strong></span>
        </div>`

        const wkFilledExp = (worker.expenses || []).filter(e => e.desc)
        let expHtml = ''
        if (wkFilledExp.length > 0) {
          const wkExpTotal = wkFilledExp.reduce((a, e) => a + (parseFloat(e.amount) || 0), 0)
          const expRows = wkFilledExp.map(e => {
            const receipts = receiptMap[e.id] || []
            const hasAtt = receipts.length > 0
            const badge = hasAtt ? ' <span style="font-size:9px;background:#e8eaf6;color:#1a237e;font-weight:700;border-radius:3px;padding:1px 4px;vertical-align:middle">receipt</span>' : ''
            return `<tr>
              <td style="color:#888;width:88px">${e.date || '—'}</td>
              <td>${e.desc}${badge}</td>
              <td style="text-align:right;font-weight:700;color:#37474f;white-space:nowrap;width:90px">${e.amount ? '$' + parseFloat(e.amount).toFixed(2) : '—'}</td>
            </tr>`
          }).join('')
          const expTotalRow = wkFilledExp.length > 1 ? `<tr class="exp-total-row">
            <td colspan="2" style="text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#777">Total</td>
            <td style="text-align:right;color:#1a237e">${money(wkExpTotal)}</td>
          </tr>` : ''
          expHtml = `<div class="exp-head">Expenses</div>
          <table class="exp-table">
            <thead><tr>
              <th style="padding:5px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;background:#f8f9fb;text-align:left;width:88px">Date</th>
              <th style="padding:5px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;background:#f8f9fb;text-align:left">Description</th>
              <th style="padding:5px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;background:#f8f9fb;text-align:right;width:90px">Amount</th>
            </tr></thead>
            <tbody>${expRows}${expTotalRow}</tbody>
          </table>`
        }

        return `<div class="worker-block">
          <div class="wk-head">
            <span class="wk-name">${worker.name}</span>
            <span class="wk-total">${totalLabel}</span>
          </div>
          <table class="wk-table">
            <thead><tr>
              <th>Day</th>
              <th style="text-align:center;width:60px">Reg</th>
              <th style="text-align:center;width:60px">OT</th>
              <th>Customer</th>
            </tr></thead>
            <tbody>${dayRows}</tbody>
          </table>
          ${totalsBar}
          ${expHtml}
        </div>`
      }).join('')

      const filledExpenses = allWorkerExpenses.filter(e => e.desc)
      const receiptPages = filledExpenses.flatMap(e => {
        const receipts = (receiptMap[e.id] || []).filter(f => f.b64)
        return receipts.map((f, i) => `<div style="page-break-before:always;padding:32px;display:flex;flex-direction:column;height:100vh;box-sizing:border-box">
          <div style="border-bottom:2px solid #1a237e;padding-bottom:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-end">
            <div>
              <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#999;text-transform:uppercase;margin-bottom:2px">${e._workerName || ''} — Receipt${e.date ? ' · ' + e.date : ''}</div>
              <div style="font-size:16px;font-weight:700;color:#1a237e">${e.desc}${receipts.length > 1 ? ' (' + (i + 1) + ' of ' + receipts.length + ')' : ''}</div>
            </div>
            <div style="font-size:14px;font-weight:700;color:#1a237e">${e.amount ? '$' + parseFloat(e.amount).toFixed(2) : ''}</div>
          </div>
          <div style="flex:1;display:flex;align-items:center;justify-content:center">
            <img src="${f.b64}" style="max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.12)" />
          </div>
        </div>`)
      }).join('')

      const receivedList = includeReceived ? receivedInWeek(materialOrders, activeKey) : []
      // Copy the slips into OneDrive (Field App/Material Slips/<week>) so the
      // invoice # and quote # on the PDF are links Jonathan can open
      let links = {}
      if (isDesktop && receivedList.length && window.desktop.onedrivePublishSlips) {
        try {
          const qmap = {}
          receivedList.forEach(o => { qmap[o.id] = [...new Set(matchOrdersByPo(feedRows, o.poNumber).flatMap(quoteNumbersOf).filter(n => !/^order/i.test(n)))] })
          const r = await window.desktop.onedrivePublishSlips({
            subfolder: `Material Slips/${activeKey}`,
            files: receivedList.filter(o => o.slipPath).map(o => ({ key: o.id, rel: o.slipPath, name: String(o.slipPath).split('/').pop() })),
            quotes: [...new Set(Object.values(qmap).flat())],
          })
          if (r && r.webBase) links = { ...r, qmap }
        } catch { /* links are a nice-to-have */ }
      }
      const receivedHtml = includeReceived ? receivedMaterialHtml(receivedList, links) : ''
      const html = buildExportHtml({
        title: `Timesheet — ${label}`,
        meta: `Week of ${label} · Generated ${now}`,
        workerBlocksHtml: workerBlocksHtml + receivedHtml,
        footerNote: `Timesheet · ${label} · SCE Electric`,
        appendix: receiptPages,
        logoDataUrl,
      })

      if (isDesktop) {
        const pdfBase64 = await window.desktop.pdfFromHtml(html)
        const fileName = `${activeKey} - Timesheet - ${label.replace(/[<>:"/\\|?*]/g, ' ')}.pdf`
        const savedPath = await window.desktop.saveFile('Timesheets/Exports', fileName, pdfBase64)
        // The slips on this timesheet are now on their way to Jonathan
        if (savedPath && receivedList.length) {
          const ids = new Set(receivedList.map(o => o.id))
          const at = new Date().toISOString()
          setMaterialOrders(list => list.map(o => ids.has(o.id) && !o.sentAt ? { ...o, sentAt: at, sentWithWeek: activeKey } : o))
        }

        // A written email with the timesheet and the received slips attached
        const hrs = v => (Math.round(v * 100) / 100).toString()
        const workerLines = (w.workers || []).filter(wk => wk.name.trim()).map(wk => {
          const days = wk.days.map(d => Array.isArray(d) ? d : [d])
          const reg = days.reduce((a, es) => a + es.reduce((b, d) => b + (parseFloat(d.reg) || 0), 0), 0)
          const ot = days.reduce((a, es) => a + es.reduce((b, d) => b + (parseFloat(d.ot) || 0), 0), 0)
          return `  • ${wk.name.trim()}: ${hrs(reg + ot)} h${ot ? ` (${hrs(reg)} reg + ${hrs(ot)} OT)` : ''}`
        })
        const exp = allWorkerExpenses.filter(e => e.desc || Number(e.amount))
        const recTotal = receivedList.reduce((a, o) => a + orderTotalForReport(o), 0)
        const slipFiles = receivedList.filter(o => o.slipPath).map(o => o.slipPath)
        const text = [
          'Hi Jonathan,',
          '',
          `Attached is the timesheet for the week of ${label}.`,
          '',
          'Hours:',
          ...(workerLines.length ? workerLines : ['  • none entered']),
          ...(exp.length ? ['', `Expenses (${exp.length}, receipts are in the PDF):`, ...exp.map(e => `  • ${e._workerName ? e._workerName + ' — ' : ''}${e.desc || 'Expense'}${Number(e.amount) ? ': ' + money(e.amount) : ''}`)] : []),
          ...(receivedList.length ? ['', `Material received (${receivedList.length} slip${receivedList.length === 1 ? '' : 's'}, ${money(recTotal)} before GST${slipFiles.length ? ' — slips attached' : ''}):`,
            ...receivedList.map(o => `  • ${o.wholesaler || 'Slip'}${o.invoiceNumber ? ' #' + o.invoiceNumber : ''}${o.poNumber ? ' · PO ' + o.poNumber : ''}${(o.jobs || []).length ? ' · ' + o.jobs.map(j => j.name).filter(Boolean).join(', ') : ''}: ${money(orderTotalForReport(o))}${o.timesheetNote ? ` (${o.timesheetNote})` : ''}`)] : []),
        ].join('\n') // no sign-off — Outlook adds the signature
        const emailResult = await window.desktop.draftEmail({
          to: 'Jonathandumont@sceelectric.com',
          subject: `Timesheet — ${label}`,
          text,
          attachments: [savedPath, ...slipFiles],
        })
        if (!emailResult.ok) setEmailError(emailResult.error)
        else {
          setEmailError('')
          setEmailNote(emailResult.method === 'eml'
            ? `Email to Jonathan is ready in Outlook with ${emailResult.attached.length} attachment${emailResult.attached.length === 1 ? '' : 's'} — check it and press Send.${emailResult.missing.length ? ` Couldn't find: ${emailResult.missing.join(', ')}.` : ''}`
            : 'Compose window opened, and the PDF is highlighted in your file explorer — drag it into the email to attach it.')
        }
      } else {
        const base64 = textToBase64(html)
        const fileName = `${activeKey} - Timesheet - ${label.replace(/[<>:"/\\|?*]/g, ' ')}.html`
        const link = document.createElement('a')
        link.href = `data:text/html;base64,${base64}`
        link.download = fileName
        link.click()
      }
    } finally {
      setExporting(false)
    }
  }

  const totalReg = (week.workers || []).reduce((a, w) => a + (w.days || []).reduce((b, d) => { const entries = Array.isArray(d) ? d : [d]; return b + entries.reduce((c, e) => c + (parseFloat(e.reg) || 0), 0) }, 0), 0)
  const totalOT = (week.workers || []).reduce((a, w) => a + (w.days || []).reduce((b, d) => { const entries = Array.isArray(d) ? d : [d]; return b + entries.reduce((c, e) => c + (parseFloat(e.ot) || 0), 0) }, 0), 0)
  const historyKeys = Object.keys(sheets).sort((a, b) => b.localeCompare(a))

  return (
    <div>
      <div style={{ background: 'var(--navy)', padding: '13px 16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setActiveKey(k => offsetWeekKey(k, -1))}
              style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '5px 10px', color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}>
              ‹
            </button>
            <div>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: 15, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                Timesheets
                {activeKey !== currentKey && (
                  <button onClick={() => setActiveKey(currentKey)}
                    style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--accent)', color: 'var(--navy)', border: 'none', cursor: 'pointer', letterSpacing: '.04em' }}>
                    TODAY
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 1 }}>{weekLabel(activeKey)}</div>
            </div>
            <button
              onClick={() => setActiveKey(k => offsetWeekKey(k, 1))}
              disabled={activeKey >= currentKey}
              style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '5px 10px', color: activeKey >= currentKey ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: 700, cursor: activeKey >= currentKey ? 'default' : 'pointer', lineHeight: 1 }}>
              ›
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setClearAsk(a => !a)} title="Wipe this week's hours back to a blank sheet (people and expenses stay)"
              style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 'var(--rs)', padding: '7px 12px', color: 'rgba(255,255,255,.8)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              🧹 Clear
            </button>
            <button onClick={pullClockTime} title="Put this week's confirmed Time Tracking hours on the sheet (days already on it are skipped)"
              style={{ background: '#1e7a34', border: 'none', borderRadius: 'var(--rs)', padding: '7px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⏱ Pull clock time
            </button>
            <button onClick={() => setShowHistory(h => !h)} style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 'var(--rs)', padding: '7px 12px', color: 'rgba(255,255,255,.7)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {showHistory ? 'Hide' : 'History'}
            </button>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'rgba(255,255,255,.8)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" title="Add the received material page to the exported timesheet" checked={!!includeReceived} onChange={e => setIncludeReceived(e.target.checked)} style={{ cursor: 'pointer' }} />
              <button onClick={() => setShowReceived(true)} title="See what goes on this export — remove a slip or add a note"
                style={{ background: 'none', border: 'none', padding: 0, color: 'rgba(255,255,255,.9)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>
                Received material ({receivedInWeek(materialOrders, activeKey).length})
              </button>
            </span>
            <button onClick={exportWeek} disabled={exporting} style={{ background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', padding: '7px 14px', color: 'var(--navy)', fontFamily: 'var(--font-d)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {exporting ? 'Exporting…' : isDesktop ? '↓ Export & Email' : '↓ Export'}
            </button>
          </div>
        </div>

        {showReceived && (
          <ReceivedExportModal wk={activeKey} orders={materialOrders} setOrders={setMaterialOrders} included={!!includeReceived} onClose={() => setShowReceived(false)} />
        )}
        {emailError && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#ffd6d6', background: 'rgba(255,255,255,.08)', borderRadius: 'var(--rs)', padding: '6px 10px' }}>
            PDF exported fine, but couldn't open the email draft: {emailError}
          </div>
        )}
        {emailNote && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.08)', borderRadius: 'var(--rs)', padding: '6px 10px' }}>
            {emailNote}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ background: 'rgba(255,255,255,.08)', borderRadius: 'var(--rs)', padding: '6px 12px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Regular</div>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: '#fff' }}>{totalReg} hrs</div>
          </div>
          {totalOT > 0 && (
            <div style={{ background: 'rgba(255,255,255,.08)', borderRadius: 'var(--rs)', padding: '6px 12px' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Overtime</div>
              <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{totalOT} hrs</div>
            </div>
          )}
          <div style={{ background: 'rgba(255,255,255,.08)', borderRadius: 'var(--rs)', padding: '6px 12px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Total</div>
            <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: '#fff' }}>{totalReg + totalOT} hrs</div>
          </div>
        </div>
      </div>

      {pendingExpenses.length > 0 && (
        <div style={{ padding: 12, background: '#e8f2fc', borderBottom: '1px solid #1a5fa0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', marginBottom: 8 }}>
            📱 {pendingExpenses.length} receipt{pendingExpenses.length === 1 ? '' : 's'} from your phone waiting to be assigned to this week
          </div>
          {pendingExpenses.map(r => (
            <PendingExpenseRow
              key={r.id} receipt={r}
              workerNames={pickerNames(crew.active, week.workers.map(w => w.name || '').filter(Boolean))}
              onAssign={opts => assignPendingExpense(r, opts)}
              onDismiss={() => dismissPendingExpense(r)}
            />
          ))}
        </div>
      )}

      {clearAsk && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#fdecea', color: '#8e1f14', fontSize: 12.5, flexWrap: 'wrap' }}>
          <b>Clear {weekLabel(activeKey)}?</b>
          <span style={{ flex: 1 }}>Every hour line goes back to blank. The people and expenses stay. Then ⏱ Pull clock time to fill it again.</span>
          <button onClick={() => setClearAsk(false)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: '#fff', color: 'var(--text-mid)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={clearWeek} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#c0392b', color: '#fff', cursor: 'pointer' }}>🧹 Clear the week</button>
        </div>
      )}
      {undoWeek && undoWeek.key === activeKey && !clearAsk && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', background: '#fff3d6', color: '#8a5d00', fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>Week cleared.</span>
          <button onClick={undoClear} style={{ fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 6, border: '1px solid #e0a716', background: '#fff', color: '#8a5d00', cursor: 'pointer' }}>↺ Undo</button>
          <button onClick={() => setUndoWeek(null)} style={{ fontSize: 12, border: 'none', background: 'none', color: '#8a5d00', cursor: 'pointer' }}>×</button>
        </div>
      )}
      {pullMsg && <div onClick={() => setPullMsg('')} title="Click to hide" style={{ padding: '7px 16px', fontSize: 12.5, cursor: 'pointer', background: pullMsg.startsWith('✓') ? '#e6f4ea' : '#fff3d6', color: pullMsg.startsWith('✓') ? '#1e7a34' : '#8a5d00' }}>{pullMsg}</div>}
      {showHistory && (() => {
        const pastWeeks = []
        for (let i = 0; i <= 12; i++) pastWeeks.push(offsetWeekKey(currentKey, -i))
        historyKeys.forEach(k => { if (!pastWeeks.includes(k)) pastWeeks.push(k) })
        pastWeeks.sort((a, b) => b.localeCompare(a))
        return (
          <div style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', padding: '8px 12px', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Select Week</div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {pastWeeks.map(k => {
                const hasData = !!sheets[k]
                const isActive = activeKey === k
                const isCurrent = k === currentKey
                return (
                  <button key={k} onClick={() => { setActiveKey(k); setShowHistory(false) }}
                    style={{
                      flexShrink: 0, padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: `1.5px solid ${isActive ? 'var(--navy)' : hasData ? 'var(--border)' : 'rgba(0,0,0,.1)'}`,
                      background: isActive ? 'var(--navy)' : hasData ? 'var(--surface)' : 'var(--surface-2)',
                      color: isActive ? '#fff' : hasData ? 'var(--text-mid)' : 'var(--text-light)',
                      whiteSpace: 'nowrap', position: 'relative',
                    }}>
                    {isCurrent ? 'This Week' : weekLabel(k)}
                    {hasData && !isActive && (
                      <span style={{ position: 'absolute', top: 2, right: 4, width: 5, height: 5, borderRadius: '50%', background: 'var(--navy)', opacity: .5 }} />
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4 }}>· dot = has entries &nbsp;·&nbsp; dimmed = no entries yet</div>
          </div>
        )
      })()}

      <div style={{ padding: '12px 12px 80px' }}>
        {(week.workers || []).map((worker, idx) => (
          <WorkerSheet
            key={idx}
            worker={worker}
            weekKey={activeKey}
            onChange={updated => updateWorker(idx, updated)}
            onRemove={() => removeWorker(idx)}
            isOnly={(week.workers || []).length === 1}
            findPerson={crew.findByName}
            weekMain={weekMainCustomer(week.workers)}
            customerOptions={customerOptions}
          />
        ))}

        <select value="" onChange={e => addWorker(e.target.value)} aria-label="Add worker"
          style={{ width: '100%', padding: '10px', background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--rs)', fontSize: 13, fontWeight: 600, color: 'var(--text-light)', cursor: 'pointer', marginBottom: 16, textAlign: 'center', textAlignLast: 'center' }}>
          <option value="">+ Add Worker</option>
          {addable.map(p => <option key={p.id} value={p.id}>{p.name}{p.role ? ` — ${p.role}` : ''}</option>)}
          <option value="__new__">+ New person…</option>
        </select>
        {newPerson !== null && (
          <div style={{ display: 'flex', gap: 6, marginTop: -8, marginBottom: 16 }}>
            <input autoFocus value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="Name of the new person (added to the Crew list too)"
              onKeyDown={e => { if (e.key === 'Enter' && newPerson.trim()) { addWorker('__name__:' + newPerson.trim()); setNewPerson(null) } if (e.key === 'Escape') setNewPerson(null) }}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 13 }} />
            <button disabled={!newPerson.trim()} onClick={() => { addWorker('__name__:' + newPerson.trim()); setNewPerson(null) }} style={{ padding: '6px 14px', fontWeight: 700, borderRadius: 'var(--rs)', border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer' }}>Add</button>
            <button onClick={() => setNewPerson(null)} style={{ padding: '6px 12px', borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
