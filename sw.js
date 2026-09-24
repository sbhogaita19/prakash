// Prakash service worker.
// For every app change: bump CACHE and keep this file's update behaviour intact.
// skipWaiting + clients.claim make a new version take control straight away;
// the page reloads itself once on 'controllerchange' so the new UI shows.
// All same-origin requests revalidate with the server (cheap conditional
// requests), so an update is never hidden behind the HTTP cache. On a weak
// network the saved copy answers after about 2 seconds instead of leaving a
// blank screen; the network response still refreshes the cache when it lands.
// Cache cleanup only deletes old Prakash/Sadhana caches and never touches
// localStorage or IndexedDB, so user data survives every update.
const CACHE='prakash-v72-steady';
const ASSETS=['./','./index.html','./manifest.webmanifest','./prakash-om-favicon.png','./prakash-om-192.png','./prakash-om-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&/^(prakash|sadhana)-/.test(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting();});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const c=cs.find(x=>x.url.indexOf('/prakash/')>=0);
    if(c){ c.focus(); c.postMessage({type:'show-stop'}); return; }
    return clients.openWindow('/prakash/?stop=1');
  }));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  const req=new Request(e.request,{cache:'no-cache'});
  e.respondWith(new Promise(resolve=>{
    let done=false;
    const fromCache=()=>caches.match(e.request).then(r=>r||caches.match('./index.html')).then(r=>{if(r)resolve(r);});
    const timer=setTimeout(()=>{if(!done){done=true;fromCache();}},2000);
    fetch(req).then(r=>{
      if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
      if(!done){done=true;clearTimeout(timer);resolve(r);}
    }).catch(()=>{if(!done){done=true;clearTimeout(timer);fromCache();}});
  }));
});
