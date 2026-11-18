// Библиотека: плейлисты, любимые, мои файлы, история, станции.
import { h, icon, go, tracksWord } from '../util.js';
import * as store from '../store.js';
import { player, coverOf } from '../player.js';
import { art, card, trackList, emptyState, ask, playActions, confirmBox, toast } from '../ui.js';
import { stationGrid } from './radio.js';
import { localManager, historyList } from './pages.js';
import { getOffline, offlineBytes, removeOffline } from '../offline.js';

const TABS = [
  ['playlists', 'Плейлисты'],
  ['liked', 'Любимые'],
  ['offline', 'Офлайн'],
  ['files', 'Мои файлы'],
  ['stations', 'Станции'],
  ['history', 'История'],
];

export default function library(view, ctx) {
  let tab = ctx.params.get('tab') || 'playlists';
  if (!TABS.some(([k]) => k === tab)) tab = 'playlists';
  view.append(h('div.page-head', h('h1', 'Библиотека'),
    h('a.icon-btn.mobile-only', { href: '#/settings', title: 'Настройки', 'aria-label': 'Настройки' }, icon('settings'))));
  const segs = h('div.segs', TABS.map(([k, label]) => h('button.chip', { dataset: { k }, onclick: () => select(k) }, label)));
  const body = h('div');
  view.append(segs, body);

  let unsub = null;
  function select(k) {
    tab = k;
    history.replaceState(history.state, '', '#/library?tab=' + k);
    segs.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.k === k));
    unsub?.();
    unsub = null;
    body.replaceChildren();
    if (k === 'playlists') {
      renderPlaylists(body);
      unsub = multi(store.on('playlists', () => renderPlaylists(body)), store.on('likes', () => renderPlaylists(body)));
    } else if (k === 'liked') {
      renderLiked(body);
      unsub = store.on('likes', () => renderLiked(body));
    } else if (k === 'offline') {
      renderOffline(body);
      let t = null;
      unsub = store.on('offline', () => { clearTimeout(t); t = setTimeout(() => renderOffline(body), 300); });
    } else if (k === 'files') {
      unsub = localManager(body);
    } else if (k === 'stations') {
      renderStations(body);
      unsub = store.on('stations', () => renderStations(body));
    } else if (k === 'history') {
      unsub = historyList(body);
    }
  }
  ctx.onCleanup(() => unsub?.());
  select(tab);
}

const multi = (...fns) => () => fns.forEach((f) => f());

function renderPlaylists(body) {
  const pls = store.getPlaylists();
  const likes = store.getLikes();
  const liked = card({ cover: '', title: 'Любимые треки', sub: tracksWord(likes.length), href: '#/liked', ic: 'heart-fill', onPlay: likes.length ? () => player.playList(likes, 0) : null });
  liked.querySelector('.art').style.setProperty('--g', 'linear-gradient(135deg, var(--accent), var(--accent-2))');
  const files = card({ cover: '', title: 'Мои файлы', sub: 'Музыка с устройства', href: '#/library?tab=files', ic: 'folder' });
  files.querySelector('.art').style.setProperty('--g', 'linear-gradient(135deg, #0f766e, #155e75)');
  body.replaceChildren(
    h('div', { style: { display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' } },
      h('button.btn.primary', { onclick: newPlaylist }, icon('plus'), 'Новый плейлист')),
    h('div.grid', liked, files,
      pls.map((p) => card({
        cover: coverOf(p.tracks[0]), title: p.name, sub: tracksWord(p.tracks.length), href: '#/my/' + p.id,
        onPlay: p.tracks.length ? () => player.playList(p.tracks, 0) : null,
      }))),
    pls.length ? '' : h('p.note', { style: { marginTop: '18px' } }, 'Создай плейлист кнопкой выше или через меню «…» у любого трека → «В плейлист».'));
}

async function newPlaylist() {
  const name = await ask('Новый плейлист', { placeholder: 'Название плейлиста', ok: 'Создать' });
  if (!name) return;
  const p = store.createPlaylist(name);
  go('#/my/' + p.id);
}

function renderLiked(body) {
  const likes = store.getLikes();
  if (!likes.length) {
    body.replaceChildren(emptyState('heart', 'Пока пусто', 'Нажимай на сердечко у треков, и они соберутся здесь.', h('a.btn.primary', { href: '#/home' }, 'К хитам')));
    return;
  }
  body.replaceChildren(playActions(likes), trackList(likes));
}

const fmtMB = (b) => (b / 1e6).toFixed(b > 1e8 ? 0 : 1) + ' МБ';

function renderOffline(body) {
  const list = getOffline();
  const info = h('p.note', 'Без интернета играют скачанные треки Audius и твои файлы. Чтобы скачать трек, нажми «…» → «Скачать для офлайна» или кнопку со стрелкой у списка. Хиты Deezer и YouTube сохранять нельзя: это запрещают их правила.');
  if (!list.length) {
    body.replaceChildren(info, emptyState('download', 'Пока ничего не скачано', 'Открой «Audius: в тренде» и скачай треки, которые хочешь слушать без интернета. Свои файлы из «Моих файлов» тоже играют офлайн.', h('a.btn.primary', { href: '#/audius' }, 'К Audius')));
    return;
  }
  body.replaceChildren(
    info,
    h('div.shelf-head', h('h2', `Скачано: ${tracksWord(list.length)} · ${fmtMB(offlineBytes())}`)),
    playActions(list, [h('button.btn.sm.ghost', {
      onclick: async () => {
        if (!(await confirmBox('Удалить всё из офлайна?', 'Скачанные треки удалятся с этого устройства. В любимых и плейлистах они останутся.', 'Удалить'))) return;
        for (const t of list) await removeOffline(t.id);
        toast('Офлайн очищен');
      },
    }, icon('trash'), 'Удалить всё')]),
    trackList(list));
}

function renderStations(body) {
  const st = store.getStations();
  if (!st.length) {
    body.replaceChildren(emptyState('radio', 'Нет сохранённых станций', 'Открой «Радио», нажми «…» на станции и выбери «В мои станции».', h('a.btn.primary', { href: '#/radio' }, 'К радио')));
    return;
  }
  body.replaceChildren(stationGrid(st));
}
