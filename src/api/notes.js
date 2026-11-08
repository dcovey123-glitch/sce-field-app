// Notes helpers shared by Notes, Assistant Update and the job / quote notes.
//
// Daily notes: daily_notes = { 'YYYY-MM-DD': [section, …] }
//   section = { id, text, jobId, workerNames?, assistant?, miscEntries?, miscContent? }
//   The assistant's filed emails for a day live in ONE section with assistant: true.
// Job / quote notes: record.notesLog = [{ id, timestamp, text, source?, … }]
//   source 'email' = filed by the assistant; anything else is yours.

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const byTime = list => list.slice().sort((a, b) => (a.at || '~').localeCompare(b.at || '~'))
export const buildMiscText = entries => byTime(entries).map(e => e.block).join('\n\n')

// File one email into that day's assistant section (made if missing).
// Untouched since it was built → rebuilt in time order; edited by hand → added to the end.
export function fileAssistantNote(entries, day, entry) {
  const all = entries && typeof entries === 'object' ? entries : {}
  const raw = all[day]
  const secs = !raw ? [] : typeof raw === 'string' ? [{ id: uid(), text: raw, jobId: null }] : raw
  const existing = secs.find(s => s.assistant)
  if (!existing) {
    const text = buildMiscText([entry])
    return { ...all, [day]: [...secs, { id: uid(), assistant: true, jobId: null, miscEntries: [entry], miscContent: text, text }] }
  }
  if ((existing.miscEntries || []).some(e => e.id === entry.id)) return all
  const miscEntries = [...(existing.miscEntries || []), entry]
  const generated = buildMiscText(miscEntries)
  const untouched = (existing.text || '') === (existing.miscContent || '')
  const patch = untouched ? { text: generated, miscContent: generated } : { text: `${(existing.text || '').trim()}\n\n${entry.block}`.trim() }
  return { ...all, [day]: secs.map(s => s === existing ? { ...s, ...patch, miscEntries } : s) }
}

// The old way filed them as General Notes ("Oct 29th - Misc Notes"): move each
// into its day on Daily Notes. → { general, daily } or null when nothing to move.
export function moveMiscToDaily(general, daily) {
  const misc = (Array.isArray(general) ? general : []).filter(n => n && n.miscDate)
  if (!misc.length) return null
  let next = daily && typeof daily === 'object' ? { ...daily } : {}
  misc.forEach(n => {
    const raw = next[n.miscDate]
    const secs = !raw ? [] : typeof raw === 'string' ? [{ id: uid(), text: raw, jobId: null }] : raw
    const ex = secs.find(s => s.assistant)
    const text = n.content || ''
    if (ex && ex.id === n.id) return // already moved (another window got here first)
    if (!ex) {
      next = { ...next, [n.miscDate]: [...secs, { id: n.id, assistant: true, jobId: null, miscEntries: n.miscEntries || [], miscContent: n.miscContent ?? text, text }] }
    } else {
      // already one there (filed since) — merge, keeping both texts
      const have = new Set((ex.miscEntries || []).map(e => e.id))
      const add = (n.miscEntries || []).filter(e => !have.has(e.id))
      const merged = { ...ex, miscEntries: [...(ex.miscEntries || []), ...add], text: [text.trim(), (ex.text || '').trim()].filter(Boolean).join('\n\n') }
      merged.miscContent = (ex.text || '') === (ex.miscContent || '') && text === (n.miscContent ?? text) ? merged.text : (ex.miscContent || '')
      next = { ...next, [n.miscDate]: secs.map(s => s === ex ? merged : s) }
    }
  })
  return { general: general.filter(n => !n.miscDate), daily: next }
}

// "Irrelevant" on one filed email: take its text out (the email stays in Outlook)
export function removeEntryFromSection(section, entry) {
  const block = String(entry.block || '')
  const strip = s => {
    const str = String(s || '')
    if (!block || !str.includes(block)) return str
    return str.replace(block, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  return {
    miscEntries: (section.miscEntries || []).filter(e => e.id !== entry.id),
    text: strip(section.text),
    ...(section.miscContent !== undefined ? { miscContent: strip(section.miscContent) } : {}),
  }
}

// Search every day: → [{ day, section }] newest first
export function searchDaily(entries, q, jobName = () => '') {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out = []
  Object.entries(entries || {}).forEach(([day, raw]) => {
    const secs = !raw ? [] : typeof raw === 'string' ? [{ id: day, text: raw, jobId: null }] : raw
    secs.forEach(s => {
      const hay = [day, s.text, jobName(s.jobId), ...(s.workerNames || []), s.assistant ? 'assistant email' : ''].join(' ').toLowerCase()
      if (words.every(w => hay.includes(w))) out.push({ day, section: s })
    })
  })
  return out.sort((a, b) => b.day.localeCompare(a.day))
}

// A General Note moved onto a job's notes
export function generalToJobNote(note) {
  const body = String(note.content || '').trim()
  const title = String(note.title || '').trim()
  return { id: uid(), timestamp: note.updatedAt || new Date().toISOString(), text: [title, body].filter(Boolean).join('\n\n') || '(empty note)', source: 'manual', movedFrom: 'general' }
}

export const isAssistantNote = n => !!n && n.source === 'email'
export function splitNotes(notes) {
  const list = Array.isArray(notes) ? notes : []
  return { manual: list.filter(n => !isAssistantNote(n)), assistant: list.filter(isAssistantNote) }
}
