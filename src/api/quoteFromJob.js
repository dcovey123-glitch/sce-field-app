// A T&M job that turns into a quoted one.
//
// RDP wants a quote for work you've already started: the hours and materials
// logged on the T&M job so far go onto the quote as a "Work completed to date"
// scope, you add the rest as normal scopes, and the quote goes out.
//   quote.fromJob = { jobId, jobName, at, hours, matCost }   (what was brought in, when)
//   job.pendingQuoteId = quote id                           (quote coming — T&M billing on hold)
// When the quote is approved, the same job becomes the quoted job: linked as
// primary, type Quoted, CO value = quote total. The hours already logged stay
// on it as actual cost.

const n = v => Number(v) || 0
const r2 = v => Math.round(n(v) * 100) / 100
const r4 = v => Math.round(n(v) * 10000) / 10000
const lc = s => String(s || '').trim().toLowerCase()

export const WORK_TO_DATE_NAME = 'Work completed to date'

// What's been logged on the job so far
export function workToDate(job) {
  const labor = job.laborEntries || []
  const hours = r2(labor.reduce((a, e) => a + n(e.hours), 0))
  const dates = labor.map(e => e.date).filter(Boolean).sort()
  // same part at the same price → one line
  const mats = []
  for (const m of job.materialEntries || []) {
    const qty = n(m.qty) || 1, rate = r4(m.price)
    const desc = m.item || m.desc || m.partNo || 'Material'
    const same = mats.find(x => lc(x.partNo) === lc(m.partNo) && lc(x.desc) === lc(desc) && x.rate === rate && (x.uom || '') === (m.uom || ''))
    if (same) same.qty = r4(same.qty + qty)
    else mats.push({ partNo: m.partNo || '', desc, qty: r4(qty), uom: m.uom || '', rate })
  }
  const matCost = r2(mats.reduce((a, m) => a + m.qty * m.rate, 0))
  return { hours, matCost, materials: mats, from: dates[0] || '', to: dates[dates.length - 1] || '' }
}

// The scope that carries it on the quote (labor at the quote's rate,
// materials at cost — the quote adds its own material markup)
export function workToDateScope(job, quoteRate, uid, now = new Date().toISOString()) {
  const w = workToDate(job)
  const span = w.from ? (w.from === w.to ? ` on ${w.from}` : ` from ${w.from} to ${w.to}`) : ''
  return {
    id: uid(), name: WORK_TO_DATE_NAME,
    scopeText: `Work already completed on ${job.name || 'this job'}${span}, carried into this quote.`,
    labor: w.hours > 0 ? [{ id: uid(), desc: 'Labor completed to date', qty: w.hours, rate: n(quoteRate) || 90, fromJob: job.id }] : [],
    materials: w.materials.map(m => ({ id: uid(), ...m, fromJob: job.id })),
    fromJob: { jobId: job.id, at: now },
  }
}

// Put (or refresh) the work-to-date scope on a quote → quote patch
export function bringInWorkPatch(quote, job, uid, now = new Date().toISOString()) {
  const scope = workToDateScope(job, quote.rate, uid, now)
  const scopes = quote.scopes || []
  const i = scopes.findIndex(s => s.fromJob && s.fromJob.jobId === job.id)
  const w = workToDate(job)
  return {
    scopes: i >= 0 ? scopes.map((s, k) => k === i ? { ...scope, id: s.id } : s) : [scope, ...scopes],
    fromJob: { jobId: job.id, jobName: job.name || '', at: now, hours: w.hours, matCost: w.matCost },
  }
}
export function unlinkWorkPatch(quote) {
  const jobId = quote.fromJob && quote.fromJob.jobId
  return { fromJob: null, scopes: (quote.scopes || []).filter(s => !(s.fromJob && s.fromJob.jobId === jobId)) }
}

// Is there a live quote out for this job's work? → the quote, or null
export function pendingQuoteFor(job, quotes) {
  if (!job || !job.pendingQuoteId) return null
  const q = (quotes || []).find(x => x.id === job.pendingQuoteId)
  return q && !q.trashedAt && !q.invalidated && !q.approved ? q : null
}

// Approval: the job becomes the quoted job → job patch
export function becomeQuotedJobPatch(job, quote, quoteTotal) {
  const ids = job.linkedQuoteIds || (job.linkedQuoteId ? [job.linkedQuoteId] : [])
  return {
    type: 'quoted',
    coValue: r2(quoteTotal),
    linkedQuoteIds: ids.includes(quote.id) ? ids : [...ids, quote.id],
    pendingQuoteId: null,
    becameQuotedFrom: { quoteId: quote.id, at: new Date().toISOString(), wasType: job.type || '' },
  }
}

// T&M jobs that could be quoted (same customer, not finished or billed out)
export function jobsToBringIn(jobs, customerId) {
  return (jobs || []).filter(j => j && !j.trashedAt && j.customerId === customerId && j.type === 'tm' && !['billed'].includes(j.lifecycleStatus))
}
