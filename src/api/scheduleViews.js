// Crew Schedule views: Day (detailed) and Week (summary), grouped by person
// or by job, plus the printable HTML for the PDF export.
//
// Pure functions: the screen hands in the assignments, the people and the
// work list (schedule.js → buildWorkList), these work out what to show.

import { BACKEND, hoursOf, timeText, blockTitle, dayLabel, parseClock } from './schedule.js'

const r2 = v => Math.round((Number(v) || 0) * 100) / 100
const norm = s => String(s || '').trim().toLowerCase()
const byStart = (x, y) => (parseClock(x.start) ?? 9999) - (parseClock(y.start) ?? 9999)
const has = (a, p) => (a.workers || []).some(w => norm(w) === norm(p))
const first = n => String(n || '').split(' ')[0]

// What a block belongs to when grouping by job: the job, the office bucket,
// or the "other" label
export function groupOf(a, workList = []) {
  if (a.kind === 'job') {
    const w = workList.find(x => x.jobId === a.jobId)
    return { key: 'job:' + a.jobId, label: w ? w.name : (a.title || 'Job'), sub: w ? w.customer : '', kind: 'job', requiredBy: (w && w.requiredBy) || '' }
  }
  if (a.kind === 'office') return { key: 'office:' + (a.bucket || ''), label: BACKEND[a.bucket] || a.title || 'Office', sub: 'Quoting / admin', kind: 'office', requiredBy: '' }
  const t = String(a.title || 'Other').trim() || 'Other'
  return { key: 'other:' + norm(t), label: t, sub: '', kind: 'other', requiredBy: '' }
}

// Everything worth printing about one block
export function blockDetail(a, workList = []) {
  const w = a.kind === 'job' ? workList.find(x => x.jobId === a.jobId) : null
  const taskText = id => ((w && w.openTasks.find(t => t.id === id)) || {}).text || 'Task (done or removed)'
  const defText = id => ((w && w.openDefs.find(d => d.id === id)) || {}).text || 'Deficiency (resolved or removed)'
  return {
    id: a.id, date: a.date, kind: a.kind,
    time: timeText(a), start: a.start || '', hours: hoursOf(a),
    title: blockTitle(a, workList),
    job: a.kind === 'job' && a.title && w ? w.name : '',
    customer: w ? w.customer : '',
    workers: [...(a.workers || [])],
    tasks: (a.taskIds || []).map(taskText),
    defs: (a.defIds || []).map(defText),
    notes: a.notes || '',
    raw: a,
  }
}

// The roster, plus anyone booked who isn't on it (so nobody drops off a print)
export function peopleList(people, assignments) {
  const out = [...(people || [])]
  for (const a of assignments || []) for (const w of a.workers || []) if (!out.some(p => norm(p) === norm(w))) out.push(w)
  return out
}

// ── Day (detailed) ──
// → [{ person, blocks: [detail], hours }]
export function dayByPerson(date, assignments, people, workList = []) {
  const day = (assignments || []).filter(a => a.date === date).sort(byStart)
  return peopleList(people, day).map(p => {
    const blocks = day.filter(a => has(a, p)).map(a => blockDetail(a, workList))
    return { person: p, blocks, hours: r2(blocks.reduce((s, b) => s + b.hours, 0)) }
  })
}
// → [{ group, blocks: [detail], people: [name], personHours }]
export function dayByGroup(date, assignments, workList = []) {
  const day = (assignments || []).filter(a => a.date === date).sort(byStart)
  const map = new Map()
  for (const a of day) {
    const g = groupOf(a, workList)
    if (!map.has(g.key)) map.set(g.key, { group: g, blocks: [], people: [], personHours: 0 })
    const row = map.get(g.key)
    const d = blockDetail(a, workList)
    row.blocks.push(d)
    for (const w of d.workers) if (!row.people.some(p => norm(p) === norm(w))) row.people.push(w)
    row.personHours = r2(row.personHours + d.hours * Math.max(1, d.workers.length))
  }
  const kindOrder = { job: 0, other: 1, office: 2 }
  return [...map.values()].sort((x, y) => kindOrder[x.group.kind] - kindOrder[y.group.kind] || byStart(x.blocks[0].raw, y.blocks[0].raw) || x.group.label.localeCompare(y.group.label))
}

// ── Week (summary) ──
// By person → { rows: [{ person, cells: { [date]: [{ label, hours, id }] }, total }], dayTotals: { [date]: h }, total }
export function weekByPerson(dates, assignments, people, workList = []) {
  const inWeek = (assignments || []).filter(a => dates.includes(a.date))
  const dayTotals = Object.fromEntries(dates.map(d => [d, 0]))
  const rows = peopleList(people, inWeek).map(p => {
    const cells = {}
    let total = 0
    for (const d of dates) {
      const list = inWeek.filter(a => a.date === d && has(a, p)).sort(byStart)
      cells[d] = list.map(a => ({ id: a.id, label: groupOf(a, workList).label, kind: a.kind, hours: hoursOf(a), raw: a }))
      const h = cells[d].reduce((s, c) => s + c.hours, 0)
      total += h
      dayTotals[d] = r2(dayTotals[d] + h)
    }
    return { person: p, cells, total: r2(total) }
  })
  return { rows, dayTotals, total: r2(rows.reduce((s, r) => s + r.total, 0)) }
}
// By job → { rows: [{ group, cells: { [date]: [{ workers, hours, id }] }, total (person-hours) }], dayTotals, total }
export function weekByGroup(dates, assignments, workList = []) {
  const inWeek = (assignments || []).filter(a => dates.includes(a.date)).sort(byStart)
  const dayTotals = Object.fromEntries(dates.map(d => [d, 0]))
  const map = new Map()
  for (const a of inWeek) {
    const g = groupOf(a, workList)
    if (!map.has(g.key)) map.set(g.key, { group: g, cells: Object.fromEntries(dates.map(d => [d, []])), total: 0 })
    const row = map.get(g.key)
    const ph = r2(hoursOf(a) * Math.max(1, (a.workers || []).length))
    row.cells[a.date].push({ id: a.id, workers: [...(a.workers || [])], hours: hoursOf(a), personHours: ph, raw: a })
    row.total = r2(row.total + ph)
    dayTotals[a.date] = r2(dayTotals[a.date] + ph)
  }
  const kindOrder = { job: 0, other: 1, office: 2 }
  const rows = [...map.values()].sort((x, y) => kindOrder[x.group.kind] - kindOrder[y.group.kind] || x.group.label.localeCompare(y.group.label))
  return { rows, dayTotals, total: r2(rows.reduce((s, r) => s + r.total, 0)) }
}

// ── Printable HTML (the desktop app turns it into a PDF) ──
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hrs = h => `${r2(h)} h`
const CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b2430; margin: 0; font-size: 10.5px; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #1f3a5f; padding-bottom: 8px; margin-bottom: 10px; }
  .head img { height: 42px; }
  .head h1 { font-size: 18px; margin: 0; color: #1f3a5f; }
  .head .sub { color: #5a6573; font-size: 11px; }
  .head .right { margin-left: auto; text-align: right; color: #5a6573; font-size: 10px; }
  .meet { background: #fbf4e2; border: 1px solid #e6d3a3; border-radius: 6px; padding: 6px 9px; margin-bottom: 10px; }
  .meet b { color: #6b5413; }
  .card { border: 1px solid #cdd5df; border-radius: 6px; margin-bottom: 8px; page-break-inside: avoid; }
  .card .ch { background: #eef2f7; padding: 5px 9px; display: flex; gap: 8px; align-items: baseline; border-bottom: 1px solid #cdd5df; }
  .card .ch .name { font-weight: 700; font-size: 12px; color: #1f3a5f; }
  .card .ch .meta { color: #5a6573; }
  .card .ch .tot { margin-left: auto; font-weight: 700; }
  .blk { padding: 5px 9px; border-top: 1px solid #e6ebf1; display: grid; grid-template-columns: 120px 1fr; gap: 8px; }
  .blk:first-of-type { border-top: none; }
  .blk .t { font-weight: 700; white-space: nowrap; }
  .blk .ti { font-weight: 700; }
  .blk .m { color: #5a6573; }
  .blk ul { margin: 2px 0 0 14px; padding: 0; }
  .blk .def { color: #8e1f14; }
  .none { padding: 5px 9px; color: #8a94a1; font-style: italic; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cdd5df; padding: 4px 5px; vertical-align: top; text-align: left; }
  th { background: #1f3a5f; color: #fff; font-size: 10.5px; }
  td.rowh { font-weight: 700; color: #1f3a5f; background: #eef2f7; }
  td.rowh .meta { font-weight: 400; color: #5a6573; font-size: 9.5px; }
  td.tot, th.tot { text-align: right; width: 58px; font-weight: 700; }
  tr.foot td { background: #eef2f7; font-weight: 700; }
  .it { margin: 1px 0; }
  .it .h { color: #5a6573; }
  .k-office { color: #7a5a00; }
  .k-other { color: #555; }
  .empty { color: #b3bbc5; }
  .foot-note { margin-top: 8px; color: #8a94a1; font-size: 9.5px; }
`
function header(title, sub, logo) {
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `<div class="head">${logo ? `<img src="${logo}">` : ''}<div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div><div class="right">SCE Electric Western Canada Ltd.<br>Printed ${esc(now)}</div></div>`
}
function blockHtml(b, showWho) {
  const meta = [b.job, b.customer, showWho && b.workers.length ? b.workers.join(', ') : ''].filter(Boolean).join(' · ')
  const list = [...b.tasks.map(t => `<li>${esc(t)}</li>`), ...b.defs.map(d => `<li class="def">Deficiency: ${esc(d)}</li>`)].join('')
  return `<div class="blk"><div class="t">${esc(b.time || '—')}</div><div><div class="ti">${esc(b.title)}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ''}${list ? `<ul>${list}</ul>` : ''}${b.notes ? `<div class="m">${esc(b.notes)}</div>` : ''}</div></div>`
}

export function scheduleDayHtml({ date, group, byPerson, byGroup, meetings, logo }) {
  const ms = (meetings && meetings.meetings) || []
  const meetHtml = ms.length ? `<div class="meet"><b>Meetings:</b> ${ms.map(m => `${esc(m.start || 'All day')} ${esc(m.title)}`).join(' &nbsp;·&nbsp; ')}</div>` : ''
  let body = ''
  if (group === 'job') {
    body = byGroup.length ? byGroup.map(r => `<div class="card"><div class="ch"><span class="name">${esc(r.group.label)}</span><span class="meta">${esc([r.group.sub, r.group.requiredBy && `required by ${dayLabel(r.group.requiredBy)}`, r.people.join(', ')].filter(Boolean).join(' · '))}</span><span class="tot">${hrs(r.personHours)} crew</span></div>${r.blocks.map(b => blockHtml(b, true)).join('')}</div>`).join('') : '<div class="none">Nothing booked.</div>'
  } else {
    body = byPerson.map(r => `<div class="card"><div class="ch"><span class="name">${esc(r.person)}</span><span class="tot">${hrs(r.hours)}</span></div>${r.blocks.length ? r.blocks.map(b => blockHtml({ ...b, workers: b.workers.filter(w => norm(w) !== norm(r.person)) }, true)).join('') : '<div class="none">Nothing booked</div>'}</div>`).join('')
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${header(`Crew Schedule — ${dayLabel(date)}`, group === 'job' ? 'Day detail · by job' : 'Day detail · by person', logo)}${meetHtml}${body}</body></html>`
}

export function scheduleWeekHtml({ dates, group, week, logo }) {
  const cols = dates.map(d => `<th>${esc(dayLabel(d))}</th>`).join('')
  let rows = ''
  if (group === 'job') {
    rows = week.rows.map(r => `<tr><td class="rowh">${esc(r.group.label)}${r.group.sub ? `<div class="meta">${esc(r.group.sub)}</div>` : ''}</td>${dates.map(d => {
      const c = r.cells[d] || []
      return `<td>${c.length ? c.map(x => `<div class="it">${esc(x.workers.map(first).join(', '))} <span class="h">${hrs(x.hours)}</span></div>`).join('') : '<span class="empty">—</span>'}</td>`
    }).join('')}<td class="tot">${hrs(r.total)}</td></tr>`).join('')
  } else {
    rows = week.rows.map(r => `<tr><td class="rowh">${esc(r.person)}</td>${dates.map(d => {
      const c = r.cells[d] || []
      return `<td>${c.length ? c.map(x => `<div class="it k-${x.kind}">${esc(x.label)} <span class="h">${hrs(x.hours)}</span></div>`).join('') : '<span class="empty">—</span>'}</td>`
    }).join('')}<td class="tot">${hrs(r.total)}</td></tr>`).join('')
  }
  const foot = `<tr class="foot"><td>Total${group === 'job' ? ' (crew hours)' : ''}</td>${dates.map(d => `<td>${hrs(week.dayTotals[d] || 0)}</td>`).join('')}<td class="tot">${hrs(week.total)}</td></tr>`
  const title = `Crew Schedule — ${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${header(title, group === 'job' ? 'Week summary · by job' : 'Week summary · by person', logo)}<table><thead><tr><th style="width:150px">${group === 'job' ? 'Job' : 'Person'}</th>${cols}<th class="tot">Total</th></tr></thead><tbody>${rows || `<tr><td colspan="${dates.length + 2}" class="empty">Nothing booked.</td></tr>`}${foot}</tbody></table>${group === 'job' ? '<div class="foot-note">Crew hours = block hours × people on the block.</div>' : ''}</body></html>`
}
