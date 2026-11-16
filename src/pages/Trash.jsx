import React, { useState, useEffect } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { useAutoMode, useAutoSkip } from '../api/automations.js'
import AutoReview from '../components/AutoReview.jsx'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'

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

  // Past the 30 days: automation "Empty Trash after 30 days" (Ask first /
  // Automatic / Off). Ask = listed at the top for you to delete or keep.
  const [modePurge, setModePurge] = useAutoMode('trash-purge')
  const [keptPurge, addKeptPurge] = useAutoSkip('trash-purge')
  const purgeKey = it => `${it.type}:${it.id}:${it.deletedAt}`
  const expiredItems = storesLoading || modePurge === 'off' ? [] : items.filter(it => daysSince(it.deletedAt) > PURGE_AFTER_DAYS)
  const purgeAsk = modePurge === 'ask' ? expiredItems.filter(it => !keptPurge.has(purgeKey(it))).map(it => ({ key: purgeKey(it), text: `${typeLabel(it.type)}: ${it.label}`, sub: whatGoes(it) })) : []
  function purge(keys) {
    const pick = new Set(keys)
    expiredItems.filter(it => pick.has(purgeKey(it))).forEach(deletePermanently)
  }
  useEffect(() => {
    if (storesLoading || modePurge !== 'auto' || !expiredItems.length) return
    purge(expiredItems.map(purgeKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storesLoading, modePurge])

  // What deleting for good takes with it (customers: their whole folder)
  function whatGoes(item) {
    if (item.type === 'job_customer') {
      const n = jobsStore.records.filter(p => p.customerId === item.id).length
      return `deletes the customer's folder — ${n} job${n === 1 ? '' : 's'} and their files`
    }
    if (item.type === 'quote_customer') {
      const n = quotesStore.records.filter(q => q.customerId === item.id).length
      return `deletes the customer's quotes folder — ${n} quote${n === 1 ? '' : 's'} and their files`
    }
    if (item.type === 'job_project' || item.type === 'quote') return 'deletes its folder and files'
    return ''
  }

  // A customer is one customer on both sides (Jobs and Quotes): restoring
  // either side brings back its partner removed at the same time
  function partnerOf(item) {
    const mine = item.type === 'job_customer' ? jobsStore.customers.find(c => c.id === item.id) : quotesStore.customers.find(c => c.id === item.id)
    if (!mine) return null
    const key = mine.sharedId || mine.id
    const other = item.type === 'job_customer' ? quotesStore.customers : jobsStore.customers
    return other.find(c => c.trashedAt && (c.sharedId || c.id) === key) || null
  }

  function restore(item) {
    if (item.type === 'job_project') jobsStore.updateRecord(item.id, { trashedAt: null })
    else if (item.type === 'job_customer') {
      jobsStore.updateCustomer(item.id, { trashedAt: null })
      const q = partnerOf(item); if (q) quotesStore.updateCustomer(q.id, { trashedAt: null })
    }
    else if (item.type === 'quote') quotesStore.updateRecord(item.id, { trashedAt: null })
    else if (item.type === 'quote_customer') {
      quotesStore.updateCustomer(item.id, { trashedAt: null })
      const j = partnerOf(item); if (j) jobsStore.updateCustomer(j.id, { trashedAt: null })
    }
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
        Deleted jobs, quotes, customers, catalog and stock items, orders, and cable sections land here. After 30 days
        they're listed for you to delete for good or keep (see ⚙ Auto → Empty Trash after 30 days).
      </div>

      {restoredMsg && <div style={{ fontSize: 12, color: '#1e7a34', marginBottom: 12 }}>{restoredMsg}</div>}
      <AutoReview compact id="trash-purge" items={purgeAsk} mode={modePurge} onMode={setModePurge} onApply={purge} onSkip={addKeptPurge} applyLabel="Delete for good" />

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
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{typeLabel(item.type)} · {remaining > 0 ? `${remaining} day${remaining === 1 ? '' : 's'} left` : 'past 30 days'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => restore(item)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: '1px solid var(--accent)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }}>
                Restore
              </button>
              <ConfirmDeleteButton onConfirm={() => deletePermanently(item)} triggerLabel="Delete now" label="Delete" ariaLabel="Delete for good" popoverWidth={230}
                confirmText={`Delete "${item.label}" for good?${whatGoes(item) ? ' This ' + whatGoes(item) + '.' : ''} Can't be undone.`}
                style={{ fontSize: 11, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '5px 10px', cursor: 'pointer' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
