import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { useOrdersFeed, matchOrdersByPo, orderParts } from '../api/orders.js'
import {
  ordersForJob, slipLineKey, lineJobsOf, lineUse, lineRemaining, leftoverLinesForJob, lineWithRestInStock,
  mergeIntoStock, slipEntry, slipUnit, GENERAL_STOCK_ID,
} from '../api/slips.js'
import { money } from '../api/format.js'

// On a job's Materials: the material-order slips on this job.
//
// A line can be shared by several jobs (one order for Project A and B). The
// line is one pool: enter what this job used, and every job on the line sees
// the same "left" — use 50 ft of a 200 ft EMT line on A and B shows 150 left.
// What's left only goes to Stock once every job on the line is complete.

function uid() { return Math.random().toString(36).slice(2, 10) }
const num = v => Number(v) || 0
const r3 = v => Math.round(v * 1000) / 1000

export default function SlipLinesForJob({ project, entries, onSetEntries }) {
  const [orders, setOrders] = useLocalStore('material_orders', [])
  const [, setStock] = useLocalStore('material_stock', [])
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [open, setOpen] = useState({})
  const feed = useOrdersFeed()
  const purchase = o => {
    if (!o.poNumber) return ''
    const ms = matchOrdersByPo(feed, o.poNumber)
    const qs = [...new Set(ms.flatMap(m => orderParts(m).map(p => p.number)).filter(n => n && !/^order/i.test(n)))]
    return `📑 PO ${o.poNumber}${qs.length ? ' · Quote ' + qs.join(', ') : ''}`
  }
  const [draft, setDraft] = useState({}) // key → typed qty (while editing)
  const slips = ordersForJob(orders, project.id)
  const jobById = id => (jobsHub.records || []).find(j => j.id === id)
  const isComplete = id => { const j = id === project.id ? project : jobById(id); return !!j && (j.lifecycleStatus === 'unbilled' || j.lifecycleStatus === 'billed') }
  const complete = isComplete(project.id)
  const left = complete ? leftoverLinesForJob(orders, project, isComplete) : []
  if (!slips.length) return null

  const jobName = id => id === GENERAL_STOCK_ID ? 'Stock' : (jobById(id)?.name || 'another job')

  // Set how much of a line this job used (0 = none). Updates the line's pool
  // on the slip and this job's material entry together.
  function setUsed(o, li, idx, qty) {
    const key = slipLineKey(o.id, li, idx)
    const use = { ...lineUse(o, li) }
    const others = Object.entries(use).filter(([k]) => k !== project.id).reduce((a, [, v]) => a + num(v), 0)
    const q = r3(Math.max(0, Math.min(num(qty), num(li.qty) - others)))
    if (q > 0) use[project.id] = q; else delete use[project.id]
    const onLine = lineJobsOf(o, li).includes(project.id)
    setOrders(list => list.map(x => x.id !== o.id ? x : {
      ...x, lineItems: (x.lineItems || []).map((l2, i) => i !== idx ? l2 : {
        ...l2, usedBy: use,
        // using a line that wasn't on this job puts this job on it (shared)
        ...(onLine ? {} : { jobIds: [...new Set([...lineJobsOf(x, l2), project.id])] }),
      }),
    }))
    const rest = entries.filter(e => e.orderKey !== key)
    onSetEntries(q > 0 ? [...rest, slipEntry(o, li, idx, q, uid)] : rest)
    setDraft(d => { const n = { ...d }; delete n[key]; return n })
  }

  function moveLeftovers() {
    if (!window.confirm(`Move what's left of ${left.length} line${left.length === 1 ? '' : 's'} into General Stock? Received material goes into the Stock list now.`)) return
    const byOrder = new Map()
    left.forEach(x => { if (!byOrder.has(x.order.id)) byOrder.set(x.order.id, new Set()); byOrder.get(x.order.id).add(x.idx) })
    setOrders(list => list.map(o => byOrder.has(o.id) ? { ...o, lineItems: (o.lineItems || []).map((li, i) => byOrder.get(o.id).has(i) ? lineWithRestInStock(o, li) : li) } : o))
    left.filter(x => x.li.received).forEach(x => setStock(list => mergeIntoStock(list, x.order, [{ ...x.li, qty: x.remaining }], uid)))
  }

  const small = { fontSize: 11.5, color: 'var(--text-light)' }
  const applied = entries.filter(e => String(e.orderKey || '').startsWith('slip:')).reduce((a, e) => a + num(e.qty) * num(e.price), 0)
  const numIn = { width: 64, fontSize: 12, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', fontFamily: 'var(--font)' }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 16px 4px' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: '.04em' }}>🧾 Slips — what came in</span>
        <span style={{ flex: 1, ...small }}>Enter what was used on this job. Lines shared with other jobs show what's left for all of them.</span>
        {applied > 0 && <span style={{ fontSize: 12, fontWeight: 700 }}>{money(applied)} applied</span>}
      </div>
      {left.length > 0 && (
        <div style={{ margin: '4px 16px 8px', padding: '8px 10px', background: '#fff3d6', border: '1px solid #e0a716', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 12, color: '#8a5d00' }}>
            ⚠ This job is complete{left.some(x => lineJobsOf(x.order, x.li).length > 1) ? ' (and so are the other jobs sharing these lines)' : ''} with material left over:{' '}
            {left.slice(0, 4).map(x => `${x.remaining} ${x.li.uom || ''} ${x.li.nickname || x.li.name}`.replace(/\s+/g, ' ')).join(', ')}{left.length > 4 ? '…' : ''}
          </span>
          <button onClick={moveLeftovers} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--navy)', cursor: 'pointer' }}>Move to Stock</button>
        </div>
      )}
      {slips.map(o => {
        const lines = o.lineItems || []
        const usedHere = lines.filter(li => num(lineUse(o, li)[project.id]) > 0).length
        const isOpen = open[o.id] ?? true
        const shared = [...new Set(lines.flatMap(li => lineJobsOf(o, li)))].filter(id => id !== project.id)
        return (
          <div key={o.id} style={{ borderTop: '1px solid var(--border-light, #eef0f3)' }}>
            <div onClick={() => setOpen(s => ({ ...s, [o.id]: !isOpen }))} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', cursor: 'pointer' }}>
              <span style={small}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{o.wholesaler}{o.invoiceNumber ? ` · Inv ${o.invoiceNumber}` : ''} {o.poNumber && <span style={{ fontSize: 11.5, color: '#1a5fa0', fontWeight: 700 }}>{purchase(o)}</span>} <span style={small}>· {o.orderDate || ''} · {usedHere} of {lines.length} lines used here{shared.length ? ` · shared with ${shared.map(jobName).join(', ')}` : ''}</span></span>
            </div>
            {isOpen && lines.map((li, idx) => {
              const key = slipLineKey(o.id, li, idx)
              const use = lineUse(o, li)
              const mine = num(use[project.id])
              const remaining = lineRemaining(o, li)
              const others = Object.entries(use).filter(([k, v]) => k !== project.id && num(v) > 0)
              const onLine = lineJobsOf(o, li).includes(project.id)
              const max = r3(mine + remaining)
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 16px 3px 38px', fontSize: 12, opacity: onLine || mine ? 1 : 0.75 }}>
                  <input type="checkbox" checked={mine > 0} disabled={!mine && remaining <= 0}
                    title={mine ? 'Untick to take it off this job' : 'Tick to use everything that’s left on this job'}
                    onChange={e => setUsed(o, li, idx, e.target.checked ? max : 0)} />
                  <input type="number" step="any" min="0" value={draft[key] ?? (mine || '')} placeholder="0"
                    onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                    onBlur={e => draft[key] != null && setUsed(o, li, idx, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    title={`Used on this job (up to ${max})`} style={numIn} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--text-light)' }}>of {li.qty} {li.uom} </span>
                    {li.partNo ? <b>{li.partNo} </b> : null}{li.nickname || li.name}
                    <span style={small}>
                      {' · '}<b style={{ color: remaining > 0 ? '#1a5fa0' : '#1e7a34' }}>{remaining > 0 ? `${remaining} left` : 'all used'}</b>
                      {others.length > 0 && ` · ${others.map(([k, v]) => `${r3(num(v))} on ${jobName(k)}`).join(', ')}`}
                      {!onLine && !mine && ' · not on this job yet'}
                    </span>
                  </span>
                  <span style={{ color: mine ? 'var(--text)' : 'var(--text-light)', whiteSpace: 'nowrap' }}>{money(mine * slipUnit(li))}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
