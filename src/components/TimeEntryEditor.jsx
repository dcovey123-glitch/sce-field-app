import React, { useState } from 'react'
import { TIME_BUCKETS } from './TimeReview.jsx'

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }

// Edit a confirmed time entry: date, hours, workers, where it's charged, and
// what was done. "What was done" stays required, same as when confirming.
export default function TimeEntryEditor({ entry, jobs, customers, workers, onSave, onCancel, onDelete }) {
  const initialTarget = entry.kind === 'job' ? `job:${entry.jobId}` : `bucket:${entry.bucket}`
  const [date, setDate] = useState(entry.date || '')
  const [hours, setHours] = useState(String(entry.hoursEach ?? ''))
  const [target, setTarget] = useState(initialTarget)
  const [chosen, setChosen] = useState(entry.workers?.length ? entry.workers : [workers[0]].filter(Boolean))
  const [note, setNote] = useState(entry.note || '')

  const allWorkers = [...new Set([...workers, ...chosen])]
  const valid = date && Number(hours) > 0 && target && chosen.length > 0 && note.trim().length > 0
  const total = (Number(hours) || 0) * chosen.length

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 520, boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Edit time entry</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-mid)' }}>Date<br />
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-mid)' }}>Hours each<br />
            <input type="number" step="0.25" min="0" value={hours} onChange={e => setHours(e.target.value)} style={{ ...inputStyle, width: 90 }} />
          </label>
        </div>

        <label style={{ fontSize: 12, color: 'var(--text-mid)' }}>Charged to<br />
          <select value={target} onChange={e => setTarget(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
            <optgroup label="Non-job time">
              {Object.entries(TIME_BUCKETS).map(([id, label]) => <option key={id} value={`bucket:${id}`}>{label}</option>)}
            </optgroup>
            {customers.map(c => {
              const list = jobs.filter(j => j.customerId === c.id)
              if (!list.length) return null
              return (
                <optgroup key={c.id} label={c.name}>
                  {list.map(j => <option key={j.id} value={`job:${j.id}`}>{j.name || 'Untitled'}</option>)}
                </optgroup>
              )
            })}
          </select>
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '10px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Workers:</span>
          {allWorkers.map(n => (
            <button key={n} onClick={() => setChosen(c => c.includes(n) ? c.filter(x => x !== n) : [...c, n])} style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: '1px solid ' + (chosen.includes(n) ? 'var(--navy)' : 'var(--border)'),
              background: chosen.includes(n) ? 'var(--navy)' : '#fff', color: chosen.includes(n) ? '#fff' : 'var(--text)',
            }}>{n}</button>
          ))}
        </div>

        {entry.segments?.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 8 }}>
            From the crew clock: {entry.segments.map(s => `${new Date(s.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${new Date(s.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`).join(', ')}
          </div>
        )}

        <label style={{ fontSize: 12, color: 'var(--text-mid)' }}>What was done <span style={{ color: '#c0392b' }}>(required)</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginTop: 2, borderColor: note.trim() ? 'var(--border)' : '#e0a716' }} />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          {onDelete && (
            <button onClick={onDelete} style={{ padding: '7px 12px', border: '1px solid #e0a0a0', borderRadius: 6, background: '#fff', color: '#c0392b', cursor: 'pointer', fontSize: 13 }}>Delete</button>
          )}
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-mid)' }}>{chosen.length} × {Number(hours) || 0} h = <b>{total.toFixed(2)} h</b> total</div>
          <button onClick={onCancel} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            disabled={!valid}
            onClick={() => onSave({ date, hoursEach: Number(hours), workers: chosen, target, note: note.trim() })}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: valid ? 'pointer' : 'default', background: 'var(--accent)', color: 'var(--navy)', opacity: valid ? 1 : 0.5 }}
          >Save</button>
        </div>
      </div>
    </div>
  )
}
