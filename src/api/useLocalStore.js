import { useState, useEffect, useRef, useCallback } from 'react'
import { scheduleLocalSnapshot } from './localSnapshot.js'

const PREFIX = 'fieldapp_'

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    scheduleLocalSnapshot() // keep the copy in the data folder (and so in backups) current
  } catch {
    // storage full or unavailable — ignore for now
  }
}

/**
 * useLocalStore(key, defaultValue)
 * A small generic hook backed by localStorage. Each feature/page can
 * call this with its own key (e.g. 'jobs', 'quotes') to get persisted
 * state without any shared/global data model. Returns [value, setValue, status].
 *
 * status is 'idle' | 'saving' | 'saved' — useful for a small save indicator.
 */
export function useLocalStore(key, defaultValue) {
  const [value, setValueState] = useState(() => lsGet(key, defaultValue))
  const [status, setStatus] = useState('idle')
  const saveTimer = useRef(null)
  const instanceId = useRef(Math.random().toString(36).slice(2))

  const setValue = useCallback((next) => {
    setValueState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next
      setStatus('saving')
      lsSet(key, resolved)
      // Tell other hook instances in THIS window (the 'storage' event only reaches other windows)
      const from = instanceId.current
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('fieldapp-local', { detail: { key, from } })))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setStatus('saved'), 250)
      return resolved
    })
  }, [key])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Several windows can be open at once (e.g. a Materials window beside the
  // main one). The 'storage' event only fires in the OTHER windows, so use it
  // to pick up changes made elsewhere instead of holding — and later writing
  // back — a stale copy.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== PREFIX + key) return
      setValueState(lsGet(key, defaultValue))
    }
    function onLocal(e) {
      if (e.detail?.key !== key || e.detail.from === instanceId.current) return
      setValueState(lsGet(key, defaultValue))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('fieldapp-local', onLocal)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('fieldapp-local', onLocal) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [value, setValue, status]
}
