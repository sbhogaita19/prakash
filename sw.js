// Prakash service worker. For every release: change CACHE to match VERSION in index.html.
// Network first with a 2-second fallback to the saved copy, so updates show quickly and
// a weak signal never leaves a blank screen. Only old Prakash caches are removed;
// localStorage and IndexedDB (your data) are never touched.
const CACHE = 'prakash-1.2.1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './prakash-om-favicon.png', './prakash-om-192.png', './prakash-om-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && /^(prakash|sadhana)-/.test(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const scope = self.registration.scope;
    const c = cs.find(x => x.url.startsWith(scope));
    if (c) { c.focus(); c.postMessage({ type: 'show-stop' }); return; }
    return clients.openWindow(scope + '?stop=1');
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate';
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const fromCache = () => caches.match(req, { ignoreSearch: isPage })
      .then(r => r || (isPage ? caches.match('./index.html') : null))
      .then(r => r || null);
    const timer = setTimeout(() => fromCache().then(r => { if (r) finish(r); }), 2000);
    fetch(new Request(req, { cache: 'no-cache' })).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(isPage ? './index.html' : req, copy)); }
      clearTimeout(timer); finish(r);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(r => finish(r || (isPage ? new Response('<h1>Offline</h1><p>Open Prakash once while online, then it works offline.</p>', { headers: { 'Content-Type': 'text/html' } }) : Response.error())));
    });
  }));
});
