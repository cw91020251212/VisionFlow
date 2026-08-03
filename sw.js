// VisionFlow Service Worker
// 版本: 1.0.2
// 功能: 離線支持、快取策略、分享功能 (修復相對路徑問題)

const CACHE_NAME = 'visionflow-v1.0.2';
const SCOPE = self.registration.scope; // e.g. https://cw91020251212.github.io/VisionFlow/
const URLS = {
  root: new URL('./', SCOPE).toString(),
  index: new URL('./index.html', SCOPE).toString(),
  icon: new URL('./icon.png', SCOPE).toString(),
  icon192: new URL('./icon-192.png', SCOPE).toString(),
  icon512: new URL('./icon-512.png', SCOPE).toString(),
  apple: new URL('./apple-touch-icon.png', SCOPE).toString(),
  manifest: new URL('./manifest.json', SCOPE).toString(),
};

const ASSETS_TO_CACHE = [
  URLS.root,
  URLS.index,
  URLS.icon,
  URLS.icon192,
  URLS.icon512,
  URLS.apple,
  URLS.manifest,
];

// 安裝事件 - 快取資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('快取資源時出現部分錯誤:', err);
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// 激活事件 - 清理舊快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 攔截請求 - 快取優先策略
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // 只處理 GET 請求
  if (request.method !== 'GET') return;

  // 快取優先策略
  event.respondWith(
    caches.match(request).then(response => {
      if (response) return response;

      return fetch(request).then(response => {
        // 檢查是否有效的響應
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // 複製響應以便快取
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });

        return response;
      }).catch(() => {
        // 離線時嘗試返回快取的首頁
        return caches.match(URLS.index);
      });
    })
  );
});

// 處理分享目標
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SHARE_TARGET') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'SHARE_RECEIVED',
          data: event.data.payload
        });
      });
    });
  }
});

console.log('VisionFlow Service Worker (v1.0.2) 已加載');
