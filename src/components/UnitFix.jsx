import React, { useState } from 'react'
import { normalizeLine, isBundleUnit, proposeUnitFixes, PRICE_UNITS } from '../api/units.js'
import { moneyUnit as money } from '../api/format.js'

// One-time clean-up for prices that came in per KM / per 1000 ft / per 100.
// Slip lines are fixed from their printed line totals (always right). Catalog,
// Stock and job lines are shown with the proposed per-m / per-ft / each price
// so you can tick which ones to divide; anything unticked just gets the
// right unit label (it was already priced per metre/foot/each).

const num = v => Number(v) || 0
const r4 = v => Math.round(v * 10000) / 10000
const cleanU = u => String(u || '').trim().toUpperCase()

export function findUnitFixes({ orders, catalog, stock, jobs, quotes }) {
  const orderFixes = []
  ;(orders || []).forEach(o => (o.lineItems || []).forEach((li, idx) => {
    if (!isBundleUnit(li.uom) && !(li.cost != null && li.cost !== '')) return
    const n = normalizeLine(li)
    if (!isBundleUnit(li.uom) && !n.priceUom) return
    if (n.uom === li.uom && Math.abs(num(n.cost) - num(li.cost)) < 0.00005 && num(n.qty) === num(li.qty)) return
    orderFixes.push({ order: o, idx, li, n })
  }))
  const catFixes = proposeUnitFixes(catalog, 'refCost')
  const stockFixes = proposeUnitFixes(stock, 'cost')
  const jobFixes = []
  ;(jobs || []).filter(j => !j.trashedAt).forEach(j => (j.materialEntries || []).forEach(e => {
    if (e.slipOrderId || !isBundleUnit(e.uom)) return
    const pu = PRICE_UNITS[cleanU(e.uom)]
    const to = { uom: pu.base, price: r4(num(e.price) / pu.per) }
    jobFixes.push({ job: j, e, to, label: pu.label, likely: num(e.price) > 0 ? to.price >= 0.01 : true })
  }))
  const quoteFlags = []
  ;(quotes || []).filter(q => !q.trashedAt).forEach(q => {
    const n = (q.scopes || []).reduce((a, s) => a + (s.materials || []).filter(m => isBundleUnit(m.uom)).length, 0)
    if (n) quoteFlags.push({ quote: q, count: n })
  })
  const count = orderFixes.length + catFixes.length + stockFixes.length + jobFixes.length
  return { orderFixes, catFixes, stockFixes, jobFixes, quoteFlags, count }
}

export default function UnitFixModal({ fixes, onApply, onClose }) {
  const key = (kind, id) => `${kind}:${id}`
  const [divide, setDivide] = useState(() => {
    const m = {}
    fixes.catFixes.forEach(f => { m[key('c', f.item.id)] = f.likely })
    fixes.stockFixes.forEach(f => { m[key('s', f.item.id)] = f.likely })
    fixes.jobFixes.forEach(f => { m[key('j', f.job.id + '/' + f.e.id)] = f.likely })
    return m
  })
  const cell = { padding: '4px 6px', borderTop: '1px solid var(--border)', fontSize: 12 }
  const head = t => <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '12px 0 4px' }}>{t}</div>
  const tick = k => <input type="checkbox" checked={!!divide[k]} onChange={e => setDivide(d => ({ ...d, [k]: e.target.checked }))} />
  const row = (k, what, from, f) => (
    <tr key={k}>
      <td style={{ ...cell, width: 24 }}>{tick(k)}</td>
      <td style={cell}>{what}</td>
      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(from.price)} / {from.uom}</td>
      <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-light)' }}>({f.label})</td>
      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: divide[k] ? 700 : 400 }}>
        {divide[k] ? <>{money(f.to.price)} / {f.to.uom}</> : <span style={{ color: 'var(--text-light)' }}>{money(from.price)} / {f.to.uom} (label only)</span>}
      </td>
    </tr>
  )
  const name = i => `${i.partNo ? i.partNo + ' ' : ''}${i.nickname || i.name || i.item || ''}`

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 860, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>Fix prices that came in per KM / per 1000 ft / per 100</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '4px 0 6px' }}>
          Wholesalers price wire per 1000 m, pipe per 1000 ft and some fittings per 100, but the quantity on the same line is already in metres, feet or each.
          Everything is switched to a price per <b>M</b>, <b>FT</b> or <b>EA</b>. Tick a line to divide its price; untick it if it was already per metre/foot/each (it just gets the right unit).
        </div>

        {fixes.orderFixes.length > 0 && <>
          {head(`Slip lines (${fixes.orderFixes.length}) — fixed from the printed line totals`)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {fixes.orderFixes.map(f => (
              <tr key={f.order.id + '/' + f.idx}>
                <td style={cell}>{f.order.wholesaler}{f.order.invoiceNumber ? ` #${f.order.invoiceNumber}` : ''} — {name(f.li)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{f.li.qty} {f.li.uom} @ {money(f.li.cost)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>→ {f.n.qty} {f.n.uom} @ {money(f.n.cost)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-light)' }}>line {money(f.li.totalPrice)}</td>
              </tr>
            ))}
          </tbody></table>
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 3 }}>Job materials taken from these slips are corrected too.</div>
        </>}

        {fixes.catFixes.length > 0 && <>{head(`Catalog (${fixes.catFixes.length})`)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{fixes.catFixes.map(f => row(key('c', f.item.id), name(f.item), f.from, f))}</tbody></table></>}
        {fixes.stockFixes.length > 0 && <>{head(`Stock (${fixes.stockFixes.length})`)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{fixes.stockFixes.map(f => row(key('s', f.item.id), `${name(f.item)} · ${f.item.qty ?? 0} on hand`, f.from, f))}</tbody></table></>}
        {fixes.jobFixes.length > 0 && <>{head(`Job material lines (${fixes.jobFixes.length})`)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{fixes.jobFixes.map(f => row(key('j', f.job.id + '/' + f.e.id), `${f.job.name} — ${f.e.qty} × ${name(f.e)}`, { price: f.e.price, uom: f.e.uom }, f))}</tbody></table></>}

        {fixes.quoteFlags.length > 0 && (
          <div style={{ marginTop: 12, padding: '8px 10px', background: '#fff8e6', border: '1px solid #e0a716', borderRadius: 6, fontSize: 12 }}>
            ⚠ Quotes with material lines in KM / 1000 ft / per 100 — open them and check the rates (not changed here, since some may already be sent):{' '}
            {fixes.quoteFlags.map(q => `${q.quote.quoteNumber}${q.quote.title ? ' ' + q.quote.title : ''} (${q.count})`).join(', ')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Not now</button>
          <button onClick={() => { onApply(divide); onClose() }}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
            Apply fixes
          </button>
        </div>
      </div>
    </div>
  )
}
