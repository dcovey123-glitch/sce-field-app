// My Boy Claude — the in-app assistant.
//
// Claude can READ everything in the app (customers, jobs, quotes, supplier
// slips and quotes, the Catalog, the schedule, notes) and search the web.
// It can't change anything itself: every change comes back as a PROPOSAL
// card (add tasks, add a scope or lines to a quote, add a job note, book a
// schedule block) that does nothing until Dustin clicks Apply.

import { aiPost } from './ai.js'
import { readValue } from './fileStore.js'
import { quoteGrandTotal } from './quoteMath.js'

export const CHATS_KEY = 'assistant_chats'
export const MAX_TURNS = 10 // tool rounds per question before it has to answer
const RESULT_CAP = 40000 // characters of one tool result sent back to Claude

const lc = s => String(s || '').toLowerCase()
const words = q => lc(q).split(/\s+/).filter(Boolean)
const matches = (obj, ws) => { const t = lc(JSON.stringify(obj)); return ws.every(w => t.includes(w)) }
const cap = (v, n = RESULT_CAP) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + `\n…(cut off — ${s.length - n} more characters; ask for something narrower)` : s }
export const pid = () => 'p' + Math.random().toString(36).slice(2, 10)

// ── What Claude can call ──
export const TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  {
    name: 'search_app',
    description: 'Search everything in the SCE field app by keywords (all words must match, any field). Covers customers, jobs, Dustin\'s quotes, supplier slips/quotes/invoices (material_orders), the parts Catalog, calendar events and notes. Returns short summaries with ids — then use get_job / get_quote / get_record for the full thing.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Keywords, e.g. "finance wall", "Q-26-114", "nedco 5962096", "lutron dimmer"' },
      kinds: { type: 'array', items: { type: 'string', enum: ['customers', 'jobs', 'quotes', 'slips', 'catalog', 'calendar', 'notes'] }, description: 'Limit to these kinds (default all)' },
      include_closed: { type: 'boolean', description: 'Include billed / trashed / invalidated items (default false)' },
    }, required: ['query'] },
  },
  {
    name: 'get_job',
    description: 'Everything about one job: the full job record (tasks, deficiencies, labor and material entries, notes, CO, status, dates), its customer, linked quotes with totals, supplier slips tagged to it, and schedule blocks booked on it.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] },
  },
  {
    name: 'get_quote',
    description: 'One of Dustin\'s quotes in full: scopes (scope text, material lines, labor lines), allowances, markup, adjustments, status, the grand total, its customer and any supplier pricing quotes tagged to it.',
    input_schema: { type: 'object', properties: { quote_id: { type: 'string' } }, required: ['quote_id'] },
  },
  {
    name: 'get_record',
    description: 'The full record for a supplier slip/quote (kind "slip"), a Catalog part (kind "catalog") or a calendar event (kind "calendar"), by the id search_app gave.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['slip', 'catalog', 'calendar'] }, id: { type: 'string' } }, required: ['kind', 'id'] },
  },
  {
    name: 'get_schedule',
    description: 'Crew schedule blocks between two dates (YYYY-MM-DD, inclusive): who, which job, times, notes.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'propose_job_tasks',
    description: 'Suggest tasks to add to a job. Shown to Dustin as a card; nothing changes until he clicks Apply.',
    input_schema: { type: 'object', properties: {
      job_id: { type: 'string' }, why: { type: 'string', description: 'One line on why' },
      tasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, who: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['text'] } },
    }, required: ['job_id', 'tasks'] },
  },
  {
    name: 'propose_job_note',
    description: 'Suggest text to add to the end of a job\'s notes. Dustin approves it first.',
    input_schema: { type: 'object', properties: { job_id: { type: 'string' }, text: { type: 'string' }, why: { type: 'string' } }, required: ['job_id', 'text'] },
  },
  {
    name: 'propose_quote_scope',
    description: 'Suggest a new scope for one of Dustin\'s quotes: name, scope text, material lines (at COST before GST — the quote adds its own markup) and labor lines (hours × rate). Dustin approves it first.',
    input_schema: { type: 'object', properties: {
      quote_id: { type: 'string' }, why: { type: 'string' },
      scope: { type: 'object', properties: {
        name: { type: 'string' }, scopeText: { type: 'string' },
        materials: { type: 'array', items: { type: 'object', properties: { partNo: { type: 'string' }, desc: { type: 'string' }, qty: { type: 'number' }, uom: { type: 'string' }, rate: { type: 'number', description: 'Unit cost' } }, required: ['desc', 'qty', 'rate'] } },
        labor: { type: 'array', items: { type: 'object', properties: { desc: { type: 'string' }, qty: { type: 'number', description: 'Hours' }, rate: { type: 'number' } }, required: ['desc', 'qty'] } },
      }, required: ['name'] },
    }, required: ['quote_id', 'scope'] },
  },
  {
    name: 'propose_quote_lines',
    description: 'Suggest material and/or labor lines to add to an EXISTING scope on a quote (scope_id from get_quote). Dustin approves it first.',
    input_schema: { type: 'object', properties: {
      quote_id: { type: 'string' }, scope_id: { type: 'string' }, why: { type: 'string' },
      materials: { type: 'array', items: { type: 'object', properties: { partNo: { type: 'string' }, desc: { type: 'string' }, qty: { type: 'number' }, uom: { type: 'string' }, rate: { type: 'number' } }, required: ['desc', 'qty', 'rate'] } },
      labor: { type: 'array', items: { type: 'object', properties: { desc: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number' } }, required: ['desc', 'qty'] } },
    }, required: ['quote_id', 'scope_id'] },
  },
  {
    name: 'propose_schedule_block',
    description: 'Suggest booking crew on a job (or other work) on the Crew Schedule. Times like "7:00 a.m." or "15:30". Dustin approves it first.',
    input_schema: { type: 'object', properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' }, workers: { type: 'array', items: { type: 'string' } },
      job_id: { type: 'string', description: 'For job work' }, title: { type: 'string', description: 'For non-job work' },
      start: { type: 'string' }, end: { type: 'string' }, notes: { type: 'string' }, why: { type: 'string' },
    }, required: ['date', 'workers'] },
  },
]

export function systemPrompt({ me, today, crew }) {
  return `You are Claude, built into the SCE Electric field app as "My Boy Claude". You're helping ${me || 'Dustin'}, the project manager at SCE Electric Western Canada Ltd. (Red Deer, AB), who runs the on-site side of the Red Deer Polytechnic (RDP / CANA MSA) work and other jobs. Today is ${today}. Crew: ${(crew || []).join(', ') || 'not listed'}.

How the business works: labor is billed at $90/hr (overall man-hours, apprentices the same). Material costs are before GST (Jonathan adds tax at billing). T&M material goes out at cost + 15%. A quote has scopes, each with scope text, material lines at cost (qty × unit cost; the quote adds its own material markup, usually 15%) and labor lines (hours × rate, usually $90). Allowances and adjustments sit outside the scopes.

How to work:
- Look things up in the app with the tools before answering — don't guess at job, quote or price details. Use web_search for anything outside the app (product specs, code, prices, manufacturers).
- You can't change anything yourself. To suggest a change, call a propose_* tool: it shows up as a card with an Apply button, and nothing happens until he clicks it. Make proposals specific and ready to apply. Never claim a change was made.
- Prices: use real numbers from his slips, supplier quotes or the Catalog and say where each came from. If you have to estimate, say so plainly.
- Answer short and to the point: what matters first, details after. Plain text, short lists where they help. No sign-off on email drafts (his Outlook adds the signature).`
}

// ── The data the tools read (all live from the app) ──
// ctx: { jobs, jobCustomers, quotes, quoteCustomers, assignments }
function lists(ctx) {
  const slips = readValue('material_orders', []) || []
  const catalog = readValue('material_catalog', []) || []
  const events = readValue('calendar_events', []) || []
  const daily = readValue('daily_notes', {}) || {}
  const general = readValue('general_notes', []) || []
  return { slips: Array.isArray(slips) ? slips : [], catalog: Array.isArray(catalog) ? catalog : (catalog.items || []), events: Array.isArray(events) ? events : [], daily, general, ...ctx }
}
const custName = (list, id) => ((list || []).find(c => c.id === id) || {}).name || ''
const jobLive = j => !j.trashedAt && j.lifecycleStatus !== 'billed'
const quoteLive = q => !q.trashedAt && !q.invalidated
function quoteStatus(q) { return q.invalidated ? 'invalidated' : q.approved ? 'approved' : q.status === 'yellow' ? 'sent, not approved' : 'not sent' }
function safeTotal(q) { try { return Math.round(quoteGrandTotal(q) * 100) / 100 } catch { return null } }
const slipSummary = s => ({ id: s.id, docType: s.docType || 'packing_slip', kind: s.kind || '', wholesaler: s.wholesaler || '', poNumber: s.poNumber || '', invoiceNumber: s.invoiceNumber || '', orderDate: s.orderDate || '', jobs: s.jobs || '', subtotal: s.subtotal ?? null, lines: (s.lineItems || []).length, note: s.note || '' })
const slipTouchesJob = (s, job) => matches(s.jobs || '', words(job.name)) || lc(JSON.stringify(s.jobs || '')).includes(lc(job.id))

function search(input, ctx) {
  const L = lists(ctx)
  const ws = words(input.query)
  if (!ws.length) return { error: 'Give me some keywords.' }
  const want = k => !input.kinds || !input.kinds.length || input.kinds.includes(k)
  const all = !!input.include_closed
  const out = {}
  const take = (k, arr, fn, n = 15) => { const hit = arr.filter(x => matches(x, ws)); if (hit.length) out[k] = { found: hit.length, showing: hit.slice(0, n).map(fn) } }
  if (want('customers')) take('customers', [...(L.jobCustomers || []).map(c => ({ ...c, side: 'jobs' })), ...(L.quoteCustomers || []).map(c => ({ ...c, side: 'quotes' }))].filter(c => all || !c.trashedAt), c => ({ id: c.id, name: c.name, code: c.code || '', side: c.side }))
  if (want('jobs')) take('jobs', (L.jobs || []).filter(j => all || jobLive(j)).map(j => ({ ...j, customerName: custName(L.jobCustomers, j.customerId) })), j => ({ id: j.id, name: j.name, customer: j.customerName, co: j.co || '', type: j.type || '', status: j.lifecycleStatus || j.status || '', openTasks: (j.tasks || []).filter(t => !t.done).length, openDeficiencies: (j.deficiencies || []).filter(d => !d.resolved).length }))
  if (want('quotes')) take('quotes', (L.quotes || []).filter(q => all || quoteLive(q)).map(q => ({ ...q, customerName: custName(L.quoteCustomers, q.customerId) })), q => ({ id: q.id, number: q.quoteNumber || '', title: q.title || '', customer: q.customerName, status: quoteStatus(q), total: safeTotal(q), scopes: (q.scopes || []).map(s => s.name) }))
  if (want('slips')) take('slips', L.slips, slipSummary)
  if (want('catalog')) take('catalog', L.catalog, p => cap(p, 400), 25)
  if (want('calendar')) take('calendar', L.events, e => cap(e, 400))
  if (want('notes')) {
    const notes = [...Object.entries(L.daily).map(([date, v]) => ({ where: 'daily note ' + date, text: v })), ...(Array.isArray(L.general) ? L.general : []).map(n => ({ where: 'general note', text: n }))]
    take('notes', notes, n => ({ where: n.where, text: cap(n.text, 1500) }), 10)
  }
  return Object.keys(out).length ? out : { found: 0, note: all ? 'Nothing matched — try fewer or different words.' : 'Nothing matched in live items — try fewer words, or include_closed: true.' }
}

function getJob({ job_id }, ctx) {
  const L = lists(ctx)
  const j = (L.jobs || []).find(x => x.id === job_id)
  if (!j) return { error: 'No job with that id — search_app first.' }
  const qids = new Set([...(j.linkedQuoteIds || []), j.linkedQuoteId, j.pendingQuoteId].filter(Boolean))
  const quotes = (L.quotes || []).filter(q => qids.has(q.id) || q.linkedJobId === j.id || (q.fromJob && q.fromJob.jobId === j.id))
  return {
    customer: custName(L.jobCustomers, j.customerId),
    job: j,
    linkedQuotes: quotes.map(q => ({ id: q.id, number: q.quoteNumber, title: q.title, status: quoteStatus(q), total: safeTotal(q) })),
    supplierSlips: L.slips.filter(s => slipTouchesJob(s, j)).slice(0, 40).map(slipSummary),
    scheduled: (L.assignments || []).filter(a => a.jobId === j.id).map(a => ({ date: a.date, workers: a.workers, start: a.start, end: a.end, hours: a.hours, notes: a.notes })),
  }
}

function getQuote({ quote_id }, ctx) {
  const L = lists(ctx)
  const q = (L.quotes || []).find(x => x.id === quote_id)
  if (!q) return { error: 'No quote with that id — search_app first.' }
  return {
    customer: custName(L.quoteCustomers, q.customerId), status: quoteStatus(q), grandTotal: safeTotal(q), quote: q,
    supplierPricing: L.slips.filter(s => s.pricingTarget && lc(JSON.stringify(s.pricingTarget)).includes(lc(q.id))).map(slipSummary),
  }
}

function getRecord({ kind, id }, ctx) {
  const L = lists(ctx)
  const arr = kind === 'slip' ? L.slips : kind === 'catalog' ? L.catalog : L.events
  const r = arr.find(x => x.id === id || x.partNo === id)
  return r || { error: 'Not found — use the id from search_app.' }
}

function getSchedule({ from, to }, ctx) {
  const L = lists(ctx)
  const jobName = id => ((L.jobs || []).find(j => j.id === id) || {}).name || ''
  return (L.assignments || []).filter(a => a.date >= from && a.date <= to).sort((x, y) => x.date.localeCompare(y.date))
    .map(a => ({ date: a.date, workers: a.workers, kind: a.kind, job: a.kind === 'job' ? jobName(a.jobId) : '', title: a.title || a.bucket || '', start: a.start, end: a.end, hours: a.hours, notes: a.notes }))
}

// Proposals: checked here (does the job / quote / scope exist?) and handed to
// the screen as a card
function propose(name, input, ctx) {
  const L = lists(ctx)
  const job = input.job_id ? (L.jobs || []).find(j => j.id === input.job_id) : null
  const quote = input.quote_id ? (L.quotes || []).find(q => q.id === input.quote_id) : null
  if (input.job_id && !job) return { error: 'No job with that id.' }
  if (input.quote_id && !quote) return { error: 'No quote with that id.' }
  if (name === 'propose_quote_lines' && !(quote.scopes || []).some(s => s.id === input.scope_id)) return { error: 'That quote has no scope with that id — check get_quote.' }
  if (name === 'propose_job_tasks' && !(input.tasks || []).length) return { error: 'No tasks given.' }
  if (name === 'propose_schedule_block' && !(input.workers || []).length) return { error: 'Who is it for?' }
  const label = job ? job.name : quote ? `${quote.quoteNumber || ''} ${quote.title || ''}`.trim() : ''
  return { proposal: { id: pid(), type: name.replace('propose_', ''), input, label, status: 'waiting' } }
}

export function runTool(name, input, ctx) {
  try {
    if (name === 'search_app') return search(input, ctx)
    if (name === 'get_job') return getJob(input, ctx)
    if (name === 'get_quote') return getQuote(input, ctx)
    if (name === 'get_record') return getRecord(input, ctx)
    if (name === 'get_schedule') return getSchedule(input, ctx)
    if (name.startsWith('propose_')) return propose(name, input, ctx)
    return { error: 'Unknown tool ' + name }
  } catch (e) { return { error: String(e.message || e) } }
}

// One question → Claude looks things up as it needs to → the answer.
// history = earlier question/answer pairs (historyFrom). Returns { messages,
// text, proposals, searched, sources }. onStep(label) tells the screen what it's doing.
export async function ask({ apiKey, history, question, ctx, system, onStep, fetchImpl, retryDelayMs }) {
  const messages = [...(history || []), { role: 'user', content: question }]
  const proposals = []
  let searched = 0
  let tools = TOOLS
  // If web search isn't turned on for the key's account, carry on without it
  const post = async body => {
    try { return await aiPost(apiKey, { ...body, tools }, { fetchImpl, retryDelayMs }) } catch (e) {
      if (e.status === 400 && tools === TOOLS && /web_search|web search|tool/i.test(e.message)) {
        tools = TOOLS.filter(t => t.name !== 'web_search')
        return aiPost(apiKey, { ...body, tools }, { fetchImpl, retryDelayMs })
      }
      throw e
    }
  }
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await post({ max_tokens: 4000, system, messages })
    const data = await res.json()
    const content = data.content || []
    messages.push({ role: 'assistant', content })
    searched += content.filter(b => b.type === 'server_tool_use').length
    const calls = content.filter(b => b.type === 'tool_use')
    if (data.stop_reason === 'pause_turn') { continue } // a long web search: let it carry on
    if (data.stop_reason !== 'tool_use' || !calls.length) {
      return { messages, text: textOf(content), proposals, searched, sources: sourcesOf(messages) }
    }
    const results = calls.map(c => {
      onStep && onStep(stepLabel(c))
      const out = runTool(c.name, c.input || {}, ctx)
      if (out && out.proposal) {
        proposals.push(out.proposal)
        return { type: 'tool_result', tool_use_id: c.id, content: 'Shown to Dustin as a card with an Apply button. NOT applied yet — he decides.' }
      }
      return { type: 'tool_result', tool_use_id: c.id, content: cap(out), ...(out && out.error ? { is_error: true } : {}) }
    })
    messages.push({ role: 'user', content: results })
  }
  // Out of rounds: ask for an answer with what it has
  const last = messages[messages.length - 1]
  if (last.role === 'user' && Array.isArray(last.content)) last.content = [...last.content, { type: 'text', text: 'That\'s enough looking — answer now with what you have.' }]
  const res = await post({ max_tokens: 3000, system, messages, tool_choice: { type: 'none' } })
  const data = await res.json()
  messages.push({ role: 'assistant', content: data.content || [] })
  return { messages, text: textOf(data.content || []), proposals, searched, sources: sourcesOf(messages) }
}

export function textOf(content) { return (content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() }

function stepLabel(c) {
  const i = c.input || {}
  if (c.name === 'search_app') return `Searching the app for "${i.query}"`
  if (c.name === 'get_job') return 'Pulling up the job'
  if (c.name === 'get_quote') return 'Opening the quote'
  if (c.name === 'get_record') return 'Opening the record'
  if (c.name === 'get_schedule') return 'Checking the schedule'
  return 'Writing up a suggestion'
}

// Earlier questions go back to Claude as plain question → answer pairs (the
// lookups behind them are dropped — it can look again if it needs to)
export function historyFrom(turns, keep = 12) {
  return (turns || []).filter(t => t.a).slice(-keep).flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }])
}

// Web pages Claude quoted from, for a "Sources" line
export function sourcesOf(messages) {
  const seen = new Map()
  for (const m of messages || []) for (const b of (Array.isArray(m.content) ? m.content : [])) {
    for (const c of (b.citations || [])) if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url)
  }
  return [...seen].map(([url, title]) => ({ url, title }))
}
