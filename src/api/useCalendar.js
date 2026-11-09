// Everything the calendar needs, gathered from the app, plus your own events
// and Outlook appointments (brought in by the morning email run).
import { useEffect, useMemo, useState } from 'react'
import { useHubStore } from './useHubStore.js'
import { useLocalStore } from './useLocalStore.js'
import { CALENDAR_KEY, buildDays } from './calendar.js'

export function useOutlookAppointments() {
  const [outlook, setOutlook] = useState({ events: [], updatedAt: null })
  useEffect(() => {
    let live = true
    const load = () => window.desktop?.calendarOutlookLoad?.().then(r => { if (live && r) setOutlook({ events: Array.isArray(r.events) ? r.events : [], updatedAt: r.updatedAt || null }) }).catch(() => {})
    load()
    const t = setInterval(load, 10 * 60 * 1000) // the morning run may land while the app is open
    return () => { live = false; clearInterval(t) }
  }, [])
  return outlook
}

export function useCalendar(from, to) {
  const jobsHub = useHubStore({ hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name, customersKey: 'job_customers', recordsKey: 'job_projects' })
  const quotesHub = useHubStore({ hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber, customersKey: 'quote_customers', recordsKey: 'quote_quotes' })
  const [events, setEvents] = useLocalStore(CALENDAR_KEY, [])
  const [nonJob] = useLocalStore('time_nonjob_log', [])
  const [dailyNotes] = useLocalStore('daily_notes', {})
  const [orders] = useLocalStore('material_orders', [])
  const outlook = useOutlookAppointments()
  const days = useMemo(() => buildDays(from, to, {
    jobs: jobsHub.records, customers: jobsHub.customers, quotes: quotesHub.records,
    nonJob, events, outlook: outlook.events, dailyNotes, orders,
  }), [from, to, jobsHub.records, jobsHub.customers, quotesHub.records, nonJob, events, outlook.events, dailyNotes, orders])
  const jobOptions = useMemo(() => (jobsHub.records || []).filter(j => !j.trashedAt)
    .map(j => ({ ...j, customerName: (jobsHub.customers.find(c => c.id === j.customerId) || {}).name || '' })), [jobsHub.records, jobsHub.customers])
  return { days, events, setEvents, outlookUpdatedAt: outlook.updatedAt, loading: jobsHub.loading, jobOptions, jobsHub }
}
