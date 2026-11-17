// Moving Labor Actual entries from one job to another (e.g. hours booked on
// the main job that belong on its Lighting sub-job), and spotting entries
// that were typed in by hand AND posted from the clock (the same hours twice).
//
// Clock time follows its labor: an entry posted from the crew clock carries
// fromTracked = '<trackedId>|<worker>'. When it moves, that worker's share of
// the tracked entry moves too — otherwise the old job would show the time as
// "not posted" and offer to post it again, and the new job would show it as
// labor nobody clocked.

const n = v => Number(v) || 0
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// Hand-typed entries that match a clock-posted one (same day, worker, hours).
// One typed entry per posted entry; returns { [typedId]: postedId }.
export function duplicateLabor(project) {
  const entries = project.laborEntries || []
  const posted = entries.filter(e => e.fromTracked)
  const typed = entries.filter(e => !e.fromTracked && !e.fromPool && !e.movedFrom)
  const used = new Set()
  const out = {}
  for (const p of posted) {
    const t = typed.find(x => !used.has(x.id) && x.date === p.date && sameName(x.worker, p.worker) && Math.abs(n(x.hours) - n(p.hours)) < 0.001)
    if (t) { used.add(t.id); out[t.id] = p.id }
  }
  return out
}

// → { source: patch, target: patch } — laborEntries, laborRates, trackedTime.
// sourceRates / targetRates: each job's labor rates as the app shows them.
export function moveLabor({ source, target, ids, sourceRates, targetRates, now = new Date().toISOString() }) {
  const pick = new Set(ids || [])
  const all = source.laborEntries || []
  const moving = all.filter(e => pick.has(e.id))
  if (!moving.length || !target || target.id === source.id) return null

  // rates the moved entries use, added to the target if it doesn't have them
  let tRates = [...(targetRates || [])]
  let ratesChanged = false
  for (const e of moving) {
    if (!e.rateId || tRates.some(r => r.id === e.rateId)) continue
    const r = (sourceRates || []).find(x => x.id === e.rateId)
    if (r) { tRates = [...tRates, { ...r }]; ratesChanged = true }
  }

  // clock time that goes with them
  let sTracked = (source.trackedTime || []).map(t => ({ ...t }))
  let tTracked = (target.trackedTime || []).map(t => ({ ...t }))
  const trackedChanged = moving.some(e => e.fromTracked)
  for (const e of moving.filter(x => x.fromTracked)) {
    const [tid, worker] = String(e.fromTracked).split('|')
    const src = sTracked.find(t => t.id === tid)
    if (!src) continue
    const ws = src.workers || []
    const i = ws.findIndex(w => sameName(w, worker))
    if (i < 0) continue
    const wid = (src.workerIds || [])[i]
    const left = ws.filter((_, k) => k !== i)
    const leftIds = (src.workerIds || []).filter((_, k) => k !== i)
    if (left.length) {
      sTracked = sTracked.map(t => t.id === tid ? { ...t, workers: left, ...(src.workerIds ? { workerIds: leftIds } : {}), totalHours: Math.round(n(t.hoursEach) * left.length * 100) / 100 } : t)
    } else sTracked = sTracked.filter(t => t.id !== tid)
    const there = tTracked.find(t => t.id === tid)
    if (there) {
      const w2 = [...(there.workers || []), ws[i]]
      tTracked = tTracked.map(t => t.id === tid ? { ...t, workers: w2, ...(wid ? { workerIds: [...(t.workerIds || []), wid] } : {}), totalHours: Math.round(n(t.hoursEach) * w2.length * 100) / 100 } : t)
    } else {
      tTracked = [...tTracked, { ...src, workers: [ws[i]], ...(wid ? { workerIds: [wid] } : { workerIds: undefined }), totalHours: n(src.hoursEach), movedFrom: { jobId: source.id, at: now } }]
    }
  }

  const sourcePatch = { laborEntries: all.filter(e => !pick.has(e.id)) }
  const targetPatch = { laborEntries: [...(target.laborEntries || []), ...moving.map(e => ({ ...e, movedFrom: { jobId: source.id, jobName: source.name || '', at: now } }))] }
  if (ratesChanged) targetPatch.laborRates = tRates
  if (trackedChanged) { sourcePatch.trackedTime = sTracked; targetPatch.trackedTime = tTracked.map(t => { const c = { ...t }; if (c.workerIds === undefined) delete c.workerIds; return c }) }
  return { source: sourcePatch, target: targetPatch, targetRates: tRates }
}

// Jobs to move to: sub-jobs / parent on the same job family first, then the
// same customer, then everything else that's still live.
export function moveTargets(jobs, project) {
  const live = (jobs || []).filter(j => j && !j.trashedAt && j.id !== project.id)
  const family = j => j.relatedJobId === project.id || (project.relatedJobId && (j.id === project.relatedJobId || j.relatedJobId === project.relatedJobId))
  const rank = j => family(j) ? 0 : j.customerId === project.customerId ? 1 : 2
  return live.slice().sort((a, b) => rank(a) - rank(b) || String(a.name || '').localeCompare(String(b.name || ''))).map(j => ({ job: j, family: family(j), sameCustomer: j.customerId === project.customerId }))
}
