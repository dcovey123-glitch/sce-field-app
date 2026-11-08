import React, { useState } from 'react'
import { getLaborRates } from '../pages/Jobs.jsx'
import NoteEdit from './NoteEdit.jsx'

// Posts a job's tracked (crew clock) time into its Labor Actual — the real
// job cost, and on T&M jobs the hours that bill. Two steps every time:
// pick entries + rates, then review the summary and click Confirm. Nothing
// reaches laborEntries / actualLabor before that click.
//
// Each tracked entry is split per worker into "lines". A posted labor entry
// carries fromTracked = '<trackedId>|<worker>' so we always know what's been
// posted, can undo it, and can spot an entry edited after it was posted.

function uid() { return Math.random().toString(36).slice(2, 10) }
const lower = s => (s || '').trim().toLowerCase()
const money = n => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtH = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
const costOf = (entries, rates) => entries.reduce((s, e) => s + (Number(e.hours) || 0) * (rates.find(r => r.id === e.rateId)?.rate || 0), 0)
const isOtRate = r => /\b(ot|overtime|o\/t)\b/i.test(r.label || '')

// Every tracked entry → one line per worker
export function trackedLines(project) {
  const out = []
  ;(project.trackedTime || []).forEach(e => {
    const ws = e.workers?.length ? e.workers : ['']
    ws.forEach(w => out.push({
      key: e.id + '|' + w, entryId: e.id, date: e.date, worker: w, hours: Number(e.hoursEach) || 0,
      ot: !!e.ot, note: e.note || '', category: e.category || '',
    }))
  })
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.worker.localeCompare(b.worker))
}
// 'new' = not posted, 'changed' = posted but the tracked hours were edited since, 'posted'
export function lineStatus(project, line) {
  const posted = (project.laborEntries || []).filter(l => l.fromTracked === line.key)
  if (!posted.length) return 'new'
  const h = posted.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  return Math.abs(h - line.hours) > 0.001 ? 'changed' : 'posted'
}
export function unpostedCount(project) {
  return trackedLines(project).filter(l => lineStatus(project, l) !== 'posted').length
}

export default function PostTimeToLabor({ project, onUpdate, heading }) {
  const rates = getLaborRates(project)
  const lines = trackedLines(project)
  const isTM = project.type === 'tm'
  const [picked, setPicked] = useState(null) // keys; null = default (everything waiting)
  const [rateFor, setRateFor] = useState({})
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPosted, setShowPosted] = useState(false)

  if (!lines.length) return null

  const status = Object.fromEntries(lines.map(l => [l.key, lineStatus(project, l)]))
  const waiting = lines.filter(l => status[l.key] !== 'posted')
  const posted = lines.filter(l => status[l.key] === 'posted')
  const sel = (picked || waiting.map(l => l.key)).filter(k => status[k] !== 'posted')

  // Default rate: everyone bills the same man-hour rate ($90), whatever their
  // role. OT-marked time defaults to the job's OT rate if it has one. Any
  // line can still be changed before confirming.
  function defaultRate(l) {
    if (l.ot) { const ot = rates.find(isOtRate); if (ot) return ot }
    const regular = rates.filter(r => !isOtRate(r))
    return regular.find(r => Number(r.rate) === 90) || regular[0] || rates[0] || null
  }
  const rateOf = l => rates.find(r => r.id === rateFor[l.key]) || defaultRate(l)
  const toPost = waiting.filter(l => sel.includes(l.key))
  const missingRate = toPost.filter(l => !rateOf(l))
  const otWithoutOtRate = toPost.filter(l => l.ot && !isOtRate(rateOf(l) || {}))
  const total = toPost.reduce((s, l) => s + l.hours * (rateOf(l)?.rate || 0), 0)
  const totalH = toPost.reduce((s, l) => s + l.hours, 0)

  async function confirm() {
    setSaving(true)
    try {
      const keys = new Set(toPost.map(l => l.key))
      const add = toPost.map(l => ({
        id: uid(), date: l.date, hours: l.hours, worker: l.worker, rateId: rateOf(l).id,
        workCompleted: l.note + (l.ot ? ' (OT)' : ''), fromTracked: l.key,
      }))
      await onUpdate(cur => {
        const r = getLaborRates(cur)
        // 'changed' lines: the old posted entry is replaced, not doubled
        const next = [...(cur.laborEntries || []).filter(e => !keys.has(e.fromTracked)), ...add]
        return { laborEntries: next, actualLabor: Math.round(costOf(next, r) * 100) / 100 }
      })
      setReviewing(false); setPicked(null); setRateFor({})
    } finally { setSaving(false) }
  }
  async function unpost(l) {
    if (!window.confirm(`Take ${l.worker || 'this'}'s ${fmtH(l.hours)} h on ${l.date} back out of Labor Actual?${isTM ? ' It will come off the T&M total too.' : ''}`)) return
    await onUpdate(cur => {
      const r = getLaborRates(cur)
      const next = (cur.laborEntries || []).filter(e => e.fromTracked !== l.key)
      return { laborEntries: next, actualLabor: Math.round(costOf(next, r) * 100) / 100 }
    })
  }
  function removeTracked(l) {
    if (status[l.key] !== 'new') { alert('Take it out of Labor Actual first (Undo), then remove it.'); return }
    if (!window.confirm('Remove this tracked time entry?')) return
    onUpdate(cur => ({ trackedTime: (cur.trackedTime || []).map(e => {
      if (e.id !== l.entryId) return e
      const ws = (e.workers || []).filter(w => w !== l.worker)
      return ws.length ? { ...e, workers: ws, totalHours: Math.round((Number(e.hoursEach) || 0) * ws.length * 100) / 100 } : null
    }).filter(Boolean) }))
  }
  const saveNote = (l, v) => onUpdate(cur => ({ trackedTime: (cur.trackedTime || []).map(e => e.id === l.entryId ? { ...e, note: v } : e) }))
  const toggle = k => setPicked(sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k])

  const cell = { padding: '5px 6px', borderTop: '1px solid #f0dfae', fontSize: 12, verticalAlign: 'top' }
  const otTag = <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#9a6610' }}>OT</span>

  return (
    <div style={{ margin: '16px 0', padding: 12, background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 'var(--rs)' }}>
      {heading}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#8a5d00' }}>⏱ Tracked Time (crew clock)</div>
        <div style={{ fontSize: 12, color: '#8a5d00' }}>
          {waiting.length ? <b>{waiting.length} waiting to post</b> : 'All posted'} · {posted.length} in Labor Actual
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#8a5d00', margin: '2px 0 8px' }}>
        Posting adds the hours to Labor Actual as job cost{isTM ? ' — on this T&M job that also adds them to the T&M billing total' : ''}. Nothing is added until you review and confirm.
      </div>

      {!reviewing && waiting.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ fontSize: 11, color: 'var(--text-light)', textAlign: 'left' }}>
              {['', 'Date', 'Worker', 'Hours', 'Rate', 'What was done', ''].map((t, i) => <th key={i} style={{ padding: '0 6px 3px', textAlign: t === 'Hours' ? 'right' : 'left', width: i === 0 ? 24 : undefined }}>{t}</th>)}
            </tr></thead>
            <tbody>
              {waiting.map(l => (
                <tr key={l.key}>
                  <td style={cell}><input type="checkbox" checked={sel.includes(l.key)} onChange={() => toggle(l.key)} /></td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>{l.date}</td>
                  <td style={cell}>{l.worker || <i style={{ color: 'var(--text-light)' }}>—</i>}{l.ot && otTag}
                    {status[l.key] === 'changed' && <div style={{ fontSize: 10, color: '#c0392b' }}>edited since posted — re-post replaces it</div>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{fmtH(l.hours)}</td>
                  <td style={cell}>
                    <select value={rateOf(l)?.id || ''} onChange={e => setRateFor(m => ({ ...m, [l.key]: e.target.value }))}
                      style={{ fontSize: 11, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 4, borderColor: l.ot && !isOtRate(rateOf(l) || {}) ? '#e0a716' : 'var(--border)' }}>
                      <option value="">Rate…</option>
                      {rates.map(r => <option key={r.id} value={r.id}>{r.label} · ${Number(r.rate).toFixed(0)}</option>)}
                    </select>
                  </td>
                  <td style={{ ...cell, maxWidth: 260 }}><NoteEdit value={l.note} onSave={v => saveNote(l, v)} /></td>
                  <td style={cell}><button onClick={() => removeTracked(l)} title="Remove this tracked entry" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {otWithoutOtRate.length > 0 && (
            <div style={{ fontSize: 11, color: '#8a5d00', marginTop: 6 }}>⚠ {otWithoutOtRate.length} OT line{otWithoutOtRate.length === 1 ? ' is' : 's are'} on a regular rate — add an OT rate to this job under General Information if it bills at OT.</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-mid)' }}>{toPost.length} selected · {fmtH(totalH)} h · {money(total)}</div>
            <button disabled={!toPost.length || missingRate.length > 0} onClick={() => setReviewing(true)}
              style={{ padding: '6px 14px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: toPost.length ? 'pointer' : 'default', background: 'var(--navy)', color: '#fff', opacity: toPost.length && !missingRate.length ? 1 : 0.45 }}>
              Review & post {toPost.length || ''} →
            </button>
          </div>
        </>
      )}

      {reviewing && (
        <div style={{ background: '#fff', border: '2px solid var(--navy)', borderRadius: 8, padding: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Add to Labor Actual{isTM ? ' (and the T&M total)' : ''}?</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--text-light)', textAlign: 'left' }}>{['Date', 'Worker', 'Rate', 'Hours', 'Cost'].map(t => <th key={t} style={{ padding: '0 6px 3px', textAlign: t === 'Hours' || t === 'Cost' ? 'right' : 'left' }}>{t}</th>)}</tr></thead>
            <tbody>
              {toPost.map(l => (
                <tr key={l.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 6px' }}>{l.date}</td>
                  <td style={{ padding: '4px 6px' }}>{l.worker}{l.ot && otTag}</td>
                  <td style={{ padding: '4px 6px' }}>{rateOf(l).label} · ${Number(rateOf(l).rate).toFixed(2)}/h</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{fmtH(l.hours)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(l.hours * rateOf(l).rate)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: '5px 6px' }}>Total</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmtH(totalH)}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{money(total)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', margin: '6px 0' }}>
            Labor Actual on this job goes from {money(project.actualLabor)} to {money((Number(project.actualLabor) || 0) + total - toPost.filter(l => status[l.key] === 'changed').reduce((s, l) => s + costOf((project.laborEntries || []).filter(e => e.fromTracked === l.key), rates), 0))}.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setReviewing(false)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Back</button>
            <button onClick={confirm} disabled={saving}
              style={{ padding: '6px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
              {saving ? 'Posting…' : `Confirm — post ${toPost.length} to Labor Actual`}
            </button>
          </div>
        </div>
      )}

      {posted.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowPosted(s => !s)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#8a5d00', padding: 0 }}>
            {showPosted ? '▾' : '▸'} {posted.length} already in Labor Actual
          </button>
          {showPosted && posted.map(l => (
            <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderTop: '1px solid #f0dfae' }}>
              <span style={{ width: 80 }}>{l.date}</span>
              <span style={{ flex: 1 }}>✓ {l.worker} · {fmtH(l.hours)} h{l.ot && otTag}</span>
              <button onClick={() => unpost(l)} style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 999, background: '#fff', padding: '2px 9px', cursor: 'pointer', color: 'var(--text-mid)' }}>Undo</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
