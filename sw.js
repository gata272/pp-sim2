const CACHE_NAME = 'puyo-sim-v3';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './online.css',
    './puyoSim.js',
    './puyoAI.js',
    './puyo-ai-worker.js',
    './puyoAI_wasm.mjs',
    './puyoAI_wasm.wasm',
    './online.js',
    './manifest.json',
    './apple-touch-icon.png',
    './android-icon-192x192.png',
    './android-icon-512x512.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                return cache.addAll(urlsToCache);
            })
            .catch(function (error) {
                console.log('Cache addAll failed:', error);
            })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (cacheNames) {
            return Promise.all(
                cacheNames.map(function (cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(function (response) {
            if (response) return response;

            return fetch(event.request).then(function (networkResponse) {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            }).catch(function () {
                return new Response('Network error happened', {
                    status: 408,
                    headers: new Headers({ 'Content-Type': 'text/plain' })
                });
            });
        })
    );
});