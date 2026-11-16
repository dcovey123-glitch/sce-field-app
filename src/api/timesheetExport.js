import { slipPreTax } from './slips.js'
import { weekKeyOf } from './weekStart.js'
// The timesheet's "Material received" export list. Slips in Materials are on
// it by their received date; "Push to export" (Orders → Done) puts a PO on
// this week's list on purpose — its slips, or, when it has no slips, one
// line for the PO itself (kept in timesheet_export_extra).
export const EXPORT_EXTRA_KEY = 'timesheet_export_extra'
export function exportWeekKey(date = new Date()) { return weekKeyOf(date) }
export const normPoKeyTs = s => String(s || '').toLowerCase().replace(/^po\s*#?\s*/, '').replace(/[^0-9a-z]/g, '')

// ── Has an order (Orders & POs row) gone to Jonathan? ──
// Its slips in Materials carry it to the export; with no slips, one line in
// timesheet_export_extra does. Sent = every one of those went out (or you
// marked it sent by hand).
export function slipsForPo(po, matOrders) {
  const k = normPoKeyTs(po)
  return k ? (matOrders || []).filter(m => normPoKeyTs(m.poNumber) === k && m.kind !== 'pricing' && !m.recordOnly && !(m.docType === 'quote' && m.replacedAt)) : []
}
export function orderExportState(o, matOrders, extras) {
  const latest = list => list.map(x => x.sentAt).filter(Boolean).sort().pop() || null
  if (o.sentToJonathan) return { state: 'sent', sentAt: o.sentToJonathan, manual: true }
  const sl = slipsForPo(o.poNumber, matOrders)
  if (sl.length) {
    if (sl.every(m => m.sentAt)) return { state: 'sent', sentAt: latest(sl) }
    const live = sl.filter(m => !m.sentAt)
    // every slip still to go is on an export (a received order has nothing left to receive)
    if (live.every(m => m.receivedAt || m.exportWeek)) return { state: 'on', week: live.map(m => m.exportWeek || (m.receivedAt ? exportWeekKey(new Date(m.receivedAt)) : '')).filter(Boolean).sort().pop() || '' } // the whole PO goes the week the last slip came in
    return { state: 'off' }
  }
  const ex = (extras || []).filter(x => x.feedId === o.id)
  if (!ex.length) return { state: 'off' }
  if (ex.every(x => x.sentAt)) return { state: 'sent', sentAt: latest(ex) }
  return { state: 'on', week: ex.filter(x => !x.sentAt).map(x => x.week).sort()[0] || '' }
}

// ── Who each hour bills to ──
// A job line ("Customer — Job") bills to its customer. Admin / shop / quoting
// time (no job) bills to the day's main customer (most job hours that day;
// otherwise the week's), unless you picked one for that line (billTo).
export const MAIN_CUSTOMER = 'CANA Construction - Red Deer Polytechnic MSA'
export const tsHours = d => (parseFloat(d.reg) || 0) + (parseFloat(d.ot) || 0)
export function entryCustomer(d) {
  const p = String(d.project || '').trim()
  const i = p.indexOf(' — ')
  if (i > 0) return p.slice(0, i).trim()
  if (d.jobId) return p
  return null // not a job: admin / shop / quoting / blank
}
const topOf = (map, fallback) => { let best = fallback, h = -1; map.forEach((v, k) => { if (v > h || (v === h && k === MAIN_CUSTOMER)) { best = k; h = v } }); return best }
export function weekMainCustomer(workers) {
  const m = new Map()
  ;(workers || []).forEach(w => (w.days || []).forEach(day => (Array.isArray(day) ? day : [day]).forEach(d => { const c = entryCustomer(d); if (c) m.set(c, (m.get(c) || 0) + tsHours(d)) })))
  return topOf(m, MAIN_CUSTOMER)
}
export function dayMainCustomer(entries, weekMain) {
  const m = new Map()
  entries.forEach(d => { const c = entryCustomer(d); if (c) m.set(c, (m.get(c) || 0) + tsHours(d)) })
  return m.size ? topOf(m, weekMain) : weekMain
}
// Not-a-job time split over several customers: the first (billTo, or the
// day's main) plus billMore [{ to, hrs }]. A line with hours set takes those;
// the rest is shared evenly by the ones left blank. → [{ customer, frac }]
export function billShares(d, main) {
  const total = tsHours(d)
  const list = [{ to: d.billTo || main, hrs: '' }, ...(d.billMore || []).filter(x => x && x.to)]
  if (list.length === 1 || !total) return [{ customer: list[0].to, frac: 1 }]
  const fixed = list.filter(x => parseFloat(x.hrs) > 0)
  const fixedHrs = Math.min(total, fixed.reduce((a, x) => a + parseFloat(x.hrs), 0))
  const free = list.filter(x => !(parseFloat(x.hrs) > 0))
  const each = free.length ? (total - fixedHrs) / free.length : 0
  const out = new Map()
  list.forEach(x => {
    const h = parseFloat(x.hrs) > 0 ? parseFloat(x.hrs) : each // more hours typed than the line has → scaled to fit
    out.set(x.to, (out.get(x.to) || 0) + h)
  })
  const sum = [...out.values()].reduce((a, v) => a + v, 0) || 1
  return [...out.entries()].map(([customer, h]) => ({ customer, frac: h / sum }))
}
// → [{ customer, reg, ot }] for one day, biggest first
export function dayByCustomer(entries, weekMain) {
  const main = dayMainCustomer(entries, weekMain)
  const m = new Map()
  entries.forEach(d => {
    if (!tsHours(d)) return
    const jc = entryCustomer(d)
    const shares = jc ? [{ customer: jc, frac: 1 }] : billShares(d, main)
    shares.forEach(({ customer: c, frac }) => {
      const cur = m.get(c) || { customer: c, reg: 0, ot: 0 }
      cur.reg += (parseFloat(d.reg) || 0) * frac; cur.ot += (parseFloat(d.ot) || 0) * frac
      m.set(c, cur)
    })
  })
  const r2 = v => Math.round(v * 100) / 100
  return [...m.values()].map(x => ({ ...x, reg: r2(x.reg), ot: r2(x.ot) })).sort((a, b) => (b.reg + b.ot) - (a.reg + a.ot))
}

// ── Material received this week — fully received orders from Materials,
// added to the timesheet export so Jonathan sees them with the week's hours.
// Before GST — Jonathan adds the tax
export function orderTotalForReport(o) { return slipPreTax(o) }
// The week a slip / export line belongs to: the week it was moved or pushed
// to, otherwise the week it was received.
export function itemExportWeek(o) {
  const w = o.exportWeek || (String(o.id).startsWith('x:') ? o.week : '')
  return w || (o.receivedAt ? exportWeekKey(new Date(o.receivedAt)) : '')
}
export function shiftWeek(wk, delta) {
  const d = new Date(wk + 'T00:00:00'); d.setDate(d.getDate() + 7 * delta)
  return exportWeekKey(d)
}

// An order goes to Jonathan as ONE piece: every packing slip on a PO waits
// until the whole PO is received (all backorders in), then they all go on the
// export for the week the last one came in. A slip with no PO goes on its own.
// → Map poKey → { complete, lastAt }
const isFull = o => !!o.receivedAt || !!o.forceReceivedAt || ((o.lineItems || []).length > 0 && (o.lineItems || []).every(li => li.received || li.movedTo))
export function poCompletion(orders) {
  const groups = new Map()
  for (const o of orders || []) {
    if (o.recordOnly || o.kind === 'pricing' || o.archivedNote || (o.docType === 'quote' && o.replacedAt)) continue
    const k = normPoKeyTs(o.poNumber)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  }
  const out = new Map()
  groups.forEach((list, k) => {
    const packing = list.filter(o => o.docType !== 'quote')
    const members = packing.length ? packing : list
    const complete = members.every(isFull)
    const lastAt = members.map(o => o.receivedAt || o.forceReceivedAt || '').filter(Boolean).sort().pop() || null
    out.set(k, { complete, lastAt, count: members.length, waiting: members.filter(o => !isFull(o)).length })
  })
  return out
}

// Material orders received this week, plus any received earlier that never
// went out to Jonathan — so nothing slips through if a week is missed.
export function receivedInWeek(orders, wk, { skipped = false } = {}) {
  const start = new Date(wk + 'T00:00:00').getTime()
  const end = start + 7 * 86400000
  const po = poCompletion(orders)
  // a slip on a PO counts as received when its whole PO is (last slip's date)
  const effReceived = o => {
    const g = o.poNumber ? po.get(normPoKeyTs(o.poNumber)) : null
    if (!g) return o.receivedAt
    return g.complete ? (g.lastAt || o.receivedAt) : null
  }
  return (orders || [])
    .map(o => { const at = effReceived(o); return at === o.receivedAt ? o : { ...o, receivedAt: at || undefined, slipReceivedAt: o.receivedAt } })
    // a quote whose packing slips came in is listed through those slips
    // pushed to this week's export from Orders → Done: on it (unless marked already sent)
    .filter(o => !o.expenseAt) // a receipt sent to the timesheet as an expense isn't material received
    .filter(o => ((o.exportWeek === wk || o.week === wk) && !o.sentManually) || (!o.recordOnly && o.kind !== 'pricing' && o.receivedAt && !(o.docType === 'quote' && o.replacedAt) && (() => {
      // marked sent by hand = off the export; sent with this week's timesheet stays on it (re-export)
      // the week it was put on (moved there from Orders, or pushed) wins over the received date
      const wkOn = o.exportWeek || (String(o.id).startsWith('x:') ? o.week : '')
      const t = wkOn ? new Date(wkOn + 'T00:00:00').getTime() : Date.parse(o.receivedAt); return (t >= start && t < end && (!o.sentAt || o.sentWithWeek === wk)) || (t < start && !o.sentAt)
    })()))
    // taken off this week's export by hand (it carries to next week if still not sent)
    .filter(o => skipped === (o.timesheetSkipWeeks || []).includes(wk))
    .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')))
}
