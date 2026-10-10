// 极简 Service Worker：把游戏的全部文件缓存下来，装成应用后离线可玩。
// 缓存列表就是 index.html 引用的那几个文件 + 图标。
const CACHE = 'deepvein-v1';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './src/core.js', './src/relics.js', './src/achievements.js',
  './src/pixfont.js', './src/art.js', './src/audio.js', './src/app.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 页面发现新版本时会发这条消息，让新 SW 立刻接管（页面随后提示玩家刷新）
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
