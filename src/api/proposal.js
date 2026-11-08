// The quote proposal PDF you saved in a quote's Files ("SCE Electric - Name.pdf").
// Best pick: a PDF named "SCE Electric - …" (the one with the quote's title in
// it, if there are several); otherwise the only PDF in there.
export const quoteFilesFolder = (customerFolder, quote) =>
  customerFolder && quote && quote.folder ? `Quotes/${customerFolder}/${quote.folder}/Files` : ''

const lc = s => String(s || '').toLowerCase()
export function pickProposal(files, quote) {
  const pdfs = (files || []).filter(f => /\.pdf$/i.test(f.name))
  const sce = pdfs.filter(f => /^sce\s*electric\s*-/i.test(f.name))
  const pool = sce.length ? sce : pdfs.length === 1 ? pdfs : []
  if (!pool.length) return null
  const t = lc(quote && quote.title).replace(/[^a-z0-9]/g, '')
  const byTitle = t ? pool.find(f => lc(f.name).replace(/[^a-z0-9]/g, '').includes(t)) : null
  return byTitle || pool[pool.length - 1]
}

export async function findProposal(customerFolder, quote) {
  const folder = quoteFilesFolder(customerFolder, quote)
  if (!folder || !window.desktop?.listFiles) return null
  try { return pickProposal(await window.desktop.listFiles(folder), quote) } catch { return null }
}
