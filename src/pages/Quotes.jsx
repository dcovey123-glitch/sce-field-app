import React, { useState, useEffect } from 'react'
import NoteGroups from '../components/NoteGroups.jsx'
import FlagBanner from '../components/FlagBanner.jsx'
import { quotePlannedMaterials } from '../api/plannedMaterials.js'
import { linkedJobsCustomer } from '../api/sharedCustomer.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import FileAttachments from '../components/FileAttachments.jsx'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import WholesalerExportBar from '../components/WholesalerExportBar.jsx'
import { hit } from '../api/search.js'
import ProposalPill from '../components/ProposalPill.jsx'
import EmailQuoteButton from '../components/EmailQuoteButton.jsx'
import { generateQuoteDocxBase64, quoteExportFileName } from '../api/exportQuote.js'
import { todayLocal } from '../api/albertaTime.js'
import {
  quoteGrandTotal, quoteMaterialsTotal, quoteLaborTotal, normalizeQuote, upgradePatch, isCurrentLayout,
  markupPct, MARKUP_KEYS, allowanceAmount, allowancesByCategory, allowancesTotal,
  scopeTotal, referencePricingAmount, otherAllowanceLabel,
  buildCompleteDraft, scopeCostLines, totalLineFor, finalLineFor, allowanceCostLines, adjustmentLinesFor,
  referenceLinesFor, DEFAULT_MARKUP, proposalMoney, defaultGeneral, includedAllowanceText, combinedScopeText,
} from '../api/quoteMath.js'
import { money } from '../api/format.js'
import { aiPost, AI_MODEL, useApiKey } from '../api/ai.js'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function pad(n, len) {
  return String(n).padStart(len, '0')
}

// Builds the next quote number for a customer: Q-{CODE}-{YEAR}-{NUM}
// NUM is monotonic per customer (never reused, even if a quote is deleted).
// Quotes sort by quote number (natural/numeric-aware), same idea as Jobs sorting by CO#
export function sortByQuoteNumber(list) {
  return [...list].sort((a, b) => {
    const aHas = !!(a.quoteNumber && a.quoteNumber.trim())
    const bHas = !!(b.quoteNumber && b.quoteNumber.trim())
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (!aHas && !bHas) return 0
    return a.quoteNumber.localeCompare(b.quoteNumber, undefined, { numeric: true, sensitivity: 'base' })
  })
}

// Quote numbers are Q-<code>-<year>-<nnn>. Several customers can share a
// code (every customer without one is GEN), so the next number looks at every
// quote already using that code and year — never just this customer's count —
// so a number is never handed out twice.
export function nextQuoteNumber(customer, allQuotes = []) {
  const year = new Date().getFullYear()
  const code = (customer.code || 'GEN').toUpperCase()
  const prefix = `Q-${code}-${year}-`
  let highest = 0
  for (const q of allQuotes) {
    const n = String(q.quoteNumber || '')
    if (n.toUpperCase().startsWith(prefix)) highest = Math.max(highest, parseInt(n.slice(prefix.length), 10) || 0)
  }
  const num = Math.max(customer.nextQuoteNum || 1, highest + 1)
  return { quoteNumber: `${prefix}${pad(num, 3)}`, num }
}

// ── Shared row bits (mirrors Jobs.jsx) ────────────────────────────
const QUOTE_COLS = '124px 1fr 1fr'

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 16px', background: 'var(--surface)',
  borderBottom: '1px solid var(--border)', cursor: 'pointer',
}
const nestedRowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '5px 16px', background: 'var(--surface)',
  borderBottom: '1px solid var(--border)', cursor: 'pointer',
}
const textStyle = { fontSize: 14, fontWeight: 600, color: 'var(--text)', cursor: 'text', minWidth: 0 }
const placeholderTextStyle = { ...textStyle, color: 'var(--text-light)', fontWeight: 500 }
const notesTextStyle = { ...textStyle, fontWeight: 500, color: 'var(--text-mid)' }
const notesPlaceholderStyle = { ...notesTextStyle, color: 'var(--text-light)' }
const inputStyle = {
  fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 6px',
  outline: 'none', fontFamily: 'var(--font)', width: '100%',
}
const plainInputStyle = {
  fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 0,
  border: 'none', background: 'none', padding: '3px 4px', outline: 'none',
  fontFamily: 'var(--font)', width: '100%',
}
const chevronWrapStyle = {
  color: 'var(--text-light)', display: 'flex', alignItems: 'center', flexShrink: 0,
  transition: 'transform 0.15s',
}
const delBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
  color: 'var(--text-light)', fontSize: 16, lineHeight: 1, flexShrink: 0, width: 22,
}
const colHeaderStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-light)',
  textTransform: 'uppercase',
}

// ══════════════════════════════════════════════════════════════════
// PRICE REFERENCE — upload a supplier's pricing/reference quote, check it
// against Catalog (never touches Stock). Reuses the exact same AI parsing
// as Materials' order-slip import.
// ══════════════════════════════════════════════════════════════════
// Same controlled unit list as Materials — keeps things like "Meter" vs "M" vs
// "KM" consistent, since a mislabeled unit can make a total look wildly wrong.
const PR_UOM_OPTIONS = ['EA', 'FT', 'M', 'KM', 'ROLL', 'BOX', 'PKG', 'CASE', 'LOT']

function PRUomSelect({ value, onChange }) {
  const options = value && !PR_UOM_OPTIONS.includes(value) ? [value, ...PR_UOM_OPTIONS] : PR_UOM_OPTIONS
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: 12.5, fontWeight: 600, color: value ? 'var(--text)' : 'var(--text-light)',
        border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 2px', outline: 'none',
        fontFamily: 'var(--font)', background: 'var(--surface)', width: '100%',
      }}
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function prExtractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in the response.')
  return JSON.parse(text.slice(start, end + 1))
}

async function prFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Writes the overview scope for a General quote from everything in the
// quote's scopes (names, scope text, materials and labor descriptions).
async function writeGeneralScope(quote, customerName, apiKey) {
  const scopes = (quote.scopes || []).map((sc, i) => {
    const mats = (sc.materials || []).filter(m => m.desc).map(m => `${Number(m.qty) || ''} ${m.uom || ''} ${m.desc}`.replace(/\s+/g, ' ').trim())
    const labor = (sc.labor || []).filter(l => l.desc).map(l => `${l.desc}${Number(l.qty) ? ` (${Number(l.qty)} h)` : ''}`)
    return [`SCOPE ${i + 1}: ${sc.name || ''}`, sc.scopeText ? `Scope of work as written:\n${sc.scopeText}` : '',
      mats.length ? `Materials:\n- ${mats.join('\n- ')}` : '', labor.length ? `Labor:\n- ${labor.join('\n- ')}` : ''].filter(Boolean).join('\n')
  }).join('\n\n')
  const prompt = `You are writing the "Scope of Work" section of an electrical contractor's quote (SCE Electric Western Canada).
Project: ${quote.title || ''}
Customer: ${customerName || ''}
${quote.basedOn ? `Based on: ${quote.basedOn}\n` : ''}
Here is everything in the estimate:

${scopes || '(no scopes)'}

Write a GENERAL overview scope of work covering all of it, for the customer to read.
- 4 to 12 lines, one item per line. No bullet characters, numbering, headings, or blank lines.
- Each line is a short plain sentence in electrical trade language, starting with a verb (Supply and install…, Remove and dispose of…, Terminate…, Test and verify…).
- Combine the scopes into one list; group like work together and drop repeats. Mention areas or rooms where the estimate names them.
- Summarize materials as work (e.g. "Supply and install new LED fixtures in classrooms 2602–2610"), not a parts list. No part numbers.
- Only include work that is in the estimate. Do not invent work, exclusions, or schedules.
- Leave out allowances (permits, engineering, fire alarm, sub-trades); they are listed separately.
- No prices, quantities of hours, or dollar amounts.
Reply with only the lines.`
  const res = await aiPost(apiKey, { model: AI_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try { const e = await res.json(); if (e?.error?.message) detail = e.error.message } catch { /* status only */ }
    throw new Error(detail)
  }
  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  return text.split('\n').map(l => l.replace(/^\s*(?:[•\-*]|\d+[.)])\s*/, '').trim()).filter(Boolean).join('\n')
}

async function parseReferencePdf(base64, apiKey) {
  const res = await aiPost(apiKey, {
      model: AI_MODEL,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text: 'This is a wholesaler packing slip, invoice, or price quote. Carefully identify the WHOLESALER/SUPPLIER company name — it is usually the largest or most prominent name on the page, often in a logo or letterhead at the top (this is the company that sent the document, not the customer it was sent to). Also extract the invoice or quote number (sometimes labeled "Invoice #", "Quote #", "Reference", etc.), the document date (YYYY-MM-DD), every line item with its part number (if shown), description, unit of measure exactly as printed (e.g. EA, FT, M, KM, ROLL, BOX, PKG, CASE, LOT — use whatever abbreviation is actually printed, do NOT guess or substitute a different unit, and NEVER convert or rescale the quantity to a different unit — e.g. if the document shows 500 M, output qty 500 and uom \'M\', do not convert to 0.5 KM or vice versa), quantity, unit price, and the line\'s total price exactly as printed (do not calculate it yourself — read the printed number), and finally the document\'s own printed grand total if shown. Respond with ONLY raw JSON, no markdown fences, no explanation before or after, in this exact shape: {"wholesaler":"","invoiceNumber":"","orderDate":"","invoiceTotal":0,"lineItems":[{"partNo":"","name":"","uom":"","qty":0,"cost":0,"totalPrice":0}]}',
          },
        ],
      }],
    })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try {
      const errBody = await res.json()
      if (errBody?.error?.message) detail = errBody.error.message
    } catch { /* ignore — use the status-based message */ }
    throw new Error(detail)
  }
  const data = await res.json()
  if (data.stop_reason === 'max_tokens') {
    throw new Error('This document has too many line items to parse in one go — the response got cut off partway through. Try splitting it into smaller uploads (e.g. by page), or let me know and the limit can be raised further.')
  }
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text)
  if (textBlocks.length === 0) throw new Error('The response had no text content to parse.')
  const cleaned = textBlocks.join('').replace(/```json|```/g, '').trim()
  try {
    return prExtractJson(cleaned)
  } catch (e) {
    throw new Error(`Could not read the parsed result as JSON (${e.message})`)
  }
}

const PR_REVIEW_COLS = 'minmax(96px, 0.35fr) minmax(140px, 1fr) 52px 48px 84px 86px'
const prReviewInputStyle = { ...inputStyle, fontSize: 12.5, padding: '3px 5px' }

function PRColumnHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 4px', marginBottom: 4, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: PR_REVIEW_COLS, gap: 6, flex: 1, minWidth: 0 }}>
        <span style={colHeaderStyle}>Part No:</span>
        <span style={colHeaderStyle}>Description:</span>
        <span style={colHeaderStyle}>UOM:</span>
        <span style={colHeaderStyle}>Qty</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Unit Price</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Total Price</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

function PRUploadFlow({ apiKey, onCommit, commitLabel }) {
  const [stage, setStage] = useState('idle') // idle | parsing | review | error
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pdfBase64, setPdfBase64] = useState(null)
  const [error, setError] = useState('')
  const inputRef = React.useRef(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!apiKey) {
      setError('Add your Anthropic API key first — in Materials → Settings — needed to parse the PDF.')
      setStage('error')
      return
    }
    setFileName(file.name)
    setStage('parsing')
    setError('')
    try {
      const base64 = await prFileToBase64(file)
      setPdfBase64(base64)
      const result = await parseReferencePdf(base64, apiKey)
      result.lineItems = (result.lineItems || []).map(li => ({ id: uid(), ...li }))
      setParsed(result)
      setStage('review')
    } catch (err) {
      setError(err.message || 'Could not parse this PDF.')
      setStage('error')
    }
  }

  function updateField(field, value) { setParsed(p => ({ ...p, [field]: value })) }
  function updateLine(id, patch) { setParsed(p => ({ ...p, lineItems: p.lineItems.map(l => l.id === id ? { ...l, ...patch } : l) })) }
  function deleteLine(id) { setParsed(p => ({ ...p, lineItems: p.lineItems.filter(l => l.id !== id) })) }

  function commit() {
    onCommit({ ...parsed, fileName, pdfBase64 })
    setStage('idle'); setParsed(null); setFileName(''); setPdfBase64(null)
    if (inputRef.current) inputRef.current.value = ''
  }
  function cancel() {
    setStage('idle'); setParsed(null); setFileName(''); setPdfBase64(null); setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  if (stage === 'review' && parsed) {
    return (
      <div style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 10 }}>
          Review parsed reference — {fileName}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          <span style={colHeaderStyle}>Wholesaler</span>
          <input value={parsed.wholesaler || ''} onChange={e => updateField('wholesaler', e.target.value)} placeholder="Wholesaler name" style={prReviewInputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={colHeaderStyle}>Invoice/Quote #</span>
            <input value={parsed.invoiceNumber || ''} onChange={e => updateField('invoiceNumber', e.target.value)} placeholder="—" style={prReviewInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={colHeaderStyle}>Date</span>
            <input type="date" value={parsed.orderDate || ''} onChange={e => updateField('orderDate', e.target.value)} style={prReviewInputStyle} />
          </div>
        </div>
        {parsed.lineItems.length > 0 && <PRColumnHeader />}
        {parsed.lineItems.map(li => (
          <div key={li.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: PR_REVIEW_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
                <input value={li.partNo || ''} onChange={e => updateLine(li.id, { partNo: e.target.value })} placeholder="—" style={prReviewInputStyle} />
                <input value={li.name || ''} onChange={e => updateLine(li.id, { name: e.target.value })} placeholder="Description" style={prReviewInputStyle} />
                <PRUomSelect value={li.uom} onChange={v => updateLine(li.id, { uom: v })} />
                <input type="number" value={li.qty ?? ''} onChange={e => updateLine(li.id, { qty: e.target.value })} placeholder="0" style={{ ...prReviewInputStyle, textAlign: 'center' }} />
                <input type="number" step="0.01" value={li.cost ?? ''} onChange={e => updateLine(li.id, { cost: e.target.value })} placeholder="0.00" style={{ ...prReviewInputStyle, textAlign: 'right' }} />
                <input type="number" step="0.01" value={li.totalPrice ?? ''} onChange={e => updateLine(li.id, { totalPrice: e.target.value })} placeholder="0.00" style={{ ...prReviewInputStyle, textAlign: 'right' }} />
              </div>
              <ConfirmDeleteButton onConfirm={() => deleteLine(li.id)} style={delBtnStyle} ariaLabel="Remove line" confirmText="Remove this line?" />
            </div>
            <input
              value={li.nickname || ''} onChange={e => updateLine(li.id, { nickname: e.target.value })}
              placeholder="Nickname (optional) — a quick name you'll recognize later"
              style={{ ...prReviewInputStyle, marginTop: 3, fontStyle: 'italic', width: '60%' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={cancel} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={commit} style={{ flex: 1, padding: 10, background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}>
            {commitLabel || `Check ${parsed.lineItems.length} item${parsed.lineItems.length === 1 ? '' : 's'} against Catalog`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14,
        border: '1.5px dashed var(--border)', borderRadius: 'var(--rs)', cursor: 'pointer',
        color: 'var(--text-mid)', fontSize: 13, fontWeight: 600, background: 'var(--surface)',
      }}>
        {stage === 'parsing' ? 'Parsing PDF…' : '+ Upload a reference quote or price sheet (PDF)'}
        <input ref={inputRef} type="file" accept="application/pdf" onChange={handleFile} disabled={stage === 'parsing'} style={{ display: 'none' }} />
      </label>
      {stage === 'error' && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

function PriceReferenceTab() {
  const [, setCatalog] = useLocalStore('material_catalog', [])
  const [apiKey] = useApiKey()
  const [references, setReferences] = useLocalStore('quote_price_references', [])
  const [discrepancies, setDiscrepancies] = useState([])
  const [justAdded, setJustAdded] = useState([])

  function findCatalogMatchIn(list, li) {
    if (li.partNo) {
      const m = list.find(c => c.partNo && c.partNo.toLowerCase() === li.partNo.toLowerCase())
      if (m) return m
    }
    if (li.nickname) {
      const m = list.find(c => c.nickname && c.nickname.toLowerCase() === li.nickname.toLowerCase())
      if (m) return m
    }
    return list.find(c => c.name && li.name && c.name.toLowerCase() === li.name.toLowerCase())
  }

  async function handleCommit(parsed) {
    let slipPath = null
    if (window.desktop && parsed.pdfBase64) {
      try {
        const safe = s => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
        const fileName = `${parsed.orderDate || todayLocal()} - ${safe(parsed.wholesaler) || 'Unknown wholesaler'}.pdf`
        slipPath = await window.desktop.saveFile('Quotes/Price Reference Uploads', fileName, parsed.pdfBase64)
      } catch { /* not worth blocking the comparison over a filing failure */ }
    }

    const ref = {
      id: uid(), wholesaler: parsed.wholesaler, invoiceNumber: parsed.invoiceNumber, orderDate: parsed.orderDate,
      lineItems: parsed.lineItems, fileName: parsed.fileName, slipPath, createdAt: new Date().toISOString(),
    }
    setReferences(list => [...list, ref])

    const flags = []
    const added = []
    const source = parsed.wholesaler || 'Reference'
    const priceDate = parsed.orderDate || todayLocal()

    setCatalog(list => {
      let next = list
      parsed.lineItems.forEach(li => {
        const match = findCatalogMatchIn(next, li)
        const historyEntry = { date: priceDate, cost: Number(li.cost) || 0, source }
        if (match) {
          const priceHistory = [...(match.priceHistory || []), historyEntry].slice(-20)
          next = next.map(c => c.id === match.id ? { ...c, priceHistory } : c)
          if (match.refCost != null && Number(match.refCost) !== Number(li.cost)) {
            flags.push({ id: uid(), item: li.name, catalogCost: match.refCost, newCost: li.cost, catalogId: match.id })
          }
        } else {
          const newItem = {
            id: uid(), partNo: li.partNo, nickname: li.nickname || '', name: li.name, uom: li.uom,
            refCost: Number(li.cost) || 0, priceHistory: [historyEntry],
          }
          next = [...next, newItem]
          added.push({ id: newItem.id, name: li.name })
        }
      })
      return next
    })

    if (flags.length) setDiscrepancies(d => [...d, ...flags])
    if (added.length) setJustAdded(a => [...a, ...added])
  }

  function resolveDiscrepancy(id, updateCatalog) {
    const d = discrepancies.find(x => x.id === id)
    if (d && updateCatalog) {
      setCatalog(list => list.map(c => c.id === d.catalogId ? { ...c, refCost: d.newCost } : c))
    }
    setDiscrepancies(list => list.filter(x => x.id !== id))
  }

  return (
    <div>
      <div style={{ padding: '10px 16px 0', fontSize: 11, color: 'var(--text-light)' }}>
        Upload a supplier's quote or price sheet to check it against your Catalog pricing — this never touches Stock, it's purely a reference check.
      </div>
      <PRUploadFlow apiKey={apiKey} onCommit={handleCommit} />

      {discrepancies.length > 0 && (
        <div style={{ background: '#fff8e6', borderBottom: '1px solid var(--accent)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', marginBottom: 6 }}>
            Price discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} vs Catalog
          </div>
          {discrepancies.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{d.item}: catalog {money(d.catalogCost)} → reference {money(d.newCost)}</span>
              <button onClick={() => resolveDiscrepancy(d.id, true)} style={{ fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer' }}>Update catalog</button>
              <button onClick={() => resolveDiscrepancy(d.id, false)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer' }}>Ignore</button>
            </div>
          ))}
        </div>
      )}

      {justAdded.length > 0 && (
        <div style={{ background: '#e8f2fc', borderBottom: '1px solid var(--border)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Added to Catalog automatically</span>
            <button onClick={() => setJustAdded([])} style={{ fontSize: 11, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
          </div>
          {justAdded.map(item => (
            <div key={item.id} style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 2 }}>{item.name}</div>
          ))}
        </div>
      )}

      {references.length === 0 ? (
        <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>No reference quotes uploaded yet.</div>
      ) : (
        references.slice().reverse().map(r => (
          <div key={r.id} style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{r.wholesaler || 'Unknown wholesaler'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                {r.orderDate || '—'} · {(r.lineItems || []).length} item{(r.lineItems || []).length === 1 ? '' : 's'}
                {r.slipPath && (
                  <button onClick={() => window.desktop.openFile(r.slipPath)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 4 }}>
                    · View
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}




function ChevronDown({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
      <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
      <path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Click text to edit in place
// A plain <input> that types locally and only commits on blur. Every field
// here writes through to real files on disk (async, one round trip per commit) —
// binding value straight to the stored value and committing on every keystroke
// means that round trip can land mid-typing and throw the cursor to the end.
// Buffering locally like this sidesteps that entirely.
function BufferedInput({ value, onCommit, ...inputProps }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  return (
    <input
      title={draft !== '' && draft != null && String(draft).length > 6 ? String(draft) : undefined}
      {...inputProps}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft !== (value ?? '')) onCommit(draft)
      }}
    />
  )
}

function BufferedTextarea({ value, onCommit, ...areaProps }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value ?? '')
  }, [value, focused])

  return (
    <textarea
      {...areaProps}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft !== (value ?? '')) onCommit(draft)
      }}
    />
  )
}

export function EditableField({ value, placeholder, onSave, textStyleOverride, placeholderStyleOverride }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v !== value) onSave(v)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={inputStyle}
      />
    )
  }
  return (
    <span
      style={value ? (textStyleOverride || textStyle) : (placeholderStyleOverride || placeholderTextStyle)}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      title={value || undefined}
    >
      {value || placeholder}
    </span>
  )
}

// Click the name to toggle open its children, click the pencil to rename
function NameCell({ value, placeholder, onSave, onToggle }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v !== value) onSave(v)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={inputStyle}
      />
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span
        onClick={e => { e.stopPropagation(); onToggle() }}
        style={{ ...(value ? textStyle : placeholderTextStyle), flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {value || placeholder}
      </span>
      <button
        onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 2, flexShrink: 0, display: 'flex' }}
        aria-label="Rename"
      >
        <PencilIcon />
      </button>
    </div>
  )
}

function CollapsedAddRow({ label, indent, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ ...rowStyle, background: 'var(--surface-2)', paddingLeft: indent ? 16 + indent : 16 }}
    >
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0, width: indent ? 16 : 'auto', textAlign: 'center' }}>+</span>
      <span style={{ fontSize: 13, color: 'var(--text-light)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// ── Add-customer row: Name + quote Code (the "sub title" numbering is built from) ──
function AddCustomerRow({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  function reset() { setName(''); setCode('') }
  function submit() {
    const n = name.trim()
    if (n) onAdd({ name: n, code: code.trim().toUpperCase() })
    reset()
    setOpen(false)
  }
  function handleBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) submit()
  }
  const onKey = e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { reset(); setOpen(false) }
  }

  if (!open) {
    return <CollapsedAddRow label="Add customer" onClick={() => setOpen(true)} />
  }

  return (
    <div onBlur={handleBlur} style={{ ...rowStyle, background: 'var(--surface-2)', cursor: 'default' }}>
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>+</span>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Customer name"
        onKeyDown={onKey} style={{ ...plainInputStyle, flex: 1 }} />
      <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODE"
        onKeyDown={onKey} style={{ ...plainInputStyle, width: 64, textTransform: 'uppercase' }} maxLength={6} />
    </div>
  )
}

// ── Column header labels above a customer's quote list ───────────
const QUOTE_ROW_COLS = '30px 124px 1fr 1fr 22px 22px 22px 84px'

function QuoteColumnHeader({ indent }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: QUOTE_ROW_COLS, columnGap: 8, alignItems: 'center',
      padding: '4px 16px 2px', paddingLeft: 16 + indent, background: 'var(--surface-2)',
    }}>
      <span />
      <span style={colHeaderStyle}>Quote #</span>
      <span style={colHeaderStyle}>Title</span>
      <span style={colHeaderStyle}>Notes</span>
      <span />
      <span />
      <span />
      <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Total</span>
    </div>
  )
}

// ── Add-quote row: Title + Notes only — Quote # is auto-generated on submit ──
export function QuoteAddRow({ onAdd, indent }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')

  function reset() { setTitle(''); setNotes('') }
  function submit() {
    const t = title.trim()
    if (t) onAdd({ title: t, notes: notes.trim() })
    reset()
    setOpen(false)
  }
  function handleBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) submit()
  }
  const onKey = e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') { reset(); setOpen(false) }
  }

  if (!open) {
    return <CollapsedAddRow label="Add quote" indent={indent} onClick={() => setOpen(true)} />
  }

  return (
    <div onBlur={handleBlur} style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 16 + indent, background: 'var(--surface-2)' }}>
      <span style={{ color: 'var(--accent-dim)', fontSize: 16, fontWeight: 700, flexShrink: 0, width: 16, textAlign: 'center' }}>+</span>
      <div style={{ display: 'grid', gridTemplateColumns: QUOTE_COLS, gap: 8, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>Auto-assigned</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Quote title" onKeyDown={onKey} style={plainInputStyle} />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" onKeyDown={onKey} style={{ ...plainInputStyle, color: 'var(--text-mid)' }} />
      </div>
    </div>
  )
}

// ── Quote row (nested under an expanded customer) ────────────────
export function ApprovalDot({ quote, onClick }) {
  const color = quote.approved ? 'var(--green)' : quote.status === 'yellow' ? '#e0a716' : 'var(--red)'
  const label = quote.approved ? 'Approved' : quote.status === 'yellow' ? 'Sent — not approved yet' : 'Not sent'
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      title={`${label} — click to update`}
      aria-label={label}
      style={{
        width: 10, height: 10, borderRadius: '50%', border: 'none', padding: 0, flexShrink: 0, cursor: 'pointer',
        background: color,
      }}
    />
  )
}

export function InvalidateQuoteModal({ quote, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  return (
    <ModalOverlay onClose={onClose} maxWidth={400}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Invalidate Quote</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
          {quote.quoteNumber} — {quote.title || 'Untitled quote'}. It'll move to a separate Invalidated section.
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 3 }}>Reason</div>
        <textarea
          autoFocus value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Why is this quote no longer valid?"
          style={{ width: '100%', minHeight: 70, fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'var(--font)', boxSizing: 'border-box', resize: 'vertical', marginBottom: 14 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(reason.trim()); onClose() }}
            disabled={!reason.trim()}
            style={{ flex: 1, padding: 10, background: reason.trim() ? 'var(--red)' : 'var(--gray-light)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: reason.trim() ? 'pointer' : 'default', color: reason.trim() ? '#fff' : 'var(--text-light)' }}
          >
            Invalidate
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function QuoteRow({ quote, onUpdate, onDelete, onOpen, onRequestApprove, onRequestBack, indent }) {
  const [invalidating, setInvalidating] = useState(false)
  const total = quoteGrandTotal(quote)
  return (
    <div
      onClick={onOpen}
      style={{
        ...nestedRowStyle, paddingLeft: 16 + indent, background: 'var(--surface-2)',
        display: 'grid', alignItems: 'center', columnGap: 8,
        gridTemplateColumns: QUOTE_ROW_COLS,
      }}
    >
      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <ApprovalDot quote={quote} onClick={() => onRequestApprove(quote)} />
        {!quote.approved && quote.status === 'yellow' && (
          <button
            onClick={() => onRequestBack(quote)}
            title="Back to not sent"
            aria-label="Back to not sent"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', padding: 0, display: 'flex' }}
          >
            <svg width="10" height="10" viewBox="0 0 18 18" fill="none">
              <path d="M11.5 4L6.5 9L11.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <EditableField
          value={quote.quoteNumber}
          placeholder="Quote #"
          onSave={v => onUpdate({ quoteNumber: v })}
          textStyleOverride={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', fontFamily: 'monospace', letterSpacing: '-.02em', cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        />
        {quote.revision > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-dim)', background: 'var(--accent-bg)', borderRadius: 20, padding: '1px 5px', flexShrink: 0 }}>
            Rev {quote.revision}
          </span>
        )}
      </div>
      <NameCell value={quote.title} placeholder="Quote title" onSave={v => onUpdate({ title: v })} onToggle={onOpen} />
      {quote.invalidated ? (
        <EditableField
          value={quote.invalidReason}
          placeholder="Reason for invalidating"
          onSave={v => onUpdate({ invalidReason: v })}
          textStyleOverride={{ ...notesTextStyle, color: 'var(--red)' }}
          placeholderStyleOverride={notesPlaceholderStyle}
        />
      ) : (
        <EditableField
          value={quote.notes}
          placeholder="Add note"
          onSave={v => onUpdate({ notes: v })}
          textStyleOverride={notesTextStyle}
          placeholderStyleOverride={notesPlaceholderStyle}
        />
      )}
      <ConfirmDeleteButton
        onConfirm={onDelete} style={{ ...delBtnStyle, justifySelf: 'center' }} ariaLabel="Delete quote"
        confirmText={`Delete quote ${quote.quoteNumber || ''}? This can't be undone.`}
      />
      {!quote.invalidated && (
        <button
          onClick={e => { e.stopPropagation(); setInvalidating(true) }}
          title="Invalidate quote" aria-label="Invalidate quote"
          style={{ justifySelf: 'center', background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 13, cursor: 'pointer', padding: '0 2px' }}
        >
          ⊘
        </button>
      )}
      <span style={{ ...chevronWrapStyle, justifySelf: 'center' }}><ChevronDown open={false} /></span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {total > 0 ? money(total) : ''}
      </span>
      {invalidating && (
        <div onClick={e => e.stopPropagation()}>
          <InvalidateQuoteModal
            quote={quote} onClose={() => setInvalidating(false)}
            onConfirm={reason => onUpdate({ invalidated: true, invalidReason: reason })}
          />
        </div>
      )}
    </div>
  )
}

// ── Customer row + its dropped-down quote list ────────────────────
function CombineQuotesModal({ customer, quotes, onClose, onCombine }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [title, setTitle] = useState('')

  function toggle(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const selectedQuotes = quotes.filter(q => selectedIds.has(q.id))
  const combinedTotal = selectedQuotes.reduce((s, q) => s + quoteGrandTotal(q), 0)
  const canCombine = selectedIds.size >= 2 && title.trim()

  return (
    <ModalOverlay onClose={onClose} maxWidth={440}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Combine Quotes</div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 14 }}>
          Pick at least two quotes — each becomes its own scope in a new combined quote, keeping its own materials and labor lines intact.
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 3 }}>New quote title</div>
        <input
          value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Full Project — Combined"
          style={{ width: '100%', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontFamily: 'var(--font)', boxSizing: 'border-box', marginBottom: 14 }}
        />

        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 6 }}>Quotes to combine</div>
        <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 14 }}>
          {quotes.map(q => (
            <label key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggle(q.id)} style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-light)' }}>{q.quoteNumber}</span> — <span style={{ fontWeight: 600 }}>{q.title || 'Untitled'}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', flexShrink: 0 }}>{money(quoteGrandTotal(q))}</span>
            </label>
          ))}
        </div>

        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--rs)', marginBottom: 14 }}>
            <span style={{ color: 'var(--text-mid)' }}>{selectedIds.size} selected</span>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>Combined total: {money(combinedTotal)}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => onCombine(selectedQuotes, title.trim())}
            disabled={!canCombine}
            style={{ flex: 1, padding: 10, background: canCombine ? 'var(--accent)' : 'var(--gray-light)', border: 'none', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: canCombine ? 'pointer' : 'default', color: canCombine ? 'var(--navy)' : 'var(--text-light)' }}
          >
            Combine into new quote
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function CustomerBlock({ customer, quotes, expanded, onToggle, onRename, onEdit,
                          onAddQuote, onUpdateQuote, onDeleteQuote, onOpenQuote, onRequestApprove, onRequestBack, onCombineQuotes }) {
  const totalValue = quotes.reduce((s, q) => s + quoteGrandTotal(q), 0)
  const [combining, setCombining] = useState(false)

  return (
    <div>
      <div style={rowStyle} onClick={onToggle}>
        <span style={chevronWrapStyle}><ChevronDown open={expanded} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <NameCell value={customer.name} placeholder="Customer name" onSave={onRename} onToggle={onToggle} />
        </span>
        {totalValue > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap', flexShrink: 0, marginRight: 4 }}>
            {money(totalValue)}
          </span>
        )}
        {customer.code && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: 'var(--accent-bg)', color: 'var(--accent-dim)', flexShrink: 0, letterSpacing: '.02em',
          }}>
            {customer.code}
          </span>
        )}
        {expanded && quotes.length >= 2 && (
          <button
            onClick={e => { e.stopPropagation(); setCombining(true) }}
            style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', background: '#e8f2fc', border: 'none', borderRadius: 20, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}
          >
            Combine Quotes
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 11, fontWeight: 700, padding: '4px 8px', flexShrink: 0 }}
        >
          Edit
        </button>
      </div>
      {combining && (
        <CombineQuotesModal
          customer={customer} quotes={quotes} onClose={() => setCombining(false)}
          onCombine={(selected, title) => { onCombineQuotes(selected, title); setCombining(false) }}
        />
      )}
      {expanded && (
        <div>
          {quotes.length > 0 && <QuoteColumnHeader indent={18} />}
          {quotes.length === 0 && (
            <div style={{ padding: '8px 16px 8px 34px', color: 'var(--text-light)', fontSize: 13, background: 'var(--surface-2)' }}>
              No quotes yet — add one below.
            </div>
          )}
          {quotes.map(q => (
            <QuoteRow
              key={q.id}
              quote={q}
              indent={18}
              onUpdate={patch => onUpdateQuote(q.id, patch)}
              onDelete={() => onDeleteQuote(q.id)}
              onOpen={() => onOpenQuote(q.id)}
              onRequestApprove={onRequestApprove}
              onRequestBack={onRequestBack}
            />
          ))}
          <QuoteAddRow indent={18} onAdd={data => onAddQuote(data)} />
        </div>
      )}
    </div>
  )
}

// ── Customer detail page (Edit) — placeholder body, with verified delete ──
const fieldRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
}
const fieldLabelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', flexShrink: 0 }

function FieldRowQ({ label, children }) {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </div>
  )
}

function CustomerDetailPage({ customer, quoteCount, allQuotes, onUpdate, onDelete, onGoBack }) {
  const [confirming, setConfirming] = useState(false)
  const preview = nextQuoteNumber(customer, allQuotes).quoteNumber

  return (
    <div>
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase' }}>
          Customer{customer.code ? ` · Code ${customer.code}` : ''}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
          {customer.name || 'Untitled customer'}
        </div>
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
          Quote numbering
        </div>
      </div>
      <FieldRowQ label="Quote code">
        <EditableField value={customer.code} placeholder="CODE" onSave={v => onUpdate({ code: v.toUpperCase() })} />
      </FieldRowQ>
      <FieldRowQ label="Next quote #">
        <input
          type="number" min="1"
          value={customer.nextQuoteNum || 1}
          onChange={e => onUpdate({ nextQuoteNum: Math.max(1, Number(e.target.value) || 1) })}
          style={{
            fontSize: 14, fontWeight: 600, color: 'var(--text)', width: 70, textAlign: 'right',
            border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)',
          }}
        />
      </FieldRowQ>
      <div style={{ padding: '6px 16px 18px', fontSize: 11, color: 'var(--text-light)' }}>
        Set this to match where your existing numbering already is — the next quote you add here will be {preview}.
        Individual quote numbers can also be edited directly on each quote if you ever need to correct one.
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase', marginBottom: 4 }}>
          Details
        </div>
      </div>
      <div style={{ padding: '12px 20px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
        More details for this customer will go here — tell me what to add.
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            style={{
              width: '100%', padding: '12px', background: 'none', border: '1px solid var(--red)',
              borderRadius: 'var(--rs)', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            Delete customer
          </button>
        ) : (
          <div style={{ border: '1px solid var(--red)', borderRadius: 'var(--rs)', padding: 14, background: 'var(--red-bg)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red-dark)', marginBottom: 4 }}>
              Delete {customer.name || 'this customer'}?
            </div>
            <div style={{ fontSize: 12, color: 'var(--red-dark)', marginBottom: 12 }}>
              {quoteCount > 0
                ? `This will also delete ${quoteCount} quote${quoteCount === 1 ? '' : 's'} under this customer. This can't be undone.`
                : "This can't be undone."}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{ flex: 1, padding: '10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete(); onGoBack() }}
                style={{ flex: 1, padding: '10px', background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Quote detail page (final destination — built out later) ──────
// ── Quote content: scopes, line items, adjustments (mirrors the old app's math exactly) ──
const dateInputStyle = {
  fontSize: 13, fontWeight: 600, color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)', background: 'var(--surface)',
}
const workTextareaStyle = {
  width: '100%', fontSize: 13, fontFamily: 'var(--font)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, padding: 8, outline: 'none',
  resize: 'vertical', minHeight: 76,
}
const subGroupLabelStyle = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)',
  textTransform: 'uppercase', padding: '8px 16px 2px 34px',
}


// All quote math lives in api/quoteMath.js (shared with Jobs, Mobile and the
// Word export). It reads older quotes the new way without changing totals.
export { quoteGrandTotal }

function ExpandableText({ text, expanded, onToggle, placeholder }) {
  return (
    <span onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', minWidth: 0 }}>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: text ? 'var(--text-mid)' : 'var(--text-light)' }}>
        {text ? text.split('\n')[0] : placeholder}
      </span>
      <span style={chevronWrapStyle}><ChevronDown open={expanded} /></span>
    </span>
  )
}

const LINE_COLS = 'minmax(140px, 1fr) 60px 96px 100px'
const LINE_COLS_WITH_PART = '70px 1fr 46px 34px 82px 78px'
const materialFieldStyle = { fontSize: 12.5 }

function LineColumnHeader({ showPartNo, allSelected, onToggleAll }) {
  const cols = showPartNo ? LINE_COLS_WITH_PART : LINE_COLS
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 16px 2px 34px' }}>
      {showPartNo && <input type="checkbox" checked={allSelected} onChange={e => onToggleAll(e.target.checked)} style={{ width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />}
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, flex: 1, minWidth: 0 }}>
        {showPartNo && <span style={colHeaderStyle}>Part No:</span>}
        <span style={colHeaderStyle}>Description</span>
        {showPartNo && <span style={colHeaderStyle}>UOM</span>}
        <span style={colHeaderStyle}>Qty</span>
        <span style={colHeaderStyle}>Rate</span>
        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Subtotal</span>
      </div>
      <span style={{ width: 22, flexShrink: 0 }} />
    </div>
  )
}

function LineItemRow({ item, onUpdate, onDelete, showPartNo, selected, onToggleSelected }) {
  const subtotal = (Number(item.qty) || 0) * (Number(item.rate) || 0)
  const cols = showPartNo ? LINE_COLS_WITH_PART : LINE_COLS
  const fieldStyle = showPartNo ? materialFieldStyle : {}
  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 34 }}>
      {showPartNo && <input type="checkbox" checked={!!selected} onChange={onToggleSelected} style={{ width: 14, height: 14, flexShrink: 0, cursor: 'pointer', marginRight: 8 }} />}
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        {showPartNo && (
          <BufferedInput value={item.partNo} onCommit={v => onUpdate({ partNo: v })} placeholder="—" style={{ ...plainInputStyle, ...fieldStyle }} />
        )}
        <BufferedInput value={item.desc} onCommit={v => onUpdate({ desc: v })} placeholder="Description" style={{ ...plainInputStyle, ...fieldStyle }} />
        {showPartNo && <PRUomSelect value={item.uom} onChange={v => onUpdate({ uom: v })} />}
        <BufferedInput
          type="number" inputMode="decimal" value={item.qty} onCommit={v => onUpdate({ qty: v })}
          placeholder="0" style={{ ...plainInputStyle, ...fieldStyle, textAlign: 'center' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <BufferedInput
            type="number" step="0.01" inputMode="decimal" value={item.rate} onCommit={v => onUpdate({ rate: v })}
            placeholder="0.00" style={{ ...plainInputStyle, ...fieldStyle, textAlign: 'right' }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'visible' }}>{money(subtotal)}</span>
      </div>
      <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete line" confirmText="Delete this line?" />
    </div>
  )
}

// Same Catalog/Stock search Jobs already uses when picking materials —
// Quotes' Materials line items search the same shared pricing reference.
function useMaterialSearchListQ() {
  const [catalog] = useLocalStore('material_catalog', [])
  const [stock] = useLocalStore('material_stock', [])
  const fromCatalog = catalog.map(c => ({ name: c.name, partNo: c.partNo, nickname: c.nickname, uom: c.uom, price: c.refCost }))
  const fromStock = stock.map(s => ({ name: s.name, partNo: s.partNo, nickname: s.nickname, uom: s.uom, price: s.cost }))
  return [...fromCatalog, ...fromStock]
}

function SearchIconQ() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, color: 'var(--text-light)' }}>
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function LineAddRow({ onAdd, showPartNo }) {
  const [partNo, setPartNo] = useState('')
  const [desc, setDesc] = useState('')
  const [uom, setUom] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const cols = showPartNo ? LINE_COLS_WITH_PART : LINE_COLS
  const fieldStyle = showPartNo ? materialFieldStyle : {}

  const searchList = useMaterialSearchListQ()
  const q = desc.trim().toLowerCase()
  const matches = (showPartNo && q) ? searchList.filter(s =>
    hit([s.name, s.nickname, s.partNo, s.alts], q)
  ).slice(0, 6) : []

  function pick(m) {
    setDesc(m.name)
    setPartNo(m.partNo || '')
    if (m.uom) setUom(m.uom)
    if (m.price != null) setRate(String(m.price))
    setShowDropdown(false)
  }

  function submit() {
    if (!desc.trim()) return
    onAdd({ partNo: partNo.trim(), desc: desc.trim(), uom, qty: qty ? Number(qty) : 0, rate: rate ? Number(rate) : 0 })
    setPartNo(''); setDesc(''); setUom(''); setQty(''); setRate(''); setShowDropdown(false)
  }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setShowDropdown(false) }

  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 34, background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        {showPartNo && (
          <input value={partNo} onChange={e => setPartNo(e.target.value)} placeholder="—" onKeyDown={onKey} style={{ ...plainInputStyle, ...fieldStyle }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, position: 'relative' }}>
          {showPartNo && <SearchIconQ />}
          <input
            value={desc}
            onChange={e => { setDesc(e.target.value); if (showPartNo) setShowDropdown(true) }}
            onFocus={() => showPartNo && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
            placeholder={showPartNo ? 'Type an item…' : 'Add line…'}
            onKeyDown={onKey}
            style={{ ...plainInputStyle, ...fieldStyle }}
          />
          {showDropdown && matches.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)',
              zIndex: 20, maxHeight: 160, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
              {matches.map((m, i) => (
                <div
                  key={m.partNo || `${m.name}-${i}`}
                  onMouseDown={() => pick(m)}
                  style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                >
                  {m.nickname ? (
                    <>
                      <span style={{ fontWeight: 700 }}>{m.nickname}</span>
                      <span style={{ color: 'var(--text-light)' }}> — {m.name}</span>
                    </>
                  ) : m.name}
                  {m.price != null && <span style={{ color: 'var(--text-light)', float: 'right' }}>{money(m.price)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        {showPartNo && <PRUomSelect value={uom} onChange={setUom} />}
        <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)}
          placeholder="0" onKeyDown={onKey} style={{ ...plainInputStyle, ...fieldStyle, textAlign: 'center' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <input type="number" step="0.01" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="0.00" onKeyDown={onKey} style={{ ...plainInputStyle, ...fieldStyle, textAlign: 'right' }} />
        </div>
        <span />
      </div>
      <button onClick={submit} style={{ ...delBtnStyle, color: 'var(--accent-dim)', fontSize: 17, fontWeight: 700 }} aria-label="Add line">+</button>
    </div>
  )
}

function LineGroup({ label, items, onAdd, onUpdate, onDelete, markup, showPartNo, quote }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const rawTotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0)
  const subtotal = markup != null ? rawTotal * (1 + markup / 100) : rawTotal
  const markupNote = markup != null ? `+${markup}%` : ''

  function toggleSelected(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(items.map(i => i.id)) : new Set())
  }
  const exportItems = items.filter(i => selectedIds.has(i.id)).map(i => ({ partNo: i.partNo, desc: i.desc, uom: i.uom, qty: i.qty }))

  return (
    <div>
      <div style={{ ...subGroupLabelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>{label}{markupNote ? ` — ${markupNote}` : ''}</span>
        {items.length > 0 && <span style={{ fontWeight: 700, color: 'var(--text)' }}>{money(subtotal)}</span>}
      </div>
      {items.length > 0 && <LineColumnHeader showPartNo={showPartNo} allSelected={items.length > 0 && selectedIds.size === items.length} onToggleAll={toggleAll} />}
      {items.map(i => (
        <LineItemRow
          key={i.id} item={i} onUpdate={patch => onUpdate(i.id, patch)} onDelete={() => onDelete(i.id)} showPartNo={showPartNo}
          selected={selectedIds.has(i.id)} onToggleSelected={() => toggleSelected(i.id)}
        />
      ))}
      <LineAddRow onAdd={onAdd} showPartNo={showPartNo} />
      {showPartNo && items.length > 0 && (
        <div style={{ padding: '8px 16px 4px 34px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 6 }}>
            {selectedIds.size} of {items.length} checked — check the ones you want quoted, then send them off and add pricing back once it comes in.
          </div>
          <WholesalerExportBar
            items={exportItems} date={todayLocal()}
            subjectPrefix={`Request for Quote${quote && quote.quoteNumber ? ' — ' + quote.quoteNumber : ''}${quote && quote.title ? ' — ' + quote.title : ''}`}
            saveFolder="Quotes/Materials Pricing Requests"
            quote={quote ? { id: quote.id, number: quote.quoteNumber || '', title: quote.title || '' } : null}
            emptyMessage="Check at least one material first."
          />
        </div>
      )}
    </div>
  )
}

// Upload a supplier's quote/price sheet directly into a scope's Materials —
// parses it, lets you review, fills in the actual material lines (with real
// pricing), and checks everything against Catalog along the way. Never touches
// Stock — this is just filling in what the quote should charge for materials.
function MaterialsPricingUpload({ onAddLines }) {
  const [, setCatalog] = useLocalStore('material_catalog', [])
  const [apiKey] = useApiKey()
  const [open, setOpen] = useState(false)
  const [discrepancies, setDiscrepancies] = useState([])
  const [justAdded, setJustAdded] = useState([])

  function findMatch(list, li) {
    if (li.partNo) {
      const m = list.find(c => c.partNo && c.partNo.toLowerCase() === li.partNo.toLowerCase())
      if (m) return m
    }
    if (li.nickname) {
      const m = list.find(c => c.nickname && c.nickname.toLowerCase() === li.nickname.toLowerCase())
      if (m) return m
    }
    return list.find(c => c.name && li.name && c.name.toLowerCase() === li.name.toLowerCase())
  }

  async function handleCommit(parsed) {
    if (window.desktop && parsed.pdfBase64) {
      try {
        const safe = s => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
        const fileName = `${parsed.orderDate || todayLocal()} - ${safe(parsed.wholesaler) || 'Unknown wholesaler'}.pdf`
        await window.desktop.saveFile('Quotes/Materials Pricing Uploads', fileName, parsed.pdfBase64)
      } catch { /* not worth blocking the import over a filing failure */ }
    }

    onAddLines(parsed.lineItems.map(li => ({ partNo: li.partNo, desc: li.name, uom: li.uom, qty: li.qty, rate: li.cost })))

    const flags = []
    const added = []
    const source = parsed.wholesaler || 'Quote'
    const priceDate = parsed.orderDate || todayLocal()
    setCatalog(list => {
      let next = list
      parsed.lineItems.forEach(li => {
        const match = findMatch(next, li)
        const historyEntry = { date: priceDate, cost: Number(li.cost) || 0, source }
        if (match) {
          const priceHistory = [...(match.priceHistory || []), historyEntry].slice(-20)
          next = next.map(c => c.id === match.id ? { ...c, priceHistory } : c)
          if (match.refCost != null && Number(match.refCost) !== Number(li.cost)) {
            flags.push({ id: uid(), item: li.name, catalogCost: match.refCost, newCost: li.cost, catalogId: match.id })
          }
        } else {
          const newItem = {
            id: uid(), partNo: li.partNo, nickname: li.nickname || '', name: li.name, uom: li.uom,
            refCost: Number(li.cost) || 0, category: '', priceHistory: [historyEntry],
          }
          next = [...next, newItem]
          added.push({ id: newItem.id, name: li.name })
        }
      })
      return next
    })
    if (flags.length) setDiscrepancies(d => [...d, ...flags])
    if (added.length) setJustAdded(a => [...a, ...added])
    setOpen(false)
  }

  function resolveDiscrepancy(id, updateCatalog) {
    const d = discrepancies.find(x => x.id === id)
    if (d && updateCatalog) {
      setCatalog(list => list.map(c => c.id === d.catalogId ? { ...c, refCost: d.newCost } : c))
    }
    setDiscrepancies(list => list.filter(x => x.id !== id))
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 34px 8px' }}
        >
          + Upload a pricing doc to fill in materials
        </button>
      ) : (
        <PRUploadFlow apiKey={apiKey} onCommit={handleCommit} commitLabel={`Add these to Materials`} />
      )}

      {discrepancies.length > 0 && (
        <div style={{ background: '#fff8e6', border: '1px solid var(--accent)', borderRadius: 'var(--rs)', margin: '0 16px 10px 34px', padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', marginBottom: 6 }}>
            Price discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} vs Catalog
          </div>
          {discrepancies.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{d.item}: catalog {money(d.catalogCost)} → this quote {money(d.newCost)}</span>
              <button onClick={() => resolveDiscrepancy(d.id, true)} style={{ fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, cursor: 'pointer' }}>Update catalog</button>
              <button onClick={() => resolveDiscrepancy(d.id, false)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer' }}>Ignore</button>
            </div>
          ))}
        </div>
      )}
      {justAdded.length > 0 && (
        <div style={{ background: '#e8f2fc', borderRadius: 'var(--rs)', margin: '0 16px 10px 34px', padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1a5fa0', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>Added to Catalog automatically</span>
            <button onClick={() => setJustAdded([])} style={{ fontSize: 11, color: '#1a5fa0', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
          </div>
          {justAdded.map(item => (
            <div key={item.id} style={{ fontSize: 12, color: 'var(--text-mid)' }}>{item.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function ScopeBlock({ quote, scope, expanded, onToggle, onRename, onDelete, onUpdateText,
                       onAddLine, onAddLines, onUpdateLine, onDeleteLine }) {
  const total = scopeTotal(quote, scope)
  const matPct = markupPct(quote, 'materials')
  return (
    <div>
      <div style={{ ...nestedRowStyle, paddingLeft: 16 }} onClick={onToggle}>
        <span style={chevronWrapStyle}><ChevronDown open={expanded} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <NameCell value={scope.name} placeholder="Scope name" onSave={onRename} onToggle={onToggle} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-mid)', flexShrink: 0, whiteSpace: 'nowrap' }}>{money(total)}</span>
        <ConfirmDeleteButton
          onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete scope"
          confirmText={`Delete "${scope.name || 'this scope'}"? All its labor and material lines go with it.`}
        />
      </div>
      {expanded && (
        <div style={{ background: 'var(--surface-2)' }}>
          <div style={{ padding: '4px 16px 10px 34px' }}>
            <ScopeTextField value={scope.scopeText} onSave={onUpdateText} />
          </div>
          <LineGroup
            label="Labor"
            items={scope.labor || []}
            onAdd={data => onAddLine('labor', data)}
            onUpdate={(id, patch) => onUpdateLine('labor', id, patch)}
            onDelete={id => onDeleteLine('labor', id)}
          />
          <LineGroup
            label="Materials"
            items={scope.materials || []}
            onAdd={data => onAddLine('materials', data)}
            onUpdate={(id, patch) => onUpdateLine('materials', id, patch)}
            onDelete={id => onDeleteLine('materials', id)}
            markup={matPct}
            showPartNo
            quote={quote}
          />
          <MaterialsPricingUpload onAddLines={dataArray => onAddLines('materials', dataArray)} />
          <div style={{ height: 8 }} />
        </div>
      )}
    </div>
  )
}

function ScopeTextField({ value, onSave }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <ExpandableText text={value} expanded={expanded} onToggle={() => setExpanded(x => !x)} placeholder="Add scope of work…" />
      {expanded && (
        <BufferedTextarea
          autoFocus
          value={value}
          onCommit={onSave}
          placeholder="Describe the scope of work — one line per bullet point"
          rows={4}
          style={{ ...workTextareaStyle, marginTop: 6 }}
        />
      )}
    </div>
  )
}

// Shows both the entered base cost and the +15% marked-up price that actually
// prints on the exported quote — so what's on screen always matches what the
// customer sees, unlike Adjustments (which show a single raw dollar figure).
function ReferencePricingRow({ item, onUpdate, onDelete, quote }) {
  const marked = referencePricingAmount(quote, item)
  return (
    <div style={fieldRowStyle}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <EditableField value={item.desc} placeholder="Reference item" onSave={v => onUpdate({ desc: v })} />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>Cost $</span>
          <BufferedInput
            type="number" step="0.01" value={item.amount} onCommit={v => onUpdate({ amount: v })}
            placeholder="0.00"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', width: 78, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)' }}
          />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}>→ {money(marked)}</span>
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete reference item" confirmText="Delete this reference item?" />
      </div>
    </div>
  )
}

function ReferencePricingAddRow({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')

  function reset() { setDesc(''); setAmount('') }
  function submit() {
    const d = desc.trim()
    if (d) onAdd({ desc: d, amount: amount ? Number(amount) : 0 })
    reset()
    setOpen(false)
  }
  function handleBlur(e) { if (!e.currentTarget.contains(e.relatedTarget)) submit() }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { reset(); setOpen(false) } }

  if (!open) {
    return <CollapsedAddRow label="Add reference pricing" onClick={() => setOpen(true)} />
  }
  return (
    <div onBlur={handleBlur} style={{ ...fieldRowStyle, background: 'var(--surface-2)' }}>
      <input
        autoFocus value={desc} onChange={e => setDesc(e.target.value)} placeholder="Reference item" onKeyDown={onKey}
        style={{ flex: 1, minWidth: 0, fontSize: 14, border: 'none', background: 'none', outline: 'none', fontFamily: 'var(--font)' }}
      />
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)' }}>Cost $</span>
        <input
          type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" onKeyDown={onKey}
          style={{ fontSize: 13, width: 78, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)' }}
        />
      </span>
    </div>
  )
}

function AdjustmentRow({ adj, onUpdate, onDelete, placeholder = 'Adjustment' }) {
  return (
    <div style={fieldRowStyle}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <EditableField value={adj.desc} placeholder={placeholder} onSave={v => onUpdate({ desc: v })} />
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>$</span>
        <BufferedInput
          type="number" step="0.01" value={adj.amount} onCommit={v => onUpdate({ amount: v })}
          placeholder="0.00"
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', width: 92, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)' }}
        />
        <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete line" confirmText="Delete this?" />
      </div>
    </div>
  )
}

function AdjustmentAddRow({ onAdd, label = 'Add adjustment (discount, allowance, etc.)', placeholder = 'Adjustment' }) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')

  function reset() { setDesc(''); setAmount('') }
  function submit() {
    const d = desc.trim()
    if (d) onAdd({ desc: d, amount: amount ? Number(amount) : 0 })
    reset()
    setOpen(false)
  }
  function handleBlur(e) { if (!e.currentTarget.contains(e.relatedTarget)) submit() }
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { reset(); setOpen(false) } }

  if (!open) {
    return <CollapsedAddRow label={label} onClick={() => setOpen(true)} />
  }

  return (
    <div onBlur={handleBlur} style={{ ...fieldRowStyle, background: 'var(--surface-2)' }}>
      <input autoFocus value={desc} onChange={e => setDesc(e.target.value)} placeholder="Adjustment description" onKeyDown={onKey}
        style={{ ...plainInputStyle, flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-light)' }}>$</span>
        <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" onKeyDown={onKey}
          style={{ ...plainInputStyle, width: 92, textAlign: 'right' }} />
      </div>
    </div>
  )
}

// ── Small modal overlay (used for the approve + link-to-job flow) ──
function ModalOverlay({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,46,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', borderRadius: 'var(--rs)', maxWidth: 380, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}
      >
        {children}
      </div>
    </div>
  )
}

const modalBtnStyle = (primary) => ({
  flex: 1, padding: '10px', borderRadius: 'var(--rs)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'var(--surface)',
  color: primary ? 'var(--navy)' : 'var(--text)',
})

function findOrCreateJobCustomer(jobsStore, name, quoteCustomer) {
  const existing = linkedJobsCustomer(quoteCustomer, jobsStore.customers)
    || jobsStore.customers.find(c => (c.name || '').trim().toLowerCase() === name.trim().toLowerCase())
  if (existing) return Promise.resolve(existing)
  return jobsStore.addCustomer({ name, ...(quoteCustomer ? { sharedId: quoteCustomer.sharedId || quoteCustomer.id } : {}) })
}

// Full approve + (optionally) link-to-job flow. Only shown when approving a
// quote that isn't already linked — otherwise it's a one-click confirm.
export function ApprovalModal({ quote, quoteCustomerName, quoteCustomer, jobsStore, onDone, onClose }) {
  const [step, setStep] = useState('confirm') // confirm | choose | pickExisting | createNew
  const [linkType, setLinkType] = useState('primary')
  const [jobType, setJobType] = useState('quoted') // how the NEW job will be billed: fixed price vs T&M
  const [search, setSearch] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function approveWithLink(projectId, type) {
    setBusy(true)
    setError('')
    try {
      const job = jobsStore.records.find(p => p.id === projectId)
      const existingIds = job ? (job.linkedQuoteIds || (job.linkedQuoteId ? [job.linkedQuoteId] : [])) : []
      const newIds = existingIds.includes(quote.id) ? existingIds : [...existingIds, quote.id]
      // Additive: add this quote's share on top of whatever was already there for
      // other linked quotes, rather than recomputing everything (this store only has this quote loaded).
      const previousMaterials = Number(job?.quotedMaterials) || 0
      const previousLabor = Number(job?.quotedLabor) || 0
      const alreadyCounted = existingIds.includes(quote.id)
      await jobsStore.updateRecord(projectId, {
        linkedQuoteIds: newIds,
        quotedMaterials: alreadyCounted ? previousMaterials : previousMaterials + quoteMaterialsTotal(quote),
        quotedLabor: alreadyCounted ? previousLabor : previousLabor + quoteLaborTotal(quote),
        // Pre-fill the job's editable planned-materials list from this quote
        ...(alreadyCounted ? {} : { plannedMaterials: [...(job?.plannedMaterials || []), ...quotePlannedMaterials(quote)] }),
      })
      await onDone({ approved: true, linkedJobId: projectId, linkType: type })
    } catch (err) {
      setError(err.message || 'Something went wrong linking this job.')
      setBusy(false)
    }
  }

  async function createNewJob() {
    setBusy(true)
    setError('')
    try {
      const jobCustomer = await findOrCreateJobCustomer(jobsStore, quoteCustomerName, quoteCustomer)
      const project = await jobsStore.addRecord(jobCustomer.id, {
        name: quote.title || quote.quoteNumber,
        co: quote.quoteNumber,
        type: jobType,
        notes: quote.notes || '',
        linkedQuoteIds: [],
      })
      await approveWithLink(project.id, linkType)
    } catch (err) {
      setError(err.message || 'Something went wrong creating the job.')
      setBusy(false)
    }
  }

  // A sub-job gets its own full, independent job record — same status, CO,
  // and Labor/Materials tracking as any other job — just tagged with a
  // reference back to the job it's related to, rather than being merged
  // into that job's own record.
  async function createSubJobUnderParent(parentJobId) {
    setBusy(true)
    setError('')
    try {
      const parentJob = jobsStore.records.find(p => p.id === parentJobId)
      if (!parentJob) throw new Error('Could not find that job.')
      const project = await jobsStore.addRecord(parentJob.customerId, {
        name: quote.title || quote.quoteNumber,
        co: quote.quoteNumber,
        type: 'quoted',
        notes: quote.notes || '',
        linkedQuoteIds: [],
        relatedJobId: parentJobId,
      })
      await approveWithLink(project.id, 'subjob')
    } catch (err) {
      setError(err.message || 'Something went wrong creating the sub-job.')
      setBusy(false)
    }
  }

  const q = search.trim().toLowerCase()
  const matches = q
    ? jobsStore.records.filter(p => hit([p.name, p.co], q)).slice(0, 8)
    : []

  return (
    <ModalOverlay onClose={busy ? () => {} : onClose}>
      <div style={{ padding: 18 }}>
        {step === 'confirm' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
              Mark "{quote.title || quote.quoteNumber}" as approved?
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 16 }}>
              This quote isn't linked to a job yet. Approving it moves it over to Jobs.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={modalBtnStyle(false)} onClick={onClose}>Cancel</button>
              <button style={modalBtnStyle(true)} onClick={() => setStep('choose')}>Continue</button>
            </div>
          </>
        )}

        {step === 'choose' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              Is this for an existing job?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <button style={modalBtnStyle(false)} onClick={() => setStep('pickExisting')}>Yes, link to an existing job</button>
              <button style={modalBtnStyle(false)} onClick={() => setStep('createNew')}>No, create a new job</button>
            </div>
            <button style={{ ...modalBtnStyle(false), border: 'none', color: 'var(--text-light)' }} onClick={onClose}>Cancel</button>
          </>
        )}

        {step === 'pickExisting' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Find the job</div>
            <input
              autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs by name or CO#…"
              style={{ ...inputStyle, marginBottom: 10 }}
            />
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>
              {matches.map(p => {
                const cust = jobsStore.customers.find(c => c.id === p.customerId)
                return (
                  <div
                    key={p.id}
                    onClick={() => { setStep('confirmLink'); setSelectedJobId(p.id) }}
                    style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', marginBottom: 6, fontSize: 13 }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name || 'Untitled project'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{cust?.name} · CO {p.co || '—'}</div>
                  </div>
                )
              })}
              {q && matches.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-light)', padding: '8px 0' }}>No matches.</div>
              )}
            </div>
            <button style={{ ...modalBtnStyle(false), border: 'none', color: 'var(--text-light)' }} onClick={() => setStep('choose')}>Back</button>
          </>
        )}

        {step === 'confirmLink' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>How is this linked?</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button style={{ ...modalBtnStyle(linkType === 'primary'), flex: 1 }} onClick={() => setLinkType('primary')}>This is the job</button>
              <button style={{ ...modalBtnStyle(linkType === 'subjob'), flex: 1 }} onClick={() => setLinkType('subjob')}>Sub-job of it</button>
            </div>
            {linkType === 'subjob' && (
              <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
                Creates its own job — its own status, CO, and Labor/Materials tracking — just tagged as related to the job you picked, rather than merged into it.
              </div>
            )}
            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={modalBtnStyle(false)} onClick={() => setStep('pickExisting')} disabled={busy}>Back</button>
              <button
                style={modalBtnStyle(true)} disabled={busy}
                onClick={() => linkType === 'subjob' ? createSubJobUnderParent(selectedJobId) : approveWithLink(selectedJobId, linkType)}
              >
                {busy ? 'Linking…' : 'Approve & link'}
              </button>
            </div>
          </>
        )}

        {step === 'createNew' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>How is this linked?</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button style={{ ...modalBtnStyle(linkType === 'primary'), flex: 1 }} onClick={() => setLinkType('primary')}>This is the job</button>
              <button style={{ ...modalBtnStyle(linkType === 'subjob'), flex: 1 }} onClick={() => setLinkType('subjob')}>Sub-job</button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6 }}>How will this job be billed?</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <button style={{ ...modalBtnStyle(jobType === 'quoted'), flex: 1 }} onClick={() => setJobType('quoted')}>Quoted (fixed price)</button>
              <button style={{ ...modalBtnStyle(jobType === 'tm'), flex: 1 }} onClick={() => setJobType('tm')}>T&amp;M</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginBottom: 14 }}>
              {jobType === 'tm'
                ? 'The quote stays linked as the estimate, but the job is billed from the hours and materials you enter.'
                : 'The job is billed by progress against the quoted value.'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 12 }}>
              Creates a new job under <strong>{quoteCustomerName}</strong> named "{quote.title || quote.quoteNumber}", with its own folder.
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={modalBtnStyle(false)} onClick={() => setStep('choose')} disabled={busy}>Back</button>
              <button style={modalBtnStyle(true)} disabled={busy} onClick={createNewJob}>{busy ? 'Creating…' : 'Approve & create job'}</button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

// Simple confirm — used when un-approving, or approving a quote already linked to a job
export function SimpleApprovalConfirm({ quote, approving, linkedJobName, onConfirm, onClose }) {
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          {approving ? `Mark "${quote.title || quote.quoteNumber}" as approved?` : `Mark "${quote.title || quote.quoteNumber}" as not approved?`}
        </div>
        {approving && linkedJobName && (
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 16 }}>Linked to job: {linkedJobName}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: approving && !linkedJobName ? 0 : 12 }}>
          <button style={modalBtnStyle(false)} onClick={onClose}>Cancel</button>
          <button style={modalBtnStyle(true)} onClick={onConfirm}>{approving ? 'Approve' : 'Un-approve'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

// Read-only view of a past revision's content, exactly as it stood when
// "New revision" was clicked — so nothing is lost as the live quote keeps changing.
function RevisionViewerModal({ entry, customer, onClose }) {
  const snap = entry.snapshot ? normalizeQuote(entry.snapshot) : null

  if (!snap) {
    return (
      <ModalOverlay onClose={onClose}>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Rev {entry.rev}</div>
          <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16 }}>
            No saved copy for this revision — it was created before this feature existed.
          </div>
          <button style={modalBtnStyle(true)} onClick={onClose}>Close</button>
        </div>
      </ModalOverlay>
    )
  }

  const scopes = snap.scopes || []
  const adjustments = snap.adjustments || []
  const showScopeNames = scopes.length > 1
  const total = quoteGrandTotal(snap)

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Rev {entry.rev} — read-only</div>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{formatRevDate(entry.date)}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>{customer.name} · {snap.title || 'Untitled'}</div>

        {snap.basedOn && <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 10 }}><strong>Based on:</strong> {snap.basedOn}</div>}

        {scopes.map((sc, i) => (
          <div key={sc.id || i} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              {showScopeNames ? (sc.name || `Scope ${i + 1}`) : 'Scope of Work'}
            </div>
            {sc.scopeText && (
              <div style={{ fontSize: 12, color: 'var(--text-mid)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>{sc.scopeText}</div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', textAlign: 'right' }}>
              Scope total: {money(scopeTotal(snap, sc))}
            </div>
          </div>
        ))}

        {(snap.allowances || []).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Allowances</div>
            {allowancesByCategory(snap).filter(c => c.items.length).map(c => (
              <div key={c.id} style={{ fontSize: 12, color: 'var(--text-mid)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{c.id === 'other' ? otherAllowanceLabel(snap) : c.label}</span><span>{money(c.total)}</span>
              </div>
            ))}
          </div>
        )}

        {adjustments.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Adjustments</div>
            {adjustments.map((a, i) => (
              <div key={a.id || i} style={{ fontSize: 12, color: 'var(--text-mid)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{a.desc || 'Adjustment'}</span><span>{money(a.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, borderTop: '2px solid var(--border)', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Total (Rev {entry.rev})</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{money(total)}</span>
        </div>

        <button style={modalBtnStyle(true)} onClick={onClose}>Close</button>
      </div>
    </ModalOverlay>
  )
}


function formatNoteDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// One dated note: a two-line preview; click it to open the whole note.
// Notes filed from email (Assistant Update) are tagged so you can tell them apart.
const irrelevantBtn = { fontSize: 10.5, fontWeight: 700, color: '#8a6d1f', background: '#fff8e6', border: '1px solid #e8cf8a', borderRadius: 20, padding: '2px 9px', cursor: 'pointer' }
function NoteEntryRow({ note, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const fromEmail = note.source === 'email'

  function commit() {
    setEditing(false)
    const v = (draft || '').trim()
    if (v && v !== note.text) onUpdate({ text: v, editedAt: new Date().toISOString() })
    else setDraft(note.text)
  }

  return (
    <div style={{ padding: '9px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text-light)', fontWeight: 700 }}>{formatNoteDate(note.timestamp)}</span>
        <span style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 10,
          background: fromEmail ? '#e8f2fc' : 'var(--accent-bg)', color: fromEmail ? '#1a5fa0' : 'var(--accent-dim)',
        }}>{fromEmail ? 'Filed from email' : 'My note'}</span>
        <span style={{ flex: 1 }} />
        {fromEmail && (
          <ConfirmDeleteButton
            onConfirm={onDelete} ariaLabel="Irrelevant — remove this email note" triggerLabel="Irrelevant" label="Remove"
            confirmText="Remove this email note from the app? The email itself stays in Outlook."
            style={irrelevantBtn}
          />
        )}
        {open && !editing && (
          <button onClick={() => { setDraft(note.text); setEditing(true) }} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
        )}
        <ConfirmDeleteButton
          onConfirm={onDelete} ariaLabel="Delete note" confirmText="Delete this note?"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15, padding: '0 4px' }}
        />
      </div>
      {editing ? (
        <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} rows={4} style={workTextareaStyle} />
      ) : (
        <div
          onClick={() => setOpen(o => !o)}
          title={open ? 'Click to collapse' : 'Click to read the whole note'}
          style={{
            fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-wrap', cursor: 'pointer', lineHeight: 1.45,
            ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
          }}
        >
          {note.text}
        </div>
      )}
    </div>
  )
}

function QuoteNotesSection({ quote, onUpdate }) {
  const notes = [...(quote.notesLog || [])].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  const [draft, setDraft] = useState('')

  function addNote() {
    const text = draft.trim()
    if (!text) return
    const entry = { id: uid(), timestamp: new Date().toISOString(), text, source: 'manual' }
    onUpdate({ notesLog: [entry, ...(quote.notesLog || [])] })
    setDraft('')
  }
  function updateNote(id, patch) {
    onUpdate({ notesLog: (quote.notesLog || []).map(n => n.id === id ? { ...n, ...patch } : n) })
  }
  function deleteNote(id) {
    onUpdate({ notesLog: (quote.notesLog || []).filter(n => n.id !== id) })
  }
  const canAdd = draft.trim().length > 0

  return (
    <div>
      <div style={{ padding: '10px 16px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <textarea
          value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add your own note…" rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote() }}
          style={{ ...workTextareaStyle, minHeight: 44, flex: 1 }}
        />
        <button
          onClick={addNote} disabled={!canAdd}
          style={{
            padding: '8px 14px', borderRadius: 'var(--rs)', border: 'none', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
            cursor: canAdd ? 'pointer' : 'default',
            background: canAdd ? 'var(--accent)' : 'var(--gray-light)', color: canAdd ? 'var(--navy)' : 'var(--text-light)',
          }}
        >
          Add note
        </button>
      </div>
      <NoteGroups notes={notes} emptyText="No notes yet. Notes you approve from email in Assistant Update show up here too."
        renderRow={n => <NoteEntryRow key={n.id} note={n} onUpdate={patch => updateNote(n.id, patch)} onDelete={() => deleteNote(n.id)} />} />
    </div>
  )
}

// Flattens every scope's Materials into one list for exporting to a wholesaler
function aggregateMaterials(scopes) {
  return (scopes || []).flatMap(sc => sc.materials || [])
}

function materialsListText(items, label) {
  const qtyW = Math.max(3, ...items.map(i => String(i.qty || '').length))
  const partW = Math.max(7, ...items.map(i => String(i.partNo || '').length))
  const header = `${'QTY'.padEnd(qtyW)}  ${'PART NO'.padEnd(partW)}  DESCRIPTION`
  const rule = '-'.repeat(header.length)
  const lines = items.map(i =>
    `${String(i.qty || '').padEnd(qtyW)}  ${(i.partNo || '').padEnd(partW)}  ${i.desc || 'Item'}`
  )
  return [
    'MATERIALS TO ORDER',
    label || '',
    '',
    header,
    rule,
    ...lines,
  ].join('\n')
}

function materialsExportFileName(label) {
  const safe = String(label || 'Materials').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
  const date = todayLocal()
  return `${date} - ${safe} - Materials to Order.txt`
}

function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)))
}

function CopyMaterialsButton({ materialsList, label, folderPath }) {
  const [state, setState] = useState('idle') // idle | working | done
  async function doExport() {
    setState('working')
    try {
      const text = materialsListText(materialsList, label)
      const base64 = textToBase64(text)
      const fileName = materialsExportFileName(label)
      if (window.desktop) {
        const savedPath = await window.desktop.saveFile(folderPath, fileName, base64)
        if (savedPath) window.desktop.openFile(savedPath)
      } else {
        const link = document.createElement('a')
        link.href = `data:text/plain;base64,${base64}`
        link.download = fileName
        link.click()
      }
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }
  return (
    <button
      onClick={doExport}
      disabled={state === 'working'}
      style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
        border: state === 'done' ? 'none' : '1px solid var(--border)',
        background: state === 'done' ? 'var(--green)' : 'var(--surface)',
        color: state === 'done' ? '#fff' : 'var(--text-mid)', flexShrink: 0,
      }}
    >
      {state === 'working' ? 'Exporting…' : state === 'done' ? 'Exported ✓' : 'Export materials list'}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════
// QUOTE PAGE — collapsible sections, markup rates, allowances, and the
// "Complete Quote" draft that exports into the Word template.
// ══════════════════════════════════════════════════════════════════

const SECTION_DEFAULTS = { general: true, proposalNotes: true, scopes: true, allowances: true, adjustments: false, reference: false, files: false, revisions: false }

// Proposal notes: the "Notes:" printed on the proposal letter — separate from
// the quote's own note (imported) and the project notes. Same text as the
// Notes box on the Complete Quote tab; editing either changes both.
function ProposalNotesSection({ quote, onUpdate, open, onToggle }) {
  const draft = quote.completeQuote
  const text = draft ? (draft.notesText || '') : (quote.proposalNotes || '')
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const saveText = v => onUpdate({ proposalNotes: v, ...(draft ? { completeQuote: { ...draft, notesText: v, editedAt: new Date().toISOString() } } : {}) })
  const [showPick, setShowPick] = useState(false)
  const filed = [...(quote.notesLog || [])].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .map(n => ({ id: n.id, at: n.timestamp, text: String(n.text || '').replace(/\n+📧[\s\S]*$/, '').replace(/\s*\n\s*/g, ' ').trim() })).filter(n => n.text)
  const picks = [...(quote.notes ? [{ id: 'qnote', at: '', text: String(quote.notes).trim() }] : []), ...filed]
  return (
    <CollapsibleSection title="Proposal Notes" open={open} onToggle={onToggle}
      summary={lines.length ? `${lines.length} note${lines.length === 1 ? '' : 's'} on the letter` : 'none on the letter'}>
      <div style={{ padding: '4px 16px 12px' }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginBottom: 5 }}>
          Prints under <b>Notes:</b> on the proposal letter — one per line. Separate from the quote note and project notes (those don't print).
        </div>
        <BufferedTextarea value={text} onCommit={saveText} rows={Math.min(10, Math.max(3, lines.length + 1))}
          placeholder={'e.g. Price valid for 30 days.\nWork to be completed during regular hours.\nExcludes patching and painting.'}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, lineHeight: 1.45, border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontFamily: 'inherit', resize: 'vertical' }} />
        {picks.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setShowPick(v => !v)} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {showPick ? '▾' : '▸'} Copy in from the quote / project notes ({picks.length})
            </button>
            {showPick && picks.map(n => {
              const added = lines.includes(n.text)
              return (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ flex: 1, color: 'var(--text-mid)' }}>{n.text}{n.at ? <span style={{ color: 'var(--text-light)', fontSize: 11 }}> · {formatNoteDate(n.at)}</span> : <span style={{ color: 'var(--text-light)', fontSize: 11 }}> · quote note</span>}</span>
                  <button disabled={added} onClick={() => saveText(appendLine(text, n.text))}
                    style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: added ? 'var(--text-light)' : 'var(--accent-dim)', cursor: added ? 'default' : 'pointer' }}>{added ? '✓ on letter' : '+ Add'}</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}

function CollapsibleSection({ title, summary, open, onToggle, right, children }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', cursor: 'pointer', userSelect: 'none',
          background: open ? 'var(--navy)' : 'var(--surface-2)', color: open ? '#fff' : 'var(--text)',
        }}
      >
        <span style={{ display: 'flex', color: open ? 'var(--accent)' : 'var(--text-light)' }}><ChevronDown open={open} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', flex: 1, minWidth: 0 }}>{title}</span>
        {right && <span onClick={e => e.stopPropagation()}>{right}</span>}
        {summary != null && summary !== '' && (
          <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', color: open ? 'var(--accent)' : 'var(--text-mid)' }}>{summary}</span>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}

const pctInputStyle = {
  fontSize: 14, fontWeight: 600, color: 'var(--text)', width: 64, textAlign: 'right', border: '1px solid var(--border)',
  borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)',
}

function MarkupRatesBlock({ quote, onUpdate }) {
  const markup = quote.markup || {}
  function setRate(key, v) {
    onUpdate({ markup: { ...markup, [key]: v === '' ? '' : Number(v) } })
  }
  return (
    <div>
      <div style={subGroupLabelStyle}>Markup rate</div>
      {MARKUP_KEYS.map(k => (
        <div key={k.id} style={{ ...fieldRowStyle, padding: '7px 16px 7px 34px' }}>
          <span style={fieldLabelStyle}>{k.id === 'other' ? `Other${quote.allowanceOtherTitle ? ` (${quote.allowanceOtherTitle})` : ''}` : k.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <BufferedInput type="number" step="0.5" value={markup[k.id] ?? DEFAULT_MARKUP} onCommit={v => setRate(k.id, v)} placeholder={String(DEFAULT_MARKUP)} style={pctInputStyle} />
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>%</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const ALLOW_COLS = 'minmax(140px, 1fr) 60px 92px 88px 96px'

function AllowanceRow({ quote, item, onUpdate, onDelete }) {
  const amount = allowanceAmount(quote, item)
  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 34 }}>
      <div style={{ display: 'grid', gridTemplateColumns: ALLOW_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <BufferedInput value={item.desc} onCommit={v => onUpdate({ desc: v })} placeholder="Description" style={plainInputStyle} />
        <BufferedInput type="number" inputMode="decimal" value={item.qty} onCommit={v => onUpdate({ qty: v })} placeholder="1" style={{ ...plainInputStyle, textAlign: 'center' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <BufferedInput type="number" step="0.01" inputMode="decimal" value={item.rate} onCommit={v => onUpdate({ rate: v })} placeholder="0.00" style={{ ...plainInputStyle, textAlign: 'right' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: item.noMarkup ? 'var(--red)' : 'var(--text-light)', cursor: 'pointer', whiteSpace: 'nowrap' }} title="Charge this line at cost, with no markup">
          <input type="checkbox" checked={!!item.noMarkup} onChange={e => onUpdate({ noMarkup: e.target.checked })} style={{ width: 14, height: 14, cursor: 'pointer' }} />
          No markup
        </label>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(amount)}</span>
      </div>
      <ConfirmDeleteButton onConfirm={onDelete} style={delBtnStyle} ariaLabel="Delete allowance" confirmText="Delete this allowance line?" />
    </div>
  )
}

function AllowanceAddRow({ onAdd, placeholder }) {
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [noMarkup, setNoMarkup] = useState(false)
  function submit() {
    if (!desc.trim() && !rate) return
    onAdd({ desc: desc.trim(), qty: qty === '' ? 1 : Number(qty), rate: rate ? Number(rate) : 0, noMarkup })
    setDesc(''); setQty(''); setRate(''); setNoMarkup(false)
  }
  const onKey = e => { if (e.key === 'Enter') submit() }
  return (
    <div style={{ ...nestedRowStyle, cursor: 'default', paddingLeft: 34, background: 'var(--surface-2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: ALLOW_COLS, gap: 6, flex: 1, minWidth: 0, alignItems: 'center' }}>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={placeholder} onKeyDown={onKey} style={plainInputStyle} />
        <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} placeholder="1" onKeyDown={onKey} style={{ ...plainInputStyle, textAlign: 'center' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-light)' }}>$</span>
          <input type="number" step="0.01" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="0.00" onKeyDown={onKey} style={{ ...plainInputStyle, textAlign: 'right' }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-light)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={noMarkup} onChange={e => setNoMarkup(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
          No markup
        </label>
        <span />
      </div>
      <button onClick={submit} style={{ ...delBtnStyle, color: 'var(--accent-dim)', fontSize: 17, fontWeight: 700 }} aria-label="Add allowance">+</button>
    </div>
  )
}

function AllowancesSection({ quote, onUpdate }) {
  const allowances = quote.allowances || []
  const groups = allowancesByCategory(quote)
  function add(category, data) {
    onUpdate({ allowances: [...allowances, { id: uid(), category, ...data }] })
  }
  function update(id, patch) {
    onUpdate({ allowances: allowances.map(a => a.id === id ? { ...a, ...patch } : a) })
  }
  function remove(id) {
    onUpdate({ allowances: allowances.filter(a => a.id !== id) })
  }
  return (
    <div>
      {groups.map(g => (
        <div key={g.id} style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px 4px 16px' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{g.label}</span>
            {g.id === 'other' && (
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <EditableField
                  value={quote.allowanceOtherTitle} placeholder="— click to name it"
                  onSave={v => onUpdate({ allowanceOtherTitle: (v || '').trim() })}
                  textStyleOverride={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-dim)', cursor: 'text' }}
                  placeholderStyleOverride={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-light)', cursor: 'text' }}
                />
              </span>
            )}
            {g.id !== 'other' && <span style={{ flex: 1 }} />}
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>+{markupPct(quote, g.id)}%</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 80, textAlign: 'right' }}>{g.items.length ? money(g.total) : ''}</span>
          </div>
          {g.items.map(a => (
            <AllowanceRow key={a.id} quote={quote} item={a} onUpdate={patch => update(a.id, patch)} onDelete={() => remove(a.id)} />
          ))}
          <AllowanceAddRow
            onAdd={data => add(g.id, data)}
            placeholder={g.id === 'other' ? (quote.allowanceOtherTitle ? `Add to ${quote.allowanceOtherTitle}…` : 'Add other cost / sub trade…') : `Add ${g.label.toLowerCase()} allowance…`}
          />
        </div>
      ))}
    </div>
  )
}

// ── Complete Quote tab ──
const draftLabelStyle = { fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-light)', margin: '10px 0 4px' }
const draftInputStyle = {
  width: '100%', boxSizing: 'border-box', fontSize: 13.5, fontFamily: 'var(--font)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', outline: 'none', background: 'var(--surface)',
}
const smallBtnStyle = {
  fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 'var(--rs)', border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer', whiteSpace: 'nowrap',
}

function appendLine(text, line) {
  const t = String(text || '').replace(/\s+$/, '')
  return t ? `${t}\n${line}` : line
}

function PieceRow({ label, detail, onAdd, addLabel = '+ Add' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
        {detail && <div style={{ fontSize: 11, color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>}
      </div>
      <button onClick={onAdd} style={{ ...smallBtnStyle, color: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>{addLabel}</button>
    </div>
  )
}

function CompleteQuoteTab({ quote, customer, onUpdate }) {
  const draft = quote.completeQuote
  const [activeBlockId, setActiveBlockId] = useState(null)
  const [confirmMode, setConfirmMode] = useState(null) // 'rebuild' | 'blank'
  const [piecesOpen, setPiecesOpen] = useState(true)
  const [apiKey] = useApiKey()
  const [writing, setWriting] = useState({ busy: false, error: '' })

  useEffect(() => {
    if (!quote.completeQuote) onUpdate({ completeQuote: buildCompleteDraft(quote, customer.name) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id, !!quote.completeQuote])

  if (!draft) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Building the draft…</div>

  const blocks = draft.blocks || []
  const pricingTotal = quoteGrandTotal(quote)
  const currentFinal = finalLineFor(quote, customer.name)
  const general = draft.detail === 'general'
  const gen = { ...defaultGeneral(quote), ...(draft.general || {}) }
  const currentAllow = includedAllowanceText(quote)
  function saveGeneral(patch) { save({ general: { ...gen, ...patch } }) }
  function setMode(mode) {
    save(mode === 'general' && !draft.general ? { detail: 'general', general: defaultGeneral(quote) } : { detail: mode })
  }
  async function writeForMe() {
    if (!apiKey) { setWriting({ busy: false, error: 'Add your Anthropic API key in Settings first (same key the AI Summary uses).' }); return }
    setWriting({ busy: true, error: '' })
    try {
      const text = await writeGeneralScope(quote, customer.name, apiKey)
      if (!text) throw new Error('Nothing came back. Try again.')
      saveGeneral({ scopeText: text, writtenAt: new Date().toISOString() })
      setWriting({ busy: false, error: '' })
    } catch (e) {
      setWriting({ busy: false, error: `Couldn't write it: ${e.message}` })
    }
  }

  // A clean page: one empty section to write your own scope in, the current
  // total as the price line, and your Based on / Notes kept.
  function blankDraft() {
    return {
      builtAt: new Date().toISOString(), detail: 'general', showHeadings: false,
      basedOn: draft.basedOn || '', notesText: draft.notesText || '',
      blocks: [{ id: uid(), heading: quote.title || 'Scope of work', scopeText: '', costText: '', totalLine: '' }],
      adjustmentsText: '', finalLine: currentFinal, referenceText: '',
      general: { scopeText: '', allowText: includedAllowanceText(quote) },
    }
  }
  function confirmReplace() {
    const next = confirmMode === 'blank' ? blankDraft() : { ...buildCompleteDraft(quote, customer.name), detail: draft.detail || 'detailed', general: defaultGeneral(quote) }
    onUpdate({ completeQuote: next })
    setActiveBlockId(next.blocks[0]?.id || null)
    setConfirmMode(null)
  }
  const segBtn = on => ({
    fontSize: 12, fontWeight: 800, padding: '6px 12px', border: 'none', cursor: 'pointer',
    background: on ? 'var(--navy)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-mid)',
  })
  const generalNote = <div style={{ fontSize: 11, color: 'var(--text-light)', fontStyle: 'italic', margin: '2px 0 4px' }}>Not printed on a General quote. Kept here if you switch back to Detailed.</div>

  function save(patch) {
    onUpdate({ completeQuote: { ...draft, ...patch, editedAt: new Date().toISOString() } })
  }
  function updateBlock(id, patch) {
    save({ blocks: blocks.map(b => b.id === id ? { ...b, ...patch } : b) })
  }
  function moveBlock(id, dir) {
    const i = blocks.findIndex(b => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= blocks.length) return
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]]
    save({ blocks: next })
  }
  function deleteBlock(id) {
    save({ blocks: blocks.filter(b => b.id !== id) })
  }
  function addBlock(block) {
    if (general) { if (block.scopeText) saveGeneral({ scopeText: appendLine(gen.scopeText, block.scopeText.trim()) }); return }
    const b = { id: uid(), heading: '', scopeText: '', costText: '', totalLine: '', ...block }
    save({ blocks: [...blocks, b], ...(blocks.length >= 1 ? { showHeadings: true } : {}) })
    setActiveBlockId(b.id)
  }
  // Pieces go into the section you last clicked in (or the last section).
  function intoTarget(field, line) {
    if (general) {
      if (field === 'scopeText') saveGeneral({ scopeText: appendLine(gen.scopeText, line) })
      else if (field === 'costText') saveGeneral({ allowText: appendLine(gen.allowText, line.split(':')[0].trim()) })
      else if (field === 'totalLine') save({ finalLine: line })
      return
    }
    const target = blocks.find(b => b.id === activeBlockId) || blocks[blocks.length - 1]
    if (!target) { addBlock({ [field]: line }); return }
    if (field === 'totalLine') updateBlock(target.id, { totalLine: line })
    else updateBlock(target.id, { [field]: appendLine(target[field], line) })
  }
  const targetName = general ? 'the General overview' : (() => {
    const t = blocks.find(b => b.id === activeBlockId) || blocks[blocks.length - 1]
    return t ? (t.heading || `Section ${blocks.indexOf(t) + 1}`) : 'a new section'
  })()

  const scopes = quote.scopes || []
  const allowGroups = allowancesByCategory(quote).filter(g => g.items.length)
  const filedNotes = [...(quote.notesLog || [])].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, padding: 14 }}>
      {/* The draft — exactly what goes into the Word template */}
      <div style={{ flex: '1 1 460px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-light)', flex: 1, minWidth: 200 }}>
            This is what Export puts into your quote template. Edit anything; pick pieces from the right to add them to the section you last clicked in.
          </div>
          {confirmMode ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: 'var(--red)', fontWeight: 700 }}>{confirmMode === 'blank' ? 'Clear this draft and start blank?' : 'Replace this draft from Pricing?'}</span>
              <button style={{ ...smallBtnStyle, background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }} onClick={confirmReplace}>Yes</button>
              <button style={smallBtnStyle} onClick={() => setConfirmMode(null)}>Cancel</button>
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 6 }}>
              <button style={smallBtnStyle} onClick={() => setConfirmMode('rebuild')} title="Start the draft over from the Pricing tab">↻ Rebuild from Pricing</button>
              <button style={smallBtnStyle} onClick={() => setConfirmMode('blank')} title="Start with an empty page and write your own scope">✎ Start blank</button>
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', border: '1px solid var(--navy)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
            <button style={segBtn(!general)} onClick={() => setMode('detailed')}>Detailed</button>
            <button style={segBtn(general)} onClick={() => setMode('general')}>General</button>
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-light)', flex: 1, minWidth: 200 }}>
            {general
              ? 'General prints everything the price covers, the allowances included (no amounts), and the total price. No price breakdown. Your Detailed sections are kept for when you switch back.'
              : 'Detailed prints everything: scope, cost lines, section totals, adjustments and reference pricing.'}
          </span>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 14px 14px' }}>
          <div style={draftLabelStyle}>Based on</div>
          <BufferedInput value={draft.basedOn} onCommit={v => { save({ basedOn: v }); onUpdate({ basedOn: v }) }} placeholder="e.g. drawings dated…" style={draftInputStyle} />

          <div style={draftLabelStyle}>Notes <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— one per line</span></div>
          <BufferedTextarea value={draft.notesText} onCommit={v => { save({ notesText: v }); onUpdate({ proposalNotes: v }) }} rows={3} placeholder="Notes printed on the quote" style={{ ...draftInputStyle, resize: 'vertical' }} />

          {general && (
            <div>
              <div style={{ ...draftLabelStyle, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ flex: 1 }}>Scope of work <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— overview of the whole job, one bullet per line</span></span>
                <button style={{ ...smallBtnStyle, textTransform: 'none', letterSpacing: 0, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)', opacity: writing.busy ? 0.6 : 1 }}
                  disabled={writing.busy} onClick={writeForMe} title="Reads every scope, its materials and labor, and writes one overview">
                  {writing.busy ? '✨ Writing…' : gen.writtenAt ? '✨ Rewrite it' : '✨ Write it for me'}
                </button>
                <button style={{ ...smallBtnStyle, textTransform: 'none', letterSpacing: 0 }} onClick={() => saveGeneral({ scopeText: combinedScopeText(quote) })} title="Every scope's own scope-of-work lines, as written">Use my scope text</button>
              </div>
              {writing.error && <div style={{ fontSize: 11.5, color: 'var(--red)', margin: '2px 0 4px' }}>{writing.error}</div>}
              <BufferedTextarea key={`g-${gen.writtenAt || ''}`} value={gen.scopeText} onCommit={v => saveGeneral({ scopeText: v })} rows={8}
                placeholder="Click “Write it for me” to have the scopes summarized, or type your own" style={{ ...draftInputStyle, resize: 'vertical' }} />
              <div style={{ ...draftLabelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>Allowances included in this price <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— no amounts, one per line</span></span>
                {(gen.allowText || '') !== currentAllow && (
                  <button style={{ ...smallBtnStyle, textTransform: 'none', letterSpacing: 0 }} onClick={() => saveGeneral({ allowText: currentAllow })}>↻ Refresh from Pricing</button>
                )}
              </div>
              <BufferedTextarea value={gen.allowText} onCommit={v => saveGeneral({ allowText: v })} rows={3} placeholder="No allowances on this quote" style={{ ...draftInputStyle, resize: 'vertical' }} />
            </div>
          )}

          {!general && <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-mid)', margin: '12px 0 2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!draft.showHeadings} onChange={e => save({ showHeadings: e.target.checked })} />
            Show section names{general ? '' : ' and section totals'}
          </label>

          {blocks.map((b, i) => {
            const active = (activeBlockId || blocks[blocks.length - 1]?.id) === b.id
            return (
              <div key={b.id} onFocusCapture={() => setActiveBlockId(b.id)} onClick={() => setActiveBlockId(b.id)}
                style={{ marginTop: 10, border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '4px 10px 10px', background: active ? 'var(--accent-bg)' : 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ ...draftLabelStyle, flex: 1 }}>Section {i + 1}{active ? ' · pieces go here' : ''}</div>
                  <button style={smallBtnStyle} disabled={i === 0} onClick={() => moveBlock(b.id, -1)} title="Move up">↑</button>
                  <button style={smallBtnStyle} disabled={i === blocks.length - 1} onClick={() => moveBlock(b.id, 1)} title="Move down">↓</button>
                  <ConfirmDeleteButton onConfirm={() => deleteBlock(b.id)} style={{ ...smallBtnStyle, color: 'var(--red)' }} ariaLabel="Delete section" confirmText={`Remove "${b.heading || `Section ${i + 1}`}" from the quote?`} />
                </div>
                <BufferedInput value={b.heading} onCommit={v => updateBlock(b.id, { heading: v })} placeholder="Section name" style={{ ...draftInputStyle, fontWeight: 700 }} />
                <div style={{ ...draftLabelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>Scope of work <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— your own words, one bullet per line</span></span>
                  {b.scopeText && (
                    <button style={{ ...smallBtnStyle, textTransform: 'none', letterSpacing: 0 }} onClick={() => updateBlock(b.id, { scopeText: '' })} title="Clear the prefilled scope so you can type your own">Clear & write my own</button>
                  )}
                </div>
                <BufferedTextarea value={b.scopeText} onCommit={v => updateBlock(b.id, { scopeText: v })} rows={4} placeholder="Type your own scope here, or add pieces from the right" style={{ ...draftInputStyle, resize: 'vertical' }} />
                <div style={draftLabelStyle}>Cost lines</div>
                {general && generalNote}
                <BufferedTextarea value={b.costText} onCommit={v => updateBlock(b.id, { costText: v })} rows={general ? 2 : 5} style={{ ...draftInputStyle, resize: 'vertical', fontSize: 12.5, opacity: general ? 0.5 : 1 }} />
                <div style={draftLabelStyle}>Section total line {general ? '' : draft.showHeadings ? '' : '(hidden while section names are off)'}</div>
                {general && generalNote}
                <BufferedInput value={b.totalLine} onCommit={v => updateBlock(b.id, { totalLine: v })} style={{ ...draftInputStyle, fontSize: 12.5, opacity: general ? 0.5 : 1 }} />
              </div>
            )
          })}
          <button style={{ ...smallBtnStyle, marginTop: 10 }} onClick={() => addBlock({ heading: `Section ${blocks.length + 1}` })}>+ Add section</button>

          <div style={draftLabelStyle}>Adjustments <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— one per line</span></div>
          {general && generalNote}
          <BufferedTextarea value={draft.adjustmentsText} onCommit={v => save({ adjustmentsText: v })} rows={2} style={{ ...draftInputStyle, resize: 'vertical', fontSize: 12.5, opacity: general ? 0.5 : 1 }} />
          </>}

          <div style={{ ...draftLabelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>{general ? 'Total price' : 'Final price line'}</span>
            {draft.finalLine !== currentFinal && (
              <button style={{ ...smallBtnStyle, textTransform: 'none', letterSpacing: 0 }} onClick={() => save({ finalLine: currentFinal })} title={currentFinal}>Use Pricing total ({money(pricingTotal)})</button>
            )}
          </div>
          <BufferedInput value={draft.finalLine} onCommit={v => save({ finalLine: v })} style={{ ...draftInputStyle, fontWeight: 700 }} />
          {draft.finalLine !== currentFinal && (
            <div style={{ fontSize: 11, color: '#9a6610', marginTop: 4 }}>This line no longer matches the Pricing tab total of {money(pricingTotal)}.</div>
          )}

          {!general && <>
          <div style={draftLabelStyle}>Reference pricing <span style={{ textTransform: 'none', fontWeight: 600, letterSpacing: 0 }}>— not in the total, one per line</span></div>
          <BufferedTextarea value={draft.referenceText} onCommit={v => save({ referenceText: v })} rows={2} style={{ ...draftInputStyle, resize: 'vertical', fontSize: 12.5 }} />
          </>}
        </div>
      </div>

      {/* Pieces from the Pricing tab */}
      <div style={{ flex: '0 1 320px', minWidth: 260, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', position: 'sticky', top: 8 }}>
        <div onClick={() => setPiecesOpen(o => !o)} style={{ padding: '10px 12px', background: 'var(--navy)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}><ChevronDown open={piecesOpen} /></span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', flex: 1 }}>Pieces from Pricing</span>
        </div>
        {piecesOpen && (
          <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-light)', background: 'var(--surface-2)' }}>Adding into: <b style={{ color: 'var(--text)' }}>{targetName}</b></div>

            {scopes.map((sc, i) => {
              const name = sc.name || `Scope ${i + 1}`
              const costLines = scopeCostLines(quote, sc)
              return (
                <div key={sc.id}>
                  <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>Scope · {name}</div>
                  <PieceRow label="Whole scope as a new section" detail={money(scopeTotal(quote, sc))}
                    onAdd={() => addBlock({ heading: name, scopeText: sc.scopeText || '', costText: costLines.join('\n'), totalLine: totalLineFor(name, scopeTotal(quote, sc)) })} />
                  {sc.scopeText && <PieceRow label="Scope of work text" detail={sc.scopeText.split('\n')[0]} onAdd={() => intoTarget('scopeText', sc.scopeText.trim())} />}
                  {costLines.map((l, k) => <PieceRow key={k} label={l.split(':')[0]} detail={l.split(':  ').pop()} onAdd={() => intoTarget('costText', l)} />)}
                  <PieceRow label="Scope total line" detail={money(scopeTotal(quote, sc))} addLabel="Set" onAdd={() => intoTarget('totalLine', totalLineFor(name, scopeTotal(quote, sc)))} />
                </div>
              )
            })}

            {allowGroups.length > 0 && (
              <div>
                <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>Allowances</div>
                <PieceRow label="All allowances as a new section" detail={money(allowancesTotal(quote))}
                  onAdd={() => addBlock({ heading: 'Allowances', costText: allowanceCostLines(quote).join('\n'), totalLine: totalLineFor('Allowances', allowancesTotal(quote)) })} />
                {allowGroups.map(g => {
                  const label = g.id === 'other' ? otherAllowanceLabel(quote) : g.costLabel
                  return (
                    <React.Fragment key={g.id}>
                      <PieceRow label={`${label} (total)`} detail={money(g.total)} onAdd={() => intoTarget('costText', `${label}:  ${proposalMoney(g.total)}`)} />
                      {g.items.map(a => (
                        <PieceRow key={a.id} label={`  ${a.desc || label}`} detail={`${money(allowanceAmount(quote, a))}${a.noMarkup ? ' · no markup' : ''}`}
                          onAdd={() => intoTarget('costText', `${a.desc || label}:  ${proposalMoney(allowanceAmount(quote, a))}`)} />
                      ))}
                    </React.Fragment>
                  )
                })}
              </div>
            )}

            {(quote.adjustments || []).length > 0 && (
              <div>
                <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>Adjustments</div>
                {adjustmentLinesFor(quote).map((l, k) => <PieceRow key={k} label={l.split(':  ')[0]} detail={l.split(':  ').pop()} onAdd={() => save({ adjustmentsText: appendLine(draft.adjustmentsText, l) })} />)}
              </div>
            )}

            {(quote.referencePricing || []).length > 0 && (
              <div>
                <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>Reference pricing</div>
                {referenceLinesFor(quote).map((l, k) => <PieceRow key={k} label={l.split(' — ')[0]} detail={l.split(' — ').pop()} onAdd={() => save({ referenceText: appendLine(draft.referenceText, l) })} />)}
              </div>
            )}

            {filedNotes.length > 0 && (
              <div>
                <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>General notes → quote notes</div>
                {filedNotes.map(n => {
                  const flat = String(n.text || '').replace(/\n+📧[\s\S]*$/, '').replace(/\s*\n\s*/g, ' ').trim()
                  return <PieceRow key={n.id} label={flat} detail={formatNoteDate(n.timestamp)} onAdd={() => { const v = appendLine(draft.notesText, flat); save({ notesText: v }); onUpdate({ proposalNotes: v }) }} />
                })}
              </div>
            )}

            <div>
              <div style={{ ...subGroupLabelStyle, padding: '8px 10px 2px' }}>Price</div>
              <PieceRow label="Final price line from Pricing" detail={money(pricingTotal)} addLabel="Set" onAdd={() => save({ finalLine: currentFinal })} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


function formatRevDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function QuoteDetailPage({ customer, quote: rawQuote, onUpdate, linkedJob, onOpenJob, onExport }) {
  // Older quotes are moved to the new layout the first time they're opened
  // (same total, see api/quoteMath.js). Until that save lands, show them the new way.
  const quote = normalizeQuote(rawQuote)
  useEffect(() => {
    const patch = upgradePatch(rawQuote)
    if (patch) onUpdate(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawQuote.id, isCurrentLayout(rawQuote)])

  const [tab, setTab] = useState('pricing')
  const [sectionsOpen, setSectionsOpen] = useLocalStore('quote_sections_open', SECTION_DEFAULTS)
  const isOpen = id => (sectionsOpen && sectionsOpen[id] != null ? sectionsOpen[id] : SECTION_DEFAULTS[id])
  const toggle = id => setSectionsOpen(s => ({ ...SECTION_DEFAULTS, ...(s || {}), [id]: !isOpen(id) }))

  const [expandedScopeId, setExpandedScopeId] = useState(null)
  const [viewingRevision, setViewingRevision] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [justExported, setJustExported] = useState(false)
  const log = quote.revisionLog || []
  const scopes = quote.scopes || []
  const adjustments = quote.adjustments || []
  const grandTotal = quoteGrandTotal(quote)
  const scopesSum = scopes.reduce((a, sc) => a + scopeTotal(quote, sc), 0)
  const allowSum = allowancesTotal(quote)
  const adjSum = adjustments.reduce((a, x) => a + (Number(x.amount) || 0), 0)

  async function handleExport() {
    setExporting(true)
    try {
      await onExport()
      setJustExported(true)
      setTimeout(() => setJustExported(false), 2500)
    } catch (err) {
      alert(`Export failed: ${err.message || err}`)
    } finally {
      setExporting(false)
    }
  }

  function newRevision() {
    const rev = (quote.revision || 0) + 1
    // Snapshot everything about the quote as it stands right now, so old
    // revisions stay viewable even after this one keeps changing.
    const snapshot = {
      layout: 2, title: quote.title, notes: quote.notes, basedOn: quote.basedOn, rate: quote.rate,
      sentDate: quote.sentDate, proposalNotes: quote.proposalNotes, markup: quote.markup,
      scopes: quote.scopes, allowances: quote.allowances, allowanceOtherTitle: quote.allowanceOtherTitle,
      adjustments: quote.adjustments, referencePricing: quote.referencePricing, completeQuote: quote.completeQuote,
    }
    onUpdate({ revision: rev, revisionLog: [...log, { rev, date: new Date().toISOString(), snapshot }] })
  }

  function addScope() {
    const s = { id: uid(), name: '', scopeText: '', materials: [], labor: [] }
    setExpandedScopeId(s.id)
    onUpdate({ scopes: [...scopes, s] })
  }
  function updateScope(id, patch) {
    onUpdate({ scopes: scopes.map(s => s.id === id ? { ...s, ...patch } : s) })
  }
  function deleteScope(id) {
    onUpdate({ scopes: scopes.filter(s => s.id !== id) })
  }
  function addLine(scopeId, kind, data) {
    onUpdate({ scopes: scopes.map(s => s.id === scopeId ? { ...s, [kind]: [...(s[kind] || []), { id: uid(), ...data }] } : s) })
  }
  // Several lines at once (e.g. from a parsed upload) must go in ONE update.
  function addLines(scopeId, kind, dataArray) {
    const newItems = dataArray.map(data => ({ id: uid(), ...data }))
    onUpdate({ scopes: scopes.map(s => s.id === scopeId ? { ...s, [kind]: [...(s[kind] || []), ...newItems] } : s) })
  }
  function updateLine(scopeId, kind, lineId, patch) {
    onUpdate({ scopes: scopes.map(s => s.id === scopeId ? { ...s, [kind]: (s[kind] || []).map(i => i.id === lineId ? { ...i, ...patch } : i) } : s) })
  }
  function deleteLine(scopeId, kind, lineId) {
    onUpdate({ scopes: scopes.map(s => s.id === scopeId ? { ...s, [kind]: (s[kind] || []).filter(i => i.id !== lineId) } : s) })
  }

  function addAdjustment(data) {
    onUpdate({ adjustments: [...adjustments, { id: uid(), ...data }] })
  }
  function updateAdjustment(id, patch) {
    onUpdate({ adjustments: adjustments.map(a => a.id === id ? { ...a, ...patch } : a) })
  }
  function deleteAdjustment(id) {
    onUpdate({ adjustments: adjustments.filter(a => a.id !== id) })
  }

  const referencePricing = quote.referencePricing || []
  function addReferencePricing(data) {
    onUpdate({ referencePricing: [...referencePricing, { id: uid(), ...data }] })
  }
  function updateReferencePricing(id, patch) {
    onUpdate({ referencePricing: referencePricing.map(r => r.id === id ? { ...r, ...patch } : r) })
  }
  function deleteReferencePricing(id) {
    onUpdate({ referencePricing: referencePricing.filter(r => r.id !== id) })
  }

  const tabBtn = id => ({
    flex: 1, padding: '10px 8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800,
    borderBottom: tab === id ? '3px solid var(--accent)' : '3px solid transparent',
    color: tab === id ? 'var(--navy)' : 'var(--text-light)',
  })

  return (
    <div>
      <div style={{ padding: '16px 16px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-light)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{customer.name} · {quote.quoteNumber}</span>
            {quote.revision > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'var(--accent-bg)', color: 'var(--accent-dim)', textTransform: 'none', letterSpacing: 0 }}>
                Rev {quote.revision}
              </span>
            )}
          </div>
          <div style={{ marginTop: 2 }}>
            <EditableField
              value={quote.title} placeholder="Untitled quote — click to name" onSave={v => onUpdate({ title: (v || '').trim() })}
              textStyleOverride={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', cursor: 'text' }}
              placeholderStyleOverride={{ fontSize: 18, fontWeight: 700, color: 'var(--text-light)', cursor: 'text' }}
            />
          </div>
          {quote.notes && (
            <div style={{ fontSize: 13, color: 'var(--text-mid)', marginTop: 4 }}>{quote.notes}</div>
          )}
          <FlagBanner record={rawQuote} onUpdate={onUpdate} style={{ margin: '8px 0 0' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <ProposalPill customerFolder={customer.folder} quote={rawQuote} size="big" />
            <EmailQuoteButton customerId={customer.id} customerFolder={customer.folder} quote={rawQuote} total={grandTotal} onUpdate={onUpdate} />
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{ padding: '8px 14px', borderRadius: 'var(--rs)', border: '1px solid var(--accent)', background: justExported ? 'var(--green)' : 'var(--accent-bg)', color: justExported ? '#fff' : 'var(--accent-dim)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            {exporting ? 'Exporting…' : justExported ? 'Exported ✓' : 'Export'}
          </button>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-d)' }}>{money(grandTotal)}</span>
        </div>
      </div>
      <div style={{ padding: '0 16px 8px', fontSize: 10, color: 'var(--text-light)' }}>
        Export uses the Complete Quote tab. It opens automatically and is also saved in this quote's Files.
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button style={tabBtn('pricing')} onClick={() => setTab('pricing')}>Pricing</button>
        <button style={tabBtn('complete')} onClick={() => setTab('complete')}>Complete Quote</button>
      </div>

      {tab === 'complete' ? (
        <CompleteQuoteTab quote={quote} customer={customer} onUpdate={onUpdate} />
      ) : (
        <>
          <CollapsibleSection title="General Notes" open={isOpen('general')} onToggle={() => toggle('general')}
            summary={(quote.notesLog || []).length ? `${quote.notesLog.length} note${quote.notesLog.length === 1 ? '' : 's'}` : ''}>
            <FieldRowQ label="Quote number"><span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{quote.quoteNumber}</span></FieldRowQ>
            <FieldRowQ label="Customer name"><span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{customer.name}</span></FieldRowQ>
            <FieldRowQ label="Project name">
              <span style={{ minWidth: 0, textAlign: 'right' }}>
                <EditableField value={quote.title} placeholder="Name this project" onSave={v => onUpdate({ title: (v || '').trim() })} />
              </span>
            </FieldRowQ>
            <FieldRowQ label="Linked job">
              {linkedJob ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{linkedJob.name || 'Untitled job'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{quote.linkType === 'subjob' ? 'sub-job' : 'primary'}</span>
                  <button onClick={onOpenJob} style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Open →</button>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Not linked yet (approve the quote to link a job)</span>
              )}
            </FieldRowQ>
            <FieldRowQ label="Default labor rate">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-light)' }}>$</span>
                <BufferedInput
                  type="number" step="0.01" value={quote.rate} onCommit={v => onUpdate({ rate: v ? Number(v) : '' })}
                  placeholder="90.00"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', width: 92, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', fontFamily: 'var(--font)' }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-light)' }}>/hr</span>
              </div>
            </FieldRowQ>
            <FieldRowQ label="Sent date">
              <BufferedInput type="date" value={quote.sentDate} onCommit={v => onUpdate({ sentDate: v })} style={dateInputStyle} />
            </FieldRowQ>
            <MarkupRatesBlock quote={quote} onUpdate={onUpdate} />
            <div style={subGroupLabelStyle}>Notes</div>
            <QuoteNotesSection quote={quote} onUpdate={onUpdate} />
          </CollapsibleSection>

          <ProposalNotesSection quote={quote} onUpdate={onUpdate} open={isOpen('proposalNotes')} onToggle={() => toggle('proposalNotes')} />

          <CollapsibleSection
            title={`Scope${scopes.length !== 1 ? 's' : ''} of work`} open={isOpen('scopes')} onToggle={() => toggle('scopes')}
            summary={scopes.length ? money(scopesSum) : ''}
            right={scopes.some(sc => (sc.materials || []).length > 0) ? (
              <CopyMaterialsButton materialsList={aggregateMaterials(scopes)} label={quote.title || quote.quoteNumber} folderPath={`Quotes/${customer.folder}/${quote.folder}/Files`} />
            ) : null}
          >
            {scopes.length === 0 && (
              <div style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>No scopes yet. Add one below.</div>
            )}
            {scopes.map(sc => (
              <ScopeBlock
                key={sc.id}
                quote={quote}
                scope={sc}
                expanded={expandedScopeId === sc.id}
                onToggle={() => setExpandedScopeId(id => id === sc.id ? null : sc.id)}
                onRename={name => updateScope(sc.id, { name })}
                onDelete={() => deleteScope(sc.id)}
                onUpdateText={text => updateScope(sc.id, { scopeText: text })}
                onAddLine={(kind, data) => addLine(sc.id, kind, data)}
                onAddLines={(kind, dataArray) => addLines(sc.id, kind, dataArray)}
                onUpdateLine={(kind, id, patch) => updateLine(sc.id, kind, id, patch)}
                onDeleteLine={(kind, id) => deleteLine(sc.id, kind, id)}
              />
            ))}
            <CollapsedAddRow label="Add scope" onClick={addScope} />
          </CollapsibleSection>

          <CollapsibleSection title="Allowances" open={isOpen('allowances')} onToggle={() => toggle('allowances')} summary={allowSum ? money(allowSum) : ''}>
            <AllowancesSection quote={quote} onUpdate={onUpdate} />
          </CollapsibleSection>

          <CollapsibleSection title="Adjustments" open={isOpen('adjustments')} onToggle={() => toggle('adjustments')} summary={adjustments.length ? money(adjSum) : ''}>
            <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--text-light)' }}>Discounts and other changes to the total. No markup.</div>
            {adjustments.map(a => (
              <AdjustmentRow key={a.id} adj={a} onUpdate={patch => updateAdjustment(a.id, patch)} onDelete={() => deleteAdjustment(a.id)} />
            ))}
            <AdjustmentAddRow onAdd={addAdjustment} label="Add adjustment (discount, credit, etc.)" />
          </CollapsibleSection>

          <div style={{ padding: '16px', borderTop: '2px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 0 }}>Estimated price to complete</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-d)', whiteSpace: 'nowrap', flexShrink: 0 }}>{money(grandTotal)}</span>
          </div>
          <div style={{ padding: '4px 16px 14px', fontSize: 10, color: 'var(--text-light)', textAlign: 'right', background: 'var(--surface-2)' }}>
            Taxes not included · materials +{markupPct(quote, 'materials')}% · allowances at their own rates unless marked no markup
          </div>

          <CollapsibleSection title="Reference Pricing" open={isOpen('reference')} onToggle={() => toggle('reference')} summary={referencePricing.length ? `${referencePricing.length}` : ''}>
            <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--text-light)' }}>Shown on the quote, not included in the total.</div>
            {referencePricing.map(r => (
              <ReferencePricingRow key={r.id} quote={quote} item={r} onUpdate={patch => updateReferencePricing(r.id, patch)} onDelete={() => deleteReferencePricing(r.id)} />
            ))}
            <ReferencePricingAddRow onAdd={addReferencePricing} />
          </CollapsibleSection>

          <CollapsibleSection title="Files" open={isOpen('files')} onToggle={() => toggle('files')}>
            <FileAttachments folderPath={`Quotes/${customer.folder}/${quote.folder}/Files`} />
          </CollapsibleSection>

          <CollapsibleSection title="Revisions" open={isOpen('revisions')} onToggle={() => toggle('revisions')} summary={`Rev ${quote.revision || 0}`}>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)' }}>
                  Current revision: <strong style={{ color: 'var(--text)' }}>{quote.revision || 0}</strong>
                </div>
                <button onClick={newRevision} style={{ padding: '8px 16px', borderRadius: 'var(--rs)', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: 'var(--navy)' }}>
                  New revision
                </button>
              </div>
              {log.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {log.slice().reverse().map((entry, i) => (
                    <div key={i} onClick={() => setViewingRevision(entry)}
                      style={{ fontSize: 11, color: 'var(--accent-dim)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                      Rev {entry.rev} — {formatRevDate(entry.date)} · view
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleSection>
        </>
      )}

      {viewingRevision && (
        <RevisionViewerModal entry={viewingRevision} customer={customer} onClose={() => setViewingRevision(null)} />
      )}
    </div>
  )
}

// ── Quotes hub ─────────────────────────────────────────────────────
export default function Quotes({ screen, navigate, goBack }) {
  const store = useHubStore({
    hub: 'quotes',
    recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers',
    recordsKey: 'quote_quotes',
  })
  const { customers, records: quotes, loading, needsFolder, chooseFolder,
          addCustomer: hubAddCustomer, updateCustomer,
          addRecord, updateRecord } = store

  // A second, independent instance of the Jobs store — used only for
  // cross-linking (approving a quote into a job, or showing a linked job's name).
  const jobsStore = useHubStore({
    hub: 'jobs',
    recordFileName: 'project.json',
    getRecordFolderName: project => project.name,
    customersKey: 'job_customers',
    recordsKey: 'job_projects',
  })

  const [expandedCustomerId, setExpandedCustomerId] = useState(null)
  const [showApproved, setShowApproved] = useState(false)
  const [showInvalidated, setShowInvalidated] = useState(false)
  const [approvalTarget, setApprovalTarget] = useState(null) // quote being approved/un-approved
  const [hubTab, setHubTab] = useState('quotes')

  // Red -> Yellow is a quick, no-fuss status bump (not sent -> sent). Yellow -> Green
  // is the real "approve & move to Jobs" action, so that's the only click that opens the flow.
  function handleDotClick(quote) {
    if (quote.approved) {
      setApprovalTarget(quote)
    } else if (quote.status === 'yellow') {
      setApprovalTarget(quote)
    } else {
      updateQuote(quote.id, { status: 'yellow' })
    }
  }

  if (loading || jobsStore.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }
  if (needsFolder) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Pick a folder for your data</div>
        <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 20, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
          Same folder as Jobs — everything lives together, organized by customer and project.
        </div>
        <button onClick={chooseFolder} style={{ padding: '12px 24px', borderRadius: 'var(--rs)', border: 'none', background: 'var(--accent)', color: 'var(--navy)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          Choose folder…
        </button>
      </div>
    )
  }

  const view = screen?.view || 'list'

  if (view === 'customerDetail') {
    const customer = customers.find(c => c.id === screen.customerId)
    if (!customer) return null
    const quoteCount = quotes.filter(q => q.customerId === customer.id).length
    return (
      <CustomerDetailPage
        customer={customer}
        quoteCount={quoteCount}
        allQuotes={quotes}
        onUpdate={patch => updateCustomer(customer.id, patch)}
        onDelete={() => deleteCustomer(customer.id)}
        onGoBack={goBack}
      />
    )
  }

  if (view === 'quoteDetail') {
    const customer = customers.find(c => c.id === screen.customerId)
    const quote = quotes.find(q => q.id === screen.quoteId)
    if (!customer || !quote) return null
    const linkedJob = quote.linkedJobId ? jobsStore.records.find(p => p.id === quote.linkedJobId && !p.trashedAt) : null
    return (
      <QuoteDetailPage
        customer={customer}
        quote={quote}
        onUpdate={patch => updateRecord(quote.id, patch)}
        linkedJob={linkedJob}
        onOpenJob={linkedJob ? () => {
          const jobCustomer = jobsStore.customers.find(c => c.id === linkedJob.customerId)
          navigate({ hub: 'jobs', view: 'section', customerId: jobCustomer?.id, projectId: linkedJob.id, section: 'general' })
        } : undefined}
        onExport={async () => {
          const base64 = await generateQuoteDocxBase64({ customer, quote })
          const fileName = quoteExportFileName({ customer, quote })
          if (window.desktop) {
            const savedPath = await window.desktop.saveFile(`Quotes/${customer.folder}/${quote.folder}/Files`, fileName, base64)
            // Open it immediately — the file's also sitting in this quote's Files section from now on
            if (savedPath) window.desktop.openFile(savedPath)
          } else {
            const link = document.createElement('a')
            link.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`
            link.download = fileName
            link.click()
          }
        }}
      />
    )
  }

  function addCustomer({ name, code }) {
    hubAddCustomer({ name, code, nextQuoteNum: 1 })
  }
  function renameCustomer(id, name) {
    updateCustomer(id, { name })
  }
  function deleteCustomer(id) {
    updateCustomer(id, { trashedAt: new Date().toISOString() })
    if (expandedCustomerId === id) setExpandedCustomerId(null)
  }
  function addQuote(customerId, { title, notes }) {
    const customer = customers.find(c => c.id === customerId)
    if (!customer) return
    const { quoteNumber, num } = nextQuoteNumber(customer, quotes)
    addRecord(customerId, { quoteNumber, title, notes, approved: false, linkedJobId: null, linkType: null })
    updateCustomer(customerId, { nextQuoteNum: num + 1 })
  }
  // Each selected quote becomes its own scope on a brand new quote — its
  // materials, labor, and other lines carry over intact (fresh ids so they
  // don't collide with the originals), the originals are left untouched.
  async function combineQuotes(selectedQuotes, title) {
    if (selectedQuotes.length < 2 || !title.trim()) return
    const customerId = selectedQuotes[0].customerId
    const customer = customers.find(c => c.id === customerId)
    if (!customer) return
    const { quoteNumber, num } = nextQuoteNumber(customer, quotes)
    const combinedScopes = selectedQuotes.map(q => {
      const nq = normalizeQuote(q)
      const scopeTextParts = (nq.scopes || []).map(sc => sc.scopeText).filter(Boolean)
      return {
        id: uid(),
        name: q.title || q.quoteNumber,
        scopeText: scopeTextParts.join('\n\n'),
        materials: (nq.scopes || []).flatMap(sc => sc.materials || []).map(m => ({ ...m, id: uid() })),
        labor: (nq.scopes || []).flatMap(sc => sc.labor || []).map(l => ({ ...l, id: uid() })),
      }
    })
    const combinedAllowances = selectedQuotes.flatMap(q => (normalizeQuote(q).allowances || []).map(a => ({ ...a, id: uid() })))
    const newQuote = await addRecord(customerId, {
      quoteNumber, title,
      notes: `Combined from: ${selectedQuotes.map(q => q.quoteNumber).join(', ')}`,
      approved: false, linkedJobId: null, linkType: null, scopes: combinedScopes,
      layout: 2, allowances: combinedAllowances, markup: normalizeQuote({}).markup,
    })
    updateCustomer(customerId, { nextQuoteNum: num + 1 })
    if (newQuote) openQuote(customerId, newQuote.id)
  }
  function updateQuote(id, patch) {
    updateRecord(id, patch)
  }
  function deleteQuote(id) {
    // Soft delete — moves to Trash for 30 days. Files on disk untouched until purged.
    updateRecord(id, { trashedAt: new Date().toISOString() })
  }
  function openQuote(customerId, quoteId) {
    navigate({ hub: 'quotes', view: 'quoteDetail', customerId, quoteId })
  }

  const approvedByCustomer = customers
    .filter(c => !c.trashedAt)
    .map(c => ({ customer: c, list: sortByQuoteNumber(quotes.filter(q => q.customerId === c.id && q.approved && !q.invalidated && !q.trashedAt)) }))
    .filter(g => g.list.length > 0)

  const invalidatedByCustomer = customers
    .filter(c => !c.trashedAt)
    .map(c => ({ customer: c, list: sortByQuoteNumber(quotes.filter(q => q.customerId === c.id && q.invalidated && !q.trashedAt)) }))
    .filter(g => g.list.length > 0)

  return (
    <div>
      <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setHubTab('quotes')}
          style={{ flex: 1, padding: '10px 8px', background: 'none', border: 'none', borderBottom: hubTab === 'quotes' ? '2px solid var(--accent)' : '2px solid transparent', color: hubTab === 'quotes' ? 'var(--accent-dim)' : 'var(--text-mid)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          Quotes
        </button>
        <button
          onClick={() => setHubTab('priceRef')}
          style={{ flex: 1, padding: '10px 8px', background: 'none', border: 'none', borderBottom: hubTab === 'priceRef' ? '2px solid var(--accent)' : '2px solid transparent', color: hubTab === 'priceRef' ? 'var(--accent-dim)' : 'var(--text-mid)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          Price Reference
        </button>
      </div>

      {hubTab === 'priceRef' ? (
        <PriceReferenceTab />
      ) : (
        <div>
      {customers.filter(c => !c.trashedAt).length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          No customers yet — add one below.
        </div>
      )}
      {customers.filter(c => !c.trashedAt).map(c => (
        <CustomerBlock
          key={c.id}
          customer={c}
          quotes={sortByQuoteNumber(quotes.filter(q => q.customerId === c.id && !q.approved && !q.invalidated && !q.trashedAt))}
          expanded={expandedCustomerId === c.id}
          onToggle={() => setExpandedCustomerId(id => id === c.id ? null : c.id)}
          onRename={name => renameCustomer(c.id, name)}
          onEdit={() => navigate({ hub: 'quotes', view: 'customerDetail', customerId: c.id })}
          onAddQuote={data => addQuote(c.id, data)}
          onUpdateQuote={updateQuote}
          onDeleteQuote={deleteQuote}
          onOpenQuote={qid => openQuote(c.id, qid)}
          onRequestApprove={handleDotClick}
          onRequestBack={quote => updateQuote(quote.id, { status: 'red' })}
          onCombineQuotes={combineQuotes}
        />
      ))}
      <AddCustomerRow onAdd={addCustomer} />

      {approvedByCustomer.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowApproved(x => !x)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 16px',
              background: 'var(--surface-2)', border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.06em',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 18 18" fill="none" style={{ transform: showApproved ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Approved — moved to Jobs ({approvedByCustomer.reduce((s, g) => s + g.list.length, 0)})
          </button>
          {showApproved && approvedByCustomer.map(({ customer, list }) => (
            <div key={customer.id}>
              <div style={{ padding: '8px 16px 2px', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', background: 'var(--surface-2)' }}>
                {customer.name}
              </div>
              <QuoteColumnHeader indent={0} />
              {list.map(q => (
                <QuoteRow
                  key={q.id}
                  quote={q}
                  indent={0}
                  onUpdate={patch => updateQuote(q.id, patch)}
                  onDelete={() => deleteQuote(q.id)}
                  onOpen={() => openQuote(customer.id, q.id)}
                  onRequestApprove={handleDotClick}
                  onRequestBack={quote => updateQuote(quote.id, { status: 'red' })}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {invalidatedByCustomer.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowInvalidated(x => !x)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 16px',
              background: 'var(--surface-2)', border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.06em',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 18 18" fill="none" style={{ transform: showInvalidated ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M6.5 4L11.5 9L6.5 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Invalidated ({invalidatedByCustomer.reduce((s, g) => s + g.list.length, 0)})
          </button>
          {showInvalidated && invalidatedByCustomer.map(({ customer, list }) => (
            <div key={customer.id} style={{ opacity: 0.75 }}>
              <div style={{ padding: '8px 16px 2px', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', background: 'var(--surface-2)' }}>
                {customer.name}
              </div>
              <QuoteColumnHeader indent={0} />
              {list.map(q => (
                <QuoteRow
                  key={q.id}
                  quote={q}
                  indent={0}
                  onUpdate={patch => updateQuote(q.id, patch)}
                  onDelete={() => deleteQuote(q.id)}
                  onOpen={() => openQuote(customer.id, q.id)}
                  onRequestApprove={handleDotClick}
                  onRequestBack={quote => updateQuote(quote.id, { status: 'red' })}
                />
              ))}
            </div>
          ))}
        </div>
      )}
        </div>
      )}

      {approvalTarget && !approvalTarget.approved && !(approvalTarget.linkedJobId && jobsStore.records.some(p => p.id === approvalTarget.linkedJobId && !p.trashedAt)) && (
        <ApprovalModal
          quote={approvalTarget}
          quoteCustomerName={customers.find(c => c.id === approvalTarget.customerId)?.name || ''}
          quoteCustomer={customers.find(c => c.id === approvalTarget.customerId)}
          jobsStore={jobsStore}
          onClose={() => setApprovalTarget(null)}
          onDone={async (patch) => {
            await updateQuote(approvalTarget.id, patch)
            setApprovalTarget(null)
          }}
        />
      )}
      {approvalTarget && (approvalTarget.approved || (approvalTarget.linkedJobId && jobsStore.records.some(p => p.id === approvalTarget.linkedJobId && !p.trashedAt))) && (
        <SimpleApprovalConfirm
          quote={approvalTarget}
          approving={!approvalTarget.approved}
          linkedJobName={approvalTarget.linkedJobId ? jobsStore.records.find(p => p.id === approvalTarget.linkedJobId)?.name : null}
          onClose={() => setApprovalTarget(null)}
          onConfirm={() => {
            if (approvalTarget.approved) {
              updateQuote(approvalTarget.id, { approved: false, status: 'yellow' })
            } else {
              updateQuote(approvalTarget.id, { approved: true })
            }
            setApprovalTarget(null)
          }}
        />
      )}
    </div>
  )
}
