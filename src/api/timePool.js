// ⏱ Un-billed time — helping and quoting hours waiting to be billed into quotes.
//
// Where the hours come from: clocked time you put in the non-job buckets
// "Project planning / helping" and "Admin / quoting" (time_nonjob_log).
// Shop and travel stay general overhead. Time you tag to a job already lives
// on that job, so it isn't here.
//
// One pool, any quote. On a quote you bill some of it in, in pieces: each piece
// is a labor line on a scope, marked timePool: { bucket, from: 'pool' | 'quote' }.
// Nothing else is stored — the pool is worked out from the quotes themselves:
//   • edit the line's hours or delete it → the pool follows
//   • the quote is invalidated or deleted → its hours come back to the pool
// Hours logged straight to a quote (an entry's quoteId) are kept for that quote:
// its banner flags them to apply, and other quotes don't see them — unless that
// quote is lost, then they go back to the pool too.

export const POOL_BUCKETS = { planning: 'Helping', admin: 'Quoting' }
// The pool counts time from this day on (earlier time was before it started).
// Time logged straight to a quote counts whatever its date.
export const POOL_START_KEY = 'time_pool_start'
export const POOL_START_DEFAULT = '2026-11-01'
export const POOL_LINE_TEXT = { planning: 'Project planning & coordination', admin: 'Estimating & quoting' }

const n = v => Number(v) || 0
const r2 = v => Math.round(n(v) * 100) / 100
export const isLiveQuote = q => !!q && !q.trashedAt && !q.invalidated

const blank = () => ({ planning: 0, admin: 0 })

// Hours already billed into quotes, from their labor lines
export function poolLinesOf(quote) {
  const out = []
  ;(quote.scopes || []).forEach(sc => (sc.labor || []).forEach(l => {
    if (l.timePool && POOL_BUCKETS[l.timePool.bucket]) out.push({ quoteId: quote.id, scopeId: sc.id, scopeName: sc.name || '', lineId: l.id, bucket: l.timePool.bucket, from: l.timePool.from === 'quote' ? 'quote' : 'pool', hours: n(l.qty) })
  }))
  return out
}

// → { pool: {planning, admin}, logged: {…}, applied: {…}, forQuote: { tagged, applied, toApply, lines } | null }
export function timePoolSummary(log, quotes, quoteId = null, since = POOL_START_DEFAULT) {
  const live = new Map((quotes || []).filter(isLiveQuote).map(q => [q.id, q]))
  const logged = blank(), applied = blank()
  const taggedTo = {} // live quote id → { planning, admin }
  for (const e of Array.isArray(log) ? log : []) {
    if (!POOL_BUCKETS[e.bucket]) continue
    const h = n(e.totalHours != null ? e.totalHours : n(e.hoursEach) * ((e.workers || []).length || 1))
    if (e.quoteId && live.has(e.quoteId)) {
      taggedTo[e.quoteId] = taggedTo[e.quoteId] || blank()
      taggedTo[e.quoteId][e.bucket] += h
    } else if (!since || String(e.date || '') >= since) logged[e.bucket] += h
  }
  const appliedTo = {} // quote id → { planning, admin } billed out of its own tagged hours
  for (const q of live.values()) {
    for (const l of poolLinesOf(q)) {
      if (l.from === 'quote') { appliedTo[q.id] = appliedTo[q.id] || blank(); appliedTo[q.id][l.bucket] += l.hours }
      else applied[l.bucket] += l.hours
    }
  }
  // tagged hours a quote billed beyond what was tagged come out of the pool
  for (const [id, a] of Object.entries(appliedTo)) {
    const t = taggedTo[id] || blank()
    for (const b of Object.keys(POOL_BUCKETS)) if (a[b] > t[b]) applied[b] += a[b] - t[b]
  }
  const pool = blank()
  for (const b of Object.keys(POOL_BUCKETS)) pool[b] = r2(logged[b] - applied[b])

  let forQuote = null
  if (quoteId) {
    const t = taggedTo[quoteId] || blank(), a = appliedTo[quoteId] || blank()
    const q = (quotes || []).find(x => x.id === quoteId)
    forQuote = {
      tagged: { planning: r2(t.planning), admin: r2(t.admin) },
      toApply: { planning: r2(Math.max(0, t.planning - a.planning)), admin: r2(Math.max(0, t.admin - a.admin)) },
      lines: q ? poolLinesOf(q) : [],
    }
  }
  return { pool, logged: { planning: r2(logged.planning), admin: r2(logged.admin) }, applied: { planning: r2(applied.planning), admin: r2(applied.admin) }, forQuote }
}

// The labor line that bills a piece of it into a scope
export function poolLaborLine({ bucket, hours, rate, from = 'pool', desc }) {
  return { desc: desc || POOL_LINE_TEXT[bucket] || 'Project coordination', qty: r2(hours), rate: n(rate) || 90, timePool: { bucket, from, at: new Date().toISOString() } }
}
