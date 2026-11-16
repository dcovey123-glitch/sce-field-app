import React from 'react'
import { AUTOMATIONS, useAllAutoModes, AUTO_SKIP_KEY } from '../api/automations.js'
import { useLocalStore } from '../api/useLocalStore.js'

// Everything the app does on its own, and the switch for each.
//   Ask first — it shows the change; nothing is saved until you ✓ Apply
//   Automatic — it saves the change by itself
//   Off — it doesn't run; you do that step by hand

const MODE_LABEL = { ask: 'Ask first', auto: 'Automatic', off: 'Off' }

// Things that run on their own but don't decide anything for you — they
// bring things in for review, keep copies, or keep two lists in step.
const OTHER = [
  { name: 'Phone sync (every 10 min)', what: 'Brings phone slips, receipts, photos, clocked time, material used and Catalog counts into their review lists. Nothing lands on a job, timesheet, Stock or the Catalog until you approve it there.', bypass: 'Mobile → leave the sync key blank to stop it; Sync now runs it by hand.' },
  { name: 'Phone order items', what: 'Items added on the phone go onto the Material Order sheet.', bypass: 'The sheet is a draft — nothing goes to a supplier until you send or phone it in. Remove any line with ×.' },
  { name: 'Phone task ticks', what: 'Tasks ticked / added on the phone are applied to the job.', bypass: 'Your tap on the phone is the OK; un-tick on the job to undo.' },
  { name: 'Slip reader', what: 'Reads phone slip photos and slips from the email run (AI) and holds them under Materials → Orders & Slips "to confirm".', bypass: 'Nothing is filed until you Review and confirm; Dismiss drops one.' },
  { name: 'Morning email run', what: 'Writes the Orders & POs list, email notes and calendar suggestions.', bypass: 'Notes and calendar items wait in Morning Review for your OK; your own changes in Orders & POs are kept on top of the run.' },
  { name: 'Received orders → week\'s export to Jonathan', what: 'A PO marked or forced Received goes on the export for the week it was received.', bypass: 'Staging only — you check the export before it goes; "Already sent" / remove takes it off.' },
  { name: 'Pricing quotes → Catalog', what: 'New parts on a pricing quote are added to the Catalog (your rule: import every time).', bypass: 'Any price that differs from the Catalog waits for Update catalog / Ignore.' },
  { name: 'Catalog ↔ Stock pairing', what: 'Every Stock item gets a Catalog twin so the two lists never disagree.', bypass: 'Housekeeping only — no prices, qty or jobs change.' },
  { name: 'T&M stock pricing', what: 'Stock used on a T&M job is charged at its full stock price (your T&M rule).', bypass: 'Change the price on the line if needed.' },
  { name: 'Crew day → timesheet', what: 'A crew day you confirm goes to the timesheet.', bypass: 'Switch on Crew Day Review; confirming the day is the OK. OT only when you tick "OT rates apply".' },
  { name: 'Backups', what: 'A copy of the data on every change, and an online backup every 3 hours.', bypass: 'Copies only — never changes your data. Backup page restores.' },
]

export default function Automations() {
  const [modeOf, setMode] = useAllAutoModes()
  const [skipped, setSkipped] = useLocalStore(AUTO_SKIP_KEY, {})
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '12px 14px', marginBottom: 10 }
  const seg = on => ({ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', border: '1px solid var(--border)', background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--text-mid)', cursor: 'pointer' })
  return (
    <div style={{ padding: 16, maxWidth: 820 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Automations</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-light)', marginBottom: 14, lineHeight: 1.5 }}>
        Everything the app changes on its own. <b>Ask first</b> shows the change on the page where it happens (a yellow ⚙ bar) and saves nothing until you ✓ Apply it — Skip and it isn't offered again.
        <b> Automatic</b> saves it by itself. <b>Off</b> stops it; you do that step by hand.
      </div>
      {AUTOMATIONS.map(a => {
        const m = modeOf(a.id)
        const nSkip = ((skipped || {})[a.id] || []).length
        return (
          <div key={a.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{a.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{a.where}</span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'inline-flex' }}>
                {a.modes.map((k, i) => (
                  <button key={k} onClick={() => setMode(a.id, k)} style={{ ...seg(m === k), borderRadius: i === 0 ? '6px 0 0 6px' : i === a.modes.length - 1 ? '0 6px 6px 0' : 0, borderLeft: i ? 'none' : undefined }}>{MODE_LABEL[k]}</button>
                ))}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.45 }}>{a.what}</div>
            {nSkip > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 4 }}>
                {nSkip} skipped change{nSkip === 1 ? '' : 's'} won't be offered again ·{' '}
                <a href="#" onClick={e => { e.preventDefault(); if (window.confirm(`Offer the ${nSkip} skipped change${nSkip === 1 ? '' : 's'} again?`)) setSkipped(x => { const n = { ...(x || {}) }; delete n[a.id]; return n }) }} style={{ color: 'var(--blue, #2563eb)' }}>offer them again</a>
              </div>
            )}
          </div>
        )
      })}
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-mid)', margin: '18px 0 8px' }}>Also runs on its own — but only brings things in for review, or keeps copies</div>
      {OTHER.map(o => (
        <div key={o.name} style={{ ...card, padding: '9px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{o.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>{o.what}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 2 }}>✓ {o.bypass}</div>
        </div>
      ))}
    </div>
  )
}
