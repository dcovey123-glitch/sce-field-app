import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { addDayToSheets, weekKeyFor } from '../api/timesheetFromClock.js'
import { abtHM, abtFromHM } from '../api/albertaTime.js'

// Review card for a day from the phone's crew clock (or a missed crew day
// entered by hand). One timeline per person, editable blocks, a job × person
// totals table, one "what was done" note per job. Confirming writes one
// entry per person per job into the same places as the rest of Catch-up
// (job.trackedTime / time_nonjob_log) — review only, never billing.

const inputStyle = { padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font)', background: '#fff' }
const smallBtn = { padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 999, background: '#fff', cursor: 'pointer', fontSize: 11, color: 'var(--text-mid)', whiteSpace: 'nowrap' }
const PALETTE = ['#1a5fa0', '#d4a017', '#2e8b57', '#b5483b', '#7b5ea7', '#2a9d9d', '#c76d1e', '#5a6b7a']
const SHORT_MS = 5 * 60000
const BUCKET_NAMES = { planning: 'Project planning / helping', shop: 'Shop / yard', travel: 'Travel / pickup', admin: 'Admin / quoting' }

function uid() { return Math.random().toString(36).slice(2, 10) }
const lower = s => (s || '').trim().toLowerCase()
const pad2 = n => String(n).padStart(2, '0')
const toHM = iso => abtHM(iso)
const fromHM = (date, hm) => abtFromHM(date, hm)
const ms = s => new Date(s.end) - new Date(s.start)
const fmtH = n => (Math.round(n * 100) / 100).toFixed(2)
const fmtClock = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const personKeyOf = s => s.workerId || 'n:' + lower(s.name)

// Round each job's hours to the step while keeping the person's day total
// equal to their rounded total (largest remainder goes up first).
export function allocateHours(msByTarget, step) {
  const entries = Object.entries(msByTarget).map(([t, m]) => [t, m / 3600000])
  if (!step) return Object.fromEntries(entries.map(([t, h]) => [t, Math.round(h * 100) / 100]))
  const sum = entries.reduce((a, [, h]) => a + h, 0)
  const units = Math.round(sum / step)
  const base = entries.map(([t, h]) => ({ t, u: Math.floor(h / step + 1e-9), r: h / step - Math.floor(h / step + 1e-9) }))
  let left = units - base.reduce((a, b) => a + b.u, 0)
  base.slice().sort((a, b) => b.r - a.r).forEach(b => { if (left > 0) { b.u++; left-- } })
  return Object.fromEntries(base.map(b => [b.t, Math.round(b.u * step * 100) / 100]))
}

export default function CrewDayReview({ item, jobs, allJobs, customers, crew, rounding, writeEntry, onChange, onDone, onDiscard, onTask }) {
  const [history, setHistory] = useLocalStore('time_crew_days', [])
  const [saving, setSaving] = useState(false)
  const [, setSheets] = useLocalStore('timesheets', {})
  const [toSheet, setToSheet] = useLocalStore('time_send_to_timesheet', true)
  const [addPerson, setAddPerson] = useState('')
  const date = item.date
  const segs = (item.segments || []).slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const notes = item.notes || {}

  const set = patch => onChange({ ...item, ...patch })
  const setSegs = next => set({ segments: next })
  const patchSeg = (id, patch) => setSegs(segs.map(s => s.id === id ? { ...s, ...patch } : s))

  // Current roster name for a block (handles renames since the phone recorded it)
  const personOf = s => crew.roster.find(p => s.workerId && p.id === s.workerId) || crew.findByName(s.name) || null
  const nameOf = s => personOf(s)?.name || s.name

  // People in order: me first, then as they appear
  const people = []
  segs.forEach(s => { const k = personKeyOf(s); if (!people.some(p => p.key === k)) people.push({ key: k, name: nameOf(s), workerId: personOf(s)?.id || s.workerId || '' }) })
  ;(item.crew || []).forEach(c => { const k = c.id || 'n:' + lower(c.name); if (!people.some(p => p.key === k)) people.push({ key: k, name: crew.roster.find(p => p.id === c.id)?.name || c.name, workerId: c.id || '' }) })
  people.sort((a, b) => (lower(b.name) === lower(crew.meName)) - (lower(a.name) === lower(crew.meName)))

  // Targets: job / bucket / still-unassigned new job from the phone
  const jobById = id => (allJobs || jobs).find(j => j.id === id)
  const custName = id => customers.find(c => c.id === id)?.name || ''
  const isMapped = t => t && (t.startsWith('bucket:') || (t.startsWith('job:') && !!jobById(t.slice(4))))
  const targetName = (t, s) => {
    if (!t) return 'Not assigned'
    if (t.startsWith('bucket:')) return BUCKET_NAMES[t.slice(7)] || t.slice(7)
    if (t.startsWith('job:')) { const j = jobById(t.slice(4)); return j ? `${custName(j.customerId)} — ${j.name || 'Untitled'}` : (s?.label || 'Unknown job') }
    return s?.label || t
  }
  const targets = []
  segs.forEach(s => { if (!targets.includes(s.target)) targets.push(s.target) })
  const colorOf = t => PALETTE[Math.max(0, targets.indexOf(t)) % PALETTE.length]
  // Hours are totalled per job AND per "OT rates apply" — OT only when you mark it
  const comboOf = s => s.target + '|' + (s.ot ? 'ot' : 'reg')
  const parseCombo = k => { const i = k.lastIndexOf('|'); return [k.slice(0, i), k.slice(i + 1) === 'ot'] }
  const combos = []
  segs.forEach(s => { const k = comboOf(s); if (!combos.includes(k)) combos.push(k) })
  const sampleSeg = t => segs.find(s => s.target === t)

  // Picking a job for a "🆕 new job" block maps every block with that name
  function setTarget(seg, target) {
    if (seg.isNew || !isMapped(seg.target)) {
      const from = seg.target
      setSegs(segs.map(s => s.target === from && (s.isNew || !isMapped(s.target)) ? { ...s, target, isNew: false } : s))
    } else patchSeg(seg.id, { target, isNew: false })
  }

  function setTime(seg, field, hm) {
    if (!hm) return
    patchSeg(seg.id, { [field]: fromHM(date, hm) })
  }
  function splitSeg(seg) {
    const mid = new Date((new Date(seg.start).getTime() + new Date(seg.end).getTime()) / 2)
    mid.setMinutes(Math.round(mid.getMinutes() / 15) * 15, 0, 0)
    const at = mid.toISOString()
    if (at <= seg.start || at >= seg.end) return
    setSegs([...segs.filter(s => s.id !== seg.id), { ...seg, end: at }, { ...seg, id: uid(), start: at }])
  }
  function addBlock(person) {
    const mine = segs.filter(s => personKeyOf(s) === person.key)
    const last = mine[mine.length - 1]
    const start = last ? last.end : fromHM(date, '07:00')
    const end = new Date(new Date(start).getTime() + 3600000).toISOString()
    setSegs([...segs, { id: uid(), workerId: person.workerId, name: person.name, target: last?.target || targets[0] || '', label: last?.label || '', start, end }])
  }
  function removePerson(person) {
    if (!window.confirm(`Remove ${person.name} from this day? Their blocks go with them.`)) return
    set({ segments: segs.filter(s => personKeyOf(s) !== person.key), crew: (item.crew || []).filter(c => (c.id || 'n:' + lower(c.name)) !== person.key) })
  }
  function addPersonToDay(id) {
    const p = crew.roster.find(x => x.id === id)
    if (!p) return
    // Most of the time the helper worked the same day as you — start from a copy of the first person's blocks
    const first = people[0]
    const copy = first ? segs.filter(s => personKeyOf(s) === first.key).map(s => ({ ...s, id: uid(), workerId: p.id, name: p.name })) : []
    set({ segments: [...segs, ...copy], crew: [...(item.crew || []), { id: p.id, name: p.name }] })
    setAddPerson('')
  }
  const lastDay = history.filter(d => d.date < date && d.segments?.length).sort((a, b) => b.date.localeCompare(a.date))[0]
  function copyFrom(day) {
    const shift = iso => fromHM(date, toHM(iso))
    set({ segments: day.segments.map(s => ({ ...s, id: uid(), start: shift(s.start), end: shift(s.end) })), crew: day.crew || [], notes: {} })
  }

  // ── Checks ──
  const problems = []
  const warnings = []
  if (!segs.length) problems.push('add at least one block')
  segs.forEach(s => { if (!(new Date(s.end) > new Date(s.start))) problems.push(`${nameOf(s)}: a block ends before it starts`) })
  if (segs.some(s => !isMapped(s.target))) problems.push('pick a job for every block')
  people.forEach(p => {
    const mine = segs.filter(s => personKeyOf(s) === p.key)
    // Overlap = more than a minute of the same person on two things at once
    for (let i = 1; i < mine.length; i++) if (new Date(mine[i].start) < new Date(mine[i - 1].end) - 60000) { problems.push(`${p.name} has overlapping blocks`); break }
    mine.forEach(s => { if (ms(s) > 0 && ms(s) < SHORT_MS) warnings.push(`${p.name}: ${Math.round(ms(s) / 60000)} min block at ${fmtClock(s.start)} — mis-tap?`) })
  })
  targets.filter(isMapped).forEach(t => { if (!(notes[t] || '').trim()) problems.push(`say what was done on ${targetName(t, sampleSeg(t))}`) })
  const uniq = [...new Set(problems)]

  // ── Totals (rounded per person) ──
  const alloc = {}
  people.forEach(p => {
    const byT = {}
    segs.filter(s => personKeyOf(s) === p.key && ms(s) > 0).forEach(s => { const k = comboOf(s); byT[k] = (byT[k] || 0) + ms(s) })
    alloc[p.key] = allocateHours(byT, rounding)
  })
  const personTotal = p => Object.values(alloc[p.key] || {}).reduce((a, b) => a + b, 0)
  const crewTotal = people.reduce((a, p) => a + personTotal(p), 0)

  // ── Timeline scale ──
  const t0 = segs.length ? Math.min(...segs.map(s => new Date(s.start).getTime())) : 0
  const t1 = segs.length ? Math.max(...segs.map(s => new Date(s.end).getTime())) : 1
  const span = Math.max(1, t1 - t0)

  async function confirm() {
    setSaving(true)
    try {
      const sheetPeople = []
      for (const p of people) {
        const person = crew.roster.find(x => x.id === p.workerId) || crew.addPerson(p.name)
        const name = person?.name || p.name
        for (const [combo, hours] of Object.entries(alloc[p.key] || {})) {
          if (!(hours > 0)) continue
          const [target, ot] = parseCombo(combo)
          const mine = segs.filter(s => personKeyOf(s) === p.key && comboOf(s) === combo)
          const entry = {
            id: uid(), date, startedAt: mine[0].start, endedAt: mine[mine.length - 1].end,
            hoursEach: hours, workers: [name], ...(person?.id ? { workerIds: [person.id] } : {}), totalHours: hours, ...(ot ? { ot: true } : {}),
            note: (notes[target] || '').trim(), sourceId: item.id, sessionId: item.id,
            segments: mine.map(s => ({ start: s.start, end: s.end })),
          }
          await writeEntry(target, entry)
        }
        // Timesheet rows for this person, in the order they worked the jobs
        const first = k => Math.min(...segs.filter(s => personKeyOf(s) === p.key && comboOf(s) === k).map(s => new Date(s.start).getTime()))
        const rows = Object.entries(alloc[p.key] || {}).filter(([, h]) => h > 0)
          .sort((a, b) => first(a[0]) - first(b[0]))
          .map(([k, h]) => { const [t, ot] = parseCombo(k); return { jobId: t.startsWith('job:') ? t.slice(4) : '', project: targetName(t, sampleSeg(t)), hours: h, ot, note: (notes[t] || '').trim() } })
        sheetPeople.push({ name, workerId: person?.id || '', rows })
      }
      if (toSheet) {
        setSheets(sh => addDayToSheets(sh, { date, sessionId: item.id, people: sheetPeople, me: crew.me ? { name: crew.me.name, id: crew.me.id } : null }))
      }
      // Kept for "Copy from last crew day"
      setHistory(h => [{ id: item.id, date, crew: item.crew || [], segments: segs }, ...h.filter(d => d.id !== item.id)].slice(0, 20))
      onDone()
    } finally { setSaving(false) }
  }

  const targetSelect = seg => (
    <select value={isMapped(seg.target) ? seg.target : ''} onChange={e => e.target.value && setTarget(seg, e.target.value)}
      style={{ ...inputStyle, flex: 1, minWidth: 170, borderColor: isMapped(seg.target) ? 'var(--border)' : '#e0a716' }}>
      <option value="">{isMapped(seg.target) ? 'Assign to…' : `Pick job for ${seg.label || 'this block'}…`}</option>
      <optgroup label="Non-job time">
        {Object.entries(BUCKET_NAMES).map(([id, l]) => <option key={id} value={`bucket:${id}`}>{l}</option>)}
      </optgroup>
      {customers.map(c => {
        const list = jobs.filter(j => j.customerId === c.id)
        const extra = seg.target?.startsWith('job:') && jobById(seg.target.slice(4))?.customerId === c.id && !list.some(j => 'job:' + j.id === seg.target) ? [jobById(seg.target.slice(4))] : []
        if (!list.length && !extra.length) return null
        return <optgroup key={c.id} label={c.name}>{[...list, ...extra].map(j => <option key={j.id} value={`job:${j.id}`}>{j.name || 'Untitled'}</option>)}</optgroup>
      })}
    </select>
  )

  const notOnDay = crew.active.filter(p => !people.some(x => x.workerId === p.id || lower(x.name) === lower(p.name)))
  const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div style={{ background: '#fff', border: '2px solid var(--navy)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>👷 {item.manual ? 'Missed time' : 'Crew day'} — {dayLabel}{item.manual ? <span style={{ fontWeight: 400, color: 'var(--text-light)' }}> · entered by hand</span> : null}</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>{people.length} {people.length === 1 ? 'person' : 'people'} · crew total <b>{fmtH(crewTotal)} h</b></div>
      </div>

      {!segs.length && lastDay && (
        <button onClick={() => copyFrom(lastDay)} style={{ ...smallBtn, marginTop: 8 }}>⧉ Copy from {lastDay.date} ({[...new Set(lastDay.segments.map(s => s.name))].join(', ')})</button>
      )}

      {/* Per-person timeline + blocks */}
      {people.map(p => {
        const mine = segs.filter(s => personKeyOf(s) === p.key)
        return (
          <div key={p.key} style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              <div style={{ flex: 1, position: 'relative', height: 16, background: 'var(--surface-2, #eef1f4)', borderRadius: 4 }}>
                {mine.filter(s => ms(s) > 0).map(s => (
                  <div key={s.id} title={`${fmtClock(s.start)}–${fmtClock(s.end)} · ${targetName(s.target, s)}`}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: `${((new Date(s.start) - t0) / span) * 100}%`, width: `${Math.max(0.5, (ms(s) / span) * 100)}%`, background: isMapped(s.target) ? colorOf(s.target) : '#e0a716', borderRadius: 3, opacity: 0.9, boxShadow: s.ot ? 'inset 0 0 0 2px #9a6610' : undefined }} />
                ))}
              </div>
              <div style={{ width: 60, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{fmtH(personTotal(p))} h</div>
              <button onClick={() => removePerson(p)} title="Remove from this day" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>✕</button>
            </div>
            {mine.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 5, paddingLeft: 138 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: isMapped(s.target) ? colorOf(s.target) : '#e0a716', flexShrink: 0 }} />
                <input type="time" value={toHM(s.start)} onChange={e => setTime(s, 'start', e.target.value)} style={{ ...inputStyle, width: 112 }} />
                <span style={{ fontSize: 12, color: 'var(--text-light)' }}>–</span>
                <input type="time" value={toHM(s.end)} onChange={e => setTime(s, 'end', e.target.value)} style={{ ...inputStyle, width: 112 }} />
                {targetSelect(s)}
                <label title="OT rates apply — only tick when this time can be billed to the customer at OT rates" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: s.ot ? '#9a6610' : 'var(--text-light)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={!!s.ot} onChange={e => patchSeg(s.id, { ot: e.target.checked })} /> OT
                </label>
                <span style={{ fontSize: 11, color: 'var(--text-light)', width: 44, textAlign: 'right' }}>{ms(s) > 0 ? fmtH(ms(s) / 3600000) : '—'}</span>
                <button onClick={() => splitSeg(s)} title="Split this block in two" style={{ ...smallBtn, padding: '2px 7px' }}>✂</button>
                <button onClick={() => setSegs(segs.filter(x => x.id !== s.id))} title="Delete this block" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-light)' }}>✕</button>
              </div>
            ))}
            <div style={{ paddingLeft: 138, marginTop: 5 }}>
              <button onClick={() => addBlock(p)} style={{ ...smallBtn, borderStyle: 'dashed' }}>+ block</button>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <select value={addPerson} onChange={e => addPersonToDay(e.target.value)} style={{ ...inputStyle }} aria-label="Add person to this day">
          <option value="">+ Add person to this day…</option>
          {notOnDay.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {people.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>starts as a copy of {people[0].name}'s blocks</span>}
      </div>

      {/* Totals + notes per job */}
      {targets.length > 0 && people.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2, #eef1f4)' }}>
                <th style={{ textAlign: 'left', padding: '5px 6px' }}>Job</th>
                {people.map(p => <th key={p.key} style={{ textAlign: 'right', padding: '5px 6px', whiteSpace: 'nowrap' }}>{p.name}</th>)}
                <th style={{ textAlign: 'left', padding: '5px 6px', width: '45%' }}>What was done <span style={{ color: '#c0392b', fontWeight: 400 }}>(required)</span></th>
              </tr>
            </thead>
            <tbody>
              {combos.map(k => { const [t, ot] = parseCombo(k); const firstForJob = combos.find(c => parseCombo(c)[0] === t) === k; return (
                <tr key={k} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: isMapped(t) ? colorOf(t) : '#e0a716', marginRight: 6 }} />
                    {isMapped(t) ? targetName(t, sampleSeg(t)) : <i style={{ color: '#8a5d00' }}>{targetName(t, sampleSeg(t))} — pick a job above</i>}
                    {ot && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#9a6610', background: '#fbf1dc', borderRadius: 10, padding: '1px 7px' }}>OT</span>}
                  </td>
                  {people.map(p => <td key={p.key} style={{ textAlign: 'right', padding: '5px 6px', verticalAlign: 'top', fontWeight: 600, color: ot ? '#9a6610' : undefined }}>{alloc[p.key]?.[k] ? fmtH(alloc[p.key][k]) : '—'}</td>)}
                  <td style={{ padding: '4px 6px' }}>
                    {!firstForJob && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>same note as above</span>}
                    {isMapped(t) && firstForJob && (
                      <textarea value={notes[t] || ''} onChange={e => set({ notes: { ...notes, [t]: e.target.value } })} rows={1}
                        placeholder="e.g. pulled wire to panel 2B, replaced ballasts in 1220"
                        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', borderColor: (notes[t] || '').trim() ? 'var(--border)' : '#e0a716' }} />
                    )}
                  </td>
                </tr>
              ) })}
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ padding: '5px 6px', fontWeight: 700 }}>Day total</td>
                {people.map(p => <td key={p.key} style={{ textAlign: 'right', padding: '5px 6px', fontWeight: 700 }}>{fmtH(personTotal(p))}</td>)}
                <td style={{ padding: '5px 6px', color: 'var(--text-light)' }}>{rounding ? `rounded to ${rounding === 0.25 ? '¼' : '½'} h per person` : 'exact'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && <div style={{ fontSize: 11, color: '#8a5d00', marginTop: 6 }}>⚠ {warnings.join(' · ')}</div>}

      {/* Tasks on the jobs worked today — tick what got finished */}
      {onTask && (() => {
        const ids = [...new Set(segs.map(s => s.target).filter(t => t && t.startsWith('job:')).map(t => t.slice(4)))]
        const withTasks = ids.map(jobById).filter(j => j && (j.tasks || []).some(t => !t.done || String(t.doneAt || '').slice(0, 10) === date))
        if (!withTasks.length) return null
        return (
          <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', background: '#f7fbf8' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e7a34', marginBottom: 4 }}>✓ Tasks finished {dayLabel.split(',')[0]}? Tick them — they're dated {date}.</div>
            {withTasks.map(j => (
              <div key={j.id} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-mid)' }}>{j.name}</div>
                {(j.tasks || []).filter(t => !t.done || String(t.doneAt || '').slice(0, 10) === date).map(t => (
                  <label key={t.id} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, padding: '2px 0 2px 6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!t.done} onChange={e => onTask(j.id, t.id, e.target.checked, date + 'T17:00:00')} />
                    <span style={{ textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--text-light)' : 'var(--text)' }}>{t.text}</span>
                    {t.who && !t.done && <span style={{ fontSize: 11, color: 'var(--text-light)' }}>· {t.who}</span>}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--text-mid)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} title="Adds one row per person per job to this week's timesheet. Rows you typed yourself are never touched.">
          <input type="checkbox" checked={!!toSheet} onChange={e => setToSheet(e.target.checked)} />
          Also put on the timesheet (week of {new Date(weekKeyFor(date) + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })})
        </label>
        <span style={{ color: 'var(--text-light)' }}>All hours go in Regular unless a block is ticked OT.</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: '#8a5d00' }}>{uniq.length ? `To confirm: ${uniq.join(', ')}` : ''}</div>
        <button onClick={() => { if (window.confirm('Discard this whole crew day? The time will be thrown away.')) onDiscard() }}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Discard</button>
        <button disabled={uniq.length > 0 || saving} onClick={confirm}
          style={{ padding: '6px 14px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: uniq.length ? 'default' : 'pointer', background: 'var(--accent)', color: 'var(--navy)', opacity: !uniq.length && !saving ? 1 : 0.5 }}>
          {saving ? 'Saving…' : 'Confirm day'}
        </button>
      </div>
    </div>
  )
}
