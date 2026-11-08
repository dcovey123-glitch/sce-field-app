// Keeps a copy of the app's internal storage (materials, timesheets, notes,
// non-job time, to-dos, trash, settings…) inside the data folder as
// "App Data/app-storage.json", so it's included in every backup and comes back
// after a reinstall, a new PC, or restoring a backup.
//
// Secrets (the AI key and the cloud upload key) stay on this PC only and are
// never written into the data folder.

const PREFIX = 'fieldapp_'
const SECRET_KEYS = new Set(['anthropic_api_key', 'cloud_sync_upload_key'])
const EMPTY_VALUES = new Set(['', '[]', '{}', 'null', '""', 'false', '0'])

const isDesktop = typeof window !== 'undefined' && !!window.desktop
let enabled = false
let timer = null

function ourKeys() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(PREFIX) && !SECRET_KEYS.has(k.slice(PREFIX.length))) keys.push(k)
  }
  return keys
}

function collect() {
  const out = {}
  for (const k of ourKeys()) out[k.slice(PREFIX.length)] = localStorage.getItem(k)
  return out
}

// Does this PC already hold real data (not just empty lists / defaults)?
function hasRealData() {
  try {
    return ourKeys().some(k => !EMPTY_VALUES.has((localStorage.getItem(k) || '').trim()))
  } catch {
    return true // if storage can't be read, never overwrite it
  }
}

function apply(snapshot, { replace }) {
  const keys = snapshot && snapshot.keys
  if (!keys || typeof keys !== 'object') return false
  if (replace) ourKeys().forEach(k => localStorage.removeItem(k))
  for (const [k, v] of Object.entries(keys)) {
    if (SECRET_KEYS.has(k) || typeof v !== 'string') continue
    localStorage.setItem(PREFIX + k, v)
  }
  return true
}

function saveNow() {
  if (!enabled) return
  try {
    const json = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), keys: collect() })
    window.desktop.saveLocalSnapshot(json).catch(() => {})
  } catch { /* best effort */ }
}

// Called by useLocalStore after every change.
export function scheduleLocalSnapshot() {
  if (!enabled) return
  clearTimeout(timer)
  timer = setTimeout(saveNow, 1500)
}

// Run once at startup, before the app renders.
export async function initLocalSnapshot() {
  if (!isDesktop || !window.desktop.loadLocalSnapshot) return
  try {
    const root = await window.desktop.getDataRoot()
    if (!root) return // no data folder yet — handled after one is chosen
    const restoring = await window.desktop.takeLocalRestoreFlag()
    const snapshot = await window.desktop.loadLocalSnapshot()
    if (snapshot && (restoring || !hasRealData())) apply(snapshot, { replace: restoring })
    enabled = true
    saveNow()
  } catch { /* never block startup */ }
}

// After the person picks a data folder: if this PC is empty and the folder
// already has a snapshot (new PC / reinstall), load it. Returns true if the
// page should reload to pick the restored data up.
export async function restoreLocalDataIfEmpty() {
  if (!isDesktop || !window.desktop.loadLocalSnapshot) return false
  try {
    const snapshot = await window.desktop.loadLocalSnapshot()
    if (snapshot && !hasRealData() && apply(snapshot, { replace: false })) return true
    enabled = true
    saveNow()
  } catch { /* best effort */ }
  return false
}
