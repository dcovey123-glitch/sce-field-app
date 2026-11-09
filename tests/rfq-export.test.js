// Material exported from a quote goes out as a Request for Quote, with our quote number
import { describe, it, expect } from 'vitest'
import { orderFormHeading, orderFormFileName } from '../src/api/exportOrderForm.js'

describe('request for quote export', () => {
  it('from a quote: titled Request for Quote, our quote number on it, and says it is not an order', () => {
    const h = orderFormHeading({ number: 'Q-RDP-2026-094', title: '2602 Classrooms' })
    expect(h.title).toBe('Request for Quote')
    expect(h.ref).toBe('Our quote: Q-RDP-2026-094 — 2602 Classrooms')
    expect(h.ask).toBe('Please quote pricing and availability for the items below and reference our quote Q-RDP-2026-094 on your quote. This is not an order.')
  })
  it('a normal order stays a Material Order', () => {
    expect(orderFormHeading(null)).toEqual({ title: 'Material Order', ref: '', ask: '' })
  })
  it('file name says Request for Quote and the quote number', () => {
    expect(orderFormFileName({ wholesaler: 'Nedco', date: '2026-11-09', rfq: { number: 'Q-RDP-2026-094' } })).toBe('2026-11-09 - Request for Quote - Q-RDP-2026-094 - Nedco.pdf')
    expect(orderFormFileName({ wholesaler: 'Nedco', date: '2026-11-09' })).toBe('2026-11-09 - Material Order - Nedco.pdf')
  })
})
