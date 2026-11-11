// Counts waiting for approval (desktop ✎ on the Catalog & Stock list, or the
// phone's Catalog tab). Each entry is either:
//   a count  — "there are 20 here"            { kind:'count', qty }
//   an add   — "found another 10"              { kind:'count', add:true, qty }
// The entries for one item roll up into ONE tentative total: the last count
// (or what's on hand, if nothing's been counted yet) plus every add after it.

const n = v => Number(v) || 0
export const countKey = it => it.catalogId ? 'c:' + it.catalogId : 'a:' + (it.stockId || it.id)

// Does this pending entry belong to this Catalog & Stock row?
export const entryForRow = (it, row) => !!(row && ((it.catalogId && row.cat && row.cat.id === it.catalogId) || (it.stockId && ((row.stk && row.stk.id === it.stockId) || (row.lots || []).some(l => l.id === it.stockId)))))

// One item's entries (oldest first) → { total, base, baseFrom, adds, entries, last }
export function rollUp(entries, onHand = 0) {
  const list = [...(entries || [])].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
  let base = n(onHand), baseFrom = 'on hand', adds = []
  for (const e of list) {
    if (e.add) adds.push(e)
    else { base = n(e.qty); baseFrom = 'count'; adds = [] }
  }
  const total = Math.round((base + adds.reduce((a, e) => a + n(e.qty), 0)) * 1000) / 1000
  return { total, base, baseFrom, adds, entries: list, last: list[list.length - 1] || null }
}

// Every pending count, grouped by item → [{ key, entries, rollup }]
export function groupCounts(pending, onHandFor = () => 0) {
  const groups = new Map()
  ;(pending || []).filter(x => x && x.kind === 'count').forEach(x => {
    const k = countKey(x)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(x)
  })
  return [...groups.entries()].map(([key, entries]) => ({ key, entries, rollup: rollUp(entries, onHandFor(entries[0])) }))
}

// Short history line: "count 20 · +10 · +4" (or "on hand 6 · +10")
export function rollUpLabel(r) {
  return [`${r.baseFrom === 'count' ? 'count' : 'on hand'} ${r.base}`, ...r.adds.map(a => `+${n(a.qty)}`)].join(' · ')
}

// How many approval lines: one per counted item, one per new item
export const approvalLineCount = pending => groupCounts(pending).length + (pending || []).filter(x => x && x.kind === 'newpart').length
