// Every automation in the app that changes your data on its own, in one place.
//
// Each one has a switch (Automations page, or the little selector on its
// banner):
//   ask  — it works out the change and shows it; nothing is saved until you
//          ✓ Apply it (or Skip it — a skipped change isn't offered again)
//   auto — it saves the change by itself (the old way)
//   off  — it doesn't run at all; you do that step by hand (manual bypass)
// Default is ask for everything that changes money, status, Stock or which
// job something is charged to.

import { useMemo } from 'react'
import { useLocalStore } from './useLocalStore.js'
import { readValue } from './fileStore.js'

export const AUTO_MODES_KEY = 'automation_modes'
export const AUTO_SKIP_KEY = 'automation_skipped'

export const AUTOMATIONS = [
  {
    id: 'po-emails', name: "PO numbers from Jonathan's emails", where: 'Orders & POs',
    what: "Reads the PO Emails folder (Power Automate) and puts each PO # on the supplier quote it names.",
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'po-balanced', name: 'Mark a PO Received when it balances', where: 'Orders & POs',
    what: 'When the packing slips on a PO add up to its quote, the order is marked Received (which puts it on that week\'s export to Jonathan).',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'slip-tag', name: 'Tag returned quotes / slips to the jobs that asked', where: 'Materials',
    what: 'A quote or slip that comes back for an order built from job plans gets its untagged lines tagged to those jobs (each job its share).',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'quote-to-slips', name: 'Move quote charges to the packing slips', where: 'Materials · Job → Materials Actual',
    what: 'A job charged from a quote whose packing slips have come in is re-charged from the slips instead (same qty), so nothing is charged twice. Any extra comes out of Stock.',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'job-auto-charge', name: 'Charge ordered material to the job', where: 'Job → Materials Actual',
    what: 'Slip lines tagged to the job, and PO quotes filed to only this job (no slips yet), are added to its Materials Actual.',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'closeout-deficiency', name: 'Re-open closed jobs with material not closed out', where: 'Materials',
    what: 'A closed job with slip material still sitting on it gets a "Material not closed out" deficiency (Unbilled → Deficiencies); it clears when the material is dealt with.',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'backorder-release', name: 'Backorder releases (-01 / -02 slips)', where: 'Materials → reading a slip',
    what: 'A new slip with the same order # as one with backordered lines takes those lines over, so nothing is counted twice.',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'trash-purge', name: 'Empty Trash after 30 days', where: 'Trash',
    what: 'Anything in Trash longer than 30 days is deleted for good. For a customer that means its whole folder on disk — every job and quote in it, with their files.',
    modes: ['ask', 'auto', 'off'],
  },
  {
    id: 'pricing-match', name: 'Match pricing quotes to the request you sent', where: 'Materials → Orders & Slips',
    what: 'When a quote comes back that looks like the answer to a pricing request, it is paired with it — always waiting for you to confirm.',
    modes: ['ask', 'off'],
  },
]
export const automationById = id => AUTOMATIONS.find(a => a.id === id)

export function modeOf(modes, id) {
  const a = automationById(id)
  const m = modes && modes[id]
  return a && a.modes.includes(m) ? m : 'ask'
}

// Read straight from storage (for code outside React, e.g. the background PO check)
export function readMode(id) {
  try { return modeOf(readValue(AUTO_MODES_KEY, {}), id) } catch { return 'ask' }
}

export function useAutoMode(id) {
  const [modes, setModes] = useLocalStore(AUTO_MODES_KEY, {})
  return [modeOf(modes, id), m => setModes(x => ({ ...(x || {}), [id]: m }))]
}
export function useAllAutoModes() {
  const [modes, setModes] = useLocalStore(AUTO_MODES_KEY, {})
  // the getter only changes when a switch does (safe to use in memo deps)
  const get = useMemo(() => id => modeOf(modes, id), [modes])
  return [get, (id, m) => setModes(x => ({ ...(x || {}), [id]: m }))]
}

// Changes you skipped, per automation, so they aren't offered again
export function useAutoSkip(id) {
  const [all, setAll] = useLocalStore(AUTO_SKIP_KEY, {})
  const set = new Set((all && all[id]) || [])
  const add = keys => setAll(x => ({ ...(x || {}), [id]: [...new Set([...((x && x[id]) || []), ...keys])].slice(-1000) }))
  const clear = () => setAll(x => { const n = { ...(x || {}) }; delete n[id]; return n })
  return [set, add, clear]
}
export function skippedCounts(all) {
  return Object.fromEntries(Object.entries(all || {}).map(([k, v]) => [k, (v || []).length]))
}

// Lines on slips that an automation changed: which ones, by key 'orderId#index'
export function changedSlipLines(before, after) {
  const was = new Map((before || []).map(o => [o.id, o]))
  const out = []
  for (const o of after || []) {
    const b = was.get(o.id)
    if (!b || b === o) continue
    ;(o.lineItems || []).forEach((li, i) => { if ((b.lineItems || [])[i] !== li) out.push({ key: o.id + '#' + i, order: o, line: li, index: i }) })
  }
  return out
}
// Keep only the chosen line changes (the rest stay as they were)
export function applySlipLineChanges(before, after, keys) {
  const pick = new Set(keys)
  const next = new Map((after || []).map(o => [o.id, o]))
  return (before || []).map(o => {
    const a = next.get(o.id)
    if (!a || a === o) return o
    let changed = false
    const lineItems = (o.lineItems || []).map((li, i) => {
      if (!pick.has(o.id + '#' + i)) return li
      changed = true
      return (a.lineItems || [])[i] || li
    })
    return changed ? { ...o, lineItems } : o
  })
}
