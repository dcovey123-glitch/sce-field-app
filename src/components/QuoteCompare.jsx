import React, { useState } from 'react'
import { sameItem } from '../api/slips.js'
import { money } from '../api/format.js'

// Compares a wholesaler pricing quote (or slip) against one of Dustin's
// customer quotes' material lists. Flags price differences, and offers to add
// the lines that aren't on the quote. Nothing changes on the quote until the
// Apply click.
//
// lines: [{ partNo, name, uom, qty, cost }]   (wholesaler prices)
// quote: a Quotes record — quote.scopes[].materials[] = { id, partNo, desc, uom, qty, rate }

function uid() { return Math.random().toString(36).slice(2, 10) }
const cell = { padding: '5px 6px', borderTop: '1px solid var(--border)', fontSize: 12, verticalAlign: 'top' }

export function compareToQuote(lines, quote) {
  const quoteLines = []
  ;(quote.scopes || []).forEach(sc => (sc.materials || []).forEach(m => quoteLines.push({ ...m, scopeId: sc.id, scopeName: sc.name })))
  const diffs = [], missing = [], same = []
  lines.forEach((l, i) => {
    const m = quoteLines.find(q => sameItem({ partNo: q.partNo, name: q.desc }, { partNo: l.partNo, name: l.name }))
    const cost = Number(l.cost) || 0
    if (!m) missing.push({ i, line: l })
    else if (Math.abs((Number(m.rate) || 0) - cost) > 0.005) diffs.push({ i, line: l, match: m })
    else same.push({ i, line: l, match: m })
  })
  return { diffs, missing, same, quoteLines }
}

export default function QuoteCompare({ lines, quote, sourceLabel, onApply, onClose }) {
  const { diffs, missing, same } = compareToQuote(lines, quote)
  const scopes = quote.scopes || []
  const [add, setAdd] = useState(() => Object.fromEntries(missing.map(m => [m.i, true])))
  const [update, setUpdate] = useState({}) // diff index → true = take the wholesaler price
  const [scopeId, setScopeId] = useState(scopes[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const toAdd = missing.filter(m => add[m.i])
  const toUpdate = diffs.filter(d => update[d.i])

  async function apply() {
    setSaving(true)
    try {
      await onApply(cur => {
        const sc = (cur.scopes || []).length ? cur.scopes : [{ id: uid(), name: 'Materials', scopeText: '', materials: [], labor: [] }]
        const target = sc.find(s => s.id === scopeId) || sc[0]
        const next = sc.map(s => {
          let mats = (s.materials || []).map(m => {
            const d = toUpdate.find(x => x.match.id === m.id)
            return d ? { ...m, rate: Number(d.line.cost) || 0 } : m
          })
          if (s.id === target.id) {
            mats = [...mats, ...toAdd.map(({ line }) => ({
              id: uid(), partNo: line.partNo || '', desc: line.name || '', uom: line.uom || '', qty: Number(line.qty) || 0, rate: Number(line.cost) || 0,
            }))]
          }
          return { ...s, materials: mats }
        })
        return { scopes: next }
      }, { added: toAdd.length, updated: toUpdate.length, flagged: diffs.length })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 820, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>Compare to quote {quote.quoteNumber}{quote.title ? ` — ${quote.title}` : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '2px 0 12px' }}>
          {sourceLabel} · {lines.length} line{lines.length === 1 ? '' : 's'}: <b style={{ color: diffs.length ? '#c0392b' : undefined }}>{diffs.length} price difference{diffs.length === 1 ? '' : 's'}</b>, {missing.length} not on the quote, {same.length} match
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', textTransform: 'uppercase', letterSpacing: '.05em' }}>➕ Not on the quote</div>
              {scopes.length > 1 && (
                <label style={{ fontSize: 11, color: 'var(--text-mid)' }}>add to scope{' '}
                  <select value={scopeId} onChange={e => setScopeId(e.target.value)} style={{ fontSize: 11, padding: '2px 4px' }}>
                    {scopes.map(s => <option key={s.id} value={s.id}>{s.name || 'Scope'}</option>)}
                  </select>
                </label>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
              <tbody>
                {missing.map(m => (
                  <tr key={m.i}>
                    <td style={{ ...cell, width: 24 }}><input type="checkbox" checked={!!add[m.i]} onChange={e => setAdd(a => ({ ...a, [m.i]: e.target.checked }))} /></td>
                    <td style={cell}>{m.line.partNo ? <b>{m.line.partNo} </b> : null}{m.line.name}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{m.line.qty} {m.line.uom}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{money(m.line.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {same.length > 0 && <div style={{ fontSize: 11, color: '#1e7a34', marginBottom: 10 }}>✓ {same.length} line{same.length === 1 ? '' : 's'} already on the quote at the same price</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--text-light)' }}>Prices also went to the Catalog — any Catalog price changes show in the banner on Materials.</span>
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
          <button onClick={apply} disabled={saving}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
            {saving ? 'Saving…' : toAdd.length || toUpdate.length ? `Apply — add ${toAdd.length}, update ${toUpdate.length}` : 'Done — mark checked'}
          </button>
        </div>
      </div>
    </div>
  )
}
