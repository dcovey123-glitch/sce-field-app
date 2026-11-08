// Group orders / slips by month (newest first), then by distributor.
// Wholesaler names come in many spellings ("NEDCO - DIV. OF REXEL CANADA…",
// "Nedco (Rexel Canada Electrical Inc.)") — they're folded to one name.

const KNOWN = [
  ['nedco', 'Nedco'], ['westburne', 'Westburne'], ['gescan', 'Gescan'], ['wesco', 'WESCO'],
  ['anixter', 'Anixter'], ['eecol', 'EECOL'], ['guillevin', 'Guillevin'], ['ko-hen', 'KO-HEN'],
  ['lumen', 'Lumen'], ['home depot', 'Home Depot'], ['rona', 'RONA'], ['princess auto', 'Princess Auto'],
  ['rexel', 'Westburne'], // Westburne is Rexel's; Nedco is matched first
]

export function distributorName(s) {
  const t = String(s || '').toLowerCase()
  if (!t.trim()) return 'Unknown supplier'
  const hit = KNOWN.find(([k]) => t.includes(k))
  if (hit) return hit[1]
  // otherwise the name without the company suffix, in tidy case
  const base = String(s).replace(/[,.]?\s*(ltd|limited|inc|incorporated|corp|co|lp)\.?\s*$/i, '').replace(/\s*\(.*\)\s*$/, '').trim()
  return base.length > 2 && base === base.toUpperCase() ? base.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : base
}

export function monthKey(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}` : '' }
export function monthLabel(key) {
  if (!key) return 'No date'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

// → [{ key, label, count, dists: [{ key, label, items }] }]
export function groupMonthDist(items, dateOf, nameOf) {
  const months = new Map()
  ;(items || []).forEach(it => {
    const mk = monthKey(dateOf(it))
    const dn = distributorName(nameOf(it))
    if (!months.has(mk)) months.set(mk, new Map())
    const dists = months.get(mk)
    if (!dists.has(dn)) dists.set(dn, [])
    dists.get(dn).push(it)
  })
  return [...months.entries()]
    .sort((a, b) => (b[0] || '0').localeCompare(a[0] || '0'))
    .map(([mk, dists]) => ({
      key: mk || 'none', label: monthLabel(mk),
      count: [...dists.values()].reduce((a, l) => a + l.length, 0),
      dists: [...dists.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dn, list]) => ({ key: dn, label: dn, items: list.slice().sort((a, b) => String(dateOf(b) || '').localeCompare(String(dateOf(a) || ''))) })),
    }))
}
