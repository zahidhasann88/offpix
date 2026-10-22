/* offpix service worker (generated at build from build/sw-template.js).
 * 1. Offline: precaches the app shell; caches the ONNX Runtime files on first use.
 *    Models are cached by the app itself (Cache API, sha256-verified), so they pass through.
 * 2. Cross-origin isolation fallback: adds COOP/COEP/CORP headers when the host doesn't,
 *    so threaded WASM works where `_headers` can't be set.
 */
const VERSION = '__VERSION__'
const BASE = '__BASE__'
const PRECACHE = __PRECACHE__
const SHELL_CACHE = `offpix-shell-${VERSION}`
const RUNTIME_CACHE = 'offpix-runtime-v1'
// Static files don't really vary; servers often send `Vary: Origin`, which would make module
// script/CSS requests (sent with an Origin header) miss entries precached without one.
const MATCH = { ignoreVary: true }

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('offpix-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaqueredirect') return res
  const headers = new Headers(res.headers)
  if (!headers.has('Cross-Origin-Embedder-Policy')) headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
  if (!headers.has('Cross-Origin-Opener-Policy')) headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  if (!headers.has('Cross-Origin-Resource-Policy')) headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request, MATCH)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await cache.put(request, res.clone())
  return res
}

async function navigate(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    return (await cache.match(`${BASE}index.html`, MATCH)) || (await cache.match(BASE, MATCH)) || Response.error()
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request).then(withIsolation))
  } else if (path.startsWith(`${BASE}models/`)) {
    // The app streams, verifies and caches models itself.
    return
  } else if (path.startsWith(`${BASE}ort/`)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE).then(withIsolation))
  } else {
    event.respondWith(
      caches.open(SHELL_CACHE)
        .then(c => c.match(request, MATCH))
        .then(hit => hit || fetch(request))
        .then(withIsolation),
    )
  }
})
