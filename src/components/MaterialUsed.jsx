import React, { useState } from 'react'
import { drawFromStock, stockLinePrice } from '../api/stockDraw.js'
import { partNosOf, hasPartNo } from '../api/partAliases.js'
import { money } from '../api/format.js'

// Materials → "Material Used": search an item, enter the qty, pick the job.
// Each one waits here (from the desktop or the phone) until you approve it;
// approving puts it on the job's Materials (taking it out of Stock if it was a
// stock item). The same search row also feeds the Material Order list.

function uid() { return Math.random().toString(36).slice(2, 10) }
const lc = s => String(s || '').toLowerCase()
export const STOCK_TARGET = { id: '__stock__', name: 'Stock (shop / truck)', customerName: '' }

// Catalog + Stock as one searchable list (stock version wins when both exist)
export function partsList(catalog, stock) {
  const out = []
  const usedStock = new Set()
  ;(catalog || []).forEach(c => {
    // a part can have several stock lots (Box 1, Box 2…): draw from the open one first
    const lots = (stock || []).filter(x => !usedStock.has(x.id) && (x.catalogId === c.id || (!x.catalogId && x.partNo && hasPartNo(c, x.partNo))))
    lots.forEach(x => usedStock.add(x.id))
    const withQty = lots.filter(l => (Number(l.qty) || 0) > 0).sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0))
    const s = withQty[0] || lots[0] || null
    out.push({ key: 'c:' + c.id, catalogId: c.id, stockId: s ? s.id : null, name: c.name || '', nickname: c.nickname || '', partNo: c.partNo || '', alts: partNosOf(c).filter(x => x !== c.partNo).join(' '), uom: (s && s.uom) || c.uom || '',
      price: s && Number(s.cost) ? Number(s.cost) : Number(c.refCost) || 0, onHand: lots.reduce((a, l) => a + (Number(l.qty) || 0), 0), category: c.category || (s && s.category) || '' })
  })
  ;(stock || []).filter(s => !usedStock.has(s.id)).forEach(s => out.push({ key: 's:' + s.id, catalogId: null, stockId: s.id, name: s.name || '', nickname: s.nickname || '', partNo: s.partNo || '', uom: s.uom || '', price: Number(s.cost) || 0, onHand: Number(s.qty) || 0, category: s.category || '' }))
  return out
}
export function searchParts(list, q, limit = 8) {
  const t = lc(q).trim()
  if (!t) return []
  const words = t.split(/\s+/)
  return list.filter(p => { const hay = lc(`${p.nickname} ${p.name} ${p.partNo} ${p.alts || ''}`); return words.every(w => hay.includes(w)) })
    .sort((a, b) => (b.onHand > 0) - (a.onHand > 0)).slice(0, limit)
}

const box = { fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontFamily: 'var(--font)', boxSizing: 'border-box', background: '#fff' }
const dropdown = { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, zIndex: 40, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,.12)' }
const opt = { padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }

export function ItemSearch({ parts, value, onPick, placeholder = 'Search Catalog & Stock…' }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = searchParts(parts, q)
  const pick = p => { onPick(p); setQ(''); setOpen(false) }
  if (value) {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value.nickname ? <b>{value.nickname} </b> : null}{value.name}{value.partNo ? <span style={{ color: 'var(--text-light)' }}> · {value.partNo}</span> : null}
        </span>
        {value.onHand > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '1px 7px' }}>{value.onHand} in stock</span>}
        <button onClick={() => onPick(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 14 }} aria-label="Clear">×</button>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} style={{ ...box, width: '100%' }}
        onKeyDown={e => { if (e.key === 'Enter' && matches[0]) pick(matches[0]) }} />
      {open && q.trim() && (
        <div style={dropdown}>
          {matches.map(p => (
            <div key={p.key} onMouseDown={() => pick(p)} style={opt}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.nickname ? <b>{p.nickname} </b> : null}{p.name}{p.partNo ? <span style={{ color: 'var(--text-light)' }}> · {p.partNo}</span> : null}</span>
              <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{money(p.price)}/{p.uom || 'ea'}</span>
              {p.onHand > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '1px 7px' }}>{p.onHand}</span>}
            </div>
          ))}
          <div onMouseDown={() => pick({ key: 'new:' + q, name: q.trim(), nickname: '', partNo: '', uom: '', price: 0, onHand: 0, isNew: true })} style={{ ...opt, color: 'var(--accent-dim)', fontWeight: 700 }}>
            + Use “{q.trim()}” (not in Catalog)
          </div>
        </div>
      )}
    </div>
  )
}

export function JobPicker({ jobs, value, onChange, allowStock, placeholder = 'Search jobs…' }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const list = [...(allowStock ? [STOCK_TARGET] : []), ...jobs]
  const t = lc(q).trim()
  const matches = (t ? list.filter(j => lc(`${j.customerName} ${j.name}`).includes(t)) : list).slice(0, 10)
  if (value) {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, color: value.id === STOCK_TARGET.id ? '#1e7a34' : 'var(--text)' }}>
          {value.customerName ? <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>{value.customerName} — </span> : null}{value.name}
        </span>
        <button onClick={() => onChange(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 14 }} aria-label="Clear">×</button>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} style={{ ...box, width: '100%' }}
        onKeyDown={e => { if (e.key === 'Enter' && matches[0]) { onChange(matches[0]); setQ(''); setOpen(false) } }} />
      {open && (
        <div style={dropdown}>
          {matches.length === 0 && <div style={{ ...opt, color: 'var(--text-light)' }}>No matching job</div>}
          {matches.map(j => (
            <div key={j.id} onMouseDown={() => { onChange(j); setQ(''); setOpen(false) }} style={opt}>
              {j.customerName ? <span style={{ color: 'var(--text-light)' }}>{j.customerName} — </span> : null}<b style={{ color: j.id === STOCK_TARGET.id ? '#1e7a34' : undefined }}>{j.name}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The search · qty · job row used by Material Used and Material Order
export function QuickAddRow({ parts, jobs, allowStock, buttonLabel, onAdd, requireJob }) {
  const [item, setItem] = useState(null)
  const [qty, setQty] = useState('')
  const [job, setJob] = useState(null)
  const ok = item && Number(qty) > 0 && (!requireJob || job)
  function add() {
    if (!ok) return
    onAdd({ part: item, qty: Number(qty), job })
    setItem(null); setQty('') // keep the job picked — usually several items for one job
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 90px minmax(0,1.4fr) auto', gap: 8, padding: '10px 16px', alignItems: 'center', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      <ItemSearch parts={parts} value={item} onPick={setItem} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} placeholder="Qty" onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ ...box, width: '100%', textAlign: 'right' }} />
        <span style={{ fontSize: 11, color: 'var(--text-light)', minWidth: 18 }}>{item?.uom || ''}</span>
      </div>
      <JobPicker jobs={jobs} value={job} onChange={setJob} allowStock={allowStock} placeholder={allowStock ? 'Job or Stock…' : 'Which job?'} />
      <button onClick={add} disabled={!ok}
        style={{ padding: '8px 14px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12.5, cursor: ok ? 'pointer' : 'default', background: ok ? 'var(--accent)' : 'var(--gray-light, #e5e7eb)', color: ok ? 'var(--navy)' : 'var(--text-light)', whiteSpace: 'nowrap' }}>
        {buttonLabel}
      </button>
    </div>
  )
}

export function pendingFromPart({ part, qty, job }, source = 'desktop') {
  return {
    id: uid(), at: new Date().toISOString(), source,
    catalogId: part.catalogId || null, stockId: part.stockId || null,
    item: part.nickname || part.name, name: part.name, partNo: part.partNo || '', uom: part.uom || '', qty, price: Number(part.price) || 0,
    jobId: job ? job.id : '', jobName: job ? job.name : '', customerName: job ? job.customerName || '' : '',
  }
}

export default function MaterialUsedTab({ parts, jobs, pending, setPending, stock, setStock, jobsStore }) {
  const [msg, setMsg] = useState('')
  const jobOf = id => jobs.find(j => j.id === id)
  const update = (id, patch) => setPending(list => list.map(x => x.id === id ? { ...x, ...patch } : x))

  function approve(ids) {
    let stockList = stock
    const byJob = new Map()
    const done = []
    pending.filter(x => ids.includes(x.id)).forEach(x => {
      if (!x.jobId || !jobsStore.records.some(j => j.id === x.jobId) || !(Number(x.qty) > 0)) return
      let entry = { id: uid(), kind: x.stockId ? 'stock' : 'custom', item: x.item || x.name, partNo: x.partNo || '', uom: x.uom || '', qty: Number(x.qty), price: Number(x.price) || 0, source: x.source === 'phone' ? 'Logged on phone' : 'Material Used' }
      if (x.stockId) {
        const res = drawFromStock(stockList, x.stockId, Number(x.qty))
        if (res.fields) {
          stockList = res.list
          const unit = Number(x.price) || res.fields.stockUnit
          entry = { ...entry, ...res.fields, stockUnit: unit, price: stockLinePrice(jobsStore.records.find(j => j.id === x.jobId), Number(x.qty), res.fields.stockFree, unit) }
        }
      }
      if (!byJob.has(x.jobId)) byJob.set(x.jobId, [])
      byJob.get(x.jobId).push(entry)
      done.push(x.id)
    })
    if (stockList !== stock) setStock(stockList)
    byJob.forEach((add, jobId) => jobsStore.updateRecord(jobId, cur => {
      const next = [...(cur.materialEntries || []), ...add]
      return { materialEntries: next, actualMaterials: Math.round(next.reduce((a, e) => a + (Number(e.qty) || 0) * (Number(e.price) || 0), 0) * 100) / 100 }
    }))
    setPending(list => list.filter(x => !done.includes(x.id)))
    const skipped = ids.length - done.length
    setMsg(`${done.length} item${done.length === 1 ? '' : 's'} added to ${byJob.size} job${byJob.size === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (pick a job and qty first)` : ''}.`)
    setTimeout(() => setMsg(''), 5000)
  }

  const ready = pending.filter(x => x.jobId && Number(x.qty) > 0)
  const cell = { padding: '6px 8px', borderTop: '1px solid var(--border)', fontSize: 12.5, verticalAlign: 'middle' }
  return (
    <div>
      <div style={{ padding: '10px 16px 0', fontSize: 11.5, color: 'var(--text-light)' }}>
        Log material used on a job. Items from here and from your phone wait below until you approve them; approving puts them on the job's Materials (and takes stock items off the shelf).
      </div>
      <QuickAddRow parts={parts} jobs={jobs} buttonLabel="+ Add" requireJob onAdd={d => setPending(list => [...list, pendingFromPart(d, 'desktop')])} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 4px' }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 800, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Waiting for approval ({pending.length})</span>
        {msg && <span style={{ fontSize: 12, color: '#1e7a34', fontWeight: 700 }}>✓ {msg}</span>}
        {ready.length > 0 && <button onClick={() => approve(ready.map(x => x.id))} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>✓ Approve all ({ready.length})</button>}
      </div>
      {pending.length === 0 ? (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Nothing waiting. Add material above or log it from your phone.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {pending.slice().sort((a, b) => (a.at || '').localeCompare(b.at || '')).map(x => (
              <tr key={x.id}>
                <td style={{ ...cell, width: 26 }} title={x.source === 'phone' ? 'From your phone' : 'Added here'}>{x.source === 'phone' ? '📱' : '🖥'}</td>
                <td style={cell}>{x.partNo ? <b>{x.partNo} </b> : null}{x.item || x.name}{x.stockId ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1e7a34', marginLeft: 6 }}>STOCK</span> : null}
                  <div style={{ fontSize: 10.5, color: 'var(--text-light)' }}>{x.at ? new Date(x.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}{x.note ? ` · ${x.note}` : ''}</div></td>
                <td style={{ ...cell, width: 120 }}>
                  <input type="number" step="any" value={x.qty} onChange={e => update(x.id, { qty: e.target.value })} style={{ width: 64, fontSize: 12.5, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px' }} /> {x.uom}
                </td>
                <td style={{ ...cell, width: 90, textAlign: 'right' }}>{money((Number(x.qty) || 0) * (Number(x.price) || 0))}</td>
                <td style={{ ...cell, width: 260 }}>
                  <JobPicker jobs={jobs} value={x.jobId ? (jobOf(x.jobId) || { id: x.jobId, name: x.jobName || 'Job', customerName: x.customerName || '' }) : null}
                    onChange={j => update(x.id, { jobId: j ? j.id : '', jobName: j ? j.name : '', customerName: j ? j.customerName : '' })} />
                </td>
                <td style={{ ...cell, width: 150, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button disabled={!x.jobId || !(Number(x.qty) > 0)} onClick={() => approve([x.id])}
                    style={{ padding: '4px 10px', borderRadius: 999, border: 'none', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', background: x.jobId ? '#1e7a34' : 'var(--gray-light, #e5e7eb)', color: x.jobId ? '#fff' : 'var(--text-light)' }}>✓ Approve</button>
                  <button onClick={() => setPending(list => list.filter(y => y.id !== x.id))} title="Remove"
                    style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
