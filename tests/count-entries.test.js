import { describe, it, expect } from 'vitest'
import { rollUp, groupCounts, rollUpLabel, entryForRow } from '../src/api/countEntries.js'

const e = (qty, at, extra = {}) => ({ id: at, kind: 'count', catalogId: 'c1', qty, at, ...extra })

describe('counts and "found more" adds', () => {
  it('a count, then two adds → one total', () => {
    const r = rollUp([e(20, '1'), e(10, '2', { add: true }), e(4, '3', { add: true })], 6)
    expect(r.total).toBe(34)
    expect(rollUpLabel(r)).toBe('count 20 · +10 · +4')
  })
  it('adds with no count add to what is on hand', () => {
    const r = rollUp([e(10, '1', { add: true })], 6)
    expect(r.total).toBe(16)
    expect(rollUpLabel(r)).toBe('on hand 6 · +10')
  })
  it('a new count resets — adds before it are dropped', () => {
    expect(rollUp([e(5, '1', { add: true }), e(30, '2'), e(2, '3', { add: true })], 6).total).toBe(32)
  })
  it('order is by time, whatever order they arrive in', () => {
    expect(rollUp([e(3, '3', { add: true }), e(20, '1')], 0).total).toBe(23)
  })
  it('groups one line per item; new items stay out', () => {
    const g = groupCounts([e(20, '1'), e(10, '2', { add: true }), { id: 'x', kind: 'count', stockId: 's9', qty: 2, at: '1' }, { id: 'n', kind: 'newpart' }], () => 0)
    expect(g.map(x => [x.key, x.rollup.total])).toEqual([['c:c1', 30], ['a:s9', 2]])
  })
  it('matches a row by its Catalog item or any of its lots', () => {
    expect(entryForRow({ catalogId: 'c1' }, { cat: { id: 'c1' } })).toBe(true)
    expect(entryForRow({ stockId: 'l2' }, { stk: { id: 'l1' }, lots: [{ id: 'l1' }, { id: 'l2' }] })).toBe(true)
    expect(entryForRow({ catalogId: 'zz' }, { cat: { id: 'c1' } })).toBe(false)
  })
})
