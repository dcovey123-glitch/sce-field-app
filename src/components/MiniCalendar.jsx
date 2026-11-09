import React, { useState } from 'react'
import { useCalendar } from '../api/useCalendar.js'
import { monthGrid, daySummary } from '../api/calendar.js'
import { MonthGrid } from '../pages/Calendar.jsx'
import { todayLocal } from '../api/albertaTime.js'
import { fmtDate } from '../api/format.js'
import { weekStartDay } from '../api/weekStart.js'

// Home: this month at a glance. Hover a date for what's on; click it to open
// that day in the Calendar.
export default function MiniCalendar({ onOpenDay }) {
  const today = todayLocal()
  const [ym, setYm] = useState(today.slice(0, 7))
  const [y, m] = ym.split('-').map(Number)
  const grid = monthGrid(y, m, weekStartDay())
  const { days } = useCalendar(grid[0][0].date, grid[grid.length - 1][6].date)
  const [tip, setTip] = useState(null) // { date, top, left }
  const shift = k => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(d.toISOString().slice(0, 7)) }
  const open = d => (window.desktop?.openCalendarWindow ? window.desktop.openCalendarWindow(d) : onOpenDay && onOpenDay(d))
  const lines = tip ? daySummary(days[tip.date]) : []
  const next = Object.values(days).filter(d => d.date >= today && d.schedule.length).sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <div data-minical onClick={e => e.stopPropagation()} style={{ width: 236, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 4px 18px rgba(15,30,46,.10)', padding: 10, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <button onClick={() => shift(-1)} style={nav}>‹</button>
        <button onClick={() => open(today)} title="Open the Calendar" style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-d)', fontWeight: 800, fontSize: 13.5, color: 'var(--text)' }}>📅 {fmtDate(ym, 'monthYear')}</button>
        <button onClick={() => shift(1)} style={nav}>›</button>
      </div>
      <MonthGrid compact year={y} month={m} days={days} today={today} selected={null} onPick={open}
        onHover={(date, el) => {
          if (!date) return setTip(null)
          const box = el.getBoundingClientRect(), host = el.closest('[data-minical]').getBoundingClientRect()
          setTip({ date, top: box.bottom - host.top + 4, left: 3 })
        }} />
      {next && <div onClick={() => open(next.date)} style={{ marginTop: 6, fontSize: 11, color: 'var(--text-mid)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Next: <b>{next.date === today ? 'Today' : fmtDate(next.date, 'weekday')}</b> · {next.schedule[0].title}
      </div>}
      {tip && (
        <div style={{ position: 'absolute', top: tip.top, left: Math.max(tip.left, 0), width: 230, zIndex: 60, background: 'var(--navy, #0f1e2e)', color: '#fff', borderRadius: 8, padding: '8px 10px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', pointerEvents: 'none' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, marginBottom: 3 }}>{fmtDate(tip.date, 'weekdayLong')}</div>
          {lines.length ? lines.map((l, i) => <div key={i} style={{ fontSize: 11, lineHeight: 1.45, opacity: .92 }}>{l}</div>) : <div style={{ fontSize: 11, opacity: .7 }}>Nothing on yet</div>}
          <div style={{ fontSize: 10, opacity: .55, marginTop: 4 }}>Click to open the day</div>
        </div>
      )}
    </div>
  )
}
const nav = { width: 24, height: 24, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 0 }
