import React, { useEffect, useState } from 'react'
import { findProposal } from '../api/proposal.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { QUOTE_CONTACTS_KEY, quoteEmailSubject, quoteEmailBody, isEmail, rememberContact } from '../api/quoteEmail.js'
import { todayLocal } from '../api/albertaTime.js'
import { fmtDate } from '../api/format.js'

// "✉ Email to…" — drafts the standard quote email in Outlook with the
// proposal PDF attached. Shown only when the quote has a proposal saved.
export default function EmailQuoteButton({ customerId, customerFolder, quote, total, onUpdate }) {
  const [file, setFile] = useState(null)
  const [open, setOpen] = useState(false)
  const [book, setBook] = useLocalStore(QUOTE_CONTACTS_KEY, {})
  const saved = (book && book[customerId]) || []
  const [to, setTo] = useState('')
  const [name, setName] = useState('')
  const [withTotal, setWithTotal] = useState(true)
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // { ok, text }
  const qFolder = quote && quote.folder
  const qTitle = quote && quote.title

  useEffect(() => {
    let live = true
    findProposal(customerFolder, { folder: qFolder, title: qTitle }).then(f => { if (live) setFile(f) })
    return () => { live = false }
  }, [customerFolder, qFolder, qTitle])

  // the wording follows the fields until you type in it yourself
  useEffect(() => {
    if (!edited) setBody(quoteEmailBody({ quote, name, total, includeTotal: withTotal }))
  }, [quote, name, total, withTotal, edited])

  if (!file || !window.desktop?.draftEmail) return null

  function openPanel() {
    const last = saved[0]
    setTo(last ? last.email : ''); setName(last ? last.name : '')
    setEdited(false); setDone(null); setOpen(true)
  }
  function pickTo(v) {
    setTo(v)
    const known = saved.find(c => c.email.toLowerCase() === v.trim().toLowerCase())
    if (known) setName(known.name)
  }
  async function send() {
    setBusy(true); setDone(null)
    try {
      const r = await window.desktop.draftEmail({ to: to.trim(), subject: quoteEmailSubject(quote), text: body, attachments: [file.path] })
      if (!r || !r.ok) throw new Error((r && r.error) || 'Outlook didn\'t open')
      setBook(b => rememberContact(b, customerId, to, name))
      setDone(r.method === 'eml'
        ? { ok: true, text: `Draft opened in Outlook with ${file.name} attached — check it over and hit Send.` }
        : { ok: true, text: `Outlook opened without the attachment — drag in ${file.name} (its folder is open).` })
    } catch (err) {
      setDone({ ok: false, text: `Couldn't open Outlook: ${err.message || err}` })
    } finally { setBusy(false) }
  }
  const today = todayLocal()
  const valid = isEmail(to)

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={e => { e.stopPropagation(); open ? setOpen(false) : openPanel() }} title={`Email ${file.name} to the customer`}
        style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 20, border: '1px solid #1e7a34', background: '#eef8f1', color: '#1e7a34', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        ✉ Email to…
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 40, width: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.16)', padding: 14, textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Email this quote</div>
          <label style={lbl}>To</label>
          <input autoFocus list={`qe-${customerId}`} value={to} onChange={e => pickTo(e.target.value)} placeholder="name@company.com" style={inp(valid || !to)} />
          <datalist id={`qe-${customerId}`}>{saved.map(c => <option key={c.email} value={c.email}>{c.name}</option>)}</datalist>
          <label style={lbl}>Their name (for "Hi …")</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="optional" style={inp(true)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '8px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={withTotal} onChange={e => setWithTotal(e.target.checked)} /> Put the total in the email
          </label>
          <div style={{ fontSize: 11.5, color: 'var(--text-light)', margin: '6px 0 3px' }}>
            Subject: <b style={{ color: 'var(--text)' }}>{quoteEmailSubject(quote)}</b> · 📎 {file.name}
          </div>
          <textarea value={body} onChange={e => { setBody(e.target.value); setEdited(true) }} rows={8}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, fontFamily: 'var(--font)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, resize: 'vertical' }} />
          {edited && <button onClick={() => setEdited(false)} style={{ ...link, marginTop: 2 }}>↺ Back to the standard wording</button>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button disabled={!valid || busy} onClick={send}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', background: valid ? 'var(--accent)' : 'var(--border)', color: 'var(--navy)', fontWeight: 800, fontSize: 12.5, cursor: valid ? 'pointer' : 'default' }}>
              {busy ? 'Opening…' : 'Open in Outlook'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, cursor: 'pointer' }}>Close</button>
          </div>
          {done && (
            <div style={{ marginTop: 10, fontSize: 12, padding: '7px 10px', borderRadius: 6, background: done.ok ? '#eef8f1' : '#fdeeee', color: done.ok ? '#1e7a34' : '#a12a1e' }}>
              {done.text}
              {done.ok && quote.sentDate !== today && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => { onUpdate({ sentDate: today }); setOpen(false) }} style={{ ...link, fontWeight: 700, color: '#1e7a34' }}>
                    ✓ Sent it — set the Sent date to today{quote.sentDate ? ` (was ${fmtDate(quote.sentDate, 'medium')})` : ''}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', margin: '6px 0 3px' }
const inp = ok => ({ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 9px', border: `1px solid ${ok ? 'var(--border)' : '#d9534f'}`, borderRadius: 6, fontFamily: 'var(--font)' })
const link = { border: 'none', background: 'none', padding: 0, fontSize: 11.5, color: '#1a5fa0', cursor: 'pointer' }
