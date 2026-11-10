import React, { useState } from 'react'
import WholesalerExportBar from './WholesalerExportBar.jsx'
import { catalogRequestItems } from '../api/catalogPricing.js'
import { money } from '../api/format.js'
import { todayLocal } from '../api/albertaTime.js'

// Catalog → "💲 Get pricing": tick the items you want priced (the ones with no
// part # or price are listed first), send them to Nedco or Gescan as a Request
// for Quote at qty 1 each. When their quote comes back it's matched to this
// request and their part #, description and price go onto these items.
const missing = c => !String(c.partNo || '').trim() || !(Number(c.refCost) > 0)

export default function CatalogPricingRequest({ catalog, onClose }) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const list = (catalog || []).filter(c => all || missing(c))
    .filter(c => !q || `${c.name} ${c.nickname} ${c.partNo}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.nickname || a.name || '').localeCompare(String(b.nickname || b.name || '')))
  const chosen = (catalog || []).filter(c => sel.has(c.id))
  const toggle = id => setSel(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x })
  const allShownOn = list.length > 0 && list.every(c => sel.has(c.id))

  return (
    <div style={{ margin: '10px 16px', padding: 12, border: '1px solid #9fb8d6', borderRadius: 8, background: '#f6f9fd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13.5, flex: 1 }}>💲 Get pricing from a wholesaler</b>
        <span style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Sent at qty 1 each, for pricing only. When their quote comes back it fills in the part #, description and price on these items.</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ flex: 1, minWidth: 180, fontSize: 12.5, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
        <label style={{ fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show every item (not just ones missing a part # or price)</label>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 6 }}>
        <label style={{ display: 'flex', gap: 8, padding: '5px 8px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-mid)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={allShownOn} onChange={e => setSel(s => { const x = new Set(s); list.forEach(c => e.target.checked ? x.add(c.id) : x.delete(c.id)); return x })} />
          {list.length} item{list.length === 1 ? '' : 's'}{all ? '' : ' missing a part # or price'} — tick all
        </label>
        {list.map(c => (
          <label key={c.id} style={{ display: 'flex', gap: 8, padding: '4px 8px', fontSize: 12.5, borderBottom: '1px solid #f0f2f5', cursor: 'pointer', background: sel.has(c.id) ? '#eef5fc' : undefined }}>
            <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
            <span style={{ flex: 1, minWidth: 0 }}>{c.nickname ? <b>{c.nickname} </b> : null}{c.name}{c.uom ? <span style={{ color: 'var(--text-light)' }}> · {c.uom}</span> : null}</span>
            <span style={{ fontSize: 11.5, color: c.partNo ? 'var(--text-mid)' : '#b45309', whiteSpace: 'nowrap' }}>{c.partNo || 'no part #'}</span>
            <span style={{ fontSize: 11.5, width: 70, textAlign: 'right', color: Number(c.refCost) > 0 ? 'var(--text-mid)' : '#b45309' }}>{Number(c.refCost) > 0 ? money(c.refCost) : 'no price'}</span>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-mid)', marginBottom: 6 }}>{chosen.length} ticked</div>
        <WholesalerExportBar
          items={catalogRequestItems(chosen)} date={todayLocal()}
          subjectPrefix="Request for Quote — Catalog pricing"
          saveFolder="Materials/Catalog Pricing Requests"
          catalogPricing
          emailNote="Quantities are 1 each — this is for pricing only. Please include your part # and description for each item."
          emptyMessage="Tick at least one item first."
        />
      </div>
    </div>
  )
}
