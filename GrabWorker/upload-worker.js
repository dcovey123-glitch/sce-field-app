/**
 * SCE Electric — R2 Upload Worker + Mobile Companion Page
 *
 * This is your existing upload-worker.js with ONE thing added: a small,
 * self-contained mobile page served directly from this same Worker (no
 * separate hosting needed). Visit the Worker's URL on your phone to view
 * Jobs/Quotes and upload job-site photos from anywhere — the desktop app
 * pulls those photos down into the right local folder next time it's online,
 * and the desktop is always the master copy of everything else.
 *
 * Routes:
 *   GET    /                — the mobile companion page (HTML)
 *   POST   /upload           — upload a file, returns { key, url }
 *   GET    /file/:key        — serve a file
 *   DELETE /file/:key        — delete a file
 *   GET    /list/:prefix     — list files under a prefix
 *   POST   /putjson          — store a named JSON file at an exact key
 *   POST   /parse-pdf        — proxy a PDF to Anthropic (unchanged from before)
 */

// ── Auth ──────────────────────────────────────────────────────────
// The password (UPLOAD_SECRET) comes in the X-Upload-Key header (desktop app,
// phone fetches) or the phone's sign-in cookie (for photos/links it opens).
function isAuthorized(request, env) {
  let key = request.headers.get('X-Upload-Key')
  if (!key) {
    const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)sce_k=([^;]+)/)
    if (m) { try { key = decodeURIComponent(m[1]) } catch { key = '' } }
  }
  return !!key && !!env.UPLOAD_SECRET && key === env.UPLOAD_SECRET
}

// ── CORS ──────────────────────────────────────────────────────────
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Key',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

// ── Web Push (8pm reminder) ─────────────────────────────────────────
// VAPID keys are generated once and kept in R2 (push/vapid.json) so there
// is nothing extra to configure. Pushes carry no payload; the service
// worker (/sw.js) builds the message text from time/state.json.
const REMINDER_HOUR = 20            // 8pm Alberta Time
// Alberta Time = UTC-6 all year since Nov 1, 2026. A fixed zone, so older
// time-zone tables (which still drop Edmonton to UTC-7 in winter) can't shift it.
const REMINDER_TZ = 'Etc/GMT+6'
const ICONS = { 180: "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAD1klEQVR42u3dTXYTMRBF4UQnY9gBU2YskQG7ZBusgAET4MR2O3ZLr0rfXUBaKl1VlZz+ef385dsL8B5DCEAOkAPkADlADpAD5AA5QA6QAyAHyAFygBxYwds+U/3549ez/tTX759kDigrADlADpAD5AA5QA6QA+QAOUAOgBwgBx7j1SsYIHOAHCAHyIGVvG0787tuKd3kptF9TytuMCbHWUJsKEpPOSY4sYMl3eRYokVXRfrIsVyLfop0kCNKi06K1JbjQS0OLt6cq5BjsRZPWaeFlybHk5fn1FXp/UtaPTmOr8e0xQgc0nZyHFyDhQuQP8KechyJe0jQCw21gxw3wx0Y64pj/o/BjJO4OarYn2fKZI7rESyRnOtOYQjr2hSSnD8GM/hRrKxciVfpf1jUmleiHPMj+O4VZ14r04/BjJwSk1ZfBjP4UfK00tKMQjMKkuPSpul6B++leeUkjxFuxp6ERGOEx6L3EyLhzccoGjvNxxZy7NZqFGo+PEiNVDmkjeTkMQpFSvOxkRyOr+FRGjaQucfJIW3kx2rYOiKQJYe0USJifudABTnUlLQ4LJBDTakSt2G7SB56DpADdeXQcBSKXkTm0HBkxkRZATlADlSVQzdaK4brM4duNDYyygrIAXKAHJjBmxDcPBds2zLLHIcs2fMQLnP8kxuuSLBhIpE53ll+iYQcao2ycmdxuWvJe9cacnyk/7hkSTNFyCGRXGTqG4xLv43jAx3Gg/NaHq4xfy/WTSQJ4585BqeVsxRpUFn0HPOa1nLIHB1qTWc5qu+/P4r8bcnjxuz4ktr2byQ+dYKTo6es2ADkQF05PLUQGI0FcngWoUrchu0ibeg5UEQOlaVExMp8HVJN2UgOySM/VsPWMfdEOSSP8CgNG8isQ+XI//DuWjPWJle/cyBYDskj9r7rUTFqWo2N5Aj/avcSM7yk1rE2OhoFPsbTNXnkP+I1SsdRq7GRHJs0H+GtRm7maO9HFTNeyn3Lvrofhcx4mfyU/ROrcrnTTcXp5Dak1+NVK4UUFT36tNLDj7opMLesHJcgNr51R14gcxyMYGYKqW5Gjcxx3ICQcBcaahM5jmeIhXHPH2FbOe4tItPWIHBIm8pxb5Nx6nrkjIQcjzahT1mehZcmx+nrdO+CzbkKORIVWXgIJ8eOini9NUXaatFTjoWK9LsNtqccMy1pfGt0czlOEmWTe+U3kuMRV/Z8cmJfOXATD1KDHCAHyAFygBwgB8gBcoAcIAdADpAD5AA5QA6QA+QAOUAOkAMgB8gBcoAcIAfIAXKAHCAHyAGQA+QAOfBMfgPqXLghdK2DMwAAAABJRU5ErkJggg==", 192: "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAEDElEQVR42u3dPZLTUBBFYc+riWEHpGQskYBdsg1WQEDVFAG4ZFmW+nZ/J6WKeep3dLtt6+ft85dvN2AvSwlAIBAIBAKBAAKBQCAQCAQQCAQCgUAggEAgEAgEAgG32+32PvbIf/74dex/+PX7JwkEEAgEAoFAIIBAIBAIBAIBBAKBQCAQCCAQCIRrefOEMkggEAgEAoGAx3hXgg8eusx+5iX0PoXtN4ZPBDpYGjINEugEb2aa1FygS7wZZVJbgYqo016jhgIVVKexRq0EKq5OS436CPS8PQ9t6sl/jkAV1TlwCyusgUAn7dxL96zaegh02FadvE/FlzddoJTfrdr/vhYp0PZdKbIlcQvuLNDGzSi4E7krbyJQjw1optFiz8lsXGHKl6IZCbSlmnHTQ4+DWgpdOYrq51CHa6Jzv4hr8GtG9RZ2/xR80Qb874++br8vOcz+CZRb1mOjqHIjW+zhUEOBptmT69BqVmUfCAiUdGGhyqysGk24USarka02ldXICHTv9Jp27/Cd4y0VQivCHpSt1Uo/HTUyAmlewY3MA6aQL5D4yQ0hCYRwgcRPdAhJIDQVSPxEVONigXx5mF7D5YQTQmYgjBRI/2pQyYoJpH8FVUYLA4EwUKDzb97r3cWuGoMkEAgEAoFAIJAJ2hwtgUAgEAgEAgh0xuw/Ge+N3+mQD4wS6FmTBJIE+jd/p8t9S/786+Q0kkDSSALVmJpnjkcSSCAR6JXD0O44GaKRFvbATL1DiPZTNoEeNmm3Ri1NuuxlK+lXdDzTnp48xlKlMwNdMB5pYdg/HjXTTgIJJALlaNRPsnVhrQ8fTiekUbUPH2ag88ajlj1OCzMetROo5S8AhzjkfWHNJ8qBldTC0FEgV4um1ORigXSx9BouJ5z4MQNhsEApLwetGT+XzwASCPkCCaHQ+JFA6CKQEEqMn5gEmulQxFEXEsiXiom1Wil1mRZCKa+SXT1qqnkRaNPpNcGh+8dYrdF7X5jRZ0wLmxBCcUcX+dLdrg5lNa/qCTTNoUR7qrewOQ6F2nO78OkcB44F0UN3+tGt9qevlU8XaMspmLgTW9ZcP1wDWthDikS0s07HEtPCNlazfhR1sicpgRpsQDN1UgW6BT4OrPHzyyIFerRVXbgrKescJ9COcefk7Sm+PALtn5pfulXV1kOgF37yOnDnKqyBQNds4b69PPnPESjDodNoc9FcK4EiNGp2vWVDgcpq1PJS3bYCldKo8VXezQW61qQJdwdMEehMk0bdVTJOoBfJNPZWpNECPeOTm9cIhAPwgCkQCAQCgUAggEAgEAgEAgEEAoFAIBAIIBAIBAKBQACBQCAQCAQCgQACgUAgEAgEEAgEAoFAIIBAIBAIBAIBBAKBQCDE8xsEQcwweEHq9QAAAABJRU5ErkJggg==", 512: "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAB7GkOtAAAK9ElEQVR42u3dMZIayRaGUVBgww5w8VgiRu+yt9ErkCEFIUc0dBVZee9/jjXWxHtVmffLLDSh/el83QGQ55dHACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAB3B4+A2Xx+fHX9v3a5Hb1f3AAAEAAABAAAAQBAAAAQAAAEAAABAEAAABAAAAQAAAEAQAAABAAAAQBAAAAQAAAEAAABAEAAABAAAAQAAAEAQAAAEAAABAAAAQBAAAAQAAAEAAABAEAAABAAAAQAAAEAQAAAEAAAAQAgyf50vnoKAG4AAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAsIKDR0BXnx9fa/2rLrej50k//kYwTHltQADAuJcEBABMfD1AAMDQFwMEAAx9MUAAwNAXAwQAzH0lQADA3FcCBADMfSVAADD6kQEEAHMfJUAAMPqRAQQAox8ZQAAw91ECBACjHxlAADD6kQEEAKMfGWAl/kpITH/vCzcAMEpcBRAAMPplAAHA6E8ffJ4GAoDpb7R5UAgARr8p5gEiABj9BpanigBg+htPHjICgKlkJHnmCAAmkQHkFSAAGD2GjteBAGDW4NUgAOSMGMPFa0IAiBsrZor3hQCQNUrMEa8PASBufJgd3iMCQNzUMDK8UASAuGFhUnizCAAGBN4yAkD3uWAoeN3U5e8ENg6Mg9pGvgV/SZwbAKa/0e/tIwDk7X+b3zKwDNrwCci2t+1bGfOOfAtyAyBo+hv9VoVVIQDE7XOb3PKwPLryCcj2tr07e/cb9C1IADD90QDq8QnI9Df6rRlrxg0AO9lOdhVwDxAATH80QAPa8wnI9Df6LSQLyQ0AmxZXAfcAAcD0RwM0QAAw/dEADejJbwC509/oxxoTAAGwMz1AD8pKS+QTkIs/WBUCQMahzD5n5NrwY4AAYPqjAQgApj8agABg+qMBCAD19jPWDALA7AclO5lJVo5LgABg+qMBCACmPxqAADD/vsVaQgAocPy3Y5m5AS4BAoDpjwYgAKY/WPkIAI7/WF0IgEOQ/UnzBrgECIDpb/qjAQgApj/WGwLg+A/2AgKA4xhWHQLgyGMf0rEBLgECYPqb/mgAAgCAADj+O/7jEoAAYPpjNSIA2cd/+42uDXAJEAAABMDx3/EflwAEwPQH+wUBcMgC6xMBSDrO2F3kNMAlQAAAEADHf8d/XAIQAAAEwPEfXAIQAHsJrFsEAAAB2NIqt1fHKMIvAb4CCQAAAuD4Dy4BCAAAAuD4Dy4BCAAAAhB+aALrGQEYyl0V7CwBwHEJrGoBcEgB7C8BAEAAcFPG2kYA3E8Bu0wAHJHACkcAABAAN1PAXhMAt2OwzhEAAASg+J3UsQiXgJE7DgEAEAAABICKN2Kw5hGADfgcCfadAAAgAAAIAI/5GIqVjwCU5EMk2H0CAIAA4BYM1r8AACAADfkECfagAAAgADzNB1CwCwQAAAEAQAAm59cnsBMFAAAB4Gl++wJ7QQAAEAAABAAAAZiRP3gA9qMAACAAPM0fewA7QgAAEAAABAAAAQBAAAAQAAAEYAP+qxOwKwWAn/BHnsG+EAAABAAAAQBAAAAQANiCP1uCAEB0A2QAAQAZgD4OHgG8lIE//+APreMGAC4EIAAgAyAAIAMwP78B0Nzjj/UrDm4/D+AGAJVO7i4ECAAgAwgAOP7LABn8BgDjYuPnAdwAIOL470KAAAAywIx8AsLxf+P/Gb4L4QYALgQgAPBOl9txwkO3DDCeT0DkZuA+eafKwM5HIUbZn85XT+Fnu3SV6UObd/rWSnkFHtc7+ARknfH3nfouZFcKAMiADBDBbwDw37OknwcQAIguwYQZUAJW4RMQfJ8B34UQAJABGaAPn4DgtQzcJ+9UGdj5KMTr/HcAi7bcKqOE5GXw1krZUDzmExAsGjq+CyEAuZ8CYM4M2I98y28AsPIMmuH0bSDiBgAuBCAAEJMB+UEAZudnupwMmMj2ggCAC4HjPwLQZUt7CMyZATsRAYCsDBiFvMQfA4WNz62+gOMGkMjOZxf/XcguEACQgaUZ8P0HAdjmFg9uA/ZgOX4DgHmH2vOfR8xB3ADq8QGU5AuB9S8AwKIMOP4jABvf1sFtwO4TANyCeW8G/h18dYeglS8AgAsBAgC8ngEPAQGwCcG+QwAK8jEUax4BAEAAABCA+S3/HOlGTI7lq90PAAIAgAA4FoF1jgBsxZ0U7DUBAEAAcDsGK1wA3EwBu0wAcETC2kYAABAA91PA/hIAN2U3ZaxqBMAhBbCzBMBxCaxnBAAAAeh7V3VowvF/3T2FAAAgAC4B4PgvAAAIAC4B4PgvAAAIANWPUWDdIgBDrXV7tZfInP6+/wgAAALgEgCO/wgAAALgEgCO/wiA3QXWJwLQ8hIA9gsCkLumHbLoffw3/QUAAAFwCXAJwPEfAUADsBoRgPRLgF1Hv+nv+C8AAAiAS4BLAI7/CIAGaACmPwKABmDVIQAuAWAvIACOYx4C1hsCEHrwsSepOP0d/wVAAzQA0x8BQAOwuhAAlwCw8hEAO8ExjVbHf9NfANAATH8EgLl3LNYSAkCZS4B9y5yryPFfANAATH8EAA3A9EcAqLKTsWYQAGpcAuxnNl8tjv8CgAZg+iMAaACmPwKABmD6IwBU3edYFQgANQ5QdjsD1oPj/+T2p/PVU0g+ndmilpal5QZA4j3AVcD0N/0FAA3A9Df9BQANwPQ3/TP4DcDWtXutH+vHDYD4e4CrgOlv+gsAGoDpb/r35xOQ/WxLWyqWihsA7gGuAqa/6S8AaIAGmP6mf3s+Adnk9rlVYVUIAHa7DW8xWAxJfAJqYsxu9EXI9Df93QCI3vz2v7fvaQsA0VPAIPDSqc4noG5G7k9fhEx/3ACIHgrmgreMAGBAGBDeLAJA6qQwLLxQBIDokWFqeI8IANGzw/jw+hAA0ueIUeJ9IQBEzxRjxWtCAIgeLkaMV4MAYNaYNV4HAkDw0AkfPV4BAoABFDSJPHMEACMpayp5yAgAxlPQnPJUEQAMrJTJ5QEiAMhAxETzoBAANKD5vPM0EABkAKMfAUAGMPoRAGQAo5+i/J3AmCbeF24A4Cpg9CMAIANGPwIAMmD0IwCgBOY+AgAyYPQjACADRj8CAEpg7iMAIANGPwIASmDuIwCgBOY+AgBKYO4jAJAYA0MfAYCgGBj6CAAExcDQRwAgpQcmPgIAEUkw7hEA6NwGUx4BAKAPfyUkgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAgAB4BAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAAIAAACAIAAACAAAAgAAAIAgAAAIAAACAAAAgCAAAAgAAACAIAAACAAAAgAAAIAgAAAIAAAFPQbI5jSRY5Mmf0AAAAASUVORK5CYII=" }

function b64u(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64uToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4)
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

async function getVapid(env) {
  const existing = await env.SCE_FILES.get('push/vapid.json')
  if (existing) return await existing.json()
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const data = { publicKey, privateJwk }
  await env.SCE_FILES.put('push/vapid.json', JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } })
  return data
}

async function sendPush(sub, vapid, origin) {
  const aud = new URL(sub.endpoint).origin
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: origin })
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  const jwt = unsigned + '.' + b64u(sig)
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: 'vapid t=' + jwt + ', k=' + vapid.publicKey, TTL: '14400', Urgency: 'high', 'Content-Length': '0' },
  })
}

async function sendReminders(env, origin) {
  const vapid = await getVapid(env)
  const listed = await env.SCE_FILES.list({ prefix: 'push/subs/' })
  let sent = 0, removed = 0, failed = 0
  for (const obj of listed.objects) {
    const o = await env.SCE_FILES.get(obj.key)
    if (!o) continue
    const sub = await o.json()
    try {
      const res = await sendPush(sub, vapid, sub.origin || origin)
      if (res.status === 404 || res.status === 410) { await env.SCE_FILES.delete(obj.key); removed++ }
      else if (res.ok) sent++
      else failed++
    } catch (e) { failed++ }
  }
  return { sent, removed, failed }
}

function edmontonHour() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: REMINDER_TZ, hour: '2-digit', hour12: false }).format(new Date())
  return Number(parts) % 24
}

const SW_JS = `
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (event) {
  event.waitUntil((async function () {
    var body = 'Day wrapping up? Stop any running timers and log what you worked on.';
    try {
      var r = await fetch('/file/time/state.json', { cache: 'no-store' });
      if (r.ok) {
        var st = await r.json();
        if (st.running && st.running.length) body = st.running.length + ' timer' + (st.running.length === 1 ? '' : 's') + ' still running (' + st.running.slice(0, 3).join(', ') + '). Stop them and wrap up your day.';
        else body = 'Anything you forgot to clock today? Add it, then do your end-of-day catch-up on the desktop.';
      }
    } catch (e) {}
    await self.registration.showNotification('Time to wrap up your day', { body: body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'eod-reminder', renotify: true });
  })());
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow('/');
  }));
});
`

const MANIFEST_JSON = JSON.stringify({
  name: 'SCE Field App', short_name: 'Field App', start_url: '/', scope: '/', display: 'standalone',
  background_color: '#0f1e2e', theme_color: '#0f1e2e',
  icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
})

function iconResponse(name) {
  const b64 = ICONS[name]
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } })
}

// ── Main handler ──────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    // ── GET / — the mobile companion page ──────────────────────────
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(MOBILE_PAGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // ── PWA + push plumbing ─────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/sw.js') {
      return new Response(SW_JS, { headers: { 'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' } })
    }
    if (request.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      return new Response(MANIFEST_JSON, { headers: { 'Content-Type': 'application/manifest+json' } })
    }
    if (request.method === 'GET' && (url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png' || url.pathname === '/apple-touch-icon.png')) {
      return iconResponse(url.pathname === '/icon-512.png' ? 512 : url.pathname === '/apple-touch-icon.png' ? 180 : 192)
    }
    if (request.method === 'GET' && url.pathname === '/push/key') {
      const v = await getVapid(env)
      return jsonResponse({ publicKey: v.publicKey }, 200, request)
    }

    // Everything past the sign-in page needs the password — reading included
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request)
    }

    // ── POST /upload ──────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const formData = await request.formData()
        const file = formData.get('file')
        const prefix = formData.get('prefix') || 'general'
        const amount = formData.get('amount') || ''
        const desc = formData.get('desc') || ''

        if (!file) return jsonResponse({ error: 'No file provided' }, 400, request)

        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
        if (!allowed.includes(file.type)) {
          return jsonResponse({ error: 'File type not allowed. Use JPG, PNG, WEBP, HEIC or PDF.' }, 400, request)
        }

        const MAX = 20 * 1024 * 1024
        const buffer = await file.arrayBuffer()
        if (buffer.byteLength > MAX) {
          return jsonResponse({ error: 'File too large. Maximum 20MB.' }, 400, request)
        }

        const ext = file.name.split('.').pop().toLowerCase()
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const key = `${prefix}/${ts}-${rand}.${ext}`

        await env.SCE_FILES.put(key, buffer, {
          httpMetadata: {
            contentType: file.type,
            contentDisposition: `inline; filename="${file.name}"`,
          },
          customMetadata: {
            originalName: file.name,
            uploadedAt: new Date().toISOString(),
            amount, desc,
          },
        })

        return jsonResponse({ key, url: `/file/${key}` }, 200, request)
      } catch (err) {
        return jsonResponse({ error: err.message }, 500, request)
      }
    }

    // ── GET /file/:key ────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname.startsWith('/file/')) {
      const key = decodeURIComponent(url.pathname.slice('/file/'.length))
      const obj = await env.SCE_FILES.get(key)
      if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders(request) })

      const headers = new Headers(corsHeaders(request))
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
      headers.set('Cache-Control', 'private, max-age=60')
      return new Response(obj.body, { headers })
    }

    // ── DELETE /file/:key ─────────────────────────────────────────
    if (request.method === 'DELETE' && url.pathname.startsWith('/file/')) {
      const key = decodeURIComponent(url.pathname.slice('/file/'.length))
      await env.SCE_FILES.delete(key)
      return jsonResponse({ deleted: key }, 200, request)
    }

    // ── GET /list/:prefix ─────────────────────────────────────────
    if (request.method === 'GET' && url.pathname.startsWith('/list/')) {
      const prefix = decodeURIComponent(url.pathname.slice('/list/'.length))
      const listed = await env.SCE_FILES.list({ prefix })
      const files = listed.objects
        .filter(obj => !obj.key.endsWith('/_meta.json'))
        .map(obj => ({
          key: obj.key,
          url: `/file/${encodeURIComponent(obj.key)}`,
          size: obj.size,
          uploaded: obj.uploaded,
          name: obj.customMetadata?.originalName || obj.key.split('/').pop(),
          amount: obj.customMetadata?.amount || '',
          desc: obj.customMetadata?.desc || '',
        }))
      return jsonResponse(files, 200, request)
    }

    // ── POST /push/subscribe — remember this phone for the 8pm reminder ──
    if (request.method === 'POST' && url.pathname === '/push/subscribe') {
      try {
        const sub = await request.json()
        if (!sub || !sub.endpoint) return jsonResponse({ error: 'Invalid subscription' }, 400, request)
        const hash = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint)))
        await env.SCE_FILES.put('push/subs/' + hash + '.json', JSON.stringify({ ...sub, origin: url.origin }), { httpMetadata: { contentType: 'application/json' } })
        return jsonResponse({ ok: true }, 200, request)
      } catch (e) { return jsonResponse({ error: e.message }, 500, request) }
    }

    // ── POST /push/test — send the reminder right now ──
    if (request.method === 'POST' && url.pathname === '/push/test') {
      try { return jsonResponse({ ok: true, ...(await sendReminders(env, url.origin)) }, 200, request) }
      catch (e) { return jsonResponse({ error: e.message }, 500, request) }
    }

    // ── POST /putjson — store a named JSON file at an exact key ──
    if (request.method === 'POST' && url.pathname === '/putjson') {
      try {
        const { key, data } = await request.json()
        if (!key || !key.endsWith('.json')) return jsonResponse({ error: 'Invalid key' }, 400, request)
        const body = JSON.stringify(data)
        await env.SCE_FILES.put(key, body, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { updatedAt: new Date().toISOString() },
        })
        return jsonResponse({ ok: true, key }, 200, request)
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, request)
      }
    }

    // ── POST /putfile?key=proposals/… — store a PDF at an exact key ──
    // (the desktop's sync puts each quote's proposal PDF here for the phone)
    if (request.method === 'POST' && url.pathname === '/putfile') {
      try {
        const key = url.searchParams.get('key') || ''
        if (!/^proposals\/[A-Za-z0-9_-]+\.pdf$/.test(key)) return jsonResponse({ error: 'Invalid key' }, 400, request)
        const buffer = await request.arrayBuffer()
        if (buffer.byteLength > 25 * 1024 * 1024) return jsonResponse({ error: 'File too large' }, 400, request)
        const name = (url.searchParams.get('name') || 'Proposal.pdf').replace(/["\r\n]/g, '')
        await env.SCE_FILES.put(key, buffer, {
          httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${name}"` },
          customMetadata: { originalName: name, uploadedAt: new Date().toISOString() },
        })
        return jsonResponse({ ok: true, key }, 200, request)
      } catch (e) {
        return jsonResponse({ error: e.message }, 500, request)
      }
    }

    // ── POST /parse-pdf — proxy to Anthropic (unchanged) ──────────
    if (request.method === 'POST' && url.pathname === '/parse-pdf') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse({ error: 'ANTHROPIC_API_KEY not set in Worker environment' }, 500, request)
      }
      try {
        const { base64, prompt } = await request.json()
        if (!base64) return jsonResponse({ error: 'No base64 PDF data provided' }, 400, request)

        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                { type: 'text', text: prompt || 'Extract all line items. Return ONLY a JSON array.' },
              ],
            }],
          }),
        })

        if (!anthropicRes.ok) {
          const errText = await anthropicRes.text()
          return jsonResponse({ error: `Anthropic API error (${anthropicRes.status}): ${errText}` }, 502, request)
        }

        const anthropicData = await anthropicRes.json()
        return jsonResponse(anthropicData, 200, request)
      } catch (err) {
        return jsonResponse({ error: err.message }, 500, request)
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, request)
  },

  // Cron: fires at 02:00 and 03:00 UTC; only the one that lands on 8pm Edmonton
  // time (DST-aware) actually sends.
  async scheduled(event, env, ctx) {
    if (edmontonHour() !== REMINDER_HOUR) return
    const origin = (env.WORKER_ORIGIN || 'https://sce-upload-worker.workers.dev')
    ctx.waitUntil(sendReminders(env, origin))
  },
}

// ── The mobile companion page ───────────────────────────────────────
// Self-contained: no build step, no separate hosting. Served directly by
// this Worker. Your Upload Key is entered once and kept only in the
// phone's own browser storage — it's never baked into this page's source.
const MOBILE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<title>Field App — Mobile</title>
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#0f1e2e" />
<style>
  :root {
    --navy: #0f1e2e; --accent: #d4af37; --text: #1a2733; --text-mid: #5a6b7a; --text-light: #8a97a8;
    --border: #e2e6ea; --surface: #ffffff; --surface-2: #f6f8fa; --red: #c0392b; --green: #1e7a34; --blue: #1a5fa0;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--surface-2); color: var(--text); }
  header { background: var(--navy); color: #fff; padding: 14px 16px; position: sticky; top: 0; z-index: 10; }
  header h1 { font-size: 16px; margin: 0 0 10px; font-weight: 700; }
  .tabs { display: flex; gap: 6px; }
  .tab { flex: 1; text-align: center; padding: 8px; border-radius: 8px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.7); font-size: 13px; font-weight: 600; cursor: pointer; }
  .tab.active { background: var(--accent); color: var(--navy); }
  .tabs .tab { font-size: 12px; padding: 8px 2px; white-space: nowrap; }
  main { padding: 12px; padding-bottom: 60px; }
  .cust { font-size: 11px; font-weight: 700; color: var(--text-light); text-transform: uppercase; letter-spacing: .05em; padding: 10px 4px 4px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .name { font-size: 14px; font-weight: 700; flex: 1; min-width: 0; }
  .meta { font-size: 12px; color: var(--text-mid); margin-top: 4px; }
  .value { font-size: 13px; font-weight: 700; color: var(--blue); }
  .badge { font-size: 9.5px; font-weight: 700; border-radius: 20px; padding: 2px 8px; text-transform: uppercase; letter-spacing: .03em; }
  .tap { cursor: pointer; }
  .ppill { display: inline-block; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; border: 1px solid #1a5fa0; background: #e8f2fc; color: #1a5fa0; text-decoration: none; margin-left: 6px; }
  .ppill.big { font-size: 15px; padding: 9px 16px; margin-left: 0; }
  .tap:active { background: #f1f4f9; }
  .chev { margin-left: auto; font-size: 20px; color: #9aa3b5; padding-left: 6px; }
  .hmark { width: 16px; height: 16px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .stitle { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #56607a; margin-bottom: 6px; }
  .srow { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid var(--border); font-size: 14px; }
  .srow:first-of-type { border-top: none; }
  .sl { color: #56607a; }
  .sv { font-weight: 700; text-align: right; }
  .ss { font-weight: 500; color: #8a93a6; font-size: 12px; }
  .tjob { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .tcount { font-size: 12px; font-weight: 700; border-radius: 20px; padding: 2px 9px; background: #eef1f6; color: #56607a; white-space: nowrap; }
  .empty { text-align: center; color: var(--text-light); padding: 40px 20px; font-size: 13px; }
  select, input[type=text] { display: block; width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; font-family: inherit; margin-bottom: 12px; box-sizing: border-box; }
  .upload-box { display: block; width: 100%; box-sizing: border-box; border: 2px dashed var(--border); border-radius: 12px; padding: 30px 16px; text-align: center; color: var(--text-mid); font-size: 14px; font-weight: 600; cursor: pointer; background: var(--surface); margin-bottom: 12px; }
  .upload-box input { display: none; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .thumb { width: 78px; height: 78px; border-radius: 8px; overflow: hidden; position: relative; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .thumb-doc { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: var(--surface-2); font-size: 22px; }
  .thumb-doc div { font-size: 8px; color: var(--text-mid); font-weight: 600; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .thumb .status { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; font-weight: 700; text-align: center; padding: 2px; background: rgba(0,0,0,.55); color: #fff; }
  .setup { padding: 30px 20px; }
  .setup input { margin-bottom: 12px; }
  .setup button, .primary-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; background: var(--accent); color: var(--navy); font-weight: 700; font-size: 14px; cursor: pointer; }
  .tcard { background:#fff; border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:10px; display:flex; align-items:center; gap:10px; }
  .tcard .tl { flex:1; min-width:0; }
  .tcard .tn { font-weight:700; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tcard .tt { font-size:24px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--navy); }
  .tstop { padding:12px 16px; border:none; border-radius:8px; background:#c0392b; color:#fff; font-weight:700; font-size:14px; }
  .tcancel { padding:12px 14px; border:1px solid var(--border); border-radius:8px; background:#fff; color:#666; font-size:14px; }
  .tpick { display:block; width:100%; text-align:left; padding:12px; margin-bottom:6px; border:1px solid var(--border); border-radius:8px; background:#fff; font-size:14px; }
  .tpick small { color:var(--text-light); }
  .note { font-size: 12px; color: var(--text-light); margin-top: 8px; }
  .ccard { background:#fff; border:2px solid var(--navy); border-radius:12px; padding:12px; margin-bottom:14px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:4px; }
  .chip { padding:9px 13px; border-radius:999px; border:1px solid var(--border); background:#fff; color:var(--text); font-size:14px; font-family:inherit; }
  .chip.on { background:var(--navy); border-color:var(--navy); color:#fff; font-weight:700; }
  .tinput { padding:7px 8px; border:1px solid var(--border); border-radius:8px; font-size:14px; font-family:inherit; }
  .prow { display:flex; align-items:center; gap:10px; padding:10px 0; border-top:1px solid var(--border); }
  .prow .tl { flex:1; min-width:0; }
  .prow .tn { font-weight:700; font-size:15px; }
  .tick { width:22px; height:22px; flex-shrink:0; }
  .ptime { font-size:18px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--navy); }
  .btnrow { display:flex; gap:8px; margin-top:10px; }
  .bigbtn { flex:1; padding:14px 10px; border:none; border-radius:8px; background:var(--navy); color:#fff; font-weight:700; font-size:15px; font-family:inherit; }
  .bigbtn.gold { background:var(--accent); color:var(--navy); }
  button[disabled] { opacity:.4; }
  .linkbtn { background:none; border:none; color:var(--blue); font-size:12px; font-weight:600; max-width:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:inherit; }
  .warn { background:#fff8e6; border:1px solid #e0a716; border-radius:8px; padding:10px; font-size:13px; color:#8a5d00; }
  .pchip { padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:#fff; color:var(--text); text-align:left; font-family:inherit; min-width:96px; }
  .pchip .pn { font-size:14px; font-weight:700; }
  .pchip .pj { font-size:11px; color:var(--text-light); margin-top:1px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pchip.on { background:var(--navy); border-color:var(--navy); color:#fff; }
  .pchip.on .pj { color:rgba(255,255,255,.7); }
  .jgroup { border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:var(--surface-2); }
  .jgroup.main { border-color:var(--accent); background:#fdf8e8; }
  .jlabel { font-size:13px; font-weight:700; margin-bottom:4px; }
  .jperson { display:flex; align-items:center; padding:4px 0; font-size:14px; }
  .tpick.mainpick { border-color:var(--accent); background:#fdf8e8; font-weight:700; }
  .otbadge { margin-left:6px; font-size:10px; font-weight:700; color:#fff; background:#9a6610; border-radius:10px; padding:1px 7px; }
  .msub { display:flex; gap:6px; margin-bottom:10px; }
  .msubtab { flex:1; text-align:center; padding:8px 4px; border-radius:8px; background:#fff; border:1px solid var(--border, #dde2ea); font-size:13px; font-weight:700; color:#555; cursor:pointer; }
  .msubtab.on { background:var(--navy, #0f1e2e); color:#fff; border-color:var(--navy, #0f1e2e); }
  .mlabel { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#667; margin:10px 0 4px; }
  .minput { width:100%; box-sizing:border-box; font-size:16px; padding:10px 11px; border:1px solid #cfd6e0; border-radius:8px; background:#fff; }
  .mresults { margin-top:4px; }
  .mrow { display:flex; align-items:center; gap:8px; padding:10px 6px; border-bottom:1px solid #eef0f3; cursor:pointer; font-size:14px; }
  .mrow.madd { color:#9a6610; font-weight:700; }
  .mchosen { display:flex; align-items:center; gap:8px; padding:10px 11px; border:2px solid var(--accent, #e8a317); border-radius:8px; background:#fffaf0; font-size:14px; }
  .mx { font-size:22px; color:#888; padding:0 4px; cursor:pointer; }
  .mstock { font-size:11px; font-weight:700; color:#1e7a34; background:#e6f4ea; border-radius:10px; padding:2px 8px; white-space:nowrap; }
  .mbtn { width:100%; margin-top:14px; padding:13px; font-size:16px; font-weight:800; border:none; border-radius:10px; background:var(--accent, #e8a317); color:var(--navy, #0f1e2e); }
  .mtoggle { white-space:nowrap; font-size:12px; font-weight:700; padding:9px 10px; border-radius:8px; border:1px solid #cfd6e0; background:#fff; color:#555; cursor:pointer; }
  .mtoggle.on { background:#1e7a34; color:#fff; border-color:#1e7a34; }
  .mtagq, .mtagj { font-size:10px; font-weight:700; border-radius:10px; padding:2px 7px; }
  .mtagq { background:#fdf0e0; color:#9a6610; } .mtagj { background:#e8f2fc; color:#1a5fa0; }
  .mlink { display:block; text-align:center; margin-top:8px; font-size:13px; color:#1a5fa0; text-decoration:underline; cursor:pointer; }
</style>
</head>
<body>
<div id="root"></div>
<script>
const KEY_STORAGE = 'sce_upload_key';
// Alberta Time (UTC-6 all year since Nov 1, 2026): show every date and time in
// it, whatever this phone's time-zone tables say
(function () {
  ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (fn) {
    const orig = Date.prototype[fn];
    Date.prototype[fn] = function (loc, opts) {
      if (opts && opts.timeZone) return orig.call(this, loc, opts);
      return orig.call(this, loc, Object.assign({}, opts || {}, { timeZone: 'Etc/GMT+6' }));
    };
  });
})();
const state = { tab: 'time', timeSearch: '', jobs: null, quotes: null, uploads: [], cameraJobId: '', expenseAmount: '', expenseDesc: '' };

function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (typeof v === 'function') el[k] = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  (children || []).forEach(c => { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return el;
}

function money(v) { return '$' + (Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function coLabel(co) { const c = String(co || '').replace(/^co[ /]*po[ #:]*/i, '').trim(); return c ? 'CO/PO ' + c : 'No CO/PO #'; }

function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

async function fetchJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-store', headers: { 'X-Upload-Key': getKey() } });
    if (res.status === 401) { signOut('That password no longer works — sign in again.'); return null; }
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function loadData() {
  state.jobs = await fetchJson('/file/sync/jobs.json');
  state.quotes = await fetchJson('/file/sync/quotes.json');
  state.catalog = await fetchJson('/file/sync/catalog.json');
  state.tasks = await fetchJson('/file/sync/tasks.json');
  pruneTaskOps();
  render();
}

function statusColor(project) {
  if (project.completed) return '#1e7a34';
  if (project.status === 'yellow') return '#e0a716';
  return '#c0392b';
}

// Jobs / Quotes: only what's active, with a search box (the list redraws on
// its own so the keyboard stays up while typing)
function searchList(placeholder, key, build) {
  const wrap = h('div', {});
  const input = h('input', { type: 'search', class: 'minput', placeholder: placeholder, value: state[key] || '', autocomplete: 'off', style: 'margin-bottom:10px' });
  const list = h('div', {});
  function fill() { state[key] = input.value; list.innerHTML = ''; build(list, matLc(input.value).trim().split(/ +/).filter(Boolean)); }
  input.oninput = fill;
  wrap.appendChild(input); wrap.appendChild(list); fill();
  return wrap;
}
function hasWords(text, words) { const t = matLc(text); return words.every(function (w) { return t.indexOf(w) >= 0; }); }

// Jobs: active ones listed; typing searches every job (closed ones too).
// Tap a job for its summary — values only show in there.
function lifeLabel(p) {
  const m = { onGoing: 'Active', deficiencies: 'Deficiencies', unbilled: 'Complete — not billed', billed: 'Billed' };
  return m[p.lifecycle] || (p.completed ? 'Complete' : 'Active');
}
function isActiveJob(p) { return !p.trashed && (p.lifecycle ? p.lifecycle === 'onGoing' : !p.completed); }
function typeLabel(t) { return t === 'tm' ? 'T&M' : t === 'quoted' ? 'Quoted' : t === 'warranty' ? 'Warranty' : (t || ''); }
function openDetail(kind, id) {
  state[kind + 'Scroll'] = window.scrollY;
  state[kind + 'Open'] = id;
  render();
  window.scrollTo(0, 0);
}
function closeDetail(kind) {
  state[kind + 'Open'] = null;
  render();
  const y = state[kind + 'Scroll'] || 0;
  setTimeout(function () { window.scrollTo(0, y); }, 0);
}
function sumRow(label, value, sub) {
  return h('div', { class: 'srow' }, [h('span', { class: 'sl' }, [label]), h('span', { class: 'sv' }, [value, sub ? h('span', { class: 'ss' }, [' ' + sub]) : null])]);
}
function sumSection(title, kids) {
  const k = (kids || []).filter(Boolean);
  if (!k.length) return null;
  return h('div', { class: 'card' }, [h('div', { class: 'stitle' }, [title])].concat(k));
}
function healthMark(p) {
  const s = p.sum;
  if (!s || !s.issues) return null;
  const ok = !s.issues.length;
  return h('span', { class: 'hmark', style: 'background:' + (ok ? '#1e7a34' : '#c0392b') }, [ok ? '✓' : '✕']);
}

function renderJobs() {
  if (!state.jobs || !state.jobs.customers) return h('div', { class: 'empty' }, ['No synced data yet — open the app on your computer and hit "Sync now" in Cloud Sync settings.']);
  const cust = {};
  state.jobs.customers.forEach(function (c) { cust[c.id] = c.name; });
  const all = (state.jobs.projects || []).filter(function (p) { return !p.trashed; });
  if (state.jobOpen) {
    const p = all.find(function (x) { return x.id === state.jobOpen; });
    if (p) return renderJobDetail(p, cust[p.customerId] || '');
    state.jobOpen = null;
  }
  return searchList('Search all jobs — name, customer, CO/PO…', 'jobQ', function (list, words) {
    const pool = words.length ? all : all.filter(isActiveJob);
    const shown = pool.filter(function (p) { return hasWords([cust[p.customerId], p.name, p.co, p.notes, lifeLabel(p)].join(' '), words); })
      .sort(function (a, b) { return (isActiveJob(b) ? 1 : 0) - (isActiveJob(a) ? 1 : 0); });
    const nActive = shown.filter(isActiveJob).length;
    list.appendChild(h('div', { class: 'meta', style: 'margin:0 2px 6px' }, [words.length
      ? shown.length + ' job' + (shown.length === 1 ? '' : 's') + ' match' + (shown.length === 1 ? 'es' : '') + ' (' + nActive + ' active, ' + (shown.length - nActive) + ' closed)'
      : shown.length + ' active job' + (shown.length === 1 ? '' : 's') + ' · type to search closed ones too']));
    state.jobs.customers.forEach(function (c) {
      const projects = shown.filter(function (p) { return p.customerId === c.id; });
      if (!projects.length) return;
      list.appendChild(h('div', { class: 'cust' }, [c.name]));
      projects.forEach(function (p) {
        const active = isActiveJob(p);
        list.appendChild(h('div', { class: 'card tap', onclick: function () { openDetail('job', p.id); } }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'dot', style: 'background:' + statusColor(p) }),
            healthMark(p),
            h('span', { class: 'name' }, [p.name || 'Untitled']),
            active ? null : h('span', { class: 'badge', style: 'color:#56607a;background:#eef1f6' }, [lifeLabel(p)]),
            h('span', { class: 'chev' }, ['›']),
          ]),
          h('div', { class: 'meta' }, [coLabel(p.co) + (p.dateStart ? ' · Starts ' + p.dateStart : '')]),
          p.notes ? h('div', { class: 'meta' }, [p.notes]) : null,
        ]));
      });
    });
    if (!shown.length) list.appendChild(h('div', { class: 'empty' }, [words.length ? 'No jobs match.' : 'No active jobs.']));
  });
}

function renderJobDetail(p, customer) {
  const s = p.sum || {};
  const wrap = h('div', {});
  wrap.appendChild(h('button', { class: 'mbtn', style: 'background:#fff; color:var(--navy); border:1px solid var(--border, #dde2ea); margin-bottom:10px', onclick: function () { closeDetail('job'); } }, ['‹ Jobs']));
  wrap.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'row' }, [h('span', { class: 'dot', style: 'background:' + statusColor(p) }), h('span', { class: 'name', style: 'font-size:18px' }, [p.name || 'Untitled'])]),
    h('div', { class: 'meta' }, [[customer, typeLabel(p.type), lifeLabel(p)].filter(Boolean).join(' · ')]),
    h('div', { class: 'meta' }, [coLabel(p.co) + (s.quotes && s.quotes.length ? ' · Quote ' + s.quotes.join(', ') : '')]),
    h('div', { class: 'meta' }, [(p.dateStart ? 'Started ' + p.dateStart : 'No start date') + (s.dateComplete ? ' · Completed ' + s.dateComplete : '')]),
  ]));
  if (s.issues) {
    wrap.appendChild(s.issues.length
      ? h('div', { class: 'card', style: 'border-color:#e3a49c; background:#fdf3f1' }, [h('div', { class: 'stitle', style: 'color:#a12a1e' }, ['✕ Not caught up'])].concat(s.issues.map(function (t) { return h('div', { class: 'meta', style: 'color:#7a2a1e' }, ['• ' + t]); })))
      : h('div', { class: 'card', style: 'border-color:#9fd3ae; background:#eef8f1' }, [h('div', { class: 'stitle', style: 'color:#1e7a34; margin:0' }, ['✓ Project current'])]));
  }
  const quoted = p.type === 'quoted';
  wrap.appendChild(sumSection('Money', [
    s.value ? sumRow('Job value', money(s.value)) : null,
    sumRow('Billed', money(s.billed), s.billedPct ? '(' + s.billedPct + '%)' : ''),
    sumRow('Progress', (s.progress || 0) + '%'),
    sumRow('Labor', money(s.labor), (s.hours || 0) + ' h' + (quoted && s.qLab ? ' · quoted ' + money(s.qLab) : '')),
    sumRow('Materials', money(s.materials), quoted && s.qMat ? 'quoted ' + money(s.qMat) : ''),
  ]));
  if (s.tasksAll) {
    const today = taskToday();
    wrap.appendChild(sumSection('Tasks — ' + s.tasksDone + ' of ' + s.tasksAll + ' done', (s.tasks || []).map(function (t) {
      const late = t.due && t.due < today;
      return h('div', { class: 'meta', style: late ? 'color:#c0392b;font-weight:700' : '' }, ['☐ ' + t.t + (t.who ? ' · ' + t.who : '') + (t.due ? ' · ' + (late ? 'overdue ' : 'by ') + taskDay(t.due) : '')]);
    }).concat([(s.tasks || []).length ? null : h('div', { class: 'meta' }, ['All done 👍'])])));
  }
  if (s.defs && s.defs.length) wrap.appendChild(sumSection('Open deficiencies', s.defs.map(function (t) { return h('div', { class: 'meta' }, ['• ' + t]); })));
  if (s.work && s.work.length) wrap.appendChild(sumSection('Recent work', s.work.map(function (w) {
    return h('div', { style: 'margin-top:6px' }, [h('div', { class: 'meta', style: 'margin:0; font-weight:700' }, [[w.d, w.w, w.h ? w.h + ' h' : ''].filter(Boolean).join(' · ')]), w.t ? h('div', { class: 'meta', style: 'margin:2px 0 0' }, [w.t]) : null]);
  })));
  if (p.notes) wrap.appendChild(sumSection('Notes', [h('div', { class: 'meta' }, [p.notes])]));
  if (!p.sum) wrap.appendChild(h('div', { class: 'note' }, ['Sync from the computer once to see the full summary.']));
  return wrap;
}

// Quotes: open ones listed; typing searches them all. Tap for a summary.
// 📄 Proposal — the PDF saved in the quote's Files on the computer (synced up)
function proposalPill(q, big) {
  if (!q.pdf) return null;
  return h('a', { class: 'ppill' + (big ? ' big' : ''), href: '/file/' + q.pdf, target: '_blank', rel: 'noopener', onclick: function (e) { e.stopPropagation(); } }, ['📄 Proposal']);
}
function quoteState(q) { return q.approved ? 'Approved' : q.invalidated ? 'Invalidated' : q.status === 'yellow' ? 'Sent' : 'Not sent'; }
function renderQuotes() {
  if (!state.quotes || !state.quotes.customers) return h('div', { class: 'empty' }, ['No synced data yet — open the app on your computer and hit "Sync now" in Cloud Sync settings.']);
  const cust = {};
  state.quotes.customers.forEach(function (c) { cust[c.id] = c.name; });
  const all = (state.quotes.quotes || []).filter(function (q) { return !q.trashed; });
  const isOpen = function (q) { return !q.approved && !q.invalidated; };
  if (state.quoteOpen) {
    const q = all.find(function (x) { return x.id === state.quoteOpen; });
    if (q) return renderQuoteDetail(q, cust[q.customerId] || '');
    state.quoteOpen = null;
  }
  return searchList('Search all quotes — number, title, customer…', 'quoteQ', function (list, words) {
    const pool = words.length ? all : all.filter(isOpen);
    const shown = pool.filter(function (q) { return hasWords([cust[q.customerId], q.quoteNumber, q.title, q.notes, quoteState(q)].join(' '), words); })
      .sort(function (a, b) { return (isOpen(b) ? 1 : 0) - (isOpen(a) ? 1 : 0); });
    list.appendChild(h('div', { class: 'meta', style: 'margin:0 2px 6px' }, [words.length
      ? shown.length + ' quote' + (shown.length === 1 ? '' : 's') + ' match' + (shown.length === 1 ? 'es' : '')
      : shown.length + ' open quote' + (shown.length === 1 ? '' : 's') + ' · type to search approved / old ones too']));
    state.quotes.customers.forEach(function (c) {
      const quotes = shown.filter(function (q) { return q.customerId === c.id; });
      if (!quotes.length) return;
      list.appendChild(h('div', { class: 'cust' }, [c.name]));
      quotes.forEach(function (q) {
        const st = quoteState(q);
        const col = st === 'Sent' ? ['#b07d00', '#fff3d6'] : st === 'Not sent' ? ['#c0392b', '#fdecea'] : st === 'Approved' ? ['#1e7a34', '#e6f4ea'] : ['#56607a', '#eef1f6'];
        list.appendChild(h('div', { class: 'card tap', onclick: function () { openDetail('quote', q.id); } }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'name' }, [(q.quoteNumber || '') + ' — ' + (q.title || 'Untitled')]),
            q.total ? h('span', { class: 'value' }, [money(q.total)]) : null,
            h('span', { class: 'chev' }, ['›']),
          ]),
          h('div', { class: 'row', style: 'margin-top:6px' }, [h('span', { class: 'badge', style: 'color:' + col[0] + ';background:' + col[1] }, [st]), proposalPill(q)]),
          q.notes ? h('div', { class: 'meta' }, [q.notes]) : null,
        ]));
      });
    });
    if (!shown.length) list.appendChild(h('div', { class: 'empty' }, [words.length ? 'No quotes match.' : 'No open quotes.']));
  });
}

function renderQuoteDetail(q, customer) {
  const s = q.sum || {};
  const wrap = h('div', {});
  wrap.appendChild(h('button', { class: 'mbtn', style: 'background:#fff; color:var(--navy); border:1px solid var(--border, #dde2ea); margin-bottom:10px', onclick: function () { closeDetail('quote'); } }, ['‹ Quotes']));
  wrap.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'name', style: 'font-size:18px' }, [(q.quoteNumber || '') + ' — ' + (q.title || 'Untitled')]),
    h('div', { class: 'meta' }, [[customer, quoteState(q)].filter(Boolean).join(' · ')]),
    h('div', { class: 'meta' }, [[s.created ? 'Made ' + s.created : '', s.sent ? 'Sent ' + s.sent : ''].filter(Boolean).join(' · ') || ' ']),
    s.job ? h('div', { class: 'meta' }, ['Job: ' + s.job]) : null,
    q.pdf ? h('div', { style: 'margin-top:10px' }, [proposalPill(q, true)]) : null,
  ]));
  const hrs = (s.scopes || []).reduce(function (a, sc) { return a + (Number(sc.hrs) || 0); }, 0);
  wrap.appendChild(sumSection('Price', [
    sumRow('Total', money(q.total)),
    s.mat != null ? sumRow('Materials', money(s.mat)) : null,
    s.lab != null ? sumRow('Labor', money(s.lab), hrs ? hrs + ' h' : '') : null,
    s.allow ? sumRow('Allowances', money(s.allow)) : null,
    s.adj ? sumRow('Adjustments', money(s.adj)) : null,
  ]));
  (s.scopes || []).forEach(function (sc) {
    wrap.appendChild(sumSection(sc.n, [
      sc.t ? h('div', { class: 'meta', style: 'white-space:pre-wrap' }, [sc.t]) : null,
      sumRow('Materials', money(sc.mat)),
      sumRow('Labor', money(sc.lab), sc.hrs ? sc.hrs + ' h' : ''),
    ]));
  });
  if (q.notes) wrap.appendChild(sumSection('Notes', [h('div', { class: 'meta' }, [q.notes])]));
  if (!q.sum) wrap.appendChild(h('div', { class: 'note' }, ['Sync from the computer once to see the full summary.']));
  return wrap;
}

// ── Time clock ────────────────────────────────────────────────────
// Timers live on the phone (so they survive a closed browser or no signal)
// and are only sent to the cloud when stopped.
const TIMERS_KEY = 'sce_timers';
const OUTBOX_KEY = 'sce_time_outbox';
const BUCKETS = [
  { id: 'planning', label: '🧠 Project planning / helping' },
  { id: 'shop', label: '🏭 Shop / yard' },
  { id: 'travel', label: '🚗 Travel / pickup' },
  { id: 'admin', label: '🗂 Admin / quoting' },
];
function loadList(k) { try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; } }
function saveList(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function fmtElapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}
function publishState() {
  const key = getKey();
  if (!key) return;
  const running = loadList(TIMERS_KEY).map(t => t.label);
  const cs = typeof crewSession === 'function' ? crewSession() : null;
  if (cs && cs.open) Object.keys(cs.open).forEach(k => running.push(cs.open[k].name + ' on ' + cs.open[k].label));
  fetch('/putjson', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': key }, body: JSON.stringify({ key: 'time/state.json', data: { updatedAt: new Date().toISOString(), running: running } }) }).catch(() => {});
}
function startTimer(t) {
  const list = loadList(TIMERS_KEY);
  if (list.some(x => x.targetKey === t.targetKey)) { alert('That one is already running.'); return; }
  list.push({ id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), start: Date.now(), ...t });
  saveList(TIMERS_KEY, list);
  state.timeSearch = '';
  render();
  publishState();
}
function cancelTimer(id) {
  if (!confirm('Cancel this timer? The time will be thrown away.')) return;
  saveList(TIMERS_KEY, loadList(TIMERS_KEY).filter(x => x.id !== id));
  render();
  publishState();
}
function stopTimer(id) {
  const list = loadList(TIMERS_KEY);
  const t = list.find(x => x.id === id);
  if (!t) return;
  saveList(TIMERS_KEY, list.filter(x => x.id !== id));
  const end = Date.now();
  const out = loadList(OUTBOX_KEY);
  out.push({ id: t.id, label: t.label, jobId: t.jobId || '', bucket: t.bucket || '', isNew: !!t.isNew, startedAt: new Date(t.start).toISOString(), endedAt: new Date(end).toISOString(), seconds: Math.round((end - t.start) / 1000) });
  saveList(OUTBOX_KEY, out);
  render();
  publishState();
  flushOutbox();
}
async function flushOutbox() {
  const key = getKey();
  if (!key) return;
  let out = loadList(OUTBOX_KEY);
  for (const e of out.slice()) {
    try {
      const res = await fetch('/putjson', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': key }, body: JSON.stringify({ key: 'time/pending/' + e.id + '.json', data: e }) });
      if (!res.ok) break;
      out = loadList(OUTBOX_KEY).filter(x => x.id !== e.id);
      saveList(OUTBOX_KEY, out);
    } catch (err) { break; }
  }
  if (state.tab === 'time') render();
}
function tickTimers() {
  document.querySelectorAll('[data-start]').forEach(el => { el.textContent = fmtElapsed(Date.now() - Number(el.getAttribute('data-start'))); });
  document.querySelectorAll('[data-today]').forEach(el => { el.textContent = (Math.round(Math.max(0, Date.now() - Number(el.getAttribute('data-today'))) / 36000) / 100).toFixed(2); });
}
setInterval(tickTimers, 1000);

// ── 8pm reminder (web push) ────────────────────────────────────────
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
state.pushStatus = '';
async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      state.pushStatus = isIOS && !isStandalone ? 'On iPhone: tap Share → Add to Home Screen, then open the app from that icon and try again.' : 'This browser does not support notifications.';
      return render();
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { state.pushStatus = 'Notifications were blocked. Allow them in your phone settings for this site, then try again.'; return render(); }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const keyRes = await fetch('/push/key');
    const pub = (await keyRes.json()).publicKey;
    const bytes = Uint8Array.from(atob(pub.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - pub.length % 4) % 4)), c => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    const res = await fetch('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': getKey() }, body: JSON.stringify(sub) });
    if (!res.ok) throw new Error('Server said ' + res.status);
    localStorage.setItem('sce_push_on', '1');
    state.pushStatus = 'Reminder is on — you will get a nudge at 8:00 pm every day.';
  } catch (e) {
    state.pushStatus = 'Could not turn on reminders: ' + e.message;
  }
  render();
}
async function testPush() {
  state.pushStatus = 'Sending test…'; render();
  try {
    const res = await fetch('/push/test', { method: 'POST', headers: { 'X-Upload-Key': getKey() } });
    const j = await res.json();
    state.pushStatus = j.sent > 0 ? 'Test sent — it should arrive in a few seconds.' : 'Nothing sent (' + (j.error || 'no phones registered') + ').';
  } catch (e) { state.pushStatus = 'Test failed: ' + e.message; }
  render();
}
if ('serviceWorker' in navigator && localStorage.getItem('sce_push_on')) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ── Crew clock ────────────────────────────────────────────────────
// One clock for everyone on site, run from this phone. Tap one or more
// people, then tap a job: anyone already on another job is taken off it and
// put on the new one, so each person is only ever on one thing at a time and
// nothing double-counts. When the last person clocks out the
// whole day is sent to the desktop for review (End-of-day Catch-up).
// NOTE: this lives inside a template string — no backticks, no dollar-brace,
// no backslashes.
const CREW_KEY = 'sce_crew_clock';
const CREW_LAST_KEY = 'sce_crew_last';
const CREW_EXTRA_KEY = 'sce_crew_extra';
const MAIN_KEY = 'sce_main_job';
state.crewMode = '';
state.crewSel = null;
state.crewShowAll = false;
state.crewOt = false;
state.crewWhen = 0;
state.crewWhenTime = '';
state.crewSearch = '';
state.crewMsg = '';
state.crewStaleTime = '15:30';

function loadObj(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function saveObj(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function hhmm(ms) { const d = new Date(ms); let hr = d.getHours(); const ap = hr >= 12 ? 'pm' : 'am'; hr = hr % 12 || 12; return hr + ':' + pad2(d.getMinutes()) + ' ' + ap; }
function hrs(ms) { return (Math.round(Math.max(0, ms) / 36000) / 100).toFixed(2); }
function lower(s) { return (s || '').trim().toLowerCase(); }
function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function crewRoster() {
  const synced = (state.jobs && state.jobs.crew) || [];
  const extra = loadObj(CREW_EXTRA_KEY) || [];
  const out = synced.map(p => ({ id: p.id, name: p.name, isMe: !!p.isMe, role: p.role || '' }));
  extra.forEach(n => { if (!out.some(p => lower(p.name) === lower(n))) out.push({ id: '', name: n, isMe: false, role: '' }); });
  if (!out.length) out.push({ id: '', name: 'Me', isMe: true, role: '' });
  return out;
}
function personKey(p) { return p.id ? p.id : 'new:' + lower(p.name); }
function crewSession() { return loadObj(CREW_KEY); }
function openKeys(s) { return s && s.open ? Object.keys(s.open) : []; }
function mainTarget() { return loadObj(MAIN_KEY); }

function saveCrew(s) {
  if (s) s.updatedAt = new Date().toISOString();
  saveObj(CREW_KEY, s);
  const key = getKey();
  if (key) {
    // Copy in the cloud so a cleared or lost phone doesn't lose the day
    const data = s || { closed: true, updatedAt: new Date().toISOString() };
    fetch('/putjson', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': key }, body: JSON.stringify({ key: 'time/crew/current.json', data: data }) }).catch(() => {});
  }
  publishState();
}

// The moment an action applies to: now, N minutes ago, or a picked time.
function whenMs(dateStr) {
  if (state.crewWhenTime) {
    const parts = state.crewWhenTime.split(':');
    const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    base.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    return base.getTime();
  }
  return Date.now() - (state.crewWhen || 0) * 60000;
}
function whenText() {
  if (state.crewWhenTime) return 'at ' + hhmm(whenMs());
  if (state.crewWhen) return (state.crewWhen >= 60 ? (state.crewWhen / 60) + ' h' : state.crewWhen + ' min') + ' ago';
  return 'now';
}
function resetCrewUi() {
  state.crewMode = ''; state.crewWhen = 0; state.crewWhenTime = ''; state.crewSearch = ''; state.crewShowAll = false; state.crewOt = false;
}


function blockFor(p, target, start) {
  return { id: newId(), workerId: p.id || '', name: p.name, target: target.target, jobId: target.jobId || '', bucket: target.bucket || '', label: target.label, isNew: !!target.isNew, ot: !!target.ot, start: start };
}

function closeBlock(s, k, t) {
  const cur = s.open[k];
  if (!cur) return;
  if (t > cur.start) s.closed.push(Object.assign({}, cur, { end: t }));
  delete s.open[k];
}

function checkTime(s, keys, t) {
  if (t > Date.now() + 60000) { alert('That time is in the future.'); return false; }
  const bad = keys.filter(k => s.open[k] && t < s.open[k].start);
  if (bad.length) {
    alert(bad.map(k => s.open[k].name).join(', ') + ' only started ' + s.open[bad[0]].label + ' at ' + hhmm(s.open[bad[0]].start) + '. Pick a later time.');
    return false;
  }
  return true;
}


// Put these people on this job. Off the clock → clocked in. On another job →
// taken off it and moved here. Already here → left alone.
function crewAssign(people, target) {
  let s = crewSession();
  if (s && !openKeys(s).length && s.date !== ymd(new Date())) s = null;
  const t = whenMs(s ? s.date : null);
  if (t > Date.now() + 60000) { alert('That time is in the future.'); return false; }
  if (!s) s = { id: newId(), date: ymd(new Date(t)), crew: [], open: {}, closed: [] };
  if (!checkTime(s, people.map(personKey), t)) return false;
  people.forEach(p => {
    const k = personKey(p);
    const cur = s.open[k];
    if (cur && cur.target === target.target && !!cur.ot === !!target.ot) return;
    if (cur) closeBlock(s, k, t);
    s.open[k] = blockFor(cur ? { id: cur.workerId, name: cur.name } : p, target, t);
    if (!s.crew.some(c => personKey(c) === k)) s.crew.push({ id: p.id || '', name: p.name, isMe: !!p.isMe });
  });
  saveCrew(s);
  saveObj(CREW_LAST_KEY, s.crew.map(c => ({ id: c.id || '', name: c.name })));
  return true;
}

function crewClockOut(keys) {
  const s = crewSession(); if (!s) return false;
  keys = keys.filter(k => s.open[k]);
  if (!keys.length) return false;
  const t = whenMs(s.date);
  if (!checkTime(s, keys, t)) return false;
  keys.forEach(k => closeBlock(s, k, t));
  if (!openKeys(s).length) finishCrewDay(s);
  else saveCrew(s);
  return true;
}

function finishCrewDay(s) {
  const segs = s.closed.slice().sort((a, b) => a.start - b.start);
  const me = (s.crew || []).find(c => c.isMe);
  const meKey = me ? personKey(me) : '';
  const totals = {};
  segs.forEach(b => { const k = personKey({ id: b.workerId, name: b.name }); totals[b.name] = (totals[b.name] || 0) + (b.end - b.start); if (k === meKey) totals.__me = (totals.__me || 0) + (b.end - b.start); });
  if (segs.length) {
    const out = loadList(OUTBOX_KEY);
    out.push({
      id: s.id, type: 'crewDay', date: s.date, label: 'Crew day — ' + s.date,
      crew: s.crew, startedAt: new Date(segs[0].start).toISOString(),
      endedAt: new Date(Math.max.apply(null, segs.map(b => b.end))).toISOString(),
      seconds: Math.round((totals.__me || 0) / 1000),
      segments: segs.map(b => Object.assign({}, b, { start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() })),
    });
    saveList(OUTBOX_KEY, out);
  }
  state.crewMsg = segs.length
    ? 'Crew day sent to the desktop: ' + Object.keys(totals).filter(n => n !== '__me').map(n => n + ' ' + hrs(totals[n]) + ' h').join(', ') + '.'
    : 'Clocked out. Nothing to send (no time recorded).';
  saveCrew(null);
  flushOutbox();
}

// Restore today's crew clock from the cloud copy if this phone lost it.
async function restoreCrew() {
  if (crewSession()) return;
  const remote = await fetchJson('/file/time/crew/current.json');
  if (remote && remote.open && Object.keys(remote.open).length) {
    saveObj(CREW_KEY, remote);
    state.crewMsg = 'Crew clock restored from the cloud.';
    render();
  }
}


// ── Crew clock screen ─────────────────────────────────────────────
function chip(label, on, onclick, extra) {
  return h('button', { class: 'chip' + (on ? ' on' : ''), onclick: onclick, style: extra || '' }, [label]);
}

function whenPicker() {
  const opts = [[0, 'Now'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 h ago']];
  const row = h('div', { class: 'chips' }, opts.map(o => chip(o[1], !state.crewWhenTime && state.crewWhen === o[0], () => { state.crewWhen = o[0]; state.crewWhenTime = ''; render(); })));
  const time = h('input', { type: 'time', class: 'tinput', value: state.crewWhenTime || '' });
  time.onchange = e => { state.crewWhenTime = e.target.value; render(); };
  row.appendChild(h('label', { class: 'chip' + (state.crewWhenTime ? ' on' : ''), style: 'display:inline-flex; align-items:center; gap:6px' }, ['At', time]));
  return row;
}

// Buckets, new job, and every active job (with search)
function jobChoices(onPick, skipTargets) {
  const wrap = h('div', {});
  const search = h('input', { type: 'text', id: 'crewSearch', placeholder: 'Search jobs…', value: state.crewSearch || '' });
  search.oninput = e => {
    state.crewSearch = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('crewSearch');
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (er) {} }
  };
  wrap.appendChild(search);
  const q = lower(state.crewSearch);
  const skip = skipTargets || [];
  wrap.appendChild(h('button', { class: 'tpick', style: 'border-style:dashed', onclick: () => {
    const name = prompt('Name for this new job (you will assign it on the desktop):');
    if (name && name.trim()) onPick({ target: 'new:' + lower(name), label: '🆕 ' + name.trim(), isNew: true });
  } }, ['➕ New job…']));
  BUCKETS.filter(b => !skip.includes('bucket:' + b.id) && (!q || lower(b.label).indexOf(q) >= 0)).forEach(b => {
    wrap.appendChild(h('button', { class: 'tpick', onclick: () => onPick({ target: 'bucket:' + b.id, label: b.label, bucket: b.id }) }, [b.label]));
  });
  const projects = state.jobs && state.jobs.projects ? state.jobs.projects.filter(p => p.lifecycle === 'onGoing' || p.lifecycle === 'deficiencies') : [];
  if (!state.jobs) wrap.appendChild(h('div', { class: 'empty' }, ['No synced jobs yet — hit "Sync now" on the desktop.']));
  (state.jobs && state.jobs.customers || []).forEach(cust => {
    const list = projects.filter(p => p.customerId === cust.id && !skip.includes('job:' + p.id) && (!q || lower((p.name || '') + ' ' + cust.name).indexOf(q) >= 0));
    if (!list.length) return;
    wrap.appendChild(h('div', { class: 'cust' }, [cust.name]));
    list.forEach(p => {
      const label = cust.name + ' — ' + (p.name || 'Untitled');
      wrap.appendChild(h('button', { class: 'tpick', onclick: () => onPick({ target: 'job:' + p.id, label: label, jobId: p.id }) }, [p.name || 'Untitled', p.lifecycle === 'deficiencies' ? h('small', {}, [' · deficiencies']) : null]));
    });
  });
  return wrap;
}

function addPersonPrompt() {
  const n = prompt('Name (they will be added to the Crew list on the desktop):');
  if (!n || !n.trim()) return null;
  const extra = loadObj(CREW_EXTRA_KEY) || [];
  if (!crewRoster().some(p => lower(p.name) === lower(n))) { extra.push(n.trim().replace(/ +/g, ' ')); saveObj(CREW_EXTRA_KEY, extra); }
  return crewRoster().find(x => lower(x.name) === lower(n)) || null;
}

function shortLabel(l) { const parts = (l || '').split(' — '); return parts[parts.length - 1]; }

function renderSetMain() {
  const wrap = h('div', { class: 'ccard' });
  wrap.appendChild(h('div', { class: 'row', style: 'margin-bottom:6px' }, [
    h('div', { class: 'name' }, ['Pick your main job']),
    h('button', { class: 'tcancel', style: 'padding:8px 12px', onclick: () => { resetCrewUi(); render(); } }, ['Cancel']),
  ]));
  wrap.appendChild(jobChoices(target => { saveObj(MAIN_KEY, target); resetCrewUi(); render(); }));
  return wrap;
}

function renderCrewClock() {
  if (state.crewMode === 'setmain') return renderSetMain();
  const s = crewSession();
  const open = openKeys(s);
  const main = mainTarget();
  const roster = crewRoster();
  const wrap = h('div', { class: 'ccard' });
  wrap.appendChild(h('div', { class: 'row', style: 'margin-bottom:4px' }, [
    h('div', { class: 'name' }, ['👷 Crew clock']),
    h('button', { class: 'linkbtn', onclick: () => { state.crewMode = 'setmain'; render(); } }, [main ? '📌 ' + shortLabel(main.label) : '📌 Set main job']),
  ]));
  if (state.crewMsg) wrap.appendChild(h('div', { class: 'note', style: 'color:var(--green); margin:0 0 8px' }, [state.crewMsg]));

  // Left running from an earlier day: close it before anything else
  if (s && open.length && s.date !== ymd(new Date())) {
    const time = h('input', { type: 'time', class: 'tinput', value: state.crewStaleTime });
    time.onchange = e => { state.crewStaleTime = e.target.value; };
    wrap.appendChild(h('div', { class: 'warn' }, [
      'The crew clock from ' + s.date + ' is still running (' + open.map(k => s.open[k].name).join(', ') + '). What time did everyone finish?',
      h('div', { class: 'row', style: 'margin-top:8px' }, [time, h('button', { class: 'tstop', onclick: () => {
        state.crewWhenTime = state.crewStaleTime || '15:30';
        if (crewClockOut(open)) resetCrewUi(); else state.crewWhenTime = '';
        render();
      } }, ['Clock out'])]),
    ]));
    return wrap;
  }

  // Who's where right now
  if (open.length) {
    const groups = [];
    open.forEach(k => {
      const b = s.open[k];
      let g = groups.find(x => x.target === b.target && x.ot === !!b.ot);
      if (!g) { g = { target: b.target, ot: !!b.ot, label: b.label, keys: [] }; groups.push(g); }
      g.keys.push(k);
    });
    groups.forEach(g => {
      const box = h('div', { class: 'jgroup' + (main && g.target === main.target ? ' main' : '') });
      box.appendChild(h('div', { class: 'jlabel', onclick: () => { state.crewSel = g.keys.slice(); render(); } }, [(main && g.target === main.target ? '📌 ' : '') + g.label, g.ot ? h('span', { class: 'otbadge' }, ['OT']) : null]));
      g.keys.forEach(k => {
        const b = s.open[k];
        const done = s.closed.filter(c => personKey({ id: c.workerId, name: c.name }) === k).reduce((a, c) => a + (c.end - c.start), 0);
        box.appendChild(h('div', { class: 'jperson' }, [
          h('div', { style: 'flex:1; min-width:0' }, [
            h('div', { style: 'font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis' }, [b.name]),
            h('div', { class: 'meta', style: 'margin:0; font-size:11px' }, ['since ' + hhmm(b.start) + ' · today ', h('span', { 'data-today': String(b.start - done) }, [hrs(done + Date.now() - b.start)]), ' h']),
          ]),
          h('span', { class: 'ptime', 'data-start': String(b.start) }, [fmtElapsed(Date.now() - b.start)]),
        ]));
      });
      wrap.appendChild(box);
    });
    const outToday = (s.crew || []).filter(c => !s.open[personKey(c)]);
    if (outToday.length) {
      wrap.appendChild(h('div', { class: 'note', style: 'margin:2px 0 0' }, ['Clocked out: ' + outToday.map(c => {
        const ms = s.closed.filter(b => personKey({ id: b.workerId, name: b.name }) === personKey(c)).reduce((a, b) => a + (b.end - b.start), 0);
        return c.name + ' ' + hrs(ms) + ' h';
      }).join(', ')]));
    }
  }

  // 1. Tap people
  let sel = state.crewSel;
  if (!sel) {
    if (open.length) sel = [];
    else {
      const last = loadObj(CREW_LAST_KEY) || [];
      const keys = last.map(personKey).filter(k => roster.some(p => personKey(p) === k));
      const me = roster.find(p => p.isMe) || roster[0];
      sel = keys.length ? keys : [personKey(me)];
    }
    if (state.jobs) state.crewSel = sel; // only remember once the synced crew list is here
  }
  sel = sel.filter(k => roster.some(p => personKey(p) === k));
  const toggle = k => { state.crewSel = sel.includes(k) ? sel.filter(x => x !== k) : sel.concat([k]); render(); };
  wrap.appendChild(h('div', { class: 'cust' }, ['1 · Tap who']));
  const chips = h('div', { class: 'chips' }, roster.map(p => {
    const k = personKey(p);
    const b = s && s.open && s.open[k];
    return h('button', { class: 'pchip' + (sel.includes(k) ? ' on' : ''), onclick: () => toggle(k) }, [
      h('div', { class: 'pn' }, [(p.isMe ? '★ ' : '') + p.name]),
      h('div', { class: 'pj' }, [b ? shortLabel(b.label) + (b.ot ? ' · OT' : '') : 'off the clock']),
    ]);
  }));
  chips.appendChild(h('button', { class: 'pchip', style: 'border-style:dashed', onclick: () => {
    const p = addPersonPrompt();
    if (p && !sel.includes(personKey(p))) state.crewSel = sel.concat([personKey(p)]);
    render();
  } }, [h('div', { class: 'pn' }, ['+ person']), h('div', { class: 'pj' }, ['new to the crew'])]));
  wrap.appendChild(chips);
  if (roster.length > 1) {
    wrap.appendChild(h('div', { class: 'row', style: 'gap:12px; margin:2px 0 4px' }, [
      h('button', { class: 'linkbtn', onclick: () => { state.crewSel = open.length ? open.slice() : roster.map(personKey); render(); } }, [open.length ? 'Select everyone on the clock' : 'Select everyone']),
      sel.length ? h('button', { class: 'linkbtn', onclick: () => { state.crewSel = []; render(); } }, ['Clear']) : null,
    ]));
  }

  // 2. Tap a job
  const people = roster.filter(p => sel.includes(personKey(p)));
  const names = people.map(p => p.name.split(' ')[0]).join(', ');
  wrap.appendChild(h('div', { class: 'cust' }, [people.length ? '2 · Send ' + names + ' to' : '2 · Then tap a job']));
  if (!people.length) {
    wrap.appendChild(h('div', { class: 'note', style: 'margin:0 0 6px' }, ['Tap one or more people above first.']));
    return wrap;
  }
  wrap.appendChild(whenPicker());
  // Only when this time can be billed at OT rates — never worked out automatically
  wrap.appendChild(h('div', { class: 'chips', style: 'margin-top:2px' }, [
    chip(state.crewOt ? '⏰ OT rates apply ✓' : '⏰ OT rates apply', state.crewOt, () => { state.crewOt = !state.crewOt; render(); }, state.crewOt ? 'background:#9a6610; border-color:#9a6610' : ''),
  ]));
  const done = target => { if (crewAssign(people, Object.assign({}, target, { ot: !!state.crewOt }))) { state.crewMsg = ''; state.crewSel = []; resetCrewUi(); } render(); };
  const quick = [];
  if (main) quick.push(main);
  // Jobs already used today come next — the ones you bounce between
  if (s) s.closed.concat(open.map(k => s.open[k])).forEach(b => {
    if (!quick.some(q => q.target === b.target)) quick.push({ target: b.target, label: b.label, jobId: b.jobId, bucket: b.bucket, isNew: b.isNew });
  });
  quick.forEach(t => {
    const isMain = main && t.target === main.target;
    const here = people.filter(p => s && s.open && s.open[personKey(p)] && s.open[personKey(p)].target === t.target && !!s.open[personKey(p)].ot === !!state.crewOt).length;
    wrap.appendChild(h('button', { class: 'tpick' + (isMain ? ' mainpick' : ''), onclick: () => done(t) }, [
      (isMain ? '📌 ' : '') + t.label,
      here && here === people.length ? h('small', {}, [' · already here']) : null,
    ]));
  });
  if (state.crewShowAll) {
    wrap.appendChild(jobChoices(done, quick.map(q => q.target)));
  } else {
    wrap.appendChild(h('button', { class: 'tpick', style: 'border-style:dashed; color:var(--text-mid)', onclick: () => { state.crewShowAll = true; render(); } }, ['Other job or category…']));
  }
  const onClock = people.filter(p => s && s.open && s.open[personKey(p)]);
  if (onClock.length) {
    wrap.appendChild(h('button', { class: 'tstop', style: 'width:100%; margin-top:8px', onclick: () => {
      if (crewClockOut(onClock.map(personKey))) { state.crewSel = []; resetCrewUi(); }
      render();
    } }, ['Clock out ' + onClock.map(p => p.name.split(' ')[0]).join(', ') + ' (' + whenText() + ')']));
  }
  return wrap;
}

function renderTime() {
  const wrap = h('div', {});
  wrap.appendChild(renderCrewClock());
  if (state.crewMode) return wrap;
  // Old single timers are replaced by the crew clock. Any started before the
  // update still show here so they can be stopped and sent.
  const timers = loadList(TIMERS_KEY);
  const outbox = loadList(OUTBOX_KEY);
  if (outbox.length) wrap.appendChild(h('div', { class: 'note', style: 'margin-bottom:10px; color:#b36b00' }, [outbox.length + ' item(s) waiting for signal to send to the desktop. Will retry automatically.']));
  if (timers.length) wrap.appendChild(h('div', { class: 'cust' }, ['Old timers still running']));
  timers.forEach(t => {
    wrap.appendChild(h('div', { class: 'tcard' }, [
      h('div', { class: 'tl' }, [
        h('div', { class: 'tn' }, [t.label]),
        h('div', { class: 'tt', 'data-start': String(t.start) }, [fmtElapsed(Date.now() - t.start)]),
      ]),
      h('button', { class: 'tcancel', onclick: () => cancelTimer(t.id) }, ['✕']),
      h('button', { class: 'tstop', onclick: () => stopTimer(t.id) }, ['Stop']),
    ]));
  });
  const pushOn = !!localStorage.getItem('sce_push_on');
  wrap.appendChild(h('div', { class: 'tcard', style: 'flex-wrap:wrap' }, [
    h('div', { class: 'tl' }, [
      h('div', { class: 'tn' }, ['🔔 8 pm end-of-day reminder']),
      h('div', { class: 'note', style: 'margin-top:2px' }, [state.pushStatus || (pushOn ? 'On — you will be nudged at 8:00 pm.' : 'Get a gentle nudge at 8 pm to stop timers and wrap up.')]),
    ]),
    h('button', { class: 'tcancel', onclick: enablePush }, [pushOn ? 'Re-enable' : 'Turn on']),
    pushOn ? h('button', { class: 'tcancel', onclick: testPush }, ['Test']) : null,
  ]));

  return wrap;
}

function renderCamera() {
  const wrap = h('div', {});
  const hasJobs = state.jobs && state.jobs.projects && state.jobs.projects.length > 0;
  if (!hasJobs) {
    wrap.appendChild(h('div', { class: 'note', style: 'margin-bottom:10px' }, ['No synced jobs yet — you can still upload to Miscellaneous below.']));
  }
  const select = h('select', { id: 'jobSelect', onchange: e => { state.cameraJobId = e.target.value; render(); } }, [
    h('option', { value: '' }, ['Choose a job…']),
    h('option', { value: '__expense__' }, ['💰 Expense receipt (timesheet)']),
    h('option', { value: '__packingslip__' }, ['📦 Packing slip / invoice (new order)']),
    h('option', { value: '__general_photo__' }, ['📷 General Pictures (not job-specific)']),
    h('option', { value: '__misc__' }, ['Miscellaneous (no specific job)']),
    ...(hasJobs ? state.jobs.projects.map(p => {
      const cust = (state.jobs.customers || []).find(c => c.id === p.customerId);
      return h('option', { value: p.id }, [(cust ? cust.name + ' — ' : '') + (p.name || 'Untitled')]);
    }) : []),
  ]);
  select.value = state.cameraJobId || '';
  wrap.appendChild(select);

  if (select.value === '__expense__') {
    wrap.appendChild(h('input', { type: 'text', id: 'expenseAmount', placeholder: 'Amount (optional — can fill in later)', value: state.expenseAmount || '', oninput: e => { state.expenseAmount = e.target.value; } }));
    wrap.appendChild(h('input', { type: 'text', id: 'expenseDesc', placeholder: 'What was it for? (optional)', value: state.expenseDesc || '', oninput: e => { state.expenseDesc = e.target.value; } }));
  }

  const box = h('label', { class: 'upload-box' }, [
    document.createTextNode('📷 Tap to take a photo, or choose a photo or document'),
    h('input', { type: 'file', accept: 'image/*,application/pdf', onchange: handlePhotoPick }),
  ]);
  wrap.appendChild(box);
  wrap.appendChild(h('div', { class: 'note' }, ['Photos and PDFs upload straight to the cloud. Job/Misc uploads land in the right folder next sync — packing slips show up in Materials, expense receipts show up on Timesheets, both ready to be reviewed.']));

  const thumbs = h('div', { class: 'thumbs', id: 'thumbs' });
  state.uploads.forEach(u => {
    thumbs.appendChild(h('div', { class: 'thumb' }, [
      u.isPdf ? h('div', { class: 'thumb-doc' }, ['📄', h('div', {}, [u.fileName || 'Document'])]) : h('img', { src: u.previewUrl }),
      h('div', { class: 'status' }, [u.status]),
    ]));
  });
  wrap.appendChild(thumbs);
  return wrap;
}

async function handlePhotoPick(e) {
  const file = e.target.files[0];
  if (!file) return;
  const jobId = document.getElementById('jobSelect').value;
  if (!jobId) { alert('Choose a job first.'); return; }
  const key = getKey();
  if (!key) { showSetup(); return; }

  const isPdf = file.type === 'application/pdf';
  const previewUrl = isPdf ? null : URL.createObjectURL(file);
  const entry = { previewUrl, isPdf, fileName: file.name, status: 'Uploading…' };
  state.uploads.unshift(entry);
  render();

  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefix', jobId === '__misc__' ? 'misc/pending' : jobId === '__expense__' ? 'expenses/pending' : jobId === '__packingslip__' ? 'packing-slips/pending' : jobId === '__general_photo__' ? 'photos/general/pending' : 'jobs/' + jobId + '/pending');
    if (jobId === '__expense__') {
      fd.append('amount', state.expenseAmount || '');
      fd.append('desc', state.expenseDesc || '');
    }
    const res = await fetch('/upload', { method: 'POST', headers: { 'X-Upload-Key': key }, body: fd });
    if (res.status === 401) {
      entry.status = 'Failed';
      render();
      if (confirm('This phone\\'s upload key doesn\\'t match the one on the Worker. Re-enter it now?')) {
        localStorage.removeItem(KEY_STORAGE);
        showSetup();
      }
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('Upload failed (' + res.status + ')'));
    }
    entry.status = 'Uploaded ✓';
    if (jobId === '__expense__') { state.expenseAmount = ''; state.expenseDesc = ''; }
  } catch (err) {
    entry.status = 'Failed';
    alert('Upload failed: ' + err.message);
  }
  render();
}

// ── Materials (phone) ──────────────────────────────────────────────
// Used: search an item, qty, job → sent to the desktop for approval.
// Slip: pick the job or quote, then snap the slip.
// Catalog: what's in the Catalog and on the shelf; send counts / new items for approval.
// Order: like Used, but it builds the Material Order list on the desktop.
// NOTE: this lives inside a template literal in the Worker — no backticks,
// no dollar-brace, no backslashes.
const MAT_OUTBOX = 'sce_mat_outbox';
const MAT_SENT = 'sce_mat_sent';
state.mat = { view: 'used', item: null, qty: '', job: null, stockOnly: false, slipTarget: null, catQ: '' };

function matList(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
function matSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function matUid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function matLc(s) { return String(s || '').toLowerCase(); }

function matParts() { return (state.catalog && state.catalog.items) || []; }
function matSearch(q, limit) {
  const t = matLc(q).trim();
  if (!t) return [];
  const words = t.split(' ').filter(Boolean);
  return matParts().filter(function (p) {
    const hay = matLc((p.nn || '') + ' ' + (p.n || '') + ' ' + (p.pn || '') + ' ' + (p.pa || ''));
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }).sort(function (a, b) { return (b.oh > 0) - (a.oh > 0); }).slice(0, limit || 8);
}
function matJobs(withStock) {
  const d = state.jobs;
  const out = withStock ? [{ id: '__stock__', name: 'Stock (shop / truck)', customerName: '' }] : [];
  if (!d) return out;
  const cust = {};
  (d.customers || []).forEach(function (c) { cust[c.id] = c.name; });
  (d.projects || []).filter(function (p) { return !p.trashed && p.lifecycle !== 'billed' && p.lifecycle !== 'unbilled'; }).forEach(function (p) {
    out.push({ id: p.id, name: p.name, customerName: cust[p.customerId] || '' });
  });
  return out;
}
function matQuotes() {
  const d = state.quotes;
  if (!d) return [];
  const cust = {};
  (d.customers || []).forEach(function (c) { cust[c.id] = c.name; });
  return (d.quotes || []).filter(function (q) { return q.quoteNumber; }).map(function (q) {
    return { id: q.id, type: 'quote', quoteNumber: q.quoteNumber, title: q.title || '', customerName: cust[q.customerId] || '' };
  });
}

async function flushMatOutbox() {
  const key = getKey();
  if (!key) return;
  let box = matList(MAT_OUTBOX);
  for (const it of box.slice()) {
    try {
      const res = await fetch('/putjson', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': key }, body: JSON.stringify({ key: 'materials/pending/' + it.id + '.json', data: it }) });
      if (!res.ok) break;
      box = box.filter(function (x) { return x.id !== it.id; });
      matSave(MAT_OUTBOX, box);
      const sent = matList(MAT_SENT); sent.unshift(it); matSave(MAT_SENT, sent.slice(0, 30));
    } catch (e) { break; }
  }
  if (state.tab === 'materials') render();
}

function matSend(kind) {
  const m = state.mat;
  const qty = Number(m.qty);
  if (!m.item || !(qty > 0)) { alert('Pick an item and enter the qty.'); return; }
  if (kind === 'used' && !m.job) { alert('Pick the job it was used on.'); return; }
  const p = m.item;
  const it = {
    id: matUid(), kind: kind, at: new Date().toISOString(),
    catalogId: p.c || null, stockId: kind === 'used' ? (p.s || null) : null,
    item: p.nn || p.n, name: p.n, nickname: p.nn || '', partNo: p.pn || '', uom: p.u || '', qty: qty, price: Number(p.p) || 0,
    jobId: m.job ? m.job.id : '', jobName: m.job ? m.job.name : '', customerName: m.job ? m.job.customerName : '',
  };
  const box = matList(MAT_OUTBOX); box.push(it); matSave(MAT_OUTBOX, box);
  m.item = null; m.qty = '';
  render();
  flushMatOutbox();
}

// A search box whose results list updates without redrawing the page (so the
// keyboard stays up while typing)
function matPicker(opts) {
  const wrap = h('div', { class: 'mpick' });
  const results = h('div', { class: 'mresults' });
  const input = h('input', { type: 'search', placeholder: opts.placeholder, class: 'minput', autocomplete: 'off' });
  function fill() {
    results.innerHTML = '';
    const rows = opts.find(input.value);
    rows.forEach(function (r) {
      results.appendChild(h('div', { class: 'mrow', onclick: function () { opts.pick(r); } }, opts.row(r)));
    });
    if (opts.extra && input.value.trim()) {
      const ex = opts.extra(input.value.trim());
      if (ex) results.appendChild(ex);
    }
  }
  input.oninput = fill;
  input.onfocus = fill;
  wrap.appendChild(input);
  wrap.appendChild(results);
  if (opts.autofocus) setTimeout(function () { input.focus(); }, 30);
  return wrap;
}
function matChosen(label, sub, onClear) {
  return h('div', { class: 'mchosen' }, [
    h('div', { style: 'flex:1; min-width:0' }, [h('div', { style: 'font-weight:700' }, [label]), sub ? h('div', { class: 'meta' }, [sub]) : null]),
    h('div', { class: 'mx', onclick: onClear }, ['×']),
  ]);
}
function matItemRow(p) {
  return [
    h('div', { style: 'flex:1; min-width:0' }, [
      h('div', { style: 'font-weight:700' }, [p.nn || p.n]),
      h('div', { class: 'meta' }, [(p.nn ? p.n + ' · ' : '') + (p.pn || '') + ' · ' + money(p.p) + '/' + (p.u || 'ea')]),
    ]),
    p.oh > 0 ? h('span', { class: 'mstock' }, [p.oh + ' in stock']) : null,
  ];
}

function matEntryForm(kind) {
  const m = state.mat;
  const wrap = h('div', { class: 'card' });
  wrap.appendChild(h('div', { class: 'mlabel' }, ['Item']));
  if (m.item) wrap.appendChild(matChosen(m.item.nn || m.item.n, (m.item.pn || '') + ' · ' + money(m.item.p) + '/' + (m.item.u || 'ea') + (m.item.oh > 0 ? ' · ' + m.item.oh + ' in stock' : ''), function () { m.item = null; render(); }));
  else wrap.appendChild(matPicker({
    placeholder: state.catalog ? 'Search the catalog…' : 'Loading catalog…', autofocus: true,
    find: function (q) { return matSearch(q, 8); }, row: matItemRow,
    pick: function (p) { m.item = p; render(); },
    extra: function (q) { return h('div', { class: 'mrow madd', onclick: function () { m.item = { n: q, nn: '', pn: '', u: '', p: 0, oh: 0 }; render(); } }, ['+ Use "' + q + '" (not in the catalog)']); },
  }));
  wrap.appendChild(h('div', { class: 'mlabel' }, ['Qty' + (m.item && m.item.u ? ' (' + m.item.u + ')' : '')]));
  const qty = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', class: 'minput', value: m.qty, placeholder: '0' });
  qty.oninput = function () { m.qty = qty.value; };
  wrap.appendChild(qty);
  wrap.appendChild(h('div', { class: 'mlabel' }, [kind === 'used' ? 'Job' : 'For (job or Stock)']));
  if (m.job) wrap.appendChild(matChosen(m.job.name, m.job.customerName, function () { m.job = null; render(); }));
  else wrap.appendChild(matPicker({
    placeholder: 'Search jobs…',
    find: function (q) { const t = matLc(q).trim(); return matJobs(kind === 'order').filter(function (j) { return !t || matLc(j.customerName + ' ' + j.name).indexOf(t) >= 0; }).slice(0, 10); },
    row: function (j) { return [h('div', {}, [j.customerName ? h('span', { class: 'meta' }, [j.customerName + ' — ']) : null, h('b', {}, [j.name])])]; },
    pick: function (j) { m.job = j; render(); },
  }));
  wrap.appendChild(h('button', { class: 'mbtn', onclick: function () { matSend(kind); } }, [kind === 'used' ? 'Log material used' : 'Add to order list']));
  wrap.appendChild(h('div', { class: 'note' }, [kind === 'used'
    ? 'Goes to Materials → Material Used on the desktop for you to approve onto the job. The job stays picked for the next item.'
    : 'Goes to Materials → Material Order on the desktop, ready to review and send to the wholesaler.']));
  return wrap;
}

function matSentList(kind, kind2) {
  const wait = matList(MAT_OUTBOX).filter(function (x) { return x.kind === kind || x.kind === kind2; });
  const sent = matList(MAT_SENT).filter(function (x) { return x.kind === kind || x.kind === kind2; }).slice(0, 10);
  if (!wait.length && !sent.length) return null;
  const wrap = h('div', { class: 'card' }, [h('div', { class: 'mlabel' }, ['Recent'])]);
  wait.concat(sent).forEach(function (x, i) {
    wrap.appendChild(h('div', { class: 'mrow', style: 'cursor:default' }, [
      h('div', { style: 'flex:1; min-width:0' }, [h('b', {}, [x.qty + ' ' + (x.uom || '') + ' ']), x.item, h('div', { class: 'meta' }, [(x.jobName || (x.kind === 'count' ? 'count, was ' + (x.prevQty || 0) : x.kind === 'newpart' ? 'new item' : 'no job')) + ' · ' + new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })])]),
      h('span', { class: 'meta' }, [i < wait.length ? 'waiting for signal' : 'sent ✓']),
    ]));
  });
  return wrap;
}

function matSlip() {
  const m = state.mat;
  const wrap = h('div', { class: 'card' });
  wrap.appendChild(h('div', { class: 'mlabel' }, ['Slip for (job or quote)']));
  if (m.slipTarget) {
    const t = m.slipTarget;
    wrap.appendChild(matChosen(t.type === 'quote' ? 'Quote ' + t.quoteNumber + (t.title ? ' — ' + t.title : '') : t.name, t.type === 'quote' ? 'Pricing quote' : (t.customerName || 'Job'), function () { m.slipTarget = null; render(); }));
  } else {
    wrap.appendChild(matPicker({
      placeholder: 'Search jobs or quotes…',
      find: function (q) {
        const t = matLc(q).trim();
        const jobs = matJobs(false).map(function (j) { return { type: 'job', id: j.id, name: j.name, customerName: j.customerName }; });
        const all = jobs.concat(matQuotes());
        return all.filter(function (x) { return !t || matLc((x.customerName || '') + ' ' + (x.name || '') + ' ' + (x.quoteNumber || '') + ' ' + (x.title || '')).indexOf(t) >= 0; }).slice(0, 12);
      },
      row: function (x) {
        return [h('div', { style: 'flex:1' }, [x.type === 'quote' ? h('b', {}, ['Quote ' + x.quoteNumber + ' ']) : h('b', {}, [x.name + ' ']), h('span', { class: 'meta' }, [x.type === 'quote' ? (x.title || '') : (x.customerName || '')])]),
          h('span', { class: x.type === 'quote' ? 'mtagq' : 'mtagj' }, [x.type === 'quote' ? 'quote' : 'job'])];
      },
      pick: function (x) { m.slipTarget = x; render(); },
    }));
    wrap.appendChild(h('div', { class: 'note' }, ['Not sure yet? Snap it anyway and pick on the desktop.']));
  }
  const cam = h('label', { class: 'upload-box', style: 'margin-top:10px' }, [
    document.createTextNode('📷 Snap the slip'),
    h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: matSlipPick }),
  ]);
  wrap.appendChild(cam);
  const pdf = h('label', { class: 'mlink' }, [
    document.createTextNode('or choose a photo / PDF'),
    h('input', { type: 'file', accept: 'image/*,application/pdf', style: 'display:none', onchange: matSlipPick }),
  ]);
  wrap.appendChild(pdf);
  const thumbs = h('div', { class: 'thumbs' });
  (state.slipUploads || []).forEach(function (u) {
    thumbs.appendChild(h('div', { class: 'thumb' }, [u.isPdf ? h('div', { class: 'thumb-doc' }, ['📄']) : h('img', { src: u.previewUrl }), h('div', { class: 'status' }, [u.status])]));
  });
  wrap.appendChild(thumbs);
  wrap.appendChild(h('div', { class: 'note' }, ['Lands in Materials → Slips on the desktop, already read and tagged to the job (Material Order) or quote (Pricing Quote) — you just confirm it.']));
  return wrap;
}
async function matSlipPick(e) {
  const file = e.target.files[0];
  if (!file) return;
  const key = getKey();
  if (!key) { showSetup(); return; }
  const isPdf = file.type === 'application/pdf';
  const u = { previewUrl: isPdf ? null : URL.createObjectURL(file), isPdf: isPdf, status: 'Uploading…' };
  state.slipUploads = [u].concat(state.slipUploads || []);
  render();
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefix', 'packing-slips/pending');
    if (state.mat.slipTarget) fd.append('desc', JSON.stringify(state.mat.slipTarget));
    const res = await fetch('/upload', { method: 'POST', headers: { 'X-Upload-Key': key }, body: fd });
    if (!res.ok) throw new Error('Upload failed (' + res.status + ')');
    u.status = 'Uploaded ✓';
  } catch (err) { u.status = 'Failed'; alert(err.message); }
  render();
}

// Catalog: on-the-fly counts and new items. Each one goes to the desktop for
// approval and shows as tentative here until it's approved (new items need a
// part # on the desktop before they join the Catalog).
function matBy() { try { return localStorage.getItem('sce_mat_by') || ''; } catch (e) { return ''; } }
function matTentative() {
  const cat = state.catalog || {};
  const seen = cat.updatedAt ? Date.parse(cat.updatedAt) : 0;
  const pendIds = {};
  (cat.pend || []).forEach(function (x) { pendIds[x.id] = 1; });
  const mine = matList(MAT_OUTBOX).concat(matList(MAT_SENT)).filter(function (x) {
    if (x.kind !== 'count' && x.kind !== 'newpart') return false;
    return matList(MAT_OUTBOX).some(function (o) { return o.id === x.id; }) || pendIds[x.id] || Date.parse(x.at) > seen;
  });
  const all = mine.slice();
  (cat.pend || []).forEach(function (x) { if (!all.some(function (y) { return y.id === x.id; })) all.push(x); });
  return all;
}
// One item's tentative total: its last count (or what's on hand) plus every
// "found more" add sent after it — same rule as the desktop.
function matRollUp(tent, p) {
  const list = tent.filter(function (x) { return x.kind === 'count' && ((p.c && x.catalogId === p.c) || (p.s && x.stockId === p.s)); })
    .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
  if (!list.length) return null;
  let base = Number(p.oh) || 0, from = 'on hand', adds = [];
  list.forEach(function (x) { if (x.add) adds.push(Number(x.qty) || 0); else { base = Number(x.qty) || 0; from = 'count'; adds = []; } });
  const total = Math.round((base + adds.reduce(function (a, b) { return a + b; }, 0)) * 1000) / 1000;
  return { qty: total, label: [from + ' ' + base].concat(adds.map(function (a) { return '+' + a; })).join(' · ') };
}
function matSendCatalog(it, keepOpen) {
  const by = matBy();
  it.id = matUid(); it.at = new Date().toISOString(); it.by = by;
  const box = matList(MAT_OUTBOX); box.push(it); matSave(MAT_OUTBOX, box);
  if (!keepOpen) state.mat.catEdit = null;
  state.mat.catNew = null;
  render();
  flushMatOutbox();
}
function matByInput() {
  const by = h('input', { class: 'minput', placeholder: 'Your name (optional)', value: matBy() });
  by.oninput = function () { try { localStorage.setItem('sce_mat_by', by.value.trim()); } catch (e) {} };
  return by;
}
// Tap an item: set its count, or add more you've found (as many times as you
// like) — it all rolls into one tentative total until approved on the desktop.
function matCountForm(p, tent) {
  const wrap = h('div', { class: 'mchosen', style: 'flex-direction:column; align-items:stretch; gap:6px' });
  const now = tent ? tent.qty : (Number(p.oh) || 0);
  wrap.appendChild(h('div', { class: 'meta' }, [tent ? '⏳ ' + now + ' ' + (p.u || '') + ' waiting (' + tent.label + ')' : 'On hand now: ' + now + ' ' + (p.u || '')]));
  const qty = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', class: 'minput', placeholder: 'Qty' + (p.u ? ' (' + p.u + ')' : '') });
  const note = h('input', { class: 'minput', placeholder: 'Note (optional) — e.g. back corner' });
  wrap.appendChild(qty); wrap.appendChild(note); wrap.appendChild(matByInput());
  const send = function (add) {
    const q = Number(qty.value);
    if (qty.value === '' || !(q >= 0) || (add && !(q > 0))) { alert(add ? 'Enter how many more you found.' : 'Enter the qty you counted.'); return; }
    const it = { kind: 'count', catalogId: p.c || null, stockId: p.s || null, item: p.nn || p.n, name: p.n, nickname: p.nn || '', partNo: p.pn || '', uom: p.u || '', prevQty: Number(p.oh) || 0, qty: q, note: note.value.trim() };
    if (add) it.add = true;
    matSendCatalog(it, true);
  };
  const row = h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' });
  row.appendChild(h('button', { class: 'mbtn', style: 'flex:1', onclick: function () { send(true); } }, ['＋ Add found (to ' + now + ')']));
  row.appendChild(h('button', { class: 'mbtn', style: 'flex:1; background:#fff; color:var(--navy); border:1px solid var(--border)', onclick: function () { send(false); } }, ['Set count']));
  row.appendChild(h('button', { class: 'mbtn', style: 'flex:0 0 auto; background:#fff; color:var(--navy); border:1px solid var(--border)', onclick: function () { state.mat.catEdit = null; render(); } }, ['Done']));
  wrap.appendChild(row);
  setTimeout(function () { qty.focus(); }, 30);
  return wrap;
}
function matNewForm(name) {
  const wrap = h('div', { class: 'card', style: 'border:2px dashed #e0a716' });
  wrap.appendChild(h('div', { class: 'mlabel' }, ['New item (not in the catalog)']));
  const n = h('input', { class: 'minput', placeholder: 'What is it? e.g. 4x4 box 2-1/8 deep', value: name || '' });
  const q = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', class: 'minput', placeholder: 'Qty on hand (or needed)' });
  const u = h('input', { class: 'minput', placeholder: 'Unit — EA, FT, M, BOX…' });
  const pn = h('input', { class: 'minput', placeholder: 'Part # if you can see one (optional)' });
  const note = h('input', { class: 'minput', placeholder: 'Note (optional) — where it is, brand…' });
  [n, q, u, pn, note].forEach(function (x) { wrap.appendChild(x); });
  wrap.appendChild(matByInput());
  const row = h('div', { style: 'display:flex; gap:8px' });
  row.appendChild(h('button', { class: 'mbtn', style: 'flex:1', onclick: function () {
    if (!n.value.trim()) { alert('Say what the item is.'); return; }
    matSendCatalog({ kind: 'newpart', item: n.value.trim(), name: n.value.trim(), nickname: '', partNo: pn.value.trim(), uom: u.value.trim().toUpperCase(), qty: Number(q.value) || 0, note: note.value.trim() });
  } }, ['Send new item for approval']));
  row.appendChild(h('button', { class: 'mbtn', style: 'flex:0 0 auto; background:#fff; color:var(--navy); border:1px solid var(--border)', onclick: function () { state.mat.catNew = null; render(); } }, ['Cancel']));
  wrap.appendChild(row);
  wrap.appendChild(h('div', { class: 'note' }, ['Shows as tentative until it is approved on the desktop. A part # gets added there before it joins the Catalog.']));
  setTimeout(function () { (name ? q : n).focus(); }, 30);
  return wrap;
}

function matCatalog() {
  const m = state.mat;
  const wrap = h('div', {});
  if (m.catNew != null) { wrap.appendChild(matNewForm(m.catNew)); return wrap; }
  const card = h('div', { class: 'card' });
  const top = h('div', { style: 'display:flex; gap:8px; align-items:center' });
  const input = h('input', { type: 'search', class: 'minput', placeholder: 'Search the catalog…', value: m.catQ, autocomplete: 'off' });
  const list = h('div', {});
  const tent = matTentative();
  const tentFor = function (p) { return matRollUp(tent, p); };
  function rowFor(p) {
    const t = tentFor(p);
    const box = h('div', {});
    const main = h('div', { class: 'mrow', onclick: function () { m.catEdit = m.catEdit === (p.k || p.c) ? null : (p.k || p.c); render(); } }, [
      h('div', { style: 'flex:1; min-width:0' }, [
        h('div', { style: 'font-weight:700' }, [p.nn || p.n]),
        h('div', { class: 'meta' }, [(p.nn ? p.n + ' · ' : '') + (p.pn || '') + ' · ' + money(p.p) + '/' + (p.u || 'ea')]),
      ]),
      t ? h('span', { class: 'mstock', style: 'background:#fff3d6; color:#9a6610' }, ['⏳ ' + t.qty + ' tentative']) : (p.oh > 0 ? h('span', { class: 'mstock' }, [p.oh + ' in stock']) : h('span', { class: 'meta' }, ['✎ count'])),
    ]);
    box.appendChild(main);
    if (m.catEdit === (p.k || p.c)) box.appendChild(matCountForm(p, t));
    return box;
  }
  function fill() {
    m.catQ = input.value;
    list.innerHTML = '';
    const news = tent.filter(function (x) { return x.kind === 'newpart' && (!m.catQ.trim() || matLc(x.name + ' ' + (x.partNo || '')).indexOf(matLc(m.catQ).trim()) >= 0); });
    news.forEach(function (x) {
      list.appendChild(h('div', { class: 'mrow', style: 'cursor:default; background:#fffaf0' }, [
        h('div', { style: 'flex:1; min-width:0' }, [h('div', { style: 'font-weight:700' }, [x.name]), h('div', { class: 'meta' }, ['New item · waiting for approval' + (x.partNo ? ' · ' + x.partNo : '') + (x.by ? ' · ' + x.by : '')])]),
        h('span', { class: 'mstock', style: 'background:#fff3d6; color:#9a6610' }, ['⏳ ' + (x.qty || 0) + ' ' + (x.uom || '') + ' tentative']),
      ]));
    });
    let rows = m.catQ.trim() ? matSearch(m.catQ, 60) : matParts().slice();
    if (m.stockOnly) rows = rows.filter(function (p) { return p.oh > 0 || tentFor(p); });
    if (!m.catQ.trim()) rows.sort(function (a, b) { return matLc(a.nn || a.n).localeCompare(matLc(b.nn || b.n)); });
    rows.slice(0, 80).forEach(function (p) { list.appendChild(rowFor(p)); });
    if (m.catQ.trim()) list.appendChild(h('div', { class: 'mrow madd', onclick: function () { m.catNew = m.catQ.trim(); render(); } }, ['+ Add "' + m.catQ.trim() + '" (not in the catalog)']));
    else if (!rows.length) list.appendChild(h('div', { class: 'meta', style: 'padding:10px 2px' }, [state.catalog ? 'Nothing here yet.' : 'Catalog not synced yet — open the desktop app once.']));
  }
  input.oninput = fill;
  top.appendChild(input);
  top.appendChild(h('div', { class: 'mtoggle' + (m.stockOnly ? ' on' : ''), onclick: function () { m.stockOnly = !m.stockOnly; render(); } }, ['📦 Stock only']));
  card.appendChild(top);
  card.appendChild(h('div', { class: 'note', style: 'margin:6px 0 2px' }, ['Tap an item to send a new count. Not on the list? Search it and tap + Add.']));
  card.appendChild(list);
  fill();
  card.appendChild(h('div', { class: 'mrow madd', onclick: function () { m.catNew = ''; render(); } }, ['+ Add a new item']));
  if (state.catalog && state.catalog.updatedAt) card.appendChild(h('div', { class: 'note' }, ['Synced ' + new Date(state.catalog.updatedAt).toLocaleString()]));
  wrap.appendChild(card);
  const r = matSentList('count', 'newpart'); if (r) wrap.appendChild(r);
  return wrap;
}

function renderMaterials() {
  const m = state.mat;
  const wrap = h('div', {});
  const sub = h('div', { class: 'msub' });
  [['used', 'Used'], ['slip', 'Slip'], ['catalog', 'Catalog'], ['order', 'Order']].forEach(function (v) {
    sub.appendChild(h('div', { class: 'msubtab' + (m.view === v[0] ? ' on' : ''), onclick: function () { if (m.view !== v[0]) { m.view = v[0]; m.item = null; m.qty = ''; m.catEdit = null; m.catNew = null; if (v[0] === 'used' && m.job && m.job.id === '__stock__') m.job = null; render(); } } }, [v[1]]));
  });
  wrap.appendChild(sub);
  if (m.view === 'used') { wrap.appendChild(matEntryForm('used')); const r = matSentList('used'); if (r) wrap.appendChild(r); }
  else if (m.view === 'order') { wrap.appendChild(matEntryForm('order')); const r = matSentList('order'); if (r) wrap.appendChild(r); }
  else if (m.view === 'slip') wrap.appendChild(matSlip());
  else wrap.appendChild(matCatalog());
  return wrap;
}

// Sign-in: the password is the Upload Key (set on Cloudflare, also in the
// desktop's Mobile settings). Saved on this phone so it's only typed once.
function setAuthCookie(k) {
  try { document.cookie = 'sce_k=' + encodeURIComponent(k || '') + '; path=/; max-age=' + (k ? 31536000 : 0) + '; secure; samesite=strict'; } catch (e) {}
}
function signOut(msg) {
  localStorage.removeItem(KEY_STORAGE);
  setAuthCookie('');
  showSetup(msg);
}
function showSetup(msg) {
  const root = document.getElementById('root');
  root.innerHTML = '';
  root.appendChild(h('header', {}, [h('h1', {}, ['SCE Field App — Sign in'])]));
  const wrap = h('div', { class: 'setup' });
  const err = h('div', { class: 'meta', style: 'color:#c0392b; font-weight:700; margin-bottom:8px' }, [msg || '']);
  wrap.appendChild(err);
  const input = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  wrap.appendChild(input);
  async function go() {
    const k = input.value.trim();
    if (!k) return;
    err.textContent = 'Checking…';
    try {
      const res = await fetch('/list/sync/', { cache: 'no-store', headers: { 'X-Upload-Key': k } });
      if (res.status === 401) { err.textContent = 'Wrong password.'; return; }
      if (!res.ok) { err.textContent = 'Could not check the password (' + res.status + '). Try again.'; return; }
    } catch (e) { err.textContent = 'No connection — try again when you have signal.'; return; }
    localStorage.setItem(KEY_STORAGE, k);
    setAuthCookie(k);
    init();
  }
  input.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  wrap.appendChild(h('button', { onclick: go }, ['Sign in']));
  wrap.appendChild(h('div', { class: 'meta', style: 'margin-top:12px' }, ['Only needed once on this phone.']));
  root.appendChild(wrap);
  setTimeout(function () { input.focus(); }, 30);
}

// ── ✓ Tasks: each job's to-do list, ticked off on site ─────────────
// The computer sends open tasks (sync/tasks.json); a tick or a new task goes
// back as a small change (tasks/pending/…) and shows here straight away.
const TASK_OPS_KEY = 'sce_task_ops';
const TASK_WHO_KEY = 'sce_task_who';
state.taskView = 'open';
state.taskAddJob = '';
function taskOps() { return loadList(TASK_OPS_KEY); }
function taskNewId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); }
function taskCrew() { return ((state.jobs && state.jobs.crew) || []).map(function (p) { return p.name; }); }
function taskMe() {
  const w = localStorage.getItem(TASK_WHO_KEY);
  if (w) return w;
  const me = ((state.jobs && state.jobs.crew) || []).find(function (p) { return p.isMe; });
  return me ? me.name : '';
}
function taskJobs() {
  const snap = (state.tasks && state.tasks.jobs) || [];
  const jobs = snap.map(function (j) { return { jobId: j.jobId, name: j.name, customer: j.customer, tasks: j.tasks.map(function (t) { return Object.assign({}, t); }) }; });
  taskOps().forEach(function (op) {
    let j = jobs.find(function (x) { return x.jobId === op.jobId; });
    if (!j && op.op === 'add') { j = { jobId: op.jobId, name: op.jobName || 'Job', customer: op.customer || '', tasks: [] }; jobs.push(j); }
    if (!j) return;
    if (op.op === 'add') {
      if (!j.tasks.some(function (t) { return t.id === op.taskId; })) j.tasks.push({ id: op.taskId, text: op.text, who: '', due: '', done: false, pending: !op.sent });
      return;
    }
    const t = j.tasks.find(function (x) { return x.id === op.taskId; });
    if (!t) return;
    if (op.op === 'done') { t.done = true; t.doneAt = op.at; t.doneBy = op.by; t.pending = !op.sent; }
    if (op.op === 'undo') { t.done = false; t.doneAt = null; t.doneBy = ''; t.pending = !op.sent; }
  });
  return jobs;
}
// drop changes the computer has taken in (or that are days old)
function pruneTaskOps() {
  if (!state.tasks) return;
  const snap = state.tasks.jobs || [];
  const find = function (op) { const j = snap.find(function (x) { return x.jobId === op.jobId; }); return j && j.tasks.find(function (t) { return t.id === op.taskId; }); };
  const keep = taskOps().filter(function (op) {
    if (Date.now() - Date.parse(op.at) > 3 * 86400000) return false;
    if (!op.sent) return true;
    const t = find(op);
    if (op.op === 'add') return !t;
    if (op.op === 'done') return !(t && t.done);
    if (op.op === 'undo') return !(t && !t.done);
    return false;
  });
  saveList(TASK_OPS_KEY, keep);
}
function queueTaskOp(op) {
  op.id = taskNewId(); op.at = new Date().toISOString(); op.by = taskMe(); op.sent = false;
  const list = taskOps(); list.push(op); saveList(TASK_OPS_KEY, list);
  render();
  flushTaskOps();
}
async function flushTaskOps() {
  const key = getKey();
  if (!key) return;
  for (const op of taskOps().filter(function (o) { return !o.sent; })) {
    try {
      const body = { id: op.id, op: op.op, jobId: op.jobId, taskId: op.taskId, text: op.text || '', by: op.by || '', at: op.at };
      const res = await fetch('/putjson', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Key': key }, body: JSON.stringify({ key: 'tasks/pending/' + op.id + '.json', data: body }) });
      if (!res.ok) break;
      saveList(TASK_OPS_KEY, taskOps().map(function (o) { return o.id === op.id ? Object.assign({}, o, { sent: true }) : o; }));
    } catch (err) { break; }
  }
  if (state.tab === 'tasks') render();
}
function taskDay(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function taskToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function renderTasks() {
  const wrap = h('div', {});
  const crew = taskCrew();
  const me = taskMe();
  // who's ticking
  const whoSel = h('select', { class: 'tinput', style: 'flex:1', onchange: function (e) { localStorage.setItem(TASK_WHO_KEY, e.target.value); render(); } },
    (crew.length ? crew : [me || 'Me']).map(function (n) { return h('option', { value: n, selected: n === me ? 'selected' : null }, [n]); }));
  wrap.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, [h('span', { class: 'meta', style: 'margin:0' }, ['Ticking as']), whoSel]));
  wrap.appendChild(h('div', { class: 'msub' }, [
    h('div', { class: 'msubtab' + (state.taskView === 'open' ? ' on' : ''), onclick: function () { state.taskView = 'open'; render(); } }, ['To do']),
    h('div', { class: 'msubtab' + (state.taskView === 'done' ? ' on' : ''), onclick: function () { state.taskView = 'done'; render(); } }, ['Done lately']),
  ]));
  if (!state.tasks) {
    wrap.appendChild(h('div', { class: 'empty' }, ['No tasks synced yet. Add tasks on the computer (a job → Tasks), then it syncs here within 10 minutes.']));
    return wrap;
  }
  const jobs = taskJobs();
  const today = taskToday();
  wrap.appendChild(searchList('Search tasks or jobs…', 'taskQ', function (list, words) {
    const shown = [];
    jobs.forEach(function (j) {
      const items = j.tasks.filter(function (t) {
        if (state.taskView === 'open' ? t.done : !t.done) return false;
        return hasWords([t.text, t.who, j.name, j.customer].join(' '), words);
      });
      if (items.length) shown.push({ j: j, items: items });
    });
    if (state.taskView === 'done') {
      shown.forEach(function (g) { g.items.sort(function (a, b) { return String(b.doneAt).localeCompare(String(a.doneAt)); }); });
    }
    const n = shown.reduce(function (a, g) { return a + g.items.length; }, 0);
    list.appendChild(h('div', { class: 'meta', style: 'margin:0 2px 6px' }, [n + (state.taskView === 'open' ? ' to do on ' : ' done on ') + shown.length + ' job' + (shown.length === 1 ? '' : 's')]));
    // one line per job, collapsed — tap to open (searching opens the matches)
    state.taskOpenJobs = state.taskOpenJobs || {};
    shown.sort(function (a, b) { return a.j.name.localeCompare(b.j.name); }).forEach(function (g) {
      const all = g.j.tasks.length, doneN = g.j.tasks.filter(function (t) { return t.done; }).length;
      const lateN = g.items.filter(function (t) { return !t.done && t.due && t.due < today; }).length;
      const open = words.length > 0 || !!state.taskOpenJobs[g.j.jobId];
      const card = h('div', { class: 'card' }, [
        h('div', { class: 'tjob', onclick: function () { state.taskOpenJobs[g.j.jobId] = !state.taskOpenJobs[g.j.jobId]; render(); } }, [
          h('span', { style: 'font-size:13px;color:#9aa3b5;width:12px' }, [open ? '▾' : '▸']),
          h('div', { class: 'tl', style: 'flex:1;min-width:0' }, [
            h('div', { class: 'name' }, [g.j.name]),
            h('div', { class: 'meta', style: 'margin:1px 0 0' }, [(g.j.customer || '') + (g.j.customer ? ' · ' : '') + doneN + ' of ' + all + ' done']),
          ]),
          lateN ? h('span', { class: 'tcount', style: 'background:#fdecea;color:#c0392b' }, [lateN + ' late']) : null,
          h('span', { class: 'tcount' }, [g.items.length + (state.taskView === 'open' ? ' to do' : ' done')]),
        ]),
      ]);
      if (!open) { list.appendChild(card); return; }
      g.items.forEach(function (t) {
        const late = !t.done && t.due && t.due < today;
        const metaBits = [];
        if (!t.done && t.who) metaBits.push('👷 ' + t.who);
        if (!t.done && t.due) metaBits.push((late ? 'Overdue · ' : t.due === today ? 'Today · ' : 'By ') + taskDay(t.due));
        if (t.done) metaBits.push('✓ ' + taskDay(t.doneAt) + (t.doneBy ? ' — ' + t.doneBy : ''));
        if (t.pending) metaBits.push(navigator.onLine ? 'sending…' : 'saved — sends when online');
        const box = h('input', { type: 'checkbox', class: 'tick', style: 'width:26px;height:26px', onchange: function (e) { queueTaskOp({ op: e.target.checked ? 'done' : 'undo', jobId: g.j.jobId, taskId: t.id }); } });
        box.checked = !!t.done;
        card.appendChild(h('div', { class: 'prow' }, [
          box,
          h('div', { class: 'tl' }, [
            h('div', { style: 'font-size:15px;' + (t.done ? 'color:#888;text-decoration:line-through' : '') }, [t.text]),
            metaBits.length ? h('div', { class: 'meta', style: 'margin-top:2px;' + (late ? 'color:#c0392b;font-weight:700' : '') }, [metaBits.join(' · ')]) : null,
            t.notes && !t.done ? h('div', { class: 'meta', style: 'margin-top:2px' }, ['📝 ' + t.notes]) : null,
          ]),
        ]));
      });
      if (state.taskView === 'open') {
        const inp = h('input', { type: 'text', class: 'tinput', placeholder: '+ Add a task to this job', style: 'width:100%;margin:8px 0 0' });
        inp.onkeydown = function (e) { if (e.key === 'Enter' && inp.value.trim()) queueTaskOp({ op: 'add', jobId: g.j.jobId, taskId: taskNewId(), text: inp.value.trim(), jobName: g.j.name, customer: g.j.customer }); };
        card.appendChild(inp);
      }
      list.appendChild(card);
    });
    if (!shown.length) list.appendChild(h('div', { class: 'empty' }, [words.length ? 'No tasks match.' : state.taskView === 'open' ? 'Nothing left to do. 👍' : 'Nothing ticked off in the last 2 weeks.']));
  }));
  // add a task to any active job
  if (state.taskView === 'open' && state.jobs && state.jobs.projects) {
    const cust = {}; (state.jobs.customers || []).forEach(function (c) { cust[c.id] = c.name; });
    const active = state.jobs.projects.filter(function (p) { return !p.trashed && (p.lifecycle ? p.lifecycle !== 'billed' : !p.completed); })
      .sort(function (a, b) { return ((cust[a.customerId] || '') + a.name).localeCompare((cust[b.customerId] || '') + b.name); });
    const sel = h('select', { class: 'tinput', style: 'width:100%;margin-bottom:6px', onchange: function (e) { state.taskAddJob = e.target.value; } },
      [h('option', { value: '' }, ['Add a task to another job…'])].concat(active.map(function (p) { return h('option', { value: p.id, selected: state.taskAddJob === p.id ? 'selected' : null }, [(p.name || 'Job') + (cust[p.customerId] ? ' · ' + cust[p.customerId] : '')]); })));
    const txt = h('input', { type: 'text', class: 'tinput', placeholder: 'What has to be done', style: 'width:100%' });
    const go = function () {
      const p = active.find(function (x) { return x.id === state.taskAddJob; });
      if (!p || !txt.value.trim()) return;
      queueTaskOp({ op: 'add', jobId: p.id, taskId: taskNewId(), text: txt.value.trim(), jobName: p.name, customer: cust[p.customerId] || '' });
    };
    txt.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    wrap.appendChild(h('div', { class: 'card', style: 'margin-top:12px' }, [sel, txt, h('button', { class: 'bigbtn', style: 'width:100%;margin-top:8px', onclick: go }, ['+ Add task'])]));
  }
  return wrap;
}

function render() {
  const root = document.getElementById('root');
  root.innerHTML = '';
  const header = h('header', {}, [
    h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:10px' }, [
      h('h1', { style: 'margin:0' }, ['Field App']),
      h('div', { onclick: () => { if (confirm('Sign out of the Field App on this phone?')) signOut(); }, style: 'font-size:11px; color:rgba(255,255,255,.6); cursor:pointer; text-decoration:underline' }, ['Sign out']),
    ]),
    h('div', { class: 'tabs' }, [
      h('div', { class: 'tab' + (state.tab === 'time' ? ' active' : ''), onclick: () => { state.tab = 'time'; render(); } }, ['⏱ Time']),
      h('div', { class: 'tab' + (state.tab === 'tasks' ? ' active' : ''), onclick: () => { state.tab = 'tasks'; render(); } }, ['✓ Tasks']),
      h('div', { class: 'tab' + (state.tab === 'jobs' ? ' active' : ''), onclick: () => { state.tab = 'jobs'; render(); } }, ['Jobs']),
      h('div', { class: 'tab' + (state.tab === 'quotes' ? ' active' : ''), onclick: () => { state.tab = 'quotes'; render(); } }, ['Quotes']),
      h('div', { class: 'tab' + (state.tab === 'materials' ? ' active' : ''), onclick: () => { state.tab = 'materials'; render(); } }, ['📦 Material']),
      h('div', { class: 'tab' + (state.tab === 'camera' ? ' active' : ''), onclick: () => { state.tab = 'camera'; render(); } }, ['Camera']),
    ]),
  ]);
  root.appendChild(header);
  const main = h('main', {}, [
    state.tab === 'time' ? renderTime() : state.tab === 'tasks' ? renderTasks() : state.tab === 'jobs' ? renderJobs() : state.tab === 'quotes' ? renderQuotes() : state.tab === 'materials' ? renderMaterials() : renderCamera(),
  ]);
  root.appendChild(main);
}

function init() {
  if (!getKey()) { showSetup(); return; }
  setAuthCookie(getKey());
  render();
  loadData();
  flushOutbox();
  flushMatOutbox();
  flushTaskOps();
  restoreCrew();
}
init();
</script>
</body>
</html>`
