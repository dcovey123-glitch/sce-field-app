import React from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { effectiveLifecycleStatus, DeficiencyRow, daysSince } from './Jobs.jsx'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export default function DeficienciesWindow({ customerId }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })

  if (jobsHub.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
  }
  const customer = jobsHub.customers.find(c => c.id === customerId)
  if (!customer) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Customer not found.</div>
  }

  const deficientProjects = jobsHub.records
    .filter(p => p.customerId === customerId && !p.trashedAt && effectiveLifecycleStatus(p) === 'deficiencies')
    .sort((a, b) => (b.dateComplete || '').localeCompare(a.dateComplete || ''))

  function updateProject(id, patch) {
    jobsHub.updateRecord(id, patch)
  }
  function addDeficiency(project, text) {
    const entry = { id: uid(), text, resolved: false, createdAt: new Date().toISOString() }
    updateProject(project.id, { deficiencies: [...(project.deficiencies || []), entry] })
  }

  const totalOpen = deficientProjects.reduce((s, p) => s + (p.deficiencies || []).filter(d => !d.resolved).length, 0)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <div style={{ padding: '14px 18px', background: 'var(--navy)' }}>
        <span style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700, color: '#fff' }}>
          Deficiencies — {customer.name}
        </span>
      </div>
      <div style={{ padding: '12px 18px 0', fontSize: 12, color: 'var(--text-light)' }}>
        {deficientProjects.length} project{deficientProjects.length === 1 ? '' : 's'} · {totalOpen} open item{totalOpen === 1 ? '' : 's'}
      </div>

      {deficientProjects.length === 0 && (
        <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          Nothing here — no projects currently marked Complete w/ Deficiencies for this customer.
        </div>
      )}

      {deficientProjects.map(project => {
        const openDefs = (project.deficiencies || []).filter(d => !d.resolved)
        const oldestAge = openDefs.length > 0 ? Math.max(...openDefs.map(d => daysSince(d.createdAt))) : 0
        return (
          <div key={project.id} style={{ margin: '14px 16px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#fff8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{project.name || 'Untitled job'}</div>
                <div style={{ fontSize: 11, color: '#9a6610' }}>
                  {project.dateComplete ? `Completed ${new Date(project.dateComplete).toLocaleDateString()}` : ''}
                </div>
              </div>
              {openDefs.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: oldestAge >= 14 ? 'var(--red)' : '#9a6610' }}>
                  {openDefs.length} open — oldest {oldestAge}d
                </span>
              )}
            </div>
            {(project.deficiencies || []).map(d => (
              <DeficiencyRow
                key={d.id} item={d}
                onUpdate={patch => updateProject(project.id, { deficiencies: project.deficiencies.map(x => x.id === d.id ? { ...x, ...patch } : x) })}
                onDelete={() => updateProject(project.id, { deficiencies: project.deficiencies.filter(x => x.id !== d.id) })}
              />
            ))}
            <AddDeficiencyInline onAdd={text => addDeficiency(project, text)} />
          </div>
        )
      })}
    </div>
  )
}

function AddDeficiencyInline({ onAdd }) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  function submit() {
    if (!text.trim()) return
    onAdd(text.trim())
    setText(''); setOpen(false)
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>
        + Add deficiency
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
      <input
        autoFocus value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        placeholder="Describe the deficiency…"
        style={{ flex: 1, fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontFamily: 'var(--font)' }}
      />
      <button onClick={submit} style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '0 14px', cursor: 'pointer' }}>Add</button>
    </div>
  )
}
