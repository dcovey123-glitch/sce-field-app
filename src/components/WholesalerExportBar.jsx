import React, { useState } from 'react'

// Three export actions sharing the same underlying PDF + Outlook-draft
// machinery — "Export to Nedco" / "Export to Gescan" pre-address and attach
// automatically, "PDF Export" just produces the file for emailing manually
// to anyone else. Only ever acts on whatever items the caller passes in —
// this component doesn't know or care about selection itself.
import { saveSentRequest, catalogPriceFor } from '../api/requests.js'

// quote        — sent from a quote: the request is a pricing request attached to it
// confirmToSend — the order list: exporting doesn't log anything; "✓ Confirm sent"
//                 logs it as 📨 Sent and onSent() clears the list
export default function WholesalerExportBar({ items, wholesaler, date, subjectPrefix, saveFolder, emptyMessage, jobs = [], quote = null, confirmToSend = false, onSent }) {
  const [lastExport, setLastExport] = useState(null) // { to, file, pricing } — waiting for "Confirm sent"
  const [phoneTo, setPhoneTo] = useState('')
  const [catFrom, setCatFrom] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // Keep what was sent, so the quote can be matched to it when it comes back
  function record(to, file, pricing, phoned, fromCatalog) {
    saveSentRequest({
      wholesaler: to, subject: subjectPrefix || '', file, pricing: !!pricing || !!quote, phoned: !!phoned, ...(fromCatalog ? { fromCatalog: true } : {}),
      ...(quote ? { quote: { id: quote.id || '', number: quote.number || '', title: quote.title || '' } } : {}),
      items: (items || []).map(i => ({ qty: i.qty ?? '', uom: i.uom || '', partNo: i.partNo || '', desc: i.desc || i.nickname || '',
        ...(fromCatalog ? { price: catalogPriceFor(i) } : {}), ...(i.planRefs ? { planRefs: i.planRefs } : {}) })),
      jobs: (jobs || []).filter(j => j && j.name).map(j => ({ id: j.id || '', name: j.name })),
    })
  }

  async function doExport(wholesalerKey) {
    if (!items || items.length === 0) {
      setError(emptyMessage || 'Check at least one item first.')
      return
    }
    setBusy(wholesalerKey || 'pdf')
    setError('')
    setNote('')
    try {
      const { buildOrderFormPdfBytes, orderFormFileName, WHOLESALERS } = await import('../api/exportOrderForm.js')
      const targetName = wholesalerKey ? WHOLESALERS[wholesalerKey].name : (wholesaler || '')
      const bytes = await buildOrderFormPdfBytes({ wholesaler: targetName, date, items })
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      const fileName = orderFormFileName({ wholesaler: targetName || 'Materials', date })

      if (window.desktop) {
        const savedPath = await window.desktop.saveFile(saveFolder, fileName, base64)
        if (wholesalerKey) {
          const ws = WHOLESALERS[wholesalerKey]
          const pricing = /pricing/i.test(subjectPrefix || '')
          const n = (items || []).length
          const text = [
            `Hi ${ws.contact || 'there'},`,
            '',
            pricing
              ? `Could you please price the attached list (${n} item${n === 1 ? '' : 's'}) and send me a quote? Please note any lead times or substitutions.`
              : `Please see the attached material order (${n} item${n === 1 ? '' : 's'}). Let me know on availability, and when it's ready for pick-up.`,
          ].join('\n') // no sign-off — Outlook adds the signature
          const result = await window.desktop.draftEmail({ to: ws.email, subject: subjectPrefix, text, attachments: [savedPath] })
          if (!result.ok) setError(result.error)
          else {
            const how = result.method === 'eml'
              ? `Email to ${ws.contact || ws.name} is ready in Outlook with the PDF attached — check it and press Send.`
              : `Compose window opened, and the PDF is highlighted in your file explorer — drag it into the email to attach it.`
            if (confirmToSend) {
              setLastExport({ to: ws.name, file: savedPath, pricing })
              setNote(how + ' Once it\'s sent, press ✓ Confirm sent.')
            } else {
              record(ws.name, savedPath, pricing)
              setNote(how + (quote || pricing
                ? ` It's in Materials → Orders & Slips → 💲 Pricing, attached to ${quote ? 'quote ' + (quote.number || quote.title) : 'this request'}.`
                : ` It's in Materials → Orders & Slips as 📨 Sent, to match to the quote when it comes back.`))
            }
          }
        } else {
          await window.desktop.openFile(savedPath)
          if (confirmToSend) {
            setLastExport({ to: wholesaler || '', file: savedPath, pricing: /pricing/i.test(subjectPrefix || '') })
            setNote('Saved. Once you\'ve sent it, press ✓ Confirm sent.')
          } else {
            record(wholesaler || '', savedPath, /pricing/i.test(subjectPrefix || ''))
            setNote(`Saved. It's in Materials → Orders & Slips${quote ? ' → 💲 Pricing' : ' as 📨 Sent'}, to match to the quote when it comes back (remove it there if you didn't send it).`)
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Could not generate the PDF.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => doExport('nedco')} disabled={!!busy}
          style={{ flex: '1 1 140px', padding: 10, borderRadius: 'var(--rs)', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: '#e8f2fc', color: '#1a5fa0' }}
        >
          {busy === 'nedco' ? 'Working…' : 'Export to Nedco'}
        </button>
        <button
          onClick={() => doExport('gescan')} disabled={!!busy}
          style={{ flex: '1 1 140px', padding: 10, borderRadius: 'var(--rs)', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: '#e8f2fc', color: '#1a5fa0' }}
        >
          {busy === 'gescan' ? 'Working…' : 'Export to Gescan'}
        </button>
        <button
          onClick={() => doExport(null)} disabled={!!busy}
          style={{ flex: '1 1 140px', padding: 10, borderRadius: 'var(--rs)', border: '1px solid var(--border)', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text-mid)' }}
        >
          {busy === 'pdf' ? 'Working…' : 'PDF Export'}
        </button>
      </div>
      {confirmToSend && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, padding: '8px 10px', borderRadius: 8, background: lastExport ? '#eef8f1' : 'var(--surface-2)', border: '1px solid ' + (lastExport ? '#9fd3ae' : 'var(--border)'), flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--text-mid)' }}>
            {lastExport
              ? <>Sent it{lastExport.to ? ' to ' + lastExport.to : ''}? Confirm and it moves to <b>📨 Sent Request</b> in Orders &amp; Slips, and this list clears for the next order.</>
              : <>Sent this list some other way? Confirm it to move it to <b>📨 Sent Request</b> and clear the list.</>}
          </span>
          <button disabled={!(items || []).length}
            onClick={() => {
              const to = (lastExport && lastExport.to) || wholesaler || ''
              record(to, (lastExport && lastExport.file) || '', lastExport ? lastExport.pricing : /pricing/i.test(subjectPrefix || ''))
              setLastExport(null); setError('')
              setNote(`✓ Moved to 📨 Sent Request${to ? ' (' + to + ')' : ''} — match the quote there when it comes back. The list is cleared.`)
              onSent && onSent()
            }}
            style={{ fontSize: 13, fontWeight: 800, padding: '7px 16px', borderRadius: 6, border: 'none', background: (items || []).length ? '#1e7a34' : 'var(--border)', color: '#fff', cursor: (items || []).length ? 'pointer' : 'default' }}>
            ✓ Confirm sent
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>📞 Phoned it in instead?</span>
        <select value={phoneTo} onChange={e => setPhoneTo(e.target.value)} style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <option value="">Supplier…</option>
          {['Nedco', 'Gescan', 'Westburne', 'Wesco', 'Red Deer Fasteners', ...(wholesaler && !['Nedco', 'Gescan', 'Westburne', 'Wesco', 'Red Deer Fasteners'].includes(wholesaler) ? [wholesaler] : [])].map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <button disabled={!phoneTo || !(items || []).length} onClick={() => {
            record(phoneTo, '', /pricing/i.test(subjectPrefix || ''), true)
            setNote(`Logged as phoned in to ${phoneTo}. It's in Materials → Orders & Slips as 📨 Sent, to match to the quote when it comes back.${confirmToSend ? ' The list is cleared for the next order.' : ''}`); setPhoneTo('')
            if (confirmToSend) { setLastExport(null); onSent && onSent() }
          }}
          style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--navy)', background: 'var(--surface)', color: 'var(--navy)', cursor: !phoneTo ? 'default' : 'pointer', opacity: !phoneTo || !(items || []).length ? 0.5 : 1 }}>
          📞 Log phoned-in order
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>📒 Quoted it yourself from our Catalog?</span>
        <select value={catFrom} onChange={e => setCatFrom(e.target.value)} title="Who it'll be bought from (if you know)" style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <option value="">Buying from… (optional)</option>
          {['Nedco', 'Gescan', 'Westburne', 'Wesco', 'Red Deer Fasteners'].map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <button disabled={!(items || []).length} onClick={() => {
            const missing = (items || []).filter(i => !catalogPriceFor(i)).length
            record(catFrom, '', false, false, true)
            if (confirmToSend) { setLastExport(null); onSent && onSent() }
            setNote(`Logged as a quote from our Catalog${catFrom ? ' (buying from ' + catFrom + ')' : ''}. It's in Materials → Orders & Slips under ⏳ Waiting for PO — add the PO there when you have it, and the packing slips file under it.${missing ? ` ${missing} item${missing === 1 ? ' has' : 's have'} no Catalog price.` : ''}`); setCatFrom('')
          }}
          style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: '1px solid #1e7a34', background: 'var(--surface)', color: '#1e7a34', cursor: (items || []).length ? 'pointer' : 'default', opacity: (items || []).length ? 1 : 0.5 }}>
          📒 Log Catalog quote
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
      {note && <div style={{ fontSize: 11, color: '#1a5fa0', marginTop: 6 }}>{note}</div>}
    </div>
  )
}
