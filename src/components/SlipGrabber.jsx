import { useEffect, useRef, useState } from 'react'
import { normalizeLines } from '../api/units.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { parseOrderPdf } from '../pages/Materials.jsx'
import { useApiKey } from '../api/ai.js'

// Runs quietly in the background (mounted once by App) so slips are grabbed
// and read before you open Materials:
//  • phone slip photos (pulled by the background phone sync) are read by AI
//    one at a time and wait under Materials → Slips → "to confirm"
//  • wholesaler invoices / packing slips the morning email run read from your
//    email (Field App/slips.json) are queued the same way, already read
// Nothing is added to orders, jobs, Stock or the Catalog until you confirm.

function uid() { return Math.random().toString(36).slice(2, 10) }
const mediaTypeOf = name => {
  const ext = String(name || '').split('.').pop().toLowerCase()
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
}

// slips.json item → the app's parsed-slip shape
export function emailSlipToParsed(it) {
  return {
    wholesaler: it.supplier || '', invoiceNumber: it.invoiceNumber || '', poNumber: it.poNumber || '', orderDate: it.date || '',
    subtotal: it.subtotal ?? '', tax: it.tax ?? '', invoiceTotal: it.total ?? '', docType: it.kind || '',
    lineItems: normalizeLines((it.lines || []).map(l => ({
      partNo: l.partNo || '', name: l.desc || '', uom: (l.uom || '').toUpperCase(), qty: Number(l.qty) || 0,
      cost: l.unit != null ? Number(l.unit) : (l.qty ? Math.round((Number(l.ext) / Number(l.qty)) * 10000) / 10000 : Number(l.ext) || 0),
      totalPrice: Number(l.ext) || 0, backordered: !!l.backordered,
    }))),
  }
}

export default function SlipGrabber() {
  const [pending, setPending] = useLocalStore('materials_pending_slips', [])
  const [orders] = useLocalStore('material_orders', [])
  const [seen, setSeen] = useLocalStore('materials_email_slips_seen', [])
  const [apiKey] = useApiKey()
  const busy = useRef(false)
  const [tick, setTick] = useState(0)

  // Read waiting phone slips, one at a time
  useEffect(() => {
    if (!apiKey || !window.desktop || busy.current) return
    const next = pending.find(s => !s.parsed && !s.parseError && s.filePath)
    if (!next) return
    busy.current = true
    ;(async () => {
      try {
        const base64 = await window.desktop.readFileBytes(next.filePath)
        const parsed = await parseOrderPdf(base64, apiKey, mediaTypeOf(next.fileName))
        setPending(list => list.map(s => s.id === next.id ? { ...s, parsed, parsedAt: new Date().toISOString() } : s))
      } catch (e) {
        setPending(list => list.map(s => s.id === next.id ? { ...s, parseError: String(e?.message || e).slice(0, 140) } : s))
      } finally {
        busy.current = false
        setTick(t => t + 1)
      }
    })()
  }, [pending, apiKey, tick])

  // Pick up invoices / packing slips read from email by the morning run
  useEffect(() => {
    if (!window.desktop?.ordersLoadSlipsFeed) return
    let stop = false
    async function load() {
      const r = await window.desktop.ordersLoadSlipsFeed().catch(() => null)
      if (stop || !r?.ok || !Array.isArray(r.feed?.slips)) return
      const seenSet = new Set(seen)
      const have = new Set(orders.map(o => `${String(o.wholesaler || '').toLowerCase()}::${String(o.invoiceNumber || '').toLowerCase()}`))
      const fresh = r.feed.slips.filter(it => it && it.id && !seenSet.has(it.id)
        && !have.has(`${String(it.supplier || '').toLowerCase()}::${String(it.invoiceNumber || '').toLowerCase()}`))
      if (!fresh.length) return
      setPending(list => [...list, ...fresh.filter(it => !list.some(p => p.feedId === it.id)).map(it => ({
        id: uid(), feedId: it.id, source: 'email', kindHint: it.kind === 'quote' ? 'pricing' : 'order',
        fileName: it.fileName || `${it.supplier || 'Supplier'} ${it.invoiceNumber || ''}`.trim(),
        webLink: it.webLink || '', parsed: emailSlipToParsed(it), pulledAt: new Date().toISOString(),
      }))])
      setSeen(list => [...list, ...fresh.map(it => it.id)].slice(-500))
    }
    load()
    const t = setInterval(load, 10 * 60000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { stop = true; clearInterval(t); window.removeEventListener('focus', onFocus) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen.length, orders.length])

  return null
}
