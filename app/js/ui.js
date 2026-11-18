// Общие кусочки интерфейса: обложки, строки треков, карточки, полки, меню, окна.
import { $, $$, h, icon, setIcon, fmtTime, gradFor, initials, isMobile, go, tracksWord } from './util.js';
import { player, coverOf } from './player.js';
import * as store from './store.js';
import { deleteLocal } from './local.js';
import { coverColor } from './color.js';
import { canOffline, isOffline, isDownloading, download, downloadMany, removeOffline } from './offline.js';

/* ---------- уведомления ---------- */
export function toast(msg, ms = 2600) {
  const root = $('#toast-root');
  const el = h('div.toast', msg);
  root.append(el);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* ---------- обложка с запасным градиентом ---------- */
export function art(src, label = '', { round = false, ic = null } = {}) {
  const el = h('div.art' + (round ? '.round' : ''));
  el.style.setProperty('--g', gradFor(label));
  const ph = h('div.art-ph', ic ? icon(ic) : initials(label));
  el.append(ph);
  if (src) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    // Эти сервера разрешают CORS: так кэш обложек годится и для подбора цвета фона
    if (/dzcdn\.net|audius|open-audio|theblueprint\.xyz|monophonic\.digital|staked\.cloud/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => {
      img.classList.add('ok');
      ph.remove();
    };
    img.onerror = () => img.remove();
    img.src = src;
    el.append(img);
  }
  return el;
}

/* ---------- строки треков ---------- */
function srcBadge(t) {
  if (t.src === 'au') return h('span.badge.src', 'Audius');
  if (t.src === 'lc') return h('span.badge.src', 'Файл');
  return null;
}

function albumCell(t) {
  if (t.src === 'dz' && t.albumId) return h('a', { href: '#/album/' + t.albumId, onclick: (e) => e.stopPropagation() }, t.album);
  return t.src === 'rd' ? 'Радио' : t.album || '';
}

export function likeButton(t, cls = '.icon-btn.sm.like') {
  const liked = store.isLiked(t.id);
  const b = h('button' + cls, {
    title: 'Нравится',
    'aria-label': 'Нравится',
    dataset: { like: t.id },
    onclick: (e) => {
      e.stopPropagation();
      const v = store.toggleLike(t);
      toast(v ? 'Добавлено в «Любимые»' : 'Убрано из «Любимых»');
    },
  }, icon(liked ? 'heart-fill' : 'heart'));
  if (liked) b.classList.add('liked');
  return b;
}

export function trackRow(t, i, list, opts = {}) {
  const a = art(coverOf(t), t.title, { ic: t.src === 'rd' ? 'radio' : null });
  a.append(h('div.eq', h('i'), h('i'), h('i'), h('i')));
  const row = h('div.tr' + (opts.numbered ? '.numbered' : '') + (opts.noArt ? '.no-art' : ''), { role: 'button', tabindex: '0', dataset: { tid: t.id } },
    opts.numbered ? h('div.tr-num', String(i + 1)) : null,
    a,
    h('div.tr-main',
      h('div.tr-title', t.title, t.explicit ? h('span.badge', { title: 'Ненормативная лексика' }, 'E') : null),
      h('div.tr-sub', h('span.off-ic', { title: 'Доступен без интернета' }, icon('downloaded')), srcBadge(t), t.artist)),
    h('div.tr-album', albumCell(t)),
    h('div.tr-dur', t.duration ? fmtTime(t.duration) : t.src === 'rd' ? 'LIVE' : ''),
    h('div.tr-actions',
      likeButton(t),
      h('button.icon-btn.sm.more', { title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => { e.stopPropagation(); trackMenu(t, { ...opts, event: e, index: i }); } }, icon('more'))));
  const play = () => {
    if (player.current?.id === t.id) player.toggle();
    else player.playList(list, i);
  };
  row.addEventListener('click', () => {
    if (row.dataset.lp) return delete row.dataset.lp;
    play();
  });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    trackMenu(t, { ...opts, event: e, index: i });
  });
  longPress(row, () => trackMenu(t, { ...opts, index: i }));
  if (player.current?.id === t.id) row.classList.add('is-playing');
  if (t.src === 'lc' || isOffline(t.id)) row.classList.add('is-offline');
  return row;
}

export function trackList(list, opts = {}) {
  const wrap = h('div.tracks');
  if (opts.head) wrap.append(h('div.list-head', h('span', '#'), h('span'), h('span', 'Название'), h('span', 'Альбом'), h('span'), h('span.r', '⏱')));
  const n = opts.limit ? Math.min(opts.limit, list.length) : list.length;
  for (let i = 0; i < n; i++) wrap.append(trackRow(list[i], i, list, opts));
  if (opts.limit && list.length > opts.limit && opts.expandable !== false) {
    const more = h('button.btn.sm.ghost', {
      style: { marginTop: '10px', alignSelf: 'flex-start' },
      onclick: () => {
        more.remove();
        for (let i = n; i < list.length; i++) wrap.append(trackRow(list[i], i, list, opts));
      },
    }, `Показать ещё ${list.length - n}`);
    wrap.append(more);
  }
  return wrap;
}

export function longPress(el, fn) {
  let timer = null;
  let sx = 0, sy = 0;
  el.addEventListener('touchstart', (e) => {
    const p = e.touches[0];
    sx = p.clientX;
    sy = p.clientY;
    timer = setTimeout(() => {
      timer = null;
      el.dataset.lp = '1';
      navigator.vibrate?.(12);
      fn();
    }, 520);
  }, { passive: true });
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  el.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) cancel();
  }, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
}

/** Подсветка играющего трека и сердечек по всему экрану. */
export function bindGlobalHighlights() {
  player.on('track', (t) => {
    $$('.is-playing[data-tid]').forEach((el) => el.classList.remove('is-playing'));
    if (t) $$(`[data-tid="${CSS.escape(t.id)}"]`).forEach((el) => el.classList.add('is-playing'));
  });
  store.on('offline', (d) => {
    if (!d?.id) return;
    $$(`[data-tid="${CSS.escape(d.id)}"]`).forEach((el) => {
      el.classList.toggle('is-offline', isOffline(d.id));
      el.classList.toggle('is-downloading', isDownloading(d.id));
    });
  });
  store.on('likes', (d) => {
    const sel = d?.id ? `[data-like="${CSS.escape(d.id)}"]` : '[data-like]';
    $$(sel).forEach((b) => {
      const v = store.isLiked(b.dataset.like);
      b.classList.toggle('liked', v);
      setIcon(b.querySelector('svg'), v ? 'heart-fill' : 'heart');
    });
  });
}

/* ---------- карточки и полки ---------- */
export function card({ cover, title, sub, href, onPlay, round = false, ic = null, live = false, onMenu, onClick }) {
  const playBtn = onPlay
    ? h('span.card-play', { role: 'button', tabindex: '0', title: 'Играть', 'aria-label': 'Играть ' + title, onclick: (e) => { e.preventDefault(); e.stopPropagation(); onPlay(); } }, icon('play'))
    : null;
  const el = h(href ? 'a.card' : 'button.card', { href, class: round ? 'round' : null, onclick: onClick || (!href && onPlay ? () => onPlay() : null) },
    h('div.card-art', art(cover, title, { round, ic }), live ? h('span.live-dot', 'LIVE') : null, playBtn),
    h('div.card-title', title),
    sub ? h('div.card-sub', sub) : null);
  if (onMenu) {
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(e); });
    longPress(el, () => onMenu());
    el.addEventListener('click', (e) => { if (el.dataset.lp) { e.preventDefault(); e.stopImmediatePropagation(); delete el.dataset.lp; } }, true);
  }
  return el;
}

export function row(items) {
  const r = h('div.row', items);
  return h('div.row-wrap',
    h('button.row-arrow.l', { 'aria-label': 'Прокрутить назад', onclick: () => r.scrollBy({ left: -r.clientWidth * 0.8, behavior: 'smooth' }) }, icon('back')),
    r,
    h('button.row-arrow.r', { 'aria-label': 'Прокрутить вперёд', onclick: () => r.scrollBy({ left: r.clientWidth * 0.8, behavior: 'smooth' }) }, icon('forward')));
}

export function shelf(title, opts = {}, ...content) {
  return h('section.shelf',
    h('div.shelf-head', h('h2', opts.ic ? icon(opts.ic) : null, title), opts.href ? h('a', { href: opts.href }, opts.more || 'Все') : null),
    opts.sub ? h('p.shelf-sub', opts.sub) : null,
    ...content);
}

/** Полка, которая сама грузит данные: пока грузится, показывает скелет; при ошибке кнопку «Повторить». */
export function lazyShelf(title, opts, loader, render) {
  const body = h('div', opts.list ? skelList(5) : skelRow());
  const sec = shelf(title, opts, body);
  const run = () => {
    body.replaceChildren(opts.list ? skelList(5) : skelRow());
    Promise.resolve().then(loader).then((data) => {
      if (!data || (Array.isArray(data) && !data.length)) return sec.remove();
      body.replaceChildren(render(data));
    }).catch((e) => {
      console.warn(title, e);
      body.replaceChildren(errorLine(e.message || 'Не загрузилось', run));
    });
  };
  run();
  return sec;
}

export function skelRow(n = 7) {
  return h('div.row', Array.from({ length: n }, () => h('div.sk-card', h('div.sk'), h('div.sk.sk-line', { style: { width: '80%' } }), h('div.sk.sk-line', { style: { width: '50%' } }))));
}
export function skelList(n = 8) {
  return h('div', Array.from({ length: n }, () => h('div.sk-row', h('div.sk'), h('div', h('div.sk.sk-line', { style: { width: '60%', marginBottom: '8px' } }), h('div.sk.sk-line', { style: { width: '35%' } })))));
}

export function emptyState(ic, title, text, action) {
  return h('div.empty', h('div.empty-ic', icon(ic)), h('h3', title), text ? h('p', text) : null, action || null);
}

export function errorLine(msg, retry) {
  return h('div.err-line', icon('info', 'sm'), h('span', msg), retry ? h('button.btn.sm', { onclick: retry }, 'Повторить') : null);
}

/* ---------- шапки страниц ---------- */
export function topbar(title) {
  return h('div.topbar',
    h('button.icon-btn', { 'aria-label': 'Назад', title: 'Назад', onclick: () => (history.length > 1 ? history.back() : go('#/home')) }, icon('back')),
    h('div.tb-title', title || ''));
}

export function collHead({ cover, title, kicker, meta = [], desc, round = false, ic = null, view }) {
  if (view && cover) {
    view.classList.add('has-bg');
    const bg = h('div.coll-bg');
    view.prepend(bg);
    coverColor(cover).then((c) => c && bg.style.setProperty('--c', c.join(',')));
  }
  return h('div.coll-head',
    art(cover, title, { round, ic }),
    h('div',
      kicker ? h('div.coll-kicker', kicker) : null,
      h('h1.coll-title', title),
      desc ? h('p.coll-desc', desc) : null,
      h('div.coll-meta', meta.filter(Boolean).map((m, i) => [i ? h('span', { 'aria-hidden': 'true' }, '·') : null, typeof m === 'string' ? h('span', m) : m]))));
}

export function playActions(list, extra = []) {
  return h('div.coll-actions',
    h('button.play-fab', { 'aria-label': 'Играть', title: 'Играть', onclick: () => list.length && player.playList(list, 0, { shuffle: false }) }, icon('play')),
    h('button.btn', { onclick: () => list.length && player.playList(list, Math.floor(Math.random() * list.length), { shuffle: true }) }, icon('shuffle'), 'Перемешать'),
    list.some(canOffline) ? downloadAllButton(list) : null,
    ...extra);
}

/** Кнопка «скачать всё для офлайна» (только треки, которые можно сохранять). */
export function downloadAllButton(list) {
  const b = h('button.icon-btn', { title: 'Скачать для офлайна', 'aria-label': 'Скачать для офлайна' }, icon('download'));
  const sync = () => {
    const can = list.filter(canOffline);
    const all = can.length && can.every((t) => isOffline(t.id));
    setIcon(b.querySelector('svg'), all ? 'downloaded' : 'download');
    b.classList.toggle('on', !!all);
    b.title = all ? 'Всё скачано: играет без интернета' : 'Скачать для офлайна';
  };
  sync();
  let running = false;
  b.addEventListener('click', async () => {
    if (running) return;
    const todo = list.filter((t) => canOffline(t) && !isOffline(t.id));
    if (!todo.length) return toast(list.some((t) => !canOffline(t)) ? 'Всё, что можно, уже скачано. Хиты Deezer и YouTube сохранять нельзя' : 'Уже всё скачано');
    running = true;
    b.disabled = true;
    toast(`Скачиваю ${todo.length} шт. Можно пользоваться приложением дальше`, 3500);
    const r = await downloadMany(todo);
    running = false;
    b.disabled = false;
    sync();
    toast(`Готово: скачано ${r.done}` + (r.failed ? `, не получилось ${r.failed}` : ''), 4000);
  });
  const off = store.on('offline', sync);
  const obs = new MutationObserver(() => { if (!b.isConnected) { off(); obs.disconnect(); } });
  setTimeout(() => b.isConnected && obs.observe(document.getElementById('view'), { childList: true }), 0);
  return b;
}

/* ---------- меню и окна ---------- */
let closeCurrent = null;
export const closeOverlay = () => closeCurrent?.();

export function openMenu(items, { event, anchor, header } = {}) {
  closeOverlay();
  const root = $('#overlay-root');
  const list = items.filter(Boolean).map((it) => (it === '-'
    ? h('div.menu-sep')
    : h('button.menu-item' + (it.danger ? '.danger' : ''), { role: 'menuitem', onclick: () => { close(); it.action(); } }, icon(it.icon), h('span', it.label))));
  const sheet = isMobile() || matchMedia('(pointer: coarse)').matches;
  let back, box;
  if (sheet) {
    back = h('div.backdrop', { onclick: () => close() });
    box = h('div.sheet', { role: 'menu' }, header || null, list);
    root.append(back, box);
  } else {
    back = h('div', { style: { position: 'fixed', inset: '0', zIndex: '80' }, onclick: () => close(), oncontextmenu: (e) => { e.preventDefault(); close(); } });
    box = h('div.popover', { role: 'menu' }, list);
    root.append(back, box);
    let x = 0, y = 0;
    if (event && event.clientX) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const el = anchor || event?.currentTarget;
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.right - box.offsetWidth;
        y = r.bottom + 4;
      }
    }
    const bw = box.offsetWidth, bh = box.offsetHeight;
    x = Math.max(8, Math.min(x, innerWidth - bw - 8));
    y = y + bh > innerHeight - 8 ? Math.max(8, y - bh) : y;
    box.style.left = x + 'px';
    box.style.top = y + 'px';
  }
  box.querySelector('button')?.focus({ preventScroll: true });
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  function close() {
    back.remove();
    box.remove();
    document.removeEventListener('keydown', onKey);
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
  return close;
}

export function openModal({ title, body, actions = [] }) {
  closeOverlay();
  const root = $('#overlay-root');
  const back = h('div.backdrop');
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true' },
    title ? h('h3', title) : null,
    body || null,
    actions.length ? h('div.modal-actions', actions.map((a) => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
      onclick: async () => {
        const r = await a.onClick?.();
        if (r !== false) close();
      },
    }, a.label))) : null);
  const wrap = h('div.modal-wrap', box);
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  root.append(back, wrap);
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input') || box.querySelector('.btn.primary'))?.focus(), 30);
  function close() {
    back.remove();
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
  return close;
}

export function ask(title, { placeholder = '', value = '', ok = 'Готово' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const input = h('input.field', { placeholder, value, maxlength: '80', onkeydown: (e) => { if (e.key === 'Enter') { finish(input.value.trim() || null); close(); } } });
    const close = openModal({ title, body: input, actions: [{ label: 'Отмена', onClick: () => finish(null) }, { label: ok, primary: true, onClick: () => finish(input.value.trim() || null) }] });
    const obs = new MutationObserver(() => { if (!input.isConnected) { obs.disconnect(); finish(null); } });
    obs.observe($('#overlay-root'), { childList: true });
  });
}

export function confirmBox(title, text, okLabel = 'Удалить') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const body = h('p', { style: { margin: '0', color: 'var(--text-2)' } }, text);
    openModal({ title, body, actions: [{ label: 'Отмена', onClick: () => finish(false) }, { label: okLabel, primary: true, onClick: () => finish(true) }] });
    const root = $('#overlay-root');
    const obs = new MutationObserver(() => { if (!body.isConnected) { obs.disconnect(); finish(false); } });
    obs.observe(root, { childList: true });
  });
}

export function chooseAndAdd(tracks) {
  const pick = (p) => {
    close();
    const n = store.addToPlaylist(p.id, tracks);
    toast(n ? `Добавлено в «${p.name}»` : 'Уже есть в этом плейлисте');
  };
  const body = h('div.pick-list',
    h('button.pick-item', {
      onclick: async () => {
        close();
        const name = await ask('Новый плейлист', { placeholder: 'Название плейлиста', ok: 'Создать' });
        if (!name) return;
        const p = store.createPlaylist(name, tracks);
        toast(`Создан плейлист «${p.name}»`);
      },
    }, art('', '+', { ic: 'plus' }), h('div', 'Новый плейлист')),
    store.getPlaylists().map((p) => h('button.pick-item', { onclick: () => pick(p) }, art(coverOf(p.tracks[0]), p.name), h('div', p.name, h('small', tracksWord(p.tracks.length))))));
  const close = openModal({ title: 'Добавить в плейлист', body, actions: [{ label: 'Отмена' }] });
}

export function trackMenu(t, { event, playlistId, index } = {}) {
  const items = [];
  if (t.src === 'rd') {
    const fav = store.isStationFav(t.id);
    items.push({ icon: 'play', label: 'Слушать', action: () => player.playList([t], 0) });
    items.push({ icon: fav ? 'heart-fill' : 'heart', label: fav ? 'Убрать из моих станций' : 'В мои станции', action: () => toast(store.toggleStation(t) ? 'Станция сохранена' : 'Станция убрана') });
  } else {
    const liked = store.isLiked(t.id);
    items.push({ icon: 'play-next', label: 'Играть следующим', action: () => { player.playNext([t]); toast('Будет следующим'); } });
    items.push({ icon: 'queue', label: 'Добавить в очередь', action: () => { player.addToQueue([t]); toast('Добавлено в очередь'); } });
    items.push({ icon: 'playlist-add', label: 'В плейлист…', action: () => chooseAndAdd([t]) });
    items.push({ icon: liked ? 'heart-fill' : 'heart', label: liked ? 'Убрать из любимых' : 'Нравится', action: () => toast(store.toggleLike(t) ? 'Добавлено в «Любимые»' : 'Убрано из «Любимых»') });
    if (t.src === 'dz') {
      if (t.artistId) items.push({ icon: 'artist', label: 'К исполнителю', action: () => go('#/artist/' + t.artistId) });
      if (t.albumId) items.push({ icon: 'album', label: 'К альбому', action: () => go('#/album/' + t.albumId) });
      items.push({ icon: 'external', label: 'Открыть в Deezer', action: () => window.open(`https://www.deezer.com/track/${t.dzId}`, '_blank', 'noopener') });
    }
    if (canOffline(t)) {
      if (isOffline(t.id)) {
        items.push({ icon: 'offline', label: 'Удалить из офлайна', action: async () => { await removeOffline(t.id); toast('Удалено из офлайна'); } });
      } else {
        items.push({
          icon: 'download', label: 'Скачать для офлайна',
          action: async () => {
            toast('Скачиваю…');
            try {
              await download(t);
              toast('Сохранено: можно слушать без интернета');
            } catch (e) {
              toast('Не скачалось: ' + e.message, 4000);
            }
          },
        });
      }
    }
    if (t.src === 'au' && t.link) items.push({ icon: 'external', label: 'Открыть в Audius', action: () => window.open(t.link, '_blank', 'noopener') });
  }
  if (playlistId && index != null) {
    const len = store.getPlaylist(playlistId)?.tracks.length || 0;
    items.push('-');
    if (index > 0) items.push({ icon: 'up', label: 'Переместить выше', action: () => store.moveInPlaylist(playlistId, index, index - 1) });
    if (index < len - 1) items.push({ icon: 'down', label: 'Переместить ниже', action: () => store.moveInPlaylist(playlistId, index, index + 1) });
    items.push({ icon: 'close', label: 'Убрать из плейлиста', action: () => { store.removeFromPlaylist(playlistId, index); toast('Убрано из плейлиста'); } });
  }
  if (t.src === 'lc') {
    items.push('-', {
      icon: 'trash', label: 'Удалить из приложения', danger: true,
      action: async () => {
        if (await confirmBox('Удалить файл?', `«${t.title}» пропадёт из приложения. Файл на диске останется.`)) {
          await deleteLocal(t.id);
          toast('Удалено');
        }
      },
    });
  }
  const header = h('div.menu-head', art(coverOf(t), t.title, { ic: t.src === 'rd' ? 'radio' : null }), h('div', h('div.tr-title', t.title), h('div.tr-sub', t.artist)));
  openMenu(items, { event, header });
}

export function stationCard(s, list, i) {
  return card({
    cover: s.cover, title: s.title, sub: s.artist, ic: 'radio', live: true,
    onClick: () => (player.current?.id === s.id ? player.toggle() : player.playList(list, i)),
    onPlay: () => player.playList(list, i),
    onMenu: (e) => trackMenu(s, { event: e }),
  });
}
