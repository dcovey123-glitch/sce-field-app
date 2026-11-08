import React, { useState, useEffect } from 'react'

const isDesktop = typeof window !== 'undefined' && !!window.desktop

function formatWhen(iso) {
  const d = new Date(iso)
  return d.toLocaleString()
}

function parseLabel(name) {
  // "2026-07-06T14-32-01-123Z - manual" -> { when: Date, kind: 'manual' }
  const parts = name.split(' - ')
  const kind = parts[parts.length - 1]
  const tsPart = parts.slice(0, -1).join(' - ')
  const iso = tsPart.replace(/(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, '$1:$2:$3.$4Z')
  const date = new Date(iso)
  return { when: isNaN(date.getTime()) ? null : date, kind }
}

function OnlineBackup() {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  async function load() { try { setSt(await window.desktop.onlineBackupStatus()) } catch { /* ignore */ } }
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])
  async function runNow() {
    setBusy(true)
    try { setSt(await window.desktop.onlineBackupRun()) } finally { setBusy(false) }
  }
  if (!window.desktop.onlineBackupStatus) return null
  const running = busy || st?.running
  const mb = n => `${(n / 1e6).toFixed(n > 1e7 ? 0 : 1)} MB`
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: 14, marginBottom: 20, background: 'var(--surface-2)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>☁️ Online backup — SCE OneDrive</div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 10 }}>
        Keeps a copy of your whole data folder in your SCE OneDrive (folder "SCEAPP Backup"), so it's safe if this computer or drive dies.
        Only changed files are copied. OneDrive keeps old versions of each file and deleted files for 93 days, and a dated copy of
        your job and quote records is kept for each of the last 30 days. Runs a minute after the app opens and every 3 hours while it's open.
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginBottom: 10 }}>
        {running ? 'Backing up to OneDrive… (the first one copies everything and can take a while)'
          : st?.lastOk ? <>Last online backup: <strong>{formatWhen(st.lastOk)}</strong>{st.files ? ` · ${st.files} files checked, ${st.copied} updated${st.bytes ? ` (${mb(st.bytes)})` : ''}${st.removed ? `, ${st.removed} removed` : ''}` : ''}</>
          : 'No online backup yet.'}
      </div>
      {st?.error && !running && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{st.error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={runNow} disabled={running}
          style={{ padding: '8px 14px', borderRadius: 'var(--rs)', border: 'none', fontWeight: 700, fontSize: 13, cursor: running ? 'default' : 'pointer', background: 'var(--navy)', color: '#fff' }}>
          {running ? 'Working…' : 'Back up online now'}
        </button>
        {st?.target && (
          <button onClick={() => window.desktop.onlineBackupOpenFolder()}
            style={{ padding: '8px 14px', borderRadius: 'var(--rs)', border: '1px solid var(--border)', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)' }}>
            Open backup folder
          </button>
        )}
      </div>
    </div>
  )
}

export default function Backup() {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [restoring, setRestoring] = useState(null) // name of backup pending confirm
  const [error, setError] = useState('')
  const [log, setLog] = useState('')

  async function refresh() {
    if (!isDesktop) { setLoading(false); return }
    setLoading(true)
    const list = await window.desktop.listBackups()
    setBackups(list || [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function backupNow() {
    setRunning(true); setError(''); setLog('')
    try {
      await window.desktop.createBackup()
      setLog('Backup created.')
      await refresh()
    } catch (err) {
      setError(err.message || 'Backup failed.')
    } finally {
      setRunning(false)
    }
  }

  async function doRestore(name) {
    setError('')
    try {
      const result = await window.desktop.restoreBackup(name)
      if (result && result.ok === false) {
        setError(result.error || 'Restore failed.')
      }
      // On success the app restarts itself — nothing more to do here.
    } catch (err) {
      setError(err.message || 'Restore failed.')
    }
  }

  if (!isDesktop) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-light)', fontSize: 13 }}>Backups are only available in the desktop app.</div>
  }

  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <div style={{ fontFamily: 'var(--font-d)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Backup</div>
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 16 }}>
        A full copy of everything — Jobs, Quotes, Files, plus Materials, Timesheets, Time Tracking, Notes and to-dos — saved as
        its own folder next to your data, so nothing here ever depends on this app. One backup happens automatically the first
        time you open the app each day. You can also make one manually anytime, and restore from any past one below.
        Your AI and cloud-sync keys stay on this computer only and aren't included.
      </div>

      <OnlineBackup />

      <button
        onClick={backupNow}
        disabled={running}
        style={{ width: '100%', padding: 12, borderRadius: 'var(--rs)', border: 'none', fontWeight: 700, fontSize: 14, cursor: running ? 'default' : 'pointer', background: 'var(--accent)', color: 'var(--navy)', marginBottom: 8 }}
      >
        {running ? 'Backing up…' : 'Back up now'}
      </button>
      {log && <div style={{ fontSize: 12, color: '#1e7a34', marginBottom: 8 }}>{log}</div>}
      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '20px 0 8px' }}>
        Past backups
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading…</div>}
      {!loading && backups.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-light)' }}>No backups yet — hit "Back up now" above to create the first one.</div>
      )}

      {backups.map(b => {
        const { when, kind } = parseLabel(b.name)
        return (
          <div key={b.name} style={{ border: '1px solid var(--border)', borderRadius: 'var(--rs)', padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{when ? formatWhen(when) : b.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-light)', textTransform: 'capitalize' }}>{kind.replace(/-/g, ' ')}</div>
              </div>
              <button
                onClick={() => setRestoring(b.name)}
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dim)', background: 'none', border: '1px solid var(--accent)', borderRadius: 'var(--rs)', padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}
              >
                Restore
              </button>
            </div>
            {restoring === b.name && (
              <div style={{ marginTop: 10, padding: 10, background: '#fdf0f0', border: '1px solid var(--red)', borderRadius: 'var(--rs)' }}>
                <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8, fontWeight: 600 }}>
                  This replaces everything currently in the app with this backup from {when ? formatWhen(when) : b.name}.
                  Your current data gets backed up first automatically, so this isn't a total dead end — but anything added
                  since this backup was made will be gone unless you restore back to today's version afterward. The app
                  will restart once this finishes.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setRestoring(null)}
                    style={{ flex: 1, padding: '8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => doRestore(b.name)}
                    style={{ flex: 1, padding: '8px', background: 'var(--red)', border: 'none', borderRadius: 'var(--rs)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                  >
                    Yes, restore this
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
