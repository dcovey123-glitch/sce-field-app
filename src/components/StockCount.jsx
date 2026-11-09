import React, { useEffect, useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { hit } from '../api/search.js'
import { money, fmtDate } from '../api/format.js'

// Stock count: go category by category (here or on the phone), type
// what's there, then review the differences and apply them in one go.
// Phone counts sent while a count is open land straight in it.
//
// session (stock_count): { startedAt, counts: { [rowId]: { qty, at, by, src } } }
// history (stock_count_history): [{ at, counted, changed, before, after }]

const n = v => Number(v) || 0
const day = iso => fmtDate(iso, 'medium')
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const inp = { fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontFamily: 'var(--font)', boxSizing: 'border-box', background: '#fff' }
const btn = (kind) => ({ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
  border: kind === 'plain' ? '1px solid var(--border)' : 'none', background: kind === 'go' ? '#1e7a34' : kind === 'navy' ? 'var(--navy)' : 'var(--surface)', color: kind === 'plain' ? 'var(--text-mid)' : '#fff' })
const unitCost = r => n(r.stk && r.stk.cost) || n(r.refCost)
const lastCounted = r => (r.lots || []).map(l => l.countedAt || ((l.countLog || []).slice(-1)[0] || {}).at).filter(Boolean).sort().pop() || ''

export function lastFullCount() {
  try { const h = JSON.parse(localStorage.getItem('fieldapp_stock_count_history') || '[]'); return h[0] || null } catch { return null }
}

// Same order as the Catalog & Stock list: top categories A–Z, then inside each
// its sub-categories (A–Z, nested), then the items filed right in it; the
// Uncategorized pile last. → [[topName, sections:[{path, depth, items}]]]
export function categoryGroups(list) {
  const root = { kids: new Map(), items: [] }
  list.forEach(r => {
    const segs = String(r.category || '').split('/').map(x => x.trim()).filter(Boolean)
    let node = root
    segs.forEach(seg => { if (!node.kids.has(seg)) node.kids.set(seg, { kids: new Map(), items: [] }); node = node.kids.get(seg) })
    node.items.push(r)
  })
  const walk = (node, path, depth, out) => {
    ;[...node.kids.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, kid]) => walk(kid, path.concat(name), depth + 1, out))
    if (node.items.length) out.push({ path: path.slice(1).join(' / '), depth, items: node.items })
    return out
  }
  const tops = [...root.kids.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, kid]) => [name, walk(kid, [name], 0, [])])
  if (root.items.length) tops.push(['Uncategorized', [{ path: '', depth: 0, items: root.items }]])
  return tops
}

export default function StockCount({ rows, setStock, setCatalog, catPending, setCatPending, onClose }) {
  const [session, setSession] = useLocalStore('stock_count', null)
  const [, setHistory] = useLocalStore('stock_count_history', [])
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [openShelf, setOpenShelf] = useState({})
  const [review, setReview] = useState(false)
  const [clearPaid, setClearPaid] = useState(true)
  const [zeroUncounted, setZeroUncounted] = useState(false)
  const [done, setDone] = useState(null)
  const s = session || null
  const counts = (s && s.counts) || {}

  const start = () => setSession({ startedAt: new Date().toISOString(), counts: {} })
  const setCount = (row, v) => setSession(cur => {
    const c = { ...((cur && cur.counts) || {}) }
    if (v === '' || v == null) delete c[row.id]; else c[row.id] = { qty: n(v), at: new Date().toISOString(), by: 'Desktop', src: 'desktop' }
    return { ...(cur || { startedAt: new Date().toISOString() }), counts: c }
  })

  // phone counts sent during the count go straight into it
  useEffect(() => {
    if (!s) return
    const phone = (catPending || []).filter(x => x.kind === 'count' && Date.parse(x.at) >= Date.parse(s.startedAt) - 60000)
    if (!phone.length) return
    const rowOf = x => rows.find(r => (x.catalogId && r.cat && r.cat.id === x.catalogId) || (x.stockId && (r.lots || []).some(l => l.id === x.stockId)))
    const take = phone.filter(rowOf)
    if (!take.length) return
    setSession(cur => {
      const c = { ...((cur && cur.counts) || {}) }
      take.forEach(x => { const r = rowOf(x); c[r.id] = { qty: n(x.qty), at: x.at, by: x.by || 'phone', src: 'phone' } })
      return { ...cur, counts: c }
    })
    const ids = new Set(take.map(x => x.id))
    setCatPending(list => (list || []).filter(x => !ids.has(x.id)))
  }, [catPending, !!s]) // eslint-disable-line react-hooks/exhaustive-deps

  const base = rows.filter(r => showAll || (r.lots || []).length > 0)
  const ql = q.trim().toLowerCase()
  const list = ql ? base.filter(r => hit([r.nickname, r.name, r.partNo, r.category, ...(r.cat && r.cat.partNos ? r.cat.partNos : [])], ql)) : base
  const shelfList = categoryGroups(list)

  const counted = rows.filter(r => counts[r.id])
  const diffs = counted.map(r => ({ r, from: n(r.onHand), to: n(counts[r.id].qty) })).filter(x => Math.abs(x.to - x.from) > 0.0005)
  const uncounted = rows.filter(r => (r.lots || []).some(l => n(l.qty) > 0) && !counts[r.id])
  const valueBefore = rows.reduce((a, r) => a + n(r.onHand) * unitCost(r), 0)
  const valueAfter = rows.reduce((a, r) => a + (counts[r.id] ? n(counts[r.id].qty) : (zeroUncounted ? 0 : n(r.onHand))) * unitCost(r), 0)
  const noCost = rows.filter(r => ((r.lots || []).some(l => n(l.qty) > 0) || (counts[r.id] && n(counts[r.id].qty) > 0)) && !(unitCost(r) > 0))

  function setCost(r, v) {
    const c = n(v)
    const ids = new Set((r.lots || []).map(l => l.id))
    if (ids.size) setStock(list => list.map(x => ids.has(x.id) ? { ...x, cost: c } : x))
    if (r.cat) setCatalog(list => list.map(x => x.id === r.cat.id ? { ...x, refCost: c } : x))
  }

  function apply() {
    const now = new Date().toISOString()
    setStock(list => {
      let next = [...(list || [])]
      const touch = (id, f) => { next = next.map(x => x.id === id ? f(x) : x) }
      rows.forEach(r => {
        const c = counts[r.id]
        const lots = r.lots || []
        if (!c && !(zeroUncounted && lots.some(l => n(l.qty) > 0))) return
        const to = c ? n(c.qty) : 0
        const from = lots.reduce((a, l) => a + n((next.find(x => x.id === l.id) || l).qty), 0)
        if (!lots.length) {
          if (to > 0 && r.cat) next = [...next, { id: uid(), catalogId: r.cat.id, name: r.cat.name, partNo: r.cat.partNo || '', nickname: r.cat.nickname || '', uom: r.cat.uom || '', category: r.cat.category || '', qty: to, cost: n(r.cat.refCost), paidForQty: 0, countedAt: now, countLog: [{ at: now, from: 0, to, by: c ? c.by : 'Desktop', note: 'Stock count' }] }]
          return
        }
        let diff = to - from
        if (diff > 0) touch(r.stk.id, x => ({ ...x, qty: Math.round((n(x.qty) + diff) * 1000) / 1000 }))
        else if (diff < 0) {
          // take it off the open lots first (least left)
          const order = lots.map(l => next.find(x => x.id === l.id) || l).sort((a, b) => n(a.qty) - n(b.qty))
          for (const l of order) { if (diff >= 0) break; const take = Math.min(n(l.qty), -diff); touch(l.id, x => ({ ...x, qty: Math.round((n(x.qty) - take) * 1000) / 1000 })); diff += take }
        }
        lots.forEach(l => touch(l.id, x => ({ ...x, countedAt: now, paidForQty: clearPaid ? 0 : Math.min(n(x.paidForQty), n(x.qty)) })))
        touch(r.stk.id, x => ({ ...x, countLog: [...(x.countLog || []), { at: now, from, to, by: c ? c.by : 'Desktop', note: c ? 'Stock count' : 'Stock count — not found' }] }))
      })
      return next
    })
    const rec = { at: now, startedAt: s.startedAt, counted: counted.length, changed: diffs.length, zeroed: zeroUncounted ? uncounted.length : 0, before: Math.round(valueBefore * 100) / 100, after: Math.round(valueAfter * 100) / 100 }
    setHistory(h => [rec, ...(Array.isArray(h) ? h : [])].slice(0, 30))
    setSession(null)
    setReview(false)
    setDone(rec)
  }

  if (done) return (
    <div style={{ margin: 16, padding: 16, border: '1px solid #1e7a34', borderRadius: 8, background: '#e6f4ea' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1e7a34' }}>✓ Count applied</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{done.counted} items counted · {done.changed} changed{done.zeroed ? ` · ${done.zeroed} not found set to 0` : ''} · Stock value {money(done.before)} → <b>{money(done.after)}</b></div>
      <button onClick={onClose} style={{ ...btn('navy'), marginTop: 10 }}>Back to Catalog & Stock</button>
    </div>
  )

  if (!s) return (
    <div style={{ margin: 16, padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>🧮 Stock count</div>
      <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>
        Go through it category by category — same order as the Catalog & Stock list — and type what's there — here, or on the phone (Material → 🧮 Count). Nothing changes until you review the differences and apply them.
        Try not to take anything in or out of the basement until you're done.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={start} style={btn('go')}>Start a count</button>
        <button onClick={onClose} style={btn('plain')}>Cancel</button>
      </div>
    </div>
  )

  const pct = rows.filter(r => (r.lots || []).length).length ? Math.round(counted.length / rows.filter(r => (r.lots || []).length).length * 100) : 0
  return (
    <div style={{ paddingBottom: 30 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>🧮 Counting</span>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>since {day(s.startedAt)}</span>
        <span style={{ width: 120, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: pct + '%', background: '#1e7a34' }} /></span>
        <span style={{ fontSize: 12.5 }}><b>{counted.length}</b> counted · <b style={{ color: diffs.length ? '#8a5d00' : undefined }}>{diffs.length}</b> different</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-mid)' }}>Value {money(valueBefore)} → <b>{money(valueAfter)}</b></span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setReview(true)} disabled={!counted.length} style={{ ...btn('go'), opacity: counted.length ? 1 : 0.5 }}>Review & apply</button>
        <button onClick={() => { setSession(null); onClose() }} title="Throw this count away — nothing was changed" style={btn('plain')}>Cancel count</button>
        <button onClick={onClose} title="Keep the count open and come back to it" style={btn('plain')}>Leave open</button>
      </div>

      {review && (
        <div style={{ margin: '12px 16px', border: '2px solid #1e7a34', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', background: '#e6f4ea', fontWeight: 800, color: '#1e7a34' }}>Review: {diffs.length} change{diffs.length === 1 ? '' : 's'} · Stock value {money(valueBefore)} → {money(valueAfter)}</div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {diffs.sort((a, b) => Math.abs((b.to - b.from) * unitCost(b.r)) - Math.abs((a.to - a.from) * unitCost(a.r))).map(({ r, from, to }) => (
              <div key={r.id} style={{ display: 'flex', gap: 10, padding: '5px 14px', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{r.nickname || r.name}{r.partNo ? <span style={{ color: 'var(--text-light)' }}> · {r.partNo}</span> : null}</span>
                <span style={{ width: 120, textAlign: 'right' }}>{from} → <b>{to}</b> {r.uom}</span>
                <span style={{ width: 90, textAlign: 'right', color: to < from ? '#a12a1e' : '#1e7a34' }}>{to > from ? '+' : '−'}{money(Math.abs((to - from) * unitCost(r)))}</span>
              </div>
            ))}
            {!diffs.length && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-light)' }}>Everything counted matches the app.</div>}
          </div>
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={clearPaid} onChange={e => setClearPaid(e.target.checked)} />
              <span>Everything counted costs its price on a job (clears "paid for" on counted items). <span style={{ color: 'var(--text-light)' }}>Recommended for the first full count — from then on, only leftovers from billed jobs are "paid for".</span></span></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={zeroUncounted} onChange={e => setZeroUncounted(e.target.checked)} />
              <span>Set the {uncounted.length} item{uncounted.length === 1 ? '' : 's'} I didn't count to 0 <span style={{ color: 'var(--text-light)' }}>(only for a full count where they really weren't there)</span></span></label>
            {noCost.length > 0 && <div style={{ color: '#8a5d00' }}>⚠ {noCost.length} item{noCost.length === 1 ? ' has' : 's have'} no cost, so {noCost.length === 1 ? "it isn't" : "they aren't"} in the value — add a cost on the list.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={apply} style={btn('go')}>✓ Apply count</button>
              <button onClick={() => setReview(false)} style={btn('plain')}>Keep counting</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…" style={{ ...inp, flex: 1, minWidth: 200 }} />
        <label style={{ fontSize: 12, color: 'var(--text-mid)', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Include Catalog items not in Stock (found something new)
        </label>
      </div>

      {shelfList.map(([shelf, sections]) => {
        const items = sections.flatMap(x => x.items)
        const c = items.filter(r => counts[r.id]).length
        const open = q ? true : openShelf[shelf] ?? (c < items.length)
        return (
          <div key={shelf} style={{ margin: '0 16px 8px', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setOpenShelf(o => ({ ...o, [shelf]: !open }))} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: 'none', background: c === items.length ? '#e6f4ea' : 'var(--surface-2)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{open ? '▾' : '▸'}</span>
              <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1 }}>{shelf}</span>
              <span style={{ fontSize: 12, color: c === items.length ? '#1e7a34' : 'var(--text-light)', fontWeight: 700 }}>{c === items.length ? '✓ ' : ''}{c} of {items.length} counted</span>
            </button>
            {open && sections.map(sec => (
              <React.Fragment key={sec.path || '_'}>
                {sec.path && <div style={{ padding: '5px 12px 4px', paddingLeft: 12 + (sec.depth - 1) * 14, borderTop: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 800, color: 'var(--text-mid)' }}>{sec.path}<span style={{ fontWeight: 600, color: 'var(--text-light)' }}> · {sec.items.filter(r => counts[r.id]).length} of {sec.items.length}</span></div>}
                {sec.items.map(r => {
              const cv = counts[r.id]
              const d = cv ? n(cv.qty) - n(r.onHand) : 0
              const lc = lastCounted(r)
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderTop: '1px solid var(--border)', background: cv ? (Math.abs(d) > 0.0005 ? '#fffaf0' : '#f5fbf6') : 'var(--surface)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.nickname || r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{[r.nickname ? r.name : '', r.partNo, lc ? 'last counted ' + day(lc) : 'never counted'].filter(Boolean).join(' · ')}</div>
                  </div>
                  {!(unitCost(r) > 0) ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: '#8a5d00' }}>no cost $<input type="number" step="0.01" placeholder="0.00" onBlur={e => e.target.value && setCost(r, e.target.value)} style={{ ...inp, width: 70, padding: '3px 5px', borderColor: '#e0a716' }} /></span>
                  ) : <span style={{ fontSize: 11.5, color: 'var(--text-light)', width: 70, textAlign: 'right' }}>{money(unitCost(r))}</span>}
                  <span style={{ fontSize: 12, color: 'var(--text-mid)', width: 80, textAlign: 'right' }}>app: {n(r.onHand)} {r.uom}</span>
                  <input type="number" inputMode="decimal" min="0" step="any" value={cv ? cv.qty : ''} placeholder="count"
                    onChange={e => setCount(r, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { const all = [...document.querySelectorAll('input[data-count]')]; const i = all.indexOf(e.currentTarget); if (all[i + 1]) all[i + 1].focus() } }}
                    data-count="1" style={{ ...inp, width: 80, textAlign: 'right', fontWeight: 700, borderColor: cv ? '#1e7a34' : 'var(--border)' }} />
                  <span style={{ width: 60, fontSize: 12, fontWeight: 700, textAlign: 'right', color: !cv ? 'transparent' : Math.abs(d) < 0.0005 ? '#1e7a34' : d < 0 ? '#a12a1e' : '#1a5fa0' }}>
                    {!cv ? '—' : Math.abs(d) < 0.0005 ? '✓' : (d > 0 ? '+' : '') + Math.round(d * 1000) / 1000}
                  </span>
                  <span style={{ width: 16, fontSize: 12 }} title={cv && cv.src === 'phone' ? `Counted on the phone${cv.by ? ' by ' + cv.by : ''}` : ''}>{cv && cv.src === 'phone' ? '📱' : ''}</span>
                </div>
              )
            })}
              </React.Fragment>
            ))}
          </div>
        )
      })}
    </div>
  )
}
