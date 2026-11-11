import { useState, useEffect } from 'react'
import { useLocalStore } from './useLocalStore.js'
import { restoreLocalDataIfEmpty } from './localSnapshot.js'
import { setJobsSource } from './billing.js'
import { readValue } from './fileStore.js'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// A patch can be a plain object, or a function that receives the record as it
// is *right now* and returns the patch. Use the function form whenever the
// change is built from the record's current contents (adding/removing an item
// in a list), so a change made a moment ago elsewhere is never written over.
function resolvePatch(existing, patch) {
  return typeof patch === 'function' ? (patch(existing) || {}) : patch
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: ONE shared copy of every hub's data per window.
//
// Previously each component that called useHubStore kept its own private copy,
// so a save in one place (e.g. confirming time) wasn't seen by another (the
// "Confirmed for this day" list), and that other, older copy could later be
// written back to disk over the newer data. Now every caller reads and writes
// the same copy, writes are run one at a time in order, and other windows are
// told to reload when this one saves.
// ─────────────────────────────────────────────────────────────────────────────
const shared = {
  loaded: false,
  loading: false,
  needsFolder: false,
  hubs: {},            // hub -> { customers, records }
  listeners: new Set(),
  queue: Promise.resolve(),
  loadPromise: null,
}

function hubData(hub) {
  if (!shared.hubs[hub]) shared.hubs[hub] = { customers: [], records: [] }
  return shared.hubs[hub]
}

// Billing totals need the whole jobs list (combined sub-jobs count toward
// their main job) — point them at the shared copy.
setJobsSource(() => isDesktop ? hubData('jobs').records : (readValue('job_projects', []) || []))

function notify() {
  shared.listeners.forEach(fn => fn())
}

function setHub(hub, next) {
  shared.hubs[hub] = { ...hubData(hub), ...next }
  notify()
}

function applyLoadAll(all) {
  if (!all) return
  for (const hub of Object.keys(all)) {
    if (all[hub] && Array.isArray(all[hub].customers)) {
      shared.hubs[hub] = { customers: all[hub].customers || [], records: all[hub].records || [] }
    }
  }
}

async function loadEverything() {
  if (shared.loadPromise) return shared.loadPromise
  shared.loading = true
  notify()
  shared.loadPromise = (async () => {
    try {
      const root = await window.desktop.getDataRoot()
      if (!root) { shared.needsFolder = true; return }
      shared.needsFolder = false
      applyLoadAll(await window.desktop.loadAll())
      shared.loaded = true
    } finally {
      shared.loading = false
      shared.loadPromise = null
      notify()
    }
  })()
  return shared.loadPromise
}

// Re-read from disk once any queued writes have finished (so a reload can never
// show an older state than what this window just saved).
let reloadTimer = null
function scheduleReload() {
  if (!isDesktop) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(async () => {
    await shared.queue
    try {
      const all = await window.desktop.loadAll()
      if (all) { applyLoadAll(all); notify() }
    } catch { /* keep what we have */ }
  }, 150)
}

// Run writes strictly one after another, each seeing the result of the last.
function enqueue(task) {
  const run = shared.queue.then(task, task)
  shared.queue = run.catch(() => {})
  return run
}

if (isDesktop) {
  // Another window saved something — pick it up.
  window.desktop.onDataChanged?.(() => scheduleReload())
  // Files can also change outside the app (OneDrive, copying folders in) — check when this window comes back to the front.
  let lastFocus = 0
  window.addEventListener('focus', () => {
    if (!shared.loaded || Date.now() - lastFocus < 3000) return
    lastFocus = Date.now()
    scheduleReload()
  })
}

const desktopApi = {}
function makeDesktopApi(hub, recordFileName, getRecordFolderName) {
  const key = hub + '|' + recordFileName
  if (desktopApi[key]) {
    // keep the latest folder-name function the caller passed
    desktopApi[key]._getName.current = getRecordFolderName
    return desktopApi[key]
  }
  const nameRef = { current: getRecordFolderName }
  const d = () => hubData(hub)
  const findCustomer = id => d().customers.find(c => c.id === id)
  const findRecord = id => d().records.find(r => r.id === id)

  const api = {
    _getName: nameRef,
    chooseFolder: async () => {
      const root = await window.desktop.chooseDataRoot()
      if (!root) return
      if (await restoreLocalDataIfEmpty()) { window.location.reload(); return }
      await loadEverything()
    },

    addCustomer: data => enqueue(async () => {
      const customer = { id: uid(), ...data }
      const folder = await window.desktop.saveCustomer(hub, customer)
      const withFolder = { ...customer, folder }
      setHub(hub, { customers: [...d().customers, withFolder] })
      return withFolder
    }),

    updateCustomer: (id, patch) => enqueue(async () => {
      const existing = findCustomer(id)
      if (!existing) return
      const p = resolvePatch(existing, patch)
      let folder = existing.folder
      if (p.name && p.name !== existing.name) {
        folder = await window.desktop.renameCustomerFolder(hub, existing.folder, p.name)
      }
      const updated = { ...existing, ...p, folder }
      await window.desktop.saveCustomer(hub, updated)
      setHub(hub, {
        customers: d().customers.map(c => c.id === id ? updated : c),
        records: folder !== existing.folder
          ? d().records.map(r => r.customerId === id ? { ...r, customerFolder: folder } : r)
          : d().records,
      })
    }),

    deleteCustomer: id => enqueue(async () => {
      const existing = findCustomer(id)
      if (!existing) return
      await window.desktop.deleteCustomerFolder(hub, existing.folder)
      setHub(hub, {
        customers: d().customers.filter(c => c.id !== id),
        records: d().records.filter(r => r.customerId !== id),
      })
    }),

    addRecord: (customerId, data) => enqueue(async () => {
      const customer = findCustomer(customerId)
      if (!customer) return
      const record = { id: uid(), customerId, ...data }
      const folderName = nameRef.current(record)
      const folder = await window.desktop.saveRecord(hub, customer.folder, { ...record, folderName }, recordFileName)
      const withFolder = { ...record, folder, customerFolder: customer.folder }
      setHub(hub, { records: [...d().records, withFolder] })
      return withFolder
    }),

    updateRecord: (id, patch) => enqueue(async () => {
      const existing = findRecord(id)
      if (!existing) return
      const customer = findCustomer(existing.customerId)
      if (!customer) return
      const merged = { ...existing, ...resolvePatch(existing, patch) }
      let folder = existing.folder
      const newFolderName = nameRef.current(merged)
      const oldFolderName = nameRef.current(existing)
      if (newFolderName && newFolderName !== oldFolderName) {
        folder = await window.desktop.renameRecordFolder(hub, customer.folder, existing.folder, newFolderName)
      }
      const updated = { ...merged, folder, customerFolder: customer.folder }
      await window.desktop.saveRecord(hub, customer.folder, updated, recordFileName)
      setHub(hub, { records: d().records.map(r => r.id === id ? updated : r) })
      return updated
    }),

    deleteRecord: id => enqueue(async () => {
      const existing = findRecord(id)
      if (!existing) return
      const customer = findCustomer(existing.customerId)
      if (customer) await window.desktop.deleteRecordFolder(hub, customer.folder, existing.folder)
      setHub(hub, { records: d().records.filter(r => r.id !== id) })
    }),

    // Moves a record to a different customer entirely — physically relocates
    // its folder (files included), not just the customerId reference.
    moveRecordToCustomer: (id, newCustomerId) => enqueue(async () => {
      const existing = findRecord(id)
      if (!existing) return { ok: false, error: 'Record not found.' }
      const oldCustomer = findCustomer(existing.customerId)
      const newCustomer = findCustomer(newCustomerId)
      if (!oldCustomer || !newCustomer) return { ok: false, error: 'Customer not found.' }
      if (oldCustomer.id === newCustomer.id) return { ok: true }

      const result = await window.desktop.moveRecordToCustomer(hub, oldCustomer.folder, newCustomer.folder, existing.folder)
      if (!result.ok) return result

      const updated = { ...existing, customerId: newCustomer.id, folder: result.folder, customerFolder: newCustomer.folder }
      await window.desktop.saveRecord(hub, newCustomer.folder, updated, recordFileName)
      setHub(hub, { records: d().records.map(r => r.id === id ? updated : r) })
      return { ok: true }
    }),
  }
  desktopApi[key] = api
  return api
}

/**
 * useHubStore — manages a hub's Customers + Records (Jobs' projects, Quotes' quotes).
 *
 * On the desktop app: each customer is a real folder, each record is a subfolder
 * inside it (with its own "Files" folder for attachments), all under the data
 * folder the person picked. Renaming a customer/record renames its folder.
 * Every component in a window shares the same data (see `shared` above).
 *
 * In a browser (preview, testing, etc.): falls back to localStorage keys, which
 * useLocalStore already keeps in sync between components.
 *
 * `reloadOnFocus` is accepted for compatibility; the shared store always
 * refreshes on focus and when another window saves.
 */
// eslint-disable-next-line no-unused-vars
export function useHubStore({ hub, recordFileName, getRecordFolderName, customersKey, recordsKey, reloadOnFocus = false }) {
  const [, force] = useState(0)
  const [fbCustomers, setFbCustomers] = useLocalStore(customersKey, [])
  const [fbRecords, setFbRecords] = useLocalStore(recordsKey, [])

  useEffect(() => {
    if (!isDesktop) return
    const fn = () => force(n => n + 1)
    shared.listeners.add(fn)
    if (!shared.loaded && !shared.needsFolder) loadEverything()
    return () => { shared.listeners.delete(fn) }
  }, [])

  // ── Browser fallback: same shape, backed by localStorage, no folders ──
  if (!isDesktop) {
    return {
      loading: false, needsFolder: false, chooseFolder: () => {},
      customers: fbCustomers, records: fbRecords,
      addCustomer: (data) => {
        const c = { id: uid(), ...data }
        setFbCustomers(list => [...list, c])
        return c
      },
      updateCustomer: (id, patch) => setFbCustomers(list => list.map(c => c.id === id ? { ...c, ...resolvePatch(c, patch) } : c)),
      deleteCustomer: (id) => {
        setFbCustomers(list => list.filter(c => c.id !== id))
        setFbRecords(list => list.filter(r => r.customerId !== id))
      },
      addRecord: (customerId, data) => {
        const r = { id: uid(), customerId, ...data }
        setFbRecords(list => [...list, r])
        return r
      },
      updateRecord: (id, patch) => setFbRecords(list => list.map(r => r.id === id ? { ...r, ...resolvePatch(r, patch) } : r)),
      deleteRecord: (id) => setFbRecords(list => list.filter(r => r.id !== id)),
      moveRecordToCustomer: async (id, newCustomerId) => {
        setFbRecords(list => list.map(r => r.id === id ? { ...r, customerId: newCustomerId } : r))
        return { ok: true }
      },
    }
  }

  const api = makeDesktopApi(hub, recordFileName, getRecordFolderName)
  const data = hubData(hub)
  return {
    loading: !shared.loaded && !shared.needsFolder,
    needsFolder: shared.needsFolder,
    customers: data.customers,
    records: data.records,
    ...api,
  }
}
