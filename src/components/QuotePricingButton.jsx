import React, { useState } from 'react'
import { useLocalStore } from '../api/useLocalStore.js'
import { useOrdersFeed } from '../api/orders.js'
import { pricingSourcesFor, sourceRef } from '../api/quoteCompare.js'
import { fmtDate } from '../api/format.js'
import QuoteCompare from './QuoteCompare.jsx'

// "💲 Pricing" on a quote — every wholesaler pricing quote filed for it, to
// open or compare against the quote's material whenever you have time.
export default function QuotePricingButton({ quote, onUpdate }) {
  const [orders] = useLocalStore('material_orders', [])
  const feedRows = useOrdersFeed()
  const [open, setOpen] = useState(false)
  const [comparing, setComparing] = useState(null)
  const [msg, setMsg] = useState('')
  const list = pricingSourcesFor(quote, { orders: Array.isArray(orders) ? orders : [], feedRows: feedRows || [] })
  const n = list.length

  const openPdf = async s => {
    setMsg('')
    if (s.slipPath && window.desktop?.openFile) { window.desktop.openFile(s.slipPath); return }
    if (s.number && window.desktop?.ordersOpenQuoteFile) {
      const r = await window.desktop.ordersOpenQuoteFile(s.number)
      if (r && r.ok) return
    }
    setMsg(`The PDF for ${s.label} isn't saved in Quote Slips yet — use "Search email for the PDF" on it in Materials.`)
  }
  const btn = { padding: '8px 12px', borderRadius: 'var(--rs)', border: '1px solid #1e7a34', background: n ? '#eef8f1' : 'var(--surface)', color: '#1e7a34', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
  const link = { fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 5, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }

  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} onClick={() => setOpen(o => !o)} title="Wholesaler pricing quotes for this quote — open them or compare prices">💲 Pricing{n ? ` (${n})` : ''}</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, width: 440, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <b style={{ fontSize: 13, flex: 1 }}>Pricing quotes for {quote.quoteNumber || 'this quote'}</b>
            <button onClick={() => setOpen(false)} style={{ ...link, border: 'none' }}>✕</button>
          </div>
          {!n && <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>None filed yet. When a wholesaler's quote comes in, file it as a Pricing quote for this quote in Materials (or match it to its request) and it shows up here.</div>}
          {list.map(s => (
            <div key={s.kind + s.id} style={{ borderTop: '1px solid var(--border)', padding: '6px 0', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{s.label}</b> <span style={{ color: 'var(--text-light)' }}>{s.date ? fmtDate(s.date) : ''} · {s.lines.length} line{s.lines.length === 1 ? '' : 's'}</span>
                </div>
                <button style={link} onClick={() => openPdf(s)}>📄 PDF</button>
                <button style={{ ...link, borderColor: '#1e7a34', color: '#1e7a34' }} disabled={!s.lines.length} title={s.lines.length ? 'Compare these prices to your quote' : 'No priced lines read in yet'} onClick={() => { setComparing(s); setOpen(false) }}>⚖ Compare</button>
              </div>
              <div style={{ fontSize: 11, color: s.compared ? '#1e7a34' : '#b45309', marginTop: 2 }}>
                {s.compared ? `✓ Priced from this ${fmtDate(s.compared.at)} — ${s.compared.updated || 0} updated, ${s.compared.added || 0} added` : 'Not compared yet'}
              </div>
            </div>
          ))}
          {msg && <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>{msg}</div>}
        </div>
      )}
      {comparing && (
        <QuoteCompare
          lines={comparing.lines} quote={quote} sourceLabel={comparing.label} source={sourceRef(comparing)}
          onClose={() => setComparing(null)}
          onApply={async fn => { await onUpdate(fn); setComparing(null) }}
        />
      )}
    </div>
  )
}
