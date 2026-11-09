// What goes to Jonathan each week: hours by customer, and the material received
import { describe, it, expect } from 'vitest'
import { MAIN_CUSTOMER, entryCustomer, weekMainCustomer, dayMainCustomer, billShares, dayByCustomer, orderTotalForReport, receivedInWeek } from '../src/api/timesheetExport.js'

const RES = 'Red Deer Polytechnic - Residence'
const job = (cust, name, reg, ot = '') => ({ project: `${cust} — ${name}`, jobId: 'j', reg: String(reg), ot: String(ot) })
const admin = (reg, extra = {}) => ({ project: 'Admin / quoting', reg: String(reg), ot: '', ...extra })
const sum = rows => Math.round(rows.reduce((a, r) => a + r.reg + r.ot, 0) * 100) / 100

describe('who each hour bills to', () => {
  it('a job line bills to its customer; admin / shop time has no customer of its own', () => {
    expect(entryCustomer(job(RES, 'Room 214', 3))).toBe(RES)
    expect(entryCustomer(admin(1))).toBeNull()
  })
  it('admin time bills to the day\'s main customer (most job hours that day)', () => {
    const day = [job(RES, 'Room 214', 5), job(MAIN_CUSTOMER, 'B208', 2), admin(1)]
    expect(dayMainCustomer(day, MAIN_CUSTOMER)).toBe(RES)
    expect(dayByCustomer(day, MAIN_CUSTOMER)).toEqual([{ customer: RES, reg: 6, ot: 0 }, { customer: MAIN_CUSTOMER, reg: 2, ot: 0 }])
  })
  it('a day of only admin time bills to the week\'s main customer; a tie goes to the CANA MSA', () => {
    const week = [{ days: [[job(RES, 'A', 4)], [job(MAIN_CUSTOMER, 'B', 4)]] }]
    expect(weekMainCustomer(week)).toBe(MAIN_CUSTOMER)
    expect(dayByCustomer([admin(8)], weekMainCustomer(week))).toEqual([{ customer: MAIN_CUSTOMER, reg: 8, ot: 0 }])
  })
  it('a line can be sent to a different customer by hand', () => {
    expect(dayByCustomer([admin(2, { billTo: RES })], MAIN_CUSTOMER)).toEqual([{ customer: RES, reg: 2, ot: 0 }])
  })
  it('admin time split over customers: typed hours first, the rest shared evenly, never more than the line', () => {
    const d = admin(6, { billTo: MAIN_CUSTOMER, billMore: [{ to: RES, hrs: '2' }, { to: 'Other Co', hrs: '' }] })
    const s = Object.fromEntries(billShares(d, MAIN_CUSTOMER).map(x => [x.customer, Math.round(x.frac * 6 * 100) / 100]))
    expect(s).toEqual({ [MAIN_CUSTOMER]: 2, [RES]: 2, 'Other Co': 2 })
    const over = admin(3, { billMore: [{ to: RES, hrs: '5' }] }) // 5 typed on a 3-hour line
    expect(sum(dayByCustomer([over], MAIN_CUSTOMER))).toBe(3)
  })
  it('overtime stays overtime, and every hour lands somewhere — none lost, none doubled', () => {
    const day = [job(RES, 'A', 8, 2), admin(1.5, { billMore: [{ to: RES, hrs: '' }] })]
    const out = dayByCustomer(day, MAIN_CUSTOMER)
    expect(sum(out)).toBe(11.5)
    expect(out.find(x => x.customer === RES).ot).toBe(2)
  })
})

describe('material received on the weekly export', () => {
  const WK = '2026-11-08' // Sun Nov 8 – Sat Nov 14
  const o = (over = {}) => ({ id: 'o1', kind: 'order', wholesaler: 'Nedco', invoiceNumber: '1', receivedAt: '2026-11-10T15:00:00Z', lineItems: [{ qty: 2, totalPrice: 100 }], ...over })
  it('received this week → on it', () => {
    expect(receivedInWeek([o()], WK).map(x => x.id)).toEqual(['o1'])
  })
  it('received earlier but never sent → carried onto this week, so nothing slips through', () => {
    expect(receivedInWeek([o({ receivedAt: '2026-10-20T15:00:00Z' })], WK)).toHaveLength(1)
  })
  it('already sent, or received next week → not on it', () => {
    expect(receivedInWeek([o({ receivedAt: '2026-10-20T15:00:00Z', sentAt: '2026-10-25' })], WK)).toHaveLength(0)
    expect(receivedInWeek([o({ receivedAt: '2026-11-16T15:00:00Z' })], WK)).toHaveLength(0)
  })
  it('re-exporting the same week keeps what was sent with it', () => {
    expect(receivedInWeek([o({ sentAt: '2026-11-14', sentWithWeek: WK })], WK)).toHaveLength(1)
  })
  it('pricing quotes and a quote replaced by its slips are never on it', () => {
    expect(receivedInWeek([o({ kind: 'pricing' }), o({ id: 'q', docType: 'quote', replacedAt: '2026-11-10' })], WK)).toHaveLength(0)
  })
  it('pushed to this week by hand → on it; taken off by hand → off this week only', () => {
    expect(receivedInWeek([o({ receivedAt: null, exportWeek: WK })], WK)).toHaveLength(1)
    expect(receivedInWeek([o({ timesheetSkipWeeks: [WK] })], WK)).toHaveLength(0)
    expect(receivedInWeek([o({ timesheetSkipWeeks: [WK] })], WK, { skipped: true })).toHaveLength(1)
  })
  it('the amount is before GST: the slip\'s subtotal, else its lines (lines moved to a later slip left out)', () => {
    expect(orderTotalForReport(o({ subtotal: 406.22, tax: 20.31, invoiceTotal: 426.53 }))).toBe(406.22)
    expect(orderTotalForReport(o({ invoiceTotal: 105, tax: 5 }))).toBe(100) // lines 100, never the GST total
    expect(orderTotalForReport(o({ lineItems: [{ qty: 2, totalPrice: 100 }, { qty: 1, cost: 40 }, { qty: 5, totalPrice: 50, movedTo: 'x' }] }))).toBe(140)
  })
})
