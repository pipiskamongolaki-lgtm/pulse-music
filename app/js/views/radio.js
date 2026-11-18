// Радио: подборки, жанры, поиск станций, мои станции.
import { h, icon, go, debounce } from '../util.js';
import * as radio from '../api/radio.js';
import * as store from '../store.js';
import { row, shelf, lazyShelf, stationCard, skelRow, emptyState, errorLine } from '../ui.js';

export const stationGrid = (list) => h('div.station-grid', list.map((s, i) => stationCard(s, list, i)));

export default function radioView(view, ctx) {
  const tag = ctx.params.get('tag') || '';
  const mood = radio.MOODS.find((m) => m.tag === tag);
  view.append(h('div.page-head', h('h1', 'Радио')));
  view.append(h('p.page-sub', 'Тысячи станций со всего мира. Музыка в эфире играет целиком.'));
  view.append(h('div.chips', { style: { marginBottom: '14px' } },
    h('button.chip' + (!tag ? '.active' : ''), { onclick: () => go('#/radio') }, 'Подборка'),
    radio.MOODS.map((m) => h('button.chip' + (tag === m.tag ? '.active' : ''), { onclick: () => go('#/radio?tag=' + encodeURIComponent(m.tag)) }, m.name))));

  const input = h('input', { type: 'search', placeholder: 'Найти станцию: Europa Plus, Record, lofi…', autocomplete: 'off', 'aria-label': 'Поиск станций' });
  const found = h('div');
  const content = h('div');
  view.append(h('div.search-box', icon('search'), input), found, content);

  let token = 0;
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    const my = ++token;
    if (!q) {
      found.replaceChildren();
      content.hidden = false;
      return;
    }
    content.hidden = true;
    found.replaceChildren(skelRow());
    try {
      const list = await radio.search(q, 40);
      if (my !== token) return;
      found.replaceChildren(list.length ? shelf('Найдено', {}, stationGrid(list)) : emptyState('radio', 'Станций не нашлось', 'Попробуй другое название.'));
    } catch (e) {
      if (my === token) found.replaceChildren(errorLine(e.message));
    }
  }, 350));

  if (mood) {
    content.append(lazyShelf(mood.name, {}, () => radio.byTag(tag, 80), stationGrid));
    return;
  }
  const renderFavs = () => {
    const favs = store.getStations();
    favBox.replaceChildren(favs.length ? shelf('Мои станции', { ic: 'heart' }, row(favs.map((s, i) => stationCard(s, favs, i)))) : '');
  };
  const favBox = h('div');
  content.append(favBox);
  renderFavs();
  ctx.onCleanup(store.on('stations', renderFavs));
  content.append(lazyShelf('Популярное в России', { ic: 'fire' }, () => radio.byCountry('RU', 30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
  content.append(lazyShelf('Поп-хиты', {}, () => radio.byTag('pop', 30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
  content.append(lazyShelf('Танцевальное', {}, () => radio.byTag('dance', 30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
  content.append(lazyShelf('Хип-хоп', {}, () => radio.byTag('hip hop', 30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
  content.append(lazyShelf('Lo-fi и чилл', {}, () => radio.byTag('lofi', 30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
  content.append(lazyShelf('Популярное в мире', { ic: 'globe' }, () => radio.top(30), (l) => row(l.map((s, i) => stationCard(s, l, i)))));
}
