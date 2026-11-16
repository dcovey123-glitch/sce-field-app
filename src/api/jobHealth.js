// Is a job caught up? Everything the app knows that still needs you on this
// one job — labor, materials, plan, tasks, deficiencies, status, billing.
// → list of short lines; empty = "Project current".
import { missingSlipCharges, slipDuplicateOf } from './materialsAudit.js'
import { slipKind, isReplacedQuote, lineJobsOf } from './slips.js'
import { tasksOf, isOverdue } from './tasks.js'
import { isCombinedChild } from './billing.js'

const n = v => Number(v) || 0

// Labor entries flagged (overtime not billed, took longer than planned…) and
// not resolved yet — a job can't be closed while any are open
export const openLaborFlags = job => (job.laborEntries || []).filter(e => e.flag && !e.flag.resolvedAt)
export const LABOR_FLAG_KINDS = ['Overtime not billed', 'Took longer than planned', 'Extra work / change', 'Rate or hours to check']
const s = (k, one, many) => k === 1 ? one : many

export function jobDeficiencies(job, { orders = [], requests = [], orderSheet = [], stock = [], usedPending = [], status, unposted = 0 } = {}) {
  const out = []
  const billed = status === 'billed'
  if (billed) return [] // billed and done — nothing left to catch up on

  // Status
  if (status == null) out.push('Status not set (Ongoing / Unbilled / Billed)')
  if (status === 'unbilled' && !isCombinedChild(job)) out.push('Complete — not billed yet')

  // Labor
  if (!billed && unposted > 0) out.push(`Labor: ${unposted} clocked ${s(unposted, 'entry', 'entries')} not posted to the job`)

  // Materials Actual
  const entries = job.materialEntries || []
  const miss = missingSlipCharges(orders, job)
  if (miss.length) out.push(`Materials: ${miss.length} slip ${s(miss.length, 'line', 'lines')} not on the job`)
  const dups = entries.filter(e => slipDuplicateOf(e, entries))
  if (dups.length) out.push(`Materials: ${dups.length} ${s(dups.length, 'item', 'items')} charged twice`)
  const noPrice = entries.filter(e => n(e.qty) > 0 && !(n(e.price) > 0) && !e.paidFor && !e.stockId)
  if (noPrice.length) out.push(`Materials: ${noPrice.length} ${s(noPrice.length, 'item', 'items')} with no price`)
  const slipNoPrice = (orders || []).filter(o => slipKind(o) === 'order' && !o.archivedNote && !isReplacedQuote(o, orders))
    .flatMap(o => (o.lineItems || []).filter(li => !li.movedTo && lineJobsOf(o, li).includes(job.id) && !(n(li.totalPrice) > 0) && !(n(li.cost) > 0)))
  if (slipNoPrice.length) out.push(`Materials: ${slipNoPrice.length} slip ${s(slipNoPrice.length, 'line', 'lines')} for this job with no price`)
  const used = (usedPending || []).filter(x => x.jobId === job.id)
  if (used.length) out.push(`Materials: ${used.length} phone ${s(used.length, 'entry', 'entries')} waiting for approval`)

  // Tasks
  const over = tasksOf(job).filter(isOverdue)
  if (over.length) out.push(`Tasks: ${over.length} overdue`)

  // Flagged labor
  const lf = openLaborFlags(job)
  if (lf.length) out.push(`Labor: ${lf.length} flagged — ${lf.slice(0, 2).map(e => (e.flag.kind || 'Flag') + (e.flag.note ? ': ' + String(e.flag.note).slice(0, 50) : '')).join('; ')}`)

  // Notes you put on Needs you
  const notesOpen = (job.notesLog || []).filter(nt => nt.needsMe && !nt.addressedAt)
  if (notesOpen.length) out.push(`Notes: ${notesOpen.length} to address — ${notesOpen.slice(0, 2).map(nt => String(nt.text || '').slice(0, 60)).join('; ')}`)

  // Deficiencies
  const defs = (job.deficiencies || []).filter(d => !d.resolved)
  if (defs.length) out.push(`Deficiencies: ${defs.length} open — ${defs.map(d => d.text || '').filter(Boolean).slice(0, 2).join('; ')}`)

  return out
}
