import React, { useState } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'
import { effectiveJobTotal, sortByCO } from './Jobs.jsx'
import { removeBillingEntryPatch } from '../api/billing.js'
import { money, fmtDate } from '../api/format.js'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function Billing() {
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const [exporting, setExporting] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [openMonths, setOpenMonths] = useState(() => new Set()) // months are collapsed until clicked

  if (jobsHub.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }

  // Flatten every job's billing history into individual rows, tagged with
  // that job's own details, then group by the month each entry was billed in.
  const rows = []
  jobsHub.records.filter(p => !p.trashedAt).forEach(p => {
    const customer = jobsHub.customers.find(c => c.id === p.customerId)
    ;(p.billingHistory || []).forEach(h => {
      rows.push({
        ...h,
        projectId: p.id,
        customerName: customer?.name || 'Unknown customer',
        jobName: p.name || 'Untitled job',
        co: p.co || '',
        jobValue: effectiveJobTotal(p),
      })
    })
  })

  const groups = new Map()
  rows.forEach(r => {
    if (!groups.has(r.monthKey)) groups.set(r.monthKey, [])
    groups.get(r.monthKey).push(r)
  })
  const sortedMonths = [...groups.keys()].sort().reverse()

  function undoEntry(row) {
    const project = jobsHub.records.find(p => p.id === row.projectId)
    if (!project) return
    const patch = removeBillingEntryPatch(project, row.id)
    if (patch) jobsHub.updateRecord(project.id, patch)
    setSelected(s => { const n = new Set(s); n.delete(row.id); return n })
  }

  function toggleSelected(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllInMonth(monthKey, checked) {
    const ids = groups.get(monthKey).map(e => e.id)
    setSelected(s => {
      const n = new Set(s)
      ids.forEach(id => checked ? n.add(id) : n.delete(id))
      return n
    })
  }

  async function exportMonth(monthKey) {
    if (!isDesktop) return
    setExporting(monthKey)
    try {
      const all = groups.get(monthKey).sort((a, b) => a.date.localeCompare(b.date))
      const checkedIds = new Set([...selected].filter(id => all.some(e => e.id === id)))
      const entries = checkedIds.size > 0 ? all.filter(e => checkedIds.has(e.id)) : all
      const totalBilled = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0)

      // Organized by customer, then by CO/PO number within each customer —
      // same numeric-aware sort used everywhere else in the app (blanks last).
      const byCustomer = new Map()
      entries.forEach(e => {
        if (!byCustomer.has(e.customerName)) byCustomer.set(e.customerName, [])
        byCustomer.get(e.customerName).push(e)
      })
      const customerNames = [...byCustomer.keys()].sort((a, b) => a.localeCompare(b))

      const rowsHtml = customerNames.map(customerName => {
        const sorted = sortByCO(byCustomer.get(customerName))
        const customerRows = sorted.map(e => `
          <tr>
            <td>${e.jobName}</td>
            <td>${e.co || '—'}</td>
            <td style="text-align:right">${money(e.jobValue)}</td>
            <td style="text-align:right">${e.percent}%</td>
            <td style="text-align:right">${money(e.amount)}</td>
            <td>${fmtDate(e.date, 'medium')}</td>
          </tr>
        `).join('')
        return `
          <tr class="customer-row"><td colspan="6">${customerName}</td></tr>
          ${customerRows}
        `
      }).join('')

      const html = `
        <html><head><meta charset="utf-8"><style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #1a1a1a; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; background: #f0f0f0; padding: 8px 10px; border-bottom: 2px solid #ccc; }
          td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; }
          .customer-row td { background: #e8f2fc; font-weight: bold; color: #1a5fa0; border-bottom: 1px solid #c8dcf0; }
          tfoot td { font-weight: bold; border-top: 2px solid #333; border-bottom: none; }
        </style></head><body>
          <h1>Billing — ${monthLabel(monthKey)}</h1>
          <div class="meta">SCE Electric Western Canada Ltd. · Generated ${new Date().toLocaleString()}</div>
          <table>
            <thead><tr><th>Job</th><th>CO/PO #</th><th style="text-align:right">Job Value</th><th style="text-align:right">% Billed</th><th style="text-align:right">Amount Billed</th><th>Date</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr><td colspan="4">Total billed this month</td><td style="text-align:right">${money(totalBilled)}</td><td></td></tr></tfoot>
          </table>
        </body></html>
      `

      const pdfBase64 = await window.desktop.pdfFromHtml(html)
      const fileName = `${monthKey} - Billing.pdf`
      const savedPath = await window.desktop.saveFile('Billing/Exports', fileName, pdfBase64)
      if (savedPath) window.desktop.openFile(savedPath)
    } finally {
      setExporting('')
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Billing</div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 16 }}>
        Set a job's progress and hit "Invoice to Amount" from its General Information to log it here, grouped by the month it was billed in.
        Check off specific entries to export just those, or leave everything unchecked to export the whole month.
      </div>

      {sortedMonths.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>
          Nothing billed yet — set progress on a job and hit "Invoice to Amount."
        </div>
      )}

      {sortedMonths.map(monthKey => {
        const entries = groups.get(monthKey)
        const totalBilled = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        const allChecked = entries.every(e => selected.has(e.id))
        const isOpen = openMonths.has(monthKey)
        const toggleOpen = () => setOpenMonths(set => { const n = new Set(set); n.has(monthKey) ? n.delete(monthKey) : n.add(monthKey); return n })
        return (
          <div key={monthKey} style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 'var(--rs)', overflow: 'hidden' }}>
            <div onClick={toggleOpen} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--surface-2)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden style={{ fontSize: 12, color: 'var(--text-light)', width: 12, display: 'inline-block' }}>{isOpen ? '▾' : '▸'}</span>
                <input type="checkbox" checked={allChecked} onClick={e => e.stopPropagation()} onChange={e => toggleAllInMonth(monthKey, e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{monthLabel(monthKey)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {money(totalBilled)} total</div>
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); exportMonth(monthKey) }}
                disabled={exporting === monthKey}
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', background: 'var(--accent)', border: 'none', borderRadius: 'var(--rs)', padding: '7px 14px', cursor: 'pointer' }}
              >
                {exporting === monthKey ? 'Exporting…' : '↓ Export'}
              </button>
            </div>
            {isOpen && entries.map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelected(e.id)} style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.customerName} — {e.jobName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                      CO {e.co || '—'} · Job value {money(e.jobValue)} · {e.percent}% · {fmtDate(e.date, 'medium')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap' }}>{money(e.amount)}</span>
                  <ConfirmDeleteButton
                    onConfirm={() => undoEntry(e)} triggerLabel="Undo" ariaLabel="Undo this billing entry"
                    confirmText={`Undo billing ${money(e.amount)} for ${e.jobName}?`}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '4px 10px', cursor: 'pointer' }}
                  />
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
