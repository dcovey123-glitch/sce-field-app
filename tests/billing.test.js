// Checks on the money maths. Run with:  npm test
import { describe, it, expect } from 'vitest'
import {
  TM_MATERIAL_MARKUP, tmTotal, tmBilledAmount, effectiveJobTotal, unbilledAmount,
  billingWhen, billingEntries, progressBillPatch, tmBillPatch, undoLastBillingPatch, removeBillingEntryPatch,
} from '../src/api/billing.js'

const apply = (p, patch) => ({ ...p, ...patch })

describe('job totals', () => {
  it('T&M total = labour + materials with the 15% markup', () => {
    expect(TM_MATERIAL_MARKUP).toBe(0.15)
    expect(tmTotal({ actualLabor: 180, actualMaterials: 190.88 })).toBe(399.51)
    expect(effectiveJobTotal({ type: 'tm', actualLabor: 1584, actualMaterials: 272.9223 })).toBe(1897.86)
  })
  it('quoted total uses job value, then CO value', () => {
    expect(effectiveJobTotal({ type: 'quoted', jobValue: 5000, coValue: 4000 })).toBe(5000)
    expect(effectiveJobTotal({ type: 'quoted', coValue: 4578.65 })).toBe(4578.65)
    expect(effectiveJobTotal({ type: 'quoted' })).toBe(0)
  })
  it('warranty jobs are never owed money', () => {
    const p = { type: 'warranty', actualLabor: 1080, jobValue: 900 }
    expect(effectiveJobTotal(p)).toBe(0)
    expect(unbilledAmount(p)).toBe(0)
  })
})

describe('sending a T&M job for billing', () => {
  it('always includes the materials markup (the Residence at-cost mistake)', () => {
    const job = { type: 'tm', actualLabor: 180, actualMaterials: 190.88 }
    const after = apply(job, tmBillPatch(job))
    expect(after.billingHistory[0].amount).toBe(399.51) // not 370.88 (at cost)
    expect(unbilledAmount(after)).toBe(0)
  })
  it('only sends what is new since last time', () => {
    let job = { type: 'tm', actualLabor: 900, actualMaterials: 100 }
    job = apply(job, tmBillPatch(job))             // 900 + 115 = 1015
    job = { ...job, actualLabor: 1350 }            // 5 more hours
    const patch = tmBillPatch(job)
    expect(patch.billingHistory.at(-1).amount).toBe(450)
    expect(apply(job, patch).billedAmount).toBe(1465)
  })
  it('nothing to send means no entry', () => {
    expect(tmBillPatch({ type: 'tm', actualLabor: 0 })).toBeNull()
  })
  it('a T&M job cannot be billed by percent of a fixed value', () => {
    expect(progressBillPatch({ type: 'tm', jobValue: 370.88 }, 100, 370.88)).toBeNull()
  })
  it('warranty jobs cannot be sent for billing', () => {
    expect(tmBillPatch({ type: 'warranty', actualLabor: 500 })).toBeNull()
    expect(progressBillPatch({ type: 'warranty', jobValue: 500 }, 100, 500)).toBeNull()
  })
})

describe('sending a quoted job for billing', () => {
  it('bills by progress and tracks % and what is left', () => {
    let job = { type: 'quoted', coValue: 4578.65 }
    job = apply(job, progressBillPatch(job, 70, 3205.06))
    expect(job.billedProgress).toBe(70)
    expect(unbilledAmount(job)).toBeCloseTo(1373.6, 1)
    job = apply(job, progressBillPatch(job, 100, 1373.6))
    expect(job.billedProgress).toBe(100)
    expect(unbilledAmount(job)).toBeCloseTo(0, 5)
  })
  it('will not bill backwards or twice to the same %', () => {
    const job = { type: 'quoted', jobValue: 1000, billedProgress: 80 }
    expect(progressBillPatch(job, 80, 0)).toBeNull()
    expect(progressBillPatch(job, 50, 0)).toBeNull()
  })
})

describe('undo', () => {
  it('undo last entry puts % and $ back from the remaining history', () => {
    let job = { type: 'quoted', coValue: 4578.65 }
    job = apply(job, progressBillPatch(job, 70, 3205.06, '2026-07'))
    job = apply(job, progressBillPatch(job, 100, 1373.6, '2026-09'))
    job = apply(job, undoLastBillingPatch(job))
    expect(job.billingHistory).toHaveLength(1)
    expect(job.billedProgress).toBe(70)
  })
  it('T&M undo puts the dollars back', () => {
    let job = { type: 'tm', actualLabor: 1000 }
    job = apply(job, tmBillPatch(job))
    job = apply(job, undoLastBillingPatch(job))
    expect(job.billedAmount).toBe(0)
    expect(unbilledAmount(job)).toBe(1000)
  })
  it('Billing screen undo of one row matches', () => {
    let job = { type: 'tm', actualLabor: 500 }
    job = apply(job, tmBillPatch(job))
    job = { ...job, actualLabor: 800 }
    job = apply(job, tmBillPatch(job))
    const first = job.billingHistory[0].id
    job = apply(job, removeBillingEntryPatch(job, first))
    expect(job.billedAmount).toBe(300)
    expect(tmBilledAmount(job)).toBe(300)
    expect(unbilledAmount(job)).toBe(500)
  })
  it('nothing to undo returns null', () => {
    expect(undoLastBillingPatch({ type: 'tm' })).toBeNull()
    expect(removeBillingEntryPatch({ billingHistory: [] }, 'x')).toBeNull()
  })
})

describe('billing dates', () => {
  it('"Invoiced on" a past month files it on that month\'s last day', () => {
    expect(billingWhen('2026-08')).toMatchObject({ day: '2026-08-31', monthKey: '2026-08' })
    expect(billingWhen('2026-02')).toMatchObject({ day: '2026-02-28', monthKey: '2026-02' })
  })
  it('history lists oldest first, each with the % it was billed from', () => {
    const e = billingEntries({ billingHistory: [
      { id: 'b', date: '2026-09-30', percent: 100 },
      { id: 'a', date: '2026-07-27', percent: 70 },
    ] })
    expect(e.map(x => [x.id, x.fromPercent, x.percent])).toEqual([['a', 0, 70], ['b', 70, 100]])
  })
})

describe('billed = the dollars actually sent', () => {
  it('value goes up after part was billed (combined sub-job, bigger CO): nothing is lost', async () => {
    const { quotedBilledAmount, amountToBill } = await import('../src/api/billing.js')
    let job = { type: 'quoted', jobValue: 50000 }
    job = apply(job, progressBillPatch(job, 40, 20000))
    // Arena Materials ($20,000) combined in → $70,000
    const all = [job, { id: 's', type: 'quoted', coValue: 20000, relatedJobId: job.id || 'm', foldIntoParent: true }]
    job.id = 'm'; all[0] = job
    expect(effectiveJobTotal(job, all)).toBe(70000)
    expect(quotedBilledAmount(job, 70000)).toBe(20000)
    expect(unbilledAmount(job, all)).toBe(50000)
    // the same 40% now owes the $8,000 difference; to 100% sends the rest
    expect(amountToBill(job, 40, 70000)).toBe(8000)
    expect(amountToBill(job, 100, 70000)).toBe(50000)
    const again = progressBillPatch(job, 40, 8000)
    expect(again).not.toBeNull()
    job = apply(job, again)
    job = apply(job, progressBillPatch(job, 100, amountToBill(job, 100, 70000)))
    expect(unbilledAmount(job, all)).toBe(0)
    expect(job.billingHistory.reduce((s, h) => s + h.amount, 0)).toBe(70000)
  })
  it('an old entry saved with no amount counts as its % of today\'s value', async () => {
    const { quotedBilledAmount } = await import('../src/api/billing.js')
    const job = { type: 'quoted', jobValue: 1000, billingHistory: [{ id: 'a', date: '2026-01-01', percent: 30, amount: 0 }, { id: 'b', date: '2026-02-01', percent: 50, amount: 200 }] }
    expect(quotedBilledAmount(job, 1000)).toBe(500)
  })
  it('no history but a billed % (very old jobs) still works off the %', () => {
    expect(unbilledAmount({ type: 'quoted', jobValue: 1000, billedProgress: 80 }, [])).toBe(200)
  })
})
