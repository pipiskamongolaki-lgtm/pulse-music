// Главная: чарты, свежие хиты, альбомы, артисты, Audius, радио и твоё недавнее.
import { h, icon, go } from '../util.js';
import * as dz from '../api/deezer.js';
import * as au from '../api/audius.js';
import * as radio from '../api/radio.js';
import * as yt from '../api/youtube.js';
import { player, coverOf } from '../player.js';
import * as store from '../store.js';
import { art, card, row, shelf, lazyShelf, trackList, stationCard, trackMenu, toast, playActions, emptyState } from '../ui.js';
import { getOffline } from '../offline.js';
import { listLocal } from '../local.js';

const TOP_WORLD = 3155776842;

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Доброй ночи';
  if (hr < 12) return 'Доброе утро';
  if (hr < 18) return 'Добрый день';
  if (hr < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

const uniq = (list) => {
  const seen = new Set();
  return list.filter((t) => !seen.has(t.id) && seen.add(t.id));
};

export const playAlbum = (id) => dz.album(id).then((a) => player.playList(a.tracks, 0)).catch(() => toast('Альбом не загрузился'));
export const playPlaylist = (id) => dz.playlist(id).then((p) => player.playList(p.tracks, 0)).catch(() => toast('Плейлист не загрузился'));
export const playArtist = (id) => dz.dz(`artist/${id}/top`, { limit: 50 }).then((r) => player.playList(r.data.map((t) => dz.mapTrack(t)), 0)).catch(() => toast('Не загрузилось'));

export function trackCard(t, list, i) {
  const c = card({
    cover: coverOf(t), title: t.title, sub: t.artist, ic: t.src === 'rd' ? 'radio' : null,
    onClick: () => (player.current?.id === t.id ? player.toggle() : player.playList(list, i)),
    onPlay: () => player.playList(list, i),
    onMenu: (e) => trackMenu(t, { event: e }),
  });
  c.dataset.tid = t.id;
  if (player.current?.id === t.id) c.classList.add('is-playing');
  return c;
}

export const albumCard = (a) => card({ cover: a.cover, title: a.title, sub: [a.year, a.artist].filter(Boolean).join(' · '), href: '#/album/' + a.id, onPlay: () => playAlbum(a.id) });
export const artistCard = (a) => card({ cover: a.picture, title: a.name, sub: 'Исполнитель', round: true, href: '#/artist/' + a.id, onPlay: () => playArtist(a.id) });
export const playlistCard = (p) => card({ cover: p.cover, title: p.title, sub: p.nb ? `${p.nb} треков` : p.by, href: '#/playlist/' + p.id, onPlay: () => playPlaylist(p.id) });

export function countryCard(c) {
  const el = card({ cover: '', title: 'Топ: ' + c.name, sub: 'Чарт Deezer', href: '#/playlist/' + c.id, onPlay: () => playPlaylist(c.id) });
  const ph = el.querySelector('.art-ph');
  ph.textContent = c.flag;
  ph.style.fontSize = '64px';
  return el;
}

export function genreTiles() {
  return h('div.tiles', dz.GENRES.map((g) => h('a.tile', { href: '#/chart/' + g.id, style: { '--c': g.c } }, g.name, h('small', 'Чарт жанра'))));
}

function fullHint() {
  if (yt.hasKey() || store.load('hideFullHint', false)) return null;
  const el = h('div.np-hint', { style: { background: 'var(--surface-2)', color: 'var(--text-2)', marginBottom: '24px', cursor: 'pointer' }, onclick: (e) => { if (!e.target.closest('.x')) go('#/settings'); } },
    icon('sparkle'),
    h('span', { style: { flex: '1' } }, 'Хиты из чартов сейчас играют 30-секундным превью. ', h('b', { style: { color: 'var(--text)' } }, 'Подключи бесплатный ключ YouTube'), ', и они будут играть целиком. Audius, радио и твои файлы уже играют полностью.'),
    h('button.icon-btn.sm.x', { 'aria-label': 'Скрыть', title: 'Скрыть', onclick: () => { store.save('hideFullHint', true); el.remove(); } }, icon('close')));
  return el;
}

function hero() {
  const mosaic = h('div.hero-mosaic');
  let tracks = null;
  const load = () => dz.playlist(TOP_WORLD).then((p) => (tracks = p.tracks));
  const el = h('div.hero',
    mosaic,
    h('div.hero-kicker', icon('fire'), 'Чарт дня'),
    h('h2', 'Топ мира'),
    h('p', 'Сто самых популярных треков планеты прямо сейчас'),
    h('div.hero-actions',
      h('button.btn.primary', { onclick: async () => { if (!tracks) await load().catch(() => toast('Чарт не загрузился')); if (tracks) player.playList(tracks, 0); } }, icon('play'), 'Слушать'),
      h('a.btn', { href: '#/playlist/' + TOP_WORLD }, 'Открыть')));
  load().then((list) => {
    const covers = [...new Set(list.map((t) => t.cover).filter(Boolean))].slice(0, 9);
    mosaic.replaceChildren(...covers.map((c, i) => art(c, String(i))));
  }).catch(() => {});
  return el;
}

/** Главная без интернета: только то, что играет офлайн. */
function offlineHome(view) {
  view.append(
    h('div.page-head', h('h1', 'Без интернета'),
      h('a.icon-btn.mobile-only', { href: '#/settings', title: 'Настройки', 'aria-label': 'Настройки' }, icon('settings'))),
    h('div.offline-banner', icon('offline'), h('span', h('b', 'Нет подключения. '), 'Здесь то, что играет офлайн: скачанные треки и твои файлы. Когда интернет вернётся, главная обновится сама.')));
  const off = getOffline();
  if (off.length) view.append(shelf('Скачанные', { ic: 'downloaded' }, playActions(off), trackList(off)));
  const localBox = h('div');
  view.append(localBox);
  listLocal().then((l) => {
    if (l.length) localBox.replaceChildren(shelf('Мои файлы', { ic: 'folder' }, playActions(l), trackList(l)));
    else if (!off.length) localBox.replaceChildren(emptyState('offline', 'Пока нечего слушать офлайн', 'Когда будет интернет, скачай треки Audius через «…» → «Скачать для офлайна» или добавь свои файлы в «Библиотеке».'));
  }).catch(() => {});
}

export default function home(view, ctx) {
  if (!navigator.onLine) return offlineHome(view);
  view.append(h('div.page-head', h('h1', greeting()),
    h('a.icon-btn.mobile-only', { href: '#/settings', title: 'Настройки', 'aria-label': 'Настройки' }, icon('settings'))));

  const recent = uniq(store.getHistory()).slice(0, 6);
  if (recent.length >= 2) {
    view.append(h('div.quick', recent.map((t, i) => h('button.quick-item', { onclick: () => player.playList(recent, i) }, art(coverOf(t), t.title, { ic: t.src === 'rd' ? 'radio' : null }), h('span', t.title)))));
  }

  const hint = fullHint();
  if (hint) view.append(hint);
  view.append(hero());

  view.append(lazyShelf('Хиты сейчас', { href: '#/chart/0', ic: 'fire', list: true }, () => dz.chartTracks(0, 100), (list) => trackList(list, { limit: 6, expandable: false })));

  let ruId = null;
  view.append(lazyShelf('Русские хиты', { ic: 'sparkle', list: true }, async () => {
    ruId = await dz.findYearPlaylist('ru', ['Топ 100 Россия {year}', 'Русские хиты {year}', 'Russian hits {year}']);
    return ruId ? (await dz.playlist(ruId)).tracks : [];
  }, (list) => h('div', trackList(list, { limit: 6, expandable: false }), h('a.btn.sm.ghost', { href: '#/playlist/' + ruId, style: { marginTop: '10px' } }, 'Весь плейлист'))));

  view.append(shelf('Чарты по странам', { ic: 'globe' }, row(dz.COUNTRIES.map(countryCard))));

  view.append(lazyShelf('Популярные альбомы', { ic: 'album' }, () => dz.chartAlbums(0, 30), (list) => row(list.map(albumCard))));

  view.append(lazyShelf('Полные треки · Audius', { href: '#/audius', sub: 'Играют целиком и без ограничений: легальная открытая платформа' }, () => au.trending({ limit: 40 }), (list) => row(list.map((t, i) => trackCard(t, list, i)))));

  view.append(lazyShelf('Артисты в тренде', { ic: 'artist' }, () => dz.chartArtists(0, 30), (list) => row(list.map(artistCard))));

  view.append(shelf('Жанры', {}, genreTiles()));

  let rapId = null;
  view.append(lazyShelf('Русский рэп', { list: true }, async () => {
    rapId = await dz.findYearPlaylist('rap', ['Русский рэп {year}', 'Russian rap {year}']);
    return rapId ? (await dz.playlist(rapId)).tracks : [];
  }, (list) => h('div', trackList(list, { limit: 5, expandable: false }), h('a.btn.sm.ghost', { href: '#/playlist/' + rapId, style: { marginTop: '10px' } }, 'Весь плейлист'))));

  view.append(lazyShelf('Радио: популярное в России', { href: '#/radio', ic: 'radio' }, () => radio.byCountry('RU', 20), (list) => row(list.map((s, i) => stationCard(s, list, i)))));

  view.append(lazyShelf('Подборки Deezer', {}, () => dz.chartPlaylists(0, 20), (list) => row(list.map(playlistCard))));

  const top = store.topPlayed(20);
  if (top.length >= 3) view.append(shelf('Ты часто слушаешь', { ic: 'heart' }, row(top.map((t, i) => trackCard(t, top, i)))));

  view.append(h('p.footer-note', 'Каталог и превью: Deezer · Полные треки: Audius и YouTube · Радио: Radio Browser · Тексты: LRCLIB'));
}
