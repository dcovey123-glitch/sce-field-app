import React, { useState, useEffect, useCallback } from 'react'
import { linkedQuotesCustomer } from '../api/sharedCustomer.js'
import { useHubStore } from '../api/useHubStore.js'
import { FileTile, IMAGE_EXTS, extOf } from '../components/FileAttachments.jsx'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'

// Popup window: every photo / document attached to any of a customer's jobs or
// quotes, grouped under Jobs and Quotes headers, then by job / quote name, with
// a search box that matches job/quote names and file names.
const PHOTO_EXTS = [...IMAGE_EXTS, 'heic']
function docIcon(name) {
  const ext = extOf(name)
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['txt', 'md'].includes(ext)) return '🗒️'
  return '📎'
}
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export default function CustomerFilesWindow({ customerId, initialKind }) {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const [kind, setKind] = useState(initialKind === 'documents' ? 'documents' : 'photos')
  const [search, setSearch] = useState('')
  const [allFiles, setAllFiles] = useState(null) // { jobs: [{key,name,files:[]}], quotes: [...] } — every file, unfiltered

  const customer = jobsHub.customers.find(c => c.id === customerId)
  const quotesCustomer = linkedQuotesCustomer(customer, quotesHub.customers)

  const load = useCallback(async () => {
    if (jobsHub.loading || quotesHub.loading || !customer) return
    if (!window.desktop) { setAllFiles({ jobs: [], quotes: [] }); return }
    const jobs = jobsHub.records.filter(p => p.customerId === customerId && !p.trashedAt)
    const quotes = quotesCustomer ? quotesHub.records.filter(q => q.customerId === quotesCustomer.id && !q.trashedAt) : []
    async function collect(items, folderFor, nameFor) {
      const out = []
      for (const r of items) {
        let files = []
        try { files = (await window.desktop.listFiles(folderFor(r))) || [] } catch { files = [] }
        if (files.length) out.push({ key: r.id, name: nameFor(r), files: files.sort(byName) })
      }
      return out.sort(byName)
    }
    const j = await collect(jobs, p => `Jobs/${customer.folder}/${p.folder}/Files`, p => p.name || 'Untitled job')
    const q = quotesCustomer
      ? await collect(quotes, x => `Quotes/${quotesCustomer.folder}/${x.folder}/Files`, x => x.title ? `${x.quoteNumber} - ${x.title}` : (x.quoteNumber || 'Untitled quote'))
      : []
    setAllFiles({ jobs: j, quotes: q })
  }, [jobsHub.loading, quotesHub.loading, jobsHub.records, quotesHub.records, customer, customerId, quotesCustomer])

  useEffect(() => { load() }, [load])

  if (jobsHub.loading || quotesHub.loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
  if (!customer) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Customer not found.</div>

  const isPhoto = f => PHOTO_EXTS.includes(extOf(f.name))
  const term = search.trim().toLowerCase()

  function view(list) {
    const out = []
    for (const g of list || []) {
      let files = g.files.filter(f => kind === 'photos' ? isPhoto(f) : !isPhoto(f))
      if (term && !g.name.toLowerCase().includes(term)) files = files.filter(f => f.name.toLowerCase().includes(term))
      if (files.length) out.push({ ...g, files })
    }
    return out
  }
  const jobGroups = view(allFiles?.jobs)
  const quoteGroups = view(allFiles?.quotes)
  const total = [...jobGroups, ...quoteGroups].reduce((n, g) => n + g.files.length, 0)

  function Block({ title, list }) {
    return (
      <div style={{ padding: '14px 20px 4px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mid)', marginBottom: 8 }}>{title}</div>
        {list.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-light)', padding: '2px 0 10px' }}>{term ? 'No matches.' : 'None.'}</div>}
        {list.map(g => (
          <div key={g.key} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              {g.name} <span style={{ fontWeight: 400, color: 'var(--text-light)' }}>({g.files.length})</span>
            </div>
            {kind === 'photos' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {g.files.map(f => (
                  <FileTile
                    key={f.path} file={f}
                    onOpen={() => window.desktop.openFile(f.path)}
                    onRemove={async () => { await window.desktop.removeFile(f.path); load() }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'visible' }}>
                {g.files.map((f, i) => (
                  <div
                    key={f.path} onClick={() => window.desktop.openFile(f.path)} title="Open"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: 'var(--surface)', borderTop: i ? '1px solid var(--border)' : 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)' }}
                  >
                    <span style={{ fontSize: 17, flexShrink: 0 }}>{docIcon(f.name)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>{f.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', flexShrink: 0 }}>{extOf(f.name)}</span>
                    <ConfirmDeleteButton
                      onConfirm={async () => { await window.desktop.removeFile(f.path); load() }}
                      ariaLabel="Remove file" confirmText={`Remove "${f.name}"? This can't be undone.`}
                      style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--red)', color: '#fff', border: 'none', fontSize: 12, lineHeight: '20px', cursor: 'pointer', padding: 0 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const tabStyle = active => ({
    padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', borderRadius: 20,
    border: '1px solid var(--border)', background: active ? 'var(--navy, #1d3557)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--text-mid)',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 20px' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          {customer.name} — {kind === 'photos' ? 'Photos' : 'Documents'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={tabStyle(kind === 'photos')} onClick={() => setKind('photos')}>Photos</button>
          <button style={tabStyle(kind === 'documents')} onClick={() => setKind('documents')}>Documents</button>
          <input
            autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search job, quote or file name…"
            style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface-2)', color: 'var(--text)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ ...tabStyle(false), padding: '7px 12px' }}>Clear</button>
          )}
        </div>
        {allFiles && <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 8 }}>{total} {total === 1 ? 'file' : 'files'}{term ? ` matching "${search.trim()}"` : ''}</div>}
      </div>
      {!allFiles
        ? <div style={{ padding: '20px', fontSize: 12, color: 'var(--text-light)' }}>Loading files…</div>
        : <div style={{ paddingBottom: 20 }}>
            <Block title="Jobs" list={jobGroups} />
            <Block title="Quotes" list={quoteGroups} />
          </div>}
    </div>
  )
}
