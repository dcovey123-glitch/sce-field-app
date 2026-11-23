import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useHubStore } from '../api/useHubStore.js'
import { useLocalStore } from '../api/useLocalStore.js'
import { useCrewRoster } from '../api/crewRoster.js'
import { useApiKey } from '../api/ai.js'
import { SCHEDULE_KEY, hoursOf, uid as scheduleUid } from '../api/schedule.js'
import { addTasks, newTask, today as todayIso } from '../api/tasks.js'
import { CHATS_KEY, ask, systemPrompt, historyFrom, pid } from '../api/assistant.js'
import ConfirmDeleteButton from '../components/ConfirmDeleteButton.jsx'

// My Boy Claude: type a question, Claude looks through the app (and the web)
// and answers. Changes it suggests come up as cards — nothing changes until
// you click Apply.

const money = v => `$${(Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const lineSum = list => (list || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)
const pill = on => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: on ? 'var(--navy)' : 'var(--surface)', color: on ? '#fff' : 'var(--text)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' })
const small = { fontSize: 12, color: 'var(--text-light)' }
const EXAMPLES = [
  'Pull up everything on the Finance Wall Re-locates job',
  'Find the Nedco quote for the cath lab and work it into a scope on my quote',
  'What\'s open on RDP jobs right now — tasks and deficiencies?',
  'Who\'s booked next week and on what?',
]

export default function Assistant() {
  const jobsHub = useHubStore({ hub: 'jobs', recordFileName: 'project.json', getRecordFolderName: p => p.name, customersKey: 'job_customers', recordsKey: 'job_projects' })
  const quotesHub = useHubStore({ hub: 'quotes', recordFileName: 'quote.json', getRecordFolderName: q => q.title ? `${q.quoteNumber} - ${q.title}` : q.quoteNumber, customersKey: 'quote_customers', recordsKey: 'quote_quotes' })
  const [assignments, setAssignments] = useLocalStore(SCHEDULE_KEY, [])
  const [chats, setChats] = useLocalStore(CHATS_KEY, [])
  const [apiKey] = useApiKey()
  const crew = useCrewRoster()
  const me = crew.meName
  const people = crew.active.map(p => p.name)
  const list = Array.isArray(chats) ? chats : []
  const [openId, setOpenId] = useState(null)
  const chat = list.find(c => c.id === openId) || null
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null) // { chatId, steps: [] }
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [chat?.turns?.length, busy?.steps?.length])

  const ctx = useMemo(() => ({ jobs: jobsHub.records, jobCustomers: jobsHub.customers, quotes: quotesHub.records, quoteCustomers: quotesHub.customers, assignments: Array.isArray(assignments) ? assignments : [] }),
    [jobsHub.records, jobsHub.customers, quotesHub.records, quotesHub.customers, assignments])

  const patchChat = (id, fn) => setChats(cur => (Array.isArray(cur) ? cur : []).map(c => c.id === id ? fn(c) : c))
  const patchProposal = (chatId, propId, patch) => patchChat(chatId, c => ({ ...c, turns: c.turns.map(t => ({ ...t, proposals: (t.proposals || []).map(p => p.id === propId ? { ...p, ...patch } : p) })) }))

  async function send(q) {
    const question = String(q ?? text).trim()
    if (!question || busy) return
    setText('')
    let id = chat?.id
    const turn = { id: pid(), q: question, a: '', at: new Date().toISOString(), proposals: [], steps: [], sources: [] }
    if (!id) {
      id = pid()
      setChats(cur => [{ id, title: question.slice(0, 70), createdAt: turn.at, turns: [turn] }, ...(Array.isArray(cur) ? cur : [])].slice(0, 60))
      setOpenId(id)
    } else patchChat(id, c => ({ ...c, turns: [...c.turns, turn] }))
    setBusy({ chatId: id, steps: [] })
    const steps = []
    try {
      const prior = (list.find(c => c.id === id)?.turns) || []
      const r = await ask({
        apiKey, history: historyFrom(prior), question, ctx,
        system: systemPrompt({ me, today: todayIso(), crew: people }),
        onStep: s => { steps.push(s); setBusy({ chatId: id, steps: [...steps] }) },
      })
      patchChat(id, c => ({ ...c, turns: c.turns.map(t => t.id === turn.id ? { ...t, a: r.text || '(no answer)', proposals: r.proposals, steps, sources: r.sources, searched: r.searched } : t) }))
    } catch (e) {
      patchChat(id, c => ({ ...c, turns: c.turns.map(t => t.id === turn.id ? { ...t, error: e.message || 'Something went wrong.', steps } : t) }))
    } finally { setBusy(null) }
  }

  // ── Apply a suggestion ──
  async function apply(chatId, p) {
    const i = p.input || {}
    try {
      if (p.type === 'job_tasks') {
        await jobsHub.updateRecord(i.job_id, addTasks((i.tasks || []).map(t => newTask(t.text, me, { who: t.who || '', due: t.due || '' }))))
      } else if (p.type === 'job_note') {
        await jobsHub.updateRecord(i.job_id, j => ({ notes: j.notes ? `${String(j.notes).trimEnd()}\n\n${i.text}` : i.text }))
      } else if (p.type === 'quote_scope') {
        const sc = i.scope || {}
        await quotesHub.updateRecord(i.quote_id, q => ({ scopes: [...(q.scopes || []), {
          id: pid(), name: sc.name || 'New scope', scopeText: sc.scopeText || '',
          materials: (sc.materials || []).map(m => matLine(m)), labor: (sc.labor || []).map(l => laborLine(l, q)),
        }] }))
      } else if (p.type === 'quote_lines') {
        await quotesHub.updateRecord(i.quote_id, q => ({ scopes: (q.scopes || []).map(s => s.id !== i.scope_id ? s : {
          ...s, materials: [...(s.materials || []), ...(i.materials || []).map(matLine)], labor: [...(s.labor || []), ...(i.labor || []).map(l => laborLine(l, q))],
        }) }))
      } else if (p.type === 'schedule_block') {
        const job = i.job_id ? (jobsHub.records || []).find(j => j.id === i.job_id) : null
        const workers = (i.workers || []).map(w => people.find(n => n.toLowerCase() === String(w).toLowerCase()) || people.find(n => n.toLowerCase().startsWith(String(w).toLowerCase())) || w)
        const b = {
          id: scheduleUid(), date: i.date, workers, kind: job ? 'job' : 'other', jobId: job ? job.id : '', customerId: job ? job.customerId : '',
          title: job ? '' : (i.title || 'Other'), bucket: '', taskIds: [], defIds: [], start: i.start || '', end: i.end || '', notes: i.notes || '', createdAt: new Date().toISOString(),
        }
        b.hours = b.start && b.end ? hoursOf(b) : 0
        setAssignments(cur => [...(Array.isArray(cur) ? cur : []), b])
      }
      patchProposal(chatId, p.id, { status: 'applied', appliedAt: new Date().toISOString(), error: '' })
    } catch (e) {
      patchProposal(chatId, p.id, { error: e.message || 'Could not apply it.' })
    }
  }

  const noKey = !apiKey
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14, height: 'calc(100vh - 120px)', padding: 14, boxSizing: 'border-box' }}>
      {/* Chats */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
          <button style={{ ...pill(true), width: '100%' }} onClick={() => { setOpenId(null); setText('') }}>+ New chat</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {list.length === 0 && <div style={{ ...small, padding: 12 }}>Your chats show up here.</div>}
          {list.map(c => (
            <div key={c.id} onClick={() => setOpenId(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: c.id === openId ? 'var(--surface-2)' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                <div style={small}>{new Date(c.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} · {c.turns.length} {c.turns.length === 1 ? 'question' : 'questions'}</div>
              </div>
              <ConfirmDeleteButton onConfirm={() => { setChats(cur => (cur || []).filter(x => x.id !== c.id)); if (openId === c.id) setOpenId(null) }} confirmText="Delete this chat?" style={{ background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 15 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--navy)' }}>🤖 My Boy Claude</span>
          <span style={small}>Reads your jobs, quotes, slips, Catalog, schedule and notes, and can search the web. Suggested changes wait for your OK.</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {noKey && <div style={{ padding: 12, borderRadius: 8, background: 'var(--red-bg)', color: 'var(--red-dark)', fontSize: 13, marginBottom: 10 }}>No AI key yet — add it in Materials → ⚙ Settings (the same key slip reading uses).</div>}
          {!chat && (
            <div style={{ maxWidth: 620, margin: '30px auto', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>What do you need?</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {EXAMPLES.map(x => <button key={x} disabled={noKey} onClick={() => send(x)} style={{ ...pill(false), fontWeight: 500, textAlign: 'left' }}>{x}</button>)}
              </div>
            </div>
          )}
          {chat && chat.turns.map(t => (
            <div key={t.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '75%', background: 'var(--navy)', color: '#fff', padding: '8px 12px', borderRadius: '12px 12px 2px 12px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{t.q}</div>
              </div>
              {(t.steps || []).length > 0 && t.a && <details style={{ ...small, margin: '6px 0 0' }}><summary style={{ cursor: 'pointer' }}>Looked at {t.steps.length} thing{t.steps.length === 1 ? '' : 's'} in the app{t.searched ? ` · ${t.searched} web search${t.searched === 1 ? '' : 'es'}` : ''}</summary>{t.steps.map((s, k) => <div key={k}>• {s}</div>)}</details>}
              {busy && busy.chatId === chat.id && !t.a && !t.error && (
                <div style={{ ...small, marginTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>Working on it…</div>
                  {busy.steps.map((s, k) => <div key={k}>• {s}</div>)}
                </div>
              )}
              {t.error && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--red-bg)', color: 'var(--red-dark)', fontSize: 13 }}>{t.error} <button style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => send(t.q)}>Try again</button></div>}
              {t.a && <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderText(t.a)}</div>}
              {(t.proposals || []).map(p => <ProposalCard key={p.id} p={p} onApply={() => apply(chat.id, p)} onDismiss={() => patchProposal(chat.id, p.id, { status: 'dismissed' })} />)}
              {(t.sources || []).length > 0 && (
                <div style={{ ...small, marginTop: 6 }}>Sources: {t.sources.map((s, k) => <span key={s.url}>{k > 0 && ' · '}<a href={s.url} onClick={e => { if (window.desktop?.openExternal) { e.preventDefault(); window.desktop.openExternal(s.url) } }}>{s.title}</a></span>)}</div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'flex', gap: 8 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} disabled={noKey}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={chat ? 'Ask a follow-up…' : 'Ask about a job, a quote, prices, the schedule…  (Enter to send, Shift+Enter for a new line)'}
            rows={2} style={{ flex: 1, resize: 'vertical', padding: 8, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14 }} />
          <button style={{ ...pill(true), alignSelf: 'stretch', opacity: busy || !text.trim() ? 0.6 : 1 }} disabled={!!busy || !text.trim() || noKey} onClick={() => send()}>{busy ? '…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}

const matLine = m => ({ id: pid(), partNo: m.partNo || '', desc: m.desc || '', qty: Number(m.qty) || 0, uom: m.uom || '', rate: Number(m.rate) || 0 })
const laborLine = (l, q) => ({ id: pid(), desc: l.desc || 'Labor', qty: Number(l.qty) || 0, rate: Number(l.rate) || Number(q && q.rate) || 90 })

// **bold** and plain text; everything else as written
function renderText(s) {
  return String(s).split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <React.Fragment key={i}>{part}</React.Fragment>)
}

const TITLES = {
  job_tasks: 'Add tasks to the job', job_note: 'Add to the job notes', quote_scope: 'Add a scope to the quote',
  quote_lines: 'Add lines to a scope', schedule_block: 'Book on the schedule',
}

function ProposalCard({ p, onApply, onDismiss }) {
  const i = p.input || {}
  const done = p.status === 'applied', gone = p.status === 'dismissed'
  const [working, setWorking] = useState(false)
  const td = { padding: '3px 6px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }
  const Lines = ({ mats, labor }) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
      <tbody>
        {(mats || []).map((m, k) => <tr key={'m' + k}><td style={td}>{m.partNo}</td><td style={td}>{m.desc}</td><td style={{ ...td, textAlign: 'right' }}>{m.qty} {m.uom}</td><td style={{ ...td, textAlign: 'right' }}>{money(m.rate)}</td><td style={{ ...td, textAlign: 'right' }}>{money((Number(m.qty) || 0) * (Number(m.rate) || 0))}</td></tr>)}
        {(labor || []).map((l, k) => <tr key={'l' + k}><td style={td}>Labor</td><td style={td}>{l.desc}</td><td style={{ ...td, textAlign: 'right' }}>{l.qty} h</td><td style={{ ...td, textAlign: 'right' }}>{l.rate ? money(l.rate) : 'quote rate'}</td><td style={{ ...td, textAlign: 'right' }}>{l.rate ? money(l.qty * l.rate) : ''}</td></tr>)}
        {(mats || []).length > 0 && <tr><td style={{ ...td, fontWeight: 800 }} colSpan={4}>Material at cost (the quote adds its markup)</td><td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{money(lineSum(mats))}</td></tr>}
      </tbody>
    </table>
  )
  return (
    <div style={{ marginTop: 10, border: `1px solid ${done ? 'var(--green, #2e7d32)' : 'var(--accent)'}`, borderRadius: 10, padding: 10, background: done ? 'var(--green-bg)' : 'var(--surface-2)', opacity: gone ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 13.5 }}>💡 {TITLES[p.type] || 'Suggestion'}</span>
        {p.label && <span style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700 }}>{p.label}</span>}
        <div style={{ flex: 1 }} />
        {done && <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--green-dark)' }}>✓ Applied</span>}
        {gone && <span style={small}>Dismissed</span>}
        {!done && !gone && <>
          <button style={pill(true)} disabled={working} onClick={async () => { setWorking(true); await onApply(); setWorking(false) }}>{working ? 'Applying…' : 'Apply'}</button>
          <button style={pill(false)} onClick={onDismiss}>Dismiss</button>
        </>}
      </div>
      {i.why && <div style={{ ...small, marginTop: 3 }}>{i.why}</div>}
      {p.error && <div style={{ color: 'var(--red-dark)', fontSize: 12.5, marginTop: 4 }}>{p.error}</div>}
      {p.type === 'job_tasks' && <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13 }}>{(i.tasks || []).map((t, k) => <li key={k}>{t.text}{t.who ? ` — ${t.who}` : ''}{t.due ? ` (by ${t.due})` : ''}</li>)}</ul>}
      {p.type === 'job_note' && <div style={{ marginTop: 6, fontSize: 13, whiteSpace: 'pre-wrap', background: 'var(--surface)', padding: 8, borderRadius: 6 }}>{i.text}</div>}
      {p.type === 'quote_scope' && <div style={{ marginTop: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{i.scope?.name}</div>
        {i.scope?.scopeText && <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 2 }}>{i.scope.scopeText}</div>}
        <Lines mats={i.scope?.materials} labor={i.scope?.labor} />
      </div>}
      {p.type === 'quote_lines' && <Lines mats={i.materials} labor={i.labor} />}
      {p.type === 'schedule_block' && <div style={{ marginTop: 6, fontSize: 13 }}>{i.date} · {(i.workers || []).join(', ')}{i.start ? ` · ${i.start}${i.end ? ' – ' + i.end : ''}` : ''}{i.title ? ` · ${i.title}` : ''}{i.notes ? <div style={small}>{i.notes}</div> : null}</div>}
    </div>
  )
}
