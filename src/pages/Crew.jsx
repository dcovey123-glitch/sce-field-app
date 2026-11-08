import React, { useState } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useCrewRoster, renameEverywhere, countUsage, ROLES } from '../api/crewRoster.js'

// Crew roster: the one list of people the rest of the app picks from
// (Time Tracking, Timesheets, receipts, and later the phone crew clock).

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)', background: '#fff' }
const smallBtn = { padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: 'var(--text-mid)', whiteSpace: 'nowrap' }

function PersonRow({ person, others, onUpdate, onRename, onMerge, onDelete }) {
  const [name, setName] = useState(person.name)
  const [busy, setBusy] = useState(false)
  const [merging, setMerging] = useState(false)
  const inactive = person.active === false

  async function commitName() {
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n) { setName(person.name); return }
    if (n === person.name) return
    if (others.some(o => o.name.toLowerCase() === n.toLowerCase())) {
      alert(`${n} is already on the crew list. Use "Merge into…" if they're the same person.`)
      setName(person.name); return
    }
    setBusy(true)
    try { await onRename(n) } finally { setBusy(false) }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 8, opacity: inactive ? 0.65 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={commitName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={busy} aria-label="Name" style={{ ...inputStyle, flex: '1 1 180px', fontWeight: 700 }} />
        <select value={person.role || ''} onChange={e => onUpdate({ role: e.target.value })} aria-label="Role" style={{ ...inputStyle, flex: '0 0 140px' }}>
          <option value="">Role…</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input value={person.phone || ''} onChange={e => onUpdate({ phone: e.target.value })} placeholder="Phone (optional)" aria-label="Phone"
          style={{ ...inputStyle, flex: '0 1 150px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: person.isMe ? 'var(--navy)' : 'var(--text-mid)', fontWeight: person.isMe ? 700 : 400 }}
          title="Your own hours (the 'Your hours' and Unaccounted boxes on Time Tracking) come from this person">
          <input type="radio" name="crew-me" checked={!!person.isMe} onChange={() => onUpdate({ isMe: true })} /> This is me
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--text-mid)' }}
          title="Inactive people are hidden from pickers. Their old hours stay.">
          <input type="checkbox" checked={!inactive} onChange={e => onUpdate({ active: e.target.checked })} /> Active
        </label>
        <div style={{ flex: 1 }} />
        {busy && <span style={{ color: 'var(--text-light)' }}>Updating old entries…</span>}
        {merging ? (
          <>
            <select defaultValue="" onChange={async e => { const id = e.target.value; if (!id) return; setBusy(true); try { await onMerge(id) } finally { setBusy(false); setMerging(false) } }}
              style={{ ...inputStyle, fontSize: 12 }} aria-label="Merge into">
              <option value="">Merge {person.name} into…</option>
              {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button style={smallBtn} onClick={() => setMerging(false)}>Cancel</button>
          </>
        ) : (
          others.length > 0 && <button style={smallBtn} onClick={() => setMerging(true)} title="Same person entered twice? Fold this one into the other.">Merge into…</button>
        )}
        {!person.isMe && <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#e0a0a0' }} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  )
}

export default function Crew() {
  const crew = useCrewRoster()
  const [newName, setNewName] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })

  const activePeople = crew.people.filter(p => p.active !== false)
  const inactivePeople = crew.people.filter(p => p.active === false)

  function add() {
    const n = newName.trim()
    if (!n) return
    const existing = crew.findByName(n)
    if (existing && existing.active !== false) { alert(`${existing.name} is already on the crew list.`); return }
    crew.addPerson(n)
    setNewName('')
  }

  async function rename(person, newN) {
    const uses = countUsage(person.name, jobsStore)
    if (uses > 0 && !window.confirm(`Rename ${person.name} to ${newN}?\n\nTheir name will also be updated on ${uses} saved timesheet/time entr${uses === 1 ? 'y' : 'ies'} so their history stays together.`)) return
    crew.updatePerson(person.id, { name: newN })
    await renameEverywhere(person.name, newN, jobsStore)
  }

  async function merge(person, intoId) {
    const into = crew.roster.find(p => p.id === intoId)
    if (!into) return
    const uses = countUsage(person.name, jobsStore)
    if (!window.confirm(`Merge ${person.name} into ${into.name}?\n\n${uses} saved entr${uses === 1 ? 'y' : 'ies'} under ${person.name} will be moved to ${into.name}, and ${person.name} will be removed from the crew list. This can't be undone.`)) return
    await renameEverywhere(person.name, into.name, jobsStore)
    if (person.isMe) crew.updatePerson(into.id, { isMe: true })
    crew.removePerson(person.id)
  }

  function remove(person) {
    const uses = countUsage(person.name, jobsStore)
    if (uses > 0) {
      if (window.confirm(`${person.name} has ${uses} saved timesheet/time entr${uses === 1 ? 'y' : 'ies'}, so they can't be deleted without losing track of who those hours belong to.\n\nMark them inactive instead? (Hidden from pickers, history kept.)`)) {
        crew.updatePerson(person.id, { active: false })
      }
      return
    }
    if (window.confirm(`Delete ${person.name} from the crew list?`)) crew.removePerson(person.id)
  }

  const row = p => (
    <PersonRow key={p.id + '|' + p.name} person={p}
      others={crew.people.filter(o => o.id !== p.id)}
      onUpdate={patch => crew.updatePerson(p.id, patch)}
      onRename={n => rename(p, n)}
      onMerge={id => merge(p, id)}
      onDelete={() => remove(p)}
    />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', padding: '14px 16px' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700 }}>👷 Crew</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
          The people you pick from on Time Tracking, Timesheets and receipts.
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 760 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Add someone — full name" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={add} disabled={!newName.trim()}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: newName.trim() ? 'pointer' : 'default', background: 'var(--accent)', color: 'var(--navy)', opacity: newName.trim() ? 1 : 0.5 }}>
            Add
          </button>
        </div>

        {!crew.me && (
          <div style={{ fontSize: 12, color: '#8a5d00', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
            Tick "This is me" on your own name so Time Tracking knows which hours are yours.
          </div>
        )}

        {activePeople.map(row)}
        {activePeople.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-light)', padding: 12 }}>No active crew. Add someone above.</div>}

        {inactivePeople.length > 0 && (
          <>
            <button onClick={() => setShowInactive(s => !s)} style={{ ...smallBtn, marginTop: 10, marginBottom: 8 }}>
              {showInactive ? '▾' : '▸'} Inactive ({inactivePeople.length})
            </button>
            {showInactive && inactivePeople.map(row)}
          </>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 14, lineHeight: 1.5 }}>
          Renaming someone also updates their name on saved timesheets and time entries. Merge folds a duplicate (e.g. "Kyle" and "Kyle M.") into one person.
          People with saved hours can't be deleted — mark them inactive instead.
        </div>
      </div>
    </div>
  )
}
