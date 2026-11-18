// Radio Browser: открытый каталог интернет-радиостанций.
const HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];
let hostIdx = 0;
const cache = new Map();

async function get(path, params = {}) {
  const key = path + '?' + new URLSearchParams(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.v;
  for (let i = 0; i < HOSTS.length; i++) {
    const host = HOSTS[(hostIdx + i) % HOSTS.length];
    try {
      const r = await fetch(`${host}/json/${path}?${new URLSearchParams(params)}`);
      if (!r.ok) continue;
      hostIdx = (hostIdx + i) % HOSTS.length;
      const v = await r.json();
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch {
      /* пробуем следующий сервер */
    }
  }
  throw new Error('Каталог радио недоступен');
}

const secure = location.protocol === 'https:';
const canHls = !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl');

function ok(s) {
  const url = s.url_resolved || '';
  if (!url) return false;
  if (secure && !url.startsWith('https:')) return false;
  if ((s.hls === 1 || /\.m3u8(\?|$)/i.test(url)) && !canHls) return false;
  if (s.lastcheckok === 0) return false;
  return true;
}

export function mapStation(s) {
  const tags = (s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' · ');
  const fav = s.favicon && (!secure || s.favicon.startsWith('https:')) ? s.favicon : '';
  return {
    id: 'rd:' + s.stationuuid,
    src: 'rd',
    stationId: s.stationuuid,
    title: (s.name || '').replace(/\s+/g, ' ').trim(),
    artist: tags || s.country || 'Онлайн-радио',
    album: 'Радио',
    cover: fav,
    url: s.url_resolved,
    duration: 0,
    live: true,
    codec: s.codec,
    bitrate: s.bitrate,
    country: s.countrycode,
  };
}

function prep(list) {
  const seen = new Set();
  return list.filter(ok).map(mapStation).filter((s) => {
    const k = s.title.toLowerCase();
    if (!s.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const base = { hidebroken: 'true', order: 'clickcount', reverse: 'true' };
export const top = (limit = 40) => get('stations/search', { ...base, limit }).then(prep);
export const byTag = (tag, limit = 40) => get('stations/search', { ...base, tag, limit }).then(prep);
export const byCountry = (countrycode, limit = 40) => get('stations/search', { ...base, countrycode, limit }).then(prep);
export const search = (name, limit = 30) => get('stations/search', { ...base, name, limit }).then(prep);

/** Сообщаем каталогу о прослушивании (так просит документация Radio Browser). */
export function click(t) {
  fetch(`${HOSTS[hostIdx]}/json/url/${t.stationId}`).catch(() => {});
}

export const MOODS = [
  { tag: 'pop', name: 'Поп-хиты', c: '#e11d74' },
  { tag: 'hip hop', name: 'Хип-хоп', c: '#7c3aed' },
  { tag: 'dance', name: 'Танцевальное', c: '#0ea5e9' },
  { tag: 'russian', name: 'Русское', c: '#dc2626' },
  { tag: 'rock', name: 'Рок', c: '#991b1b' },
  { tag: 'electronic', name: 'Электроника', c: '#0d9488' },
  { tag: 'lofi', name: 'Lo-fi', c: '#6d28d9' },
  { tag: 'chillout', name: 'Чилл', c: '#0891b2' },
  { tag: 'house', name: 'Хаус', c: '#c026d3' },
  { tag: 'jazz', name: 'Джаз', c: '#1d4ed8' },
  { tag: '80s', name: '80-е', c: '#be185d' },
  { tag: '90s', name: '90-е', c: '#ea580c' },
  { tag: 'classical', name: 'Классика', c: '#78716c' },
  { tag: 'news', name: 'Новости', c: '#475569' },
];
