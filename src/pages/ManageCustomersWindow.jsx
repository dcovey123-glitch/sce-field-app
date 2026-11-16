import React, { useState } from 'react'
import { linkedQuotesCustomer, sharedKey, useSharedCustomerLinks, linkCheck } from '../api/sharedCustomer.js'
import { addCustomerPair, renameCustomerPair, trashCustomerPair, createPartner, pairCustomers, mergeCustomerData, sleepBlockers, setCustomerPairAsleep } from '../api/customers.js'
import { effectiveLifecycleStatus } from './Jobs.jsx'
import { unbilledAmount } from '../api/billing.js'
import { useHubStore } from '../api/useHubStore.js'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'

// Popup window for housekeeping on the customer list: add, rename, remove,
// move jobs/quotes to another customer, merge two customers into one.
// Jobs and Quotes keep separate customer records tied by the link ID, so every
// operation here applies to both sides together (api/customers.js).

const norm = s => (s || '').trim().toLowerCase()
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true })

const btn = (extra = {}) => ({
  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', ...extra,
})
const primaryBtn = (disabled) => btn({ background: disabled ? 'var(--surface-2)' : 'var(--navy)', color: disabled ? 'var(--text-light)' : '#fff', border: 'none', cursor: disabled ? 'default' : 'pointer' })
const DETAIL_FIELDS = [
  { section: 'Contact' },
  { key: 'contactName', label: 'Contact name' },
  { key: 'contactTitle', label: 'Title / role' },
  { key: 'phone', label: 'Phone' },
  { key: 'altPhone', label: 'Alt. / cell phone' },
  { key: 'email', label: 'Email' },
  { section: 'Address (office / main site)' },
  { key: 'address', label: 'Street address', wide: true },
  { key: 'city', label: 'City' },
  { key: 'province', label: 'Province / State' },
  { key: 'postal', label: 'Postal / ZIP' },
  { section: 'Billing' },
  { key: 'billingEmail', label: 'Accounts payable email' },
  { key: 'paymentTerms', label: 'Payment terms', placeholder: 'e.g. Net 30' },
  { key: 'billingAddress', label: 'Billing address (if different)', wide: true, multiline: true },
  { key: 'contractRef', label: 'MSA / contract #', placeholder: 'e.g. CANA MSA' },
  { key: 'taxNumber', label: 'GST / tax # (if tax exempt or needed on invoices)' },
  { key: 'poRequired', label: 'Requires a PO number on every job / invoice', checkbox: true },
  { section: 'Notes' },
  { key: 'generalNotes', label: 'Notes about this customer — the same notes as "Quick notes" in the customer window', wide: true, multiline: true },
]

// Highest sequence number already used in a customer's quote numbers (…-NNN)
function highestQuoteNum(quotes) {
  return quotes.reduce((m, q) => { const x = /-(\d+)$/.exec(q.quoteNumber || ''); return x ? Math.max(m, Number(x[1])) : m }, 0)
}

function DetailsPanel({ customer, quotesCustomer, quotes, onSave }) {
  const [draft, setDraft] = useState(() => {
    const d = {}
    DETAIL_FIELDS.forEach(f => { if (f.key) d[f.key] = customer[f.key] ?? (f.checkbox ? false : '') })
    // older "Notes" written here before the two boxes were one
    if (String(customer.customerNotes || '').trim()) d.generalNotes = [customer.generalNotes, customer.customerNotes].filter(x => String(x || '').trim()).join('\n\n')
    d.quoteCode = quotesCustomer?.code || customer.code || ''
    d.nextQuoteNum = quotesCustomer?.nextQuoteNum || 1
    return d
  })
  const [saved, setSaved] = useState(false)
  const set = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setSaved(false) }
  const year = new Date().getFullYear()
  const code = (draft.quoteCode || 'GEN').toUpperCase()
  const preview = `Q-${code}-${year}-${String(Math.max(1, Number(draft.nextQuoteNum) || 1)).padStart(3, '0')}`
  const highest = highestQuoteNum(quotes)

  const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 3 }
  const lbl = { fontSize: 11, fontWeight: 700, color: 'var(--text-mid)' }
  const sec = { fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mid)', margin: '14px 0 6px' }

  return (
    <div style={{ padding: '6px 18px 16px', background: 'var(--surface-2)' }}>
      <div style={sec}>Quote numbering</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        <div style={fieldWrap}>
          <span style={lbl}>Quote code</span>
          <input style={inputStyle} value={draft.quoteCode} placeholder="e.g. RDP" onChange={e => set('quoteCode', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </div>
        <div style={fieldWrap}>
          <span style={lbl}>Next quote #</span>
          <input type="number" min="1" style={inputStyle} value={draft.nextQuoteNum} onChange={e => set('nextQuoteNum', Math.max(1, Number(e.target.value) || 1))} />
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 6 }}>
        The next quote created for this customer will be <b>{preview}</b>.
        {highest > 0 && <> Highest number used so far: {highest}.{Number(draft.nextQuoteNum) <= highest && <span style={{ color: '#c0392b', fontWeight: 700 }}> That's at or below it — risk of a duplicate number.</span>}</>}
      </div>

      {(() => {
        // render the plain fields in grids, grouped by section, preserving order
        const groups = []
        let cur = null
        DETAIL_FIELDS.forEach(f => {
          if (f.section) { cur = { title: f.section, fields: [] }; groups.push(cur) }
          else if (cur) cur.fields.push(f)
        })
        return groups.map(g => (
          <div key={g.title}>
            <div style={sec}>{g.title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {g.fields.filter(f => !f.checkbox).map(f => (
                <div key={f.key} style={{ ...fieldWrap, gridColumn: f.wide ? '1 / -1' : 'auto' }}>
                  <span style={lbl}>{f.label}</span>
                  {f.multiline
                    ? <textarea rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} value={draft[f.key]} onChange={e => set(f.key, e.target.value)} />
                    : <input style={inputStyle} value={draft[f.key]} placeholder={f.placeholder || ''} onChange={e => set(f.key, e.target.value)} />}
                </div>
              ))}
            </div>
            {g.fields.filter(f => f.checkbox).map(f => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', margin: '10px 0 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!draft[f.key]} onChange={e => set(f.key, e.target.checked)} /> {f.label}
              </label>
            ))}
          </div>
        ))
      })()}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button style={primaryBtn(false)} onClick={async () => { await onSave(draft); setSaved(true) }}>Save details</button>
        {saved && <span style={{ fontSize: 12, fontWeight: 700, color: '#1e7a34' }}>Saved ✓</span>}
      </div>
    </div>
  )
}

const inputStyle = { padding: '8px 12px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface-2)', color: 'var(--text)' }

export default function ManageCustomersWindow() {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const quotesHub = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json',
    getRecordFolderName: quote => quote.title ? `${quote.quoteNumber} - ${quote.title}` : quote.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [openId, setOpenId] = useState(null)      // customer whose panel is open
  const [mode, setMode] = useState(null)          // 'move' | 'merge' | 'rename' | 'details'
  const [renameDraft, setRenameDraft] = useState('')
  const [targetId, setTargetId] = useState('')
  const [pickedJobs, setPickedJobs] = useState({})
  const [pickedQuotes, setPickedQuotes] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)            // { ok, text }
  const [showSleeping, setShowSleeping] = useState(false)
  useSharedCustomerLinks(jobsHub, quotesHub) // hook: must stay above the loading early return

  if (jobsHub.loading || quotesHub.loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>

  const allLive = jobsHub.customers.filter(c => !c.trashedAt).sort(byName)
  const customers = allLive.filter(c => !c.sleepingAt)          // awake — the working list
  const sleeping = allLive.filter(c => c.sleepingAt)
  const shown = customers.filter(c => !search.trim() || norm(c.name).includes(norm(search)))

  const quotesCustomerFor = c => { const q = linkedQuotesCustomer(c, quotesHub.customers); return q && !q.trashedAt ? q : null }
  const jobsOf = c => jobsHub.records.filter(p => p.customerId === c.id && !p.trashedAt)
  const quotesOf = c => { const qc = quotesCustomerFor(c); return qc ? quotesHub.records.filter(q => q.customerId === qc.id && !q.trashedAt) : [] }

  function openPanel(c, m) {
    if (openId === c.id && mode === m) { setOpenId(null); setMode(null); return }
    setOpenId(c.id); setMode(m); setTargetId(''); setPickedJobs({}); setPickedQuotes({}); setMsg(null)
    setRenameDraft(c.name || '')
  }

  async function addCustomer() {
    const name = newName.trim()
    if (!name) return
    if (allLive.some(c => norm(c.name) === norm(name))) { setMsg({ ok: false, text: `"${name}" already exists${sleeping.some(c => norm(c.name) === norm(name)) ? ' — it\'s asleep; wake it under 💤 Sleeping' : ''}.` }); return }
    await addCustomerPair(jobsHub, quotesHub, { name })
    setNewName(''); setMsg({ ok: true, text: `Added "${name}".` })
  }

  async function renameCustomer(c) {
    const name = renameDraft.trim()
    if (!name || name === c.name) { setOpenId(null); setMode(null); return }
    if (allLive.some(o => o.id !== c.id && norm(o.name) === norm(name))) { setMsg({ ok: false, text: `"${name}" already exists — use Merge to combine them.` }); return }
    setBusy(true)
    await renameCustomerPair(jobsHub, quotesHub, c, 'jobs', name)
    setBusy(false); setOpenId(null); setMode(null)
    setMsg({ ok: true, text: `Renamed to "${name}".` })
  }

  async function saveDetails(c, draft) {
    const { quoteCode, nextQuoteNum, ...rest } = draft
    const patch = {}
    Object.keys(rest).forEach(k => { patch[k] = typeof rest[k] === 'string' ? rest[k].trim() : rest[k] })
    if (String(c.customerNotes || '').trim()) patch.customerNotes = '' // folded into generalNotes
    await jobsHub.updateCustomer(c.id, patch)
    // Quote numbering lives on the quotes-side customer record
    let qc = quotesCustomerFor(c)
    const quotePatch = { code: quoteCode || undefined, nextQuoteNum: Math.max(1, Number(nextQuoteNum) || 1) }
    if (qc) await quotesHub.updateCustomer(qc.id, quotePatch)
    else if (quoteCode || quotePatch.nextQuoteNum > 1) await quotesHub.addCustomer({ name: c.name, sharedId: sharedKey(c), ...quotePatch })
    setMsg({ ok: true, text: `Saved details for "${c.name}".` })
  }

  // 💤 Sleep: only when nothing is outstanding. Hidden everywhere until woken.
  const blockersFor = c => sleepBlockers(c, { jobs: jobsOf(c), quotes: quotesOf(c), status: effectiveLifecycleStatus, unbilled: p => unbilledAmount(p) })
  async function sleepCustomer(c) {
    const b = blockersFor(c)
    if (b.length) { setMsg({ ok: false, text: `"${c.name}" can't sleep yet — still open: ${b.join('; ')}.` }); return }
    setBusy(true)
    await setCustomerPairAsleep(jobsHub, quotesHub, c, true)
    setBusy(false)
    if (openId === c.id) { setOpenId(null); setMode(null) }
    setMsg({ ok: true, text: `"${c.name}" is asleep — hidden from the customer lists. Wake it any time under 💤 Sleeping at the bottom.` })
  }
  async function wakeCustomer(c) {
    setBusy(true)
    await setCustomerPairAsleep(jobsHub, quotesHub, c, false)
    setBusy(false)
    setMsg({ ok: true, text: `"${c.name}" is awake and back in the customer lists.` })
  }
  async function removeCustomer(c) {
    await trashCustomerPair(jobsHub, quotesHub, c, 'jobs')
    setMsg({ ok: true, text: `"${c.name}" moved to Trash (with its jobs and quotes) — restore it from Trash within 30 days.` })
    if (openId === c.id) { setOpenId(null); setMode(null) }
  }

  // Moves the given jobs/quotes onto the target customer. Returns { moved, failed }.
  async function moveItems(jobIds, quoteIds, target) {
    let moved = 0, failed = []
    for (const id of jobIds) {
      const r = await jobsHub.moveRecordToCustomer(id, target.id)
      if (r && r.ok) moved++; else failed.push(r?.error || 'job move failed')
    }
    if (quoteIds.length) {
      let tq = quotesCustomerFor(target)
      if (!tq) tq = await quotesHub.addCustomer({ name: target.name, nextQuoteNum: 1, sharedId: sharedKey(target) })
      for (const id of quoteIds) {
        if (!tq) { failed.push('Could not create the quotes-side customer.'); continue }
        const r = await quotesHub.moveRecordToCustomer(id, tq.id)
        if (r && r.ok) moved++; else failed.push(r?.error || 'quote move failed')
      }
    }
    return { moved, failed }
  }

  async function moveSelected(c) {
    const target = customers.find(x => x.id === targetId)
    if (!target) return
    const jobIds = Object.keys(pickedJobs).filter(k => pickedJobs[k])
    const quoteIds = Object.keys(pickedQuotes).filter(k => pickedQuotes[k])
    if (jobIds.length + quoteIds.length === 0) return
    setBusy(true)
    const { moved, failed } = await moveItems(jobIds, quoteIds, target)
    setBusy(false)
    setPickedJobs({}); setPickedQuotes({})
    setMsg(failed.length
      ? { ok: false, text: `Moved ${moved}, but ${failed.length} failed: ${failed[0]}` }
      : { ok: true, text: `Moved ${moved} item${moved === 1 ? '' : 's'} from "${c.name}" to "${target.name}".` })
  }

  async function mergeInto(c) {
    const target = customers.find(x => x.id === targetId)
    if (!target || target.id === c.id) return
    setBusy(true)
    const { moved, failed } = await moveItems(jobsOf(c).map(p => p.id), quotesOf(c).map(q => q.id), target)
    if (failed.length === 0) {
      // customer-level to-dos, notes and details come along (details only fill blanks)
      const dataPatch = mergeCustomerData(target, c)
      if (Object.keys(dataPatch).length) await jobsHub.updateCustomer(target.id, dataPatch)
      // loose files in the old folders (not jobs/quotes) move to "From <name>"
      let loose = 0
      if (window.desktop?.moveCustomerLooseItems) {
        const r1 = await window.desktop.moveCustomerLooseItems('jobs', c.folder, target.folder, c.name, 'project.json')
        loose += (r1 && r1.moved) || 0
        const qc = quotesCustomerFor(c), tq = quotesCustomerFor(target)
        if (qc && tq) { const r2 = await window.desktop.moveCustomerLooseItems('quotes', qc.folder, tq.folder, c.name, 'quote.json'); loose += (r2 && r2.moved) || 0 }
      }
      await removeCustomer(c)
      setMsg({ ok: true, text: `Merged "${c.name}" into "${target.name}" (${moved} item${moved === 1 ? '' : 's'} moved${Object.keys(dataPatch).length ? ', to-dos / notes / details carried over' : ''}${loose ? `, ${loose} loose file${loose === 1 ? '' : 's'} moved to "From ${c.name}"` : ''}). The old empty customer is in Trash.` })
    } else {
      setMsg({ ok: false, text: `Moved ${moved}, but ${failed.length} failed (${failed[0]}) — "${c.name}" was NOT removed.` })
    }
    setBusy(false); setOpenId(null); setMode(null)
  }

  function Check({ checked, onChange, label, sub }) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
        <span>{label}</span>{sub && <span style={{ color: 'var(--text-light)', fontSize: 11.5 }}>{sub}</span>}
      </label>
    )
  }

  function TargetSelect({ c }) {
    return (
      <select value={targetId} onChange={e => setTargetId(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
        <option value="">Choose customer…</option>
        {customers.filter(x => x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    )
  }

  function Panel({ c }) {
    const jobs = jobsOf(c).sort(byName)
    const quotes = quotesOf(c)
    const nPicked = Object.values(pickedJobs).filter(Boolean).length + Object.values(pickedQuotes).filter(Boolean).length
    const target = customers.find(x => x.id === targetId)
    if (mode === 'details') {
      return <DetailsPanel key={c.id} customer={c} quotesCustomer={quotesCustomerFor(c)} quotes={quotes} onSave={d => saveDetails(c, d)} />
    }
    if (mode === 'rename') {
      return (
        <div style={{ padding: '12px 18px', background: 'var(--surface-2)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameCustomer(c) }} style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
          <button style={primaryBtn(busy || !renameDraft.trim())} disabled={busy || !renameDraft.trim()} onClick={() => renameCustomer(c)}>Save name</button>
          <button style={btn()} onClick={() => { setOpenId(null); setMode(null) }}>Cancel</button>
        </div>
      )
    }
    if (mode === 'merge') {
      return (
        <div style={{ padding: '12px 18px', background: 'var(--surface-2)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginBottom: 8 }}>
            Moves all {jobs.length} job{jobs.length === 1 ? '' : 's'} and {quotes.length} quote{quotes.length === 1 ? '' : 's'} from <b>{c.name}</b> into the customer you pick — plus its to-dos, notes, any details the other is missing, and any loose files in its folders — then sends <b>{c.name}</b> to Trash.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {TargetSelect({ c })}
            <button style={primaryBtn(busy || !target)} disabled={busy || !target} onClick={() => mergeInto(c)}>
              {busy ? 'Merging…' : target ? `Merge into ${target.name}` : 'Merge'}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div style={{ padding: '12px 18px', background: 'var(--surface-2)' }}>
        {jobs.length + quotes.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-light)' }}>Nothing to move — this customer has no jobs or quotes.</div>}
        {jobs.length > 0 && <>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mid)', marginTop: 4 }}>Jobs</div>
          {jobs.map(p => <React.Fragment key={p.id}>{Check({ checked: pickedJobs[p.id], onChange: v => setPickedJobs(s => ({ ...s, [p.id]: v })), label: p.name || 'Untitled job', sub: p.co ? `CO ${p.co}` : '' })}</React.Fragment>)}
        </>}
        {quotes.length > 0 && <>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mid)', marginTop: 8 }}>Quotes</div>
          {quotes.map(q => <React.Fragment key={q.id}>{Check({ checked: pickedQuotes[q.id], onChange: v => setPickedQuotes(s => ({ ...s, [q.id]: v })), label: q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber })}</React.Fragment>)}
        </>}
        {jobs.length + quotes.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <button style={btn()} onClick={() => {
              const all = nPicked < jobs.length + quotes.length
              setPickedJobs(Object.fromEntries(jobs.map(p => [p.id, all])))
              setPickedQuotes(Object.fromEntries(quotes.map(q => [q.id, all])))
            }}>{nPicked < jobs.length + quotes.length ? 'Select all' : 'Select none'}</button>
            {TargetSelect({ c })}
            <button style={primaryBtn(busy || !target || nPicked === 0)} disabled={busy || !target || nPicked === 0} onClick={() => moveSelected(c)}>
              {busy ? 'Moving…' : `Move ${nPicked || ''} selected`}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 20px' }}>
        <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Manage Customers</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustomer() }} placeholder="New customer name…" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
          <button style={primaryBtn(!newName.trim())} disabled={!newName.trim()} onClick={addCustomer}>+ Add customer</button>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…" style={{ ...inputStyle, width: 200 }} />
        </div>
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: msg.ok ? '#1e7a34' : '#c0392b', background: msg.ok ? '#e6f4ea' : '#fdecea', borderRadius: 'var(--rs)', padding: '8px 12px' }}>
            {msg.text}
          </div>
        )}
      </div>

      <LinkCheck jobsHub={jobsHub} quotesHub={quotesHub} customers={customers} setMsg={setMsg} />
      {shown.length === 0 && <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--text-light)' }}>{customers.length === 0 ? 'No customers yet.' : 'No matches.'}</div>}
      {shown.map(c => {
        const nJobs = jobsOf(c).length, nQuotes = quotesOf(c).length
        return (
          <div key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{nJobs} job{nJobs === 1 ? '' : 's'} · {nQuotes} quote{nQuotes === 1 ? '' : 's'}{[c.contactName, c.phone].filter(Boolean).length ? ` · ${[c.contactName, c.phone].filter(Boolean).join(' · ')}` : ''}</div>
              </div>
              <button style={btn(openId === c.id && mode === 'details' ? { background: 'var(--accent)', color: 'var(--navy)' } : {})} onClick={() => openPanel(c, 'details')}>Details</button>
              <button style={btn(openId === c.id && mode === 'rename' ? { background: 'var(--accent)', color: 'var(--navy)' } : {})} onClick={() => openPanel(c, 'rename')}>Rename</button>
              <button style={btn(openId === c.id && mode === 'move' ? { background: 'var(--accent)', color: 'var(--navy)' } : {})} onClick={() => openPanel(c, 'move')}>Move jobs / quotes</button>
              <button style={btn(openId === c.id && mode === 'merge' ? { background: 'var(--accent)', color: 'var(--navy)' } : {})} onClick={() => openPanel(c, 'merge')}>Merge into…</button>
              {(() => {
                const b = blockersFor(c)
                return (
                  <button disabled={busy} style={btn(b.length ? { color: 'var(--text-light)' } : {})} onClick={() => sleepCustomer(c)}
                    title={b.length ? `Can't sleep yet — still open: ${b.join('; ')}` : 'Nothing outstanding — hide it from the customer lists until you wake it'}>
                    💤 Sleep
                  </button>
                )
              })()}
              <ConfirmDeleteButton
                onConfirm={() => removeCustomer(c)} ariaLabel="Remove customer" label="Remove" triggerLabel="Remove"
                confirmText={`Remove "${c.name}"? It goes to Trash with its ${nJobs} job${nJobs === 1 ? '' : 's'} and ${nQuotes} quote${nQuotes === 1 ? '' : 's'}.`}
                style={btn({ color: '#c0392b', borderColor: '#c0392b' })}
              />
            </div>
            {openId === c.id && Panel({ c })}
          </div>
        )
      })}
      {sleeping.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setShowSleeping(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '10px 18px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: 'var(--text-mid)' }}>
            💤 Sleeping ({sleeping.length}) {showSleeping ? '▴' : '▾'} <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>— hidden from the customer lists until you wake them</span>
          </button>
          {showSleeping && sleeping.filter(c => !search.trim() || norm(c.name).includes(norm(search))).map(c => {
            const nJobs = jobsOf(c).length, nQuotes = quotesOf(c).length
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--border)', opacity: 0.85 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-mid)' }}>💤 {c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{nJobs} job{nJobs === 1 ? '' : 's'} · {nQuotes} quote{nQuotes === 1 ? '' : 's'} · asleep since {String(c.sleepingAt).slice(0, 10)}</div>
                </div>
                <button disabled={busy} style={btn({ background: 'var(--navy)', color: '#fff', border: 'none' })} onClick={() => wakeCustomer(c)}>☀ Wake</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Link check ──
// Customers missing their Jobs or Quotes side. Nothing changes until you
// press a button: pair it with its other half, give it the missing side,
// merge its quotes into an existing customer, or remove it.
function LinkCheck({ jobsHub, quotesHub, customers, setMsg }) {
  const [busy, setBusy] = useState(false)
  const [pairPick, setPairPick] = useState({})
  const { jobsOnly, quotesOnly } = linkCheck(jobsHub.customers, quotesHub.customers)
  if (!jobsOnly.length && !quotesOnly.length) {
    return <div style={{ padding: '8px 20px', fontSize: 12, color: '#1e7a34', borderBottom: '1px solid var(--border)' }}>✓ Link check: every customer has its Jobs and Quotes side, tied by link ID.</div>
  }
  const run = async (fn, text) => { setBusy(true); try { await fn(); setMsg({ ok: true, text }) } catch (e) { setMsg({ ok: false, text: String(e?.message || e) }) } finally { setBusy(false) } }
  const quotesOf = qc => quotesHub.records.filter(q => q.customerId === qc.id && !q.trashedAt)
  const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', fontSize: 13 }
  const sel = { ...inputStyle, padding: '5px 8px', minWidth: 200 }
  return (
    <div style={{ padding: '10px 20px 12px', borderBottom: '1px solid var(--border)', background: '#fffaf0' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5d00' }}>⚙ Link check — {jobsOnly.length + quotesOnly.length} customer{jobsOnly.length + quotesOnly.length === 1 ? '' : 's'} missing a side</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-light)', margin: '2px 0 6px' }}>Nothing changes until you press a button.</div>
      {jobsOnly.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-mid)' }}>Jobs only (no Quotes side yet)</span>
            {jobsOnly.length > 1 && <button disabled={busy} style={btn()} onClick={() => run(async () => { for (const x of jobsOnly) await createPartner(jobsHub, quotesHub, x.customer, 'quotes') }, `Quotes side added for ${jobsOnly.length} customers.`)}>Give all {jobsOnly.length} a Quotes side</button>}
          </div>
          {jobsOnly.map(({ customer: c, suggestion }) => (
            <div key={c.id} style={row}>
              <b style={{ minWidth: 220 }}>{c.name}</b>
              {suggestion && <button disabled={busy} style={btn({ borderColor: '#1a5fa0', color: '#1a5fa0' })} onClick={() => run(() => pairCustomers(jobsHub, quotesHub, c, suggestion), `Paired "${c.name}" with its quotes ("${suggestion.name}").`)}>Pair with “{suggestion.name}”</button>}
              <button disabled={busy} style={btn()} onClick={() => run(() => createPartner(jobsHub, quotesHub, c, 'quotes'), `Quotes side added for "${c.name}".`)}>Give it a Quotes side</button>
            </div>
          ))}
        </div>
      )}
      {quotesOnly.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-mid)' }}>Quotes only (not in this list or the customer windows)</div>
          {quotesOnly.map(({ customer: qc, suggestion, mergeSuggestion }) => {
            const n = quotesOf(qc).length
            const pick = pairPick[qc.id] ?? (mergeSuggestion ? mergeSuggestion.id : '')
            const target = customers.find(x => x.id === pick)
            return (
              <div key={qc.id} style={row}>
                <b style={{ minWidth: 220 }}>{qc.name}</b><span style={{ fontSize: 11.5, color: 'var(--text-light)' }}>{n} quote{n === 1 ? '' : 's'}</span>
                {suggestion && <button disabled={busy} style={btn({ borderColor: '#1a5fa0', color: '#1a5fa0' })} onClick={() => run(() => pairCustomers(jobsHub, quotesHub, suggestion, qc), `Paired "${qc.name}" with "${suggestion.name}".`)}>Pair with “{suggestion.name}”</button>}
                <button disabled={busy} style={btn()} onClick={() => run(() => createPartner(jobsHub, quotesHub, qc, 'jobs'), `"${qc.name}" is now a full customer.`)}>Make it a full customer</button>
                {n > 0 ? <>
                  <select value={pick} onChange={e => setPairPick(m => ({ ...m, [qc.id]: e.target.value }))} style={sel}>
                    <option value="">Move its quotes to…</option>
                    {customers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <button disabled={busy || !target} style={btn()} onClick={() => run(async () => {
                    let tq = linkedQuotesCustomer(target, quotesHub.customers)
                    if (!tq || tq.trashedAt) tq = await createPartner(jobsHub, quotesHub, target, 'quotes')
                    for (const q of quotesOf(qc)) await quotesHub.moveRecordToCustomer(q.id, tq.id)
                    if (window.desktop?.moveCustomerLooseItems) await window.desktop.moveCustomerLooseItems('quotes', qc.folder, tq.folder, qc.name, 'quote.json')
                    await quotesHub.updateCustomer(qc.id, { trashedAt: new Date().toISOString() })
                  }, `Moved ${n} quote${n === 1 ? '' : 's'} from "${qc.name}" to "${target?.name}"; the empty one is in Trash.`)}>Move &amp; remove</button>
                </> : (
                  <button disabled={busy} style={btn({ color: '#c0392b', borderColor: '#c0392b' })} onClick={() => run(() => quotesHub.updateCustomer(qc.id, { trashedAt: new Date().toISOString() }), `"${qc.name}" (no quotes) moved to Trash.`)}>Remove (empty)</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
