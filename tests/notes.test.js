import { describe, it, expect } from 'vitest'
import { fileAssistantNote, moveMiscToDaily, removeEntryFromSection, searchDaily, generalToJobNote, splitNotes } from '../src/api/notes.js'

const e1 = { id: 'm1', at: '2026-11-04T15:00:00Z', block: '3:00 PM · Jonathan · “PO”\nPO came in' }
const e2 = { id: 'm2', at: '2026-11-04T10:00:00Z', block: '10:00 AM · Justin · “Quote”\nQuote attached' }

describe('assistant notes on Daily Notes', () => {
  it('files emails into one assistant section per day, in time order', () => {
    let d = fileAssistantNote({ '2026-11-04': [{ id: 'a', text: 'mine', jobId: null }] }, '2026-11-04', e1)
    d = fileAssistantNote(d, '2026-11-04', e2)
    d = fileAssistantNote(d, '2026-11-04', e2) // same email again — no change
    const secs = d['2026-11-04']
    expect(secs).toHaveLength(2)
    expect(secs[0].text).toBe('mine')
    expect(secs[1].assistant).toBe(true)
    expect(secs[1].miscEntries).toHaveLength(2)
    expect(secs[1].text.indexOf('Justin')).toBeLessThan(secs[1].text.indexOf('Jonathan'))
  })
  it('adds to the end once the section was edited by hand', () => {
    let d = fileAssistantNote({}, '2026-11-04', e1)
    d = { '2026-11-04': [{ ...d['2026-11-04'][0], text: 'edited' }] }
    d = fileAssistantNote(d, '2026-11-04', e2)
    expect(d['2026-11-04'][0].text).toBe('edited\n\n' + e2.block)
  })
  it('moves the old General "Misc Notes" onto their day, once', () => {
    const general = [{ id: 'g1', title: 'Keep me' }, { id: 'g2', title: 'Nov 4th - Misc Notes', miscDate: '2026-11-04', miscEntries: [e1], miscContent: e1.block, content: e1.block }]
    const r = moveMiscToDaily(general, { '2026-11-04': 'old string note' })
    expect(r.general.map(n => n.id)).toEqual(['g1'])
    expect(r.daily['2026-11-04']).toHaveLength(2)
    expect(r.daily['2026-11-04'][1]).toMatchObject({ id: 'g2', assistant: true, text: e1.block })
    expect(moveMiscToDaily(r.general, r.daily)).toBeNull()
    // a second window running it with the old list doesn't double it
    const again = moveMiscToDaily(general, r.daily)
    expect(again.daily['2026-11-04']).toHaveLength(2)
  })
  it('Irrelevant takes one email out of the section', () => {
    const d = fileAssistantNote(fileAssistantNote({}, 'x', e1), 'x', e2)
    const p = removeEntryFromSection(d.x[0], e1)
    expect(p.miscEntries.map(e => e.id)).toEqual(['m2'])
    expect(p.text).not.toContain('PO came in')
  })
  it('searches every day, newest first, by text, job and worker', () => {
    const d = { '2026-11-01': [{ id: 'a', text: 'Pulled wire B208', jobId: 'j1' }], '2026-11-03': [{ id: 'b', text: 'Panel', jobId: null, workerNames: ['Kyle'] }, { id: 'c', text: 'wire tray', jobId: null }] }
    const job = id => id === 'j1' ? 'RDP Library lighting' : ''
    expect(searchDaily(d, 'wire').map(h => h.section.id)).toEqual(['c', 'a'])
    expect(searchDaily(d, 'library', job).map(h => h.section.id)).toEqual(['a'])
    expect(searchDaily(d, 'kyle').map(h => h.section.id)).toEqual(['b'])
    expect(searchDaily(d, '')).toEqual([])
  })
})

describe('job / quote notes', () => {
  it('a General Note becomes a manual job note with its title', () => {
    const n = generalToJobNote({ title: 'Panic buttons', content: 'Library controller', updatedAt: '2026-11-05T00:00:00Z' })
    expect(n).toMatchObject({ text: 'Panic buttons\n\nLibrary controller', source: 'manual', timestamp: '2026-11-05T00:00:00Z' })
  })
  it('splits manual from assistant (email) notes; flags stay manual', () => {
    const r = splitNotes([{ id: 1, source: 'email' }, { id: 2 }, { id: 3, source: 'flag' }, { id: 4, source: 'manual' }])
    expect(r.assistant.map(n => n.id)).toEqual([1])
    expect(r.manual.map(n => n.id)).toEqual([2, 3, 4])
  })
})
