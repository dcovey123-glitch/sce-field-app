import React, { useState, useEffect } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import { FlaggedList } from '../components/Flags.jsx'
import { useFlags } from '../api/flags.js'
import { moveMiscToDaily, removeEntryFromSection, searchDaily, generalToJobNote } from '../api/notes.js'
import { fmtDate } from '../api/format.js'

// The assistant used to file each day's emails as a General Note ("Oct 29th -
// Misc Notes"). Move any of those onto their day in Daily Notes. App runs this.
export function useMoveMiscNotesToDaily() {
  const [general, setGeneral] = useLocalStore('general_notes', [])
  const [daily, setDaily] = useLocalStore('daily_notes', {})
  useEffect(() => {
    const r = moveMiscToDaily(general, daily)
    if (!r) return
    setDaily(r.daily)
    setGeneral(r.general)
  }, [general]) // eslint-disable-line react-hooks/exhaustive-deps
}

function useJobOptions() {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const jobOptions = jobsHub.loading ? [] : jobsHub.records
    .filter(p => !p.trashedAt)
    .map(p => ({ ...p, customerName: jobsHub.customers.find(c => c.id === p.customerId)?.name || 'Unknown customer' }))
  return { jobsHub, jobOptions }
}

// Type-to-find a job → onPick(job)
function JobPicker({ jobOptions, onPick, onCancel, placeholder = 'Search a job…' }) {
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const open = j => !j.completed && !['billed', 'unbilled', 'closed'].includes(j.lifecycleStatus)
  const list = (t ? jobOptions.filter(j => (j.customerName + ' ' + j.name + ' ' + (j.co || '') + ' ' + (j.workOrder?.number || '')).toLowerCase().includes(t))
    : jobOptions.filter(open)).slice(0, 12)
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
        onBlur={() => setTimeout(() => onCancel && onCancel(), 150)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel && onCancel(); if (e.key === 'Enter' && list[0]) onPick(list[0]) }}
        style={{ fontSize: 13, border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 9px', width: 280, fontFamily: 'var(--font)' }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 30, width: 340, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', maxHeight: 260, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
        {!t && <div style={{ padding: '5px 10px', fontSize: 10.5, color: 'var(--text-light)', fontWeight: 700 }}>OPEN JOBS — TYPE TO SEARCH ALL</div>}
        {list.length ? list.map(j => (
          <div key={j.id} onMouseDown={() => onPick(j)} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-light)' }}>{j.customerName} — </span><span style={{ fontWeight: 700 }}>{j.name}</span>
          </div>
        )) : <div style={{ padding: 8, fontSize: 12, color: 'var(--text-light)' }}>No job matches.</div>}
      </div>
    </div>
  )
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}
function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = toDateStr(new Date())
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (dateStr === today) return `Today — ${label}`
  if (dateStr === addDays(today, -1)) return `Yesterday — ${label}`
  if (dateStr === addDays(today, 1)) return `Tomorrow — ${label}`
  return label
}

// A day's entry used to be a single string. Reading it as an array of
// sections transparently — any day still in the old shape becomes one
// section carrying that same text, so nothing written before this gets lost.
export function sectionsFor(entries, dateStr) {
  const raw = entries[dateStr]
  if (!raw) return []
  if (typeof raw === 'string') return [{ id: uid(), text: raw, jobId: null }]
  return raw
}

function WorkerTagPicker({ workerNames, allWorkerNames, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const matches = q ? allWorkerNames.filter(n =>
    n.toLowerCase().includes(q) && !workerNames.some(w => w.toLowerCase() === n.toLowerCase())
  ).slice(0, 6) : []

  function add(name) {
    const n = name.trim()
    if (n && !workerNames.some(w => w.toLowerCase() === n.toLowerCase())) onAdd(n)
    setQuery(''); setAdding(false)
  }
  const onKey = e => { if (e.key === 'Enter') add(query); if (e.key === 'Escape') { setQuery(''); setAdding(false) } }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {workerNames.map(name => (
        <span key={name} style={{ fontSize: 11, fontWeight: 700, color: '#1e7a34', background: '#e6f4ea', borderRadius: 20, padding: '3px 6px 3px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
          {name}
          <button onClick={() => onRemove(name)} style={{ background: 'none', border: 'none', color: '#1e7a34', cursor: 'pointer', fontSize: 13, padding: 0 }} aria-label={`Remove ${name}`}>×</button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '4px 10px', cursor: 'pointer' }}
          >
            + Worker
          </button>
        ) : (
          <input
            autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey}
            onBlur={() => setTimeout(() => { setQuery(''); setAdding(false) }, 150)}
            placeholder="Name…"
            style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', width: 140, fontFamily: 'var(--font)' }}
          />
        )}
        {adding && matches.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 20, width: 160,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
            maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {matches.map(n => (
              <div key={n} onMouseDown={() => add(n)} style={{ padding: '7px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                {n}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function DailySectionRow({ section, jobOptions, allWorkerNames, onUpdate, onDelete }) {
  const [pickingJob, setPickingJob] = useState(false)
  const [jobQuery, setJobQuery] = useState('')
  const [expanded, setExpanded] = useState(() => !section.text)
  const linkedJob = section.jobId ? jobOptions.find(j => j.id === section.jobId) : null
  const workerNames = section.workerNames || []

  const q = jobQuery.trim().toLowerCase()
  const matches = q ? jobOptions.filter(j =>
    j.customerName.toLowerCase().includes(q) || j.name.toLowerCase().includes(q)
  ).slice(0, 6) : []

  function pickJob(j) {
    onUpdate({ jobId: j.id })
    setPickingJob(false); setJobQuery('')
  }
  function addWorker(name) {
    onUpdate({ workerNames: [...workerNames, name] })
  }
  function removeWorker(name) {
    onUpdate({ workerNames: workerNames.filter(w => w !== name) })
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', marginBottom: 10, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(x => !x)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', background: expanded ? 'var(--surface)' : 'var(--surface-2)' }}
      >
        <svg width="10" height="10" viewBox="0 0 18 18" fill="none" style={{ color: 'var(--text-light)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{
          fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: section.assistant ? '#5b3fa0' : linkedJob ? '#1a5fa0' : 'var(--text-light)',
        }}>
          {section.assistant ? `🤖 Assistant — filed from email (${(section.miscEntries || []).length})` : linkedJob ? `${linkedJob.customerName} — ${linkedJob.name}` : 'No job attached'}
        </span>
        {!expanded && section.text && <span style={{ fontSize: 12, color: 'var(--text-light)', flex: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(section.text).split('\n')[0]}</span>}
      </div>

      {expanded && (
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            {linkedJob ? (
              <button
                onClick={() => onUpdate({ jobId: null })}
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Unlink job
              </button>
            ) : (
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                {!pickingJob ? (
                  <button
                    onClick={() => setPickingJob(true)}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px dashed var(--border)', borderRadius: 20, padding: '4px 10px', cursor: 'pointer' }}
                  >
                    + Link to a job
                  </button>
                ) : (
                  <input
                    autoFocus value={jobQuery} onChange={e => setJobQuery(e.target.value)}
                    onBlur={() => setTimeout(() => setPickingJob(false), 150)}
                    placeholder="Search a job…"
                    style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', width: 200, fontFamily: 'var(--font)' }}
                  />
                )}
                {pickingJob && matches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 20, width: 240,
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
                    maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}>
                    {matches.map(j => (
                      <div key={j.id} onMouseDown={() => pickJob(j)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-light)' }}>{j.customerName} — </span>
                        <span style={{ fontWeight: 700 }}>{j.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ConfirmDeleteButton
              onConfirm={onDelete} ariaLabel="Delete section" confirmText="Delete this section?"
              style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 15, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
            />
          </div>
          {section.assistant && <EmailEntries note={section} onRemoveEntry={e => onUpdate(removeEntryFromSection(section, e))} />}
          <div style={{ marginBottom: 8 }}>
            <WorkerTagPicker workerNames={workerNames} allWorkerNames={allWorkerNames} onAdd={addWorker} onRemove={removeWorker} />
          </div>
          <textarea
            autoFocus={!section.text}
            value={section.text} onChange={e => onUpdate({ text: e.target.value })}
            placeholder="Note…"
            style={{
              width: '100%', minHeight: section.assistant ? 220 : 90, resize: 'vertical', fontSize: 14, lineHeight: 1.5, fontFamily: 'var(--font)',
              color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  )
}

function DailyNotesView() {
  const [entries, setEntries] = useLocalStore('daily_notes', {})
  const [activeDate, setActiveDate] = useState(() => toDateStr(new Date()))
  const [jumpDate, setJumpDate] = useState('')
  const [search, setSearch] = useState('')
  const [timesheets] = useLocalStore('timesheets', {})
  const { jobOptions } = useJobOptions()

  const sections = sectionsFor(entries, activeDate)
  const today = toDateStr(new Date())
  const relativeWord = activeDate === today ? 'today' : activeDate === addDays(today, -1) ? 'yesterday' : activeDate === addDays(today, 1) ? 'tomorrow' : 'this day'

  const jobName = id => { const j = id && jobOptions.find(x => x.id === id); return j ? j.customerName + ' ' + j.name : '' }
  const hits = searchDaily(entries, search, jobName)

  const allWorkerNames = [...new Set(
    Object.values(timesheets).flatMap(week => (week.workers || []).map(w => (w.name || '').trim()).filter(Boolean))
  )].sort()

  function saveSections(next) {
    setEntries(list => ({ ...list, [activeDate]: next }))
  }
  function addSection() {
    saveSections([...sections, { id: uid(), text: '', jobId: null }])
  }
  function updateSection(id, patch) {
    saveSections(sections.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function deleteSection(id) {
    saveSections(sections.filter(s => s.id !== id))
  }
  function jumpTo(dateStr) {
    if (dateStr) setActiveDate(dateStr)
  }

  const searchBox = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
        placeholder="🔍 Search every day — words, a job, a worker, an email sender…"
        style={{ flex: 1, fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font)' }} />
      {search && <button onClick={() => setSearch('')} style={{ fontSize: 12, fontWeight: 700, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>Clear</button>}
    </div>
  )
  if (search.trim()) {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    const snippet = t => {
      const str = String(t || '').replace(/\s+/g, ' ')
      const i = Math.max(0, ...words.map(w => str.toLowerCase().indexOf(w)).filter(x => x >= 0).slice(0, 1))
      return (i > 40 ? '…' : '') + str.slice(Math.max(0, i - 40), i + 160) + (str.length > i + 160 ? '…' : '')
    }
    return (
      <div style={{ padding: 16 }}>
        {searchBox}
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 8 }}>{hits.length} match{hits.length === 1 ? '' : 'es'} — click one to open that day</div>
        {hits.map(({ day, section: s }) => (
          <div key={day + s.id} onClick={() => { setActiveDate(day); setSearch('') }}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '8px 12px', marginBottom: 6, cursor: 'pointer', background: 'var(--surface)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>
              {formatDayLabel(day)} · <span style={{ color: s.assistant ? '#5b3fa0' : '#1a5fa0' }}>{s.assistant ? '🤖 Assistant' : jobName(s.jobId) || 'No job'}</span>
              {(s.workerNames || []).length ? <span style={{ color: '#1e7a34' }}> · {s.workerNames.join(', ')}</span> : null}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>{snippet(s.text) || <i style={{ color: 'var(--text-light)' }}>(empty)</i>}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {searchBox}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveDate(d => addDays(d, -1))}
          style={{ width: 32, height: 32, borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16, color: 'var(--text-mid)' }}
        >
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 160, textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {formatDayLabel(activeDate)}
        </div>
        <button
          onClick={() => setActiveDate(d => addDays(d, 1))}
          style={{ width: 32, height: 32, borderRadius: 'var(--rs)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 16, color: 'var(--text-mid)' }}
        >
          ›
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {activeDate !== today && (
          <button
            onClick={() => setActiveDate(today)}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'var(--accent-bg)', border: 'none', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}
          >
            Jump to today
          </button>
        )}
        <input
          type="date" value={jumpDate}
          onChange={e => { setJumpDate(e.target.value); jumpTo(e.target.value) }}
          style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-mid)' }}
        />
      </div>

      {sections.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          Nothing logged for {relativeWord} yet.
        </div>
      )}
      {sections.map(s => (
        <DailySectionRow key={s.id} section={s} jobOptions={jobOptions} allWorkerNames={allWorkerNames} onUpdate={patch => updateSection(s.id, patch)} onDelete={() => deleteSection(s.id)} />
      ))}
      <button
        onClick={addSection}
        style={{ width: '100%', padding: 10, borderRadius: 'var(--rs)', border: '1.5px dashed var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
      >
        + Add section
      </button>
    </div>
  )
}

function GeneralNotesList({ notes, onOpen, onAdd, onDelete, onMove, jobOptions }) {
  const [moving, setMoving] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  function submitNew() {
    const t = newTitle.trim()
    if (t) onAdd(t)
    setNewTitle(''); setCreating(false)
  }
  const onKey = e => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') { setNewTitle(''); setCreating(false) } }

  const sorted = [...notes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return (
    <div style={{ padding: 16 }}>
      {sorted.length === 0 && !creating && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          No notes yet — add one below.
        </div>
      )}
      {sorted.map(n => (
        <div
          key={n.id}
          onClick={() => onOpen(n.id)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px',
            border: '1px solid var(--border)', borderRadius: 'var(--rs)', marginBottom: 8, cursor: 'pointer', background: 'var(--surface)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.title}
            </div>
            {n.updatedAt && (
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                Updated {fmtDate(n.updatedAt, 'medium')}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {moving === n.id
            ? <JobPicker jobOptions={jobOptions} onPick={j => { setMoving(null); onMove(n, j) }} onCancel={() => setMoving(null)} placeholder="Move to which job?" />
            : <button onClick={e => { e.stopPropagation(); setMoving(n.id) }} title="Move this note onto a job's notes (it leaves General Notes)"
                style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: 'var(--surface)', border: '1px solid #9fb8d6', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>→ Move to Job Notes</button>}
          <ConfirmDeleteButton
            onConfirm={() => onDelete(n.id)} ariaLabel="Delete note" confirmText={`Delete "${n.title}"? This can't be undone.`}
            style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 16, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
          />
        </div>
      ))}

      {creating ? (
        <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--rs)', padding: '10px 12px' }}>
          <input
            autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} onBlur={submitNew} onKeyDown={onKey}
            placeholder="Note title…"
            style={{ width: '100%', fontSize: 14, border: 'none', outline: 'none', fontFamily: 'var(--font)', boxSizing: 'border-box' }}
          />
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          style={{ width: '100%', padding: 12, borderRadius: 'var(--rs)', border: '1.5px dashed var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          + New note
        </button>
      )}
    </div>
  )
}

// Misc notes filed from email list each email under the title with an
// "Irrelevant" button: it takes that email's text out of the note (the email
// itself is untouched).
function EmailEntries({ note, onRemoveEntry }) {
  const entries = note.miscEntries || []
  if (!entries.length) return null
  return (
    <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-light)', padding: '6px 10px', background: 'var(--surface-2)' }}>
        📧 Filed from email ({entries.length})
      </div>
      {entries.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-mid)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(e.block || '').split('\n')[0]}</span>
          <ConfirmDeleteButton
            onConfirm={() => onRemoveEntry(e)} ariaLabel="Irrelevant — remove this email from the note" triggerLabel="Irrelevant" label="Remove"
            confirmText="Take this email's text out of the note? The email itself stays in Outlook."
            style={{ fontSize: 10.5, fontWeight: 700, color: '#8a6d1f', background: '#fff8e6', border: '1px solid #e8cf8a', borderRadius: 20, padding: '2px 9px', cursor: 'pointer' }}
          />
        </div>
      ))}
    </div>
  )
}

export function removeMiscEntry(note, entry) {
  const block = String(entry.block || '')
  const strip = s => {
    const str = String(s || '')
    if (!block || !str.includes(block)) return str
    return str.replace(block, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  return {
    miscEntries: (note.miscEntries || []).filter(e => e.id !== entry.id),
    content: strip(note.content),
    ...(note.miscContent !== undefined ? { miscContent: strip(note.miscContent) } : {}),
  }
}

function GeneralNoteDetail({ note, onUpdateTitle, onUpdateContent, onRemoveEntry, onBack, onMove, jobOptions }) {
  const [moving, setMoving] = useState(false)
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <button
        onClick={onBack}
        style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10 }}
      >
        ← All notes
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {moving
          ? <><JobPicker jobOptions={jobOptions} onPick={j => { setMoving(false); onMove(j) }} onCancel={() => setMoving(false)} placeholder="Move to which job?" />
              <button onClick={() => setMoving(false)} style={{ fontSize: 12, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Cancel</button></>
          : <button onClick={() => setMoving(true)} title="Move this note onto a job's notes (it leaves General Notes)"
              style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', background: 'var(--surface)', border: '1px solid #9fb8d6', borderRadius: 20, padding: '4px 12px', cursor: 'pointer' }}>→ Move to Job Notes…</button>}
      </div>
      <input
        value={note.title} onChange={e => onUpdateTitle(e.target.value)}
        placeholder="Note title"
        style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', border: 'none', outline: 'none', fontFamily: 'var(--font-d)', marginBottom: 12, background: 'none' }}
      />
      <EmailEntries note={note} onRemoveEntry={onRemoveEntry} />
      <textarea
        value={note.content || ''} onChange={e => onUpdateContent(e.target.value)}
        placeholder="Start typing…"
        style={{
          flex: 1, width: '100%', minHeight: 400, resize: 'vertical', fontSize: 14, lineHeight: 1.6, fontFamily: 'var(--font)',
          color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: 14, outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function GeneralNotesView() {
  const [notes, setNotes] = useLocalStore('general_notes', [])
  const [openId, setOpenId] = useState(null)
  const [moved, setMoved] = useState('')
  const { jobsHub, jobOptions } = useJobOptions()

  async function moveToJob(note, job) {
    const entry = generalToJobNote(note)
    await jobsHub.updateRecord(job.id, cur => ({ notesLog: [entry, ...((cur && cur.notesLog) || [])] }))
    setNotes(list => list.filter(n => n.id !== note.id))
    if (openId === note.id) setOpenId(null)
    setMoved(`✓ “${note.title || 'Note'}” moved to ${job.customerName} — ${job.name} → Notes.`)
  }

  function addNote(title) {
    const id = uid()
    setNotes(list => [...list, { id, title, content: '', updatedAt: new Date().toISOString() }])
    setOpenId(id)
  }
  function updateNote(id, patch) {
    setNotes(list => list.map(n => n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n))
  }
  function deleteNote(id) {
    setNotes(list => list.filter(n => n.id !== id))
    if (openId === id) setOpenId(null)
  }

  const openNote = notes.find(n => n.id === openId)

  if (openNote) {
    return (
      <GeneralNoteDetail
        note={openNote}
        onUpdateTitle={v => updateNote(openNote.id, { title: v })}
        onUpdateContent={v => updateNote(openNote.id, { content: v })}
        onRemoveEntry={entry => updateNote(openNote.id, removeMiscEntry(openNote, entry))}
        onBack={() => setOpenId(null)}
        onMove={j => moveToJob(openNote, j)} jobOptions={jobOptions}
      />
    )
  }
  return (
    <>
      {moved && <div style={{ margin: '12px 16px 0', padding: '7px 12px', borderRadius: 6, background: '#eef8f1', border: '1px solid #9fd3ae', color: '#1e7a34', fontSize: 12.5, display: 'flex' }}>
        <span style={{ flex: 1 }}>{moved}</span><button onClick={() => setMoved('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#1e7a34' }}>✕</button></div>}
      <GeneralNotesList notes={notes} onOpen={setOpenId} onAdd={addNote} onDelete={deleteNote} onMove={moveToJob} jobOptions={jobOptions} />
    </>
  )
}

export default function Notes({ navigate }) {
  const [tab, setTab] = useState('daily')
  const { active: flagged } = useFlags()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px 4px' }}>
        <button
          onClick={() => setTab('daily')}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: tab === 'daily' ? 'none' : '1px solid var(--border)',
            background: tab === 'daily' ? 'var(--accent)' : 'var(--surface)',
            color: tab === 'daily' ? 'var(--navy)' : 'var(--text-mid)',
          }}
        >
          Daily Notes
        </button>
        <button
          onClick={() => setTab('general')}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: tab === 'general' ? 'none' : '1px solid var(--border)',
            background: tab === 'general' ? 'var(--accent)' : 'var(--surface)',
            color: tab === 'general' ? 'var(--navy)' : 'var(--text-mid)',
          }}
        >
          General Notes
        </button>
        <button
          onClick={() => setTab('flagged')}
          style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: tab === 'flagged' ? 'none' : '1px solid ' + (flagged.length ? '#c0392b' : 'var(--border)'),
            background: tab === 'flagged' ? '#c0392b' : 'var(--surface)',
            color: tab === 'flagged' ? '#fff' : flagged.length ? '#c0392b' : 'var(--text-mid)',
          }}
        >
          ⚑ Flagged{flagged.length ? ` (${flagged.length})` : ''}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'daily' ? <DailyNotesView /> : tab === 'flagged' ? <div style={{ padding: 16, maxWidth: 1000 }}><FlaggedList navigate={navigate} /></div> : <GeneralNotesView />}
      </div>
    </div>
  )
}
