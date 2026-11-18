// Поиск: треки, артисты, альбомы, полные треки Audius, радио и свои файлы.
import { h, icon, go, debounce, isMobile } from '../util.js';
import * as dz from '../api/deezer.js';
import * as au from '../api/audius.js';
import * as radio from '../api/radio.js';
import { listLocal } from '../local.js';
import { player } from '../player.js';
import * as store from '../store.js';
import { art, row, shelf, trackList, stationCard, skelList, emptyState, errorLine } from '../ui.js';
import { albumCard, artistCard, playlistCard, playArtist, genreTiles, countryCard } from './home.js';

const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').trim();

export default function search(view, ctx) {
  const q0 = ctx.params.get('q') || '';
  const input = h('input#search-input', { type: 'search', placeholder: 'Трек, артист, альбом или радио', value: q0, autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false', 'aria-label': 'Поиск' });
  const clearB = h('button.icon-btn.sm', { hidden: !q0, 'aria-label': 'Очистить', title: 'Очистить', onclick: () => { input.value = ''; onInput(); input.focus(); } }, icon('close'));
  const results = h('div');
  view.append(h('div.page-head', h('h1', 'Поиск')), h('div.search-box', icon('search'), input, clearB), results);

  let token = 0;
  const run = debounce(() => doSearch(input.value.trim()), 300);
  function onInput() {
    clearB.hidden = !input.value;
    history.replaceState(history.state, '', '#/search' + (input.value ? '?q=' + encodeURIComponent(input.value) : ''));
    run();
  }
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      store.addSearch(input.value);
      input.blur();
    }
  });
  results.addEventListener('click', (e) => { if (e.target.closest('.tr, .card, .top-result')) store.addSearch(input.value); }, true);

  if (q0) doSearch(q0);
  else browse();
  if (!isMobile()) setTimeout(() => input.focus({ preventScroll: true }), 60);

  async function doSearch(q) {
    const my = ++token;
    if (!q) return browse();
    results.replaceChildren(skelList(7));
    const nq = norm(q);
    const [tracks, artists, albums, audius, stations, playlists, local] = await Promise.all([
      dz.search(q, 'track', 40).catch(() => null),
      dz.search(q, 'artist', 14).catch(() => []),
      dz.search(q, 'album', 16).catch(() => []),
      au.search(q, 12).catch(() => []),
      radio.search(q, 14).catch(() => []),
      dz.search(q, 'playlist', 14).catch(() => []),
      listLocal().then((l) => l.filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(nq))).catch(() => []),
    ]);
    if (my !== token) return;
    const out = [];
    if (tracks === null && !audius.length && !stations.length && !local.length) {
      results.replaceChildren(errorLine('Поиск не удался. Проверь интернет.', () => doSearch(q)));
      return;
    }
    const tl = tracks || [];
    const topArtist = artists.find((a) => norm(a.name) === nq) || (artists[0] && norm(artists[0].name).startsWith(nq) ? artists[0] : null);
    if (topArtist || tl.length) {
      out.push(h('div.search-top',
        shelf('Лучший результат', {}, topCard(topArtist, tl)),
        tl.length ? shelf('Треки', {}, trackList(tl, { limit: 5 })) : h('div')));
    }
    if (local.length) out.push(shelf('Мои файлы', {}, trackList(local)));
    if (artists.length) out.push(shelf('Исполнители', {}, row(artists.map(artistCard))));
    if (albums.length) out.push(shelf('Альбомы', {}, row(albums.map(albumCard))));
    if (audius.length) out.push(shelf('Полные треки · Audius', { sub: 'Играют целиком' }, trackList(audius, { limit: 5 })));
    if (playlists.length) out.push(shelf('Плейлисты', {}, row(playlists.map(playlistCard))));
    if (stations.length) out.push(shelf('Радиостанции', {}, row(stations.map((s, i) => stationCard(s, stations, i)))));
    if (!out.length) out.push(emptyState('search', 'Ничего не нашлось', `По запросу «${q}» пусто. Попробуй написать по-другому или латиницей.`));
    results.replaceChildren(...out);
  }

  function topCard(artist, tracks) {
    if (artist) {
      return h('a.top-result', { href: '#/artist/' + artist.id },
        art(artist.picture, artist.name, { round: true }),
        h('div', h('h3', artist.name), h('div', { style: { color: 'var(--text-3)', marginTop: '4px', fontWeight: '700' } }, 'Исполнитель')),
        h('span.play-fab', { role: 'button', tabindex: '0', 'aria-label': 'Играть', onclick: (e) => { e.preventDefault(); e.stopPropagation(); playArtist(artist.id); } }, icon('play')));
    }
    const t = tracks[0];
    return h('button.top-result', { onclick: () => player.playList(tracks, 0) },
      art(t.cover, t.title),
      h('div', h('h3', t.title), h('div', { style: { color: 'var(--text-3)', marginTop: '4px', fontWeight: '700' } }, 'Трек · ' + t.artist)),
      h('span.play-fab', icon('play')));
  }

  function browse() {
    ++token;
    const out = [];
    const recent = store.getSearches();
    if (recent.length) {
      out.push(shelf('Недавние запросы', {},
        h('div.recent-searches',
          recent.map((q) => h('button.chip', { onclick: () => { input.value = q; onInput(); } }, q)),
          h('button.chip', { onclick: () => { store.clearSearches(); browse(); } }, icon('close', 'sm'), 'Очистить'))));
    }
    out.push(shelf('Жанры', {}, genreTiles()));
    out.push(shelf('Чарты по странам', { ic: 'globe' }, row(dz.COUNTRIES.map(countryCard))));
    out.push(shelf('Радио по настроению', { ic: 'radio' },
      h('div.tiles', radio.MOODS.map((m) => h('a.tile', { href: '#/radio?tag=' + encodeURIComponent(m.tag), style: { '--c': m.c } }, m.name, h('small', 'Радиостанции'))))));
    out.push(shelf('Ещё', {}, h('div.tiles',
      h('a.tile', { href: '#/audius', style: { '--c': '#7c3aed' } }, 'Audius: тренды', h('small', 'Полные треки')),
      h('a.tile', { href: '#/chart/0', style: { '--c': '#e11d48' } }, 'Хиты сейчас', h('small', 'Топ-100 Deezer')),
      h('a.tile', { href: '#/library?tab=files', style: { '--c': '#0f766e' } }, 'Мои файлы', h('small', 'Своя музыка')))));
    results.replaceChildren(...out);
  }
}
