// ── Quote math, shared by Quotes, Jobs, Mobile sync and the Word export ──
//
// Layout 2 (current):
//   quote.scopes[]      → { id, name, scopeText, materials[], labor[] }
//   quote.allowances[]  → { id, category, desc, qty, rate, noMarkup }
//                         category: engineering | fireAlarm | permitting | other
//   quote.markup        → { materials, engineering, fireAlarm, permitting, other } (%)
//   quote.adjustments[] → { id, desc, amount } (no markup)
//   quote.completeQuote → the editable "Complete Quote" draft (see buildCompleteDraft)
//
// Older quotes kept allowances, sub trades, other costs and a discount inside
// each scope, all at a flat 15%. normalizeQuote() reads those the new way
// without changing the total:
//   scope allowances → Allowances › Permitting
//   scope sub trades + other costs → Allowances › Other
//   scope discount → an Adjustment (negative)

export const DEFAULT_MARKUP = 15

export const ALLOWANCE_CATEGORIES = [
  { id: 'engineering', label: 'Engineering', costLabel: 'Engineering Allowance' },
  { id: 'fireAlarm', label: 'Fire Alarm', costLabel: 'Fire Alarm Allowance' },
  { id: 'permitting', label: 'Permitting', costLabel: 'Permitting Fee' },
  { id: 'other', label: 'Other', costLabel: 'Other Costs' },
]

export const MARKUP_KEYS = [
  { id: 'materials', label: 'Materials' },
  ...ALLOWANCE_CATEGORIES.map(c => ({ id: c.id, label: c.label })),
]

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function lineAmount(i) {
  return (Number(i.qty) || 0) * (Number(i.rate) || 0)
}
function sumLines(list) {
  return (list || []).reduce((a, i) => a + lineAmount(i), 0)
}

export function isCurrentLayout(quote) {
  return !!quote && quote.layout === 2
}

// The patch that moves an older quote to the current layout. Returns null
// when the quote is already current. Totals come out exactly the same.
export function upgradePatch(quote) {
  if (!quote || isCurrentLayout(quote)) return null
  const scopes = quote.scopes || []
  const multi = scopes.length > 1
  const allowances = [...(quote.allowances || [])]
  const adjustments = [...(quote.adjustments || [])]
  const newScopes = scopes.map(sc => {
    const { allowances: al, subTrades, other, discount, ...rest } = sc
    const from = multi && sc.name ? ` (${sc.name})` : ''
    ;(al || []).forEach(i => allowances.push({ ...i, id: i.id || uid(), category: 'permitting', desc: `${i.desc || 'Allowance'}${from}`, noMarkup: false }))
    ;(subTrades || []).forEach(i => allowances.push({ ...i, id: i.id || uid(), category: 'other', desc: `${i.desc || 'Sub trade'}${from}`, noMarkup: false }))
    ;(other || []).forEach(i => allowances.push({ ...i, id: i.id || uid(), category: 'other', desc: `${i.desc || 'Other cost'}${from}`, noMarkup: false }))
    const disc = Number(discount) || 0
    if (disc) adjustments.push({ id: uid(), desc: `Discount${multi ? ` – ${sc.name || 'scope'}` : ''}`, amount: -disc })
    return { materials: [], labor: [], ...rest }
  })
  const markup = {}
  MARKUP_KEYS.forEach(k => { markup[k.id] = DEFAULT_MARKUP })
  return { layout: 2, scopes: newScopes, allowances, adjustments, markup: { ...markup, ...(quote.markup || {}) } }
}

// Read any quote (old or current) in the current layout, without saving anything.
export function normalizeQuote(quote) {
  if (!quote) return quote
  const patch = upgradePatch(quote)
  return patch ? { ...quote, ...patch } : quote
}

export function markupPct(quote, key) {
  const v = quote && quote.markup ? quote.markup[key] : undefined
  if (v === '' || v == null || isNaN(Number(v))) return DEFAULT_MARKUP
  return Number(v)
}
function factor(quote, key) {
  return 1 + markupPct(quote, key) / 100
}

export function scopeMaterialsRaw(sc) { return sumLines(sc.materials) }
export function scopeMaterialsMarked(quote, sc) { return scopeMaterialsRaw(sc) * factor(quote, 'materials') }
export function scopeLabor(sc) { return sumLines(sc.labor) }
export function scopeLaborHours(sc) { return (sc.labor || []).reduce((a, i) => a + (Number(i.qty) || 0), 0) }
export function scopeLaborRate(sc) {
  const items = (sc.labor || []).filter(i => Number(i.rate) > 0)
  if (items.length === 0) return null
  const rate = Number(items[0].rate)
  return items.every(i => Number(i.rate) === rate) ? rate : null
}
// Scope total = marked-up materials + labor (allowances are quote-wide now).
export function scopeTotal(quote, sc) {
  const q = normalizeQuote(quote)
  return scopeMaterialsMarked(q, sc) + scopeLabor(sc)
}

export function allowanceAmount(quote, a) {
  const base = lineAmount(a)
  return a.noMarkup ? base : base * factor(quote, a.category || 'other')
}
export function allowancesByCategory(quote) {
  const q = normalizeQuote(quote)
  return ALLOWANCE_CATEGORIES.map(c => {
    const items = (q.allowances || []).filter(a => (a.category || 'other') === c.id)
    return { ...c, items, total: items.reduce((s, a) => s + allowanceAmount(q, a), 0) }
  })
}
export function allowancesTotal(quote) {
  const q = normalizeQuote(quote)
  return (q.allowances || []).reduce((s, a) => s + allowanceAmount(q, a), 0)
}
export function adjustmentsTotal(quote) {
  return (quote.adjustments || []).reduce((a, adj) => a + (Number(adj.amount) || 0), 0)
}

export function quoteGrandTotal(quote) {
  if (!quote) return 0
  const q = normalizeQuote(quote)
  const scopes = (q.scopes || []).reduce((a, sc) => a + scopeMaterialsMarked(q, sc) + scopeLabor(sc), 0)
  return scopes + allowancesTotal(q) + adjustmentsTotal(q)
}
// What a job's "$Quoted" Materials / Labor show.
export function quoteMaterialsTotal(quote) {
  const q = normalizeQuote(quote)
  return (q.scopes || []).reduce((a, sc) => a + scopeMaterialsMarked(q, sc), 0)
}
export function quoteLaborTotal(quote) {
  const q = normalizeQuote(quote)
  return (q.scopes || []).reduce((a, sc) => a + scopeLabor(sc), 0)
}
export function referencePricingAmount(quote, r) {
  return (Number(r.amount) || 0) * factor(quote, 'materials')
}

// ── Complete Quote draft ──
// Plain money for the proposal text (same style the Word export always used).
export function proposalMoney(v) {
  const n = Number(v) || 0
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`
}
export function otherAllowanceLabel(quote) {
  return (quote.allowanceOtherTitle || '').trim() || 'Other Costs'
}
export function allowanceCostLines(quote) {
  const q = normalizeQuote(quote)
  return allowancesByCategory(q)
    .filter(c => c.total)
    .map(c => `${c.id === 'other' ? otherAllowanceLabel(q) : c.costLabel}:  ${proposalMoney(c.total)}`)
}
export function scopeCostLines(quote, sc) {
  const q = normalizeQuote(quote)
  const lines = []
  const mat = scopeMaterialsMarked(q, sc)
  const lab = scopeLabor(sc)
  if (mat > 0) lines.push(`Estimated Cost of Materials:  ${proposalMoney(mat)}`)
  if (lab > 0) {
    const rate = scopeLaborRate(sc)
    const rateText = rate != null ? ` @ $${rate.toFixed(0)}/hr` : ''
    lines.push(`Estimated Cost of Regular Time Labor (${scopeLaborHours(sc).toFixed(2)} Total Man-Hours${rateText}):  ${proposalMoney(lab)}`)
  }
  return lines
}
export function totalLineFor(name, amount) {
  return `Estimated Price to Complete ${name}:   ${proposalMoney(amount)} taxes not included.`
}
export function finalLineFor(quote, customerName) {
  return totalLineFor(quote.title || customerName || 'this project', quoteGrandTotal(quote))
}
export function adjustmentLinesFor(quote) {
  return (quote.adjustments || []).map(a => `${a.desc || 'Adjustment'}:  ${proposalMoney(a.amount)}`)
}
export function referenceLinesFor(quote) {
  return (quote.referencePricing || []).map(r => `${r.desc || 'Reference item'} — ${proposalMoney(referencePricingAmount(quote, r))}`)
}

// Builds a fresh Complete Quote draft from everything on the Pricing tab.
export function buildCompleteDraft(quote, customerName) {
  const q = normalizeQuote(quote)
  const scopes = q.scopes || []
  const allowLines = allowanceCostLines(q)
  const allowTotal = allowancesTotal(q)
  const blocks = scopes.map((sc, i) => {
    const name = sc.name || `Scope ${i + 1}`
    return {
      id: uid(), heading: name,
      scopeText: sc.scopeText || '',
      costText: scopeCostLines(q, sc).join('\n'),
      totalLine: totalLineFor(name, scopeTotal(q, sc)),
    }
  })
  if (allowLines.length) {
    if (blocks.length === 1) {
      // One scope: allowances sit right under its costs, like the old proposals.
      blocks[0].costText = [blocks[0].costText, ...allowLines].filter(Boolean).join('\n')
      blocks[0].totalLine = totalLineFor(blocks[0].heading, scopeTotal(q, scopes[0]) + allowTotal)
    } else {
      blocks.push({ id: uid(), heading: 'Allowances', scopeText: '', costText: allowLines.join('\n'), totalLine: totalLineFor('Allowances', allowTotal) })
    }
  }
  return {
    builtAt: new Date().toISOString(),
    basedOn: q.basedOn || '',
    notesText: q.proposalNotes || '',
    showHeadings: blocks.length > 1,
    blocks,
    adjustmentsText: adjustmentLinesFor(q).join('\n'),
    finalLine: finalLineFor(q, customerName),
    referenceText: referenceLinesFor(q).join('\n'),
  }
}

// ── General (overview) quote ──
// One price breakdown for the whole job: Materials, Labor, Allowances
// (and Adjustments if any). The total goes on the final price line.
export function generalPriceLines(quote) {
  const q = normalizeQuote(quote)
  const lines = []
  const mat = quoteMaterialsTotal(q)
  const lab = quoteLaborTotal(q)
  const hours = (q.scopes || []).reduce((a, sc) => a + scopeLaborHours(sc), 0)
  if (mat) lines.push(`Estimated Cost of Materials:  ${proposalMoney(mat)}`)
  if (lab) lines.push(`Estimated Cost of Labor (${hours.toFixed(2)} Total Man-Hours):  ${proposalMoney(lab)}`)
  const al = allowancesTotal(q)
  if (al) {
    const names = allowancesByCategory(q).filter(c => c.total).map(c => c.id === 'other' ? otherAllowanceLabel(q) : c.label)
    lines.push(`Allowances${names.length ? ` (${names.join(', ')})` : ''}:  ${proposalMoney(al)}`)
  }
  const adj = adjustmentsTotal(q)
  if (adj) lines.push(`Adjustments:  ${proposalMoney(adj)}`)
  return lines
}
// Every scope's own scope-of-work lines, in order, without repeats.
export function combinedScopeText(quote) {
  const seen = new Set()
  const out = []
  ;(normalizeQuote(quote).scopes || []).forEach(sc => splitLines(sc.scopeText).forEach(l => {
    const k = l.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (k && !seen.has(k)) { seen.add(k); out.push(l.replace(/^[•\-*]\s*/, '')) }
  }))
  return out.join('\n')
}
// Allowances a General quote lists as included in the price (no amounts).
export function includedAllowanceText(quote) {
  const q = normalizeQuote(quote)
  return (q.allowances || []).filter(a => allowanceAmount(q, a))
    .map(a => {
      const cat = ALLOWANCE_CATEGORIES.find(c => c.id === (a.category || 'other'))
      return (a.desc || '').trim() || (a.category === 'other' ? otherAllowanceLabel(q) : cat ? cat.costLabel : 'Allowance')
    }).join('\n')
}
export function defaultGeneral(quote) {
  return { scopeText: combinedScopeText(quote), allowText: includedAllowanceText(quote) }
}

export function splitLines(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
}
