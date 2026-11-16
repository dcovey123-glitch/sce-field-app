import { describe, it, expect } from 'vitest'
import { removePlanLinesFromOrderList, removePlanRefsFromRequests, addPlanLinesToOrderList } from '../src/api/materialPlan.js'
import { modeOf, changedSlipLines, applySlipLineChanges, AUTOMATIONS } from '../src/api/automations.js'
import { resolvePoEmailsPending } from '../src/api/orders.js'
import { isKnownKey } from '../src/api/settings.js'

let n = 0
const uid = () => 'u' + (++n)
const jobA = { id: 'A', name: 'Job A' }
const jobB = { id: 'B', name: 'Job B' }

describe('taking plan lines off the order sheet', () => {
  it('drops a sheet line that only existed for that plan line', () => {
    const list = addPlanLinesToOrderList([], jobA, [{ id: 'l1', partNo: 'X1', item: 'Box', qty: 4 }], uid)
    const r = removePlanLinesFromOrderList(list, 'A', ['l1'])
    expect(r.list).toEqual([])
    expect(r.removed).toBe(1)
  })
  it('keeps the other job\'s share of a merged line', () => {
    let list = addPlanLinesToOrderList([], jobA, [{ id: 'l1', partNo: 'X1', item: 'Box', qty: 4 }], uid)
    list = addPlanLinesToOrderList(list, jobB, [{ id: 'm1', partNo: 'X1', item: 'Box', qty: 6 }], uid)
    expect(list).toHaveLength(1)
    expect(list[0].qty).toBe(10)
    const r = removePlanLinesFromOrderList(list, 'A', ['l1'])
    expect(r.list).toHaveLength(1)
    expect(r.list[0].qty).toBe(6)
    expect(r.list[0].planRefs.map(p => p.jobId)).toEqual(['B'])
    expect(r.list[0].jobName).toBe('Job B')
  })
  it('never touches lines you typed on the sheet yourself', () => {
    const list = [{ id: 's1', qty: 3, partNo: 'Y', desc: 'Wire', planRefs: [] }, { id: 's2', qty: 2, desc: 'Tape' }]
    expect(removePlanLinesFromOrderList(list, 'A', ['l1']).list).toEqual(list)
  })
  it('keeps extra qty you added on top of a plan line', () => {
    const list = [{ id: 's1', qty: 10, partNo: 'X1', desc: 'Box', source: 'plan', planRefs: [{ jobId: 'A', jobName: 'Job A', lineId: 'l1', qty: 4 }] }]
    const r = removePlanLinesFromOrderList(list, 'A', ['l1'])
    expect(r.list).toHaveLength(1)
    expect(r.list[0].qty).toBe(6)
    expect(r.list[0].planRefs).toEqual([])
  })
})

describe('taking plan lines off requests already sent', () => {
  it('removes the job line so a returning quote is not tagged to the job', () => {
    const reqs = [{ id: 'r1', items: [{ partNo: 'X1', planRefs: [{ jobId: 'A', lineId: 'l1', qty: 4 }, { jobId: 'B', lineId: 'm1', qty: 6 }] }] }]
    const { list, touched } = removePlanRefsFromRequests(reqs, 'A', ['l1'])
    expect(touched).toHaveLength(1)
    expect(list[0].items[0].planRefs.map(p => p.jobId)).toEqual(['B'])
    expect(list[0].items[0].droppedRefs[0].lineId).toBe('l1')
  })
  it('leaves removed requests and other jobs alone', () => {
    const reqs = [{ id: 'r1', removedAt: 'x', items: [{ planRefs: [{ jobId: 'A', lineId: 'l1' }] }] }]
    expect(removePlanRefsFromRequests(reqs, 'A', ['l1']).touched).toHaveLength(0)
  })
})

describe('automation switches', () => {
  it('defaults every automation to Ask first', () => {
    for (const a of AUTOMATIONS) expect(modeOf({}, a.id)).toBe('ask')
  })
  it('ignores a mode an automation does not allow', () => {
    expect(modeOf({ 'pricing-match': 'auto' }, 'pricing-match')).toBe('ask')
    expect(modeOf({ 'po-emails': 'off' }, 'po-emails')).toBe('off')
  })
  it('every automation offers a manual bypass (Off) and Ask first', () => {
    for (const a of AUTOMATIONS) { expect(a.modes).toContain('off'); expect(a.modes).toContain('ask') }
  })
  it('its data names are on the data list', () => {
    expect(isKnownKey('automation_modes')).toBe(true)
    expect(isKnownKey('automation_skipped')).toBe(true)
  })
})

describe('applying only the slip line changes you OK', () => {
  const before = [{ id: 'o1', lineItems: [{ name: 'a' }, { name: 'b' }] }, { id: 'o2', lineItems: [{ name: 'c' }] }]
  const after = [{ id: 'o1', lineItems: [{ name: 'a', jobIds: ['A'] }, { name: 'b', jobIds: ['B'] }] }, before[1]]
  it('lists each changed line', () => {
    expect(changedSlipLines(before, after).map(c => c.key)).toEqual(['o1#0', 'o1#1'])
  })
  it('applies just the chosen ones', () => {
    const r = applySlipLineChanges(before, after, ['o1#1'])
    expect(r[0].lineItems[0]).toEqual({ name: 'a' })
    expect(r[0].lineItems[1].jobIds).toEqual(['B'])
    expect(r[1]).toBe(before[1])
  })
})

describe('PO emails waiting for your OK', () => {
  const local = { overrides: {}, poEmailsPending: {
    'f1|q1': { key: 'f1|q1', rowId: 'q1', po: '1234', file: 'f1' },
    'f2|q1': { key: 'f2|q1', rowId: 'q1', po: '9999', file: 'f2' },
    'f3|q2': { key: 'f3|q2', rowId: 'q2', po: '5555', file: 'f3' },
  } }
  it('apply puts the PO on the quote and clears other matches for that quote', () => {
    const r = resolvePoEmailsPending(local, ['f1|q1'], true)
    expect(r.overrides.q1.poNumber).toBe('1234')
    expect(Object.keys(r.poEmailsPending)).toEqual(['f3|q2'])
  })
  it('skip removes it without touching the quote', () => {
    const r = resolvePoEmailsPending(local, ['f3|q2'], false)
    expect(r.overrides.q2).toBeUndefined()
    expect(r.poEmailsPending['f3|q2']).toBeUndefined()
  })
})

import { changeTask, setDone, daysSinceEdit } from '../src/api/tasks.js'
describe('task age (days since last edit)', () => {
  const job = { tasks: [{ id: 't1', text: 'Pull wire', createdAt: '2026-11-01T10:00:00' }] }
  it('editing the words stamps editedAt; ticking done does not', () => {
    const edited = changeTask('t1', { text: 'Pull wire to 2104' })(job).tasks[0]
    expect(edited.editedAt).toBeTruthy()
    const ticked = setDone('t1', true, 'Dustin')(job).tasks[0]
    expect(ticked.editedAt).toBeUndefined()
    const same = changeTask('t1', { text: 'Pull wire' })(job).tasks[0]
    expect(same.editedAt).toBeUndefined()
  })
  it('counts whole days from the last edit, or from when it was added', () => {
    const now = Date.parse('2026-11-15T09:00:00')
    expect(daysSinceEdit({ createdAt: '2026-11-01T10:00:00' }, now)).toBe(14)
    expect(daysSinceEdit({ createdAt: '2026-11-01T10:00:00', editedAt: '2026-11-15T08:00:00' }, now)).toBe(0)
  })
})

import { editTodo } from '../src/api/customerNotes.js'
import { automationById } from '../src/api/automations.js'
describe('customer to-dos and Trash', () => {
  it('editing a customer to-do stamps editedAt; same words or blank changes nothing', () => {
    const l = [{ id: 'a', text: 'Call re: gate code', at: '2026-11-01T10:00:00' }]
    expect(editTodo(l, 'a', 'Call Edwin re: gate code')[0].editedAt).toBeTruthy()
    expect(editTodo(l, 'a', 'Call re: gate code')[0].editedAt).toBeUndefined()
    expect(editTodo(l, 'a', '  ')[0].text).toBe('Call re: gate code')
  })
  it('emptying Trash after 30 days is an automation with Ask first and Off', () => {
    const a = automationById('trash-purge')
    expect(a.modes).toEqual(['ask', 'auto', 'off'])
  })
})
