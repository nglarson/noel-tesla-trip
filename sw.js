const V='ttp-v22',SHELL=['./','index.html','app.js','planner.js','style.css','manifest.json','sites.json','history.json','leaflet/leaflet.js','leaflet/leaflet.css','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!=V).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
 e.respondWith(fetch(e.request).then(x=>{if(x.ok){const y=x.clone();caches.open(V).then(c=>c.put(e.request,y))}return x}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
