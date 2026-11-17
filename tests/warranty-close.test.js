import { describe, it, expect } from 'vitest'
import { closeoutChecks, isClosedWarranty, statusPatch } from '../src/api/jobClose.js'

describe('Closing warranty work', () => {
  const base = { dateStart: '2026-11-01', laborEntries: [{ hours: 2, workCompleted: 'Fixed it' }] }
  it('does not ask for a CO / PO on a warranty job', () => {
    expect(closeoutChecks({ ...base, type: 'warranty' }, 'billed').map(i => i.id)).toEqual([])
    expect(closeoutChecks({ ...base, type: 'tm' }, 'billed').map(i => i.id)).toContain('co')
  })
  it('a closed warranty job is filed as closed warranty work', () => {
    const p = { ...base, type: 'warranty', ...statusPatch({ type: 'warranty' }, 'billed') }
    expect(isClosedWarranty(p)).toBe(true)
    expect(isClosedWarranty({ type: 'warranty', lifecycleStatus: 'unbilled' })).toBe(true)
    expect(isClosedWarranty({ type: 'warranty', lifecycleStatus: 'onGoing' })).toBe(false)
    expect(isClosedWarranty({ type: 'tm', lifecycleStatus: 'billed' })).toBe(false)
  })
})
