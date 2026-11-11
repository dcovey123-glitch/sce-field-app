import { todayLocal, monthLocal } from './albertaTime.js'
// ── Billing maths ────────────────────────────────────────────────
// Every money number the app shows for a job comes from here: job total,
// what's been sent for billing, what's left, and the entries made when you
// send an amount to Jonathan to bill. The screens (Jobs, Billing, Snapshot)
// all use these, and tests/billing.test.js checks them.
//
// One rule above all: billingHistory is the single record of what was sent
// for billing. billedProgress (%) and billedAmount ($) are always worked out
// from it, so undo can never leave them out of step.

export const TM_MATERIAL_MARKUP = 0.15

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ── Combined sub-jobs ──
// A sub-job can be combined into its main job ("one CO, one total"): it keeps
// its own record (labour, materials, notes), but its value counts toward the
// main job and it's billed only through the main job. Only jobs of the same
// type combine (Quoted into Quoted, T&M into T&M).
//
// The billing functions find a job's combined sub-jobs in the current jobs
// list. The app registers where that list lives (useHubStore); tests pass
// their own with setJobsSource.
let jobsSource = () => []
export function setJobsSource(fn) { jobsSource = typeof fn === 'function' ? fn : () => [] }
const liveJobs = () => { try { return (jobsSource() || []).filter(j => j && !j.trashedAt) } catch { return [] } }

// The main job this one is combined into, or null
export function combinedParent(project, jobs = liveJobs()) {
  if (!project || !project.foldIntoParent || !project.relatedJobId) return null
  const parent = jobs.find(j => j.id === project.relatedJobId)
  return parent && parent.type === project.type && !parent.foldIntoParent ? parent : null
}
export const isCombinedChild = (project, jobs) => !!combinedParent(project, jobs)

// The sub-jobs combined into this job
export function combinedChildren(project, jobs = liveJobs()) {
  if (!project || project.foldIntoParent) return []
  return jobs.filter(j => j.relatedJobId === project.id && j.foldIntoParent && j.type === project.type)
}

// This job's own T&M total, not counting combined sub-jobs
export function ownTmTotal(project) {
  const labor = Number(project.actualLabor) || 0
  const mats = Number(project.actualMaterials) || 0
  return round2(labor + mats * (1 + TM_MATERIAL_MARKUP))
}

// T&M jobs have no fixed price: hours at the charge-out rate plus materials
// with the standard markup — including any combined sub-jobs.
export function tmTotal(project, jobs = liveJobs()) {
  if (isCombinedChild(project, jobs)) return 0
  return round2(ownTmTotal(project) + combinedChildren(project, jobs).reduce((a, k) => a + ownTmTotal(k), 0))
}

// What has been sent for billing on a T&M job, in dollars.
export function tmBilledAmount(project) {
  if (project.billedAmount !== undefined && project.billedAmount !== null) return Number(project.billedAmount) || 0
  return (project.billingHistory || []).reduce((s, h) => s + (Number(h.amount) || 0), 0)
}

// This job's own value, not counting combined sub-jobs (what the Job value
// field edits). Quoted = job value, falling back to the CO value.
export function ownJobTotal(project) {
  if (project.type === 'warranty') return 0
  if (project.type === 'tm') return ownTmTotal(project)
  const jv = Number(project.jobValue)
  if (jv > 0) return jv
  const cv = Number(project.coValue)
  if (cv > 0) return cv
  return 0
}

// Job total: T&M = hours + marked-up materials; quoted = job value, falling
// back to the CO value; warranty = nothing (it's our cost). Combined sub-jobs
// count toward their main job, and show 0 on their own.
export function effectiveJobTotal(project, jobs = liveJobs()) {
  if (project.type === 'warranty') return 0
  if (isCombinedChild(project, jobs)) return 0
  if (project.type === 'tm') return tmTotal(project, jobs)
  return round2(ownJobTotal(project) + combinedChildren(project, jobs).reduce((a, k) => a + ownJobTotal(k), 0))
}

export function unbilledAmount(project, jobs = liveJobs()) {
  if (project.type === 'warranty') return 0
  if (project.type === 'tm') return Math.max(0, round2(tmTotal(project, jobs) - tmBilledAmount(project)))
  return effectiveJobTotal(project, jobs) * (1 - (Number(project.billedProgress) || 0) / 100)
}

// When an amount is recorded late (it really went out in an earlier month),
// file it on the last day of that month. No month → today.
export function billingWhen(monthKey) {
  const now = new Date()
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return { iso: now.toISOString(), day: todayLocal(now), monthKey: monthLocal(now) }
  const [y, m] = monthKey.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0, 12))
  return { iso: last.toISOString(), day: last.toISOString().slice(0, 10), monthKey }
}

// The job's billing record oldest first, each with the % it was billed from.
export function billingEntries(project) {
  let prev = 0
  return (project.billingHistory || []).map((h, i) => ({ ...h, _i: i }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a._i - b._i)
    .map(h => { const e = { ...h, fromPercent: prev }; prev = Number(h.percent) || prev; return e })
}

// billedProgress / billedAmount worked out from a billing history.
function totalsFrom(project, history) {
  return {
    billingHistory: history,
    billedProgress: history.reduce((m, h) => Math.max(m, Number(h.percent) || 0), 0),
    ...(project.type === 'tm' ? { billedAmount: round2(history.reduce((t, h) => t + (Number(h.amount) || 0), 0)) } : {}),
  }
}

// Quoted job: send it for billing up to toPercent. null if nothing to send.
export function progressBillPatch(project, toPercent, amount, monthKey) {
  if (project.type === 'tm' || project.type === 'warranty') return null
  const from = Number(project.billedProgress) || 0
  if (!(toPercent > from)) return null
  const when = billingWhen(monthKey)
  const entry = { id: uid(), date: when.day, monthKey: when.monthKey, percent: toPercent, amount: round2(amount), recordedAt: new Date().toISOString() }
  return totalsFrom(project, [...(project.billingHistory || []), entry])
}

// T&M job: send everything not yet sent (hours + materials WITH markup).
// This is the only way a T&M job gets billed, so the markup can't be missed.
export function tmBillPatch(project, monthKey) {
  if (project.type !== 'tm') return null
  const total = tmTotal(project)
  const from = tmBilledAmount(project)
  const amount = round2(total - from)
  if (amount <= 0) return null
  const when = billingWhen(monthKey)
  const to = round2(from + amount)
  const pct = total > 0 ? Math.min(100, Math.round((to / total) * 100)) : 100
  const entry = { id: uid(), date: when.day, monthKey: when.monthKey, percent: pct, amount, tm: true, recordedAt: new Date().toISOString() }
  return totalsFrom(project, [...(project.billingHistory || []), entry])
}

// Undo the most recently added billing entry.
export function undoLastBillingPatch(project) {
  const history = project.billingHistory || []
  if (!history.length) return null
  return totalsFrom(project, history.slice(0, -1))
}

// Remove one billing entry (the Billing screen's undo on a single row).
export function removeBillingEntryPatch(project, entryId) {
  const history = project.billingHistory || []
  if (!history.some(h => h.id === entryId)) return null
  return totalsFrom(project, history.filter(h => h.id !== entryId))
}
