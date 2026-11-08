import { weekKeyOf } from './weekStart.js'
// The timesheet's "Material received" export list. Slips in Materials are on
// it by their received date; "Push to export" (Orders → Done) puts a PO on
// this week's list on purpose — its slips, or, when it has no slips, one
// line for the PO itself (kept in timesheet_export_extra).
export const EXPORT_EXTRA_KEY = 'timesheet_export_extra'
export function exportWeekKey(date = new Date()) { return weekKeyOf(date) }
export const normPoKeyTs = s => String(s || '').toLowerCase().replace(/^po\s*#?\s*/, '').replace(/[^0-9a-z]/g, '')

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
export function orderTotalForReport(o) {
  if (Number(o.invoiceTotal)) return Number(o.invoiceTotal)
  return (o.lineItems || []).filter(li => !li.movedTo).reduce((a, li) => a + (Number(li.totalPrice) || (Number(li.qty) || 0) * (Number(li.cost) || 0)), 0)
}
// Material orders received this week, plus any received earlier that never
// went out to Jonathan — so nothing slips through if a week is missed.
export function receivedInWeek(orders, wk, { skipped = false } = {}) {
  const start = new Date(wk + 'T00:00:00').getTime()
  const end = start + 7 * 86400000
  return (orders || [])
    // a quote whose packing slips came in is listed through those slips
    // pushed to this week's export from Orders → Done: on it (unless marked already sent)
    .filter(o => ((o.exportWeek === wk || o.week === wk) && !o.sentManually) || (!o.recordOnly && o.kind !== 'pricing' && o.receivedAt && !(o.docType === 'quote' && o.replacedAt) && (() => {
      // marked sent by hand = off the export; sent with this week's timesheet stays on it (re-export)
      const t = Date.parse(o.receivedAt); return (t >= start && t < end && (!o.sentAt || o.sentWithWeek === wk)) || (t < start && !o.sentAt)
    })()))
    // taken off this week's export by hand (it carries to next week if still not sent)
    .filter(o => skipped === (o.timesheetSkipWeeks || []).includes(wk))
    .sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')))
}
