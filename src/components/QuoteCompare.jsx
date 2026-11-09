import React, { useState } from 'react'
import { money } from '../api/format.js'
import { compareToQuote, applyCompare } from '../api/quoteCompare.js'

// Compares a wholesaler pricing quote (or slip) against one of Dustin's
// customer quotes' material lists. Flags price differences; for each of their
// lines that doesn't match one of ours you choose: add it, skip it, or say
// which of our lines it is (their part # and price go on that line). Nothing
// changes on the quote until Apply.
//
// lines: [{ partNo, name, uom, qty, cost }]   (wholesaler prices)
// quote: a Quotes record — quote.scopes[].materials[] = { id, partNo, desc, uom, qty, rate }
// source: { kind, id, label, date, number?, slipPath? } — kept on the quote as "priced from"
export { compareToQuote }

const cell = { padding: '5px 6px', borderTop: '1px solid var(--border)', fontSize: 12, verticalAlign: 'top' }

export default function QuoteCompare({ lines, quote, sourceLabel, source = null, onApply, onClose }) {
  const { diffs, missing, same, quoteLines, unpriced } = compareToQuote(lines, quote)
  const scopes = quote.scopes || []
  // per missing line: 'add' | 'skip' | 'r:<quote line id>'
  const [choice, setChoice] = useState(() => Object.fromEntries(missing.map(m => [m.i, 'add'])))
  const [update, setUpdate] = useState({}) // diff index → true = take the wholesaler price
  const [scopeId, setScopeId] = useState(scopes[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const toAdd = missing.filter(m => choice[m.i] === 'add')
  const toReplace = missing.filter(m => String(choice[m.i]).startsWith('r:')).map(m => ({ line: m.line, quoteLineId: choice[m.i].slice(2) }))
  const toUpdate = diffs.filter(d => update[d.i])
  const takenIds = new Set(toReplace.map(r => r.quoteLineId))
  const ours = [...unpriced, ...quoteLines.filter(q => !unpriced.includes(q))] // not-yet-priced lines first

  async function apply() {
    setSaving(true)
    try {
      await onApply(cur => applyCompare(cur, { update: toUpdate, add: toAdd, replace: toReplace, scopeId, source }),
        { added: toAdd.length, updated: toUpdate.length + toReplace.length, flagged: diffs.length })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 900, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>Compare to quote {quote.quoteNumber}{quote.title ? ` — ${quote.title}` : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '2px 0 12px' }}>
          {sourceLabel} · {lines.length} line{lines.length === 1 ? '' : 's'}: <b style={{ color: diffs.length ? '#c0392b' : undefined }}>{diffs.length} price difference{diffs.length === 1 ? '' : 's'}</b>, {missing.length} not matched to a line on the quote, {same.length} match
        </div>

        {diffs.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#c0392b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>⚠ Price differences</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead><tr style={{ fontSize: 11, color: 'var(--text-light)', textAlign: 'left' }}>
                <th style={{ padding: '0 6px' }}>Item</th><th style={{ padding: '0 6px' }}>Scope</th><th style={{ padding: '0 6px', textAlign: 'right' }}>On quote</th><th style={{ padding: '0 6px', textAlign: 'right' }}>Wholesaler</th><th style={{ padding: '0 6px', textAlign: 'right' }}>Diff</th><th style={{ padding: '0 6px' }}>Update quote?</th>
              </tr></thead>
              <tbody>
                {diffs.map(d => {
                  const diff = (Number(d.line.cost) || 0) - (Number(d.match.rate) || 0)
                  return (
                    <tr key={d.i}>
                      <td style={cell}>{d.line.partNo ? <b>{d.line.partNo} </b> : null}{d.line.name}</td>
                      <td style={cell}>{d.match.scopeName || '—'}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{money(d.match.rate)}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{money(d.line.cost)}</td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: diff > 0 ? '#c0392b' : '#1e7a34' }}>{diff > 0 ? '+' : ''}{money(diff)}</td>
                      <td style={cell}><label style={{ fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={!!update[d.i]} onChange={e => setUpdate(u => ({ ...u, [d.i]: e.target.checked }))} /> use wholesaler price</label></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {missing.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', textTransform: 'uppercase', letterSpacing: '.05em' }}>❓ Not matched to a line on the quote</div>
              <span style={{ fontSize: 11, color: 'var(--text-light)' }}>Different part # or wording? Pick which of your lines it is — their part # and price go on it, your wording stays.</span>
              {scopes.length > 1 && toAdd.length > 0 && (
                <label style={{ fontSize: 11, color: 'var(--text-mid)' }}>new lines go in{' '}
                  <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={{ fontSize: 11, padding: '2px 4px' }}>
                    {scopes.map(s => <option key={s.id} value={s.id}>{s.name || 'Scope'}</option>)}
                  </select>
                </label>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <tbody>
                {missing.map(m => {
                  const v = choice[m.i]
                  const rep = String(v).startsWith('r:') ? quoteLines.find(q => q.id === v.slice(2)) : null
                  return (
                    <tr key={m.i} style={{ background: rep ? '#eef8f1' : v === 'skip' ? '#f7f7f7' : undefined }}>
                      <td style={cell}>{m.line.partNo ? <b>{m.line.partNo} </b> : null}{m.line.name}</td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{m.line.qty} {m.line.uom}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{money(m.line.cost)}</td>
                      <td style={{ ...cell, width: 330 }}>
                        <select value={v} onChange={e => setChoice(c => ({ ...c, [m.i]: e.target.value }))} style={{ fontSize: 11.5, padding: '3px 4px', width: '100%', border: `1px solid ${rep ? '#1e7a34' : 'var(--border)'}`, borderRadius: 5 }}>
                          <option value="add">➕ Add as a new line</option>
                          <option value="skip">— Skip it</option>
                          <optgroup label="It's this line on my quote:">
                            {ours.map(q => (
                              <option key={q.id} value={'r:' + q.id} disabled={takenIds.has(q.id) && v !== 'r:' + q.id}>
                                {`${unpriced.includes(q) ? '' : '(priced) '}${q.desc || q.partNo || 'Line'}${q.qty ? ` × ${q.qty}` : ''}${q.rate ? ` @ ${money(q.rate)}` : ''}${scopes.length > 1 ? ` — ${q.scopeName || 'Scope'}` : ''}`}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {rep && <div style={{ fontSize: 11, color: '#1e7a34', marginTop: 2 }}>{rep.desc || 'Your line'}: {money(rep.rate)} → <b>{money(m.line.cost)}</b>{m.line.partNo && m.line.partNo !== rep.partNo ? ` · part # ${m.line.partNo}` : ''}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {same.length > 0 && <div style={{ fontSize: 11, color: '#1e7a34', marginBottom: 6 }}>✓ {same.length} line{same.length === 1 ? '' : 's'} already on the quote at the same price</div>}
        {unpriced.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10 }}>On your quote but not on theirs: {unpriced.slice(0, 6).map(q => q.desc || q.partNo).join(', ')}{unpriced.length > 6 ? ` +${unpriced.length - 6} more` : ''}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-light)' }}>{source ? 'The quote keeps this as a pricing reference.' : ''}</span>
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
          <button onClick={apply} disabled={saving}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
            {saving ? 'Saving…' : toAdd.length || toUpdate.length || toReplace.length ? `Apply — add ${toAdd.length}, update ${toUpdate.length + toReplace.length}` : 'Done — mark checked'}
          </button>
        </div>
      </div>
    </div>
  )
}
