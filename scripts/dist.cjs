// npm run dist — build the app, then install it over the copy on this PC.
//
// 1. Stamps a fresh version from the date and time (1.YYDDD.HHMM), so every
//    build is newer than the last and Windows sees it as an update.
// 2. vite build + electron-builder → release\Field App Setup <version>.exe
// 3. Waits for the Field App to be closed, then runs that installer silently.
//    It installs (or updates) the app in your user folder, keeps the desktop
//    and Start menu shortcuts, and opens the new version.
//
// npm run dist:build does steps 1–2 only (no install).
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const buildOnly = process.argv.includes('--no-install')

function buildVersion(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d - start) / 86400000) // 1–366
  const yy = d.getFullYear() % 100
  // Every part of a Windows file version must stay under 65536
  return `1.${yy * 1000 + day}.${d.getHours() * 100 + d.getMinutes()}`
}

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

function appIsRunning() {
  if (process.platform !== 'win32') return false
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Field App.exe', '/NH'], { encoding: 'utf8' })
  return /Field App\.exe/i.test(r.stdout || '')
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const version = buildVersion()
console.log(`Building Field App ${version}`)
run('npx vite build')
run(`npx cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win --config.extraMetadata.version=${version}`)

const setup = path.join(root, 'release', `Field App Setup ${version}.exe`)
if (!fs.existsSync(setup)) {
  console.error(`\nBuilt, but couldn't find ${setup} to install.`)
  process.exit(1)
}
if (buildOnly || process.platform !== 'win32') {
  console.log(`\nBuilt ${setup}`)
  process.exit(0)
}

if (appIsRunning()) {
  console.log('\nThe Field App is open — close it and the update will install (waiting up to 10 minutes)…')
  const until = Date.now() + 10 * 60 * 1000
  while (appIsRunning() && Date.now() < until) sleep(2000)
  if (appIsRunning()) {
    console.log(`\nStill open, so the update wasn't installed. Close the app and double-click:\n  ${setup}`)
    process.exit(0)
  }
}

console.log('\nInstalling…')
const r = spawnSync(setup, ['/S', '--force-run'], { stdio: 'inherit' })
if (r.status === 0) console.log(`\n✓ Field App ${version} installed — it's opening now. Use the desktop icon from here on.`)
else console.log(`\nThe installer didn't finish (code ${r.status}). You can run it by hand:\n  ${setup}`)
