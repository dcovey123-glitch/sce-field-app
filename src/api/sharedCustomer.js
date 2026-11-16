import { useEffect, useRef } from 'react'

// Jobs and Quotes keep separate customer records (separate folders and ids).
// They are ONE customer because both carry the same link ID (`sharedId`):
//   - the Jobs-side customer's sharedId is its own id
//   - its Quotes-side partner carries that same id
// The link ID is the ONLY thing that pairs them — no name matching. New
// customers are always made as a pair (api/customers.js); anything unpaired
// shows in Manage Customers → Link check for you to pair, complete or remove.

export const normName = n => (n || '').trim().toLowerCase()
export const sharedKey = c => (c && (c.sharedId || c.id)) || null

function pick(list, test) {
  const hits = (list || []).filter(test)
  return hits.find(c => !c.trashedAt) || hits[0] || null
}

export function linkedQuotesCustomer(jobCustomer, quotesCustomers) {
  if (!jobCustomer) return null
  const key = sharedKey(jobCustomer)
  return pick(quotesCustomers, q => sharedKey(q) === key)
}

export function linkedJobsCustomer(quoteCustomer, jobsCustomers) {
  if (!quoteCustomer) return null
  const key = sharedKey(quoteCustomer)
  return pick(jobsCustomers, j => sharedKey(j) === key)
}

// Every customer carries a link ID. One without (older data) gets its own id —
// never a guess from the name. Pairing is done by you in Link check.
export function useSharedCustomerLinks(jobsHub, quotesHub) {
  const running = useRef(false)
  useEffect(() => {
    if (jobsHub.loading || quotesHub.loading || running.current) return
    const todo = [
      ...jobsHub.customers.filter(c => !c.sharedId).map(c => () => jobsHub.updateCustomer(c.id, { sharedId: c.id })),
      ...quotesHub.customers.filter(c => !c.sharedId).map(c => () => quotesHub.updateCustomer(c.id, { sharedId: c.id })),
    ]
    if (!todo.length) return
    running.current = true
    ;(async () => { try { for (const fn of todo) await fn() } finally { running.current = false } })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsHub.loading, quotesHub.loading, jobsHub.customers.length, quotesHub.customers.length])
}

// ── Link check ──
// Customers missing their other side, with the likeliest partner suggested
// (name words in common; "RDP" ↔ "Red Deer Polytechnic" by initials).
const words = s => normName(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['ltd', 'inc', 'the', 'and', 'of'].includes(w))
const initials = s => words(s).map(w => w[0]).join('')
export function nameScore(a, b) {
  if (normName(a) === normName(b)) return 100
  const wa = words(a), wb = words(b)
  if (!wa.length || !wb.length) return 0
  const common = wa.filter(w => wb.includes(w)).length
  let score = Math.round(100 * common / Math.max(wa.length, wb.length))
  const ia = initials(a), ib = initials(b)
  if (wa.length === 1 && ib.startsWith(wa[0]) && wa[0].length >= 2) score = Math.max(score, 70)
  if (wb.length === 1 && ia.startsWith(wb[0]) && wb[0].length >= 2) score = Math.max(score, 70)
  return score
}
export function linkCheck(jobsCustomers, quotesCustomers) {
  const jobs = (jobsCustomers || []).filter(c => !c.trashedAt && !c.sleepingAt)
  const quotes = (quotesCustomers || []).filter(c => !c.trashedAt && !c.sleepingAt)
  const jobsOnly = jobs.filter(j => !linkedQuotesCustomer(j, quotes))
  const quotesOnly = quotes.filter(q => !linkedJobsCustomer(q, jobs))
  const suggest = (c, pool) => pool.map(o => ({ o, s: nameScore(c.name, o.name) })).filter(x => x.s >= 50).sort((a, b) => b.s - a.s).map(x => x.o)[0] || null
  return {
    jobsOnly: jobsOnly.map(c => ({ customer: c, suggestion: suggest(c, quotesOnly) })),
    // a Quotes-only customer pairs with a Jobs-only one; otherwise its quotes
    // can be merged into an existing customer
    quotesOnly: quotesOnly.map(c => ({ customer: c, suggestion: suggest(c, jobsOnly), mergeSuggestion: suggest(c, jobs) })),
  }
}
