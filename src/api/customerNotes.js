// Customer General Notes — kept on the customer (jobs side):
//   generalNotes: free-text quick notes
//   todos: [{ id, text, at, doneAt? }]  — same shape as the Home Hit List,
//          and open ones show on the Hit List tagged with the customer.

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3)
const arr = l => Array.isArray(l) ? l : []

export const addTodo = (list, text) => {
  const t = String(text || '').trim()
  return t ? [...arr(list), { id: uid(), text: t, at: new Date().toISOString() }] : arr(list)
}
export const setTodoDone = (list, id, done) =>
  arr(list).map(x => x.id !== id ? x : (done ? { ...x, doneAt: new Date().toISOString() } : (({ doneAt, ...rest }) => rest)(x)))
export const removeTodo = (list, id) => arr(list).filter(x => x.id !== id)
export const clearDoneTodos = list => arr(list).filter(x => !x.doneAt)

export const openTodos = list => arr(list).filter(x => !x.doneAt)
export const doneTodos = list => arr(list).filter(x => x.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))

// Every customer's open to-dos for the Hit List, oldest first
// → [{ ...todo, customerId, customerName }]
export function customerTodosForHitList(customers) {
  return arr(customers)
    .filter(c => c && !c.trashedAt)
    .flatMap(c => openTodos(c.todos).map(t => ({ ...t, customerId: c.id, customerName: c.name || 'Customer' })))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
}
