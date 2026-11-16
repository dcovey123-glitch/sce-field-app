// Customer General Notes — kept on the customer (jobs side):
//   generalNotes: free-text quick notes
//   todos: [{ id, text, at, editedAt?, doneAt?, priority? }]  (priority 'high' | '' | 'low')  — same shape as the Home Hit List,
//          and open ones show on the Hit List tagged with the customer.

import { norm, byPriority } from './priority.js'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)
const arr = l => Array.isArray(l) ? l : []

export const addTodo = (list, text) => {
  const t = String(text || '').trim()
  return t ? [...arr(list), { id: uid(), text: t, at: new Date().toISOString() }] : arr(list)
}
export const setTodoDone = (list, id, done) =>
  arr(list).map(x => x.id !== id ? x : (done ? { ...x, doneAt: new Date().toISOString() } : (({ doneAt, ...rest }) => rest)(x)))
// Changing the words stamps editedAt (for the "days since last edit" count)
export const editTodo = (list, id, text) => {
  const t = String(text || '').trim()
  return t ? arr(list).map(x => x.id === id && x.text !== t ? { ...x, text: t, editedAt: new Date().toISOString() } : x) : arr(list)
}
// High / normal / Low — see priority.js
export const setTodoPriority = (list, id, priority) => arr(list).map(x => x.id === id ? { ...x, priority: norm(priority) } : x)
export const removeTodo = (list, id) => arr(list).filter(x => x.id !== id)
export const clearDoneTodos = list => arr(list).filter(x => !x.doneAt)

export const openTodos = list => byPriority(arr(list).filter(x => !x.doneAt))
export const doneTodos = list => arr(list).filter(x => x.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))

// Every customer's open to-dos for the Hit List: High first, then oldest first
// → [{ ...todo, customerId, customerName }]
export function customerTodosForHitList(customers) {
  return byPriority(arr(customers)
    .filter(c => c && !c.trashedAt && !c.sleepingAt)
    .flatMap(c => openTodos(c.todos).map(t => ({ ...t, customerId: c.id, customerName: c.name || 'Customer' })))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))))
}
