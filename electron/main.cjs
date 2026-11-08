const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged

let mainWindow
let dataRoot = null

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}

function initDataRoot() {
  const cfg = loadConfig()
  if (cfg.dataRoot && fs.existsSync(cfg.dataRoot)) dataRoot = cfg.dataRoot
}

// Folder/file names come from user-entered text (customer names, project names, etc.)
// — strip characters Windows won't allow in a path.
function sanitizeName(name) {
  return String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') // Windows silently drops trailing dots/spaces from real folder/file names — keep ours matching
    .slice(0, 120) || 'Untitled'
}

function uniqueDir(baseDir, desiredName) {
  const name = sanitizeName(desiredName)
  let candidate = path.join(baseDir, name)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${name} (${n})`)
    n++
  }
  return candidate
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }) }

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return fallback }
}

// Write to a temporary file first, then swap it into place. If the app or PC
// dies mid-save, the old file is still intact instead of half-written (a
// half-written project.json made that job silently vanish from the app).
function writeJson(p, data) {
  ensureDir(path.dirname(p))
  const text = JSON.stringify(data, null, 2)
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, text)
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, p)
      return
    } catch (err) {
      // OneDrive / antivirus can briefly lock the file on Windows — retry, then fall back to a direct write.
      if (attempt < 4 && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
        const until = Date.now() + 50 * (attempt + 1)
        while (Date.now() < until) { /* short wait */ }
        continue
      }
      try { fs.writeFileSync(p, text) } finally { try { fs.unlinkSync(tmp) } catch { /* already gone */ } }
      return
    }
  }
}

// Tell every OTHER app window that saved data changed, so they reload instead
// of keeping (and later writing back) an older copy.
function broadcastDataChanged(sender) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.webContents === sender) continue
    try { w.webContents.send('data:changed') } catch { /* window closing */ }
  }
}

// Local calendar date (YYYY-MM-DD) — toISOString() gives the UTC date, which
// rolls over at 6 PM in Alberta.
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Backup folder names look like "2026-07-06T14-32-01-123Z - auto" (UTC).
function backupNameToDate(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null
}

// Electron doesn't wire up cut/copy/paste on its own — a normal browser tab
// gets this for free, a bare BrowserWindow doesn't. This gives both the
// keyboard shortcuts and a right-click menu inside any text field.
function setupEditingSupport(win) {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  win.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable) return
    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ])
    menu.popup()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, 'icon.png'),
    width: 1200,
    height: 820,
    minWidth: 420,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  setupEditingSupport(mainWindow)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// A customer's jobs open in their own real OS window (not a modal) — its own
// title bar, its own maximize/resize, separate from the main window entirely.
// Optional projectId opens the window straight onto that job.
// opts.focus opens a job on one field ("value", "billing", "status",
// "dateApproved"); opts.quoteId opens a quote instead of a job.
function createCustomerWindow(customerId, projectId, opts = {}) {
  const seg = s => encodeURIComponent(String(s))
  let route = `/customer/${customerId}`
  if (opts && opts.quoteId) route += `/quote/${seg(opts.quoteId)}`
  else if (projectId) route += `/job/${projectId}${opts && opts.focus ? `/${seg(opts.focus)}` : ''}`
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'icon.png'),
    width: 1100,
    height: 780,
    minWidth: 420,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${route}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: route })
  }
  return win
}

ipcMain.handle('window:openCustomer', (e, customerId, projectId, opts) => {
  createCustomerWindow(customerId, projectId, opts && typeof opts === 'object' ? opts : {})
})

// A separate window listing all of one customer's deficient projects and
// their open items together — opened from within the customer window.
function createDeficienciesWindow(customerId) {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 420,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  if (isDev) {
    win.loadURL(`http://localhost:5173/#/deficiencies/${customerId}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: `/deficiencies/${customerId}` })
  }
  return win
}

function createFilesWindow(customerId, kind) {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 480,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  const hash = `/files/${kind === 'documents' ? 'documents' : 'photos'}/${customerId}`
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${hash}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
  }
  return win
}

function createMaterialsWindow(view) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  const hash = `/materials/${view || 'ordered'}`
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${hash}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
  }
  return win
}

ipcMain.handle('window:openMaterials', (e, view) => {
  createMaterialsWindow(view)
})

// ⏱ Time — Time Tracking + Timesheets in their own window (like Materials)
function createTimeWindow(view) {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 600,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  const hash = `/time/${view || 'tracking'}`
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${hash}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
  }
  return win
}
ipcMain.handle('window:openTime', (e, view) => {
  createTimeWindow(view)
})

function createManageCustomersWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 740,
    minWidth: 520,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  setupEditingSupport(win)
  if (isDev) {
    win.loadURL('http://localhost:5173/#/manage-customers')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/manage-customers' })
  }
  return win
}

ipcMain.handle('window:openManageCustomers', () => {
  createManageCustomersWindow()
})

ipcMain.handle('window:openFiles', (e, { customerId, kind }) => {
  createFilesWindow(customerId, kind)
})

ipcMain.handle('window:openDeficiencies', (e, customerId) => {
  createDeficienciesWindow(customerId)
})

app.whenReady().then(() => {
  initDataRoot()
  createWindow()
  setTimeout(writeOrdersIndex, 3000)
  setTimeout(() => { runOnlineBackup().catch(() => {}) }, 60 * 1000)
  setInterval(() => { runOnlineBackup().catch(() => {}) }, 3 * 60 * 60 * 1000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Data root (the folder the person picks to hold everything) ──
ipcMain.handle('data:getRoot', () => dataRoot)

ipcMain.handle('data:chooseRoot', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for your Field App data',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return dataRoot
  dataRoot = result.filePaths[0]
  saveConfig({ ...loadConfig(), dataRoot })
  return dataRoot
})

// ── Backups — timestamped full copies of the data folder, kept as a sibling
// folder next to it. Not zipped: a plain folder copy is trivially inspectable
// and recoverable even without the app itself, and needs no extra libraries.
const BACKUP_KEEP_COUNT = 20

function getBackupsRoot() {
  return path.join(path.dirname(dataRoot), 'Field App Backups')
}

function pruneOldBackups() {
  const backupsRoot = getBackupsRoot()
  let dirs
  try {
    dirs = fs.readdirSync(backupsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  } catch {
    return
  }
  if (dirs.length > BACKUP_KEEP_COUNT) {
    const toRemove = dirs.slice(0, dirs.length - BACKUP_KEEP_COUNT)
    toRemove.forEach(d => fs.rmSync(path.join(backupsRoot, d), { recursive: true, force: true }))
  }
}

function runBackup(kind) {
  if (!dataRoot) return null
  const backupsRoot = getBackupsRoot()
  fs.mkdirSync(backupsRoot, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${ts} - ${kind}`
  const dest = path.join(backupsRoot, name)
  fs.cpSync(dataRoot, dest, { recursive: true })
  pruneOldBackups()
  return name
}

ipcMain.handle('backup:create', () => runBackup('manual'))

ipcMain.handle('backup:list', () => {
  const backupsRoot = getBackupsRoot()
  try {
    return fs.readdirSync(backupsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const full = path.join(backupsRoot, e.name)
        const stat = fs.statSync(full)
        return { name: e.name, createdAt: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.name.localeCompare(a.name))
  } catch {
    return []
  }
})

ipcMain.handle('backup:restore', (e, name) => {
  if (!dataRoot) return { ok: false, error: 'No data folder set' }
  const backupsRoot = getBackupsRoot()
  const src = path.join(backupsRoot, name)
  if (!fs.existsSync(src)) return { ok: false, error: 'Backup not found' }
  try {
    // Safety net — back up the CURRENT state before overwriting anything,
    // so restoring is never a one-way door.
    runBackup('before-restore')
    const entries = fs.readdirSync(dataRoot)
    entries.forEach(name => fs.rmSync(path.join(dataRoot, name), { recursive: true, force: true }))
    fs.cpSync(src, dataRoot, { recursive: true })
    // On the next start, also put back the materials/timesheets/notes/etc.
    // that were saved alongside this backup (see localdata:* below).
    saveConfig({ ...loadConfig(), restoreLocalPending: true })
    app.relaunch()
    app.exit(0)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Auto-backup — once per real day the app is opened, best-effort, never
// blocks startup if it fails for some reason.
ipcMain.handle('backup:autoIfNeeded', () => {
  if (!dataRoot) return null
  try {
    const backupsRoot = getBackupsRoot()
    const today = localDay()
    let dirs = []
    try { dirs = fs.readdirSync(backupsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) } catch { /* first run */ }
    const alreadyToday = dirs.some(d => {
      const when = backupNameToDate(d)
      return d.endsWith('auto') && when && localDay(when) === today
    })
    if (alreadyToday) return null
    return runBackup('auto')
  } catch {
    return null
  }
})

// ── Online backup — a live copy of the data folder in Dustin's SCE OneDrive
// (OneDrive uploads it). Two parts:
//   SCEAPP Backup/Live copy/       mirror of the data folder; only changed
//                                  files are copied, so after the first run
//                                  it's quick. OneDrive keeps old versions of
//                                  every file and deleted files for 93 days.
//   SCEAPP Backup/Daily records/   the job/quote/customer .json records only,
//                                  one dated folder per day, last 30 kept.
// Runs a minute after the app opens and every 3 hours while it's open.
const fsp = fs.promises
const ONLINE_KEEP_DAYS = 30
let onlineState = { running: false, lastRun: null, lastOk: null, error: '', copied: 0, removed: 0, files: 0, bytes: 0, target: null }

function getOnlineBackupRoot() {
  const cfg = loadConfig()
  if (cfg.onlineBackupRoot) return cfg.onlineBackupRoot
  const home = app.getPath('home')
  const cands = []
  if (process.env.OneDriveCommercial) cands.push(process.env.OneDriveCommercial)
  try { for (const n of fs.readdirSync(home)) if (/^OneDrive - /i.test(n)) cands.push(path.join(home, n)) } catch { /* ignore */ }
  // Prefer the OneDrive that holds the Field App folder (the SCE one)
  const root = cands.find(c => fs.existsSync(path.join(c, 'Field App'))) || cands.find(c => fs.existsSync(c))
  return root ? path.join(root, 'SCEAPP Backup') : null
}

const skipName = n => /^~\$/.test(n) || /^(thumbs\.db|desktop\.ini)$/i.test(n) || n.startsWith('.')

async function walkFiles(dir, rel = '', out = new Map()) {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (skipName(e.name)) continue
    const r = rel ? path.join(rel, e.name) : e.name
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walkFiles(full, r, out)
    else if (e.isFile()) {
      try { const st = await fsp.stat(full); out.set(r, { size: st.size, mtimeMs: st.mtimeMs }) } catch { /* vanished */ }
    }
  }
  return out
}

async function removeEmptyDirs(dir) {
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name))
  try { if ((await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir) } catch { /* ignore */ }
}

async function runOnlineBackup() {
  if (onlineState.running) return onlineState
  const root = getOnlineBackupRoot()
  onlineState = { ...onlineState, running: true, error: '', target: root, lastRun: new Date().toISOString() }
  try {
    if (!dataRoot || !fs.existsSync(dataRoot)) throw new Error('Data folder not found.')
    if (!root) throw new Error('Could not find your SCE OneDrive folder on this computer.')
    const live = path.join(root, 'Live copy')
    await fsp.mkdir(live, { recursive: true })
    const src = await walkFiles(dataRoot)
    let dest = new Map()
    try { dest = await walkFiles(live) } catch { /* first run */ }
    // Safety: if the data folder looks mostly empty (drive missing, wrong
    // folder), never delete anything from the online copy.
    const looksIncomplete = src.size === 0 || (dest.size > 50 && src.size < dest.size * 0.5)
    let copied = 0, removed = 0, bytes = 0
    for (const [rel, s] of src) {
      const d = dest.get(rel)
      if (d && d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000) continue
      const to = path.join(live, rel)
      await fsp.mkdir(path.dirname(to), { recursive: true })
      await fsp.copyFile(path.join(dataRoot, rel), to)
      const t = new Date(s.mtimeMs)
      try { await fsp.utimes(to, t, t) } catch { /* ignore */ }
      copied++; bytes += s.size
    }
    if (!looksIncomplete) {
      for (const rel of dest.keys()) {
        if (src.has(rel)) continue
        try { await fsp.unlink(path.join(live, rel)); removed++ } catch { /* ignore */ }
      }
      await removeEmptyDirs(live)
      await fsp.mkdir(live, { recursive: true })
    }
    // Daily records snapshot (.json only)
    const day = path.join(root, 'Daily records', localDay())
    for (const rel of src.keys()) {
      if (!/\.json$/i.test(rel)) continue
      const to = path.join(day, rel)
      await fsp.mkdir(path.dirname(to), { recursive: true })
      await fsp.copyFile(path.join(dataRoot, rel), to)
    }
    try {
      const days = (await fsp.readdir(path.join(root, 'Daily records'), { withFileTypes: true }))
        .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).map(e => e.name).sort()
      for (const old of days.slice(0, Math.max(0, days.length - ONLINE_KEEP_DAYS))) {
        await fsp.rm(path.join(root, 'Daily records', old), { recursive: true, force: true })
      }
    } catch { /* ignore */ }
    onlineState = { ...onlineState, running: false, lastOk: new Date().toISOString(), copied, removed, files: src.size, bytes,
      error: looksIncomplete ? 'Data folder looked incomplete, so nothing was removed from the online copy.' : '' }
    const cfg = loadConfig(); cfg.onlineBackupLastOk = onlineState.lastOk; saveConfig(cfg)
  } catch (err) {
    onlineState = { ...onlineState, running: false, error: err.message || String(err) }
  }
  return onlineState
}

ipcMain.handle('onlineBackup:run', () => runOnlineBackup())
ipcMain.handle('onlineBackup:status', () => {
  const cfg = loadConfig()
  return { ...onlineState, target: onlineState.target || getOnlineBackupRoot(), lastOk: onlineState.lastOk || cfg.onlineBackupLastOk || null }
})
ipcMain.handle('onlineBackup:openFolder', () => {
  const root = getOnlineBackupRoot()
  if (root && fs.existsSync(root)) shell.openPath(root)
  return !!root
})

// ── PDF export — renders a fully-styled HTML document to a real PDF using
// Electron's own print engine, off-screen. Reuses whatever HTML the caller
// already built (same layout, same styling) rather than re-implementing it
// with manual PDF drawing.
ipcMain.handle('pdf:fromHtml', async (event, html) => {
  const tempPath = path.join(app.getPath('temp'), `pdf-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  fs.writeFileSync(tempPath, html, 'utf-8')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadFile(tempPath)
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
    return pdfBuffer.toString('base64')
  } finally {
    win.destroy()
    fs.unlink(tempPath, () => {})
  }
})

// ── Draft a new email in the person's actual Outlook desktop app, with an
// attachment already on it, then leave it open as a draft — never sends
// anything on its own. Windows only, and only works if Outlook is installed
// and already signed in (this drives Outlook's own COM automation interface,
// the same one Outlook itself exposes for macros and add-ins).
// Opens a real compose window pre-addressed and pre-subjected, via the
// standard mailto: protocol — works with whatever the person's actual
// default mail app is (New Outlook included, unlike the old COM approach,
// which only ever worked with classic Outlook). mailto: links have never
// been able to carry an attachment (true of every mail client, not just
// this one) — so instead the PDF gets revealed in the file explorer,
// highlighted and selected, ready to drag straight into the compose window.
ipcMain.handle('email:draftMailto', async (event, { to, subject, attachmentPath }) => {
  try {
    // encodeURIComponent, not URLSearchParams — that turns spaces into "+"
    const mailto = `mailto:${encodeURIComponent(to || '')}${subject ? '?subject=' + encodeURIComponent(subject) : ''}`
    await shell.openExternal(mailto)
    // Callers pass the path saveFile returned, which is relative to the data folder.
    const full = attachmentPath && (path.isAbsolute(attachmentPath) ? attachmentPath : (dataRoot ? path.join(dataRoot, attachmentPath) : attachmentPath))
    if (full && fs.existsSync(full)) {
      shell.showItemInFolder(full)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── A ready-to-send draft in the person's mail app (New Outlook included):
// writes a standard .eml marked "X-Unsent: 1" — To, Subject, a written body
// and the real attachments — and opens it, so it comes up as a new message
// to check and send. Never sends anything itself. The file is plain 7-bit
// ASCII (everything else is base64), which is what New Outlook needs to keep
// the attachments. If the .eml can't be opened, falls back to mailto + the
// file highlighted in Explorer like before.
const EMAIL_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', txt: 'text/plain' }
function emlB64(buf) { return Buffer.from(buf).toString('base64').replace(/.{1,76}/g, '$&\r\n') }
function emlWord(t) { t = String(t || ''); return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=` }
function emlAddrs(list) { return (Array.isArray(list) ? list : String(list || '').split(/[;,]/)).map(x => String(x).trim()).filter(Boolean).join(', ') }
function emlEscape(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function buildEml({ to, cc, subject, text, html, files }) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const mixed = `=_mixed_${id}`, alt = `=_alt_${id}`
  const bodyText = String(text || '')
  const bodyHtml = html || `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${emlEscape(bodyText).replace(/\r?\n/g, '<br>')}</div>`
  const out = [
    'X-Unsent: 1',
    `To: ${emlAddrs(to)}`,
    ...(emlAddrs(cc) ? [`Cc: ${emlAddrs(cc)}`] : []),
    `Subject: ${emlWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    emlB64(Buffer.from(bodyText, 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    emlB64(Buffer.from(`<html><body>${bodyHtml}</body></html>`, 'utf8')),
    `--${alt}--`,
    '',
  ]
  for (const f of files) {
    const name = path.basename(f)
    const ext = (name.split('.').pop() || '').toLowerCase()
    const type = EMAIL_MIME[ext] || 'application/octet-stream'
    out.push(`--${mixed}`, `Content-Type: ${type}; name="${emlWord(name)}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${emlWord(name)}"`, '', emlB64(fs.readFileSync(f)))
  }
  out.push(`--${mixed}--`, '')
  return out.join('\r\n')
}
ipcMain.handle('email:draft', async (event, opts = {}) => {
  const resolve = p => p && (path.isAbsolute(p) ? p : (dataRoot ? path.join(dataRoot, p) : p))
  const wanted = [...(opts.attachments || []), ...(opts.attachmentPath ? [opts.attachmentPath] : [])].filter(Boolean)
  const files = [], missing = []
  for (const p of [...new Set(wanted)]) { const f = resolve(p); if (f && fs.existsSync(f)) files.push(f); else missing.push(String(p).split(/[\\/]/).pop()) }
  try {
    const dir = path.join(app.getPath('temp'), 'SCE Email Drafts')
    fs.mkdirSync(dir, { recursive: true })
    // tidy drafts older than a week
    try { for (const n of fs.readdirSync(dir)) { const fp = path.join(dir, n); if (Date.now() - fs.statSync(fp).mtimeMs > 7 * 86400000) fs.unlinkSync(fp) } } catch { /* ignore */ }
    const safe = String(opts.subject || 'Email').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Email'
    const file = path.join(dir, `${safe} ${Date.now().toString(36)}.eml`)
    fs.writeFileSync(file, buildEml({ ...opts, files }), 'latin1')
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
    return { ok: true, method: 'eml', attached: files.map(f => path.basename(f)), missing }
  } catch (err) {
    // fallback: compose window + the first file highlighted to drag in
    try {
      await shell.openExternal(`mailto:${encodeURIComponent(emlAddrs(opts.to))}${opts.subject ? '?subject=' + encodeURIComponent(opts.subject) : ''}${opts.text ? (opts.subject ? '&' : '?') + 'body=' + encodeURIComponent(String(opts.text).slice(0, 1500)) : ''}`)
      if (files[0]) shell.showItemInFolder(files[0])
      return { ok: true, method: 'mailto', attached: [], missing, error: err.message }
    } catch (e2) { return { ok: false, error: e2.message } }
  }
})

function hubFolderName(hub) { return hub === 'jobs' ? 'Jobs' : 'Quotes' }

// ── Scan the whole tree into the shape the app expects on load ──
ipcMain.handle('data:loadAll', () => {
  if (!dataRoot) return null
  return {
    jobs: scanHub('Jobs', 'project.json'),
    quotes: scanHub('Quotes', 'quote.json'),
  }
})

// Lighter-weight than data:loadAll — for callers (job pickers, attach-to-job
// UI) that only need the jobs list itself, not quotes as well.
ipcMain.handle('data:loadJobsOnly', () => {
  if (!dataRoot) return null
  return scanHub('Jobs', 'project.json')
})

function scanHub(hubFolder, recordFile) {
  const hubPath = path.join(dataRoot, hubFolder)
  const customers = []
  const records = []
  if (!fs.existsSync(hubPath)) return { customers, records }
  for (const custDirName of fs.readdirSync(hubPath)) {
    const custPath = path.join(hubPath, custDirName)
    if (!fs.statSync(custPath).isDirectory()) continue
    const custMeta = readJsonSafe(path.join(custPath, 'customer.json'), null)
    if (!custMeta) continue
    customers.push({ ...custMeta, folder: custDirName })
    for (const projDirName of fs.readdirSync(custPath)) {
      const projPath = path.join(custPath, projDirName)
      if (!fs.statSync(projPath).isDirectory()) continue
      const rec = readJsonSafe(path.join(projPath, recordFile), null)
      if (!rec) continue
      records.push({ ...rec, customerId: custMeta.id, folder: projDirName, customerFolder: custDirName })
    }
  }
  return { customers, records }
}

// Every handler that changes jobs/quotes on disk goes through here, so the
// other open windows hear about it and reload.
// Keep the job/quote list the morning email run reads (app-index.json) up to
// date: refresh it shortly after any save (batched, so a burst of edits only
// writes once). writeOrdersIndex skips the write when nothing changed.
let indexTimer = null
function scheduleIndexRefresh() {
  clearTimeout(indexTimer)
  indexTimer = setTimeout(() => { try { writeOrdersIndex() } catch { /* best effort */ } }, 5000)
}

function handleDataWrite(channel, fn) {
  ipcMain.handle(channel, async (e, args) => {
    const result = await fn(e, args)
    broadcastDataChanged(e.sender)
    scheduleIndexRefresh()
    return result
  })
}

// ── Customers (top level of a hub) ──
handleDataWrite('data:saveCustomer', (e, { hub, customer }) => {
  const hubPath = path.join(dataRoot, hubFolderName(hub))
  ensureDir(hubPath)
  let folder = customer.folder
  if (!folder) folder = path.basename(uniqueDir(hubPath, customer.name))
  const custPath = path.join(hubPath, folder)
  ensureDir(custPath)
  // Persist every field on the customer (contact details, billing info, quote
  // numbering, trashedAt…) — only the on-disk folder name is derived, not stored.
  const { folder: _derivedFolder, ...fields } = customer
  writeJson(path.join(custPath, 'customer.json'), { ...fields, trashedAt: fields.trashedAt || null })
  return folder
})

handleDataWrite('data:renameCustomerFolder', (e, { hub, oldFolder, newName }) => {
  const hubPath = path.join(dataRoot, hubFolderName(hub))
  const oldPath = path.join(hubPath, oldFolder)
  const newPath = uniqueDir(hubPath, newName)
  if (fs.existsSync(oldPath) && oldPath !== newPath) fs.renameSync(oldPath, newPath)
  return path.basename(newPath)
})

handleDataWrite('data:deleteCustomerFolder', (e, { hub, folder }) => {
  const p = path.join(dataRoot, hubFolderName(hub), folder)
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
})

// ── Records (a Job/Project or a Quote — lives inside a customer folder) ──
handleDataWrite('data:saveRecord', (e, { hub, customerFolder, record, recordFileName }) => {
  const custPath = path.join(dataRoot, hubFolderName(hub), customerFolder)
  ensureDir(custPath)
  let folder = record.folder
  const desiredName = record.folderName || record.name || record.title || 'Untitled'
  if (!folder) folder = path.basename(uniqueDir(custPath, desiredName))
  const recPath = path.join(custPath, folder)
  ensureDir(recPath)
  ensureDir(path.join(recPath, 'Files'))
  const { folder: _f, customerFolder: _cf, customerId, ...rest } = record
  writeJson(path.join(recPath, recordFileName), rest)
  return folder
})

handleDataWrite('data:renameRecordFolder', (e, { hub, customerFolder, oldFolder, newName }) => {
  const custPath = path.join(dataRoot, hubFolderName(hub), customerFolder)
  const oldPath = path.join(custPath, oldFolder)
  const newPath = uniqueDir(custPath, newName)
  if (fs.existsSync(oldPath) && oldPath !== newPath) fs.renameSync(oldPath, newPath)
  return path.basename(newPath)
})

handleDataWrite('data:deleteRecordFolder', (e, { hub, customerFolder, folder }) => {
  const p = path.join(dataRoot, hubFolderName(hub), customerFolder, folder)
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
})

// Moving a job/quote to a different customer means physically relocating its
// whole folder (files included) from the old customer's folder to the new one.
handleDataWrite('data:moveRecordToCustomer', (e, { hub, oldCustomerFolder, newCustomerFolder, folder }) => {
  const oldCustPath = path.join(dataRoot, hubFolderName(hub), oldCustomerFolder)
  const newCustPath = path.join(dataRoot, hubFolderName(hub), newCustomerFolder)
  const oldPath = path.join(oldCustPath, folder)
  if (!fs.existsSync(oldPath)) return { ok: false, error: 'Could not find that record\'s folder.' }
  ensureDir(newCustPath)
  const newPath = uniqueDir(newCustPath, folder)
  fs.cpSync(oldPath, newPath, { recursive: true })
  fs.rmSync(oldPath, { recursive: true, force: true })
  return { ok: true, folder: path.basename(newPath) }
})

// ── App storage snapshot ──
// Materials, timesheets, notes, non-job time, to-dos, trash, etc. live in the
// app's internal storage, not in record folders. The app mirrors them into
// "App Data/app-storage.json" inside the data folder so they're included in
// every backup and survive a reinstall or a new PC.
const localSnapshotPath = () => path.join(dataRoot, 'App Data', 'app-storage.json')

ipcMain.handle('localdata:save', (e, json) => {
  if (!dataRoot || typeof json !== 'string') return false
  writeJson(localSnapshotPath(), JSON.parse(json))
  return true
})

ipcMain.handle('localdata:load', () => {
  if (!dataRoot) return null
  return readJsonSafe(localSnapshotPath(), null)
})

// True once, right after a backup restore — the renderer then replaces its
// internal storage with the snapshot that came back with the restored folder.
ipcMain.handle('localdata:takeRestoreFlag', () => {
  const cfg = loadConfig()
  if (!cfg.restoreLocalPending) return false
  delete cfg.restoreLocalPending
  saveConfig(cfg)
  return true
})

// ── Orders & POs feed ──
// Claude's morning email run writes "orders.json" into the "Field App" folder
// of the SCE OneDrive; OneDrive syncs it to this PC. The app only reads that
// file. Anything changed here (marked received, closed, a note) is written to
// "orders-app.json" next to it, which syncs back up and the next run respects.
const ORDERS_FEED_FILE = 'orders.json'
const ORDERS_APP_FILE = 'orders-app.json'
const ORDERS_PREVIOUS_FILE = 'orders-previous.json'
const ORDERS_INDEX_FILE = 'app-index.json'

// Likely spots for the synced "Field App" folder, best guess first.
function guessOrdersFolders() {
  const home = app.getPath('home')
  const out = []
  if (process.env.OneDriveCommercial) out.push(path.join(process.env.OneDriveCommercial, 'Field App'))
  try {
    for (const name of fs.readdirSync(home)) {
      if (/^OneDrive - /i.test(name)) out.push(path.join(home, name, 'Field App'))
    }
  } catch { /* ignore */ }
  if (process.env.OneDrive) out.push(path.join(process.env.OneDrive, 'Field App'))
  return [...new Set(out)]
}

function getOrdersFolder() {
  const cfg = loadConfig()
  if (cfg.ordersFolder && fs.existsSync(path.join(cfg.ordersFolder, ORDERS_FEED_FILE))) return cfg.ordersFolder
  const found = guessOrdersFolders().find(f => fs.existsSync(path.join(f, ORDERS_FEED_FILE)))
  if (found) {
    saveConfig({ ...loadConfig(), ordersFolder: found })
    return found
  }
  return cfg.ordersFolder || null
}

// A short list of open quotes and active jobs, written next to the feed so the
// morning email run can file new orders under the right quote or job.
function writeOrdersIndex() {
  try {
    const folder = getOrdersFolder()
    if (!folder || !dataRoot) return
    const custName = (hub) => {
      const map = {}
      hub.customers.forEach(c => { map[c.id] = c.name })
      return map
    }
    const quotesHub = scanHub('Quotes', 'quote.json')
    const jobsHub = scanHub('Jobs', 'project.json')
    const qc = custName(quotesHub)
    const jc = custName(jobsHub)
    const quotes = quotesHub.records
      .filter(q => !q.trashedAt && !q.invalidated && !q.approved && q.quoteNumber)
      .map(q => ({ quoteNumber: q.quoteNumber, title: q.title || '', customer: qc[q.customerId] || '', sentDate: q.sentDate || '' }))
    const jobs = jobsHub.records
      .filter(j => !j.trashedAt && j.closed !== true && j.lifecycleStatus !== 'billed' && j.name)
      .map(j => ({ name: j.name, co: j.co || '', customer: jc[j.customerId] || '' }))
    const next = { version: 1, quotes, jobs }
    const p = path.join(folder, ORDERS_INDEX_FILE)
    const cur = readJsonSafe(p, null)
    if (cur && JSON.stringify({ ...cur, updatedAt: undefined }) === JSON.stringify({ ...next, updatedAt: undefined })) return
    writeJson(p, { ...next, updatedAt: new Date().toISOString() })
  } catch { /* best effort — never blocks the app */ }
}

ipcMain.handle('orders:load', () => {
  writeOrdersIndex()
  const folder = getOrdersFolder()
  if (!folder) return { folder: null, feed: null, local: null, error: 'not-found' }
  const feedPath = path.join(folder, ORDERS_FEED_FILE)
  if (!fs.existsSync(feedPath)) return { folder, feed: null, local: null, error: 'no-feed' }
  let feedMtime = null
  try { feedMtime = fs.statSync(feedPath).mtimeMs } catch { /* ignore */ }
  const feed = readJsonSafe(feedPath, null)
  const local = readJsonSafe(path.join(folder, ORDERS_APP_FILE), { version: 1, overrides: {} })
  const previous = readJsonSafe(path.join(folder, ORDERS_PREVIOUS_FILE), null)
  return { folder, feed, local, previous, feedMtime, error: feed ? null : 'bad-feed' }
})

ipcMain.handle('orders:chooseFolder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow
  const result = await dialog.showOpenDialog(win, {
    title: 'Pick the "Field App" folder in your SCE OneDrive',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return getOrdersFolder()
  saveConfig({ ...loadConfig(), ordersFolder: result.filePaths[0] })
  return result.filePaths[0]
})

ipcMain.handle('orders:saveLocal', (e, local) => {
  const folder = getOrdersFolder()
  if (!folder || !local || typeof local !== 'object') return false
  writeJson(path.join(folder, ORDERS_APP_FILE), { ...local, version: 1, updatedAt: new Date().toISOString() })
  return true
})

// Wholesaler invoices / packing slips the morning email run read from email
// ("Field App/slips.json"). The app queues them for Dustin to confirm.
const SLIPS_FEED_FILE = 'slips.json'
ipcMain.handle('orders:loadSlipsFeed', () => {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder' }
  const feed = readJsonSafe(path.join(folder, SLIPS_FEED_FILE), null)
  return { ok: !!feed, feed }
})
ipcMain.handle('orders:openFolder', () => {
  const folder = getOrdersFolder()
  if (folder) shell.openPath(folder)
})

// Morning review: project notes drafted from email by the morning run
// ("email-notes.json"), and Dustin's approve/skip decisions ("email-notes-app.json").
const EMAIL_NOTES_FILE = 'email-notes.json'
const EMAIL_NOTES_APP_FILE = 'email-notes-app.json'
// Extra suggestions added outside the morning run (e.g. from a chat with
// Claude). Merged in by id, so anything already in the main feed wins.
const EMAIL_NOTES_EXTRA_FILE = 'email-notes-extra.json'
ipcMain.handle('emailNotes:load', () => {
  const folder = getOrdersFolder()
  if (!folder) return { folder: null, feed: null, local: null, error: 'not-found' }
  let feed = readJsonSafe(path.join(folder, EMAIL_NOTES_FILE), null)
  const extra = readJsonSafe(path.join(folder, EMAIL_NOTES_EXTRA_FILE), null)
  if (extra && Array.isArray(extra.items) && extra.items.length) {
    const base = feed && Array.isArray(feed.items) ? feed : { version: 1, items: [] }
    const have = new Set(base.items.map(i => i && i.id))
    feed = { ...base, items: [...base.items, ...extra.items.filter(i => i && i.id && !have.has(i.id))] }
  }
  const local = readJsonSafe(path.join(folder, EMAIL_NOTES_APP_FILE), { version: 1, decisions: {} })
  return { folder, feed, local, error: null }
})
// Assistant Update → "Update me now": starts the "SCE email daily catch"
// scheduled run right away through its API trigger. The token is per-routine,
// made once at claude.ai/code/routines (routine → Add another trigger → API →
// Generate token), pasted into the app, and kept only in this PC's config.json.
const ASSISTANT_ROUTINE_ID = 'trig_017BJPGVyAXthPiRLTbjX2hp'
ipcMain.handle('assistant:status', () => {
  const cfg = loadConfig()
  return { hasToken: !!cfg.assistantToken, lastManualRun: cfg.assistantLastRun || null }
})
ipcMain.handle('assistant:setToken', (e, token) => {
  const t = String(token || '').trim()
  const cfg = loadConfig()
  if (t) cfg.assistantToken = t
  else delete cfg.assistantToken
  saveConfig(cfg)
  return !!t
})
ipcMain.handle('assistant:updateNow', async () => {
  const cfg = loadConfig()
  if (!cfg.assistantToken) return { ok: false, error: 'no-token' }
  const now = new Date()
  const text = `On-demand run started from Dustin's desktop app ("Update me now") at ${now.toLocaleString('en-CA', { timeZone: 'America/Edmonton' })} Mountain time. ` +
    'For Part A use the window since the previous run (the updatedAt in email-notes.json / orders.json), not since 6 am, and keep the report short. ' +
    'Do Parts B and C as usual, skip anything already in the feeds, and always write orders.json and email-notes.json so the app sees the update.'
  try {
    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${ASSISTANT_ROUTINE_ID}/fire`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.assistantToken}`,
        'anthropic-version': '2026-10-21',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    })
    let body = null
    try { body = await res.json() } catch { /* ignore */ }
    if (!res.ok) {
      const kind = res.status === 401 ? 'bad-token' : res.status === 429 ? 'rate-limit' : 'failed'
      return { ok: false, error: kind, status: res.status, retryAfter: res.headers.get('retry-after'), message: body?.error?.message || '' }
    }
    saveConfig({ ...loadConfig(), assistantLastRun: now.toISOString() })
    return { ok: true, startedAt: now.toISOString(), sessionUrl: body?.claude_code_session_url || null }
  } catch (err) {
    return { ok: false, error: 'offline', message: err.message }
  }
})

// Materials → "Search email for the PDF": asks the same email run to find the
// quote / PO email for one purchase and save its PDF into Field App/Quote Slips
// (and Material Slips for a packing slip), so the app can open and read it.
ipcMain.handle('assistant:findPdf', async (e, req = {}) => {
  const cfg = loadConfig()
  if (!cfg.assistantToken) return { ok: false, error: 'no-token' }
  const clean = v => String(v || '').replace(/[^\w .#,&()\/-]/g, '').slice(0, 120)
  const quotes = (Array.isArray(req.quotes) ? req.quotes : []).map(clean).filter(Boolean)
  const po = clean(req.po), supplier = clean(req.supplier), invoices = (Array.isArray(req.invoices) ? req.invoices : []).map(clean).filter(Boolean)
  if (!po && !quotes.length && !invoices.length) return { ok: false, error: 'nothing-to-search' }
  const text = 'FIND-PDF REQUEST from Dustin\'s desktop app — do ONLY this, skip Parts A, B and C and the report. ' +
    `Search his SCE mailbox (inbox, sent and archive, any date) for the email(s) about this purchase: ` +
    `${supplier ? 'supplier ' + supplier + '; ' : ''}${po ? 'PO ' + po + '; ' : ''}${quotes.length ? 'quote/order # ' + quotes.join(', ') + '; ' : ''}${invoices.length ? 'invoice/packing slip # ' + invoices.join(', ') : ''}. ` +
    'Match on the PO # first (Jonathan\'s PO emails to the wholesaler), then the quote/order #. ' +
    'Save each PDF attachment that is the quote, order confirmation or invoice into OneDrive "Field App/Quote Slips" named with the quote/order # (e.g. QT6058422.pdf); ' +
    'a packing slip or invoice for a pick-up goes into "Field App/Material Slips" named "YYYY-MM-DD - Supplier - Inv <number>.pdf". Don\'t overwrite a file that is already there. ' +
    'If the quote # has no row in orders.json, leave orders.json alone. When done, add one line to email-notes.json under a "findPdf" list: what you searched, what you saved, or "not found".'
  try {
    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${ASSISTANT_ROUTINE_ID}/fire`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.assistantToken}`, 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    let body = null
    try { body = await res.json() } catch { /* ignore */ }
    if (!res.ok) {
      const kind = res.status === 401 ? 'bad-token' : res.status === 429 ? 'rate-limit' : 'failed'
      return { ok: false, error: kind, status: res.status, retryAfter: res.headers.get('retry-after'), message: body?.error?.message || '' }
    }
    return { ok: true, startedAt: new Date().toISOString(), sessionUrl: body?.claude_code_session_url || null }
  } catch (err) {
    return { ok: false, error: 'offline', message: err.message }
  }
})

ipcMain.handle('emailNotes:saveLocal', (e, local) => {
  const folder = getOrdersFolder()
  if (!folder || !local || typeof local !== 'object') return false
  writeJson(path.join(folder, EMAIL_NOTES_APP_FILE), { ...local, version: 1, updatedAt: new Date().toISOString() })
  return true
})

// Quote PDFs saved by Dustin's Power Automate flow into "Field App/Quote Slips".
// Find the newest PDF whose file name contains the quote number and open it.
const QUOTE_SLIPS_DIR = 'Quote Slips'
function quoteKey(s) {
  return String(s || '').toLowerCase().replace(/^order\s*/, '').replace(/[^0-9a-z]/g, '')
}
function findQuoteFile(number) {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder' }
  const dir = path.join(folder, QUOTE_SLIPS_DIR)
  if (!fs.existsSync(dir)) return { ok: false, reason: 'no-quote-slips', dir }
  const key = quoteKey(number)
  if (key.length < 4) return { ok: false, reason: 'bad-number' }
  let best = null
  for (const name of fs.readdirSync(dir)) {
    if (!/\.pdf$/i.test(name)) continue
    // The flow prefixes files with the arrival time ("20261027-0805_QT6049297.pdf"); ignore it when matching.
    const bare = quoteKey(name.replace(/^\d{8}-\d{4,6}_/, '').replace(/\.pdf$/i, ''))
    if (!bare.includes(key)) continue
    let mtime = 0
    try { mtime = fs.statSync(path.join(dir, name)).mtimeMs } catch { /* ignore */ }
    if (!best || mtime > best.mtime || (mtime === best.mtime && name > best.name)) best = { name, mtime }
  }
  if (!best) return { ok: false, reason: 'not-found', dir }
  return { ok: true, file: path.join(dir, best.name), name: best.name }
}
// ── OneDrive web links (for the timesheet PDF that goes to Jonathan) ──
// Files under the local OneDrive folder are reachable on the web at
// <OneDrive web address>/<same path>. The web address comes from the OneDrive
// app's own settings in the registry (or can be set by hand in Settings).
// Jonathan can open them once the folder is shared with him in OneDrive.
function oneDriveLocalRoot() {
  const fa = getOrdersFolder()
  const cands = []
  if (process.env.OneDriveCommercial) cands.push(process.env.OneDriveCommercial)
  try { const home = app.getPath('home'); for (const n of fs.readdirSync(home)) if (/^OneDrive - /i.test(n)) cands.push(path.join(home, n)) } catch { /* ignore */ }
  if (fa) {
    const hit = cands.find(c => path.resolve(fa).toLowerCase().startsWith(path.resolve(c).toLowerCase() + path.sep))
    if (hit) return hit
    return path.dirname(fa) // Field App sits at the top of the OneDrive
  }
  return cands[0] || null
}
let detectedWebBase
function detectOneDriveWebBase(root) {
  if (detectedWebBase !== undefined) return detectedWebBase
  detectedWebBase = null
  if (process.platform !== 'win32' || !root) return null
  try {
    const { execFileSync } = require('child_process')
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s'], { encoding: 'utf8', windowsHide: true })
    const blocks = out.split(/\r?\n(?=HKEY_)/)
    const val = (b, k) => { const m = b.match(new RegExp('^\\s*' + k + '\\s+REG_\\w+\\s+(.+)$', 'mi')); return m ? m[1].trim() : '' }
    for (const b of blocks) {
      const uf = val(b, 'UserFolder')
      if (!uf || path.resolve(uf).toLowerCase() !== path.resolve(root).toLowerCase()) continue
      const ep = val(b, 'ServiceEndpointUri')
      if (/^https:\/\/.+\/personal\/[^/]+/i.test(ep)) { detectedWebBase = ep.replace(/\/_api\/?$/i, '').replace(/\/+$/, '') + '/Documents'; break }
      const spo = val(b, 'SPOResourceId'), email = val(b, 'UserEmail')
      if (spo && email) { detectedWebBase = spo.replace(/\/+$/, '') + '/personal/' + email.toLowerCase().replace(/[@.]/g, '_') + '/Documents'; break }
    }
  } catch { /* no OneDrive info */ }
  return detectedWebBase
}
function oneDriveInfo() {
  const root = oneDriveLocalRoot()
  const cfg = loadConfig()
  const detected = detectOneDriveWebBase(root)
  return { root, detected, webBase: (cfg.oneDriveWebBase || detected || '').replace(/\/+$/, '') }
}
function oneDriveUrlFor(fullPath, info) {
  const inf = info || oneDriveInfo()
  if (!inf.root || !inf.webBase || !fullPath) return null
  const rel = path.relative(inf.root, fullPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return inf.webBase + '/' + rel.split(path.sep).map(encodeURIComponent).join('/')
}
ipcMain.handle('onedrive:info', () => oneDriveInfo())
ipcMain.handle('onedrive:setWebBase', (e, url) => {
  saveConfig({ ...loadConfig(), oneDriveWebBase: String(url || '').trim() })
  return oneDriveInfo()
})
// Copy slip files (paths relative to the data folder) into
// "Field App/<subfolder>" and return a web link for each, plus links for the
// supplier quote PDFs already in Quote Slips.
ipcMain.handle('onedrive:publishSlips', (e, { subfolder, files, quotes }) => {
  const fa = getOrdersFolder()
  const info = oneDriveInfo()
  const out = { ok: !!fa, webBase: info.webBase, files: {}, quotes: {} }
  if (!fa) return out
  const dest = path.join(fa, subfolder || 'Material Slips')
  for (const f of files || []) {
    try {
      const src = path.isAbsolute(f.rel) ? f.rel : path.join(dataRoot || '', f.rel)
      if (!fs.existsSync(src)) continue
      ensureDir(dest)
      const name = String(f.name || path.basename(src)).replace(/[<>:"/\\|?*]/g, ' ').trim()
      const to = path.join(dest, name)
      fs.copyFileSync(src, to)
      out.files[f.key] = oneDriveUrlFor(to, info)
    } catch { /* skip this one */ }
  }
  for (const n of quotes || []) {
    const r = findQuoteFile(n)
    if (r.ok) out.quotes[n] = oneDriveUrlFor(r.file, info)
  }
  return out
})
ipcMain.handle('orders:openQuoteFile', async (e, number) => {
  const r = findQuoteFile(number)
  if (r.ok) {
    const err = await shell.openPath(r.file)
    if (err) return { ok: false, reason: 'open-failed', error: err, file: r.file }
  }
  return r
})
// Jonathan's emails, saved by Dustin's Power Automate flow into
// "Field App/PO Emails" (one text/HTML file per email). The app reads them on
// Refresh and fills in the PO # on the matching quote.
const PO_EMAILS_DIR = 'PO Emails'
ipcMain.handle('orders:readPoEmails', () => {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder', files: [] }
  const dir = path.join(folder, PO_EMAILS_DIR)
  if (!fs.existsSync(dir)) return { ok: true, missing: true, files: [] }
  const files = []
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(txt|html?|json|eml)$/i.test(name)) continue
    const full = path.join(dir, name)
    try {
      const st = fs.statSync(full)
      if (!st.isFile() || st.size > 2 * 1024 * 1024) continue
      // skip files older than 60 days
      if (Date.now() - st.mtimeMs > 60 * 86400000) continue
      files.push({ name, mtime: st.mtimeMs, text: fs.readFileSync(full, 'utf8') })
    } catch { /* still syncing — next time */ }
  }
  return { ok: true, files }
})

ipcMain.handle('orders:openQuoteSlips', () => {
  const folder = getOrdersFolder()
  if (!folder) return false
  const dir = path.join(folder, QUOTE_SLIPS_DIR)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  shell.openPath(dir)
  return true
})

// Refresh: list the PDFs in Quote Slips so the app can pick up quotes that
// arrived after the morning run, and read one for parsing.
ipcMain.handle('orders:listQuoteSlips', () => {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder' }
  const dir = path.join(folder, QUOTE_SLIPS_DIR)
  if (!fs.existsSync(dir)) return { ok: false, reason: 'no-quote-slips', dir }
  const files = []
  for (const name of fs.readdirSync(dir)) {
    if (!/\.pdf$/i.test(name)) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      if (!st.isFile()) continue
      files.push({ name, key: quoteKey(name.replace(/^\d{8}-\d{4,6}_/, '').replace(/\.pdf$/i, '')), mtimeMs: st.mtimeMs, size: st.size })
    } catch { /* skip unreadable */ }
  }
  return { ok: true, dir, files }
})
ipcMain.handle('orders:readQuoteSlip', (e, name) => {
  const folder = getOrdersFolder()
  if (!folder || typeof name !== 'string' || /[\\/]/.test(name) || !/\.pdf$/i.test(name)) return null
  const file = path.join(folder, QUOTE_SLIPS_DIR, name)
  try { return fs.readFileSync(file).toString('base64') } catch { return null }
})

// Copy a quote's PDF from Quote Slips into a job's or quote's Files folder
// once it's filed there. Skips it if that file is already in Files.
ipcMain.handle('orders:copyQuoteToRecord', (e, { number, hub, customerFolder, folder } = {}) => {
  if (!dataRoot) return { ok: false, reason: 'no-data-root' }
  if (!['Jobs', 'Quotes'].includes(hub) || !customerFolder || !folder) return { ok: false, reason: 'bad-target' }
  if ([customerFolder, folder].some(s => /[\\/]|\.\./.test(String(s)))) return { ok: false, reason: 'bad-target' }
  const r = findQuoteFile(number)
  if (!r.ok) return r
  const recDir = path.join(dataRoot, hub, customerFolder, folder)
  if (!fs.existsSync(recDir)) return { ok: false, reason: 'no-record' }
  const filesDir = path.join(recDir, 'Files')
  ensureDir(filesDir)
  const clean = r.name.replace(/^\d{8}-\d{4,6}_/, '')
  const dest = path.join(filesDir, clean)
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(r.file).size) return { ok: true, skipped: true, dest }
    fs.copyFileSync(r.file, dest)
    return { ok: true, dest }
  } catch (err) {
    return { ok: false, reason: 'copy-failed', error: err.message }
  }
})

// No PDF in Quote Slips for a quote: let Dustin pick one (e.g. saved from
// Outlook) and file it there under the quote number.
ipcMain.handle('orders:attachQuoteFile', async (e, number) => {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder' }
  const key = quoteKey(number)
  if (key.length < 4) return { ok: false, reason: 'bad-number' }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Pick the PDF for quote ${number}`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'canceled' }
  const dir = path.join(folder, QUOTE_SLIPS_DIR)
  ensureDir(dir)
  const src = result.filePaths[0]
  const base = path.basename(src)
  const name = quoteKey(base).includes(key) ? base : `${String(number).replace(/[^0-9A-Za-z-]/g, '')}.pdf`
  const dest = path.join(dir, name)
  try { fs.copyFileSync(src, dest) } catch (err) { return { ok: false, reason: 'copy-failed', error: err.message } }
  return { ok: true, file: dest, name }
})

// Original work order files saved by Dustin's Power Automate flow into
// "Field App/Work Orders", named "<yyyyMMdd-HHmm UTC>_<attachment name>".
// Edwin's forms all share one file name, so the arrival time is the match key:
// within 3 minutes of the email's receivedAt, else the same local day (and
// the same file name) when that leaves exactly one file.
const WORK_ORDERS_DIR = 'Work Orders'
function woNameKey(s) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^0-9a-z]/g, '') }
function findWorkOrderFile({ receivedAt, date, fileName } = {}) {
  const folder = getOrdersFolder()
  if (!folder) return { ok: false, reason: 'no-folder' }
  const dir = path.join(folder, WORK_ORDERS_DIR)
  if (!fs.existsSync(dir)) return { ok: false, reason: 'no-work-orders', dir }
  const files = []
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?_(.+)$/)
    if (!m) continue
    const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
    files.push({ name, at, rest: m[7] })
  }
  const want = woNameKey(fileName)
  const sameName = f => !want || woNameKey(f.rest) === want
  const t = receivedAt ? Date.parse(receivedAt) : NaN
  if (!Number.isNaN(t)) {
    const near = files.filter(f => Math.abs(f.at - t) <= 3 * 60 * 1000)
      .sort((a, b) => (sameName(b) - sameName(a)) || (Math.abs(a.at - t) - Math.abs(b.at - t)))
    if (near.length) return { ok: true, file: path.join(dir, near[0].name), name: near[0].name, rest: near[0].rest }
  }
  const day = String(date || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const same = files.filter(f => localDay(new Date(f.at)) === day && sameName(f))
    if (same.length === 1) return { ok: true, file: path.join(dir, same[0].name), name: same[0].name, rest: same[0].rest }
    if (same.length > 1) return { ok: false, reason: 'ambiguous', dir, names: same.map(f => f.name) }
  }
  return { ok: false, reason: 'not-found', dir }
}
function copyIntoRecordFiles(src, { customerFolder, folder, destBase } = {}) {
  if (!dataRoot) return { ok: false, reason: 'no-data-root' }
  if (!customerFolder || !folder || [customerFolder, folder].some(s => /[\\/]|\.\./.test(String(s)))) return { ok: false, reason: 'bad-target' }
  const recDir = path.join(dataRoot, 'Jobs', customerFolder, folder)
  if (!fs.existsSync(recDir)) return { ok: false, reason: 'no-record' }
  const filesDir = path.join(recDir, 'Files')
  ensureDir(filesDir)
  const ext = path.extname(src) || ''
  const base = String(destBase || path.basename(src, ext)).replace(/[<>:"/\\|?*]/g, '').trim() || 'Work Order'
  const dest = path.join(filesDir, `${base}${ext}`)
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) return { ok: true, skipped: true, dest, name: path.basename(dest) }
    fs.copyFileSync(src, dest)
    return { ok: true, dest, name: path.basename(dest) }
  } catch (err) {
    return { ok: false, reason: 'copy-failed', error: err.message }
  }
}
ipcMain.handle('workOrders:copyToRecord', (e, { match, ...target } = {}) => {
  const r = findWorkOrderFile(match || {})
  if (!r.ok) return r
  return { ...copyIntoRecordFiles(r.file, target), source: r.name }
})
// Not in Work Orders (e.g. it came before the flow existed): pick the file by hand.
ipcMain.handle('workOrders:pickToRecord', async (e, target = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow
  const start = (() => { const f = getOrdersFolder(); const d = f && path.join(f, WORK_ORDERS_DIR); return d && fs.existsSync(d) ? d : undefined })()
  const result = await dialog.showOpenDialog(win, {
    title: 'Pick the original work order',
    defaultPath: start,
    filters: [{ name: 'Work order', extensions: ['docx', 'doc', 'pdf'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'canceled' }
  return copyIntoRecordFiles(result.filePaths[0], target)
})
ipcMain.handle('workOrders:openFolder', () => {
  const folder = getOrdersFolder()
  if (!folder) return false
  const dir = path.join(folder, WORK_ORDERS_DIR)
  ensureDir(dir)
  shell.openPath(dir)
  return true
})

// Links in the feed (tracker doc, Outlook messages) — https only.
ipcMain.handle('link:openExternal', (e, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url)
})

// ── File attachments (the "Files" folder inside any record) ──
ipcMain.handle('files:list', (e, folderPath) => {
  const full = path.join(dataRoot, folderPath)
  if (!fs.existsSync(full)) return []
  return fs.readdirSync(full)
    .filter(f => fs.statSync(path.join(full, f)).isFile())
    .map(f => ({ name: f, path: path.join(folderPath, f).split(path.sep).join('/') }))
})

ipcMain.handle('files:add', async (e, folderPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add files',
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) return null
  const full = path.join(dataRoot, folderPath)
  ensureDir(full)
  for (const src of result.filePaths) {
    // Never overwrite an existing attachment with the same name — add " (2)" etc.
    const ext = path.extname(src)
    const base = path.basename(src, ext)
    let dest = path.join(full, base + ext)
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(full, `${base} (${n})${ext}`)
    fs.copyFileSync(src, dest)
  }
  return fs.readdirSync(full)
    .filter(f => fs.statSync(path.join(full, f)).isFile())
    .map(f => ({ name: f, path: path.join(folderPath, f).split(path.sep).join('/') }))
})

ipcMain.handle('files:open', (e, relPath) => { shell.openPath(path.join(dataRoot, relPath)) })
ipcMain.handle('files:remove', (e, relPath) => {
  const full = path.join(dataRoot, relPath)
  if (fs.existsSync(full)) fs.unlinkSync(full)
})

ipcMain.handle('files:save', (e, { folderPath, fileName, base64 }) => {
  const full = path.join(dataRoot, folderPath)
  ensureDir(full)
  fs.writeFileSync(path.join(full, fileName), Buffer.from(base64, 'base64'))
  return path.join(folderPath, fileName).split(path.sep).join('/')
})

ipcMain.handle('files:readBytes', (e, relPath) => {
  const full = path.join(dataRoot, relPath)
  if (!fs.existsSync(full)) return null
  return fs.readFileSync(full).toString('base64')
})
