import './api/albertaTime.js' // Alberta Time (UTC-6) for every date shown — must load first
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/global.css'
import { initLocalSnapshot } from './api/localSnapshot.js'

// Catches errors that happen outside React's render cycle too (a module
// throwing at import time, an unhandled promise rejection, etc.) — without
// this, a failure here means a totally blank white window with no clue why.
function showCrashScreen(message, detail) {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div style="font-family: system-ui, sans-serif; padding: 32px; max-width: 640px; margin: 0 auto;">
      <h2 style="color:#a83030; margin-bottom: 8px;">Something went wrong loading the app</h2>
      <p style="color:#555; margin-bottom: 16px;">${message}</p>
      <pre style="background:#f6f6f6; border:1px solid #ddd; border-radius:6px; padding:12px; font-size:12px; white-space:pre-wrap; overflow:auto; max-height:300px;">${detail || ''}</pre>
      <p style="color:#888; font-size:13px; margin-top:16px;">Send this text to Claude to get it fixed.</p>
    </div>
  `
}

// Once the app is up, a stray error (a failed save, a network hiccup) shouldn't
// wipe the whole window and everything unsaved on it — show a dismissible
// banner instead. Only a failure before the app ever rendered gets the full
// crash screen.
let appRendered = false
function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function showErrorBanner(message, detail, { title = "Something didn't work.", tail = "Your other work is still here — if something you just did didn't stick, try it again.", warn = false } = {}) {
  let bar = document.getElementById('fieldapp-error-banner')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'fieldapp-error-banner'
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#fff4f4;border:1px solid #e0a0a0;border-radius:8px;padding:10px 12px;font:13px system-ui,sans-serif;color:#5a1d1d;box-shadow:0 6px 24px rgba(0,0,0,.15);display:flex;gap:10px;align-items:flex-start'
    document.body.appendChild(bar)
  }
  bar.innerHTML = `
    <div style="flex:1;min-width:0">
      <b>${escapeHtml(title)}</b> ${escapeHtml(message)} ${escapeHtml(tail)}
      <details style="margin-top:4px"><summary style="cursor:pointer;color:#8a4a4a">Details (send to Claude to get it fixed)</summary>
      <pre style="white-space:pre-wrap;font-size:11px;max-height:180px;overflow:auto;margin:6px 0 0">${escapeHtml(detail)}</pre></details>
    </div>
    <button style="border:none;background:none;font-size:16px;cursor:pointer;color:#5a1d1d" aria-label="Dismiss">✕</button>`
  bar.querySelector('button').onclick = () => bar.remove()
}
function reportError(message, detail) {
  if (appRendered) showErrorBanner(message, detail)
  else showCrashScreen(escapeHtml(message), escapeHtml(detail))
}

window.addEventListener('error', (e) => {
  if (/ResizeObserver loop/.test(e.message || '')) return // harmless browser noise
  reportError(e.message || 'A script error occurred.', `${e.message}\n${e.error?.stack || ''}`)
})
// A save that didn't fit in the app's storage — never silent
window.addEventListener('fieldapp-save-failed', (e) => {
  const what = String(e.detail?.key || 'something').replace(/_/g, ' ')
  showErrorBanner(`Couldn't save "${what}" — the app's storage is full or blocked. What's on screen is NOT saved yet: don't close the app; send this to Claude.`, `${e.detail?.key}: ${e.detail?.message}`, { title: 'Not saved!', tail: '' })
})
window.addEventListener('fieldapp-storage-nearly-full', (e) => {
  showErrorBanner(`The app's storage is getting full (${Math.round((e.detail?.used || 0) / 1e5) / 10} MB of about 5 MB). Everything is saved for now — tell Claude so the big lists can move to files.`, `used ${e.detail?.used} chars`, { title: 'Heads up:', tail: '' })
})
window.addEventListener('unhandledrejection', (e) => {
  reportError(e.reason?.message || 'An operation failed.', `${e.reason?.message || e.reason}\n${e.reason?.stack || ''}`)
})

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error(error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{ color: '#a83030', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#555', marginBottom: 16 }}>{this.state.error.message}</p>
          <pre style={{ background: '#f6f6f6', border: '1px solid #ddd', borderRadius: 6, padding: 12, fontSize: 12, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 300 }}>
            {this.state.error.stack}
          </pre>
          <p style={{ color: '#888', fontSize: 13, marginTop: 16 }}>Send this text to Claude to get it fixed.</p>
        </div>
      )
    }
    return this.props.children
  }
}

// Bring back materials/timesheets/notes etc. from the data folder first if
// this PC has none (new PC, reinstall) or a backup was just restored.
initLocalSnapshot().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
  appRendered = true
})
