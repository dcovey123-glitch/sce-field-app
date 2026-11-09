import React, { useState } from 'react'
import { billingNoteText, isReviewed } from '../api/billingCheck.js'
import { money } from '../api/format.js'

// Shows the result of billingCheck(): a pill for the slip row, a short
// summary for the slip review, and the full breakdown modal.

const cell = { padding: '5px 6px', borderTop: '1px solid var(--border)', fontSize: 12, verticalAlign: 'top' }
const pillStyle = (bg, fg) => ({ fontSize: 10, fontWeight: 700, background: bg, color: fg, borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap', border: 'none', cursor: 'pointer' })

export function billingHeadline(res) {
  const n = res.issues.length
  if (res.status === 'flag') return `⚠ Billing: ${n} difference${n === 1 ? '' : 's'}${res.over > 0 ? ` · ${money(res.over)} over` : ''}`
  if (res.status === 'ok') return '✓ Billing matches the order'
  if (res.status === 'okTotals') return '✓ Within the quoted total'
  if (res.status === 'noOrder') return 'No order in Orders & POs with this PO #'
  return ''
}

export { isReviewed }

export function BillingPill({ res, reviewed, onOpen }) {
  if (!res || res.status === 'none') return null
  if (res.status === 'flag' && reviewed) return <button onClick={onOpen} style={pillStyle('#eef2f8', '#555')}>✓ billing reviewed ({res.issues.length})</button>
  if (res.status === 'flag') return <button onClick={onOpen} style={pillStyle('#fdf0f0', '#a12a1e')}>{billingHeadline(res)}</button>
  if (res.status === 'ok' || res.status === 'okTotals') return <button onClick={onOpen} style={pillStyle('#e6f4ea', '#1e7a34')}>{billingHeadline(res)}</button>
  return <span style={{ ...pillStyle('#f0efec', '#777'), cursor: 'default' }}>no PO match</span>
}

// Compact list for the slip review screen (before confirming)
export function BillingSummary({ res }) {
  if (!res || res.status === 'none' || res.status === 'noOrder') return null
  const ok = res.status !== 'flag'
  return (
    <div style={{ fontSize: 12, marginBottom: 10, padding: '7px 10px', borderRadius: 'var(--rs)', background: ok ? 'var(--green-bg, #e6f4ea)' : '#fdf0f0', border: `1px solid ${ok ? '#b9e6d2' : '#e8b4ae'}`, color: ok ? 'var(--green-dark, #1e7a34)' : '#a12a1e' }}>
      <b>{billingHeadline(res)}</b>
      {!ok && (
        <div style={{ marginTop: 3, color: 'var(--text-mid)' }}>
          {res.issues.slice(0, 5).map((i, k) => <div key={k}>• {issueText(i)}</div>)}
          {res.issues.length > 5 && <div>…and {res.issues.length - 5} more (see the slip's billing check after saving)</div>}
        </div>
      )}
    </div>
  )
}

function issueText(i) {
  const what = `${i.partNo ? i.partNo + ' ' : ''}${i.desc || ''}`.trim()
  if (i.type === 'price') return `${what}: billed ${money(i.unit)} vs quoted ${money(i.orderedUnit)} — ${i.amount > 0 ? '+' : '−'}${money(Math.abs(i.amount))}`
  if (i.type === 'overQty') return `${what}: ${i.qty} billed on this PO vs ${i.orderedQty} ordered`
  if (i.type === 'extra') return `${what}: not on the order (${money(i.amount)})`
  return i.desc
}

export default function BillingCheckModal({ slip, res, onClose, onReviewed, onShowLine }) {
  const go = i => onShowLine && (i.partNo || i.desc) ? <button onClick={() => onShowLine(i.partNo || i.desc)} title="Open the slip at this line" style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>→ on slip</button> : null
  const [note, setNote] = useState(slip.billingNote || '')
  const [copied, setCopied] = useState(false)
  const by = t => res.issues.filter(i => i.type === t)
  const toCome = res.info.filter(i => i.type === 'toCome')
  const bo = res.info.filter(i => i.type === 'backordered')
  const head = (t, color) => <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 0 4px' }}>{t}</div>
  const th = { padding: '0 6px', fontSize: 11, color: 'var(--text-light)', textAlign: 'left', fontWeight: 600 }

  async function copyNote() {
    const text = billingNoteText(slip, res)
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 820, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>Billing check — {slip.wholesaler || 'Slip'}{slip.invoiceNumber ? ` #${slip.invoiceNumber}` : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '2px 0 6px' }}>
          PO {slip.poNumber} · ordered on {res.matches.map(m => `${m.supplier} ${m.quoteNumber}`).join(', ') || '—'}
          {res.ordered ? ` · quoted ${money(res.ordered.total)}` : ''}
          {res.billed ? ` · this slip ${money(res.billed.thisSlip)}${res.slips.length > 1 ? ` · all ${res.slips.length} slips on this PO ${money(res.billed.poTotal)}` : ''}` : ''}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: res.status === 'flag' ? '#a12a1e' : '#1e7a34', marginBottom: 6 }}>{billingHeadline(res)}</div>

        {by('price').length > 0 && <>
          {head('Price different from the quote', '#a12a1e')}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Item</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Quoted</th><th style={{ ...th, textAlign: 'right' }}>Billed</th><th style={{ ...th, textAlign: 'right' }}>Difference</th></tr></thead>
            <tbody>{by('price').map((i, k) => (
              <tr key={k}>
                <td style={cell}>{i.partNo ? <b>{i.partNo} </b> : null}{i.desc}{i.quote ? <span style={{ color: 'var(--text-light)' }}> · quote {i.quote}</span> : null}{go(i)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{i.qty} {i.uom}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{money(i.orderedUnit)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{money(i.unit)}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: i.amount > 0 ? '#c0392b' : '#1e7a34' }}>{i.amount > 0 ? '+' : '−'}{money(Math.abs(i.amount))}</td>
              </tr>
            ))}</tbody>
          </table>
        </>}

        {by('overQty').length > 0 && <>
          {head('More billed than ordered', '#a12a1e')}
          {by('overQty').map((i, k) => <div key={k} style={{ fontSize: 12, padding: '3px 0' }}>{i.partNo ? <b>{i.partNo} </b> : null}{i.desc} — <b>{i.qty} {i.uom}</b> billed on PO {slip.poNumber} vs <b>{i.orderedQty}</b> ordered (≈ {money(i.amount)} extra){go(i)}</div>)}
        </>}

        {by('extra').length > 0 && <>
          {head('Not on the quote / PO', '#a12a1e')}
          {by('extra').map((i, k) => <div key={k} style={{ fontSize: 12, padding: '3px 0' }}>{i.partNo ? <b>{i.partNo} </b> : null}{i.desc} — {i.qty} {i.uom} · {money(i.amount)}{go(i)}</div>)}
        </>}

        {[...by('math'), ...by('overTotal')].length > 0 && <>
          {head('Totals', '#a12a1e')}
          {[...by('math'), ...by('overTotal')].map((i, k) => <div key={k} style={{ fontSize: 12, padding: '3px 0' }}>{i.desc}</div>)}
        </>}

        {bo.length > 0 && <>
          {head('Backordered on this slip', '#9a6610')}
          {bo.map((i, k) => <div key={k} style={{ fontSize: 12, padding: '2px 0', color: 'var(--text-mid)' }}>{i.partNo ? <b>{i.partNo} </b> : null}{i.desc} — {i.qty} {i.uom}</div>)}
        </>}
        {toCome.length > 0 && <>
          {head('Ordered, not billed/shipped yet', '#1a5fa0')}
          {toCome.map((i, k) => <div key={k} style={{ fontSize: 12, padding: '2px 0', color: 'var(--text-mid)' }}>{i.partNo ? <b>{i.partNo} </b> : null}{i.desc} — {i.qty} of {i.orderedQty} {i.uom}</div>)}
        </>}

        {res.status === 'flag' && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 3 }}>Note (what you did about it)</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called Justin — credit coming / price was updated, OK"
              style={{ width: '100%', fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', boxSizing: 'border-box', fontFamily: 'var(--font)' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          {slip.billingReviewedAt && <span style={{ flex: 1, fontSize: 11, color: 'var(--text-light)' }}>Reviewed {slip.billingReviewedAt.slice(0, 10)}{slip.billingNote ? ` — ${slip.billingNote}` : ''}</span>}
          {res.status === 'flag' && <button onClick={copyNote} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>{copied ? '✓ Copied' : '📋 Copy note for the wholesaler'}</button>}
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
          {res.status === 'flag' && (
            <button onClick={() => { onReviewed({ billingReviewedAt: slip.billingReviewedAt && !note ? slip.billingReviewedAt : new Date().toISOString(), billingNote: note, billingReviewedOver: res.over, billingReviewedCount: res.issues.length }); onClose() }}
              style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
              ✓ Mark reviewed
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
