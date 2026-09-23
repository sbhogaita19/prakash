// Prakash service worker.
// For every app change: bump CACHE and keep this file's update behaviour intact.
// skipWaiting + clients.claim make a new version take control straight away;
// the page reloads itself once on 'controllerchange' so the new UI shows.
// All same-origin requests revalidate with the server (cheap conditional
// requests), so an update is never hidden behind the HTTP cache.
// Cache cleanup only deletes old Prakash/Sadhana caches and never touches
// localStorage or IndexedDB, so user data survives every update.
const CACHE='prakash-v56-spotify';
const ASSETS=['./','./index.html','./manifest.webmanifest','./prakash-om-favicon.png','./prakash-om-192.png','./prakash-om-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&/^(prakash|sadhana)-/.test(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  const req=new Request(e.request,{cache:'no-cache'});
  e.respondWith(fetch(req).then(r=>{
    if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return r;
  }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
