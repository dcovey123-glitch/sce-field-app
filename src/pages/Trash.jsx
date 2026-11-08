import React, { useState, useEffect } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'

const PURGE_AFTER_DAYS = 30

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function typeLabel(type) {
  const labels = {
    job_project: 'Job', job_customer: 'Customer (Jobs)', quote: 'Quote', quote_customer: 'Customer (Quotes)',
    catalog_item: 'Catalog item', stock_item: 'Stock item', order: 'Material order', cable_section: 'Cable section',
  }
  return labels[type] || type
}

export default function Trash() {
  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const [trashBin, setTrashBin] = useLocalStore('trash_bin_items', [])
  const [, setCatalog] = useLocalStore('material_catalog', [])
  const [, setStock] = useLocalStore('material_stock', [])
  const [, setOrders] = useLocalStore('material_orders', [])
  const [, setCableSections] = useLocalStore('cable_tracker_sections', [])
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const [restoredMsg, setRestoredMsg] = useState('')

  const storesLoading = jobsStore.loading || quotesStore.loading

  // Build one unified list across every trashed thing, whatever storage it actually lives in.
  const items = []
  if (!storesLoading) {
    jobsStore.records.filter(p => p.trashedAt).forEach(p => items.push({ id: p.id, type: 'job_project', label: p.name || 'Untitled job', deletedAt: p.trashedAt }))
    jobsStore.customers.filter(c => c.trashedAt).forEach(c => items.push({ id: c.id, type: 'job_customer', label: c.name || 'Untitled customer', deletedAt: c.trashedAt }))
    quotesStore.records.filter(q => q.trashedAt).forEach(q => items.push({ id: q.id, type: 'quote', label: `${q.quoteNumber || ''} — ${q.title || 'Untitled quote'}`, deletedAt: q.trashedAt }))
    quotesStore.customers.filter(c => c.trashedAt).forEach(c => items.push({ id: c.id, type: 'quote_customer', label: c.name || 'Untitled customer', deletedAt: c.trashedAt }))
  }
  trashBin.forEach(t => items.push({ id: t.id, type: t.type, label: t.label, deletedAt: t.deletedAt }))
  items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))

  function purgeMaterialsTrashItems(entries) {
    entries.forEach(t => {
      if (t.type === 'catalog_item') setCatalog(list => list.filter(i => i.id !== t.payload.id))
      if (t.type === 'stock_item') setStock(list => list.filter(i => i.id !== t.payload.id))
      if (t.type === 'order') setOrders(list => list.filter(i => i.id !== t.payload.id))
      if (t.type === 'cable_section') setCableSections(list => list.filter(i => i.id !== t.payload.id))
    })
  }

  // Auto-purge anything past the window, quietly, once stores are ready.
  useEffect(() => {
    if (storesLoading) return
    jobsStore.records.filter(p => p.trashedAt && daysSince(p.trashedAt) > PURGE_AFTER_DAYS).forEach(p => jobsStore.deleteRecord(p.id))
    jobsStore.customers.filter(c => c.trashedAt && daysSince(c.trashedAt) > PURGE_AFTER_DAYS).forEach(c => jobsStore.deleteCustomer(c.id))
    quotesStore.records.filter(q => q.trashedAt && daysSince(q.trashedAt) > PURGE_AFTER_DAYS).forEach(q => quotesStore.deleteRecord(q.id))
    quotesStore.customers.filter(c => c.trashedAt && daysSince(c.trashedAt) > PURGE_AFTER_DAYS).forEach(c => quotesStore.deleteCustomer(c.id))
    const expired = trashBin.filter(t => daysSince(t.deletedAt) > PURGE_AFTER_DAYS)
    if (expired.length > 0) {
      purgeMaterialsTrashItems(expired)
      const expiredIds = expired.map(t => t.id)
      setTrashBin(list => list.filter(t => !expiredIds.includes(t.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storesLoading])

  function restore(item) {
    if (item.type === 'job_project') jobsStore.updateRecord(item.id, { trashedAt: null })
    else if (item.type === 'job_customer') jobsStore.updateCustomer(item.id, { trashedAt: null })
    else if (item.type === 'quote') quotesStore.updateRecord(item.id, { trashedAt: null })
    else if (item.type === 'quote_customer') quotesStore.updateCustomer(item.id, { trashedAt: null })
    else {
      const entry = trashBin.find(t => t.id === item.id)
      if (!entry) return
      if (entry.type === 'catalog_item') setCatalog(list => [...list, entry.payload])
      if (entry.type === 'stock_item') setStock(list => [...list, entry.payload])
      if (entry.type === 'order') setOrders(list => [...list, entry.payload])
      if (entry.type === 'cable_section') setCableSections(list => [...list, entry.payload])
      setTrashBin(list => list.filter(t => t.id !== item.id))
    }
    setRestoredMsg(`Restored "${item.label}".`)
    setTimeout(() => setRestoredMsg(''), 3000)
  }

  function deletePermanently(item) {
    if (item.type === 'job_project') jobsStore.deleteRecord(item.id)
    else if (item.type === 'job_customer') jobsStore.deleteCustomer(item.id)
    else if (item.type === 'quote') quotesStore.deleteRecord(item.id)
    else if (item.type === 'quote_customer') quotesStore.deleteCustomer(item.id)
    else {
      const entry = trashBin.find(t => t.id === item.id)
      if (entry) purgeMaterialsTrashItems([entry])
      setTrashBin(list => list.filter(t => t.id !== item.id))
    }
  }

  function emptyTrash() {
    items.forEach(deletePermanently)
    setConfirmingEmpty(false)
  }

  if (storesLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Trash</div>
        {items.length > 0 && (
          <button
            onClick={() => setConfirmingEmpty(true)}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 'var(--rs)', padding: '6px 12px', cursor: 'pointer' }}
          >
            Empty trash
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 16 }}>
        Deleted jobs, quotes, customers, catalog and stock items, orders, and cable sections land here for 30 days before
        they're gone for good — plenty of time to catch a mistake.
      </div>

      {restoredMsg && <div style={{ fontSize: 12, color: '#1e7a34', marginBottom: 12 }}>{restoredMsg}</div>}

      {confirmingEmpty && (
        <div style={{ padding: 12, background: '#fdf0f0', border: '1px solid var(--red)', borderRadius: 'var(--rs)', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8, fontWeight: 600 }}>
            Permanently delete all {items.length} item{items.length === 1 ? '' : 's'} in Trash? This can't be undone.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmingEmpty(false)} style={{ flex: 1, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={emptyTrash} style={{ flex: 1, padding: 8, background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Empty trash
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Trash is empty.</div>
      )}

      {items.map(item => {
        const remaining = Math.max(0, PURGE_AFTER_DAYS - daysSince(item.deletedAt))
        return (
          <div key={`${item.type}-${item.id}`} style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{typeLabel(item.type)} · {remaining} day{remaining === 1 ? '' : 's'} left</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => restore(item)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: '1px solid var(--accent)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }}>
                Restore
              </button>
              <button onClick={() => deletePermanently(item)} style={{ fontSize: 11, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }}>
                Delete now
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
