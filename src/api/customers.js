// One customer = its Jobs side + its Quotes side, tied by the link ID
// (sharedId — see sharedCustomer.js). Everything that adds, renames, removes,
// restores or merges a customer goes through here so both sides always move
// together. jobsHub / quotesHub = useHubStore() for each.
import { sharedKey, linkedQuotesCustomer, linkedJobsCustomer } from './sharedCustomer.js'

// A new customer, both sides at once. → the Jobs-side customer
export async function addCustomerPair(jobsHub, quotesHub, { name, code, ...rest } = {}) {
  const j = await jobsHub.addCustomer({ name, ...rest })
  if (!j) return null
  await jobsHub.updateCustomer(j.id, { sharedId: j.id })
  await quotesHub.addCustomer({ name, sharedId: j.id, nextQuoteNum: 1, ...(code ? { code } : {}) })
  return { ...j, sharedId: j.id }
}

// The other side of a customer that's missing it
export async function createPartner(jobsHub, quotesHub, customer, side) {
  const key = sharedKey(customer)
  if (side === 'quotes') {
    if (customer.sharedId !== key) await jobsHub.updateCustomer(customer.id, { sharedId: key })
    return quotesHub.addCustomer({ name: customer.name, sharedId: key, nextQuoteNum: 1 })
  }
  // a Jobs side for a Quotes-only customer: the Jobs side's id becomes the link ID
  const j = await jobsHub.addCustomer({ name: customer.name })
  if (!j) return null
  await jobsHub.updateCustomer(j.id, { sharedId: j.id })
  await quotesHub.updateCustomer(customer.id, { sharedId: j.id })
  return j
}

// Pair a Jobs-only and a Quotes-only customer you've said are the same.
// The Quotes side takes the Jobs side's name.
export async function pairCustomers(jobsHub, quotesHub, jobsCustomer, quotesCustomer) {
  const key = jobsCustomer.id
  if (jobsCustomer.sharedId !== key) await jobsHub.updateCustomer(jobsCustomer.id, { sharedId: key })
  await quotesHub.updateCustomer(quotesCustomer.id, { sharedId: key, ...(quotesCustomer.name !== jobsCustomer.name ? { name: jobsCustomer.name } : {}) })
}

const partnerIn = (hub, c, side) => side === 'jobs' ? linkedQuotesCustomer(c, hub.customers) : linkedJobsCustomer(c, hub.customers)

// side = which hub `customer` belongs to: 'jobs' | 'quotes'
export async function renameCustomerPair(jobsHub, quotesHub, customer, side, name) {
  const mine = side === 'jobs' ? jobsHub : quotesHub, other = side === 'jobs' ? quotesHub : jobsHub
  const partner = partnerIn(other, customer, side)
  await mine.updateCustomer(customer.id, { name })
  if (partner && partner.name !== name) await other.updateCustomer(partner.id, { name })
}
export async function trashCustomerPair(jobsHub, quotesHub, customer, side) {
  const stamp = new Date().toISOString()
  const mine = side === 'jobs' ? jobsHub : quotesHub, other = side === 'jobs' ? quotesHub : jobsHub
  const partner = partnerIn(other, customer, side)
  await mine.updateCustomer(customer.id, { trashedAt: stamp })
  if (partner && !partner.trashedAt) await other.updateCustomer(partner.id, { trashedAt: stamp })
}

// Merging customer-level data into the customer you keep: to-dos and notes
// are added, contact / billing details only fill in blanks.
const DETAIL_KEYS = ['contactName', 'contactTitle', 'phone', 'altPhone', 'email', 'address', 'city', 'province', 'postal', 'billingEmail', 'paymentTerms', 'billingAddress', 'contractRef', 'taxNumber']
export function mergeCustomerData(target, from) {
  const patch = {}
  const todos = [...(target.todos || []), ...(from.todos || []).filter(t => !(target.todos || []).some(x => x.id === t.id))]
  if (todos.length !== (target.todos || []).length) patch.todos = todos
  const notes = [target.generalNotes, from.generalNotes && `From ${from.name}:\n${from.generalNotes}`].filter(s => s && String(s).trim()).join('\n\n')
  if (from.generalNotes && notes !== (target.generalNotes || '')) patch.generalNotes = notes
  DETAIL_KEYS.forEach(k => { if (!String(target[k] || '').trim() && String(from[k] || '').trim()) patch[k] = from[k] })
  if (!target.poRequired && from.poRequired) patch.poRequired = true
  return patch
}

// ── Sleep ──
// A customer with nothing outstanding can be put to sleep (Manage Customers):
// hidden from every customer list and picker, kept exactly as it is. Wake it
// and it's back as before. Both sides (Jobs + Quotes) sleep together.
export const isAsleep = c => !!(c && c.sleepingAt)
export const awake = list => (list || []).filter(c => !c.trashedAt && !c.sleepingAt)

// What's still open with this customer (must be empty to sleep).
// jobs / quotes = that customer's (not trashed) records; status(p) = the job's
// lifecycle (Jobs.effectiveLifecycleStatus); unbilled(p) = $ not billed yet.
export function sleepBlockers(customer, { jobs = [], quotes = [], status, unbilled } = {}) {
  const out = []
  const notBilled = jobs.filter(p => status(p) !== 'billed')
  if (notBilled.length) out.push(`${notBilled.length} job${notBilled.length === 1 ? '' : 's'} not closed and billed (${notBilled.slice(0, 3).map(p => p.name || 'Untitled').join(', ')}${notBilled.length > 3 ? '…' : ''})`)
  const owing = jobs.filter(p => status(p) === 'billed' && unbilled && unbilled(p) > 0.5)
  if (owing.length) out.push(`${owing.length} billed job${owing.length === 1 ? '' : 's'} with money not billed yet`)
  const defs = jobs.filter(p => (p.deficiencies || []).some(d => !d.resolved))
  if (defs.length) out.push(`${defs.length} job${defs.length === 1 ? '' : 's'} with open deficiencies`)
  const tasks = jobs.reduce((a, p) => a + (p.tasks || []).filter(t => !t.done).length, 0)
  if (tasks) out.push(`${tasks} job task${tasks === 1 ? '' : 's'} not done`)
  const open = quotes.filter(q => !q.approved && !q.invalidated)
  if (open.length) out.push(`${open.length} open quote${open.length === 1 ? '' : 's'} (approve or invalidate ${open.length === 1 ? 'it' : 'them'})`)
  const todos = (customer.todos || []).filter(t => !t.doneAt).length
  if (todos) out.push(`${todos} customer to-do${todos === 1 ? '' : 's'} open`)
  return out
}

export async function setCustomerPairAsleep(jobsHub, quotesHub, jobsCustomer, asleep) {
  const patch = asleep ? { sleepingAt: new Date().toISOString() } : { sleepingAt: null }
  const qc = linkedQuotesCustomer(jobsCustomer, quotesHub.customers)
  await jobsHub.updateCustomer(jobsCustomer.id, patch)
  if (qc) await quotesHub.updateCustomer(qc.id, patch)
}
