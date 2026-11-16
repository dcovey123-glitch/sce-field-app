// Priority on a to-do line (Hit List items, customer to-dos, job tasks).
//   'high' | '' (normal) | 'low'
// Lists show High first, then normal, then Low; inside each, the order you
// already had is kept.

export const PRIORITY_LABEL = { high: 'High', '': 'Normal', low: 'Low' }
export const norm = p => (p === 'high' || p === 'low' ? p : '')
// Click order on the flag: Normal → High → Low → Normal
export const nextPriority = p => ({ '': 'high', high: 'low', low: '' })[norm(p)]
export const priorityRank = p => ({ high: 0, '': 1, low: 2 })[norm(p)]

export function byPriority(list, get = x => x && x.priority) {
  return (Array.isArray(list) ? list : [])
    .map((x, i) => [x, i])
    .sort((a, b) => priorityRank(get(a[0])) - priorityRank(get(b[0])) || a[1] - b[1])
    .map(a => a[0])
}
