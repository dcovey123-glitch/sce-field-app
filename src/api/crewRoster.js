import { useCallback } from 'react'
import { useLocalStore } from './useLocalStore.js'
import { scheduleLocalSnapshot } from './localSnapshot.js'
import { readValue, writeValue, isFileKey } from './fileStore.js'

// ── Crew roster ──────────────────────────────────────────────────────
// One list of people used everywhere a worker name is picked: Time Tracking
// catch-up, Timesheets, receipt assigning, and later the phone crew clock.
//
// Person: { id, name, active, isMe, role, phone, createdAt }
//
// Time entries and timesheets still store the person's NAME (as they always
// have). Renaming or merging someone here rewrites that name in the stored
// data too, so their history never splits — see renameEverywhere().

export const ROSTER_KEY = 'crew_roster'
export const ROLES = ['Journeyman', 'Apprentice', 'Labourer', 'Other']
const DEFAULT_ME = 'Dustin Covey'

function uid() { return 'p' + Math.random().toString(36).slice(2, 10) }
const norm = s => (s || '').trim().replace(/\s+/g, ' ')
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase()

function readLS(key, fallback) {
  return readValue(key, fallback)
}
function writeLS(key, value) {
  try { writeValue(key, value); if (!isFileKey(key)) scheduleLocalSnapshot() } catch { /* ignore */ }
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('fieldapp-local', { detail: { key, from: 'crewRoster' } })))
}

// Names already used before the roster existed: Time Tracking's own list,
// then every worker on every saved timesheet week.
function collectLegacyNames() {
  const names = []
  const add = n => { const v = norm(n); if (v && !names.some(x => same(x, v))) names.push(v) }
  ;(readLS('time_workers', [DEFAULT_ME]) || []).forEach(add)
  const sheets = readLS('timesheets', {}) || {}
  Object.keys(sheets).sort().forEach(k => (sheets[k]?.workers || []).forEach(w => add(w?.name)))
  return names
}

// Build the roster the first time anything asks for it. Runs synchronously
// against localStorage so two screens opening at once can't both seed it
// (which would give the same person two different ids).
export function ensureRoster() {
  const existing = readLS(ROSTER_KEY, null)
  if (Array.isArray(existing)) return existing
  const names = collectLegacyNames()
  if (!names.length) names.push(DEFAULT_ME)
  const meName = names.find(n => same(n, DEFAULT_ME)) || names[0]
  const now = new Date().toISOString()
  const roster = names.map(name => ({ id: uid(), name, active: true, isMe: name === meName, role: '', phone: '', createdAt: now }))
  writeLS(ROSTER_KEY, roster)
  return roster
}

function sortPeople(list) {
  return list.slice().sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || a.name.localeCompare(b.name))
}

export function useCrewRoster() {
  const seeded = ensureRoster()
  const [stored, setRoster] = useLocalStore(ROSTER_KEY, seeded)
  const roster = Array.isArray(stored) ? stored : seeded

  const people = sortPeople(roster)
  const active = people.filter(p => p.active !== false)
  const me = roster.find(p => p.isMe) || null

  const findByName = useCallback(name => roster.find(p => same(p.name, name)) || null, [roster])

  // Add someone (or bring back an inactive person with the same name).
  // Returns the person — always, even if they were already on the roster.
  const addPerson = useCallback((name, extra = {}) => {
    const n = norm(name)
    if (!n) return null
    const current = readLS(ROSTER_KEY, roster) || roster
    const found = current.find(p => same(p.name, n))
    if (found) {
      if (found.active === false) setRoster(list => list.map(p => p.id === found.id ? { ...p, active: true } : p))
      return { ...found, active: true }
    }
    const person = { id: uid(), name: n, active: true, isMe: false, role: '', phone: '', createdAt: new Date().toISOString(), ...extra }
    setRoster(list => [...(Array.isArray(list) ? list : []), person])
    return person
  }, [roster, setRoster])

  // Patch one person. Only one person can be "me".
  const updatePerson = useCallback((id, patch) => {
    setRoster(list => list.map(p => {
      if (p.id === id) return { ...p, ...patch, ...(patch.name != null ? { name: norm(patch.name) } : {}) }
      if (patch.isMe) return { ...p, isMe: false }
      return p
    }))
  }, [setRoster])

  const removePerson = useCallback(id => {
    setRoster(list => list.filter(p => p.id !== id))
  }, [setRoster])

  return { roster, people, active, me, meName: me?.name || DEFAULT_ME, findByName, addPerson, updatePerson, removePerson, setRoster }
}

// Names to offer in a picker: active roster people (me first), plus anyone
// already on the record being edited even if they've since gone inactive.
export function pickerNames(active, alsoInclude = []) {
  const out = active.map(p => p.name)
  alsoInclude.forEach(n => { if (n && !out.some(x => same(x, n))) out.push(n) })
  return out
}

// Rewrite a person's name wherever it's stored, so a rename or merge keeps
// all their history together. jobsStore = the 'jobs' useHubStore (job
// records hold trackedTime). Returns how many places were changed.
export async function renameEverywhere(oldName, newName, jobsStore) {
  if (!oldName || !newName || same(oldName, newName) && norm(oldName) === norm(newName)) return 0
  let changed = 0
  const swapList = ws => {
    if (!Array.isArray(ws) || !ws.some(w => same(w, oldName))) return ws
    changed++
    const out = []
    ws.forEach(w => { const v = same(w, oldName) ? newName : w; if (!out.some(x => same(x, v))) out.push(v) })
    return out
  }

  // Timesheets: every week's worker blocks. If the new name is already on
  // that week, fold the old block's hours and expenses into it.
  const sheets = readLS('timesheets', {}) || {}
  let sheetsChanged = false
  Object.keys(sheets).forEach(k => {
    const ws = sheets[k]?.workers
    if (!Array.isArray(ws) || !ws.some(w => same(w?.name, oldName))) return
    sheetsChanged = true; changed++
    const keep = ws.find(w => same(w?.name, newName))
    if (keep) {
      const old = ws.find(w => same(w?.name, oldName))
      const days = (keep.days || []).map((d, i) => {
        const a = Array.isArray(d) ? d : [d]
        const b = Array.isArray(old.days?.[i]) ? old.days[i] : old.days?.[i] ? [old.days[i]] : []
        const filled = b.filter(e => e && (e.reg || e.ot || e.project || e.notes))
        const base = a.filter(e => e && (e.reg || e.ot || e.project || e.notes))
        const merged = [...base, ...filled]
        return merged.length ? merged : a
      })
      sheets[k] = { ...sheets[k], workers: ws.filter(w => w !== old).map(w => w === keep ? { ...keep, days, expenses: [...(keep.expenses || []), ...(old.expenses || [])] } : w) }
    } else {
      sheets[k] = { ...sheets[k], workers: ws.map(w => same(w?.name, oldName) ? { ...w, name: newName } : w) }
    }
  })
  if (sheetsChanged) writeLS('timesheets', sheets)

  // Non-job time log
  const log = readLS('time_nonjob_log', [])
  if (Array.isArray(log) && log.some(e => (e.workers || []).some(w => same(w, oldName)))) {
    writeLS('time_nonjob_log', log.map(e => ({ ...e, workers: swapList(e.workers) })))
  }

  // Old Time Tracking worker list (kept in step for anything still reading it)
  const tw = readLS('time_workers', null)
  if (Array.isArray(tw) && tw.some(w => same(w, oldName))) writeLS('time_workers', swapList(tw))

  // Job tracked time
  if (jobsStore) {
    for (const j of jobsStore.records || []) {
      if (!(j.trackedTime || []).some(e => (e.workers || []).some(w => same(w, oldName)))) continue
      await jobsStore.updateRecord(j.id, cur => ({
        trackedTime: (cur.trackedTime || []).map(e => {
          if (!(e.workers || []).some(w => same(w, oldName))) return e
          const ws = swapList(e.workers)
          return { ...e, workers: ws, totalHours: Math.round((Number(e.hoursEach) || 0) * ws.length * 100) / 100 }
        }),
      }))
    }
  }
  return changed
}

// How many saved entries mention this name — shown before a delete/merge.
export function countUsage(name, jobsStore) {
  let n = 0
  const sheets = readLS('timesheets', {}) || {}
  Object.values(sheets).forEach(s => (s?.workers || []).forEach(w => { if (same(w?.name, name)) n++ }))
  ;(readLS('time_nonjob_log', []) || []).forEach(e => { if ((e.workers || []).some(w => same(w, name))) n++ })
  ;(jobsStore?.records || []).forEach(j => (j.trackedTime || []).forEach(e => { if ((e.workers || []).some(w => same(w, name))) n++ }))
  return n
}
