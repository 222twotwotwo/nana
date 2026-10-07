'use strict';
const CACHE='moyin-shell-v10';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/index.html'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('moyin-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(async res=>{
    if(res.ok&&url.pathname!=='/'){const c=await caches.open(CACHE);await c.put(e.request,res.clone());}
    return res;
  }).catch(()=>caches.match(e.request)));
});
