import { describe, it, expect } from 'vitest'
import { linkedQuotesCustomer, linkedJobsCustomer, linkCheck, nameScore } from '../src/api/sharedCustomer.js'
import { mergeCustomerData } from '../src/api/customers.js'
import { restoreQuotePatch } from '../src/pages/Quotes.jsx'

const J = (id, name, extra = {}) => ({ id, name, sharedId: id, ...extra })
const Q = (id, name, sharedId, extra = {}) => ({ id, name, sharedId, ...extra })

describe('customer link ID only — no name matching', () => {
  it('pairs by link ID even when the names differ', () => {
    const j = J('j1', 'Red Deer Polytechnic - Residence')
    const q = Q('q1', 'RDP Residence', 'j1')
    expect(linkedQuotesCustomer(j, [q])).toBe(q)
    expect(linkedJobsCustomer(q, [j])).toBe(j)
  })
  it('never pairs two customers just because the names match', () => {
    const j = J('j1', 'Terry Raymond')
    const q = Q('q9', 'Terry Raymond', 'q9')
    expect(linkedQuotesCustomer(j, [q])).toBe(null)
    expect(linkedJobsCustomer(q, [j])).toBe(null)
  })
  it('link check lists each side missing and suggests the likely partner', () => {
    const jobs = [J('j1', 'CANA Construction'), J('j2', 'KB Engineering'), J('j3', 'Red Deer Polytechnic')]
    const quotes = [Q('q1', 'CANA Construction', 'j1'), Q('q3', 'RDP', 'q3')]
    const r = linkCheck(jobs, quotes)
    expect(r.jobsOnly.map(x => x.customer.id)).toEqual(['j2', 'j3'])
    expect(r.quotesOnly.map(x => x.customer.id)).toEqual(['q3'])
    expect(r.quotesOnly[0].suggestion.id).toBe('j3')
  })
  it('ignores customers in Trash', () => {
    const r = linkCheck([J('j1', 'Old', { trashedAt: 'x' })], [])
    expect(r.jobsOnly).toEqual([])
  })
  it('name score: exact 100, shared words, initials', () => {
    expect(nameScore('Wingenback Ltd', 'wingenback ltd')).toBe(100)
    expect(nameScore('RDP', 'Red Deer Polytechnic')).toBeGreaterThanOrEqual(70)
    expect(nameScore('KB Engineering', 'Mission Electric Calgary')).toBe(0)
  })
})

describe('merging customer data', () => {
  it('adds to-dos and notes, fills only blank details', () => {
    const target = { name: 'A', phone: '403-111', todos: [{ id: 't1', text: 'x' }], generalNotes: 'Gate 1234' }
    const from = { name: 'B', phone: '403-999', email: 'b@x.ca', todos: [{ id: 't2', text: 'y' }], generalNotes: 'Key in lockbox' }
    const p = mergeCustomerData(target, from)
    expect(p.todos.map(t => t.id)).toEqual(['t1', 't2'])
    expect(p.generalNotes).toContain('Gate 1234')
    expect(p.generalNotes).toContain('From B:')
    expect(p.phone).toBeUndefined()
    expect(p.email).toBe('b@x.ca')
  })
  it('nothing to carry → empty patch', () => {
    expect(mergeCustomerData({ name: 'A' }, { name: 'B' })).toEqual({})
  })
})

describe('restoring an invalidated quote', () => {
  it('makes it live again and keeps the old reason in its history', () => {
    const p = restoreQuotePatch({ invalidated: true, invalidReason: 'Customer went with another bid' })
    expect(p.invalidated).toBe(false)
    expect(p.invalidHistory[0].reason).toBe('Customer went with another bid')
  })
})

import { sleepBlockers, awake } from '../src/api/customers.js'
describe('putting a customer to sleep', () => {
  const status = p => p.lifecycleStatus
  it('nothing outstanding → can sleep', () => {
    expect(sleepBlockers({ todos: [] }, { jobs: [{ lifecycleStatus: 'billed' }], quotes: [{ approved: true }, { invalidated: true }], status, unbilled: () => 0 })).toEqual([])
  })
  it('lists what is still open', () => {
    const b = sleepBlockers({ todos: [{ id: 't', text: 'x' }] }, {
      jobs: [{ name: 'A', lifecycleStatus: 'onGoing' }, { name: 'B', lifecycleStatus: 'billed', tasks: [{ done: false }] }, { name: 'C', lifecycleStatus: 'billed' }],
      quotes: [{ approved: false }], status, unbilled: p => p.name === 'C' ? 120 : 0,
    })
    expect(b.join(' | ')).toMatch(/1 job not closed and billed \(A\)/)
    expect(b.join(' | ')).toMatch(/money not billed/)
    expect(b.join(' | ')).toMatch(/1 job task not done/)
    expect(b.join(' | ')).toMatch(/1 open quote/)
    expect(b.join(' | ')).toMatch(/1 customer to-do open/)
  })
  it('sleeping customers drop out of the working list', () => {
    expect(awake([{ id: 'a' }, { id: 'b', sleepingAt: 'x' }, { id: 'c', trashedAt: 'y' }]).map(c => c.id)).toEqual(['a'])
  })
})
