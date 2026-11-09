// Builds a branded "Material Order" PDF to send to a wholesaler — logo,
// date, and a simple table of what's needed. Uses pdf-lib directly (no
// template file needed, unlike the Quote export) since this is a much
// simpler, single-purpose document.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import logoUrl from '../assets/logo_sce_new.jpg'

// Wholesaler order-desk contacts — used when exporting straight to them
export const WHOLESALERS = {
  nedco: { name: 'Nedco', email: 'justin.engbers@nedco.ca', contact: 'Justin' },
  gescan: { name: 'Gescan', email: 'yvonne.hussynec@gescan.com', contact: 'Yvonne' },
}

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 40

async function fetchLogoBytes() {
  if (logoUrl.startsWith('data:')) {
    const comma = logoUrl.indexOf(',')
    const base64 = logoUrl.slice(comma + 1)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  const res = await fetch(logoUrl)
  return new Uint8Array(await res.arrayBuffer())
}

// Simple word-wrap so long descriptions don't run off the page or overlap
// the next column.
function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''

  function flush() {
    if (line) { lines.push(line); line = '' }
  }

  words.forEach(word => {
    // A single word with no spaces (a long part number, for instance) can
    // still be wider than the whole column on its own — normal word-wrap
    // only breaks between words, so this needs its own character-level
    // fallback or it just overflows past the column with nowhere to break.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      flush()
      let chunk = ''
      for (const ch of word) {
        const trial = chunk + ch
        if (font.widthOfTextAtSize(trial, size) > maxWidth && chunk) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = trial
        }
      }
      line = chunk
      return
    }
    const trial = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = trial
    }
  })
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

// rfq: { number, title } — a pricing request sent from one of our quotes.
// The PDF then reads "Request for Quote" with our quote number, so it's
// clearly a request for pricing, not an order.
export function orderFormHeading(rfq) {
  if (!rfq) return { title: 'Material Order', ref: '', ask: '' }
  const ref = [rfq.number, rfq.title].filter(Boolean).join(' — ')
  return {
    title: 'Request for Quote',
    ref: ref ? `Our quote: ${ref}` : '',
    ask: `Please quote pricing and availability for the items below${rfq.number ? ` and reference our quote ${rfq.number} on your quote` : ''}. This is not an order.`,
  }
}

export async function buildOrderFormPdfBytes({ wholesaler, date, items, rfq = null }) {
  const head = orderFormHeading(rfq)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logoBytes = await fetchLogoBytes()
  const logoImage = await doc.embedJpg(logoBytes)
  const logoDims = logoImage.scale(Math.min(1, 90 / logoImage.width))

  const cols = { qty: MARGIN, uom: MARGIN + 34, partNo: MARGIN + 68, desc: MARGIN + 158, nickname: MARGIN + 360 }
  const colWidth = { qty: cols.uom - cols.qty, uom: cols.partNo - cols.uom, partNo: cols.desc - cols.partNo, desc: cols.nickname - cols.desc, nickname: (PAGE_W - MARGIN) - cols.nickname }
  const padding = 6 // inner padding so wrapped text never touches a divider line
  const tableRight = PAGE_W - MARGIN

  let page = null
  let y = 0
  let tableTop = 0

  function drawColumnDividers(fromY, toY) {
    // A vertical line at the start of every column after the first, plus the table's outer edges
    const dividerXs = [MARGIN, cols.uom, cols.partNo, cols.desc, cols.nickname, tableRight]
    dividerXs.forEach(x => {
      page.drawLine({ start: { x, y: fromY }, end: { x, y: toY }, thickness: 0.75, color: rgb(0.82, 0.82, 0.82) })
    })
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN

    page.drawImage(logoImage, { x: MARGIN, y: y - logoDims.height, width: logoDims.width, height: logoDims.height })
    page.drawText('SCE Electric Western Canada Ltd.', { x: MARGIN + logoDims.width + 16, y: y - 16, size: 13, font: fontBold })
    if (rfq) {
      page.drawText(head.title.toUpperCase(), { x: MARGIN + logoDims.width + 16, y: y - 36, size: 15, font: fontBold, color: rgb(0.62, 0.36, 0.02) })
    } else {
      page.drawText(head.title, { x: MARGIN + logoDims.width + 16, y: y - 34, size: 11, font, color: rgb(0.35, 0.35, 0.35) })
    }
    y -= (logoDims.height + 20)

    page.drawText(`Date: ${date}`, { x: MARGIN, y, size: 10, font })
    if (wholesaler) {
      page.drawText(`To: ${wholesaler}`, { x: MARGIN + 200, y, size: 10, font })
    }
    y -= 24
    if (rfq) {
      if (head.ref) {
        wrapText(head.ref, fontBold, 11, PAGE_W - MARGIN * 2).forEach(line => { page.drawText(line, { x: MARGIN, y, size: 11, font: fontBold }); y -= 14 })
      }
      wrapText(head.ask, font, 9.5, PAGE_W - MARGIN * 2).forEach(line => { page.drawText(line, { x: MARGIN, y, size: 9.5, font, color: rgb(0.3, 0.3, 0.3) }); y -= 12 })
      y -= 12
    }

    // Header row background band, then labels, each inset from its column's divider
    const headerTop = y + 5
    page.drawRectangle({ x: MARGIN, y: y - 9, width: tableRight - MARGIN, height: 18, color: rgb(0.93, 0.93, 0.93) })
    page.drawText('Qty', { x: cols.qty + padding, y, size: 9, font: fontBold })
    page.drawText('UOM', { x: cols.uom + padding, y, size: 9, font: fontBold })
    page.drawText('Part No', { x: cols.partNo + padding, y, size: 9, font: fontBold })
    page.drawText('Description', { x: cols.desc + padding, y, size: 9, font: fontBold })
    page.drawText('Nickname', { x: cols.nickname + padding, y, size: 9, font: fontBold })
    y -= 12
    drawColumnDividers(headerTop, y)
    page.drawLine({ start: { x: MARGIN, y }, end: { x: tableRight, y }, thickness: 1, color: rgb(0.5, 0.5, 0.5) })
    y -= 8 // breathing room before the first row's text, matching the row-to-row gap
    tableTop = y + 8
  }

  newPage()

  items.forEach(item => {
    const qtyLines = wrapText(item.qty ?? '', font, 9, colWidth.qty - padding * 2)
    const uomLines = wrapText(item.uom || '—', font, 9, colWidth.uom - padding * 2)
    const partNoLines = wrapText(item.partNo || '—', font, 9, colWidth.partNo - padding * 2)
    const descLines = wrapText(item.desc, font, 9, colWidth.desc - padding * 2)
    const nickLines = wrapText(item.nickname, font, 9, colWidth.nickname - padding * 2)
    const rowLines = Math.max(qtyLines.length, uomLines.length, partNoLines.length, descLines.length, nickLines.length, 1)
    const rowHeight = rowLines * 12 + 8

    if (y - rowHeight < MARGIN) {
      // Close out the dividers for this page's rows before starting a new one
      drawColumnDividers(tableTop, y + 8)
      newPage()
    }

    qtyLines.forEach((line, i) => page.drawText(line, { x: cols.qty + padding, y: y - i * 12, size: 9, font }))
    uomLines.forEach((line, i) => page.drawText(line, { x: cols.uom + padding, y: y - i * 12, size: 9, font }))
    partNoLines.forEach((line, i) => page.drawText(line, { x: cols.partNo + padding, y: y - i * 12, size: 9, font }))
    descLines.forEach((line, i) => page.drawText(line, { x: cols.desc + padding, y: y - i * 12, size: 9, font }))
    nickLines.forEach((line, i) => page.drawText(line, { x: cols.nickname + padding, y: y - i * 12, size: 9, font, color: rgb(0.4, 0.3, 0) }))

    y -= rowHeight
    // Centered in the gap between this row's text and the next row's text
    // (roughly 12px down from y here — see the row-height/line-height math
    // this is derived from — not an arbitrary number)
    page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: tableRight, y: y + 12 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  })

  if (page) drawColumnDividers(tableTop, y + 8)

  return doc.save()
}

export function orderFormFileName({ wholesaler, date, rfq = null }) {
  const safe = (s) => String(s || '').replace(/[<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '')
  const kind = rfq ? `Request for Quote${rfq.number ? ` - ${safe(rfq.number)}` : ''}` : 'Material Order'
  return `${date} - ${kind}${wholesaler ? ` - ${safe(wholesaler)}` : ''}.pdf`
}
