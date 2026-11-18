// Офлайн: треки Audius можно скачать в память браузера и слушать без интернета.
// Хиты Deezer и YouTube сохранять нельзя: это запрещают их правила.
import { idbGet, idbPut, idbDel } from './idb.js';
import { load, save, emit, clean } from './store.js';
import { streamUrl } from './api/audius.js';

let list = load('offline', []);
let ids = new Set(list.map((t) => t.id));
const urls = new Map(); // id -> ссылка на аудио в памяти
const coverUrls = new Map(); // id -> ссылка на обложку в памяти
const busy = new Map(); // id -> идущая загрузка

export const canOffline = (t) => t?.src === 'au';
export const isOffline = (id) => ids.has(id);
export const isDownloading = (id) => busy.has(id);
export const getOffline = () => list;
export const offlineUrlSync = (t) => urls.get(t.id) || null;
export const offlineCover = (id) => coverUrls.get(id) || '';
export const offlineBytes = () => list.reduce((s, t) => s + (t.size || 0), 0);

export async function offlineUrl(t) {
  if (urls.has(t.id)) return urls.get(t.id);
  const blob = await idbGet('offline', t.id).catch(() => null);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(t.id, u);
  return u;
}

/** При запуске готовим ссылки заранее: так iPhone разрешает включить трек сразу по нажатию. */
export async function warmOffline() {
  for (const t of list) {
    try {
      const blob = await idbGet('offline', t.id);
      if (blob) urls.set(t.id, URL.createObjectURL(blob));
      const c = await idbGet('covers', 'off:' + t.id);
      if (c) coverUrls.set(t.id, URL.createObjectURL(c));
    } catch { /* пропускаем битую запись */ }
  }
}

export function download(t, onProgress) {
  if (!canOffline(t)) return Promise.reject(new Error('Этот трек нельзя сохранить'));
  if (ids.has(t.id)) return Promise.resolve();
  if (busy.has(t.id)) return busy.get(t.id);
  const job = (async () => {
    const r = await fetch(streamUrl(t));
    if (!r.ok) throw new Error('Audius не отдал трек (' + r.status + ')');
    const total = Number(r.headers.get('content-length')) || 0;
    let blob;
    if (r.body && total && onProgress) {
      const reader = r.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(got / total);
      }
      blob = new Blob(chunks, { type: r.headers.get('content-type') || 'audio/mpeg' });
    } else {
      blob = await r.blob();
    }
    if (blob.size < 1000) throw new Error('Пустой файл');
    await idbPut('offline', t.id, blob);
    const cover = t.coverBig || t.cover;
    if (cover && !cover.startsWith('blob:')) {
      try {
        const cr = await fetch(cover);
        if (cr.ok) {
          const cb = await cr.blob();
          await idbPut('covers', 'off:' + t.id, cb);
          coverUrls.set(t.id, URL.createObjectURL(cb));
        }
      } catch { /* без обложки тоже играет */ }
    }
    urls.set(t.id, URL.createObjectURL(blob));
    list = [{ ...clean(t), size: blob.size, savedAt: Date.now() }, ...list.filter((x) => x.id !== t.id)];
    ids = new Set(list.map((x) => x.id));
    save('offline', list);
    navigator.storage?.persist?.().catch(() => {});
    emit('offline', { id: t.id });
  })();
  busy.set(t.id, job);
  emit('offline', { id: t.id });
  return job.finally(() => {
    busy.delete(t.id);
    emit('offline', { id: t.id });
  });
}

export async function removeOffline(id) {
  await idbDel('offline', id).catch(() => {});
  await idbDel('covers', 'off:' + id).catch(() => {});
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
  coverUrls.delete(id);
  list = list.filter((x) => x.id !== id);
  ids = new Set(list.map((x) => x.id));
  save('offline', list);
  emit('offline', { id });
}

/** Скачивает все подходящие треки списка по очереди. */
export async function downloadMany(tracks, onStep) {
  const todo = tracks.filter((t) => canOffline(t) && !isOffline(t.id));
  let done = 0, failed = 0;
  for (const t of todo) {
    try {
      await download(t);
      done++;
    } catch {
      failed++;
    }
    onStep?.(done + failed, todo.length);
  }
  return { done, failed, total: todo.length };
}
