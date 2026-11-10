import React, { useState } from 'react'
import { money } from '../api/format.js'
import { pairToCatalog } from '../api/catalogPricing.js'

// A wholesaler's pricing quote → the Catalog. Each of their lines is paired
// with the Catalog item it's for (their part #, the description, or the same
// line on the request you sent); you check it, change any that are wrong, and
// Apply puts their part #, description and price on those items.
const cell = { padding: '5px 6px', borderTop: '1px solid var(--border)', fontSize: 12, verticalAlign: 'top' }
const WHY = { 'part #': 'same part #', description: 'same description', 'line order': 'same line on your request' }

export default function CatalogCompare({ lines, catalog, request = null, sourceLabel = '', onApply, onClose }) {
  const pairs = pairToCatalog(lines, catalog, request)
  const askedIds = ((request && request.items) || []).map(x => x.catalogId).filter(Boolean)
  const asked = askedIds.map(id => catalog.find(c => c.id === id)).filter(Boolean)
  const others = [...catalog].filter(c => !askedIds.includes(c.id)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  const [pick, setPick] = useState(() => Object.fromEntries(pairs.map(p => [p.i, p.catalogId || 'add'])))
  const [theirs, setTheirs] = useState(() => Object.fromEntries(pairs.map(p => {
    const c = p.catalogId && catalog.find(x => x.id === p.catalogId)
    return [p.i, !!c && !String(c.partNo || '').trim()] // our own wording on an item with no part # yet → take theirs
  })))
  const [saving, setSaving] = useState(false)
  const chosen = Object.values(pick)
  const nUpd = chosen.filter(v => v !== 'add' && v !== 'skip').length
  const nAdd = chosen.filter(v => v === 'add').length
  const label = c => `${c.nickname ? c.nickname + ' — ' : ''}${c.name || c.partNo || 'Item'}${c.partNo ? ' · ' + c.partNo : ''}`
  const unanswered = asked.filter(c => !chosen.includes(c.id))

  async function apply() {
    setSaving(true)
    try { await onApply(pairs.map(p => ({ line: p.line, catalogId: pick[p.i], useTheirs: !!theirs[p.i] }))) } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 980, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>📒 Pricing into the Catalog</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '2px 0 12px' }}>
          {sourceLabel}{sourceLabel ? ' · ' : ''}{lines.length} line{lines.length === 1 ? '' : 's'}{request ? ` · answering your request of ${String(request.sentAt || '').slice(0, 10)} (${askedIds.length} item${askedIds.length === 1 ? '' : 's'})` : ''}.
          {' '}Check each line is the right Catalog item — their part # and price go on it.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ fontSize: 11, color: 'var(--text-light)', textAlign: 'left' }}>
            <th style={{ padding: '0 6px' }}>Their line</th><th style={{ padding: '0 6px', textAlign: 'right' }}>Price</th><th style={{ padding: '0 6px' }}>Goes on</th>
          </tr></thead>
          <tbody>
            {pairs.map(p => {
              const v = pick[p.i]
              const c = v !== 'add' && v !== 'skip' ? catalog.find(x => x.id === v) : null
              return (
                <tr key={p.i} style={{ background: v === 'skip' ? '#f7f7f7' : c ? '#f6fbf7' : undefined }}>
                  <td style={cell}>{p.line.partNo ? <b>{p.line.partNo} </b> : null}{p.line.name}<div style={{ fontSize: 11, color: 'var(--text-light)' }}>{p.line.qty} {p.line.uom}</div></td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(p.line.cost)}{c && Number(c.refCost) > 0 && Math.abs(Number(c.refCost) - Number(p.line.cost)) > 0.005 ? <div style={{ fontSize: 11, color: Number(p.line.cost) > Number(c.refCost) ? '#c0392b' : '#1e7a34' }}>was {money(c.refCost)}</div> : null}</td>
                  <td style={{ ...cell, width: 430 }}>
                    <select value={v} onChange={e => { const nv = e.target.value; setPick(x => ({ ...x, [p.i]: nv })); const nc = catalog.find(x => x.id === nv); setTheirs(x => ({ ...x, [p.i]: !!nc && !String(nc.partNo || '').trim() })) }}
                      style={{ fontSize: 11.5, padding: '3px 4px', width: '100%', border: `1px solid ${c ? '#1e7a34' : 'var(--border)'}`, borderRadius: 5 }}>
                      <option value="add">➕ Add as a new Catalog item</option>
                      <option value="skip">— Skip it</option>
                      {asked.length > 0 && <optgroup label="On your request">{asked.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}</optgroup>}
                      <optgroup label="Rest of the Catalog">{others.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}</optgroup>
                    </select>
                    {c && (
                      <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {p.why && p.catalogId === v && <span style={{ color: '#1e7a34' }}>✓ {WHY[p.why]}</span>}
                        {p.line.partNo && !String(c.partNo || '').trim() && <span>part # → <b>{p.line.partNo}</b></span>}
                        {p.line.name && p.line.name !== c.name && (
                          <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!theirs[p.i]} onChange={e => setTheirs(x => ({ ...x, [p.i]: e.target.checked }))} /> use their description{!c.nickname && c.name ? ` (yours stays as the nickname)` : ''}</label>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {unanswered.length > 0 && <div style={{ fontSize: 11.5, color: '#9a6610', marginTop: 8 }}>Not on their quote: {unanswered.map(c => c.nickname || c.name).join(', ')}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
          <button onClick={apply} disabled={saving || (!nUpd && !nAdd)}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
            {saving ? 'Saving…' : `Apply — update ${nUpd}, add ${nAdd}`}
          </button>
        </div>
      </div>
    </div>
  )
}
