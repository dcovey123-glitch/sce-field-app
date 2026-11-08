import React, { useState } from 'react'
import { partNosOf, priceByRule } from '../api/partAliases.js'

// Catalog duplicates: the same part entered more than once (same part #, or
// the same description when there's no part #). Merging keeps one Catalog
// part, moves the others' price history onto it, re-links their Stock (each
// stock record stays its own lot, e.g. Box 1, Box 2…) and moves the extra
// Catalog entries to the Trash.

const norm = s => String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '')
const normDesc = s => String(s || '').toLowerCase().replace(/[^0-9a-z]+/g, ' ').trim()
const money = v => '$' + (Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const r4 = v => Math.round(v * 10000) / 10000
const FT_PER_M = 3.28084
// price per `from` unit → price per `to` unit (only M ↔ FT converts)
function convPrice(p, from, to) {
  const f = String(from || '').toUpperCase(), t = String(to || '').toUpperCase()
  if (f === t) return Number(p) || 0
  if (f === 'M' && t === 'FT') return r4((Number(p) || 0) / FT_PER_M)
  if (f === 'FT' && t === 'M') return r4((Number(p) || 0) * FT_PER_M)
  return Number(p) || 0
}
function convQty(q, from, to) {
  const f = String(from || '').toUpperCase(), t = String(to || '').toUpperCase()
  if (f === 'M' && t === 'FT') return Math.round((Number(q) || 0) * FT_PER_M * 100) / 100
  if (f === 'FT' && t === 'M') return Math.round((Number(q) || 0) / FT_PER_M * 100) / 100
  return Number(q) || 0
}

const isLotName = n => /^(box|lot)\s*\d+$/i.test(String(n || '').trim())
const lastSource = c => { const h = (c.priceHistory || []).slice(-1)[0]; return (h && h.source) || '' }
const lastDate = c => { const h = (c.priceHistory || []).slice(-1)[0]; return (h && h.date) || '' }

// Groups of Catalog parts that are the same thing: a shared part # (any of
// their part #s), the same nickname (same part from different wholesalers), or
// the same description when there's no part #.
export function findDuplicateParts(catalog, stock) {
  const list = catalog || []
  const parent = list.map((_, i) => i)
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const join = (a, b) => { parent[find(a)] = find(b) }
  const seen = new Map()
  const link = (key, i) => { if (!key) return; if (seen.has(key)) join(i, seen.get(key)); else seen.set(key, i) }
  list.forEach((c, i) => {
    partNosOf(c).forEach(pn => link('p:' + norm(pn), i))
    if (c.nickname && !isLotName(c.nickname)) link('n:' + normDesc(c.nickname), i)
    if (!partNosOf(c).length && normDesc(c.name)) link('d:' + normDesc(c.name), i)
  })
  const groups = new Map()
  list.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c) })
  const out = []
  groups.forEach(items => {
    if (items.length < 2) return
    const stockOf = c => (stock || []).filter(s => s.catalogId === c.id)
    const score = c => (c.parts || []).length * 1000 + (c.priceHistory || []).length * 100 + (isLotName(c.nickname) ? 0 : 10) + stockOf(c).length
    const sorted = items.slice().sort((a, b) => score(b) - score(a))
    const lots = items.flatMap(stockOf)
    const units = [...new Set([...items.map(c => String(c.uom || '').toUpperCase()), ...lots.map(s => String(s.uom || '').toUpperCase())].filter(Boolean))]
    const lotUnit = lots.length ? String(lots[0].uom || '').toUpperCase() : ''
    const pns = [...new Set(items.flatMap(partNosOf).map(norm))]
    out.push({
      key: sorted.map(c => c.id).sort().join('|'), keep: sorted[0], extras: sorted.slice(1), items, lots, units,
      defaultUnit: lotUnit || String(sorted[0].uom || '').toUpperCase(),
      // several different part #s = the same part from different wholesalers
      alias: pns.length > 1,
    })
  })
  return out
}

// Returns { catalog, stock, trashed } after merging the chosen groups
export function mergeDuplicates(catalog, stock, picks) {
  let cat = catalog, stk = stock
  const trashed = []
  picks.forEach(({ group, keepId, unit, rule }) => {
    const keep = group.items.find(c => c.id === keepId)
    const others = group.items.filter(c => c.id !== keepId)
    // Each wholesaler's part # and latest price, so all of them match this part
    const parts = []
    ;[keep, ...others].forEach(c => {
      const own = (c.parts || []).length ? c.parts : [{ partNo: c.partNo, supplier: lastSource(c), price: c.refCost, at: lastDate(c) }]
      own.forEach(p => {
        if (!p.partNo) return
        const price = convPrice(p.price, c.uom, unit || keep.uom)
        const ex = parts.find(x => norm(x.partNo) === norm(p.partNo))
        if (!ex) parts.push({ partNo: p.partNo, supplier: p.supplier || '', price, at: p.at || '' })
        else if (String(p.at || '') > String(ex.at || '')) Object.assign(ex, { supplier: p.supplier || ex.supplier, price, at: p.at })
      })
    })
    const multi = parts.length > 1
    const ids = new Set(others.map(c => c.id))
    const hist = [...(keep.priceHistory || []).map(h => ({ ...h, cost: convPrice(h.cost, keep.uom, unit) })),
      ...others.flatMap(c => (c.priceHistory || []).map(h => ({ ...h, cost: convPrice(h.cost, c.uom, unit) })))]
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(-20)
    cat = cat.filter(c => !ids.has(c.id)).map(c => c.id !== keep.id ? c : {
      ...c, uom: unit || c.uom,
      refCost: multi ? priceByRule(parts, rule || 'highest') : convPrice(c.refCost, c.uom, unit || c.uom),
      nickname: isLotName(c.nickname) ? (others.map(o => o.nickname).find(n => n && !isLotName(n)) || '') : c.nickname,
      ...(multi ? { parts, priceRule: rule || 'highest' } : {}),
      ...(hist.length ? { priceHistory: hist } : {}),
    })
    trashed.push(...others)
    const allIds = new Set(group.items.map(c => c.id))
    stk = stk.map(s => !allIds.has(s.catalogId) ? s : {
      ...s, catalogId: keep.id,
      ...(unit && String(s.uom || '').toUpperCase() !== unit ? {
        uom: unit, qty: convQty(s.qty, s.uom, unit), paidForQty: convQty(s.paidForQty, s.uom, unit), cost: convPrice(s.cost, s.uom, unit),
      } : {}),
    })
  })
  return { catalog: cat, stock: stk, trashed }
}

export default function DupPartsModal({ groups, onApply, onClose }) {
  const [picks, setPicks] = useState(() => Object.fromEntries(groups.map(g => [g.key, { on: true, keepId: g.keep.id, unit: g.defaultUnit, rule: g.keep.priceRule || 'highest' }])))
  const set = (k, patch) => setPicks(p => ({ ...p, [k]: { ...p[k], ...patch } }))
  const name = c => `${c.nickname ? c.nickname + ' — ' : ''}${c.name || ''}`
  const cell = { padding: '3px 6px', fontSize: 12, borderTop: '1px solid var(--border)' }
  const chosen = groups.filter(g => picks[g.key].on)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: '100%', maxWidth: 860, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.3)' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 16, fontWeight: 700 }}>Duplicate parts</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', margin: '4px 0 10px' }}>
          These parts are in the Catalog more than once — the same part #, or the same nickname (the same part from different wholesalers). Merging keeps one part with every
          part # on it, moves the others' price history onto it, and keeps all the Stock as separate lots under it. The extra Catalog entries go to the Trash.
        </div>
        {groups.map(g => {
          const pk = picks[g.key]
          const total = g.lots.reduce((a, s) => a + (Number(s.qty) || 0), 0)
          return (
            <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, opacity: pk.on ? 1 : 0.55 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <input type="checkbox" checked={pk.on} onChange={e => set(g.key, { on: e.target.checked })} />
                {g.keep.nickname && !/^(box|lot)\s*\d+$/i.test(g.keep.nickname) ? g.keep.nickname : (g.keep.partNo || g.keep.name)} — {g.items.length} entries{g.lots.length ? ` · ${g.lots.length} stock lot${g.lots.length === 1 ? '' : 's'}, ${total} ${g.lots[0].uom || ''} on hand` : ''}
                {g.alias && <span style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', borderRadius: 10, padding: '1px 8px' }}>different part #s</span>}
              </label>
              {g.alias && (
                <div style={{ fontSize: 12, margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-mid)' }}>Same part from different wholesalers — all the part #s stay on it, so any of their slips match. Catalog price:</span>
                  <label style={{ cursor: 'pointer' }}><input type="radio" name={'rule-' + g.key} checked={pk.rule === 'highest'} onChange={() => set(g.key, { rule: 'highest' })} /> highest</label>
                  <label style={{ cursor: 'pointer' }}><input type="radio" name={'rule-' + g.key} checked={pk.rule === 'average'} onChange={() => set(g.key, { rule: 'average' })} /> average</label>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <tbody>
                  {g.items.map(c => (
                    <tr key={c.id}>
                      <td style={{ ...cell, width: 60 }}><label style={{ fontSize: 11, cursor: 'pointer' }}><input type="radio" name={'keep-' + g.key} checked={pk.keepId === c.id} onChange={() => set(g.key, { keepId: c.id })} /> keep</label></td>
                      <td style={cell}>{partNosOf(c).length ? <b>{partNosOf(c).join(', ')} </b> : null}{name(c)}{lastSource(c) ? <span style={{ color: 'var(--text-light)' }}> · {lastSource(c)}</span> : null}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{money(c.refCost)} / {c.uom || '—'}</td>
                      <td style={{ ...cell, color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{(c.priceHistory || []).length} price{(c.priceHistory || []).length === 1 ? '' : 's'} · {c.category || 'no category'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.units.length > 1 && (
                <div style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#9a6610', fontWeight: 700 }}>⚠ Priced/counted in {g.units.join(' and ')}.</span> Use
                  {g.units.map(u => (
                    <label key={u} style={{ cursor: 'pointer' }}><input type="radio" name={'unit-' + g.key} checked={pk.unit === u} onChange={() => set(g.key, { unit: u })} /> {u}</label>
                  ))}
                  <span style={{ color: 'var(--text-light)' }}>{['M', 'FT'].every(u => g.units.includes(u)) ? '(prices and stock counts are converted between metres and feet)' : '(only the label changes)'}</span>
                </div>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Not now</button>
          <button disabled={!chosen.length} onClick={() => { onApply(chosen.map(g => ({ group: g, keepId: picks[g.key].keepId, unit: picks[g.key].unit, rule: picks[g.key].rule }))); onClose() }}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
            Merge {chosen.length} part{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
