// Where a Catalog price came from: the most recent slip / quote with that
// part on it at a price — so you can open the PDF and compare.
import { partNosOf } from './partAliases.js'
import { orderParts } from './orders.js'

const pn = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const nm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const n = v => Number(v) || 0

// → Map key → newest { kind:'slip'|'quote', date, unit, supplier, number, po, order?, quoteNo? }
export function buildPriceIndex(orders = [], feedRows = []) {
  const idx = new Map()
  const put = (keys, src) => keys.filter(Boolean).forEach(k => {
    const cur = idx.get(k)
    if (!cur || String(src.date) > String(cur.date)) idx.set(k, src)
  })
  ;(orders || []).forEach(o => {
    if (o.kind && o.kind !== 'order' && o.kind !== 'pricing') return
    ;(o.lineItems || []).forEach(li => {
      const unit = n(li.cost) || (n(li.totalPrice) && n(li.qty) ? n(li.totalPrice) / n(li.qty) : 0)
      if (!(unit > 0)) return
      put([pn(li.partNo) && 'p:' + pn(li.partNo), nm(li.name) && 'n:' + nm(li.name)], {
        kind: 'slip', date: o.orderDate || String(o.createdAt || '').slice(0, 10), unit, uom: li.uom || '',
        supplier: o.wholesaler || '', number: o.invoiceNumber || '', po: o.poNumber || '', docType: o.docType || '', order: o,
      })
    })
  })
  ;(feedRows || []).forEach(r => {
    orderParts(r).forEach(part => part.lines.forEach(l => {
      const unit = l.qty && l.ext ? l.ext / l.qty : 0
      if (!(unit > 0) || !part.number) return
      put([pn(l.partNo) && 'p:' + pn(l.partNo), nm(l.desc) && 'n:' + nm(l.desc)], {
        kind: 'quote', date: r.date || '', unit, uom: l.uom || '', supplier: r.supplier || '', number: part.number, po: r.poNumber || '', quoteNo: part.number,
      })
    }))
  })
  return idx
}

// Best source for a Catalog / Stock row (part #s first, then the name)
export function priceSourceFor(idx, row) {
  if (!idx) return null
  const nums = [...(row.cat ? partNosOf(row.cat) : []), row.partNo, ...(row.lots || []).map(l => l.partNo)].map(pn).filter(x => x.length >= 3)
  const byPart = [...new Set(nums)].map(x => idx.get('p:' + x)).filter(Boolean)
  const pool = byPart.length ? byPart : [nm(row.name), nm(row.nickname)].filter(Boolean).map(x => idx.get('n:' + x)).filter(Boolean)
  return pool.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null
}
