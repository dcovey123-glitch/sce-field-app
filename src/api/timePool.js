// ⏱ Un-billed time — helping, quoting and ordering/prep hours waiting to be billed into quotes.
//
// Where the hours come from: clocked time you put in the non-job buckets
// "Project planning / helping", "Quoting / estimating" and "Ordering / prep"
// (time_nonjob_log). General admin, shop and travel stay overhead. Time you tag to a job already lives
// on that job, so it isn't here.
//
// One pool, any quote. On a quote you bill some of it in, in pieces: each piece
// is a labor line on a scope, marked timePool: { bucket, from: 'pool' | 'quote', at }.
// Nothing else is stored — the pool is worked out from the quotes themselves.
// Each billed-in line is one of:
//   recovered — the quote is approved (the hours are in work you'll bill)
//   pending   — the quote is out, not approved yet (hours held for it)
//   back      — the quote is invalidated / deleted, the line is older than
//               PENDING_DAYS with no approval, or you released it by hand
//               (timePool.released) → the hours are available again
// Edit the line's hours or delete it and the pool follows.
// Hours logged straight to a quote (an entry's quoteId) are kept for that quote:
// its banner flags them to apply, and other quotes don't see them — unless that
// quote is lost, then they go back to the pool too.

export const POOL_BUCKETS = { planning: 'Helping', admin: 'Quoting', prep: 'Ordering & prep' }
// The pool counts time from this day on (earlier time was before it started).
// Time logged straight to a quote counts whatever its date.
export const POOL_START_KEY = 'time_pool_start'
export const POOL_START_DEFAULT = '2026-11-01'
export const POOL_LINE_TEXT = { planning: 'Project planning & coordination', admin: 'Estimating & quoting', prep: 'Material ordering & job preparation' }

const n = v => Number(v) || 0
const r2 = v => Math.round(n(v) * 100) / 100
export const isLiveQuote = q => !!q && !q.trashedAt && !q.invalidated
export const PENDING_DAYS = 90
const BUCKETS = Object.keys(POOL_BUCKETS)
const blank = () => Object.fromEntries(BUCKETS.map(b => [b, 0]))
const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]))
const entryHours = e => n(e.totalHours != null ? e.totalHours : n(e.hoursEach) * ((e.workers || []).length || 1))

// Every billed-in line on a quote, with where it's at
export function poolLinesOf(quote, now = Date.now()) {
  const out = []
  ;(quote.scopes || []).forEach(sc => (sc.labor || []).forEach(l => {
    if (!l.timePool || !POOL_BUCKETS[l.timePool.bucket]) return
    const at = l.timePool.at || ''
    const age = at ? (now - Date.parse(at)) / 86400000 : 0
    const state = !isLiveQuote(quote) ? 'back'
      : quote.approved ? 'recovered'
      : l.timePool.released ? 'back'
      : age > PENDING_DAYS ? 'back' : 'pending'
    const why = !isLiveQuote(quote) ? (quote.invalidated ? 'quote invalidated' : 'quote deleted')
      : quote.approved ? 'approved' : l.timePool.released ? 'released' : age > PENDING_DAYS ? `no approval in ${PENDING_DAYS} days` : ''
    out.push({ quoteId: quote.id, quoteNumber: quote.quoteNumber || '', quoteTitle: quote.title || '', scopeId: sc.id, scopeName: sc.name || '', lineId: l.id,
      bucket: l.timePool.bucket, from: l.timePool.from === 'quote' ? 'quote' : 'pool', hours: n(l.qty), rate: n(l.rate), desc: l.desc || '', at, state, why })
  }))
  return out
}

// → { pool, logged, pending, recovered, back, lines, forQuote }
//   pool: hours available to bill in now (by bucket)
export function timePoolSummary(log, quotes, quoteId = null, since = POOL_START_DEFAULT, now = Date.now()) {
  const live = new Map((quotes || []).filter(isLiveQuote).map(q => [q.id, q]))
  const logged = blank(), pending = blank(), recovered = blank(), back = blank()
  const taggedTo = {}
  for (const e of Array.isArray(log) ? log : []) {
    if (!POOL_BUCKETS[e.bucket]) continue
    const h = entryHours(e)
    if (e.quoteId && live.has(e.quoteId)) {
      taggedTo[e.quoteId] = taggedTo[e.quoteId] || blank()
      taggedTo[e.quoteId][e.bucket] += h
    } else if (!since || String(e.date || '') >= since) logged[e.bucket] += h
  }
  const lines = (quotes || []).flatMap(q => poolLinesOf(q, now))
  // hours each quote billed in out of its own logged-to-it time
  const ownUsed = {}
  const used = blank() // taken out of the pool (pending + recovered beyond a quote's own time)
  for (const l of lines) {
    if (l.state === 'back') { back[l.bucket] += l.hours; continue }
    ;(l.state === 'recovered' ? recovered : pending)[l.bucket] += l.hours
    if (l.from === 'quote' && taggedTo[l.quoteId]) {
      const own = taggedTo[l.quoteId][l.bucket]
      const k = l.quoteId + ':' + l.bucket
      const room = Math.max(0, own - (ownUsed[k] || 0))
      const fromOwn = Math.min(room, l.hours)
      ownUsed[k] = (ownUsed[k] || 0) + fromOwn
      used[l.bucket] += l.hours - fromOwn
    } else used[l.bucket] += l.hours
  }
  const pool = blank()
  for (const b of BUCKETS) pool[b] = logged[b] - used[b]

  let forQuote = null
  if (quoteId) {
    const t = taggedTo[quoteId] || blank()
    const toApply = blank()
    for (const b of BUCKETS) toApply[b] = Math.max(0, t[b] - (ownUsed[quoteId + ':' + b] || 0))
    forQuote = { tagged: round(t), toApply: round(toApply), lines: lines.filter(l => l.quoteId === quoteId) }
  }
  return { pool: round(pool), logged: round(logged), pending: round(pending), recovered: round(recovered), back: round(back), lines, forQuote }
}

// Logged vs billed-in, month by month (YYYY-MM), for the recovery summary
export function poolByMonth(log, quotes, since = POOL_START_DEFAULT, now = Date.now()) {
  const m = {}
  const row = k => (m[k] = m[k] || { month: k, logged: 0, pending: 0, recovered: 0, back: 0 })
  for (const e of Array.isArray(log) ? log : []) {
    if (!POOL_BUCKETS[e.bucket] || (since && String(e.date || '') < since && !e.quoteId)) continue
    row(String(e.date || '').slice(0, 7)).logged += entryHours(e)
  }
  for (const l of (quotes || []).flatMap(q => poolLinesOf(q, now))) {
    if (!l.at) continue
    row(l.at.slice(0, 7))[l.state] += l.hours
  }
  return Object.values(m).filter(r => r.month).sort((a, b) => b.month.localeCompare(a.month))
    .map(r => ({ ...r, logged: r2(r.logged), pending: r2(r.pending), recovered: r2(r.recovered), back: r2(r.back) }))
}

// The labor line that bills a piece of it into a scope
export function poolLaborLine({ bucket, hours, rate, from = 'pool', desc }) {
  return { desc: desc || POOL_LINE_TEXT[bucket] || 'Project coordination', qty: r2(hours), rate: n(rate) || 90, timePool: { bucket, from, at: new Date().toISOString() } }
}

// Change a billed-in line's marker (release / hold again)
export function patchPoolLine(quote, lineId, patch) {
  return {
    scopes: (quote.scopes || []).map(sc => ({
      ...sc,
      labor: (sc.labor || []).map(l => {
        if (l.id !== lineId || !l.timePool) return l
        const tp = { ...l.timePool, ...patch }
        Object.keys(tp).forEach(k => { if (tp[k] === null || tp[k] === false) delete tp[k] })
        return { ...l, timePool: tp }
      }),
    })),
  }
}

// T&M jobs bill what's in Labor Actual, not the quote — so billed-in hours on
// the job's quote are posted there (once; delete the labor entry to undo).
export function poolLinesToPost(project, linkedQuotes) {
  const done = new Set((project.laborEntries || []).map(e => e.fromPool && e.fromPool.lineId).filter(Boolean))
  return (linkedQuotes || []).flatMap(q => poolLinesOf(q)).filter(l => l.hours > 0 && !done.has(l.lineId))
}
