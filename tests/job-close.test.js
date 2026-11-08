// The one set of rules for closing a job (dropdown, status dot, customer window)
import { describe, it, expect } from 'vitest'
import { closeBlockers, statusPatch, isClosingStatus } from '../src/api/jobClose.js'

const job = (extra = {}) => ({ id: 'j1', name: 'Test job', status: 'yellow', laborEntries: [], deficiencies: [], ...extra })

describe('closing a job', () => {
  it('knows which statuses close a job', () => {
    expect(isClosingStatus('unbilled')).toBe(true)
    expect(isClosingStatus('billed')).toBe(true)
    expect(isClosingStatus('deficiencies')).toBe(true)
    expect(isClosingStatus('onGoing')).toBe(false)
  })
  it('an open labor flag blocks closing; a resolved one does not', () => {
    const flagged = job({ laborEntries: [{ id: 'l1', hours: 3, flag: { kind: 'Overtime not billed', at: '2026-11-08' } }] })
    expect(closeBlockers(flagged, []).laborFlags).toHaveLength(1)
    expect(closeBlockers(flagged, []).any).toBe(true)
    const resolved = job({ laborEntries: [{ id: 'l1', hours: 3, flag: { kind: 'Overtime not billed', at: '2026-11-08', resolvedAt: '2026-11-09' } }] })
    expect(closeBlockers(resolved, []).any).toBe(false)
  })
  it('the status dot and the dropdown save the same thing', () => {
    const p = statusPatch(job(), 'unbilled')
    expect(p.lifecycleStatus).toBe('unbilled')
    expect(p.completed).toBe(true)
    expect(p.status).toBe('green')
    expect(p.dateComplete).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('keeps an existing completion date', () => {
    expect(statusPatch(job({ dateComplete: '2026-10-01' }), 'billed').dateComplete).toBe('2026-10-01')
  })
  it('completing closes open deficiencies; Deficiencies status leaves them open', () => {
    const j = job({ deficiencies: [{ id: 'd1', text: 'Cover plate', resolved: false }] })
    expect(statusPatch(j, 'unbilled').deficiencies[0].resolved).toBe(true)
    expect(statusPatch(j, 'deficiencies').deficiencies).toBeUndefined()
  })
  it('reopening makes the job active again', () => {
    const p = statusPatch(job({ status: 'green', completed: true }), 'onGoing')
    expect(p).toMatchObject({ lifecycleStatus: 'onGoing', completed: false, status: 'yellow' })
  })
})
