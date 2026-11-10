import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { closeoutChecks, closeoutHealthLines } from '../api/jobClose.js'
import { jobDeficiencies } from '../api/jobHealth.js'
import { unpostedCount } from './PostTimeToLabor.jsx'
import { todayLocal } from '../api/albertaTime.js'

// Shown when a job is moved to Complete (Unbilled / Billed): everything that
// should be filled in first. Simple fields can be fixed right here; the rest
// say where to go. "Complete anyway" is there for the odd job that really
// doesn't have something.
const arr = v => Array.isArray(v) ? v : []
const TYPE_NAMES = { quoted: 'Quoted', tm: 'T&M', warranty: 'Warranty' }

export function useCloseoutChecks(project, value) {
  const [orders] = useLocalStore('material_orders', [])
  const [requests] = useLocalStore('material_requests', [])
  const [orderSheet] = useLocalStore('materials_order_list', [])
  const [stock] = useLocalStore('material_stock', [])
  const [usedPending] = useLocalStore('materials_used_pending', [])
  const health = jobDeficiencies(project, {
    orders: arr(orders), requests: arr(requests), orderSheet: arr(orderSheet), stock: arr(stock), usedPending: arr(usedPending),
    status: 'onGoing', unposted: unpostedCount(project),
  })
  return closeoutChecks(project, value, { more: closeoutHealthLines(health) })
}

const inp = { fontSize: 12, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, width: 130 }
const small = (primary) => ({ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--navy)' : '#fff', color: primary ? '#fff' : 'var(--text)' })

function Fix({ item, project, onUpdate }) {
  const [draft, setDraft] = useState('')
  const firstLabor = (project.laborEntries || []).map(e => e.date).filter(Boolean).sort()[0]
  const save = patch => { onUpdate(patch); setDraft('') }
  switch (item.fix) {
    case 'co':
      return <span style={{ display: 'flex', gap: 4 }}><input style={inp} placeholder="CO / PO #" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) save({ co: draft.trim() }) }} /><button style={small(true)} disabled={!draft.trim()} onClick={() => save({ co: draft.trim() })}>Save</button></span>
    case 'dateStart':
      return <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="date" style={inp} onChange={e => e.target.value && save({ dateStart: e.target.value })} />{firstLabor && <button style={small(false)} onClick={() => save({ dateStart: firstLabor })} title="The first day labor was entered">First labor day</button>}</span>
    case 'dateApproved':
      return <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="date" style={inp} onChange={e => e.target.value && save({ dateApproved: e.target.value })} />{project.dateStart && <button style={small(false)} onClick={() => save({ dateApproved: project.dateStart })}>Same as start</button>}</span>
    case 'type':
      return <span style={{ display: 'flex', gap: 4 }}>{Object.entries(TYPE_NAMES).map(([k, l]) => <button key={k} style={small(false)} onClick={() => save({ type: k })}>{l}</button>)}</span>
    case 'quote':
      return <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" onChange={e => e.target.checked && save({ noQuoteNeeded: true })} /> No quote for this job</label>
    case 'coValue':
    case 'coAttach':
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {item.fix === 'coValue' && <><input type="number" inputMode="decimal" style={{ ...inp, width: 90 }} placeholder="$" value={draft} onChange={e => setDraft(e.target.value)} /><button style={small(true)} disabled={!(Number(draft) > 0)} onClick={() => save({ coValue: Number(draft) })}>Save</button></>}
          <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}><input type="checkbox" onChange={e => e.target.checked && save({ noCoNeeded: true })} /> No CO needed</label>
        </span>
      )
    case 'jobValue':
      return <span style={{ display: 'flex', gap: 4 }}><input type="number" inputMode="decimal" style={{ ...inp, width: 100 }} placeholder="$" value={draft} onChange={e => setDraft(e.target.value)} /><button style={small(true)} disabled={!(Number(draft) > 0)} onClick={() => save({ jobValue: Number(draft) })}>Save</button></span>
    case 'progress':
      return <button style={small(false)} onClick={() => save({ progress: 100 })}>Set to 100%</button>
    default:
      return null
  }
}

export default function CloseoutChecklist({ project, value, onUpdate, onDone, onCancel, doneLabel = 'Mark Complete', blocked = false }) {
  const items = useCloseoutChecks(project, value)
  const [anyway, setAnyway] = useState(false)
  const label = value === 'billed' ? 'Complete (Billed)' : 'Complete (Unbilled)'
  const ok = items.length === 0
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: ok ? '#eef8f1' : '#fff8e6', border: `1px solid ${ok ? '#9fd3ae' : 'var(--accent)'}`, borderRadius: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: ok ? '#1e7a34' : '#9a6610', marginBottom: ok ? 8 : 6 }}>
        {ok ? `✓ Everything's filled in — ready for ${label}` : `Before ${label}: ${items.length} thing${items.length === 1 ? '' : 's'} to fill in or check`}
      </div>
      {items.map(it => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid #f0e2b8', fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 180, color: 'var(--text)' }}>☐ {it.text}</span>
          <Fix item={it} project={project} onUpdate={onUpdate} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        {onCancel && <button style={small(false)} onClick={onCancel}>Cancel</button>}
        {!ok && (
          <label style={{ fontSize: 11.5, color: 'var(--text-mid)', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={anyway} onChange={e => setAnyway(e.target.checked)} /> Complete it anyway
          </label>
        )}
        <span style={{ flex: 1 }} />
        {onDone && <button style={{ ...small(true), padding: '5px 14px', opacity: (ok || anyway) && !blocked ? 1 : 0.45 }} disabled={blocked || (!ok && !anyway)} onClick={() => onDone({ skipped: ok ? [] : items.map(i => i.text), at: todayLocal() })}>{doneLabel}</button>}
      </div>
    </div>
  )
}
