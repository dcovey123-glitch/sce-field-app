import React from 'react'
import TimeTracking from './TimeTracking.jsx'
import Timesheets from './Timesheets.jsx'
import { useLocalStore } from '../api/useLocalStore.js'
import { WEEK_START_KEY, WEEKDAY_NAMES } from '../api/weekStart.js'

// ⏱ Time — Time Tracking and Timesheets as two tabs of one page (opened from
// the Home bubble, like Materials). The week start day lives here too.
export const TIME_VIEWS = [
  { id: 'tracking', label: '⏱ Time Tracking' },
  { id: 'timesheets', label: '🧾 Timesheets' },
]

export default function TimeHub({ view = 'tracking', onView }) {
  const [pending] = useLocalStore('time_pending', [])
  const [weekStart, setWeekStart] = useLocalStore(WEEK_START_KEY, 0)
  const tab = TIME_VIEWS.some(v => v.id === view) ? view : 'tracking'
  const tabStyle = on => ({
    padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none', borderBottom: '3px solid ' + (on ? 'var(--accent)' : 'transparent'),
    background: 'none', color: on ? '#fff' : 'rgba(255,255,255,.6)', fontFamily: 'var(--font-d)', whiteSpace: 'nowrap',
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ background: 'var(--navy)', display: 'flex', alignItems: 'flex-end', gap: 4, padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,.08)', flexWrap: 'wrap' }}>
        {TIME_VIEWS.map(v => (
          <button key={v.id} style={tabStyle(tab === v.id)} onClick={() => onView && onView(v.id)}>
            {v.label}{v.id === 'tracking' && pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <label title="Which day the work week starts on — Timesheets, Time Tracking and the timesheet's material list all follow it. Weeks already filled in keep their dates, so change it between weeks."
          style={{ alignSelf: 'center', fontSize: 11.5, color: 'rgba(255,255,255,.65)', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0' }}>
          ⚙ Week starts on
          <select value={Number(weekStart) || 0} onChange={e => setWeekStart(Number(e.target.value))}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)', color: '#fff' }}>
            {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i} style={{ color: '#000' }}>{d}</option>)}
          </select>
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key: re-draw when the week start changes so every week is recomputed */}
        {tab === 'tracking' ? <TimeTracking key={'tt' + weekStart} embedded /> : <Timesheets key={'ts' + weekStart} />}
      </div>
    </div>
  )
}
