// Only the editor shell is cached; imported files and user designs are never stored here.
const APP_VERSION = 'toolbar-scroll-v1';
const SCOPE = self.registration.scope;
const CACHE_PREFIX = 'visionflow-app:' + encodeURIComponent(SCOPE) + ':';
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const APP_FILES = ['index.html', 'appearance.js', 'folder-import.js', 'canvas.js', 'project-io.js', 'workspace-state.js', 'pointer-tools.js', 'delivery.js', 'background-image.js', 'maintenance.js', 'toolbar-scroll.js', 'icon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.json'];
const APP_URLS = APP_FILES.map(path => new URL(path, SCOPE).href);

self.addEventListener('install', event => {
  // addAll commits only after every resource succeeds. Never update a live cache in place.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_URLS.map(url => new Request(url, {cache:'reload'})))));
  // No skipWaiting: a newer complete shell waits while an old editor is in use.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))));
  // No clients.claim: first install doesn't take over a half-loaded page.
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== new URL(SCOPE).origin) return;
  url.search = ''; url.hash = '';
  const canonical = url.href === SCOPE ? new URL('index.html', SCOPE).href : url.href;
  if (!APP_URLS.includes(canonical)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const response = await cache.match(canonical);
    // Never silently serve new network scripts alongside this cached HTML.
    return response || new Response('Editor cache incomplete. Reconnect and update the editor.', {status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  }));
});
async function editorWindowClients() {
  const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  return windows.filter(client => {
    try { const url=new URL(client.url); return url.origin===new URL(SCOPE).origin && [SCOPE,new URL('index.html',SCOPE).href].includes(url.origin+url.pathname); }
    catch { return false; }
  });
}
self.addEventListener('message', event => {
  if (event.data?.type === 'VF_MAINTENANCE_CHECK') {
    event.waitUntil(editorWindowClients().then(clients => event.ports[0]?.postMessage({type:'VF_EDITOR_CLIENT_COUNT',count:clients.length})));
    return;
  }
  if (event.data?.type !== 'VF_ACTIVATE_UPDATE') return;
  event.waitUntil((async () => {
    const editorWindows = await editorWindowClients();
    if (editorWindows.length > 1) {
      event.source?.postMessage({type:'VF_UPDATE_BLOCKED',message:'請先關閉其他 VisionFlow 分頁，再更新；未刷新其他分頁或清除草稿。'});
      return;
    }
    event.source?.postMessage({type:'VF_UPDATE_ACTIVATING'});
    await self.skipWaiting();
  })());
});
