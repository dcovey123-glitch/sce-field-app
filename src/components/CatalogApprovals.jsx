import React, { useState } from 'react'
import { todayLocal } from '../api/albertaTime.js'

// Catalog changes sent from the phone (Materials → Catalog): a new count of
// something on the shelf, or an item that isn't in the Catalog yet. They're
// tentative until approved here. A new item needs a part # before it can go
// into the Catalog.
//
// pending item: { id, kind: 'count'|'newpart', catalogId, stockId, item, name,
//   partNo, uom, qty, prevQty, note, by, at }

export const CATALOG_PENDING_KEY = 'materials_catalog_pending'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const when = iso => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const inp = { fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', fontFamily: 'var(--font)' }
const btn = primary => ({ fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 6, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--accent)' : 'var(--surface)', color: primary ? 'var(--navy)' : 'var(--text-mid)' })

function CountRow({ it, row, onApprove, onDecline }) {
  const [qty, setQty] = useState(String(it.qty ?? ''))
  const now = row ? row.onHand : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid #f0e2b8', flexWrap: 'wrap', fontSize: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#9a6610', background: '#fff3d6', borderRadius: 20, padding: '2px 8px' }}>⏳ COUNT</span>
      <span style={{ flex: 1, minWidth: 200 }}>
        <b>{it.item || it.name}</b>{it.partNo ? <span style={{ color: 'var(--text-light)' }}> · {it.partNo}</span> : null}
        <span style={{ color: 'var(--text-mid)' }}> — on hand {now} {it.uom || ''} → counted</span>
        {!row && <span style={{ color: '#a12a1e' }}> (not in the Catalog any more)</span>}
        <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{[it.by, when(it.at), it.note].filter(Boolean).join(' · ')}</div>
      </span>
      <input type="number" value={qty} onChange={e => setQty(e.target.value)} style={{ ...inp, width: 70, textAlign: 'right' }} /> <span>{it.uom || ''}</span>
      <button style={btn(true)} disabled={!row} onClick={() => onApprove({ ...it, qty: Number(qty) || 0 })}>Approve</button>
      <button style={btn(false)} onClick={onDecline}>Decline</button>
    </div>
  )
}

function NewPartRow({ it, onApprove, onDecline }) {
  const [f, setF] = useState({ partNo: it.partNo || '', nickname: '', name: it.name || it.item || '', uom: it.uom || 'EA', refCost: '', qty: String(it.qty || 0), toStock: Number(it.qty) > 0 })
  const set = patch => setF(x => ({ ...x, ...patch }))
  const ok = f.partNo.trim() && f.name.trim()
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid #f0e2b8', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#9a6610', background: '#fff3d6', borderRadius: 20, padding: '2px 8px' }}>⏳ NEW ITEM</span>
        <b>{it.name || it.item}</b>
        <span style={{ color: 'var(--text-light)' }}>{[it.qty ? `${it.qty} ${it.uom || ''}` : '', it.by, when(it.at), it.note].filter(Boolean).join(' · ')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
        <input value={f.partNo} onChange={e => set({ partNo: e.target.value })} placeholder="Part # (needed)" style={{ ...inp, width: 120, borderColor: f.partNo.trim() ? 'var(--border)' : '#e0a716' }} />
        <input value={f.nickname} onChange={e => set({ nickname: e.target.value })} placeholder="Nickname" style={{ ...inp, width: 110 }} />
        <input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Description" style={{ ...inp, flex: 1, minWidth: 160 }} />
        <input value={f.uom} onChange={e => set({ uom: e.target.value.toUpperCase() })} placeholder="UOM" style={{ ...inp, width: 50 }} />
        <span>$</span><input type="number" step="0.01" value={f.refCost} onChange={e => set({ refCost: e.target.value })} placeholder="price" style={{ ...inp, width: 70 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.toStock} onChange={e => set({ toStock: e.target.checked })} /> put
          <input type="number" value={f.qty} onChange={e => set({ qty: e.target.value })} style={{ ...inp, width: 55 }} /> in Stock
        </label>
        <button style={{ ...btn(true), opacity: ok ? 1 : 0.5 }} disabled={!ok} title={ok ? '' : 'Add the part # first'} onClick={() => onApprove(f)}>Add to Catalog</button>
        <button style={btn(false)} onClick={onDecline}>Decline</button>
      </div>
    </div>
  )
}

// rows: the Catalog & Stock rows ({ cat, stk, lots, onHand, refCost, … })
export default function CatalogApprovals({ pending, setPending, rows, setCatalog, setStock }) {
  if (!pending || !pending.length) return null
  const rowFor = it => rows.find(r => (it.catalogId && r.cat && r.cat.id === it.catalogId) || (it.stockId && (r.lots || []).some(l => l.id === it.stockId)))
  const drop = id => setPending(list => list.filter(x => x.id !== id))

  function approveCount(it) {
    const row = rowFor(it)
    if (!row) return
    const diff = (Number(it.qty) || 0) - (row.onHand || 0)
    const lot = row.stk
    if (lot) {
      // the counted total: the difference goes on the lot that's drawn from first
      setStock(list => list.map(s => s.id !== lot.id ? s : {
        ...s, qty: Math.max(0, (Number(s.qty) || 0) + diff),
        paidForQty: diff > 0 ? (Number(s.paidForQty) || 0) + diff : Math.min(Number(s.paidForQty) || 0, Math.max(0, (Number(s.qty) || 0) + diff)),
        countLog: [...(s.countLog || []), { at: new Date().toISOString(), from: row.onHand, to: Number(it.qty) || 0, by: it.by || 'phone', note: it.note || '' }],
      }))
    } else if (Number(it.qty) > 0 && row.cat) {
      const c = row.cat
      setStock(list => [...list, { id: uid(), catalogId: c.id, name: c.name, partNo: c.partNo || '', nickname: c.nickname || '', uom: c.uom || '', category: c.category || '', qty: Number(it.qty), cost: Number(c.refCost) || 0, paidForQty: Number(it.qty), countLog: [{ at: new Date().toISOString(), from: 0, to: Number(it.qty), by: it.by || 'phone', note: it.note || '' }] }])
    }
    drop(it.id)
  }
  function approveNew(it, f) {
    const id = uid()
    const cost = Number(f.refCost) || 0
    const item = { id, partNo: f.partNo.trim(), nickname: f.nickname.trim(), name: f.name.trim(), uom: f.uom.trim(), refCost: cost, category: '', ...(cost ? { priceHistory: [{ date: todayLocal(), cost, source: 'Added from phone' }] } : {}) }
    setCatalog(list => [...list, item])
    const q = Number(f.qty) || 0
    if (f.toStock && q > 0) setStock(list => [...list, { id: uid(), catalogId: id, name: item.name, partNo: item.partNo, nickname: item.nickname, uom: item.uom, category: '', qty: q, cost, paidForQty: q }])
    drop(it.id)
  }

  return (
    <div style={{ margin: '8px 16px 0', padding: '8px 12px', background: '#fffaf0', border: '1px solid #e0a716', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5d00', marginBottom: 2 }}>
        ⏳ {pending.length} Catalog change{pending.length === 1 ? '' : 's'} to approve (counts and new items from the phone or here) — tentative until you do
      </div>
      {pending.map(it => it.kind === 'newpart'
        ? <NewPartRow key={it.id} it={it} onApprove={f => approveNew(it, f)} onDecline={() => drop(it.id)} />
        : <CountRow key={it.id} it={it} row={rowFor(it)} onApprove={x => approveCount(x)} onDecline={() => drop(it.id)} />)}
    </div>
  )
}

// Desktop: add something that isn't in the Catalog — same as the phone's
// "+ Add", it waits for approval (and a part #) and shows as tentative.
export function NewItemForApproval({ initialName = '', onSend, onCancel }) {
  const [f, setF] = useState({ name: initialName, qty: '', uom: '', partNo: '', note: '' })
  const set = patch => setF(x => ({ ...x, ...patch }))
  const send = () => {
    if (!f.name.trim()) return
    onSend({ kind: 'newpart', item: f.name.trim(), name: f.name.trim(), nickname: '', partNo: f.partNo.trim(), uom: f.uom.trim().toUpperCase(), qty: Number(f.qty) || 0, note: f.note.trim() })
  }
  return (
    <div style={{ margin: '0 16px 8px', padding: '8px 10px', background: '#fffaf0', border: '1px dashed #e0a716', borderRadius: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
      <b style={{ color: '#8a5d00' }}>New item:</b>
      <input autoFocus value={f.name} onChange={e => set({ name: e.target.value })} placeholder="What is it?" onKeyDown={e => { if (e.key === 'Enter') send(); if (e.key === 'Escape') onCancel() }} style={{ ...inp, flex: 1, minWidth: 180 }} />
      <input type="number" value={f.qty} onChange={e => set({ qty: e.target.value })} placeholder="Qty" style={{ ...inp, width: 60 }} />
      <input value={f.uom} onChange={e => set({ uom: e.target.value })} placeholder="UOM" style={{ ...inp, width: 50 }} />
      <input value={f.partNo} onChange={e => set({ partNo: e.target.value })} placeholder="Part # (if known)" style={{ ...inp, width: 120 }} />
      <input value={f.note} onChange={e => set({ note: e.target.value })} placeholder="Note" style={{ ...inp, width: 140 }} />
      <button style={{ ...btn(true), opacity: f.name.trim() ? 1 : 0.5 }} disabled={!f.name.trim()} onClick={send}>Send for approval</button>
      <button style={btn(false)} onClick={onCancel}>Cancel</button>
    </div>
  )
}
