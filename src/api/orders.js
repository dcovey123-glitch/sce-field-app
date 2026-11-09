import { useState, useEffect } from 'react'
import { aiPost, AI_MODEL } from './ai.js'

// Orders & POs — read the feed Claude's morning email run writes to OneDrive
// ("Field App/orders.json") and lay this PC's own changes on top
// ("Field App/orders-app.json": marked received, closed, notes).

export const STALE_DAYS = 7

// Orders archived out of the live list (everything before the fresh start,
// and later anything received or closed a while ago).
export function previousOrders(previous) {
  return ((previous && previous.orders) || []).map(o => ({ ...o, age: daysSince(o.date), archived: true }))
}

export const STATUS_ORDER = ['Requested', 'Quote in', 'PO requested', 'Ordered', 'Received', 'Closed']

export function daysSince(dateStr) {
  if (!dateStr) return null
  const t = Date.parse(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr)
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

// One list of rows with this PC's changes applied.
export function mergeOrders(feed, local) {
  const overrides = (local && local.overrides) || {}
  return withSlipQuotes(feed, local).map(o => {
    const ov = overrides[o.id] || {}
    // Your filing wins; otherwise use what the morning run suggested.
    const yours = 'filedAs' in ov
    return {
      ...o,
      feedStatus: o.status,
      // A PO # you typed in the app wins (the email run can miss one)
      poNumber: ov.poNumber || o.poNumber || '',
      poFromApp: !!ov.poNumber && ov.poNumber !== o.poNumber,
      // tagged "Quote for Pricing" — prices only, never ordered
      pricingOnly: !!ov.pricingOnly,
      status: ov.status || (ov.poNumber && ['Quote in', 'PO requested', 'Requested'].includes(o.status) ? 'Ordered' : o.status),
      note: ov.note || '',
      filedAs: (yours ? ov.filedAs : o.filedAs) || '',
      ref: (yours ? ov.ref : o.ref) || '',
      // several jobs on one filing ("Material for job" → Job A + Job B)
      refs: (yours ? ov.refs : o.refs) || [],
      refLabel: (yours ? ov.refLabel : o.refLabel) || '',
      filingSuggested: !yours && !!o.filedAs,
      changedHere: !!ov.status,
      slip: ov.slip || null,
      forcedReceived: ov.forced || null,
      partFilings: (ov.parts && typeof ov.parts === 'object') ? ov.parts : {},
      age: daysSince(o.date),
    }
  })
}

// ── Splitting an order by quote # (one PO can cover several quotes) ──

// The supplier quote numbers on a row ("Order 4533041" counts as one).
export function quoteNumbersOf(o) {
  const fromLinks = Array.isArray(o.quoteLinks) ? o.quoteLinks.map(l => l && l.number) : []
  const list = fromLinks.length ? fromLinks : String(o.quoteNumber || '').split(/[,;]+/)
  return list.map(n => String(n || '').trim()).filter(Boolean)
}

// One part per quote number, each with its own filing (your split, or the
// order's filing) and its own pre-tax total when the run knows it.
export function orderParts(o) {
  const nums = quoteNumbersOf(o)
  const list = nums.length ? nums : ['']
  const totals = (o.quoteTotals && typeof o.quoteTotals === 'object') ? o.quoteTotals : {}
  return list.map(n => {
    const own = (o.partFilings || {})[n]
    const has = !!(own && 'filedAs' in own)
    const f = has ? own : o
    let total = 0
    if (n && n in totals) total = Number(totals[n]) || 0
    else if (list.length === 1) total = Number(o.quoteTotal) || 0
    const allLines = (o.quoteLines && typeof o.quoteLines === 'object') ? o.quoteLines : {}
    const lines = (n && Array.isArray(allLines[n]) ? allLines[n] : []).filter(l => l && (l.desc || l.partNo))
      .map((l, i) => ({ n: l.n != null ? String(l.n) : String(i + 1), partNo: l.partNo || '', desc: l.desc || '', qty: Number(l.qty) || 0, uom: l.uom || '', ext: Number(l.ext) || 0 }))
    return {
      key: `${o.id}#${n}`, orderId: o.id, number: n, total, lines,
      filedAs: f.filedAs || '', ref: f.ref || '', refLabel: f.refLabel || '', refs: refsOf(f),
      ownFiling: has, order: o,
    }
  })
}

const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// The names a filing points at: one (ref) or several (refs, for several jobs)
export function refsOf(f) {
  const list = Array.isArray(f && f.refs) && f.refs.length ? f.refs : (f && f.ref ? [f.ref] : [])
  return [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))]
}
// Is this order filed at all — the whole order, or every quote # split off?
export function isFiledOrder(o) {
  if (fileType(o.filedAs)) return true
  const parts = orderParts(o)
  return parts.length > 0 && parts.every(p => p.ownFiling && fileType(p.filedAs))
}
// Every job name an order is filed to (whole-order filing and each split quote #)
export function jobNamesOf(o) {
  return [...new Set(orderParts(o).filter(p => p.filedAs === 'job').flatMap(p => p.refs))]
}

// Every quote/order part filed to this job (by job name).
export function partsForJob(rows, jobName) {
  const k = normName(jobName)
  if (!k) return []
  return (rows || []).flatMap(orderParts).filter(p => p.filedAs === 'job' && p.refs.some(r => normName(r) === k))
}

// What an order can be filed under.
export const FILE_TYPES = [
  { id: 'quote', label: 'Quote for Pricing', refLabel: 'Quote #', group: 'Quote' },
  { id: 'job',   label: 'Material for job',  refLabel: 'Job',     group: 'Job' },
  { id: 'stock', label: 'Shop stock',        refLabel: '',        group: 'Shop stock' },
  { id: 'other', label: 'Other',             refLabel: 'Label',   group: 'Other' },
]
export const fileType = id => FILE_TYPES.find(t => t.id === id)

// Group rows by what they're filed under; unfiled rows last.
export function groupByFiling(rows) {
  const map = new Map()
  const put = (o, t, ref, refLabel) => {
    const key = t ? `${t.id}|${(ref || '').toLowerCase()}` : '~unfiled'
    if (!map.has(key)) {
      map.set(key, {
        key,
        type: t || null,
        title: t ? [t.group, ref].filter(Boolean).join(' ') : 'Not filed yet',
        subtitle: t ? refLabel : 'Use File on an order to put it under a quote or job',
        rows: [],
      })
    }
    const g = map.get(key)
    if (!g.rows.includes(o)) g.rows.push(o)
  }
  for (const o of rows) {
    // an order on several jobs (or split by quote #) shows under each of them
    const parts = orderParts(o).filter(p => fileType(p.filedAs))
    if (!parts.length) { put(o, null); continue }
    parts.forEach(p => {
      const t = fileType(p.filedAs)
      const refs = t.refLabel ? p.refs : ['']
      ;(refs.length ? refs : ['']).forEach(r => put(o, t, r, p.refs.length > 1 ? '' : p.refLabel))
    })
    if (!isFiledOrder(o)) put(o, null) // part of it still isn't filed
  }
  const order = { quote: 0, job: 1, stock: 2, other: 3 }
  return [...map.values()].sort((a, b) => {
    if (!a.type) return 1
    if (!b.type) return -1
    return (order[a.type.id] - order[b.type.id]) || a.title.localeCompare(b.title, undefined, { numeric: true })
  })
}

export function isStale(o) {
  return o.status === 'Quote in' && o.age != null && o.age >= STALE_DAYS
}

export function groupOrders(rows) {
  const g = { decide: [], waiting: [], ordered: [], done: [] }
  for (const o of rows) {
    if (o.status === 'Received' || o.status === 'Closed') g.done.push(o)
    else if (o.status === 'Ordered') g.ordered.push(o)
    else if (isStale(o)) g.decide.push(o)
    else g.waiting.push(o)
  }
  const newest = (a, b) => (b.date || '').localeCompare(a.date || '')
  const oldest = (a, b) => (a.date || '').localeCompare(b.date || '')
  g.decide.sort(oldest)
  g.waiting.sort(newest)
  g.ordered.sort(newest)
  g.done.sort(newest)
  return g
}

// Open a quote's PDF from "Field App/Quote Slips". Returns the result object.
export async function openQuotePdf(number) {
  if (typeof window === 'undefined' || !window.desktop?.ordersOpenQuoteFile) return { ok: false, reason: 'not-desktop' }
  try { return await window.desktop.ordersOpenQuoteFile(number) } catch { return { ok: false, reason: 'error' } }
}

// Count for the Home badge: quotes sitting a week or more with no PO.
export async function loadOrdersAttentionCount() {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad) return 0
  try {
    const res = await window.desktop.ordersLoad()
    if (!res || !res.feed) return 0
    return mergeOrders(res.feed, res.local).filter(isStale).length
  } catch {
    return 0
  }
}

// ── Link to Materials (packing slips) by PO number ──

// "PO# 10088", "po 10088", "010088" → "10088"
export function normPo(s) {
  return String(s || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^po/, '').replace(/^0+/, '')
}

export function matchOrdersByPo(rows, po) {
  const k = normPo(po)
  if (!k) return []
  return (rows || []).filter(o => normPo(o.poNumber) === k)
}

// One shared copy of the feed for every screen that needs it (Materials rows,
// the slip review), refreshed when the window regains focus.
const feedCache = { rows: [], previous: [], loadedAt: 0, loading: null, listeners: new Set(), prevListeners: new Set() }

export async function refreshFeed(force) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad) return feedCache.rows
  if (!force && feedCache.loading) return feedCache.loading
  if (!force && Date.now() - feedCache.loadedAt < 10000) return feedCache.rows
  feedCache.loading = (async () => {
    try {
      const res = await window.desktop.ordersLoad()
      feedCache.rows = res && res.feed ? mergeOrders(res.feed, res.local) : []
      // the email run's archived quotes (Previous), with this PC's changes applied
      feedCache.previous = res && res.previous && Array.isArray(res.previous.orders) ? mergeOrders({ orders: res.previous.orders }, { ...(res.local || {}), slipQuotes: {} }).map(o => ({ ...o, archived: true })) : []
      feedCache.prevListeners.forEach(fn => fn(feedCache.previous))
    } catch { /* keep what we had */ }
    feedCache.loadedAt = Date.now()
    feedCache.loading = null
    feedCache.listeners.forEach(fn => fn(feedCache.rows))
    return feedCache.rows
  })()
  return feedCache.loading
}

export function useOrdersPrevious() {
  const [rows, setRows] = useState(feedCache.previous)
  useEffect(() => {
    feedCache.prevListeners.add(setRows)
    refreshFeed()
    return () => { feedCache.prevListeners.delete(setRows) }
  }, [])
  return rows
}

export function useOrdersFeed() {
  const [rows, setRows] = useState(feedCache.rows)
  useEffect(() => {
    feedCache.listeners.add(setRows)
    refreshFeed()
    const onFocus = () => refreshFeed()
    window.addEventListener('focus', onFocus)
    return () => { feedCache.listeners.delete(setRows); window.removeEventListener('focus', onFocus) }
  }, [])
  return rows
}

// Tag an Orders & POs quote as "Quote for Pricing" (or back to an order)
export async function setFeedPricing(id, on) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad) return false
  try {
    const res = await window.desktop.ordersLoad()
    const local = { version: 1, overrides: {}, ...((res && res.local) || {}) }
    const overrides = { ...(local.overrides || {}) }
    const cur = { ...(overrides[id] || {}) }
    if (on) cur.pricingOnly = true; else delete cur.pricingOnly
    if (Object.keys(cur).length) overrides[id] = cur; else delete overrides[id]
    const ok = await window.desktop.ordersSaveLocal({ ...local, overrides })
    await refreshFeed(true)
    try { window.dispatchEvent(new Event('orders-local-changed')) } catch { /* ignore */ }
    return !!ok
  } catch { return false }
}
// Filed as "Quote for Pricing" (to one of your quotes / projects) — the whole
// row, or every quote # on it when it's split
export function isPricingFiled(r) {
  if (r.filedAs === 'quote') return true
  const pf = Object.values(r.partFilings || {})
  return pf.length > 0 && pf.every(f => f && f.filedAs === 'quote')
}
// File an Orders & POs quote as "Quote for Pricing" for one of your quotes /
// projects (ref = its name or quote #). Empty filing = untagged again.
export async function setFeedPricingFor(id, { ref = '', refLabel = '' } = {}, on = true) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad) return false
  try {
    const res = await window.desktop.ordersLoad()
    const local = { version: 1, overrides: {}, ...((res && res.local) || {}) }
    const overrides = { ...(local.overrides || {}) }
    const cur = { ...(overrides[id] || {}) }
    if (on) { cur.filedAs = 'quote'; cur.ref = ref; cur.refLabel = refLabel; cur.pricingOnly = true; delete cur.refs }
    else { delete cur.pricingOnly; if (cur.filedAs === 'quote') { delete cur.filedAs; delete cur.ref; delete cur.refLabel } }
    if (Object.keys(cur).length) overrides[id] = cur; else delete overrides[id]
    const ok = await window.desktop.ordersSaveLocal({ ...local, overrides })
    await refreshFeed(true)
    try { window.dispatchEvent(new Event('orders-local-changed')) } catch { /* ignore */ }
    return !!ok
  } catch { return false }
}
// What an Orders & POs row is now: 'po' | 'waiting' | 'none' | 'pricing'
export function feedPoState(r) {
  if (String(r.poNumber || '').replace(/^po\s*#?\s*/i, '').trim()) return 'po'
  if (r.pricingOnly || isPricingFiled(r)) return 'pricing'
  return ['Ordered', 'Received', 'Closed'].includes(r.status) ? 'none' : 'waiting'
}

// Give an Orders & POs quote its PO # (makes it an order). Returns true if saved.
export async function setFeedPo(id, po) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad) return false
  const v = String(po || '').trim().replace(/^po\s*#?\s*/i, '')
  try {
    const res = await window.desktop.ordersLoad()
    const local = { version: 1, overrides: {}, ...((res && res.local) || {}) }
    const overrides = { ...(local.overrides || {}) }
    const cur = { ...(overrides[id] || {}) }
    if (v) cur.poNumber = v; else delete cur.poNumber
    if (Object.keys(cur).length) overrides[id] = cur; else delete overrides[id]
    const ok = await window.desktop.ordersSaveLocal({ ...local, overrides })
    await refreshFeed(true)
    try { window.dispatchEvent(new Event('orders-local-changed')) } catch { /* ignore */ }
    return !!ok
  } catch { return false }
}

// A packing slip was saved in Materials: mark the matching order(s) Received
// in Orders & POs and remember which slip did it. Returns the matched rows.
export async function linkSlipToOrders({ poNumber, wholesaler, invoiceNumber, materialsOrderId, balanced }) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad || !normPo(poNumber)) return []
  try {
    const res = await window.desktop.ordersLoad()
    if (!res || !res.feed) return []
    const matches = matchOrdersByPo(mergeOrders(res.feed, res.local), poNumber)
    if (matches.length === 0) return []
    const local = { version: 1, overrides: {}, ...(res.local || {}) }
    const overrides = { ...(local.overrides || {}) }
    const at = new Date().toISOString()
    for (const m of matches) {
      const cur = { ...(overrides[m.id] || {}) }
      // Received only once the quote and the slips balance (or it was forced)
      if (balanced && cur.status !== 'Closed' && cur.status !== 'Received') { cur.status = 'Received'; cur.at = at }
      cur.slip = { invoiceNumber: invoiceNumber || '', wholesaler: wholesaler || '', materialsOrderId: materialsOrderId || '', at }
      overrides[m.id] = cur
    }
    await window.desktop.ordersSaveLocal({ ...local, overrides })
    refreshFeed(true)
    return matches
  } catch {
    return []
  }
}


// The slips on this PO now balance with the quote: mark the order(s) Received.
export async function markReceivedByPo(poNumber) {
  if (typeof window === 'undefined' || !window.desktop?.ordersLoad || !normPo(poNumber)) return false
  try {
    const res = await window.desktop.ordersLoad()
    if (!res || !res.feed) return false
    const matches = matchOrdersByPo(mergeOrders(res.feed, res.local), poNumber).filter(m => m.status !== 'Received' && m.status !== 'Closed')
    if (!matches.length) return false
    const local = { version: 1, overrides: {}, ...(res.local || {}) }
    const overrides = { ...(local.overrides || {}) }
    const at = new Date().toISOString()
    for (const m of matches) overrides[m.id] = { ...(overrides[m.id] || {}), status: 'Received', at, balancedAt: at }
    await window.desktop.ordersSaveLocal({ ...local, overrides })
    refreshFeed(true)
    return true
  } catch { return false }
}

// ── PO emails from Jonathan (Power Automate → "Field App/PO Emails") ──
// Each file is one email. Find the PO number(s) in it and the supplier quote /
// order number it's about (usually in the subject, e.g.
// "FW: Nedco Quote #:6055465 RDP" + "Please proceed with the attached, PO 10110"),
// then put that PO on the matching order — the same as typing it in.
function stripHtml(t) {
  return String(t || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d))
}
export function parsePoEmail(raw) {
  let text = String(raw || '')
  try { const j = JSON.parse(text); if (j && typeof j === 'object') text = [j.subject && `Subject: ${j.subject}`, j.from && `From: ${j.from}`, j.received && `Received: ${j.received}`, j.body || j.bodyPreview || ''].filter(Boolean).join('\n') } catch { /* not JSON */ }
  if (/<\w+[^>]*>/.test(text)) text = stripHtml(text)
  const subject = (text.match(/^\s*Subject:\s*(.+)$/im) || [])[1] || ''
  // Only the newest message — stop at the quoted older ones
  const cut = text.search(/^\s*(From:.*\n.*Sent:|-{2,}\s*Original Message|On .+ wrote:)/im)
  const fresh = cut > 0 ? text.slice(0, cut + 1) + '\n' : text
  const body = fresh.replace(/^\s*(Subject|From|To|Cc|Received|Sent|Date):.*$/gim, ' ')
  const pos = [...new Set([...body.matchAll(/\bP\.?\s?O\.?\s*(?:#|No\.?|number)?\s*[:#-]?\s*(\d{4,7})\b/gi)].map(m => m[1].replace(/^0+/, '')))]
  return { subject, text, fresh, pos }
}
// rows: merged Orders & POs rows. Returns [{ file, po, rowIds, note }]
export function matchPoEmails(files, rows, seen = {}) {
  const out = []
  for (const f of files || []) {
    if (seen[f.name]) continue
    const p = parsePoEmail(f.text)
    if (!p.pos.length) { out.push({ file: f.name, po: '', rowIds: [], note: 'no PO in it' }); continue }
    const hay = (p.subject + ' ' + p.text).toLowerCase().replace(/[^0-9a-z]/g, ' ')
    const words = new Set(hay.split(/\s+/).filter(Boolean))
    const hits = (rows || []).filter(o => !o.archived && quoteNumbersOf(o).some(n => {
      const k = numKey(n)
      if (k.length < 5) return false
      // the quote # appears as its own word, or with a prefix/suffix the supplier adds
      return words.has(k) || [...words].some(w => w.includes(k) && w.length - k.length <= 5) // QT6055465, GES1826804000
    }))
    if (p.pos.length > 1 && hits.length !== p.pos.length) { out.push({ file: f.name, po: p.pos.join(', '), rowIds: [], note: 'more than one PO in it — add it by hand' }); continue }
    out.push({ file: f.name, po: p.pos[0], rowIds: hits.map(o => o.id), note: hits.length ? '' : 'no matching quote in Orders & POs', subject: p.subject })
  }
  return out
}
// Read the PO emails and apply any new ones. Returns { applied: [...], unmatched: [...] }.
export async function checkPoEmails() {
  const res = { applied: [], unmatched: [], missing: false }
  if (typeof window === 'undefined' || !window.desktop?.ordersReadPoEmails || !window.desktop?.ordersLoad) return res
  try {
    const r = await window.desktop.ordersReadPoEmails()
    if (!r || !r.ok) return res
    if (r.missing) { res.missing = true; return res }
    const load = await window.desktop.ordersLoad()
    if (!load || !load.feed) return res
    const rows = mergeOrders(load.feed, load.local)
    const local = { version: 1, overrides: {}, ...(load.local || {}) }
    const seen = { ...(local.poEmailsSeen || {}) }
    const found = matchPoEmails(r.files, rows, seen)
    if (!found.length) return res
    const overrides = { ...(local.overrides || {}) }
    const at = new Date().toISOString()
    for (const m of found) {
      seen[m.file] = { at, po: m.po, rows: m.rowIds, note: m.note }
      if (!m.po || !m.rowIds.length) { if (m.po) res.unmatched.push(m); continue }
      for (const id of m.rowIds) {
        const row = rows.find(o => o.id === id)
        const cur = { ...(overrides[id] || {}) }
        if (row.poNumber && normPo(row.poNumber) !== normPo(m.po)) { res.unmatched.push({ ...m, note: `${row.supplier} ${row.quoteNumber} already has PO ${row.poNumber}` }); continue }
        if (normPo(row.poNumber) === normPo(m.po)) continue
        cur.poNumber = m.po; cur.poFrom = { file: m.file, at }
        overrides[id] = cur
        res.applied.push({ po: m.po, row: `${row.supplier} ${row.quoteNumber}` })
      }
    }
    // keep the seen list from growing forever
    const names = Object.keys(seen).sort((a, b) => (seen[b].at || '').localeCompare(seen[a].at || '')).slice(0, 400)
    await window.desktop.ordersSaveLocal({ ...local, overrides, poEmailsSeen: Object.fromEntries(names.map(n => [n, seen[n]])) })
    refreshFeed(true)
  } catch { /* try again next refresh */ }
  return res
}

// ── Quote Slips pick-up (↻ Refresh) ──
// The morning run only reads email once a day. Dustin's Power Automate flow
// drops every supplier quote PDF into "Field App/Quote Slips" as it arrives,
// so Refresh reads any PDF it hasn't seen yet and adds it (or updates a
// revised quote) until the next morning run takes over with the email link.

export function numKey(s) {
  return String(s || '').toLowerCase().replace(/^order\s*/, '').replace(/-00$/, '').replace(/[^0-9a-z]/g, '')
}

function slugify(s) {
  return String(s || 'supplier').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || 'supplier'
}

// Feed rows with quotes picked up from Quote Slips laid on top: new quotes
// become their own rows; a revised PDF newer than the feed replaces that
// quote's total and lines.
export function withSlipQuotes(feed, local) {
  const rows = ((feed && feed.orders) || []).map(o => ({ ...o }))
  const slips = (local && local.slipQuotes) || {}
  const keys = Object.keys(slips)
  if (keys.length === 0) return rows
  const feedAt = Date.parse((feed && feed.updatedAt) || '') || 0
  const used = new Set()
  for (const o of rows) {
    for (const n of quoteNumbersOf(o)) {
      const k = numKey(n)
      const sq = slips[k]
      if (!sq) continue
      used.add(k)
      if (!(sq.fileMtime > feedAt)) continue
      o.quoteTotals = { ...(o.quoteTotals || {}), [n]: Number(sq.total) || 0 }
      const lines = { ...(o.quoteLines || {}) }
      if (Array.isArray(sq.lines) && sq.lines.length) lines[n] = sq.lines
      else delete lines[n]
      o.quoteLines = lines
      o.quoteTotal = Math.round(Object.values(o.quoteTotals).reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100
      o.nextStep = `Revised quote picked up from Quote Slips ${String(sq.parsedAt || '').slice(0, 10)}${o.nextStep ? ` · ${o.nextStep}` : ''}`
      o.fromSlip = true
    }
  }
  const ids = new Set(rows.map(o => o.id))
  for (const k of keys) {
    if (used.has(k)) continue
    const sq = slips[k]
    let id = `${slugify(sq.supplier)}-${k}`
    if (ids.has(id)) id = `slip-${k}`
    ids.add(id)
    rows.push({
      id, status: sq.kind === 'order' ? 'Ordered' : 'Quote in', supplier: sq.supplier || '', contact: sq.contact || '',
      quoteNumber: sq.number, description: sq.description || '', job: sq.jobRef || '', date: sq.date || String(sq.parsedAt || '').slice(0, 10),
      poNumber: sq.poNumber || '', quoteTotal: Number(sq.total) || 0, quoteTotals: { [sq.number]: Number(sq.total) || 0 },
      quoteLines: Array.isArray(sq.lines) && sq.lines.length ? { [sq.number]: sq.lines } : {},
      nextStep: 'Picked up from Quote Slips; the morning run adds the email details', filedAs: '', ref: '', refLabel: '',
      quoteLinks: [], fromSlip: true,
    })
  }
  return rows
}

const SLIP_PROMPT = 'This PDF is an electrical wholesaler document sent to SCE Electric: usually a QUOTATION (Nedco, Gescan, Westburne/Rexel, Triangle, WOW Lighting…), sometimes an ORDER CONFIRMATION. Extract: kind ("quote" or "order"), supplier (the wholesaler company that issued it, e.g. "Nedco", "Gescan", "Westburne"), contact (the quoting person\'s name if shown), number (the quote number, or the order number for an order confirmation; for Gescan drop a trailing "-00"), date (YYYY-MM-DD), jobRef (the customer reference / job name printed on it, e.g. "WAY FINDING", "RESI"), poNumber (only if printed), subtotal (the pre-tax total exactly as printed: Nedco "TOTAL Before Taxes", Gescan the final TOTAL before tax, others "Subtotal"), and every line item: qty (plain units — each, metres or feet as printed; never rescale), uom, partNo (the supplier product code), desc (short readable description), ext (the extended/line total exactly as printed). Respond with ONLY raw JSON: {"kind":"quote","supplier":"","contact":"","number":"","date":"","jobRef":"","poNumber":"","subtotal":0,"lines":[{"qty":0,"uom":"","partNo":"","desc":"","ext":0}]}'

async function parseQuoteSlip(base64, apiKey) {
  const res = await aiPost(apiKey, {
      model: AI_MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: SLIP_PROMPT },
      ] }],
    })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try { const b = await res.json(); if (b?.error?.message) detail = b.error.message } catch { /* status only */ }
    throw new Error(detail)
  }
  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '')
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a === -1 || b < a) throw new Error('No JSON in the response')
  return JSON.parse(text.slice(a, b + 1))
}

// Check Quote Slips for PDFs not seen since the last check. Returns
// { added: [numbers], revised: [numbers], errors: [{file, error}], needKey, reason }.
export async function checkQuoteSlips(apiKey) {
  const out = { added: [], revised: [], errors: [], needKey: false, reason: '' }
  if (typeof window === 'undefined' || !window.desktop?.ordersListQuoteSlips) { out.reason = 'old-app'; return out }
  const list = await window.desktop.ordersListQuoteSlips()
  if (!list || !list.ok) { out.reason = (list && list.reason) || 'no-folder'; return out }
  const res = await window.desktop.ordersLoad()
  if (!res || !res.feed) { out.reason = 'no-feed'; return out }
  const local = { version: 1, overrides: {}, ...(res.local || {}) }
  const seen = { ...(local.slipSeen || {}) }
  const slipQuotes = { ...(local.slipQuotes || {}) }
  const feedAt = Date.parse(res.feed.updatedAt || '') || 0
  const feedKeys = new Set()
  for (const o of res.feed.orders || []) for (const n of quoteNumbersOf(o)) feedKeys.add(numKey(n))
  const inFeed = fileKey => [...feedKeys].some(k => k.length >= 4 && fileKey.includes(k))

  const todo = []
  for (const f of list.files) {
    if (seen[f.name] === f.mtimeMs) continue
    // Already in the feed and not newer than the morning run: nothing to do.
    if (inFeed(f.key) && f.mtimeMs <= feedAt) { seen[f.name] = f.mtimeMs; continue }
    todo.push(f)
  }
  if (todo.length && !apiKey) { out.needKey = true; out.pending = todo.length }
  else {
    todo.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const f of todo) {
      try {
        const b64 = await window.desktop.ordersReadQuoteSlip(f.name)
        if (!b64) throw new Error('could not read the file')
        const p = await parseQuoteSlip(b64, apiKey)
        const number = String(p.number || '').replace(/-00$/, '').trim()
        const k = numKey(number)
        if (!k) throw new Error('no quote number found')
        const total = Math.round((Number(p.subtotal) || 0) * 100) / 100
        let lines = (Array.isArray(p.lines) ? p.lines : []).map((l, i) => ({
          n: String(i + 1), qty: Number(l.qty) || 0, uom: String(l.uom || '').toLowerCase(), partNo: l.partNo || '', desc: l.desc || '', ext: Number(l.ext) || 0,
        }))
        const sum = lines.reduce((a, l) => a + l.ext, 0)
        if (total && Math.abs(sum - total) > 0.05) lines = []
        const isRevision = feedKeys.has(k) || !!slipQuotes[k]
        slipQuotes[k] = {
          kind: p.kind === 'order' ? 'order' : 'quote', number, supplier: p.supplier || '', contact: p.contact || '',
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : '', jobRef: p.jobRef || '', poNumber: p.poNumber || '',
          description: p.jobRef ? String(p.jobRef) : '', total, lines, file: f.name, fileMtime: f.mtimeMs, parsedAt: new Date().toISOString(),
        }
        ;(isRevision ? out.revised : out.added).push(number)
      } catch (e) {
        out.errors.push({ file: f.name, error: e.message || String(e) })
      }
      seen[f.name] = f.mtimeMs
    }
  }
  // Drop picked-up quotes the morning run has since caught up with.
  for (const [k, sq] of Object.entries(slipQuotes)) {
    if (feedKeys.has(k) && !(sq.fileMtime > feedAt)) delete slipQuotes[k]
  }
  await window.desktop.ordersSaveLocal({ ...local, slipSeen: seen, slipQuotes, lastSlipCheck: new Date().toISOString() })
  refreshFeed(true)
  return out
}
