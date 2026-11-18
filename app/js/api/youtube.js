// Полные треки через официальный встроенный плеер YouTube.
// Нужен твой бесплатный ключ YouTube Data API (вставляется в Настройках).
// Видео всегда видно на экране: так требуют правила YouTube.
import { settings, load, save } from '../store.js';

const API = 'https://www.googleapis.com/youtube/v3';
let map = load('ytmap', {});

export const hasKey = () => !!(settings.ytKey || '').trim();
export const fullEnabled = () => settings.fullMode && hasKey();

async function api(path, params, key = settings.ytKey) {
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: (key || '').trim() })}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason || j.error?.status || `HTTP ${r.status}`;
    const e = new Error(reason);
    e.reason = reason;
    throw e;
  }
  return j;
}

export function explain(e) {
  const r = e?.reason || e?.message || '';
  if (/quota/i.test(r)) return 'Дневной лимит YouTube исчерпан, до завтра играют превью';
  if (/keyInvalid|API_KEY_INVALID|badRequest|INVALID_ARGUMENT/i.test(r)) return 'Ключ YouTube не подходит, проверь его в Настройках';
  if (/accessNotConfigured|SERVICE_DISABLED|forbidden|PERMISSION_DENIED/i.test(r)) return 'В Google Cloud не включён YouTube Data API v3';
  if (/Failed to fetch|NetworkError|Load failed/i.test(r)) return 'YouTube недоступен из этой сети';
  return 'YouTube не ответил: ' + r;
}

export async function testKey(key) {
  await api('search', { part: 'id', q: 'music', maxResults: 1, type: 'video' }, key);
  return true;
}

const norm = (s) => (s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/\b(feat|ft)\b\.?/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();
const isoDur = (d) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};
const BAD = ['live', 'cover', 'karaoke', 'instrumental', 'slowed', 'sped up', 'speed up', 'nightcore', 'reverb', 'remix', 'минус', 'кавер', 'караоке', 'концерт', 'reaction', '8d', 'bass boosted', 'tutorial', 'lesson'];

/** Возвращает id видео по треку, лучшие первыми. Результат запоминается навсегда. */
export async function findVideos(t) {
  if (map[t.id]?.length) return map[t.id];
  const title = t.titleShort || t.title;
  const q = `${t.artist} ${title}`;
  let res = await api('search', { part: 'snippet', type: 'video', maxResults: 8, q, videoEmbeddable: 'true', videoCategoryId: '10' });
  if (!res.items?.length) res = await api('search', { part: 'snippet', type: 'video', maxResults: 8, q, videoEmbeddable: 'true' });
  const ids = (res.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const info = await api('videos', { part: 'contentDetails,status,snippet', id: ids.join(',') });
  const nt = norm(title);
  const na = norm(t.artist);
  const scored = (info.items || [])
    .filter((v) => v.status?.embeddable !== false)
    .map((v) => {
      const vt = norm(v.snippet.title);
      const ch = v.snippet.channelTitle || '';
      const nch = norm(ch);
      let sc = 0;
      if (nt && vt.includes(nt)) sc += 30;
      if (na && (nch.includes(na) || vt.includes(na))) sc += 20;
      if (/ - topic$/i.test(ch)) sc += 25; // автоматическое «аудио» от лейбла: чистая студийная версия
      if (/vevo/i.test(ch)) sc += 10;
      const d = isoDur(v.contentDetails?.duration);
      if (t.duration) {
        const diff = Math.abs(d - t.duration);
        sc += diff <= 3 ? 25 : diff <= 10 ? 15 : diff <= 30 ? 0 : -25;
      }
      for (const w of BAD) if (vt.includes(w) && !nt.includes(w)) sc -= 22;
      if (d > 900) sc -= 40;
      return { id: v.id, sc };
    })
    .sort((a, b) => b.sc - a.sc);
  const out = scored.map((x) => x.id);
  map[t.id] = out;
  const keys = Object.keys(map);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete map[k];
  save('ytmap', map);
  return out;
}

export function forget(trackId) {
  delete map[trackId];
  save('ytmap', map);
}

let ready;
export function ytReady() {
  if (!ready) {
    ready = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        ready = null;
        reject(new Error('Failed to fetch YouTube player'));
      };
      document.head.append(s);
    });
  }
  return ready;
}
