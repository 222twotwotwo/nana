'use strict';
const CACHE='moyin-shell-v7';
const ASSETS=['/','/index.html','/style.css','/app.js','/store.js','/catalog.js','/music.js','/anime.js','/settings.js','/backup.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('moyin-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(async response=>{
    if(response.ok) {const cache=await caches.open(CACHE);await cache.put(event.request,response.clone());}
    return response;
  }).catch(()=>caches.match(event.request)));
});
