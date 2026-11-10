import { describe, it, expect } from 'vitest'
import { closeoutChecks, closeoutHealthLines } from '../src/api/jobClose.js'

const ids = (p, v = 'unbilled', o) => closeoutChecks(p, v, o).map(x => x.id)
const done = {
  type: 'quoted', co: 'PO 10128', dateStart: '2026-10-01', dateApproved: '2026-09-28',
  linkedQuoteIds: ['q1'], coValue: 4200, coAttachment: { fileName: 'co.pdf' }, jobValue: 4200, progress: 100,
  laborEntries: [{ id: 'l1', date: '2026-10-01', hours: 6, workCompleted: 'Installed fixtures' }],
}

describe('close-out check', () => {
  it('a fully filled-in quoted job passes', () => {
    expect(ids(done)).toEqual([])
  })
  it('flags the basics on an empty job', () => {
    expect(ids({})).toEqual(['type', 'co', 'dateStart', 'labor'])
  })
  it('quoted job: date approved, quote or "no quote", CO, value, progress', () => {
    expect(ids({ ...done, dateApproved: '', linkedQuoteIds: [], coValue: '', coAttachment: null, jobValue: 0, progress: 80 }))
      .toEqual(['dateApproved', 'quote', 'coValue', 'coAttach', 'jobValue', 'progress'])
  })
  it('"No quote" and "No CO needed" clear those items', () => {
    expect(ids({ ...done, linkedQuoteIds: [], noQuoteNeeded: true, coValue: '', coAttachment: null, noCoNeeded: true })).toEqual([])
  })
  it('T&M jobs skip the quote/CO/value items', () => {
    expect(ids({ type: 'tm', co: 'x', dateStart: '2026-10-01', laborEntries: done.laborEntries })).toEqual([])
  })
  it('labor with no work-completed text is flagged', () => {
    expect(ids({ ...done, laborEntries: [{ hours: 3 }] })).toEqual(['work'])
  })
  it('Billed checks nothing is left to bill', () => {
    expect(ids({ ...done, billedProgress: 50 }, 'billed')).toEqual(['billing'])
    expect(ids({ ...done, billedProgress: 100 }, 'billed')).toEqual([])
  })
  it('keeps only the job-health lines that matter at close-out', () => {
    expect(closeoutHealthLines(['Status not set', 'Materials: 2 slip lines not on the job', 'Plan: 1 line to order, not sent', 'Notes: 1 to address — x', 'Labor: 3 clocked entries not posted to the job']))
      .toEqual(['Materials: 2 slip lines not on the job', 'Notes: 1 to address — x', 'Labor: 3 clocked entries not posted to the job'])
  })
})
