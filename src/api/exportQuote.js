// Builds a Word (.docx) proposal document from a Quote by filling in the
// person's own real template (src/assets/templates/quote_template.docx) —
// its header, footer, logos, and page setup are untouched; only the content
// tags below get filled in. This is far more reliable than rebuilding the
// layout from scratch, since nothing about the original file's formatting
// is being reconstructed — it's just there.
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import templateUrl from '../assets/templates/quote_template.docx'
import { buildCompleteDraft, finalLineFor, splitLines, defaultGeneral } from './quoteMath.js'

function ordinal(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}
function formatRevisionDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date()
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  return `${month} ${ordinal(d.getDate())}, ${d.getFullYear()}`
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const base64 = dataUrl.slice(comma + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getTemplateBytes() {
  // Bundled below Vite's assetsInlineLimit, so this is a data: URL — no
  // network/file access needed at export time (that's what broke it before).
  if (templateUrl.startsWith('data:')) return dataUrlToBytes(templateUrl)
  const res = await fetch(templateUrl)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

// What goes into the template is the quote's "Complete Quote" draft (built
// from the Pricing tab and then edited by hand). A quote that has never had
// its draft opened gets a fresh one built on the spot, so Export always works.
export async function buildQuoteDocxBuffer({ customer, quote }) {
  const draft = quote.completeQuote || buildCompleteDraft(quote, customer.name)
  const blocks = draft.blocks || []
  const revisionLog = quote.revisionLog || []
  const lastRevisionDate = revisionLog.length > 0 ? revisionLog[revisionLog.length - 1].date : null
  // "General" quotes print one overview of the work, a line naming the
  // allowances included (no amounts), and the total price.
  const general = draft.detail === 'general'
  const noteLines = splitLines(draft.notesText)
  const adjustmentLines = general ? [] : splitLines(draft.adjustmentsText)
  const referencePricingLines = general ? [] : splitLines(draft.referenceText)
  const gen = { ...defaultGeneral(quote), ...(draft.general || {}) }
  const includedLines = general ? splitLines(gen.allowText) : []
  const priceLine = (draft.finalLine || '').trim() || finalLineFor(quote, customer.name)

  const data = {
    title: quote.title || customer.name,
    quoteNumber: quote.quoteNumber || '',
    revision: quote.revision || 0,
    revisionDate: formatRevisionDate(lastRevisionDate),
    basedOn: (draft.basedOn || '').trim(),
    hasNotes: noteLines.length > 0,
    noteLines,
    scopes: general
      // General: one overview of all the work covered by the price.
      ? [{ showName: false, scopeNameLine: '', scopeLines: splitLines(gen.scopeText), costLines: includedLines.length ? [`Includes allowances for: ${includedLines.join(', ')}`] : [], scopeTotalLine: '' }]
      : blocks.map((b, i) => ({
        showName: !!draft.showHeadings,
        scopeNameLine: `${(b.heading || '').trim() || `Scope ${i + 1}`}:`,
        scopeLines: splitLines(b.scopeText),
        costLines: splitLines(b.costText),
        scopeTotalLine: (b.totalLine || '').trim(),
      })),
    hasAdjustments: adjustmentLines.length > 0,
    adjustmentLines,
    finalLine: priceLine,
    hasReferencePricing: referencePricingLines.length > 0,
    referencePricingLines,
  }

  const templateBytes = await getTemplateBytes()
  const zip = new PizZip(templateBytes)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  try {
    doc.render(data)
  } catch (err) {
    const details = err.properties?.errors?.map(e => e.properties?.explanation).filter(Boolean).join('; ')
    throw new Error(details || err.message || 'Could not fill in the quote template.')
  }

  return doc.getZip().generate({ type: 'uint8array' })
}

// Returns a base64 string of the generated .docx
export async function generateQuoteDocxBase64({ customer, quote }) {
  const bytes = await buildQuoteDocxBuffer({ customer, quote })
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function quoteExportFileName({ customer, quote }) {
  const safe = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
  return `${safe(quote.quoteNumber)} - ${safe(quote.title || customer.name)}.docx`
}
