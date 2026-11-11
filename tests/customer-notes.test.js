import { describe, it, expect } from 'vitest'
import { addTodo, setTodoDone, removeTodo, clearDoneTodos, openTodos, doneTodos, customerTodosForHitList } from '../src/api/customerNotes.js'

describe('customer to-dos', () => {
  it('add, tick, untick, remove, clear done', () => {
    let l = addTodo([], '  Order breakers ')
    l = addTodo(l, 'Call Edwin'); l = addTodo(l, '   ')
    expect(l.map(x => x.text)).toEqual(['Order breakers', 'Call Edwin'])
    l = setTodoDone(l, l[0].id, true)
    expect(openTodos(l).map(x => x.text)).toEqual(['Call Edwin'])
    expect(doneTodos(l)).toHaveLength(1)
    l = setTodoDone(l, l[0].id, false)
    expect(l[0].doneAt).toBeUndefined()
    l = setTodoDone(l, l[1].id, true)
    expect(clearDoneTodos(l).map(x => x.text)).toEqual(['Order breakers'])
    expect(removeTodo(l, l[0].id)).toHaveLength(1)
  })
  it('the Hit List gets every customer\'s open to-dos, tagged, oldest first', () => {
    const customers = [
      { id: 'a', name: 'RDP', todos: [{ id: '1', text: 'Panel B labels', at: '2026-11-10' }, { id: '2', text: 'done one', at: '2026-11-01', doneAt: '2026-11-02' }] },
      { id: 'b', name: 'Residence', todos: [{ id: '3', text: 'Gate operator', at: '2026-11-05' }] },
      { id: 'c', name: 'Old', trashedAt: 'x', todos: [{ id: '4', text: 'nope', at: '2026-01-01' }] },
      { id: 'd', name: 'None' },
    ]
    expect(customerTodosForHitList(customers).map(t => `${t.customerName}: ${t.text}`)).toEqual(['Residence: Gate operator', 'RDP: Panel B labels'])
  })
})
