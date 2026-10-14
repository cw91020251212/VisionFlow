// VisionFlow static application cache. Imported projects are never cached here.
const CACHE_NAME = 'visionflow-phase2-v4';
const SCOPE = self.registration.scope;
const APP_FILES = ['./', './index.html', './appearance.js', './folder-import.js', './canvas.js', './project-io.js', './workspace-state.js', './icon.png', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './manifest.json'];
const APP_URLS = APP_FILES.map(path => new URL(path, SCOPE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('visionflow-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !APP_URLS.includes(event.request.url)) return;
  // App code is network-first, avoiding stale HTML paired with older JavaScript.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SHARE_TARGET') {
    event.waitUntil(self.clients.matchAll().then(clients => clients.forEach(client => client.postMessage({type:'SHARE_RECEIVED',data:event.data.payload}))));
  }
});
