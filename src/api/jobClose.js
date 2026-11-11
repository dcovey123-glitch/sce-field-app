// Closing a job — ONE set of rules, whichever button you use (the status
// dropdown, the green status dot, the customer window).
//
// A job can't be closed (Deficiencies / Unbilled / Billed) while:
//   - a labor entry is flagged and not resolved, or
//   - slip material is still sitting with it (each line used on the job or
//     pushed to Stock first — that's how leftovers reach Stock).
import { openLaborFlags } from './jobHealth.js'
import { leftoverLinesForJob } from './slips.js'
import { todayLocal } from './albertaTime.js'
import { effectiveJobTotal, unbilledAmount, combinedParent } from './billing.js'

export const CLOSED_STATUSES = ['deficiencies', 'unbilled', 'billed']
export const isClosingStatus = value => CLOSED_STATUSES.includes(value)

// What stops this job closing right now
export function closeBlockers(project, orders) {
  const laborFlags = openLaborFlags(project)
  const leftovers = leftoverLinesForJob(orders || [], project)
  return { laborFlags, leftovers, any: laborFlags.length > 0 || leftovers.length > 0 }
}

// The change to save when a job moves to a status
export function statusPatch(project, value) {
  const patch = { lifecycleStatus: value }
  // Keep the older fields in step so every screen and export agrees
  if (value === 'onGoing') Object.assign(patch, { completed: false, status: project.status === 'green' ? 'yellow' : (project.status || 'red') })
  if (isClosingStatus(value)) {
    Object.assign(patch, { completed: true, status: 'green', dateComplete: project.dateComplete || todayLocal() })
  }
  // Complete (Unbilled / Billed) means the deficiencies are done too
  if (value === 'unbilled' || value === 'billed') {
    const open = (project.deficiencies || []).filter(d => !d.resolved)
    if (open.length) {
      const at = new Date().toISOString()
      patch.deficiencies = (project.deficiencies || []).map(d => d.resolved ? d : { ...d, resolved: true, resolvedAt: at, resolvedNote: 'Closed when job was marked complete' })
    }
  }
  return patch
}

// ── Close-out check ──
// Everything a job should have filled in before it's marked Complete
// (Unbilled or Billed). Each item says what's missing and, where it's a
// simple field, which quick fix the checklist offers right there.
//   → [{ id, text, fix? }]   fix: 'co' | 'dateStart' | 'dateApproved' | 'type'
//        | 'quote' | 'coValue' | 'coAttach' | 'jobValue' | 'progress' | null
// `more` = other job-health lines (materials, notes, tasks) to include.

const num = v => Number(v) || 0
const filled = v => v !== undefined && v !== null && String(v).trim() !== ''

export function closeoutChecks(project, value, { more = [], jobs } = {}) {
  const p = project || {}
  const out = []
  // Combined into a main job: CO, value and billing live on the main job
  const combined = !!combinedParent(p, jobs)
  const quoted = p.type === 'quoted' && !combined
  const linkedIds = p.linkedQuoteIds || (p.linkedQuoteId ? [p.linkedQuoteId] : [])
  const labor = (p.laborEntries || []).filter(e => num(e.hours) > 0)

  // The basics
  if (!p.type) out.push({ id: 'type', text: 'Job type not set (Quoted / T&M / Warranty)', fix: 'type' })
  if (!combined && !filled(p.co)) out.push({ id: 'co', text: 'No CO / PO #', fix: 'co' })
  if (!p.dateStart) out.push({ id: 'dateStart', text: 'No start date', fix: 'dateStart' })
  if (quoted && !p.dateApproved) out.push({ id: 'dateApproved', text: 'No date approved', fix: 'dateApproved' })

  // Quote / CO
  if (quoted && !linkedIds.length && !p.noQuoteNeeded) out.push({ id: 'quote', text: 'No quote linked — link one, or tick "No quote for this job"', fix: 'quote' })
  if (quoted && !p.noCoNeeded) {
    if (!filled(p.coValue)) out.push({ id: 'coValue', text: 'No CO value', fix: 'coValue' })
    if (!p.coAttachment) out.push({ id: 'coAttach', text: 'CO document not attached', fix: 'coAttach' })
    const cos = p.linkedQuoteCOs || {}
    if (linkedIds.length > 1 && !linkedIds.every(id => filled(cos[id]?.co) && filled(cos[id]?.coValue))) out.push({ id: 'quoteCOs', text: 'CO # / value missing on one or more linked quotes (Quote section)', fix: null })
  }

  // Money
  if (quoted && !(effectiveJobTotal(p) > 0)) out.push({ id: 'jobValue', text: 'No job value', fix: 'jobValue' })
  if (quoted && num(p.progress) < 100) out.push({ id: 'progress', text: `Progress is at ${num(p.progress)}%, not 100%`, fix: 'progress' })
  if (!combined && value === 'billed' && p.type !== 'warranty' && unbilledAmount(p) > 0.5) {
    out.push({ id: 'billing', text: `Marked Billed, but $${unbilledAmount(p).toFixed(2)} hasn't been billed yet (Billing on this job)`, fix: null })
  }

  // Work done
  if (!labor.length) out.push({ id: 'labor', text: 'No labor hours on this job (Labor section)', fix: null })
  else if (!labor.some(e => filled(e.workCompleted))) out.push({ id: 'work', text: 'No "work completed" written on any labor entry (Labor section)', fix: null })

  for (const t of more) out.push({ id: 'more:' + t, text: t, fix: null })
  return out
}

// Job-health lines that matter at close-out (status/plan lines don't)
export const closeoutHealthLines = lines => (lines || []).filter(t => /^(Materials|Notes|Tasks|Labor: \d+ clocked)/.test(t))
