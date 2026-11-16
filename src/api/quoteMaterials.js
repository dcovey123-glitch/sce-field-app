// A job's material, with its quote as the reference (replaces the old Plan).
//
// The job's Materials → Quoted tab lists every material line on its linked
// quote(s). From there each line goes:
//   → Order sheet, tagged 🛒 Material order or 💲 Pricing (you must pick one)
//   → Materials Actual (you already have it / took it from Stock)
//   ✕ Not needed
// or is sent straight from the job to a wholesaler (an order for this job).
// Where each line is at is worked out from the order sheet and the requests
// sent — every sheet / request line remembers the quote line it came from
// (planRefs: [{ jobId, jobName, lineId: <quote line key>, qty, quoteId, quoteNumber, quoteTitle }]).
// "To Actual" comes from the job's Materials Actual lines that carry the quote
// line's key (delete the line there and the quote line shows open again).
// Only "Not needed" is kept on the job itself (job.quoteLineState).

const n = v => Number(v) || 0
const lc = s => String(s || '').trim().toLowerCase()

export const lineKeyOf = (quote, m, i) => `${quote.id}:${m.id || 'i' + i}`

// Every material line on a quote, flat
export function quoteLines(quote) {
  if (!quote) return []
  const out = []
  ;(quote.scopes || []).forEach((sc, si) => {
    ;(sc.materials || []).forEach((m, i) => {
      out.push({
        key: lineKeyOf(quote, m, `${si}-${i}`), quoteId: quote.id, quoteNumber: quote.quoteNumber || '', quoteTitle: quote.title || '',
        scope: sc.name || `Scope ${si + 1}`, partNo: m.partNo || '', desc: m.desc || '', uom: m.uom || '', qty: n(m.qty), rate: n(m.rate), lineId: m.id || '',
      })
    })
  })
  return out
}

// Old Plan lines that came from a quote line: plan line id → quote line key
// (so anything already on the order sheet or sent still shows on its line)
export function legacyKeys(job) {
  const map = {}
  ;(job.plannedMaterials || []).forEach(l => { if (l.sourceQuoteId && l.sourceLineId) map[l.id] = `${l.sourceQuoteId}:${l.sourceLineId}` })
  return map
}

const refHits = (job, line, legacy) => p => p.jobId === job.id && (p.lineId === line.key || legacy[p.lineId] === line.key)
const isPricingItem = i => i.tag === 'pricing'
const isPricingReq = r => !!r.pricing

// Where one quote line is at → { chips: [{ id, label, tone }], done: bool, qtyOut }
export function quoteLineStatus(job, line, { orderList = [], requests = [], legacy = legacyKeys(job) } = {}) {
  const st = (job.quoteLineState || {})[line.key] || {}
  const hit = refHits(job, line, legacy)
  const chips = []
  let qtyOrdered = 0
  for (const r of (requests || []).filter(x => !x.removedAt)) {
    const refs = (r.items || []).flatMap(i => (i.planRefs || []).filter(hit))
    if (!refs.length) continue
    const q = refs.reduce((a, p) => a + n(p.qty), 0)
    const day = String(r.sentAt || '').slice(5, 10).replace('-', '/')
    if (isPricingReq(r)) chips.push({ id: 'pricing-sent', tone: 'info', label: `💲 Pricing ${r.matchedFeedId || r.matchedSlipId ? 'back' : 'asked'} — ${r.wholesaler || 'supplier'} ${day}` })
    else { qtyOrdered += q; chips.push({ id: 'ordered', tone: 'ok', label: `🛒 Ordered ${q} — ${r.wholesaler || 'supplier'} ${day}${r.phoned ? ' 📞' : ''}` }) }
  }
  for (const i of orderList || []) {
    const refs = (i.planRefs || []).filter(hit)
    if (!refs.length) continue
    const q = refs.reduce((a, p) => a + n(p.qty), 0)
    chips.push({ id: isPricingItem(i) ? 'sheet-pricing' : 'sheet-order', tone: 'muted', label: `📝 On order sheet — ${isPricingItem(i) ? '💲 Pricing' : '🛒 Order'} (${q})` })
  }
  const actualQty = (job.materialEntries || []).filter(e => e.quoteLineKey === line.key || (e.sourceQuoteId && e.sourceLineId && `${e.sourceQuoteId}:${e.sourceLineId}` === line.key)).reduce((a, e) => a + n(e.qty), 0)
  if (actualQty > 0) chips.push({ id: 'actual', tone: 'ok', label: `✓ To Actual (${actualQty})` })
  if (st.notNeeded) chips.push({ id: 'notneeded', tone: 'muted', label: '✕ Not needed' })
  const covered = qtyOrdered + actualQty
  if (!st.notNeeded && covered > 0 && covered < line.qty) chips.push({ id: 'short', tone: 'warn', label: `${line.qty - covered} of ${line.qty} not ordered` })
  const done = !!st.notNeeded || covered >= line.qty
  if (!chips.length) chips.push({ id: 'none', tone: 'warn', label: 'Not ordered' })
  return { chips, done, qtyOrdered, notNeeded: !!st.notNeeded, actualQty }
}

export function quoteLinesSummary(statuses) {
  const has = id => statuses.filter(s => s.chips.some(c => c.id === id)).length
  return {
    total: statuses.length,
    open: statuses.filter(s => !s.done).length,
    ordered: has('ordered'), pricing: has('pricing-sent'), onSheet: has('sheet-order') + has('sheet-pricing'),
    actual: has('actual'), notNeeded: has('notneeded'), notOrdered: has('none'),
  }
}

// Put quote lines on the order sheet with a tag. Same part (and, for
// pricing, the same quote) merges into one sheet line; each sheet line
// remembers which job's quote lines it covers.
export function addQuoteLinesToOrderList(list, job, lines, tag, uid) {
  let next = [...(list || [])]
  for (const l of lines) {
    const ref = { jobId: job.id, jobName: job.name || 'Job', lineId: l.key, qty: n(l.qty), quoteId: l.quoteId, quoteNumber: l.quoteNumber, quoteTitle: l.quoteTitle }
    const same = x => (x.tag || 'order') === tag && (tag !== 'pricing' || (x.quote && x.quote.id) === l.quoteId)
      && ((l.partNo && lc(x.partNo) === lc(l.partNo)) || (!l.partNo && lc(x.desc) === lc(l.desc))) && (x.uom || '') === (l.uom || '')
    const i = next.findIndex(x => (x.planRefs || []).length && same(x))
    if (i >= 0) {
      const x = next[i]
      const refs = [...(x.planRefs || []).filter(p => !(p.jobId === job.id && p.lineId === l.key)), ref]
      next[i] = { ...x, qty: refs.reduce((a, p) => a + n(p.qty), 0), planRefs: refs, ...jobLabelOf(refs) }
    } else {
      next = [...next, {
        id: uid(), qty: n(l.qty), partNo: l.partNo || '', desc: l.desc || '', nickname: '', uom: l.uom || '', source: 'quote', tag,
        ...(tag === 'pricing' ? { quote: { id: l.quoteId, number: l.quoteNumber, title: l.quoteTitle } } : {}),
        planRefs: [ref], ...jobLabelOf([ref]),
      }]
    }
  }
  return next
}
function jobLabelOf(refs) {
  const byJob = new Map()
  ;(refs || []).forEach(p => byJob.set(p.jobId, { name: p.jobName, qty: (byJob.get(p.jobId)?.qty || 0) + n(p.qty) }))
  const list = [...byJob.entries()]
  return list.length === 1 ? { jobId: list[0][0], jobName: list[0][1].name } : { jobId: '', jobName: list.map(([, v]) => `${v.name} (${v.qty})`).join(' · ') }
}

// The order sheet split for display: material orders, then pricing by quote
export function splitOrderSheet(items) {
  const order = (items || []).filter(i => i.tag !== 'pricing')
  const pricing = (items || []).filter(i => i.tag === 'pricing')
  const groups = new Map()
  pricing.forEach(i => {
    const k = (i.quote && i.quote.id) || ''
    if (!groups.has(k)) groups.set(k, { quote: i.quote || null, items: [] })
    groups.get(k).items.push(i)
  })
  return { order, pricingGroups: [...groups.values()] }
}

// Which customer quote a purchase (pricing) belongs to, if any
export function purchaseQuoteRef(p) {
  const rq = (p.requests || []).find(r => r.quote && (r.quote.id || r.quote.number))
  if (rq) return rq.quote
  const sl = (p.slips || []).find(o => o.pricingTarget && o.pricingTarget.type === 'quote')
  if (sl) return { id: sl.pricingTarget.quoteId, number: sl.pricingTarget.quoteNumber || '', title: sl.pricingTarget.title || '' }
  return null
}
