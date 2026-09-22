// Prakash service worker.
// For every app change: bump CACHE (e.g. 'prakash-v1') and keep this file's
// update behaviour intact. skipWaiting + clients.claim make a new version take
// control on next open; the page then reloads itself once (it listens for
// 'controllerchange') so the new UI shows without clearing anything.
// Cache cleanup never touches localStorage, so user data survives updates.
const CACHE='prakash-v48-truths';
const ASSETS=['./','./index.html','./manifest.webmanifest','./prakash-favicon.png','./prakash-icon-192.png','./prakash-icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  // Navigations always revalidate (cheap conditional requests on GitHub Pages),
  // so a reopened app can never get stuck on an HTTP-cached stale page.
  // Everything falls back to the offline cache when the network is unavailable.
  const req=e.request.mode==='navigate'?new Request(e.request,{cache:'no-cache'}):e.request;
  e.respondWith(fetch(req).then(r=>{
    const copy=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy));
    return r;
  }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
