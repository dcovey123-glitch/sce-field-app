// 📋 Stock Check — a list of a job's quote lines to look for in the basement.
//
// Made on the job's 📄 Quoted tab, it goes to the phone (📦 Material → Check)
// with the next sync. For each line you tap:
//   ✓ Have        → the quote line is flagged "📦 Set aside" in the app
//   Some…         → you say how many you have: that many set aside, the rest ↓
//   ✗ Don't have  → the shortfall goes onto the order sheet as a 🛒 Material
//                   order line marked "⏳ To confirm" — it isn't exported until
//                   you confirm it on the desktop
// Set-aside stays a flag only: nothing comes off Stock or onto the job's cost
// until you use 📦 From Stock → Actual (which clears the flag). Changing an
// answer on the phone updates the flag and any still-unconfirmed order line;
// a line you've already confirmed is left alone.
//
// stock_checks: [{ id, jobId, jobName, customerName, quoteId, quoteNumber, quoteTitle,
//   createdAt, closedAt?, lines: [{ id, lineKey, partNo, desc, uom, qty, onHand, stockName,
//   status: '' | 'have' | 'some' | 'missing', haveQty, at, by }] }]

export const STOCK_CHECKS_KEY = 'stock_checks'
const n = v => Number(v) || 0
const r3 = v => Math.round(n(v) * 1000) / 1000

export function makeStockCheck({ job, customerName = '', quote, lines, findStock, uid, now = new Date().toISOString() }) {
  return {
    id: uid(), jobId: job.id, jobName: job.name || 'Job', customerName, quoteId: quote ? quote.id : '', quoteNumber: quote ? quote.quoteNumber || '' : '',
    quoteTitle: quote ? quote.title || '' : '', createdAt: now,
    lines: (lines || []).filter(l => n(l.qty) > 0).map(l => {
      const s = findStock ? findStock(l) : null
      return { id: uid(), lineKey: l.key, quoteId: l.quoteId, quoteNumber: l.quoteNumber || '', quoteTitle: l.quoteTitle || '', lineId: l.lineId || '',
        partNo: l.partNo || '', desc: l.desc || '', uom: l.uom || '', qty: n(l.qty), onHand: s ? n(s.qty) : null, stockName: s ? (s.nickname || s.name || '') : '',
        status: '', haveQty: 0, at: '', by: '' }
    }),
  }
}

// how much of a line is in hand / still to get
export const haveOf = l => l.status === 'have' ? n(l.qty) : l.status === 'some' ? Math.min(n(l.qty), Math.max(0, n(l.haveQty))) : 0
export const shortOf = l => (l.status === 'missing' || l.status === 'some') ? r3(n(l.qty) - haveOf(l)) : 0

export function checkProgress(check) {
  const lines = (check && check.lines) || []
  const answered = lines.filter(l => l.status)
  return {
    total: lines.length, answered: answered.length,
    have: lines.filter(l => l.status === 'have').length,
    short: lines.filter(l => l.status === 'some' || l.status === 'missing').length,
    done: lines.length > 0 && answered.length === lines.length,
  }
}

// An answer from the phone. Returns the new list; ignores answers older than
// what the line already has (so the phone's queue can arrive in any order).
export function applyStockCheckAnswer(checks, op) {
  let changed = null
  const next = (checks || []).map(c => {
    if (c.id !== op.checkId) return c
    const lines = c.lines.map(l => {
      if (l.id !== op.lineId) return l
      if (l.at && op.at && String(op.at) < String(l.at)) return l
      const status = ['have', 'some', 'missing'].includes(op.status) ? op.status : ''
      changed = c.id
      return { ...l, status, haveQty: status === 'some' ? Math.max(0, Math.min(n(l.qty), n(op.haveQty))) : status === 'have' ? n(l.qty) : 0, at: op.at || new Date().toISOString(), by: op.by || '' }
    })
    return { ...c, lines }
  })
  return { checks: next, changedId: changed }
}

// The job's quote lines flagged "Set aside" from a check's answers
export function setAsidePatch(job, check) {
  if (!job || !check || job.id !== check.jobId) return null
  const st = { ...(job.quoteLineState || {}) }
  for (const l of check.lines) {
    const cur = { ...(st[l.lineKey] || {}) }
    const mine = cur.setAside && cur.setAside.checkId === check.id
    const have = haveOf(l)
    if (have > 0) cur.setAside = { qty: have, at: l.at, by: l.by, checkId: check.id }
    else if (mine) delete cur.setAside
    else continue
    if (Object.keys(cur).length) st[l.lineKey] = cur
    else delete st[l.lineKey]
  }
  return { quoteLineState: st }
}

// The order sheet with this check's shortfalls on it ("to confirm")
export const sheetIdOf = (check, line) => `sc-${check.id}-${line.id}`
export function applyCheckToOrderSheet(list, check) {
  let next = [...(list || [])]
  for (const l of check.lines) {
    const id = sheetIdOf(check, l)
    const i = next.findIndex(x => x.id === id)
    const short = shortOf(l)
    if (i >= 0 && !next[i].confirm) continue // already confirmed: yours now
    if (short <= 0) { if (i >= 0) next = next.filter(x => x.id !== id); continue }
    const item = {
      id, qty: short, partNo: l.partNo, desc: l.desc, nickname: '', uom: l.uom, source: 'stockcheck', tag: 'order', confirm: true,
      jobId: check.jobId, jobName: check.jobName, checkedAt: l.at, checkedBy: l.by,
      planRefs: [{ jobId: check.jobId, jobName: check.jobName, lineId: l.lineKey, qty: short, quoteId: l.quoteId, quoteNumber: l.quoteNumber, quoteTitle: l.quoteTitle }],
    }
    if (i >= 0) next[i] = item
    else next.push(item)
  }
  return next
}

// Deleting a list takes its unconfirmed order lines and set-aside flags with it
export function removeCheckFromOrderSheet(list, check) {
  return (list || []).filter(x => !(x.confirm && check.lines.some(l => x.id === sheetIdOf(check, l))))
}
export function clearSetAsidePatch(job, check) {
  const st = { ...(job.quoteLineState || {}) }
  let any = false
  for (const k of Object.keys(st)) {
    if (st[k].setAside && st[k].setAside.checkId === check.id) {
      const cur = { ...st[k] }; delete cur.setAside; any = true
      if (Object.keys(cur).length) st[k] = cur; else delete st[k]
    }
  }
  return any ? { quoteLineState: st } : null
}

// What goes up to the phone: the open lists, lightly
export function stockCheckPayload(checks) {
  return {
    updatedAt: new Date().toISOString(),
    checks: (checks || []).filter(c => !c.closedAt).map(c => ({
      id: c.id, job: c.jobName, customer: c.customerName, quote: c.quoteNumber, at: c.createdAt,
      lines: c.lines.map(l => ({ id: l.id, q: l.qty, u: l.uom, d: l.desc, pn: l.partNo, oh: l.onHand, sn: l.stockName, s: l.status, hq: l.haveQty, at: l.at, by: l.by })),
    })),
  }
}
