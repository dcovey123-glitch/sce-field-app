import { fmtDate } from './format.js'
// Job tasks: what has to be done on a job, ticked off with the date and who.
// Kept on the job itself (job.tasks), so it travels with the job's file.
//
// task: { id, text, who, due, notes, createdAt, createdBy, done, doneAt, doneBy }
//
// The phone sees open tasks (sync/tasks.json) and sends back small changes
// (tasks/pending/*.json): { id, op: 'done'|'undo'|'add', jobId, taskId, text, by, at }

export const TEMPLATES_KEY = 'task_templates'
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function newTask(text, by, extra = {}) {
  return { id: uid(), text: String(text || '').trim(), who: '', due: '', notes: '', createdAt: new Date().toISOString(), createdBy: by || '', done: false, doneAt: null, doneBy: '', ...extra }
}

export const tasksOf = job => (Array.isArray(job && job.tasks) ? job.tasks : [])
export const openTasks = job => tasksOf(job).filter(t => !t.done)
export const isOverdue = t => !t.done && t.due && t.due < today()
export const isDueToday = t => !t.done && t.due && t.due === today()

// Function patches, so two quick changes never overwrite each other
export const addTasks = (items) => job => ({ tasks: [...tasksOf(job), ...items] })
export const changeTask = (id, patch) => job => ({ tasks: tasksOf(job).map(t => t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t) })
export const removeTask = id => job => ({ tasks: tasksOf(job).filter(t => t.id !== id) })
export const setDone = (id, done, by, at) => changeTask(id, done
  ? { done: true, doneAt: at || new Date().toISOString(), doneBy: by || '' }
  : { done: false, doneAt: null, doneBy: '' })
export const moveTask = (id, dir) => job => {
  const list = [...tasksOf(job)]
  const open = list.filter(t => !t.done)
  const i = open.findIndex(t => t.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= open.length) return {}
  ;[open[i], open[j]] = [open[j], open[i]]
  return { tasks: [...open, ...list.filter(t => t.done)] }
}

// A phone change, applied to the job it names
export function applyPhoneOp(job, op) {
  if (!op || !job) return null
  const list = tasksOf(job)
  if (op.op === 'add') {
    if (list.some(t => t.id === op.taskId)) return null
    return { tasks: [...list, newTask(op.text, op.by, { id: op.taskId || uid(), createdAt: op.at || new Date().toISOString(), fromPhone: true })] }
  }
  const t = list.find(x => x.id === op.taskId)
  if (!t) return null
  if (op.op === 'done' && !t.done) return setDone(t.id, true, op.by, op.at)(job)
  if (op.op === 'undo' && t.done) return setDone(t.id, false)(job)
  return null
}

// Tasks to start a job from its quote: each scope's written scope lines,
// or its labor lines when no scope text was written
const clean = s => String(s || '').replace(/^\s*(?:[-–•*●▪◦]|\d+[.)]|[a-z][.)])\s*/i, '').trim()
export function tasksFromQuote(quote) {
  const out = []
  const scopes = (quote && quote.scopes) || []
  scopes.forEach((sc, i) => {
    const head = scopes.length > 1 ? (sc.name || `Scope ${i + 1}`) + ': ' : ''
    const lines = String(sc.scopeText || '').split(/\r?\n/).map(clean)
      .filter(l => l.length > 3 && !/^scope of work/i.test(l) && !/^(includes?|excludes?|exclusions?|notes?)\s*:?$/i.test(l))
    const fromLabor = (sc.labor || []).map(l => clean(l.desc || l.description || l.name)).filter(l => l.length > 3)
    const use = lines.length ? lines : fromLabor
    if (!use.length && sc.name) out.push(clean(sc.name))
    use.forEach(l => out.push(head + l))
  })
  return [...new Set(out)].slice(0, 60)
}

// Phone snapshot: open tasks on jobs still on the go, plus anything ticked
// in the last 14 days so the crew can see it went through
export function phoneTasksPayload(jobs, customers) {
  const cut = Date.now() - 14 * 86400000
  const cust = id => (customers.find(c => c.id === id) || {}).name || ''
  return {
    updatedAt: new Date().toISOString(),
    jobs: (jobs || []).filter(j => !j.trashedAt && tasksOf(j).length)
      .map(j => ({
        jobId: j.id, name: j.name || 'Job', customer: cust(j.customerId),
        tasks: tasksOf(j).filter(t => !t.done || Date.parse(t.doneAt) > cut)
          .map(t => ({ id: t.id, text: t.text, who: t.who || '', due: t.due || '', notes: t.notes || '', done: !!t.done, doneAt: t.doneAt || null, doneBy: t.doneBy || '' })),
      }))
      .filter(j => j.tasks.length),
  }
}

export const fmtDay = iso => fmtDate(iso)
