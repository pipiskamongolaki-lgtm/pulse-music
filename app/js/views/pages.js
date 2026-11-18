// Страницы: альбом, артист, плейлисты, чарт, Audius, мои файлы, история.
import { h, icon, go, fmtTotal, fmtNum, tracksWord, plural } from '../util.js';
import * as dz from '../api/deezer.js';
import * as au from '../api/audius.js';
import * as store from '../store.js';
import { player, coverOf } from '../player.js';
import { importFiles, listLocal, isAudioFile } from '../local.js';
import {
  art, row, shelf, trackList, topbar, collHead, playActions, skelList, emptyState, errorLine,
  chooseAndAdd, ask, confirmBox, toast, openMenu,
} from '../ui.js';
import { albumCard, artistCard } from './home.js';

const total = (list) => list.reduce((s, t) => s + (t.duration || 0), 0);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

function loading(view, title) {
  const sk = h('div', { style: { paddingTop: '20px' } }, skelList(8));
  view.append(topbar(title), sk);
  return sk;
}
function failed(sk, msg, retry) {
  sk.replaceWith(h('div', { style: { paddingTop: '30px' } }, errorLine(msg, retry)));
}

/* ---------- Альбом ---------- */
export function album(view, ctx) {
  const id = ctx.match[1];
  const sk = loading(view, '');
  dz.album(id).then((a) => {
    view.querySelector('.tb-title').textContent = a.title;
    const kind = a.recordType === 'single' ? 'Сингл' : a.recordType === 'ep' ? 'EP' : a.recordType === 'compile' ? 'Сборник' : 'Альбом';
    sk.replaceWith(
      collHead({
        view, cover: a.coverBig, title: a.title, kicker: kind,
        meta: [a.artistId ? h('a', { href: '#/artist/' + a.artistId }, a.artist) : a.artist, a.year, tracksWord(a.tracks.length), fmtTotal(total(a.tracks))],
      }),
      playActions(a.tracks, [h('button.icon-btn', { title: 'В плейлист', 'aria-label': 'Добавить в плейлист', onclick: () => chooseAndAdd(a.tracks) }, icon('playlist-add'))]),
      trackList(a.tracks, { numbered: true, noArt: true }),
      h('p.footer-note', { style: { textAlign: 'left' } }, [a.date && new Date(a.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }), a.label].filter(Boolean).join(' · ')));
  }).catch((e) => failed(sk, 'Альбом не загрузился: ' + e.message, () => go(location.hash)));
}

/* ---------- Артист ---------- */
export function artist(view, ctx) {
  const id = ctx.match[1];
  const sk = loading(view, '');
  dz.artist(id).then((a) => {
    view.querySelector('.tb-title').textContent = a.name;
    const albums = a.albums.filter((x) => x.recordType === 'album' || x.recordType === 'compile');
    const singles = a.albums.filter((x) => x.recordType === 'single' || x.recordType === 'ep');
    sk.replaceWith(
      collHead({ view, cover: a.pictureBig, title: a.name, kicker: 'Исполнитель', round: true, meta: [a.fans ? `${fmtNum(a.fans)} ${plural(a.fans, 'фанат', 'фаната', 'фанатов')}` : '', a.nbAlbum ? `${a.nbAlbum} релизов` : ''] }),
      playActions(a.top),
      a.top.length ? shelf('Популярные треки', {}, trackList(a.top, { limit: 5, numbered: true })) : '',
      albums.length ? shelf('Альбомы', {}, row(albums.map(albumCard))) : '',
      singles.length ? shelf('Синглы и EP', {}, row(singles.map(albumCard))) : '',
      a.related.length ? shelf('Похожие исполнители', {}, row(a.related.map(artistCard))) : '');
  }).catch((e) => failed(sk, 'Исполнитель не загрузился: ' + e.message, () => go(location.hash)));
}

/* ---------- Плейлист Deezer ---------- */
export function dzPlaylist(view, ctx) {
  const id = ctx.match[1];
  const sk = loading(view, '');
  dz.playlist(id).then((p) => {
    view.querySelector('.tb-title').textContent = p.title;
    sk.replaceWith(
      collHead({ view, cover: p.coverBig, title: p.title, kicker: 'Плейлист', desc: p.description, meta: [p.by, tracksWord(p.tracks.length), fmtTotal(total(p.tracks))] }),
      playActions(p.tracks, [h('button.btn', {
        title: 'Сохранить копию в мои плейлисты',
        onclick: () => {
          const mine = store.createPlaylist(p.title, p.tracks);
          toast('Сохранено в «Мои плейлисты»');
          go('#/my/' + mine.id);
        },
      }, icon('plus'), 'Сохранить')]),
      p.tracks.length ? trackList(p.tracks, { numbered: true, head: true }) : emptyState('queue', 'Плейлист пуст', ''));
  }).catch((e) => failed(sk, 'Плейлист не загрузился: ' + e.message, () => go(location.hash)));
}

/* ---------- Чарт по жанру ---------- */
export function chart(view, ctx) {
  const g = Number(ctx.match[1]);
  const title = g === 0 ? 'Хиты сейчас' : 'Чарт: ' + dz.genreName(g);
  view.append(topbar(title));
  view.append(h('div.chips', { style: { margin: '6px -16px 4px' } },
    h('a.chip' + (g === 0 ? '.active' : ''), { href: '#/chart/0' }, 'Все'),
    dz.GENRES.map((x) => h('a.chip' + (x.id === g ? '.active' : ''), { href: '#/chart/' + x.id }, x.name))));
  const sk = h('div', skelList(10));
  view.append(sk);
  dz.chartTracks(g, 100).then((list) => {
    sk.replaceWith(
      collHead({ view, cover: list[0]?.coverBig, title, kicker: 'Чарт Deezer · обновляется каждый день', meta: [tracksWord(list.length)] }),
      playActions(list),
      trackList(list, { numbered: true, head: true }));
  }).catch((e) => failed(sk, 'Чарт не загрузился: ' + e.message, () => go(location.hash)));
}

/* ---------- Audius ---------- */
export function audius(view, ctx) {
  const genre = ctx.params.get('g') || '';
  const time = ctx.params.get('t') || 'week';
  view.append(topbar('Audius'));
  view.append(h('div.page-head', h('h1', 'Audius: в тренде')));
  view.append(h('p.page-sub', 'Открытая музыкальная платформа: артисты сами выкладывают треки, и они играют целиком.'));
  const link = (g, t) => `#/audius?g=${encodeURIComponent(g)}&t=${t}`;
  view.append(h('div.chips', au.AUDIUS_GENRES.map((x) => h('a.chip' + (x.id === genre ? '.active' : ''), { href: link(x.id, time) }, x.name))));
  view.append(h('div.chips', { style: { marginBottom: '14px' } },
    [['week', 'Неделя'], ['month', 'Месяц'], ['allTime', 'Всё время']].map(([k, l]) => h('a.chip' + (k === time ? '.active' : ''), { href: link(genre, k) }, l))));
  const sk = h('div', skelList(10));
  view.append(sk);
  au.trending({ genre, time, limit: 100 }).then((list) => {
    sk.replaceWith(list.length ? h('div', playActions(list), trackList(list, { numbered: true })) : emptyState('search', 'Пусто', 'В этом жанре сейчас нет трендов.'));
  }).catch((e) => failed(sk, e.message, () => go(location.hash)));
}

/* ---------- Мой плейлист ---------- */
export function myPlaylist(view, ctx) {
  const id = ctx.match[1];
  const render = () => {
    const p = store.getPlaylist(id);
    view.replaceChildren();
    view.classList.remove('has-bg');
    if (!p) {
      view.append(topbar(''), emptyState('queue', 'Плейлист не найден', 'Возможно, он был удалён.', h('a.btn.primary', { href: '#/library' }, 'В библиотеку')));
      return;
    }
    const cover = coverOf(p.tracks[0], true);
    view.append(
      topbar(p.name),
      collHead({ view, cover, title: p.name, kicker: 'Мой плейлист', ic: 'queue', meta: [tracksWord(p.tracks.length), p.tracks.length ? fmtTotal(total(p.tracks)) : ''] }),
      playActions(p.tracks, [
        h('button.icon-btn', { title: 'Переименовать', 'aria-label': 'Переименовать', onclick: async () => { const n = await ask('Переименовать плейлист', { value: p.name, ok: 'Сохранить' }); if (n) store.renamePlaylist(id, n); } }, icon('edit')),
        h('button.icon-btn', {
          title: 'Удалить плейлист', 'aria-label': 'Удалить плейлист',
          onclick: async () => {
            if (await confirmBox('Удалить плейлист?', `«${p.name}» удалится вместе со списком треков. Сами треки никуда не денутся.`)) {
              store.deletePlaylist(id);
              toast('Плейлист удалён');
              go('#/library');
            }
          },
        }, icon('trash')),
      ]),
      p.tracks.length
        ? trackList(p.tracks, { numbered: true, head: true, playlistId: id })
        : emptyState('playlist-add', 'Здесь пока пусто', 'Найди треки через поиск и добавь их через «…» → «В плейлист». Порядок можно менять там же: «Переместить выше/ниже».', h('a.btn.primary', { href: '#/search' }, 'К поиску')));
  };
  render();
  ctx.onCleanup(store.on('playlists', render));
}

/* ---------- Любимые ---------- */
export function liked(view, ctx) {
  const render = () => {
    const likes = store.getLikes();
    view.replaceChildren(topbar('Любимые треки'));
    view.classList.remove('has-bg');
    const head = collHead({ view, title: 'Любимые треки', kicker: 'Плейлист', ic: 'heart-fill', meta: [tracksWord(likes.length), likes.length ? fmtTotal(total(likes)) : ''] });
    head.querySelector('.art').style.setProperty('--g', 'linear-gradient(135deg, var(--accent), var(--accent-2))');
    view.append(head);
    if (!likes.length) {
      view.append(emptyState('heart', 'Пока пусто', 'Нажимай на сердечко у треков, и они соберутся здесь.', h('a.btn.primary', { href: '#/home' }, 'К хитам')));
      return;
    }
    view.append(playActions(likes), trackList(likes, { numbered: true, head: true }));
  };
  render();
  ctx.onCleanup(store.on('likes', render));
}

/* ---------- Мои файлы ---------- */
export function local(view, ctx) {
  view.append(topbar('Мои файлы'), h('div.page-head', h('h1', 'Мои файлы')));
  const body = h('div');
  view.append(body);
  ctx.onCleanup(localManager(body));
}

const fmtBytes = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' ГБ' : Math.max(1, Math.round(b / 1e6)) + ' МБ');

/** Импорт своих файлов и список. Возвращает функцию отписки. */
export function localManager(body) {
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wav', hidden: true });
  const dirInput = h('input', { type: 'file', multiple: true, hidden: true });
  dirInput.setAttribute('webkitdirectory', '');
  const bar = h('i');
  const status = h('div.note');
  const prog = h('div', { hidden: true, style: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } }, h('div.progress-bar', bar), status);
  const storageNote = h('div.note');
  const drop = h('div.drop',
    icon('upload', 'lg'),
    h('b', 'Добавь свою музыку'),
    h('div.note', { style: { margin: '0' } }, 'mp3, m4a, flac, ogg, wav. Файлы копируются в память этого браузера и играют без интернета. Можно перетащить их сюда.'),
    h('div.btns',
      h('button.btn.primary', { onclick: () => fileInput.click() }, icon('plus'), 'Выбрать файлы'),
      isIOS ? null : h('button.btn', { onclick: () => dirInput.click() }, icon('folder'), 'Выбрать папку')),
    prog, fileInput, dirInput);
  const list = h('div');
  body.replaceChildren(drop, list, storageNote);

  let busy = false;
  async function handle(files) {
    if (busy) return;
    const arr = [...files].filter(isAudioFile);
    if (!arr.length) return toast('Аудиофайлов не найдено');
    busy = true;
    prog.hidden = false;
    try {
      const r = await importFiles(arr, (i, n, name) => {
        bar.style.width = (n ? (i / n) * 100 : 0) + '%';
        status.textContent = name ? `${i + 1} из ${n}: ${name}` : 'Готово';
      });
      toast(`Добавлено ${tracksWord(r.added)}` + (r.skipped ? `, уже были: ${r.skipped}` : '') + (r.failed ? `, ошибок: ${r.failed}` : ''), 4000);
    } catch (e) {
      toast('Не удалось добавить: ' + e.message, 4000);
    } finally {
      busy = false;
      setTimeout(() => (prog.hidden = true), 1200);
    }
  }
  fileInput.addEventListener('change', () => { handle(fileInput.files); fileInput.value = ''; });
  dirInput.addEventListener('change', () => { handle(dirInput.files); dirInput.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = await filesFromDrop(e.dataTransfer);
    handle(files);
  });

  async function renderList() {
    const tracks = await listLocal().catch(() => []);
    if (!list.isConnected && body.isConnected === false) return;
    list.replaceChildren(tracks.length
      ? h('div', h('div.shelf-head', h('h2', `В приложении: ${tracksWord(tracks.length)}`)), playActions(tracks), trackList(tracks))
      : h('p.note', 'Пока здесь ничего нет.'));
    navigator.storage?.estimate?.().then(({ usage, quota }) => {
      if (usage != null && quota) storageNote.textContent = `Занято в браузере: ${fmtBytes(usage)} из доступных ${fmtBytes(quota)}.`;
    }).catch(() => {});
  }
  renderList();
  return store.on('local', renderList);
}

async function filesFromDrop(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)).catch(() => null));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e);
  return out.filter(Boolean);
}

/* ---------- История ---------- */
export function historyPage(view, ctx) {
  view.append(topbar('История'), h('div.page-head', h('h1', 'История')));
  const body = h('div');
  view.append(body);
  ctx.onCleanup(historyList(body));
}

export function historyList(body) {
  const render = () => {
    const hist = store.getHistory();
    if (!hist.length) {
      body.replaceChildren(emptyState('timer', 'История пуста', 'Здесь появятся треки, которые ты дослушал хотя бы до половины.'));
      return;
    }
    const groups = new Map();
    for (const t of hist.slice(0, 200)) {
      const d = new Date(t.playedAt);
      const key = d.toDateString() === new Date().toDateString() ? 'Сегодня'
        : d.toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'Вчера'
        : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    body.replaceChildren(
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' } },
        h('button.btn.sm.ghost', {
          onclick: async () => {
            if (await confirmBox('Очистить историю?', 'Список прослушанного и блок «Ты часто слушаешь» обнулятся.', 'Очистить')) store.clearHistory();
          },
        }, icon('trash'), 'Очистить')),
      ...[...groups].map(([k, list]) => shelf(k, {}, trackList(list))));
  };
  render();
  return store.on('history', render);
}
