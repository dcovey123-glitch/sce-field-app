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
