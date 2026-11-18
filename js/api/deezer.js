// Deezer: открытый каталог (чарты, поиск, альбомы, артисты) с 30-секундными превью.
// API не отдаёт CORS-заголовки, поэтому запросы идут через JSONP.
import { load, save } from '../store.js';

const cache = new Map();
let seq = 0;

export function dz(path, params = {}, ttl = 5 * 60e3) {
  const key = path + '?' + new URLSearchParams(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.v);
  return new Promise((resolve, reject) => {
    const cb = `__dz${++seq}`;
    const s = document.createElement('script');
    s.src = `https://api.deezer.com/${path}?${new URLSearchParams({ ...params, output: 'jsonp', callback: cb })}`;
    const timer = setTimeout(() => done(new Error('Deezer не отвечает')), 15000);
    function done(err, data) {
      clearTimeout(timer);
      window[cb] = () => {};
      setTimeout(() => delete window[cb], 60000);
      s.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb] = (data) => {
      if (data && data.error) return done(new Error(data.error.message || 'Ошибка Deezer'));
      cache.set(key, { t: Date.now(), v: data });
      done(null, data);
    };
    s.onerror = () => done(new Error('Нет связи с Deezer'));
    document.head.append(s);
  });
}

const coverUrl = (md5, size) => (md5 ? `https://cdn-images.dzcdn.net/images/cover/${md5}/${size}x${size}-000000-80-0-0.jpg` : '');

export function mapTrack(t, album) {
  const al = t.album || album || {};
  const md5 = al.md5_image || t.md5_image;
  return {
    id: 'dz:' + t.id,
    src: 'dz',
    dzId: t.id,
    title: t.title || t.title_short || '',
    titleShort: t.title_short || t.title || '',
    artist: t.artist?.name || '',
    artistId: t.artist?.id,
    album: al.title || '',
    albumId: al.id,
    cover: al.cover_medium || coverUrl(md5, 250),
    coverBig: al.cover_xl || al.cover_big || coverUrl(md5, 1000),
    duration: t.duration || 0,
    explicit: !!t.explicit_lyrics,
    preview: t.preview || '',
    previewAt: Date.now(),
  };
}
export const mapAlbum = (a) => ({
  type: 'album', id: a.id, title: a.title, artist: a.artist?.name || '', artistId: a.artist?.id,
  cover: a.cover_medium, coverBig: a.cover_xl || a.cover_big, year: (a.release_date || '').slice(0, 4),
  recordType: a.record_type, nb: a.nb_tracks, explicit: !!a.explicit_lyrics,
});
export const mapArtist = (a) => ({
  type: 'artist', id: a.id, name: a.name, picture: a.picture_medium, pictureBig: a.picture_xl || a.picture_big, fans: a.nb_fan,
});
export const mapPlaylist = (p) => ({
  type: 'playlist', id: p.id, title: p.title, cover: p.picture_medium, coverBig: p.picture_xl || p.picture_big,
  nb: p.nb_tracks, by: p.user?.name || p.creator?.name || '',
});

const playable = (t) => t.readable !== false;

export const chartTracks = (genre = 0, limit = 100) =>
  dz(`chart/${genre}/tracks`, { limit }).then((r) => r.data.filter(playable).map((t) => mapTrack(t)));
export const chartAlbums = (genre = 0, limit = 30) => dz(`chart/${genre}/albums`, { limit }).then((r) => r.data.map(mapAlbum));
export const chartArtists = (genre = 0, limit = 30) => dz(`chart/${genre}/artists`, { limit }).then((r) => r.data.map(mapArtist));
export const chartPlaylists = (genre = 0, limit = 20) => dz(`chart/${genre}/playlists`, { limit }).then((r) => r.data.map(mapPlaylist));

export async function playlist(id) {
  const p = await dz(`playlist/${id}`);
  let tracks = p.tracks?.data || [];
  // длинные плейлисты догружаем страницами (до 500 треков)
  let index = tracks.length;
  while (index < Math.min(p.nb_tracks || 0, 500)) {
    const more = await dz(`playlist/${id}/tracks`, { index, limit: 100 });
    if (!more.data?.length) break;
    tracks = tracks.concat(more.data);
    index += more.data.length;
  }
  return {
    ...mapPlaylist(p),
    description: p.description || '',
    fans: p.fans,
    tracks: tracks.filter(playable).map((t) => mapTrack(t)),
  };
}

export async function album(id) {
  const a = await dz(`album/${id}`);
  const al = { id: a.id, title: a.title, cover_medium: a.cover_medium, cover_xl: a.cover_xl, md5_image: a.md5_image };
  return {
    ...mapAlbum(a),
    label: a.label,
    date: a.release_date,
    genres: (a.genres?.data || []).map((g) => g.name),
    tracks: (a.tracks?.data || []).filter(playable).map((t) => mapTrack({ ...t, artist: t.artist || a.artist }, al)),
  };
}

export async function artist(id) {
  const [a, top, albums, related] = await Promise.all([
    dz(`artist/${id}`),
    dz(`artist/${id}/top`, { limit: 50 }),
    dz(`artist/${id}/albums`, { limit: 60 }),
    dz(`artist/${id}/related`, { limit: 20 }).catch(() => ({ data: [] })),
  ]);
  return {
    ...mapArtist(a),
    nbAlbum: a.nb_album,
    top: top.data.filter(playable).map((t) => mapTrack(t)),
    albums: albums.data.map(mapAlbum),
    related: related.data.map(mapArtist),
  };
}

const MAPPERS = { track: mapTrack, artist: mapArtist, album: mapAlbum, playlist: mapPlaylist };
export function search(q, type = 'track', limit = 25) {
  return dz(type === 'track' ? 'search' : `search/${type}`, { q, limit }).then((r) =>
    (type === 'track' ? r.data.filter(playable) : r.data).map((x) => MAPPERS[type](x)),
  );
}

/** Ссылка на превью живёт ~20 минут: перед проигрыванием берём свежую. */
export async function freshPreview(t, force = false) {
  if (!force && t.preview && t.previewAt && Date.now() - t.previewAt < 8 * 60e3) return t.preview;
  const r = await dz(`track/${t.dzId}`, {}, 0);
  t.preview = r.preview || '';
  t.previewAt = Date.now();
  return t.preview;
}
export const hasFreshPreview = (t) => !!(t.preview && t.previewAt && Date.now() - t.previewAt < 8 * 60e3);

/**
 * Ищет свежий пользовательский плейлист этого года (например «Топ 100 Россия 2026»).
 * Выбор запоминается на 3 дня.
 */
export async function findYearPlaylist(slot, queries) {
  const year = new Date().getFullYear();
  const saved = load('yp:' + slot, null);
  if (saved && saved.year === year && Date.now() - saved.at < 3 * 864e5) return saved.id;
  const lists = await Promise.all(queries.map((q) => search(q.replace('{year}', year), 'playlist', 15).catch(() => [])));
  const seen = new Set();
  const cand = lists.flat().filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return p.title.includes(String(year)) && p.nb >= 30 && p.nb <= 400;
  });
  cand.sort((a, b) => scoreYear(b) - scoreYear(a));
  const id = cand[0]?.id || lists.flat()[0]?.id;
  if (id) save('yp:' + slot, { id, year, at: Date.now() });
  return id;
}
const scoreYear = (p) => (/топ|top|хит|hit/i.test(p.title) ? 200 : 0) + Math.min(p.nb, 150);

export const GENRES = [
  { id: 132, name: 'Поп', c: '#e11d74' },
  { id: 116, name: 'Рэп и хип-хоп', c: '#7c3aed' },
  { id: 113, name: 'Танцевальная', c: '#0ea5e9' },
  { id: 165, name: 'R&B', c: '#c2410c' },
  { id: 152, name: 'Рок', c: '#b91c1c' },
  { id: 106, name: 'Электроника', c: '#0d9488' },
  { id: 85, name: 'Альтернатива', c: '#4d7c0f' },
  { id: 197, name: 'Латино', c: '#d97706' },
  { id: 464, name: 'Метал', c: '#3f3f46' },
  { id: 144, name: 'Регги', c: '#15803d' },
  { id: 129, name: 'Джаз', c: '#1d4ed8' },
  { id: 169, name: 'Соул и фанк', c: '#9333ea' },
  { id: 98, name: 'Классика', c: '#78716c' },
  { id: 173, name: 'Кино и игры', c: '#be123c' },
  { id: 16, name: 'Азиатская', c: '#db2777' },
  { id: 84, name: 'Кантри', c: '#a16207' },
];
export const genreName = (id) => (Number(id) === 0 ? 'Все жанры' : GENRES.find((g) => g.id === Number(id))?.name || 'Жанр');

export const COUNTRIES = [
  { id: 3155776842, name: 'Мир', flag: '🌍' },
  { id: 1313621735, name: 'США', flag: '🇺🇸' },
  { id: 1111142221, name: 'Великобритания', flag: '🇬🇧' },
  { id: 1362526495, name: 'Украина', flag: '🇺🇦' },
  { id: 1111143121, name: 'Германия', flag: '🇩🇪' },
  { id: 1109890291, name: 'Франция', flag: '🇫🇷' },
  { id: 1116189071, name: 'Турция', flag: '🇹🇷' },
  { id: 1266972311, name: 'Польша', flag: '🇵🇱' },
  { id: 1362510315, name: 'Южная Корея', flag: '🇰🇷' },
  { id: 1362508955, name: 'Япония', flag: '🇯🇵' },
  { id: 1111141961, name: 'Бразилия', flag: '🇧🇷' },
  { id: 1116190041, name: 'Испания', flag: '🇪🇸' },
  { id: 1116187241, name: 'Италия', flag: '🇮🇹' },
  { id: 1111142361, name: 'Мексика', flag: '🇲🇽' },
];
