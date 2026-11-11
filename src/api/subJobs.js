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

// → [{ id, patch }] — the job, plus any sub-jobs it had, now under parentId
export function makeSubJobUpdates(jobs, job, parentId) {
  if (!parentId || parentId === job.id) return []
  const kids = (jobs || []).filter(p => live(p) && p.relatedJobId === job.id)
  return [{ id: job.id, patch: { relatedJobId: parentId } }, ...kids.map(k => ({ id: k.id, patch: { relatedJobId: parentId } }))]
}

// The job's quotes now show as sub-job quotes
export function quoteIdsOf(job) {
  return job.linkedQuoteIds || (job.linkedQuoteId ? [job.linkedQuoteId] : [])
}
