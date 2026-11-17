import { describe, it, expect } from 'vitest'
import { makeStockCheck, applyStockCheckAnswer, setAsidePatch, applyCheckToOrderSheet, removeCheckFromOrderSheet, clearSetAsidePatch, checkProgress, stockCheckPayload, shortOf } from '../src/api/stockCheck.js'
import { quoteLineStatus, quoteLinesSummary } from '../src/api/quoteMaterials.js'

let n = 0
const uid = () => 'id' + (++n)
const job = { id: 'j1', name: 'B208 Hallway' }
const quote = { id: 'q1', quoteNumber: 'Q-101', title: 'B208' }
const lines = [
  { key: 'q1:a', quoteId: 'q1', quoteNumber: 'Q-101', quoteTitle: 'B208', lineId: 'a', partNo: 'BOX4', desc: '4sq box', uom: 'ea', qty: 12 },
  { key: 'q1:b', quoteId: 'q1', quoteNumber: 'Q-101', quoteTitle: 'B208', lineId: 'b', partNo: 'AC90', desc: '14/2 AC90', uom: 'm', qty: 150 },
  { key: 'q1:c', quoteId: 'q1', quoteNumber: 'Q-101', quoteTitle: 'B208', lineId: 'c', partNo: 'SW', desc: 'Switch', uom: 'ea', qty: 6 },
]
const make = () => makeStockCheck({ job, customerName: 'RDP', quote, lines, findStock: l => l.partNo === 'BOX4' ? { qty: 40, name: 'Box' } : null, uid, now: '2026-11-16T20:00:00Z' })
const ans = (checks, c, i, status, haveQty, at) => applyStockCheckAnswer(checks, { checkId: c.id, lineId: c.lines[i].id, status, haveQty, at, by: 'Dustin' }).checks

describe('Stock Check', () => {
  it('makes a list with what Stock shows on hand', () => {
    const c = make()
    expect(c.lines.map(l => [l.lineKey, l.qty, l.onHand])).toEqual([['q1:a', 12, 40], ['q1:b', 150, null], ['q1:c', 6, null]])
    expect(checkProgress(c)).toMatchObject({ total: 3, answered: 0, done: false })
    expect(stockCheckPayload([c, { ...c, id: 'x', closedAt: 'now' }]).checks.map(x => x.id)).toEqual([c.id])
  })

  it('Have flags the quote line Set aside; Some / Don\'t have go on the order sheet to confirm', () => {
    let c = make()
    let checks = [c]
    checks = ans(checks, c, 0, 'have', 12, '2026-11-16T21:00:00Z')
    checks = ans(checks, c, 1, 'some', 60, '2026-11-16T21:01:00Z')
    checks = ans(checks, c, 2, 'missing', 0, '2026-11-16T21:02:00Z')
    c = checks[0]
    expect(checkProgress(c)).toMatchObject({ answered: 3, have: 1, short: 2, done: true })
    expect(c.lines.map(shortOf)).toEqual([0, 90, 6])

    const p = setAsidePatch(job, c)
    expect(p.quoteLineState['q1:a'].setAside.qty).toBe(12)
    expect(p.quoteLineState['q1:b'].setAside.qty).toBe(60)
    expect(p.quoteLineState['q1:c']).toBeUndefined()

    const sheet = applyCheckToOrderSheet([{ id: 'other', qty: 1 }], c)
    const mine = sheet.filter(x => x.source === 'stockcheck')
    expect(mine.map(x => [x.partNo, x.qty, x.confirm, x.tag])).toEqual([['AC90', 90, true, 'order'], ['SW', 6, true, 'order']])
    expect(mine[0].planRefs[0]).toMatchObject({ jobId: 'j1', lineId: 'q1:b', qty: 90 })

    // the Quoted tab shows it
    const st = quoteLineStatus({ ...job, ...p }, lines[1], { orderList: sheet })
    expect(st.chips.map(x => x.id)).toEqual(expect.arrayContaining(['sheet-confirm', 'setaside']))
    expect(st.chips.some(x => x.id === 'none')).toBe(false)
    const st0 = quoteLineStatus({ ...job, ...p }, lines[0], { orderList: sheet })
    expect(quoteLinesSummary([st0, st])).toMatchObject({ setAside: 2, toConfirm: 1, notOrdered: 0 })
  })

  it('changing an answer updates the flag and the unconfirmed order line, not a confirmed one', () => {
    let c = make()
    let checks = ans([c], c, 1, 'missing', 0, '2026-11-16T21:00:00Z')
    checks = ans(checks, c, 2, 'missing', 0, '2026-11-16T21:00:00Z')
    c = checks[0]
    let sheet = applyCheckToOrderSheet([], c)
    // you confirm the switch line on the desktop
    sheet = sheet.map(x => x.partNo === 'SW' ? { ...x, confirm: undefined } : x)
    // then on the phone: found the cable after all, and changed the switch answer too
    checks = ans(checks, c, 1, 'have', 150, '2026-11-16T22:00:00Z')
    checks = ans(checks, c, 2, 'have', 6, '2026-11-16T22:00:00Z')
    c = checks[0]
    sheet = applyCheckToOrderSheet(sheet, c)
    expect(sheet.map(x => x.partNo)).toEqual(['SW']) // confirmed line kept; cable line gone
    const p = setAsidePatch(job, c)
    expect(p.quoteLineState['q1:b'].setAside.qty).toBe(150)
  })

  it('an older answer arriving late does not overwrite a newer one', () => {
    const c = make()
    let checks = ans([c], c, 0, 'have', 12, '2026-11-16T22:00:00Z')
    checks = ans(checks, c, 0, 'missing', 0, '2026-11-16T21:00:00Z')
    expect(checks[0].lines[0].status).toBe('have')
  })

  it('"change" clears the answer and its flag', () => {
    let c = make()
    let checks = ans([c], c, 0, 'have', 12, '2026-11-16T21:00:00Z')
    const flagged = { ...job, ...setAsidePatch(job, checks[0]) }
    checks = ans(checks, c, 0, '', 0, '2026-11-16T21:05:00Z')
    c = checks[0]
    expect(c.lines[0].status).toBe('')
    expect(setAsidePatch(flagged, c).quoteLineState['q1:a']).toBeUndefined()
  })

  it('deleting a list takes its unconfirmed lines and flags with it', () => {
    let c = make()
    const checks = ans(ans([c], c, 0, 'have', 12, '2026-11-16T21:00:00Z'), c, 2, 'missing', 0, '2026-11-16T21:00:00Z')
    c = checks[0]
    const sheet = applyCheckToOrderSheet([{ id: 'keep', qty: 1 }], c)
    expect(removeCheckFromOrderSheet(sheet, c).map(x => x.id)).toEqual(['keep'])
    const flagged = { ...job, ...setAsidePatch(job, c) }
    expect(clearSetAsidePatch(flagged, c).quoteLineState).toEqual({})
  })
})
