import React from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useOrdersFeed, useOrdersPrevious } from '../api/orders.js'
import { buildPurchases } from '../api/purchases.js'
import { REQUESTS_KEY } from '../api/requests.js'
import { useFlags } from '../api/flags.js'
import { effectiveLifecycleStatus } from '../pages/Jobs.jsx'
import { unpostedCount } from './PostTimeToLabor.jsx'
import { tasksOf, isOverdue, isDueToday, today, fmtDay, uid } from '../api/tasks.js'
import { materialFindings } from '../api/materialsAudit.js'
import { openLaborFlags } from '../api/jobHealth.js'
import { adjustStockDraw } from '../api/stockDraw.js'
import { moneyWholeOrBlank as money } from '../api/format.js'

// "What needs me today": one list built from everything the app already
// knows. Nothing here is typed in — each line goes away when the thing is
// dealt with (or you say "Later" and it comes back tomorrow).

const daysSince = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000) }

export function useNeedsYou(navigate) {
  const jobsHub = useHubStore({ hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name, customersKey: 'job_customers', recordsKey: 'job_projects' })
  const feed = useOrdersFeed()
  const prev = useOrdersPrevious()
  const [orders, setOrders] = useLocalStore('material_orders', [])
  const [stock, setStock] = useLocalStore('material_stock', [])
  const [requests] = useLocalStore(REQUESTS_KEY, [])
  const [marks] = useLocalStore('purchase_marks', {})
  const [timePending] = useLocalStore('time_pending', [])
  const [slipsPending] = useLocalStore('materials_pending_slips', [])
  const [usedPending] = useLocalStore('materials_used_pending', [])
  const [catPending] = useLocalStore('materials_catalog_pending', [])
  const [snoozed, setSnoozed] = useLocalStore('today_snoozed', {})
  const { active: flags } = useFlags()

  const go = s => () => navigate && navigate(s)
  const custName = id => (jobsHub.customers.find(c => c.id === id) || {}).name || ''
  const jobGo = (j, section) => go({ hub: 'jobs', view: 'section', customerId: j.customerId, projectId: j.id, section })
  const jobs = jobsHub.records.filter(j => !j.trashedAt)
  const label = j => `${j.name || 'Job'}${custName(j.customerId) ? ' · ' + custName(j.customerId) : ''}`
  const groups = []
  const add = (id, title, items) => { if (items.length) groups.push({ id, title, items }) }

  // 1. Tasks overdue or due today
  const dueTasks = jobs.flatMap(j => tasksOf(j).filter(t => isOverdue(t) || isDueToday(t)).map(t => ({ t, j })))
    .sort((a, b) => String(a.t.due).localeCompare(String(b.t.due)))
  add('tasks', '✅ Tasks due', dueTasks.map(({ t, j }) => ({
    key: 'task:' + t.id, tone: isOverdue(t) ? 'bad' : 'warn',
    text: t.text, detail: `${label(j)}${t.who ? ' · ' + t.who : ''} · ${isOverdue(t) ? 'overdue since ' + fmtDay(t.due) : 'due today'}`,
    action: 'Open', onGo: jobGo(j, 'tasks'),
  })))

  // 1b. Job notes you put on this list ("⚑ Move to Needs you" on a job's note)
  const noteItems = jobs.filter(j => effectiveLifecycleStatus(j) !== 'billed')
    .flatMap(j => (j.notesLog || []).filter(nt => nt.needsMe && !nt.addressedAt).map(nt => ({ j, nt })))
    .sort((a, b) => String(a.nt.needsMeAt || a.nt.timestamp).localeCompare(String(b.nt.needsMeAt || b.nt.timestamp)))
  add('notes', '📝 Job notes to address', noteItems.map(({ j, nt }) => {
    const age = daysSince(nt.needsMeAt || nt.timestamp)
    return {
      key: 'note:' + nt.id, tone: age != null && age > 7 ? 'warn' : 'info',
      text: nt.text.length > 160 ? nt.text.slice(0, 159) + '…' : nt.text,
      detail: `${label(j)}${age != null ? ' · ' + (age === 0 ? 'today' : age + ' day' + (age === 1 ? '' : 's') + ' ago') : ''}`,
      action: 'Done', isFix: true,
      onGo: () => jobsHub.updateRecord(j.id, cur => ({ notesLog: (cur.notesLog || []).map(x => x.id === nt.id ? { ...x, addressedAt: new Date().toISOString() } : x) })),
      onOpen: jobGo(j, 'notes'),
    }
  }))

  // 1c. Flagged labor (overtime not billed, took longer…) — blocks closing the job
  add('laborflags', '⚑ Flagged labor', jobs.flatMap(j => openLaborFlags(j).map(e => ({
    key: 'lflag:' + j.id + ':' + e.id, tone: 'bad',
    text: `${j.name || 'Job'}: ${e.flag.kind}${e.flag.note ? ' — ' + e.flag.note : ''}`,
    detail: `${custName(j.customerId)} · ${e.date || 'undated'} · ${e.worker || '—'} · ${e.hours || 0} h · the job can't be closed until it's resolved`,
    action: 'Labor', onGo: jobGo(j, 'labor'),
  }))))

  // 2. Money waiting: work done but not billed, time not on the job yet
  const billing = []
  jobs.filter(j => effectiveLifecycleStatus(j) === 'unbilled').forEach(j => billing.push({
    key: 'unbilled:' + j.id, tone: 'warn', text: `Bill ${j.name || 'job'}`,
    detail: `${custName(j.customerId)} · marked complete, not billed${j.coValue ? ' · ' + money(j.coValue) : ''}`, action: 'Open job', onGo: jobGo(j, 'general'),
  }))
  jobs.filter(j => effectiveLifecycleStatus(j) === 'onGoing' && tasksOf(j).length && tasksOf(j).every(t => t.done)).forEach(j => billing.push({
    key: 'alldone:' + j.id, tone: 'warn', text: `${j.name || 'Job'} — every task done`,
    detail: `${custName(j.customerId)} · close it out and bill it?`, action: 'Open job', onGo: jobGo(j, 'general'),
  }))
  jobs.filter(j => effectiveLifecycleStatus(j) !== 'billed' && unpostedCount(j) > 0).forEach(j => billing.push({
    key: 'unposted:' + j.id, tone: 'info', text: `Post time to ${j.name || 'job'}`,
    detail: `${custName(j.customerId)} · ${unpostedCount(j)} clocked entr${unpostedCount(j) === 1 ? 'y' : 'ies'} not on the job's labor yet`, action: 'Labor', onGo: jobGo(j, 'labor'),
  }))
  add('billing', '💰 Money waiting', billing)

  // 3. Material: anything the Orders overview flags
  const purchases = buildPurchases({ slips: Array.isArray(orders) ? orders : [], feed: feed || [], previous: prev || [], marks: marks || {}, requests: Array.isArray(requests) ? requests : [] })
  const matItems = purchases.filter(p => p.flags.length && p.stage !== 'closed' && p.stage !== 'pricing')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(p => ({
      key: 'po:' + p.key, tone: p.flags.some(f => f.tone === 'bad') ? 'bad' : 'warn',
      text: `${p.supplier}${p.po ? ' · PO ' + p.po : ''}${p.forWhat ? ' · ' + p.forWhat : ''}`,
      detail: p.flags.map(f => f.text).join(' · '), action: 'Orders', onGo: go({ hub: 'materials', view: 'ordered' }),
    }))
  const inbox = []
  if ((slipsPending || []).length) inbox.push({ key: 'slips', tone: 'info', text: `${slipsPending.length} slip${slipsPending.length === 1 ? '' : 's'} to read and file`, detail: 'From the phone or the slip grabber', action: 'Slips', onGo: go({ hub: 'materials', view: 'ordered' }) })
  if ((usedPending || []).length) inbox.push({ key: 'used', tone: 'info', text: `${usedPending.length} material-used entr${usedPending.length === 1 ? 'y' : 'ies'} to approve`, detail: 'Sent from the phone', action: 'Approve', onGo: go({ hub: 'materials', view: 'used' }) })
  if ((catPending || []).length) inbox.push({ key: 'catalog', tone: 'info', text: `${catPending.length} catalog count${catPending.length === 1 ? '' : 's'} / new part${catPending.length === 1 ? '' : 's'} to approve`, detail: 'Sent from the phone', action: 'Catalog', onGo: go({ hub: 'materials', view: 'catalog' }) })
  // Job plans: lines to order that haven't gone out, Stock lines short / unpicked
  const [orderSheet] = useLocalStore('materials_order_list', [])
  const outRefs = new Set([...(Array.isArray(orderSheet) ? orderSheet : []).flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId)),
    ...(Array.isArray(requests) ? requests : []).filter(r => !r.removedAt).flatMap(r => (r.items || []).flatMap(i => (i.planRefs || []).map(p => p.jobId + ':' + p.lineId)))])
  const openJobs = jobs.filter(j => effectiveLifecycleStatus(j) !== 'billed')
  const toOrder = openJobs.flatMap(j => (j.plannedMaterials || []).filter(l => l.source === 'order' && !outRefs.has(j.id + ':' + l.id)).map(l => ({ j, l })))
  const planItems = []
  if (toOrder.length) planItems.push({ key: 'plan-order:' + toOrder.map(x => x.l.id).join(','), tone: 'warn', text: `${toOrder.length} planned line${toOrder.length === 1 ? '' : 's'} to order`, detail: `${[...new Set(toOrder.map(x => x.j.name))].slice(0, 4).join(', ')} — put them on one order and send or phone it in`, action: 'Material Order', onGo: go({ hub: 'materials', view: 'orderform' }) })
  const stockQty = id => { const s0 = (Array.isArray(stock) ? stock : []).find(x => x.id === id); return s0 ? Number(s0.qty) || 0 : null }
  const held = {}
  openJobs.forEach(j => (j.plannedMaterials || []).forEach(l => { if (l.source === 'stock' && l.stockPick) held[l.stockPick] = (held[l.stockPick] || 0) + (Number(l.qty) || 0) }))
  openJobs.forEach(j => {
    const lines = (j.plannedMaterials || []).filter(l => l.source === 'stock')
    const unpicked = lines.filter(l => !l.stockPick)
    const short = lines.filter(l => l.stockPick && stockQty(l.stockPick) != null && held[l.stockPick] > stockQty(l.stockPick))
    if (unpicked.length || short.length) planItems.push({ key: 'plan-stock:' + j.id + ':' + [...unpicked, ...short].map(l => l.id).join(','), tone: short.length ? 'bad' : 'warn',
      text: `${j.name}: ${short.length ? `${short.length} Stock line${short.length === 1 ? '' : 's'} short on the shelf` : `${unpicked.length} Stock line${unpicked.length === 1 ? '' : 's'} to pick`}`,
      detail: [...short, ...unpicked].slice(0, 3).map(l => `${l.qty} ${l.item || l.partNo}`).join(', ') + (short.length ? ' — more is reserved than is on the shelf; order the difference' : ''), action: 'Plan', onGo: jobGo(j, 'materials') })
  })
  add('material', '📦 Material', [...planItems, ...matItems, ...inbox])

  // 3b. Material checks: slips vs jobs vs Stock, most with a one-click fix
  const ctx = { updateJob: (id, patch) => jobsHub.updateRecord(id, patch), setStock, setOrders, uid, adjustStockDraw }
  const checks = materialFindings({ orders: Array.isArray(orders) ? orders : [], jobs: jobs.map(j => ({ ...j, _customer: custName(j.customerId) })), stock: Array.isArray(stock) ? stock : [] })
  add('matcheck', '🔍 Material checks', checks.map(c => ({
    key: c.key, tone: c.tone, text: c.text, detail: c.detail,
    action: c.fix ? c.fixLabel : (c.goLabel || 'Open'), isFix: !!c.fix, confirm: /delete|remove/i.test(c.fixLabel || ''),
    onGo: c.fix ? () => c.fix(ctx) : go(c.go),
    onOpen: c.job ? jobGo(c.job, 'materials') : null,
  })))

  // 4. Time from the phone waiting for End-of-day Catch-up
  const tp = Array.isArray(timePending) ? timePending : []
  if (tp.length) {
    const days = [...new Set(tp.map(e => String(e.date || e.startedAt || '').slice(0, 10)).filter(Boolean))].sort()
    add('time', '⏱ Time', [{ key: 'timepending', tone: days[0] && days[0] < today() ? 'warn' : 'info', text: `Confirm ${tp.length} clocked entr${tp.length === 1 ? 'y' : 'ies'}`,
      detail: days.length ? `End-of-day Catch-up · ${days.map(fmtDay).join(', ')}` : 'End-of-day Catch-up', action: 'Catch-up', onGo: go({ hub: 'time', view: 'tracking' }) }])
  }

  // (Quotes waiting on an answer are left off: some take months, some never
  // come back, and there's nothing to do about them day to day.)

  // 6. Jobs to tidy: open deficiencies a week old, no status
  const tidy = []
  jobs.forEach(j => {
    const st = effectiveLifecycleStatus(j)
    if (st === 'billed' || st === 'unbilled') return
    const old = (j.deficiencies || []).filter(d => !d.resolved && daysSince(d.createdAt) >= 7)
    if (old.length) tidy.push({ key: 'def:' + j.id, tone: 'warn', text: `${old.length} deficienc${old.length === 1 ? 'y' : 'ies'} on ${j.name || 'job'}`, detail: `${custName(j.customerId)} · ${old.map(d => d.text || d.note || d.description || '').filter(Boolean).slice(0, 2).join(' · ') || 'open a week or more'}`, action: 'Open job', onGo: jobGo(j, 'general') })
  })
  jobs.filter(j => effectiveLifecycleStatus(j) == null).forEach(j => tidy.push({ key: 'nostatus:' + j.id, tone: 'info', text: `Set a status on ${j.name || 'job'}`, detail: `${custName(j.customerId)} · not marked Ongoing, Unbilled or Billed`, action: 'Open job', onGo: jobGo(j, 'general') }))
  add('jobs', '🔧 Jobs to tidy up', tidy)

  // 7. Things you flagged
  add('flags', '⚑ Flagged', (flags || []).map(f => ({ key: 'flag:' + f.id, tone: 'bad', text: f.title || 'Flagged item', detail: f.note || 'No note', action: 'Flagged', onGo: go({ hub: 'notes' }) })))

  // "Later" hides a line until tomorrow
  const t0 = today()
  const isSnoozed = k => (snoozed || {})[k] && snoozed[k] > t0
  const later = k => { const d = new Date(); d.setDate(d.getDate() + 1); const tm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setSnoozed(s => { const n = {}; Object.entries(s || {}).forEach(([kk, v]) => { if (v > t0) n[kk] = v }); n[k] = tm; return n }) }
  const shown = groups.map(g => ({ ...g, items: g.items.filter(i => !isSnoozed(i.key)) })).filter(g => g.items.length)
  const hiddenCount = groups.reduce((a, g) => a + g.items.filter(i => isSnoozed(i.key)).length, 0)
  const total = shown.reduce((a, g) => a + g.items.length, 0)
  const urgent = shown.reduce((a, g) => a + g.items.filter(i => i.tone === 'bad').length, 0)
  return { groups: shown, total, urgent, hiddenCount, later, clearLater: () => setSnoozed({}), loading: jobsHub.loading }
}

const TONE = { bad: '#c0392b', warn: '#e0a716', info: '#7f9bb8' }

// A fix that happens right here. Deleting / removing asks once more first.
function FixButton({ item }) {
  const [sure, setSure] = React.useState(false)
  const [done, setDone] = React.useState(false)
  if (done) return <span style={{ fontSize: 12, fontWeight: 700, color: '#1e7a34', whiteSpace: 'nowrap' }}>✓ Fixed</span>
  const run = async () => {
    if (item.confirm && !sure) { setSure(true); return }
    await item.onGo(); setDone(true)
  }
  return (
    <button onClick={run} onBlur={() => setSure(false)} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: sure ? '#c0392b' : '#1e7a34', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {sure ? `Sure? ${item.action}` : `✓ ${item.action}`}
    </button>
  )
}

export default function NeedsYou({ navigate }) {
  const n = useNeedsYou(navigate)
  if (n.loading) return <div style={{ padding: 20, color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  return (
    <div>
      {!n.total && <div style={{ padding: '24px 16px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 8, background: '#e6f4ea', color: '#1e7a34', fontWeight: 700 }}>✓ Nothing needs you right now.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {n.groups.map(g => (
          <div key={g.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
            <div style={{ padding: '7px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800, display: 'flex', gap: 8 }}>
              <span>{g.title}</span><span style={{ color: 'var(--text-light)', fontWeight: 700 }}>{g.items.length}</span>
            </div>
            {g.items.map(i => (
              <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border)', boxShadow: `inset 4px 0 0 ${TONE[i.tone] || TONE.info}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{i.text}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 1 }}>{i.detail}</div>
                </div>
                <button onClick={() => n.later(i.key)} title="Hide until tomorrow" style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-light)', cursor: 'pointer' }}>Later</button>
                {i.onOpen && <button onClick={i.onOpen} title="Look at it first" style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-mid)', cursor: 'pointer' }}>See it</button>}
                {i.isFix ? <FixButton item={i} /> : <button onClick={i.onGo} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>{i.action} →</button>}
              </div>
            ))}
          </div>
        ))}
      </div>
      {n.hiddenCount > 0 && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-light)' }}>{n.hiddenCount} hidden until tomorrow · <a href="#" onClick={e => { e.preventDefault(); n.clearLater() }} style={{ color: 'var(--blue, #2563eb)' }}>show them</a></div>}
    </div>
  )
}
