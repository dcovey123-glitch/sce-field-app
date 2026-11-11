import React, { useState } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import logoUrl from '../assets/logo_sce_new.jpg'
import { effectiveLifecycleStatus } from './Jobs.jsx'
import { TIME_VIEWS } from './TimeHub.jsx'
import MiniCalendar from '../components/MiniCalendar.jsx'
import HitList from '../components/HitList.jsx'
import { usePurchaseAttention } from '../api/usePurchaseAttention.js'
import { setFlagJump } from '../api/flags.js'

// ── Home: big logo in the middle, six launch bubbles around it ──
const MATERIALS_VIEWS = [
  { id: 'used', label: 'Material Used' },
  { id: 'ordered', label: 'Orders & Slips' },
  { id: 'catalog', label: 'Catalog & Stock' },
  { id: 'stock', label: 'Stock only' },
  { id: 'orderform', label: 'Material Order' },
]

// angle in degrees, 0 = right, -90 = top, going clockwise
const BUBBLES = [
  { id: 'customers',    label: 'Customers',     icon: '👥', angle: -90 },
  { id: 'materials',    label: 'Materials',     icon: '📦', angle: -30 },
  { id: 'review',       label: 'Assistant Update', icon: '☀️', angle: 30 },
  { id: 'notes',        label: 'Notes',         icon: '📝', angle: 90 },
  { id: 'time',         label: 'Time',          icon: '⏱', angle: 150 },
  { id: 'billing',      label: 'Billing',       icon: '💰', angle: 210 },
]

function Popout({ bubble, children }) {
  const rad = bubble.angle * Math.PI / 180
  const below = Math.sin(rad) <= 0.2       // upper half / top → open downward; lower half → open upward
  const alignRight = Math.cos(rad) > 0.2   // right side → hang the panel off the right edge
  const alignLeft = Math.cos(rad) < -0.2
  const style = {
    position: 'absolute', zIndex: 30, width: 270, maxHeight: 340, display: 'flex', flexDirection: 'column',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,30,46,.28)',
    overflow: 'hidden',
    ...(below ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }),
    ...(alignRight ? { right: 0 } : alignLeft ? { left: 0 } : { left: '50%', transform: 'translateX(-50%)' }),
  }
  return <div style={style} onClick={e => e.stopPropagation()}>{children}</div>
}

function PopoutItem({ children, onClick, faded, title }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={title}
      style={{ padding: '10px 14px', fontSize: 13.5, fontWeight: faded ? 500 : 600, color: 'var(--text)', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: hover ? 'var(--surface-2)' : 'var(--surface)', opacity: faded && !hover ? 0.45 : 1 }}
    >
      {children}
    </div>
  )
}

export default function Home({ onOpenHub, agingDeficiencyCount = 0, reviewCount = 0 }) {
  // Material warnings — the same list Materials → Orders & Slips shows under ⚠ Needs you
  const matNeeds = usePurchaseAttention()
  const ordersAttentionCount = matNeeds.length
  const openMatNeeds = e => {
    e.stopPropagation()
    setFlagJump({ kind: 'purchase', refId: matNeeds.length === 1 ? matNeeds[0].key : '' })
    if (window.desktop?.openMaterialsWindow) window.desktop.openMaterialsWindow('ordered')
    else onOpenHub && onOpenHub('materials', 'ordered')
  }
  const jobsHub = useHubStore({
    hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name,
    customersKey: 'job_customers', recordsKey: 'job_projects', reloadOnFocus: true,
  })
  const [openId, setOpenId] = useState(null)
  const [custSearch, setCustSearch] = useState('')

  const customers = jobsHub.loading ? [] : jobsHub.customers
    .filter(c => !c.trashedAt)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
  // Customers with an active job first; the rest go to the bottom, faded
  // (still clickable) — nothing on the go for them right now.
  const hasActive = new Set(jobsHub.loading ? [] : jobsHub.records.filter(p => !p.trashedAt && effectiveLifecycleStatus(p) === 'onGoing').map(p => p.customerId))
  const matchesSearch = c => !custSearch.trim() || (c.name || '').toLowerCase().includes(custSearch.trim().toLowerCase())
  const shownCustomers = customers.filter(matchesSearch)
  const busyCustomers = shownCustomers.filter(c => hasActive.has(c.id))
  const quietCustomers = shownCustomers.filter(c => !hasActive.has(c.id))

  // Active Jobs dropdown: every on-going job across all customers (buckets),
  // grouped by customer in the same order as the Customers list.
  const [jobSearch, setJobSearch] = useState('')
  const jobQ = jobSearch.trim().toLowerCase()
  const activeGroups = jobsHub.loading ? [] : customers.map(c => ({
    customer: c,
    jobs: jobsHub.records
      .filter(p => p.customerId === c.id && !p.trashedAt && effectiveLifecycleStatus(p) === 'onGoing')
      .filter(p => !jobQ || (p.name || '').toLowerCase().includes(jobQ) || String(p.co || '').toLowerCase().includes(jobQ) || (c.name || '').toLowerCase().includes(jobQ))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true })),
  })).filter(g => g.jobs.length > 0)
  const activeTotal = jobsHub.loading ? 0 : jobsHub.records.filter(p => !p.trashedAt && effectiveLifecycleStatus(p) === 'onGoing' && customers.some(c => c.id === p.customerId)).length

  function close() { setOpenId(null); setCustSearch(''); setJobSearch('') }

  function openJob(c, p) {
    close()
    if (window.desktop) window.desktop.openCustomerWindow(c.id, p.id)
    else onOpenHub && onOpenHub('customers')
  }

  function clickBubble(b) {
    if (b.id === 'customers' || b.id === 'materials' || b.id === 'time') {
      setOpenId(id => id === b.id ? null : b.id)
      setCustSearch('')
    } else {
      close()
      onOpenHub && onOpenHub(b.id)
    }
  }
  function openCustomer(c) {
    close()
    if (window.desktop) window.desktop.openCustomerWindow(c.id)
    else onOpenHub && onOpenHub('customers')
  }
  function openTime(view) {
    close()
    if (window.desktop?.openTimeWindow) window.desktop.openTimeWindow(view)
    else onOpenHub && onOpenHub('time', view)
  }
  function openMaterials(view) {
    close()
    if (window.desktop) window.desktop.openMaterialsWindow(view)
    else onOpenHub && onOpenHub('materials', view)
  }

  return (
    <div onClick={close} style={{ position: 'relative' }}>
      {/* Active Jobs — top-right, just under the header bar (Today, Snapshot and Mobile are on the top bar) */}
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 40, display: 'flex', gap: 8, alignItems: 'flex-start' }} onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setOpenId(id => id === 'activejobs' ? null : 'activejobs'); setJobSearch(''); setCustSearch('') }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 30, cursor: 'pointer',
            border: openId === 'activejobs' ? '2px solid var(--accent)' : '2px solid var(--navy)',
            background: openId === 'activejobs' ? 'var(--accent)' : 'var(--navy)', color: openId === 'activejobs' ? 'var(--navy)' : '#fff',
            fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-d)', boxShadow: '0 4px 14px rgba(15,30,46,.25)', whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 17 }}>🔧</span>
          Active Jobs
          {activeTotal > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 10, background: openId === 'activejobs' ? 'var(--navy)' : 'var(--accent)', color: openId === 'activejobs' ? '#fff' : 'var(--navy)' }}>{activeTotal}</span>
          )}
          <span style={{ fontSize: 11, opacity: .7 }}>▾</span>
        </button>

        {openId === 'activejobs' && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, maxHeight: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 32px rgba(15,30,46,.28)', overflow: 'hidden',
          }}>
            <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="Search jobs, CO #, or customer…"
                onKeyDown={e => { if (e.key === 'Escape') close() }}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface-2)', color: 'var(--text)' }}
              />
            </div>
            <div style={{ overflowY: 'auto' }}>
              {jobsHub.loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-light)' }}>Loading…</div>}
              {!jobsHub.loading && activeGroups.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: 'var(--text-light)' }}>{activeTotal === 0 ? 'No active jobs.' : 'No matches.'}</div>
              )}
              {activeGroups.map(g => (
                <div key={g.customer.id}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 1, padding: '6px 14px', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
                    color: '#fff', background: 'var(--navy)', display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>{g.customer.name}</span>
                    <span style={{ opacity: .7 }}>{g.jobs.length}</span>
                  </div>
                  {g.jobs.map(p => (
                    <PopoutItem key={p.id} onClick={() => openJob(g.customer, p)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || 'Untitled job'}</span>
                        {p.co && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-light)' }}>CO {p.co}</span>}
                      </div>
                    </PopoutItem>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Calendar — top-left: this month at a glance */}
      <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MiniCalendar />
        <HitList />
      </div>

      <div style={{ width: 'min(1100px, calc(100% - 270px))', height: 'calc(100vh - 150px)', minWidth: 640, minHeight: 560, marginLeft: 'max(270px, calc((100% - 1100px) / 2))', position: 'relative' }}>
        {/* center logo */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '34%', minWidth: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, boxSizing: 'border-box',
          background: '#fff', borderRadius: 24, boxShadow: '0 6px 30px rgba(15,30,46,.15)', border: '1px solid var(--border)',
        }}>
          <img src={logoUrl} alt="SCE Electric" style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>

        {BUBBLES.map(b => {
          const rad = b.angle * Math.PI / 180
          const left = 50 + 40 * Math.cos(rad)
          const top = 50 + 39 * Math.sin(rad)
          const active = openId === b.id
          return (
            <div key={b.id} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)', zIndex: active ? 20 : 10 }}>
              <button
                onClick={e => { e.stopPropagation(); clickBubble(b) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', borderRadius: 40, cursor: 'pointer',
                  border: active ? '2px solid var(--accent)' : '2px solid var(--navy)',
                  background: active ? 'var(--accent)' : 'var(--navy)', color: active ? 'var(--navy)' : '#fff',
                  fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-d)', boxShadow: '0 4px 14px rgba(15,30,46,.25)', whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 22 }}>{b.icon}</span>
                {b.label}
                {(b.id === 'customers' || b.id === 'materials' || b.id === 'time') && <span style={{ fontSize: 11, opacity: .7 }}>▾</span>}
              </button>
              {b.id === 'customers' && agingDeficiencyCount > 0 && (
                <span
                  className="navBadgeFlash"
                  title={`${agingDeficiencyCount} deficienc${agingDeficiencyCount === 1 ? 'y has' : 'ies have'} been open a week or more`}
                  style={{
                    position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, background: 'var(--red)', color: '#fff',
                    fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  {agingDeficiencyCount}
                </span>
              )}

              {/* Orders & POs lives in Materials → Orders & Slips now; its badge rides on Materials */}
              {b.id === 'materials' && ordersAttentionCount > 0 && (
                <span
                  className="navBadgeFlash"
                  onClick={openMatNeeds}
                  title={`Click to go fix ${ordersAttentionCount === 1 ? 'it' : 'them'}:\n` + matNeeds.map(p => `• ${p.supplier}${p.po ? ' PO ' + p.po : ''}${p.forWhat ? ' — ' + p.forWhat : ''}: ${p.flags.map(f => f.text).join(', ')}`).join('\n')}
                  style={{ cursor: 'pointer',
                    position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, background: 'var(--red)', color: '#fff',
                    fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  {ordersAttentionCount}
                </span>
              )}

              {b.id === 'review' && reviewCount > 0 && (
                <span
                  title={`${reviewCount} email note${reviewCount === 1 ? '' : 's'} waiting for your OK`}
                  style={{
                    position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, background: 'var(--accent)', color: 'var(--navy)',
                    fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  {reviewCount}
                </span>
              )}

              {active && b.id === 'customers' && (
                <Popout bubble={b}>
                  <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                    <input
                      autoFocus value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Search customers…"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 'var(--rs)', background: 'var(--surface-2)', color: 'var(--text)' }}
                    />
                  </div>
                  {window.desktop && (
                    <div
                      onClick={() => { close(); window.desktop.openManageCustomersWindow() }}
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 800, color: 'var(--navy)', background: 'var(--accent)', cursor: 'pointer' }}
                    >
                      ⚙ Manage Customers
                    </div>
                  )}
                  <div style={{ overflowY: 'auto' }}>
                    {jobsHub.loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-light)' }}>Loading…</div>}
                    {!jobsHub.loading && shownCustomers.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-light)' }}>{customers.length === 0 ? 'No customers yet.' : 'No matches.'}</div>}
                    {busyCustomers.map(c => <PopoutItem key={c.id} onClick={() => openCustomer(c)}>{c.name}</PopoutItem>)}
                    {quietCustomers.length > 0 && busyCustomers.length > 0 && (
                      <div style={{ padding: '6px 14px 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>No active jobs</div>
                    )}
                    {quietCustomers.map(c => <PopoutItem key={c.id} faded title="No active jobs right now" onClick={() => openCustomer(c)}>{c.name}</PopoutItem>)}
                  </div>
                </Popout>
              )}

              {active && b.id === 'time' && (
                <Popout bubble={b}>
                  <div style={{ overflowY: 'auto' }}>
                    {TIME_VIEWS.map(v => <PopoutItem key={v.id} onClick={() => openTime(v.id)}>{v.label}</PopoutItem>)}
                  </div>
                </Popout>
              )}

              {active && b.id === 'materials' && (
                <Popout bubble={b}>
                  <div style={{ overflowY: 'auto' }}>
                    {MATERIALS_VIEWS.map(v => <PopoutItem key={v.id} onClick={() => openMaterials(v.id)}>{v.label}</PopoutItem>)}
                  </div>
                </Popout>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
