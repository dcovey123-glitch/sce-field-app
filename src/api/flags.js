// Flags: "deal with this now" markers on any order, PO, slip or Assistant
// Update email — an immediate task list (Notes → ⚑ Flagged, and the top of
// Assistant Update). A flag keeps a little copy of what it points at, so the
// list reads fine without opening anything.
//
// flag: { id, refId, kind: 'po'|'slip'|'email', title, sub, q, date, archived,
//         note, at, doneAt }
import { useLocalStore } from './useLocalStore.js'

export const FLAGS_KEY = 'flagged_items'
const JUMP_KEY = 'fieldapp_flag_jump'
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const KEEP_DONE_DAYS = 30

function tidy(list) {
  const cut = Date.now() - KEEP_DONE_DAYS * 86400000
  return (Array.isArray(list) ? list : []).filter(f => !f.doneAt || Date.parse(f.doneAt) > cut)
}

export function useFlags() {
  const [raw, setRaw] = useLocalStore(FLAGS_KEY, [])
  const flags = Array.isArray(raw) ? raw : []
  const active = flags.filter(f => !f.doneAt).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const done = flags.filter(f => f.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
  const flagOf = refId => active.find(f => f.refId === refId) || null
  const flag = (refId, info, note) => setRaw(l => {
    const cur = tidy(l)
    const ex = cur.find(f => f.refId === refId && !f.doneAt)
    if (ex) return cur.map(f => f === ex ? { ...f, ...info, note: note ?? f.note } : f)
    return [{ id: uid(), refId, ...info, note: (note || '').trim(), at: new Date().toISOString() }, ...cur]
  })
  const setNote = (id, note) => setRaw(l => tidy(l).map(f => f.id === id ? { ...f, note } : f))
  const finish = id => setRaw(l => tidy(l).map(f => f.id === id ? { ...f, doneAt: new Date().toISOString() } : f))
  const unflag = refId => setRaw(l => tidy(l).map(f => f.refId === refId && !f.doneAt ? { ...f, doneAt: new Date().toISOString() } : f))
  const reopen = id => setRaw(l => tidy(l).map(f => f.id === id ? { ...f, doneAt: undefined } : f))
  const remove = id => setRaw(l => tidy(l).filter(f => f.id !== id))
  return { flags, active, done, flagOf, flag, setNote, finish, unflag, reopen, remove }
}

// "Open →" from the flag list: Materials reads this once when it opens
export function setFlagJump(f) { try { localStorage.setItem(JUMP_KEY, JSON.stringify({ kind: f.kind, refId: f.refId, q: f.q || '', archived: !!f.archived, t: Date.now() })) } catch { /* ignore */ } }
export function readFlagJump() {
  try { const j = JSON.parse(localStorage.getItem(JUMP_KEY) || 'null'); return j && Date.now() - j.t < 20000 ? j : null } catch { return null }
}
export function clearFlagJump() { try { localStorage.removeItem(JUMP_KEY) } catch { /* ignore */ } }
