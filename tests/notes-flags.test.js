// Checks on flags and email notes. Run with:  npm test
import { describe, it, expect } from 'vitest'
import { addFlagPatch, resolveFlagPatch, openFlags } from '../src/components/FlagBanner.jsx'
import { removeMiscEntry } from '../src/pages/Notes.jsx'

describe('flags from the Snapshot', () => {
  it('adds a flag and a note, and Done clears only the flag', () => {
    const job = { notesLog: [{ id: 'n0', text: 'old' }] }
    const flagged = { ...job, ...addFlagPatch(job, 'Call Lana', 'On the books') }
    expect(openFlags(flagged)).toHaveLength(1)
    expect(flagged.notesLog[0].text).toContain('Call Lana')
    expect(flagged.notesLog).toHaveLength(2)
    const done = { ...flagged, ...resolveFlagPatch(flagged, flagged.flags[0].id) }
    expect(openFlags(done)).toHaveLength(0)
    expect(done.notesLog).toHaveLength(2) // note history kept
  })
})

describe('"Irrelevant" on a Misc note', () => {
  it('takes only that email out of the note', () => {
    const a = { id: 'a', block: '9:08 PM · Jonathan\nResidence billing sent' }
    const b = { id: 'b', block: '12:13 PM · Wicked Wrench\nTruck estimate' }
    const content = `${b.block}\n\n${a.block}`
    const note = { content, miscContent: content, miscEntries: [b, a] }
    const out = removeMiscEntry(note, b)
    expect(out.miscEntries.map(e => e.id)).toEqual(['a'])
    expect(out.content).toBe(a.block)
    expect(out.miscContent).toBe(a.block)
  })
  it('leaves hand-typed text alone', () => {
    const a = { id: 'a', block: 'email text' }
    const out = removeMiscEntry({ content: 'my own words\n\nemail text', miscEntries: [a] }, a)
    expect(out.content).toBe('my own words')
  })
})
