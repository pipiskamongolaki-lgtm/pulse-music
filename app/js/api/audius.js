// Audius: открытая музыкальная платформа, треки играют целиком и легально.
const BASE = 'https://api.audius.co/v1';
const APP = 'pulse_music_app';

async function get(path, params = {}) {
  const r = await fetch(`${BASE}/${path}?${new URLSearchParams({ ...params, app_name: APP })}`);
  if (!r.ok) throw new Error('Audius недоступен (' + r.status + ')');
  return (await r.json()).data || [];
}

const streamable = (t) => t && t.is_streamable !== false && !t.stream_conditions && t.access?.stream !== false && !t.is_delete;

export function mapTrack(t) {
  return {
    id: 'au:' + t.id,
    src: 'au',
    auId: t.id,
    title: (t.title || '').trim(),
    artist: t.user?.name || '',
    album: 'Audius',
    cover: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
    coverBig: t.artwork?.['1000x1000'] || t.artwork?.['480x480'] || '',
    duration: t.duration || 0,
    genre: t.genre || '',
    link: t.permalink ? 'https://audius.co' + t.permalink : '',
  };
}

export const trending = ({ genre, time = 'week', limit = 50 } = {}) =>
  get('tracks/trending', { limit, time, ...(genre ? { genre } : {}) }).then((d) => d.filter(streamable).map(mapTrack));

export const search = (query, limit = 20) =>
  get('tracks/search', { query, limit }).then((d) => d.filter(streamable).map(mapTrack));

export const streamUrl = (t) => `${BASE}/tracks/${t.auId}/stream?app_name=${APP}`;

export const AUDIUS_GENRES = [
  { id: '', name: 'Всё' },
  { id: 'Electronic', name: 'Электроника' },
  { id: 'Hip-Hop/Rap', name: 'Хип-хоп' },
  { id: 'Pop', name: 'Поп' },
  { id: 'House', name: 'Хаус' },
  { id: 'Lo-Fi', name: 'Lo-fi' },
  { id: 'R&B/Soul', name: 'R&B' },
  { id: 'Techno', name: 'Техно' },
  { id: 'Alternative', name: 'Альтернатива' },
];
