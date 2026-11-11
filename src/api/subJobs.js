// Making a job a sub-job of another after the fact (two jobs approved
// separately that turned out to be one). A sub-job keeps its own record —
// labour, materials, CO, quotes — and just points at its parent with
// relatedJobId, the same as a sub-job made at approval time.
//
// Sub-jobs are one level deep: if the job being moved has sub-jobs of its
// own, they move under the new parent with it.

const live = p => p && !p.trashedAt

// Jobs this one could go under: not itself, not one of its own sub-jobs,
// and not something that's already a sub-job (one level only).
// search: every word in the name, CO or customer. Same customer first.
export function parentCandidates(jobs, job, customers = [], search = '', limit = 10) {
  const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean)
  const custName = id => (customers.find(c => c.id === id) || {}).name || ''
  return (jobs || [])
    .filter(p => live(p) && p.id !== job.id && p.relatedJobId !== job.id && !p.relatedJobId)
    .map(p => ({ ...p, customerName: custName(p.customerId) }))
    .filter(p => !words.length || words.every(w => [p.name, p.co, p.customerName].join(' ').toLowerCase().includes(w)))
    .sort((a, b) => (a.customerId === job.customerId ? 0 : 1) - (b.customerId === job.customerId ? 0 : 1) || String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, limit)
}

// → [{ id, patch }] — the job, plus any sub-jobs it had, now under parentId.
// combine: true = one CO, one total (its value counts toward the parent and
// it's billed only through the parent); false = its own CO and billing.
// Sub-jobs it had keep whichever way they were set up.
export function makeSubJobUpdates(jobs, job, parentId, combine = false) {
  if (!parentId || parentId === job.id) return []
  const kids = (jobs || []).filter(p => live(p) && p.relatedJobId === job.id)
  return [{ id: job.id, patch: { relatedJobId: parentId, foldIntoParent: !!combine } }, ...kids.map(k => ({ id: k.id, patch: { relatedJobId: parentId } }))]
}

const TYPE_NAME = { quoted: 'Quoted', tm: 'T&M', warranty: 'Warranty' }

// Can this job be combined into that one (one CO, one total)? → null if yes,
// or the reason it can't (it can still be a sub-job with its own CO).
export function whyCantCombine(job, parent) {
  if (!parent) return 'Pick the main job first.'
  if (job.type === 'warranty' || parent.type === 'warranty') return 'Warranty jobs aren\'t billed, so there\'s no total to combine.'
  if ((job.type || '') !== (parent.type || '')) return `Only jobs of the same type combine — this is ${TYPE_NAME[job.type] || 'untyped'}, ${parent.name || 'that job'} is ${TYPE_NAME[parent.type] || 'untyped'}.`
  if ((job.billingHistory || []).length) return 'This job has already been billed on its own, so it keeps its own CO.'
  return null
}

// The job's quotes now show as sub-job quotes
export function quoteIdsOf(job) {
  return job.linkedQuoteIds || (job.linkedQuoteId ? [job.linkedQuoteId] : [])
}
