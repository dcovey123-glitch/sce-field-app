// The big lists live in their own files in the data folder
// ("App Data/<name>.json"), not in the app's internal storage (which holds
// about 5 MB and is easy to lose with the PC). Everything else stays in
// internal storage, copied to "App Data/app-storage.json" as before.
//
// How it works: at start-up every file is read into memory before the app
// draws, so reads stay instant. A change updates memory at once and is
// written to its file a moment later (and right away when the window closes).
// Other open windows are told, so they never hold a stale copy.
//
// Moving over (first start with this version, or an old backup restored):
// a list with no file yet is taken from internal storage, written to its file,
// read back to check, and only then removed from internal storage.

// Which lists have their own file: marked file: true in settings.js
import { FILE_KEYS } from './settings.js'
export { FILE_KEYS }
const FILE_SET = new Set(FILE_KEYS)
const PREFIX = 'fieldapp_'

const cache = new Map() // key → JSON text (exactly what's in the file)
let active = false // files in use (desktop app with a data folder)
const pending = new Map() // key → timer
const damaged = new Set() // files that couldn't be read — left alone
const WRITE_DELAY = 400

export const isFileKey = key => active && FILE_SET.has(key) && !damaged.has(key)
export const fileStoreActive = () => active

function failed(key, err) {
  try { window.dispatchEvent(new CustomEvent('fieldapp-save-failed', { detail: { key, message: String((err && err.message) || err || 'could not write the file') } })) } catch { /* ignore */ }
}

// Raw JSON text for a key, or null
export function readRaw(key) {
  if (isFileKey(key)) return cache.has(key) ? cache.get(key) : null
  try { return localStorage.getItem(PREFIX + key) } catch { return null }
}

export function readValue(key, fallback) {
  try { const raw = readRaw(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}

// Save a value. Throws if internal storage refuses it (caller shows the banner).
export function writeValue(key, value) {
  const text = JSON.stringify(value)
  if (isFileKey(key)) {
    cache.set(key, text)
    clearTimeout(pending.get(key))
    pending.set(key, setTimeout(() => flushKey(key), WRITE_DELAY))
    return
  }
  localStorage.setItem(PREFIX + key, text)
}

async function flushKey(key) {
  pending.delete(key)
  const text = cache.get(key)
  if (text == null) return
  try {
    const ok = await window.desktop.appFileSave(key, text)
    if (ok === false) failed(key, 'The data folder could not be written')
  } catch (err) { failed(key, err) }
}

// Window closing: write anything still waiting, synchronously
function flushAllNow() {
  for (const [key, t] of pending) {
    clearTimeout(t)
    try { window.desktop.appFileSaveSync(key, cache.get(key)) } catch { /* closing */ }
  }
  pending.clear()
}

// Every key's text, for the snapshot / backups summary (file keys excluded —
// they're already files in the data folder)
export function nonFileKeys(keys) { return keys.filter(k => !FILE_SET.has(k) || damaged.has(k)) }

// Run at start-up, after the internal-storage snapshot is restored and before
// the app draws.
export async function initFileStore() {
  const d = typeof window !== 'undefined' && window.desktop
  if (!d || !d.appFileLoadAll || !d.appFileSave) return
  let files
  try {
    const root = await d.getDataRoot()
    if (!root) return
    files = await d.appFileLoadAll(FILE_KEYS)
  } catch { return }
  if (!files || typeof files !== 'object') return

  for (const key of FILE_KEYS) {
    const inFile = files[key]
    if (inFile && typeof inFile === 'object' && inFile.damaged) {
      // the file and its previous copy are both unreadable — don't touch it;
      // this list keeps using internal storage until it's sorted out
      damaged.add(key)
      continue
    }
    let local = null
    try { local = localStorage.getItem(PREFIX + key) } catch { /* ignore */ }
    if (typeof inFile === 'string') {
      cache.set(key, inFile)
      if (local != null) { try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ } }
      continue
    }
    if (local == null) continue // nothing anywhere yet — a file is made on the first save
    // Move it: write, read back, compare, then drop the internal copy
    try {
      JSON.parse(local)
      const ok = await d.appFileSave(key, local)
      const back = ok === false ? null : (await d.appFileLoadAll([key]))[key]
      if (typeof back === 'string' && JSON.stringify(JSON.parse(back)) === JSON.stringify(JSON.parse(local))) {
        cache.set(key, back)
        localStorage.removeItem(PREFIX + key)
      } else {
        cache.set(key, local) // keep working from memory; the internal copy stays as a safety net
      }
    } catch {
      cache.set(key, local)
    }
  }
  active = true
  if (damaged.size) {
    setTimeout(() => window.dispatchEvent(new CustomEvent('fieldapp-save-failed', { detail: { key: [...damaged].join(', '), message: `Couldn't read ${[...damaged].join(', ')} from the data folder — those lists are on hold in this PC's storage. Your backups have them; ask Claude to help put them back.` } })), 1500)
  }

  // Another window changed a list: take its copy and let this window's hooks know
  if (d.onAppFileChanged) {
    d.onAppFileChanged((key, text) => {
      if (!FILE_SET.has(key) || typeof text !== 'string') return
      if (pending.has(key)) return // this window has a newer change on its way
      cache.set(key, text)
      window.dispatchEvent(new CustomEvent('fieldapp-local', { detail: { key, from: 'other-window' } }))
    })
  }
  window.addEventListener('beforeunload', flushAllNow)
}

// for tests
export function _resetForTests() { cache.clear(); damaged.clear(); pending.forEach(t => clearTimeout(t)); pending.clear(); active = false }
