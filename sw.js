// Service worker: приложение открывается даже без сервера и без интернета,
// а обложки кэшируются, чтобы библиотека листалась быстро.
const VERSION = 'pulse-v3';
const SHELL = `${VERSION}-shell`;
const IMAGES = `${VERSION}-img`;
const FONTS = `${VERSION}-fonts`;
const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/main.js', './js/util.js', './js/store.js', './js/idb.js', './js/color.js', './js/local.js',
  './js/player.js', './js/ui.js', './js/bar.js', './js/np.js', './js/theme.js', './js/pwa.js', './js/offline.js',
  './js/api/deezer.js', './js/api/audius.js', './js/api/radio.js', './js/api/youtube.js', './js/api/lyrics.js',
  './js/views/home.js', './js/views/search.js', './js/views/radio.js', './js/views/library.js',
  './js/views/pages.js', './js/views/settings.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
];
const IMAGE_HOSTS = ['dzcdn.net', 'audius', 'open-audio', 'theblueprint.xyz', 'monophonic.digital', 'staked.cloud', 'ytimg.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Своё приложение: сначала сеть (всегда свежая версия), без сети берём из кэша.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Шрифты Google: из кэша, если уже есть.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(FONTS, req, 50));
    return;
  }

  // Обложки: из кэша, иначе из сети с сохранением.
  if (req.destination === 'image' && IMAGE_HOSTS.some((h) => url.hostname.includes(h))) {
    e.respondWith(cacheFirst(IMAGES, req, 600));
  }
  // Всё остальное (API, аудио, радио) идёт напрямую в сеть.
});

async function cacheFirst(name, req, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      cache.put(req, res.clone());
      trim(cache, max);
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
