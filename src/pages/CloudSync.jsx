import React, { useState, useEffect, useRef } from 'react'
import { ensureRoster } from '../api/crewRoster.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useHubStore } from '../api/useHubStore.js'
import { effectiveLifecycleStatus } from './Jobs.jsx'
import { quoteGrandTotal, quoteMaterialsTotal, quoteLaborTotal, normalizeQuote, scopeMaterialsMarked, scopeLabor, scopeLaborHours, allowancesTotal, adjustmentsTotal } from '../api/quoteMath.js'
import { jobDeficiencies } from '../api/jobHealth.js'
import { findProposal } from '../api/proposal.js'
import { unpostedCount } from '../components/PostTimeToLabor.jsx'
import { partsList } from '../components/MaterialUsed.jsx'
import { phoneTasksPayload, applyPhoneOp } from '../api/tasks.js'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// Quote total from the shared calculator (old and new quote layouts).
const quoteTotal = quoteGrandTotal

export default function CloudSync({ background = false }) {
  const [workerUrl, setWorkerUrl] = useLocalStore('cloud_sync_worker_url', '')
  const [uploadKey, setUploadKey] = useLocalStore('cloud_sync_upload_key', '')
  const [lastSync, setLastSync] = useLocalStore('cloud_sync_last', null)
  const [, setPendingSlips] = useLocalStore('materials_pending_slips', [])
  const [, setPendingExpenses] = useLocalStore('timesheets_pending_expenses', [])
  const [, setPendingTime] = useLocalStore('time_pending', [])
  // Phone Materials screen: catalog/stock goes up; used material and order
  // items come back down for approval / the Material Order list
  const [catalog] = useLocalStore('material_catalog', [])
  const [stock] = useLocalStore('material_stock', [])
  const [, setPendingUsed] = useLocalStore('materials_used_pending', [])
  const [, setOrderList] = useLocalStore('materials_order_list', [])
  // Catalog counts / new items from the phone — tentative until approved
  const [catPending, setCatPending] = useLocalStore('materials_catalog_pending', [])
  const [syncing, setSyncing] = useState(false)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')

  const jobsStore = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects',
  })
  const quotesStore = useHubStore({
    hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber,
    customersKey: 'quote_customers', recordsKey: 'quote_quotes',
  })

  const cleanUrl = workerUrl.trim().replace(/\/+$/, '')
  const configured = cleanUrl && uploadKey.trim()
  // Every call to the Worker carries the password (reads need it too now)
  const wfetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'X-Upload-Key': uploadKey.trim() } })

  // A short summary of each job / quote for the phone (opened by tapping it)
  const r2 = v => Math.round((Number(v) || 0) * 100) / 100
  const clip = (t, n) => { const x = String(t || '').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x }
  const ls = k => { try { const v = JSON.parse(localStorage.getItem('fieldapp_' + k) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
  function jobSummary(p) {
    const labor = p.laborEntries || []
    const hours = labor.reduce((a, e) => a + (Number(e.hours) || 0), 0)
    const quoteNos = (p.linkedQuoteIds || (p.linkedQuoteId ? [p.linkedQuoteId] : [])).map(id => (quotesStore.records.find(q => q.id === id) || {}).quoteNumber).filter(Boolean)
    let issues = []
    try {
      issues = jobDeficiencies(p, { orders: ls('material_orders'), requests: ls('material_requests'), orderSheet: ls('materials_order_list'), stock: ls('material_stock'), usedPending: ls('materials_used_pending'), status: effectiveLifecycleStatus(p), unposted: unpostedCount(p) })
    } catch { issues = [] }
    return {
      value: r2(p.jobValue || p.coValue), progress: Number(p.progress) || 0, billedPct: Number(p.billedProgress ?? p.billingProgress) || 0, billed: r2(p.billedAmount),
      hours: r2(hours), labor: r2(p.actualLabor), materials: r2(p.actualMaterials), qMat: r2(p.quotedMaterials), qLab: r2(p.quotedLabor),
      dateComplete: p.dateComplete || '', quotes: quoteNos,
      tasks: (p.tasks || []).filter(t => !t.done).slice(0, 8).map(t => ({ t: clip(t.text, 120), due: t.due || '', who: t.who || '' })),
      tasksDone: (p.tasks || []).filter(t => t.done).length, tasksAll: (p.tasks || []).length,
      defs: (p.deficiencies || []).filter(d => !d.resolved).slice(0, 6).map(d => clip(d.text, 140)),
      issues,
      work: labor.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 4)
        .map(e => ({ d: e.date || '', w: e.worker || '', h: Number(e.hours) || 0, t: clip(e.workCompleted, 260) })),
    }
  }
  function quoteSummary(q) {
    const nq = normalizeQuote(q)
    return {
      mat: r2(quoteMaterialsTotal(q)), lab: r2(quoteLaborTotal(q)), allow: r2(allowancesTotal(nq)), adj: r2(adjustmentsTotal(nq)),
      created: String(q.createdAt || q.date || '').slice(0, 10), sent: String(q.sentAt || '').slice(0, 10),
      scopes: (nq.scopes || []).map(sc => ({ n: sc.name || 'Scope', t: clip(sc.scopeText, 700), mat: r2(scopeMaterialsMarked(nq, sc)), lab: r2(scopeLabor(sc)), hrs: r2(scopeLaborHours(sc)) })),
      job: q.linkedJobId ? ((jobsStore.records.find(j => j.id === q.linkedJobId) || {}).name || '') : '',
    }
  }

  // Each quote's proposal PDF ("SCE Electric - Name.pdf" in its Files) goes up
  // once (and again when it changes) so the phone can open it
  const [sentProposals, setSentProposals] = useLocalStore('cloud_sync_proposals', {})
  async function syncProposals() {
    const out = {}
    if (!window.desktop?.readFileBytes) return out
    const sent = { ...(sentProposals || {}) }
    let changed = false
    for (const q of quotesStore.records.filter(x => !x.trashedAt)) {
      const c = quotesStore.customers.find(x => x.id === q.customerId)
      const f = c ? await findProposal(c.folder, q) : null
      if (!f) continue
      const key = `proposals/${String(q.id).replace(/[^A-Za-z0-9_-]/g, '')}.pdf`
      try {
        const b64 = await window.desktop.readFileBytes(f.path)
        if (!b64) continue
        const sig = f.path + ':' + b64.length + ':' + b64.slice(-64)
        if (sent[q.id] !== sig) {
          const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
          const res = await wfetch(`${cleanUrl}/putfile?key=${encodeURIComponent(key)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: bytes })
          if (!res.ok) continue
          sent[q.id] = sig; changed = true
        }
        out[q.id] = key
      } catch { /* skip this one */ }
    }
    if (changed) setSentProposals(sent)
    return out
  }

  async function pushSnapshots(extraPend = []) {
    let proposals = {}
    try { proposals = await syncProposals() } catch { proposals = {} }
    const jobsPayload = {
      updatedAt: new Date().toISOString(),
      customers: jobsStore.customers.map(c => ({ id: c.id, name: c.name })),
      projects: jobsStore.records.map(p => ({
        id: p.id, customerId: p.customerId, name: p.name, co: p.co, coValue: p.coValue,
        status: p.status, completed: !!p.completed, lifecycle: effectiveLifecycleStatus(p), trashed: !!p.trashedAt, type: p.type, notes: p.notes, dateStart: p.dateStart,
        sum: p.trashedAt ? null : jobSummary(p),
      })),
      // Crew roster for the phone's crew clock (active people only)
      crew: ensureRoster().filter(c => c.active !== false).map(c => ({ id: c.id, name: c.name, role: c.role || '', isMe: !!c.isMe })),
    }
    const quotesPayload = {
      updatedAt: new Date().toISOString(),
      customers: quotesStore.customers.map(c => ({ id: c.id, name: c.name })),
      quotes: quotesStore.records.map(q => ({
        id: q.id, customerId: q.customerId, quoteNumber: q.quoteNumber, title: q.title,
        status: q.status, approved: !!q.approved, invalidated: !!q.invalidated, trashed: !!q.trashedAt, notes: q.notes, total: quoteTotal(q),
        sum: q.trashedAt ? null : quoteSummary(q), pdf: proposals[q.id] || '',
      })),
    }
    await wfetch(`${cleanUrl}/putjson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Key': uploadKey.trim() },
      body: JSON.stringify({ key: 'sync/jobs.json', data: jobsPayload }),
    })
    await wfetch(`${cleanUrl}/putjson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Key': uploadKey.trim() },
      body: JSON.stringify({ key: 'sync/quotes.json', data: quotesPayload }),
    })
    const catalogPayload = {
      updatedAt: new Date().toISOString(),
      // still waiting for approval, so every phone shows them as tentative
      pend: [...(catPending || []), ...extraPend.filter(x => !(catPending || []).some(y => y.id === x.id))].map(x => ({ id: x.id, kind: x.kind, catalogId: x.catalogId || null, stockId: x.stockId || null, name: x.name || x.item, item: x.item, partNo: x.partNo || '', uom: x.uom || '', qty: x.qty, by: x.by || '', at: x.at })),
      items: partsList(catalog, stock).map(p => ({ k: p.key, c: p.catalogId, s: p.stockId, n: p.name, nn: p.nickname, pn: p.partNo, pa: p.alts || '', u: p.uom, p: Math.round((Number(p.price) || 0) * 10000) / 10000, oh: p.onHand, cat: p.category || '' })),
    }
    await wfetch(`${cleanUrl}/putjson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Key': uploadKey.trim() },
      body: JSON.stringify({ key: 'sync/catalog.json', data: catalogPayload }),
    })
    // Job tasks for the phone's ✓ Tasks screen
    await wfetch(`${cleanUrl}/putjson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Key': uploadKey.trim() },
      body: JSON.stringify({ key: 'sync/tasks.json', data: phoneTasksPayload(jobsStore.records, jobsStore.customers) }),
    })
    return { jobCount: jobsPayload.projects.length, quoteCount: quotesPayload.quotes.length }
  }

  async function pullPhotos() {
    let pulled = 0, skipped = 0

    // Job-linked photos
    const jobsRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('jobs/')}`)
    const jobFiles = jobsRes.ok ? await jobsRes.json() : []
    const jobPending = jobFiles.filter(f => f.key.includes('/pending/'))
    for (const f of jobPending) {
      const match = f.key.match(/^jobs\/([^/]+)\/pending\//)
      const projectId = match?.[1]
      const project = projectId && jobsStore.records.find(p => p.id === projectId)
      if (!project) { skipped++; continue }
      const customer = jobsStore.customers.find(c => c.id === project.customerId)
      if (!customer || !isDesktop) { skipped++; continue }
      const ok = await pullOneFile(f, `Jobs/${customer.folder}/${project.folder}/Files`)
      ok ? pulled++ : skipped++
    }

    // Miscellaneous — not tied to any job, just a catch-all local folder
    const miscRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('misc/pending/')}`)
    const miscFiles = miscRes.ok ? await miscRes.json() : []
    for (const f of miscFiles) {
      if (!isDesktop) { skipped++; continue }
      const ok = await pullOneFile(f, 'Miscellaneous')
      ok ? pulled++ : skipped++
    }

    // General Pictures — not tied to any job, shows up on the Photos page
    const generalPhotosRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('photos/general/pending/')}`)
    const generalPhotoFiles = generalPhotosRes.ok ? await generalPhotosRes.json() : []
    for (const f of generalPhotoFiles) {
      if (!isDesktop) { skipped++; continue }
      const ok = await pullOneFile(f, 'Photos/General')
      ok ? pulled++ : skipped++
    }

    // Packing slips / invoices — filed for review in Materials, not parsed yet
    const slipsRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('packing-slips/pending/')}`)
    const slipFiles = slipsRes.ok ? await slipsRes.json() : []
    for (const f of slipFiles) {
      if (!isDesktop) { skipped++; continue }
      try {
        const fileRes = await wfetch(`${cleanUrl}${f.url}`)
        if (!fileRes.ok) { skipped++; continue }
        const buf = await fileRes.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const savedPath = await window.desktop.saveFile('Materials/Packing Slips - Pending Review', f.name, base64)
        // The phone sends which job or quote the slip is for (in desc)
        let target = null
        try { const d = JSON.parse(f.desc || ''); if (d && d.type) target = d } catch { /* plain text */ }
        setPendingSlips(list => [...list, { id: uid(), fileName: f.name, filePath: savedPath, pulledAt: new Date().toISOString(), source: 'phone', target, kindHint: target?.type === 'quote' ? 'pricing' : (target ? 'order' : '') }])
        await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() } })
        pulled++
      } catch {
        skipped++
      }
    }

    // Expense receipts — filed for review on Timesheets, not yet assigned to a worker/week
    const expensesRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('expenses/pending/')}`)
    const expenseFiles = expensesRes.ok ? await expensesRes.json() : []
    for (const f of expenseFiles) {
      if (!isDesktop) { skipped++; continue }
      try {
        const fileRes = await wfetch(`${cleanUrl}${f.url}`)
        if (!fileRes.ok) { skipped++; continue }
        const buf = await fileRes.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const savedPath = await window.desktop.saveFile('Timesheets/Receipts - Pending Review', f.name, base64)
        setPendingExpenses(list => [...list, {
          id: uid(), fileName: f.name, filePath: savedPath, amount: f.amount || '', desc: f.desc || '', pulledAt: new Date().toISOString(),
        }])
        await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() } })
        pulled++
      } catch {
        skipped++
      }
    }

    // Phone time-clock entries — queued for review on the Time Tracking page
    const timeRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('time/pending/')}`)
    const timeFiles = timeRes.ok ? await timeRes.json() : []
    let timePulled = 0
    for (const f of timeFiles) {
      try {
        const r = await wfetch(`${cleanUrl}${f.url}`)
        if (!r.ok) { skipped++; continue }
        const entry = await r.json()
        setPendingTime(list => list.some(x => x.id === entry.id) ? list : [...list, entry])
        await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() } })
        timePulled++
      } catch { skipped++ }
    }

    // Phone Materials: material used (→ approval) and order items (→ Material Order)
    const matRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('materials/pending/')}`)
    const matFiles = matRes.ok ? await matRes.json() : []
    let matPulled = 0
    const catNew = []
    for (const f of matFiles) {
      try {
        const r = await wfetch(`${cleanUrl}${f.url}`)
        if (!r.ok) { skipped++; continue }
        const it = await r.json()
        if (it.kind === 'count' || it.kind === 'newpart') {
          setCatPending(list => list.some(x => x.id === it.id) ? list : [...list, { ...it, source: 'phone' }])
          catNew.push(it)
        } else if (it.kind === 'order') {
          setOrderList(list => list.some(x => x.id === it.id) ? list : [...list, { id: it.id, qty: it.qty, partNo: it.partNo || '', desc: it.name || it.item || '', nickname: it.nickname || '', uom: it.uom || '', jobId: it.jobId || '', jobName: it.jobName || '', source: 'phone', at: it.at }])
        } else {
          setPendingUsed(list => list.some(x => x.id === it.id) ? list : [...list, { ...it, source: 'phone' }])
        }
        await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() } })
        matPulled++
      } catch { skipped++ }
    }

    // Phone task changes (ticked off, un-ticked, added) — applied to the job
    const tRes = await wfetch(`${cleanUrl}/list/${encodeURIComponent('tasks/pending/')}`)
    const tFiles = tRes.ok ? await tRes.json() : []
    const ops = []
    for (const f of tFiles) {
      try {
        const r = await wfetch(`${cleanUrl}${f.url}`)
        if (r.ok) ops.push({ f, op: await r.json() })
      } catch { /* try again next sync */ }
    }
    let taskPulled = 0
    for (const { f, op } of ops.sort((a, b) => String(a.op.at).localeCompare(String(b.op.at)))) {
      try {
        if (jobsStore.records.some(p => p.id === op.jobId)) {
          await jobsStore.updateRecord(op.jobId, p => applyPhoneOp(p, op) || {})
        }
        await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() } })
        taskPulled++
      } catch { skipped++ }
    }

    return { pulled, skipped, timePulled, matPulled, catNew, taskPulled }
  }

  async function pullOneFile(f, folderPath) {
    try {
      const fileRes = await wfetch(`${cleanUrl}${f.url}`)
      if (!fileRes.ok) return false
      const buf = await fileRes.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      await window.desktop.saveFile(folderPath, f.name, base64)
      // Remove from R2 only after it's safely saved locally — the computer stays the master copy
      await wfetch(`${cleanUrl}/file/${encodeURIComponent(f.key)}`, {
        method: 'DELETE', headers: { 'X-Upload-Key': uploadKey.trim() },
      })
      return true
    } catch {
      return false
    }
  }

  async function syncNow() {
    if (!configured) return
    setSyncing(true); setError(''); setLog([])
    try {
      const { jobCount, quoteCount } = await pushSnapshots()
      setLog(l => [...l, `Pushed ${jobCount} job${jobCount === 1 ? '' : 's'} and ${quoteCount} quote${quoteCount === 1 ? '' : 's'} to the mobile view.`])
      const { pulled, skipped, timePulled, matPulled, catNew, taskPulled } = await pullPhotos()
      // phones keep showing new counts / items as tentative until approved;
      // and see their ticked tasks come back as done
      if ((catNew && catNew.length) || taskPulled) await pushSnapshots(catNew || [])
      if (taskPulled > 0) setLog(l => [...l, `Pulled ${taskPulled} task change${taskPulled === 1 ? '' : 's'} from the phone — see the job's Tasks or To do.`])
      if (matPulled > 0) setLog(l => [...l, `Pulled ${matPulled} material item${matPulled === 1 ? '' : 's'} from the phone — see Materials → Material Used / Material Order.`])
      if (timePulled > 0) setLog(l => [...l, `Pulled ${timePulled} time entr${timePulled === 1 ? 'y' : 'ies'} — review on the Time Tracking page.`])
      if (pulled > 0) setLog(l => [...l, `Pulled ${pulled} new photo${pulled === 1 ? '' : 's'} into the right job folder${pulled === 1 ? '' : 's'}.`])
      if (skipped > 0) setLog(l => [...l, `${skipped} item${skipped === 1 ? '' : 's'} couldn't be matched to a job and were left in the cloud for review.`])
      if (pulled === 0 && skipped === 0 && !timePulled) setLog(l => [...l, 'No new photos waiting.'])
      setLastSync(new Date().toISOString())
    } catch (err) {
      setError(err.message || 'Sync failed — check the Worker URL and Upload Key.')
    } finally {
      setSyncing(false)
    }
  }

  // Background mode (mounted once by App): sync quietly shortly after start and
  // every 10 minutes, so phone slips, receipts, photos and crew days come in on
  // their own — no need to press Sync now.
  const syncRef = useRef(syncNow)
  syncRef.current = syncNow
  useEffect(() => {
    if (!background || !configured) return
    let busy = false
    const run = async () => { if (busy) return; busy = true; try { await syncRef.current() } finally { busy = false } }
    const first = setTimeout(run, 20000)
    const every = setInterval(run, 10 * 60000)
    return () => { clearTimeout(first); clearInterval(every) }
  }, [background, configured])
  if (background) return null

  if (jobsStore.loading || quotesStore.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Cloud Sync</div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 16 }}>
        A quick-view mobile page for Jobs and Quotes, plus a way to snap job-site photos from anywhere and have them
        land in the right local folder next time you sync. This computer stays the only real copy of everything —
        the cloud is just a temporary hand-off point.
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6 }}>Worker URL</div>
        <input
          value={workerUrl} onChange={e => setWorkerUrl(e.target.value)}
          placeholder="https://sce-electric-files.your-subdomain.workers.dev"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)', marginBottom: 12, boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6 }}>Upload Key</div>
        <input
          value={uploadKey} onChange={e => setUploadKey(e.target.value)}
          type="password" placeholder="The UPLOAD_SECRET you set on the Worker"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
        />
      </div>

      {configured && (
        <div style={{ background: '#e8f2fc', border: '1px solid #1a5fa0', borderRadius: 'var(--rs)', padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a5fa0', marginBottom: 4 }}>On your phone</div>
          <div style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text)' }}>{cleanUrl}/</div>
          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 4 }}>
            Open that address in your phone's browser. The first time, it'll ask for the Upload Key above — enter it once and it's remembered on that phone.
          </div>
        </div>
      )}

      <button
        onClick={syncNow}
        disabled={!configured || syncing}
        style={{
          width: '100%', padding: 12, borderRadius: 'var(--rs)', border: 'none', fontWeight: 700, fontSize: 14, cursor: configured ? 'pointer' : 'default',
          background: configured ? 'var(--accent)' : 'var(--gray-light)', color: configured ? 'var(--navy)' : 'var(--text-light)',
        }}
      >
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>

      {lastSync && <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 8, textAlign: 'center' }}>Last synced {new Date(lastSync).toLocaleString()}</div>}

      {error && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      {log.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mid)' }}>
          {log.map((line, i) => <div key={i} style={{ marginBottom: 4 }}>• {line}</div>)}
        </div>
      )}
    </div>
  )
}
