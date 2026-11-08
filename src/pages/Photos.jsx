import React, { useState, useEffect } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import FileAttachments, { IMAGE_EXTS, extOf } from '../components/FileAttachments.jsx'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

function JobPhotosSection({ project, customerName, folderPath }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setExpanded(x => !x)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px',
          background: 'var(--surface)', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 18 18" fill="none" style={{ color: 'var(--text-light)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{customerName} — {project.name || 'Untitled job'}</span>
      </button>
      {expanded && <FileAttachments folderPath={folderPath} imageOnly />}
    </div>
  )
}

export default function Photos() {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [jobsWithPhotos, setJobsWithPhotos] = useState([])
  const [scanning, setScanning] = useState(true)

  useEffect(() => {
    if (jobsHub.loading || !isDesktop) { setScanning(false); return }
    let cancelled = false
    async function scan() {
      setScanning(true)
      const results = []
      for (const p of jobsHub.records.filter(x => !x.trashedAt)) {
        const customer = jobsHub.customers.find(c => c.id === p.customerId)
        if (!customer) continue
        const folderPath = `Jobs/${customer.folder}/${p.folder}/Files`
        try {
          const files = await window.desktop.listFiles(folderPath)
          const hasPhotos = (files || []).some(f => IMAGE_EXTS.includes(extOf(f.name)))
          if (hasPhotos) results.push({ project: p, customerName: customer.name, folderPath })
        } catch { /* folder may not exist yet — just skip it */ }
      }
      if (!cancelled) { setJobsWithPhotos(results); setScanning(false) }
    }
    scan()
    return () => { cancelled = true }
  }, [jobsHub.loading, jobsHub.records, jobsHub.customers])

  return (
    <div>
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Photos</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 2 }}>
          General Pictures below aren't tied to a specific job. Photos taken for a job — from your phone or added here — show up grouped under that job further down.
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '12px 16px 4px', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface-2)' }}>
          General Pictures
        </div>
        <FileAttachments folderPath="Photos/General" imageOnly />
      </div>

      {scanning && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Looking through jobs for photos…</div>
      )}
      {!scanning && jobsWithPhotos.length === 0 && (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>No job photos yet.</div>
      )}
      {!scanning && jobsWithPhotos.map(({ project, customerName, folderPath }) => (
        <JobPhotosSection key={project.id} project={project} customerName={customerName} folderPath={folderPath} />
      ))}
    </div>
  )
}
