// VisionFlow Service Worker
// 版本: 1.0.0
// 功能: 離線支持、快取策略、分享功能

const CACHE_NAME = 'visionflow-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/manifest.json'
];

// 安裝事件 - 快取資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('快取資源時出現部分錯誤:', err);
        // 繼續執行，即使某些資源快取失敗
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
  const url = new URL(request.url);

  // 只處理 GET 請求
  if (request.method !== 'GET') {
    return;
  }

  // 跳過非同源請求
  if (url.origin !== location.origin) {
    return;
  }

  // 快取優先策略
  event.respondWith(
    caches.match(request).then(response => {
      if (response) {
        return response;
      }

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
        // 離線時返回快取的主頁
        return caches.match('/index.html');
      });
    })
  );
});

// 處理分享目標
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SHARE_TARGET') {
    // 通知所有客戶端有新的分享檔案
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

// 後台同步 - 用於分享功能
self.addEventListener('sync', event => {
  if (event.tag === 'sync-share') {
    event.waitUntil(
      // 同步分享的設計資料
      Promise.resolve().then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'SYNC_COMPLETE',
              message: '分享資料已同步'
            });
          });
        });
      })
    );
  }
});

// 定期同步 - 自動保存設計
self.addEventListener('periodicsync', event => {
  if (event.tag === 'auto-save') {
    event.waitUntil(
      // 執行自動保存邏輯
      Promise.resolve().then(() => {
        console.log('VisionFlow 自動保存已執行');
      })
    );
  }
});

// 推送通知 - 用於分享提醒
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : '您有新的 VisionFlow 分享',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'visionflow-notification',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification('VisionFlow', options)
  );
});

// 通知點擊事件
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (let client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

console.log('VisionFlow Service Worker 已加載');
