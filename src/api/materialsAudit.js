// Material checks: what's wrong between slips, jobs and Stock, each with a
// one-click fix where the right answer is clear. Used by Needs you (Today)
// and on a job's Materials Actual.
import {
  slipKind, isReplacedQuote, lineUse, lineJobsOf, slipLineKey, jobEntriesFromSlip, GENERAL_STOCK_ID,
} from './slips.js'

const n = v => Number(v) || 0
const pn = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const nm = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14)
const nameWords = t => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9"/ ]/g, ' ').split(/\s+/).filter(w => w.length >= 3))
const money = v => '$' + n(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const unitOf = li => (n(li.totalPrice) && n(li.qty) ? n(li.totalPrice) / n(li.qty) : n(li.cost))
export const isOpenJob = j => !j.trashedAt && j.lifecycleStatus !== 'billed'
const label = o => `${String(o.wholesaler || '').split(/[\s(-]/)[0] || 'Slip'} #${o.invoiceNumber || '—'}${o.poNumber ? ' · PO ' + String(o.poNumber).replace(/^po\s*#?\s*/i, '') : ''}`

// Same check as the job page's "Counted twice?" warning: a hand / Stock entry
// with the same qty, price and a shared word as a slip entry
export function slipDuplicateOf(e, entries) {
  if (String(e.orderKey || '').startsWith('slip:')) return null
  const q = n(e.qty), pr = n(e.price)
  if (!q) return null
  const mine = nameWords(`${e.partNo || ''} ${e.item || ''}`)
  return entries.find(x => x !== e && String(x.orderKey || '').startsWith('slip:') && Math.abs(n(x.qty) - q) < 0.001
    && Math.abs(n(x.price) - pr) < 0.011 && [...nameWords(`${x.partNo || ''} ${x.item || ''}`)].some(w => mine.has(w))) || null
}

// Slip lines that say they were used on this job, but aren't on its list
// (and aren't on it some other way — by hand, or from Stock)
export function missingSlipCharges(orders, job) {
  const entries = job.materialEntries || []
  const out = []
  ;(orders || []).forEach(o => {
    if (slipKind(o) !== 'order' || o.archivedNote || isReplacedQuote(o, orders)) return
    ;(o.lineItems || []).forEach((li, idx) => {
      if (li.movedTo || !lineJobsOf(o, li).includes(job.id)) return
      const q = n(lineUse(o, li)[job.id])
      if (!(q > 0)) return
      const key = slipLineKey(o.id, li, idx)
      const got = entries.filter(e => e.orderKey === key).reduce((a, e) => a + n(e.qty), 0)
      if (Math.abs(got - q) <= 0.001 || got > 0) return
      const other = entries.some(e => e.orderKey !== key && ((pn(e.partNo) && pn(e.partNo) === pn(li.partNo)) || (nm(e.item).length >= 8 && (nm(e.item) === nm(li.name) || nm(e.item) === nm(li.nickname)))))
      if (other) return
      out.push({ order: o, li, idx, key, qty: q, value: Math.round(q * unitOf(li) * 100) / 100 })
    })
  })
  return out
}

// Put those lines on the job (as the slip says). → new entries
export function addMissingSlipCharges(orders, job, uid) {
  const miss = missingSlipCharges(orders, job)
  if (!miss.length) return null
  const keys = new Set(miss.map(m => m.key))
  const adds = [...new Set(miss.map(m => m.order))].flatMap(o => jobEntriesFromSlip(o, job.id, uid)).filter(e => keys.has(e.orderKey))
  return [...(job.materialEntries || []), ...adds]
}

// Everything to look at, as Needs you lines. fix(ctx) does the fix; ctx has
// { updateJob(id, patchOrFn), setStock(fn), setOrders(fn), uid, adjustStockDraw }
export function materialFindings({ orders = [], jobs = [], stock = [] }) {
  const items = []
  const custOf = j => j._customer || ''
  jobs.filter(isOpenJob).forEach(j => {
    const entries = j.materialEntries || []
    // 1. On the slip, not on the job
    const miss = missingSlipCharges(orders, j)
    if (miss.length) {
      const total = miss.reduce((a, m) => a + m.value, 0)
      items.push({
        key: 'mat-missing:' + j.id + ':' + miss.map(m => m.key).join(','), tone: j.type === 'tm' ? 'bad' : 'warn',
        text: `${j.name}: ${miss.length} slip line${miss.length === 1 ? '' : 's'} not on the job${total ? ' · ' + money(total) : ''}`,
        detail: `${custOf(j)}${custOf(j) ? ' · ' : ''}${[...new Set(miss.map(m => label(m.order)))].join(', ')} — ${miss.slice(0, 3).map(m => `${m.qty} ${m.li.partNo || m.li.name}`).join(', ')}${miss.length > 3 ? '…' : ''}`,
        fixLabel: 'Add to job', job: j,
        fix: ({ updateJob, uid }) => updateJob(j.id, cur => {
          const next = addMissingSlipCharges(orders, { ...j, ...cur, materialEntries: cur.materialEntries || [] }, uid)
          return next ? { materialEntries: next, actualMaterials: Math.round(next.reduce((a, e) => a + (n(e.qty) || 1) * n(e.price), 0) * 100) / 100 } : {}
        }),
      })
    }
    // 2. Charged twice: a hand / Stock entry that matches a slip entry
    const dups = entries.map(e => ({ e, slip: slipDuplicateOf(e, entries) })).filter(x => x.slip)
    if (dups.length) {
      const total = dups.reduce((a, x) => a + n(x.e.qty) * n(x.e.price), 0)
      items.push({
        key: 'mat-dup:' + j.id + ':' + dups.map(x => x.e.id).join(','), tone: j.type === 'tm' ? 'bad' : 'warn',
        text: `${j.name}: ${dups.length} item${dups.length === 1 ? '' : 's'} charged twice${total ? ' · ' + money(total) : ''}`,
        detail: `${dups.slice(0, 3).map(x => `${x.e.qty} ${x.e.item}`).join(', ')}${dups.length > 3 ? '…' : ''} — also on ${[...new Set(dups.map(x => String(x.slip.source || 'a slip').split(' · ').filter(t => !/^Inv /.test(t)).slice(0, 2).join(' ')))].slice(0, 3).join(', ')}. Removes the extra copies${dups.some(x => x.e.stockId) ? ' (Stock draws go back on the shelf)' : ''}.`,
        fixLabel: 'Remove extras', job: j,
        fix: ({ updateJob, setStock, adjustStockDraw }) => {
          const ids = new Set(dups.map(x => x.e.id))
          const back = dups.filter(x => x.e.stockId).map(x => x.e)
          if (back.length && setStock) setStock(list => back.reduce((acc, e) => adjustStockDraw(acc, e, 0).list, list || []))
          return updateJob(j.id, cur => {
            const next = (cur.materialEntries || []).filter(e => !ids.has(e.id))
            return { materialEntries: next, actualMaterials: Math.round(next.reduce((a, e) => a + (n(e.qty) || 1) * n(e.price), 0) * 100) / 100 }
          })
        },
      })
    }
  })
  // 3. The same slip saved more than once (exact copies)
  const seen = new Map()
  orders.filter(o => o.invoiceNumber && slipKind(o) === 'order').forEach(o => {
    const sig = [String(o.wholesaler || '').toLowerCase().slice(0, 5), String(o.invoiceNumber).toLowerCase(), (o.lineItems || []).map(li => `${pn(li.partNo)}:${n(li.qty)}`).join(',')].join('|')
    if (!seen.has(sig)) seen.set(sig, []); seen.get(sig).push(o)
  })
  ;[...seen.values()].filter(l => l.length > 1).forEach(l => {
    const score = o => (o.lineItems || []).filter(li => li.usedBy || (li.jobIds || []).length || li.received).length + (o.sentAt ? 2 : 0) + (o.files || o.file ? 1 : 0)
    const keep = l.slice().sort((a, b) => score(b) - score(a))[0]
    const extra = l.filter(o => o !== keep)
    items.push({
      key: 'mat-copies:' + l.map(o => o.id).join(','), tone: 'info',
      text: `${label(keep)} is saved ${l.length} times`, detail: `Same supplier, number and lines. Keeps the one with the most filled in; deletes ${extra.length}.`,
      fixLabel: 'Delete copies',
      fix: ({ setOrders }) => setOrders(list => (list || []).filter(o => !extra.some(x => x.id === o.id))),
    })
  })
  // 4. Lines with no price (open slips only)
  orders.filter(o => slipKind(o) === 'order' && !o.archivedNote && !isReplacedQuote(o, orders)).forEach(o => {
    const noPrice = (o.lineItems || []).filter(li => !li.movedTo && !(n(li.totalPrice) > 0) && !(n(li.cost) > 0))
    if (noPrice.length) items.push({ key: 'mat-noprice:' + o.id, tone: 'info', text: `${label(o)}: ${noPrice.length} line${noPrice.length === 1 ? '' : 's'} with no price`, detail: noPrice.slice(0, 3).map(li => `${li.qty} ${li.partNo || li.name}`).join(', '), goLabel: 'Orders', go: { hub: 'materials', view: 'ordered' } })
  })
  // 5. Stock with no cost
  const noCost = (stock || []).filter(s => n(s.qty) > 0 && !(n(s.cost) > 0) && !(n(s.unitCost) > 0) && !(n(s.price) > 0))
  if (noCost.length) items.push({ key: 'mat-stockcost:' + noCost.map(s => s.id).join(','), tone: 'info', text: `${noCost.length} Stock item${noCost.length === 1 ? '' : 's'} with no cost`, detail: noCost.slice(0, 4).map(s => s.nickname || s.name || s.partNo).join(', '), goLabel: 'Stock', go: { hub: 'materials', view: 'stock' } })
  return items
}
export { GENERAL_STOCK_ID }
