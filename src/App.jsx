import React, { useState, useEffect } from 'react'
import styles from './App.module.css'
import logoUrl from './assets/logo_sce_new.jpg'
import Home from './pages/Home.jsx'
import Jobs from './pages/Jobs.jsx'
import Quotes from './pages/Quotes.jsx'
import Materials from './pages/Materials.jsx'
import Timesheets from './pages/Timesheets.jsx'
import CloudSync from './pages/CloudSync.jsx'
import TimeTracking from './pages/TimeTracking.jsx'
import Crew from './pages/Crew.jsx'
import Todo from './pages/Todo.jsx'
import SlipGrabber from './components/SlipGrabber.jsx'
import Backup from './pages/Backup.jsx'
import Trash from './pages/Trash.jsx'
import Notes from './pages/Notes.jsx'
import Billing from './pages/Billing.jsx'
import Photos from './pages/Photos.jsx'
import Orders from './pages/Orders.jsx'
import { loadOrdersAttentionCount, checkPoEmails } from './api/orders.js'
import MorningReview, { loadReviewCount } from './pages/MorningReview.jsx'
import Snapshot from './pages/Snapshot.jsx'
import CustomerJobsWindow from './pages/CustomerJobsWindow.jsx'
import DeficienciesWindow from './pages/DeficienciesWindow.jsx'
import CustomerFilesWindow from './pages/CustomerFilesWindow.jsx'
import ManageCustomersWindow from './pages/ManageCustomersWindow.jsx'

function parseWindowRoute() {
  let m = window.location.hash.match(/^#\/customer\/([^/]+)(?:\/(job|quote)\/([^/]+)(?:\/([^/]+))?)?$/)
  if (m) return {
    kind: 'customer', customerId: m[1],
    projectId: m[2] === 'job' ? decodeURIComponent(m[3]) : null,
    quoteId: m[2] === 'quote' ? decodeURIComponent(m[3]) : null,
    focus: m[4] ? decodeURIComponent(m[4]) : null,
  }
  m = window.location.hash.match(/^#\/files\/(photos|documents)\/(.+)$/)
  if (m) return { kind: 'files', filesKind: m[1], customerId: m[2] }
  if (window.location.hash === '#/manage-customers') return { kind: 'manage-customers' }
  m = window.location.hash.match(/^#\/materials\/(.+)$/)
  if (m) return { kind: 'materials', view: m[1] }
  m = window.location.hash.match(/^#\/deficiencies\/(.+)$/)
  if (m) return { kind: 'deficiencies', customerId: m[1] }
  return null
}

function useWindowRoute() {
  const [route, setRoute] = useState(() => parseWindowRoute())
  useEffect(() => {
    function onHashChange() { setRoute(parseWindowRoute()) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}

const NAV_ITEMS = [
  { id: 'home',       label: 'Home',       icon: '🏠' },
  { id: 'todo',       label: 'Today',      icon: '☀' },
  { id: 'jobs',       label: 'Customers',  icon: '👥' },
  { id: 'materials',  label: 'Materials',  icon: '📦' },
  { id: 'orders',     label: 'Orders & POs', icon: '📑' },
  { id: 'review',     label: 'Assistant Update', icon: '☀️' },
  { id: 'timesheets', label: 'Timesheets', icon: '🧾' },
  { id: 'timetracking', label: 'Time Tracking', icon: '⏱' },
  { id: 'crew',       label: 'Crew',       icon: '👷' },
  { id: 'photos',     label: 'Photos',     icon: '📷' },
  { id: 'billing',    label: 'Billing',    icon: '💰' },
  { id: 'notes',      label: 'Notes',      icon: '📝' },
  { id: 'cloudsync',  label: 'Mobile',     icon: '📱' },
  { id: 'backup',     label: 'Backup',     icon: '💾' },
  { id: 'trash',      label: 'Trash',      icon: '🗑' },
]

// Root (default) screen for each hub when its nav icon is tapped
const HUB_ROOT = {
  home:       { hub: 'home' },
  todo:       { hub: 'todo' },
  jobs:       { hub: 'jobs', view: 'list' },
  quotes:     { hub: 'quotes', view: 'list' },
  materials:  { hub: 'materials', view: 'catalog' },
  orders:     { hub: 'materials', view: 'ordered' },
  review:     { hub: 'review' },
  snapshot:   { hub: 'snapshot' },
  timesheets: { hub: 'timesheets' },
  timetracking: { hub: 'timetracking' },
  crew:       { hub: 'crew' },
  billing:    { hub: 'billing' },
  photos:     { hub: 'photos' },
  notes:      { hub: 'notes' },
  cloudsync:  { hub: 'cloudsync' },
  backup:     { hub: 'backup' },
  trash:      { hub: 'trash' },
}

export default function App() {
  const windowRoute = useWindowRoute()
  const [screen, setScreen]   = useState({ hub: 'home' })   // current screen object
  const [history, setHistory] = useState([])      // stack of previous screens
  const [agingDeficiencyCount, setAgingDeficiencyCount] = useState(0)
  const [ordersAttentionCount, setOrdersAttentionCount] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)

  // Auto-backup, once per real day the app is opened — best-effort, never
  // blocks anything if it fails.
  useEffect(() => {
    if (window.desktop) {
      window.desktop.autoBackupIfNeeded().catch(() => {})
    }
  }, [])

  // Flashing nav badge for deficiencies that have sat open a week or more —
  // checked on open and refreshed periodically while the app is running.
  useEffect(() => {
    if (!window.desktop) return
    let cancelled = false
    async function checkDeficiencies() {
      const data = await window.desktop.loadJobsOnly()
      if (cancelled || !data) return
      const now = Date.now()
      let count = 0
      ;(data.records || []).forEach(p => {
        if (p.trashedAt) return
        // Jobs already marked Complete (Unbilled/Billed) are done — leftover
        // unticked items on them aren't real outstanding deficiencies.
        if (p.lifecycleStatus === 'unbilled' || p.lifecycleStatus === 'billed') return
        ;(p.deficiencies || []).forEach(d => {
          if (d.resolved) return
          const days = Math.floor((now - new Date(d.createdAt).getTime()) / 86400000)
          if (days >= 7) count++
        })
      })
      if (!cancelled) setAgingDeficiencyCount(count)
    }
    checkDeficiencies()
    const interval = setInterval(checkDeficiencies, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Badge on the Orders & POs bubble: quotes sitting a week+ with no PO.
  useEffect(() => {
    if (!window.desktop?.ordersLoad) return
    let cancelled = false
    async function check() {
      // Jonathan's PO emails (Power Automate → Field App/PO Emails) land on their quotes in the background too
      try { await checkPoEmails() } catch { /* ignore */ }
      const n = await loadOrdersAttentionCount()
      if (!cancelled) setOrdersAttentionCount(n)
    }
    check()
    const interval = setInterval(check, 5 * 60000)
    window.addEventListener('focus', check)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', check) }
  }, [])

  // Badge on Morning Review: email notes waiting for approval.
  useEffect(() => {
    if (!window.desktop?.emailNotesLoad) return
    let cancelled = false
    async function check() {
      const n = await loadReviewCount()
      if (!cancelled) setReviewCount(n)
    }
    check()
    const interval = setInterval(check, 5 * 60000)
    window.addEventListener('focus', check)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', check) }
  }, [])

  function navigate(next) {
    setHistory(h => [...h, screen])
    setScreen(next)
  }

  function goBack() {
    setHistory(h => {
      if (h.length === 0) return h
      setScreen(h[h.length - 1])
      return h.slice(0, -1)
    })
  }

  const canGoBack = history.length > 0

  if (windowRoute?.kind === 'customer') {
    return <CustomerJobsWindow customerId={windowRoute.customerId} initialProjectId={windowRoute.projectId} initialQuoteId={windowRoute.quoteId} initialFocus={windowRoute.focus} />
  }
  if (windowRoute?.kind === 'files') {
    return <CustomerFilesWindow customerId={windowRoute.customerId} initialKind={windowRoute.filesKind} />
  }
  if (windowRoute?.kind === 'manage-customers') {
    return <ManageCustomersWindow />
  }
  if (windowRoute?.kind === 'materials') {
    return (
      <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg, #f6f8fb)' }}>
        <Materials screen={{ hub: 'materials', view: windowRoute.view }} navigate={() => {}} goBack={() => {}} />
      </div>
    )
  }
  if (windowRoute?.kind === 'deficiencies') {
    return <DeficienciesWindow customerId={windowRoute.customerId} />
  }

  return (
    <div className={styles.app}>
      <header className={styles.hdr}>
        <div className={styles.hdrBrand}>
          <button
            className={`${styles.backBtn} ${!canGoBack ? styles.backBtnHidden : ''}`}
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11.5 4L6.5 9L11.5 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className={styles.hdrSpacer} />
          {[{ id: 'trash', label: 'Trash', icon: '🗑' }, { id: 'backup', label: 'Backup', icon: '💾' }, { id: 'crew', label: 'Crew', icon: '👷' }].map(item => (
            <button
              key={item.id}
              className={`${styles.navBtn} ${screen?.hub === item.id ? styles.navBtnActive : ''}`}
              onClick={() => navigate(HUB_ROOT[item.id])}
              title={item.label}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLbl}>{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => navigate(HUB_ROOT.home)}
            title="Home" aria-label="Home"
            style={{ background: 'none', border: 'none', padding: 0, marginLeft: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', outline: 'none', borderRadius: 6, boxShadow: screen?.hub === 'home' ? '0 0 0 2px var(--accent)' : 'none' }}
          >
            <img src={logoUrl} alt="SCE Electric — Home" style={{ height: 52, borderRadius: 6, display: 'block' }} />
          </button>
        </div>
      </header>
      {/* Background helpers: phone sync every 10 min, and slip reading/grabbing */}
      <CloudSync background />
      <SlipGrabber />
      <main className={styles.main}>
        {screen?.hub === 'home' && (
          <Home agingDeficiencyCount={agingDeficiencyCount} ordersAttentionCount={ordersAttentionCount} reviewCount={reviewCount} onOpenHub={(id, view) => {
            if (id === 'customers') navigate(HUB_ROOT.jobs)
            else if (id === 'materials') navigate({ hub: 'materials', view: view || 'ordered' })
            else navigate(HUB_ROOT[id])
          }} />
        )}

        {screen?.hub === 'jobs' && (
          <Jobs screen={screen} navigate={navigate} goBack={goBack} />
        )}

        {screen?.hub === 'quotes' && (
          <Quotes screen={screen} navigate={navigate} goBack={goBack} />
        )}

        {screen?.hub === 'materials' && (
          <Materials screen={screen} navigate={navigate} goBack={goBack} />
        )}

        {screen?.hub === 'orders' && (
          <Orders onAttentionChange={setOrdersAttentionCount} />
        )}

        {screen?.hub === 'review' && (
          <MorningReview onCountChange={setReviewCount} navigate={navigate} />
        )}

        {screen?.hub === 'snapshot' && (
          <Snapshot />
        )}

        {screen?.hub === 'timetracking' && (
          <TimeTracking />
        )}

        {screen?.hub === 'crew' && (
          <Crew />
        )}

        {screen?.hub === 'timesheets' && (
          <Timesheets />
        )}

        {screen?.hub === 'cloudsync' && (
          <CloudSync />
        )}

        {screen?.hub === 'backup' && (
          <Backup />
        )}

        {screen?.hub === 'trash' && (
          <Trash />
        )}

        {screen?.hub === 'notes' && (
          <Notes navigate={navigate} />
        )}

        {screen?.hub === 'billing' && (
          <Billing />
        )}

        {screen?.hub === 'photos' && (
          <Photos />
        )}

        {screen?.hub === 'todo' && (
          <Todo navigate={navigate} />
        )}

        {screen && screen.hub !== 'home' && screen.hub !== 'jobs' && screen.hub !== 'quotes' && screen.hub !== 'materials' && screen.hub !== 'orders' && screen.hub !== 'review' && screen.hub !== 'snapshot' && screen.hub !== 'timesheets' && screen.hub !== 'timetracking' && screen.hub !== 'crew' && screen.hub !== 'cloudsync' && screen.hub !== 'backup' && screen.hub !== 'trash' && screen.hub !== 'notes' && screen.hub !== 'billing' && screen.hub !== 'photos' && screen.hub !== 'todo' && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
              {NAV_ITEMS.find(n => n.id === screen.hub)?.label} — not built yet
            </div>
            <div style={{ fontSize: 13 }}>
              We'll wire this page up when we get to it.
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
