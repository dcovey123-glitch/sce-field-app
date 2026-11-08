import { useEffect, useRef } from 'react'

// Jobs and Quotes keep separate customer records (separate folders and ids).
// To make them behave as ONE customer, every record carries a `sharedId`:
//   - the Jobs-side customer's sharedId is its own id
//   - its Quotes-side partner gets that same id
// so the link survives renames and name drift. Customers that haven't been
// stamped yet (older data) still fall back to a case-insensitive name match
// until the one-time stamping below has run.

export const normName = n => (n || '').trim().toLowerCase()
export const sharedKey = c => (c && (c.sharedId || c.id)) || null

function pick(list, test) {
  const hits = list.filter(test)
  return hits.find(c => !c.trashedAt) || hits[0] || null
}

export function linkedQuotesCustomer(jobCustomer, quotesCustomers) {
  if (!jobCustomer) return null
  const key = sharedKey(jobCustomer)
  return pick(quotesCustomers, q => q.sharedId && q.sharedId === key)
    || pick(quotesCustomers, q => !q.sharedId && normName(q.name) === normName(jobCustomer.name))
}

export function linkedJobsCustomer(quoteCustomer, jobsCustomers) {
  if (!quoteCustomer) return null
  const key = sharedKey(quoteCustomer)
  return pick(jobsCustomers, j => sharedKey(j) === key && !!quoteCustomer.sharedId)
    || pick(jobsCustomers, j => normName(j.name) === normName(quoteCustomer.name) && (!quoteCustomer.sharedId || !j.sharedId))
}

// One-time (idempotent) stamping of shared ids onto both sides. Deterministic
// ids mean several open windows can run this safely without disagreeing.
export function useSharedCustomerLinks(jobsHub, quotesHub) {
  const running = useRef(false)
  useEffect(() => {
    if (jobsHub.loading || quotesHub.loading || running.current) return
    const jobs = jobsHub.customers
    const quotes = quotesHub.customers
    const todo = []
    const keyOfJob = new Map()
    jobs.forEach(j => {
      const partner = pick(quotes, q => (q.sharedId && q.sharedId === j.sharedId) || (!q.sharedId && normName(q.name) === normName(j.name)))
      const key = j.sharedId || partner?.sharedId || j.id
      keyOfJob.set(j.id, key)
      if (j.sharedId !== key) todo.push(() => jobsHub.updateCustomer(j.id, { sharedId: key }))
      if (partner && partner.sharedId !== key) todo.push(() => quotesHub.updateCustomer(partner.id, { sharedId: key }))
    })
    // Quotes customers with no Jobs partner just keep their own id as the link key
    quotes.forEach(q => {
      if (!q.sharedId && !jobs.some(j => normName(j.name) === normName(q.name))) todo.push(() => quotesHub.updateCustomer(q.id, { sharedId: q.id }))
    })
    if (todo.length === 0) return
    running.current = true
    ;(async () => {
      try { for (const fn of todo) await fn() } finally { running.current = false }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsHub.loading, quotesHub.loading, jobsHub.customers.length, quotesHub.customers.length])
}
