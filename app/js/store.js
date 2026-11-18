// Всё, что приложение помнит: настройки, «нравится», плейлисты, история, станции.
// Хранится в localStorage этого браузера.
import { uid } from './util.js';

const P = 'pulse:';
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export function on(type, fn) {
  const f = (e) => fn(e.detail);
  bus.addEventListener(type, f);
  return () => bus.removeEventListener(type, f);
}

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
  } catch (e) {
    console.warn('Не удалось сохранить', key, e);
  }
}

/* ---------- настройки ---------- */
export const settings = Object.assign(
  { theme: 'dark', accent: 'violet', ytKey: '', fullMode: true, volume: 0.85, muted: false },
  load('settings', {}),
);
export function setSettings(patch) {
  Object.assign(settings, patch);
  save('settings', settings);
  emit('settings', patch);
}

/** Трек без временных полей (ссылки превью Deezer живут ~20 минут). */
export function clean(t) {
  const { preview, previewAt, ...rest } = t;
  return rest;
}

/* ---------- «Нравится» ---------- */
let likes = load('likes', []);
let likeIds = new Set(likes.map((t) => t.id));
export const getLikes = () => likes;
export const isLiked = (id) => likeIds.has(id);
export function toggleLike(t) {
  if (likeIds.has(t.id)) likes = likes.filter((x) => x.id !== t.id);
  else likes = [{ ...clean(t), likedAt: Date.now() }, ...likes];
  likeIds = new Set(likes.map((x) => x.id));
  save('likes', likes);
  const liked = likeIds.has(t.id);
  emit('likes', { id: t.id, liked });
  return liked;
}

/* ---------- Плейлисты ---------- */
let playlists = load('playlists', []);
const savePl = () => {
  save('playlists', playlists);
  emit('playlists');
};
export const getPlaylists = () => playlists;
export const getPlaylist = (id) => playlists.find((p) => p.id === id);
export function createPlaylist(name, tracks = []) {
  const p = { id: uid().slice(0, 12), name: name.trim() || 'Новый плейлист', created: Date.now(), updated: Date.now(), tracks: tracks.map(clean) };
  playlists = [p, ...playlists];
  savePl();
  return p;
}
export function renamePlaylist(id, name) {
  const p = getPlaylist(id);
  if (!p) return;
  p.name = name.trim() || p.name;
  p.updated = Date.now();
  savePl();
}
export function deletePlaylist(id) {
  playlists = playlists.filter((p) => p.id !== id);
  savePl();
}
/** Добавляет треки, пропуская те, что уже есть. Возвращает число добавленных. */
export function addToPlaylist(id, tracks) {
  const p = getPlaylist(id);
  if (!p) return 0;
  const have = new Set(p.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id)).map(clean);
  p.tracks.push(...fresh);
  p.updated = Date.now();
  savePl();
  return fresh.length;
}
export function removeFromPlaylist(id, index) {
  const p = getPlaylist(id);
  if (!p) return;
  p.tracks.splice(index, 1);
  p.updated = Date.now();
  savePl();
}
export function moveInPlaylist(id, from, to) {
  const p = getPlaylist(id);
  if (!p || from === to) return;
  const [t] = p.tracks.splice(from, 1);
  p.tracks.splice(to, 0, t);
  p.updated = Date.now();
  savePl();
}

/* ---------- История прослушиваний ---------- */
let history = load('history', []);
export const getHistory = () => history;
export function pushHistory(t) {
  history = [{ ...clean(t), playedAt: Date.now() }, ...history].slice(0, 400);
  save('history', history);
  emit('history');
}
export function clearHistory() {
  history = [];
  save('history', history);
  emit('history');
}
/** Самые частые треки по истории. */
export function topPlayed(limit = 20) {
  const count = new Map();
  for (const t of history) {
    const c = count.get(t.id) || { t, n: 0 };
    c.n++;
    count.set(t.id, c);
  }
  return [...count.values()].filter((c) => c.n > 1).sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.t);
}

/* ---------- Избранные станции ---------- */
let stations = load('stations', []);
export const getStations = () => stations;
export const isStationFav = (id) => stations.some((s) => s.id === id);
export function toggleStation(s) {
  if (isStationFav(s.id)) stations = stations.filter((x) => x.id !== s.id);
  else stations = [clean(s), ...stations];
  save('stations', stations);
  emit('stations');
  return isStationFav(s.id);
}

/* ---------- Недавние поиски ---------- */
let searches = load('searches', []);
export const getSearches = () => searches;
export function addSearch(q) {
  q = q.trim();
  if (!q) return;
  searches = [q, ...searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  save('searches', searches);
}
export function clearSearches() {
  searches = [];
  save('searches', searches);
}

/* ---------- Резервная копия ---------- */
export function exportAll() {
  const { ytKey, ...s } = settings;
  return { app: 'pulse', version: 1, exportedAt: new Date().toISOString(), settings: s, likes, playlists, history, stations };
}
export function importAll(data) {
  if (!data || data.app !== 'pulse') throw new Error('Это не файл резервной копии Pulse');
  if (Array.isArray(data.likes)) { likes = data.likes; likeIds = new Set(likes.map((t) => t.id)); save('likes', likes); }
  if (Array.isArray(data.playlists)) { playlists = data.playlists; save('playlists', playlists); }
  if (Array.isArray(data.history)) { history = data.history; save('history', history); }
  if (Array.isArray(data.stations)) { stations = data.stations; save('stations', stations); }
  if (data.settings) setSettings({ ...data.settings, ytKey: settings.ytKey });
  emit('likes', {});
  emit('playlists');
  emit('stations');
  emit('history');
}
