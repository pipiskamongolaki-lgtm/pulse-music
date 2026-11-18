// Полноэкранный плеер, очередь и текст песни.
import { $, h, icon, setIcon, fmtTime, go } from './util.js';
import { player, coverOf } from './player.js';
import * as yt from './api/youtube.js';
import { getLyrics } from './api/lyrics.js';
import { art, likeButton, trackMenu, openMenu, toast, emptyState } from './ui.js';
import { modeLabel } from './bar.js';

let np, els = {};
let open = false;
let panelTab = 'lyrics';
let lyr = { id: null, lines: null, nodes: [], active: -1 };
let userScrollAt = 0;

export const isNPOpen = () => open;
const wide = () => window.innerWidth >= 1000;
const panelVisible = () => open && (wide() || np.classList.contains('panel-open'));

export function openNP() {
  if (!player.current || open) return;
  open = true;
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
  document.body.classList.add('np-open');
  if (!history.state?.np) history.pushState({ np: true }, '');
  followYT(520);
  renderPanel();
}

export function closeNP(fromHistory = false) {
  if (!open) return;
  open = false;
  np.classList.remove('open', 'panel-open');
  np.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('np-open');
  if (!fromHistory && history.state?.np) history.back();
  placeYT();
}

export function openPanel(tab) {
  panelTab = tab;
  if (!open) openNP();
  np.classList.add('panel-open');
  renderPanel();
  followYT(450);
}

/* ---------- видео YouTube поверх обложки ---------- */
function placeYT() {
  const st = $('#yt-stage');
  const on = document.body.classList.contains('yt-on');
  els.art?.classList.toggle('video', on && open);
  if (!on || !open) {
    st.removeAttribute('style');
    return;
  }
  if (!wide() && np.classList.contains('panel-open')) {
    // на телефоне при открытом тексте/очереди видео уходит в угол
    Object.assign(st.style, { left: 'auto', top: 'auto', right: '12px', bottom: 'calc(16px + env(safe-area-inset-bottom))', width: '176px', height: '99px' });
    return;
  }
  const r = els.art.getBoundingClientRect();
  Object.assign(st.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', right: 'auto', bottom: 'auto' });
}
function followYT(ms) {
  const end = performance.now() + ms;
  const step = () => {
    placeYT();
    if (performance.now() < end) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- построение экрана ---------- */
export function initNP() {
  np = $('#np');
  els.bg = h('img', { alt: '' });
  els.src = h('b');
  els.art = h('div.np-art');
  els.title = h('h2.np-title');
  els.artist = h('button.np-artist', {
    onclick: () => {
      const t = player.current;
      if (t?.src === 'dz' && t.artistId) {
        closeNP();
        setTimeout(() => go('#/artist/' + t.artistId), 50);
      }
    },
  });
  els.like = h('span');
  els.seek = h('input.range', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Перемотка' });
  els.cur = h('span', '0:00');
  els.dur = h('span', '0:00');
  els.shuffle = h('button.icon-btn.shuffle', { title: 'Перемешивание', 'aria-label': 'Перемешивание', onclick: () => player.toggleShuffle() }, icon('shuffle'));
  els.repeat = h('button.icon-btn.repeat', { title: 'Повтор', 'aria-label': 'Повтор', onclick: () => player.cycleRepeat() }, icon('repeat'));
  els.pp = h('button.icon-btn.playpause', { 'aria-label': 'Играть или пауза', onclick: () => player.toggle() }, icon('play'));
  els.sleepLabel = h('span.sleep-label');
  els.sleep = h('button.icon-btn', { title: 'Таймер сна', 'aria-label': 'Таймер сна', onclick: (e) => sleepMenu(e) }, icon('timer'), els.sleepLabel);
  els.hint = h('div');
  els.panelBody = h('div.np-panel-body');
  els.tabs = h('div.segs',
    h('button.chip', { dataset: { tab: 'lyrics' }, onclick: () => { panelTab = 'lyrics'; renderPanel(); } }, 'Текст'),
    h('button.chip', { dataset: { tab: 'queue' }, onclick: () => { panelTab = 'queue'; renderPanel(); } }, 'Очередь'));

  np.append(
    h('div.np-bg', els.bg),
    h('header.np-head',
      h('button.icon-btn', { title: 'Свернуть (Esc)', 'aria-label': 'Свернуть', onclick: () => closeNP() }, icon('down')),
      h('div.np-src', h('span', 'Сейчас играет'), els.src),
      h('button.icon-btn', { title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => player.current && trackMenu(player.current, { event: e }) }, icon('more'))),
    h('div.np-body',
      h('div.np-main',
        h('div.np-art-wrap', els.art),
        h('div.np-info', h('div', els.title, els.artist), els.like),
        h('div.np-progress', els.seek, h('div.np-times', els.cur, els.dur)),
        h('div.np-controls',
          els.shuffle,
          h('button.icon-btn', { title: 'Назад', 'aria-label': 'Предыдущий', onclick: () => player.prev() }, icon('prev')),
          els.pp,
          h('button.icon-btn', { title: 'Далее', 'aria-label': 'Следующий', onclick: () => player.next() }, icon('next')),
          els.repeat),
        h('div.np-extra',
          h('button.icon-btn.lyrics-btn', { title: 'Текст песни', 'aria-label': 'Текст песни', onclick: () => openPanel('lyrics') }, icon('lyrics')),
          els.sleep,
          h('button.icon-btn.queue-btn', { title: 'Очередь', 'aria-label': 'Очередь', onclick: () => openPanel('queue') }, icon('queue'))),
        els.hint),
      h('aside.np-panel',
        h('div.np-panel-head', els.tabs,
          h('button.icon-btn.close-panel', { title: 'Скрыть', 'aria-label': 'Скрыть', onclick: () => { np.classList.remove('panel-open'); followYT(450); } }, icon('down'))),
        els.panelBody)));

  // перемотка
  let seeking = false;
  els.seek.addEventListener('input', () => {
    seeking = true;
    const p = els.seek.value / 1000;
    els.cur.textContent = fmtTime(p * player.duration);
    els.seek.style.setProperty('--p', p * 100 + '%');
  });
  els.seek.addEventListener('change', () => {
    player.seek((els.seek.value / 1000) * player.duration);
    seeking = false;
  });

  // жесты: свайп по обложке листает треки, вниз сворачивает
  let sx = 0, sy = 0, tracking = false;
  const startSwipe = (e) => { tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  const endSwipe = (e, allowSide) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.3) closeNP();
    else if (allowSide && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) dx < 0 ? player.next() : player.prev();
  };
  els.art.addEventListener('touchstart', startSwipe, { passive: true });
  els.art.addEventListener('touchend', (e) => endSwipe(e, true));
  const head = np.querySelector('.np-head');
  head.addEventListener('touchstart', startSwipe, { passive: true });
  head.addEventListener('touchend', (e) => endSwipe(e, false));
  els.panelBody.addEventListener('wheel', () => (userScrollAt = Date.now()), { passive: true });
  els.panelBody.addEventListener('touchmove', () => (userScrollAt = Date.now()), { passive: true });

  addEventListener('popstate', () => open && closeNP(true));
  addEventListener('resize', () => open && placeYT());

  /* подписки на плеер */
  player.on('track', (t) => {
    if (!t) return closeNP();
    els.art.replaceChildren(art(coverOf(t, true), t.title, { ic: t.src === 'rd' ? 'radio' : null }));
    els.bg.src = coverOf(t, true) || '';
    els.bg.style.display = coverOf(t, true) ? '' : 'none';
    els.title.textContent = t.title;
    els.title.title = t.title;
    els.artist.textContent = t.artist;
    els.like.replaceChildren(t.src === 'rd' ? h('span') : likeButton(t, '.icon-btn.like-btn'));
    renderMode();
    if (panelVisible()) renderPanel();
  });
  player.on('mode', () => {
    renderMode();
    setTimeout(placeYT, 30);
    if (panelVisible() && panelTab === 'lyrics') renderLyrics();
  });
  player.on('status', (s) => {
    els.pp.replaceChildren(s === 'loading' ? h('div.spinner') : icon(s === 'playing' ? 'pause' : 'play'));
  });
  player.on('time', ({ time, duration }) => {
    if (!seeking) {
      const live = player.mode === 'live';
      const p = duration ? Math.min(1, time / duration) : 0;
      els.seek.value = String(Math.round(p * 1000));
      els.seek.style.setProperty('--p', p * 100 + '%');
      els.seek.disabled = live || !duration;
      els.cur.replaceChildren(live ? h('span.np-live', 'В эфире') : fmtTime(time));
      els.dur.textContent = live ? '' : fmtTime(duration);
    }
    syncLyrics(time);
  });
  player.on('modes', () => {
    els.shuffle.classList.toggle('on', player.shuffle);
    els.repeat.classList.toggle('on', player.repeat !== 'off');
    setIcon(els.repeat.querySelector('svg'), player.repeat === 'one' ? 'repeat-one' : 'repeat');
  });
  let qPending = false;
  player.on('queue', () => {
    if (!panelVisible() || panelTab !== 'queue' || qPending) return;
    qPending = true;
    requestAnimationFrame(() => { qPending = false; renderQueue(); });
  });
  player.on('sleep', renderSleep);
  setInterval(renderSleep, 20000);
}

function renderMode() {
  const t = player.current;
  if (!t) return;
  const m = player.mode;
  const parts = { dz: 'Deezer', au: 'Audius', lc: 'Мои файлы', rd: 'Радио' };
  els.src.textContent = m === 'preview' ? 'Превью 30 сек · Deezer'
    : t.src === 'dz' && m === 'full' ? 'Полная версия · YouTube'
    : t.src === 'rd' ? 'Прямой эфир · ' + (t.country || 'Радио')
    : modeLabel(m, t) === 'Мой файл' ? 'Мой файл'
    : 'Полный трек · ' + (parts[t.src] || '');
  if (m === 'preview') {
    const keyed = yt.fullEnabled();
    els.hint.className = 'np-hint';
    els.hint.replaceChildren(icon('info'), h('span',
      keyed ? 'Полная версия на YouTube не нашлась или недоступна, играет превью.'
        : h('span', 'Играет 30-секундное превью. ', h('b', 'Подключи ключ YouTube'), ', и хиты будут играть целиком.')));
    els.hint.onclick = keyed ? null : () => { closeNP(); setTimeout(() => go('#/settings'), 60); };
    els.hint.style.cursor = keyed ? '' : 'pointer';
  } else {
    els.hint.className = '';
    els.hint.replaceChildren();
    els.hint.onclick = null;
  }
}

function renderSleep() {
  const v = player.sleepEndOfTrack ? 'трек' : player.sleepAt ? Math.max(1, Math.ceil((player.sleepAt - Date.now()) / 60000)) + ' мин' : '';
  els.sleepLabel.textContent = v;
  els.sleep.classList.toggle('on', !!v);
}

function sleepMenu(e) {
  const opts = [[15, '15 минут'], [30, '30 минут'], [45, '45 минут'], [60, '1 час'], ['track', 'Когда закончится трек']];
  const items = opts.map(([v, l]) => ({
    icon: 'timer', label: l,
    action: () => {
      player.setSleep(v);
      toast(v === 'track' ? 'Музыка остановится после этого трека' : `Музыка остановится через ${l}`);
    },
  }));
  if (player.sleepAt || player.sleepEndOfTrack) items.push('-', { icon: 'close', label: 'Выключить таймер', action: () => { player.setSleep(0); toast('Таймер выключен'); } });
  openMenu(items, { event: e });
}

/* ---------- панель: текст и очередь ---------- */
function renderPanel() {
  if (!np) return;
  els.tabs.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.tab === panelTab));
  if (!panelVisible()) return;
  if (panelTab === 'lyrics') renderLyrics();
  else renderQueue();
}

async function renderLyrics() {
  const t = player.current;
  lyr = { id: null, lines: null, nodes: [], active: -1 };
  if (!t) return;
  if (t.src === 'rd') {
    els.panelBody.replaceChildren(emptyState('radio', 'Это прямой эфир', 'Для радиостанций текстов нет.'));
    return;
  }
  els.panelBody.replaceChildren(h('div.lyrics', h('p.lyrics-note', 'Ищу текст…')));
  const id = t.id;
  const L = await getLyrics(t);
  if (player.current?.id !== id || panelTab !== 'lyrics') return;
  if (!L || (!L.synced?.length && !L.plain)) {
    els.panelBody.replaceChildren(emptyState('lyrics', L?.instrumental ? 'Это инструментал' : 'Текст не найден',
      L?.instrumental ? 'В этом треке нет слов.' : 'В открытой базе LRCLIB пока нет текста этой песни.'));
    return;
  }
  const canSync = L.synced?.length && player.mode !== 'preview';
  let box;
  if (canSync) {
    const lines = L.synced;
    const nodes = lines.map((l) => h('p', { onclick: () => player.seek(l.t) }, l.text || '♪'));
    box = h('div.lyrics', nodes);
    lyr = { id, lines, nodes, active: -1 };
  } else {
    const text = L.plain || L.synced.map((l) => l.text).join('\n');
    box = h('div.lyrics.plain',
      player.mode === 'preview' && L.synced?.length ? h('p.lyrics-note', icon('info'), 'Во время превью строки не подсвечиваются') : null,
      h('p', text));
  }
  els.panelBody.replaceChildren(box, h('div.lyrics-credit', 'Текст: LRCLIB'));
  els.panelBody.scrollTop = 0;
  if (canSync) syncLyrics(player.time, true);
}

function syncLyrics(time, force = false) {
  if (!lyr.lines || lyr.id !== player.current?.id) return;
  let i = -1;
  for (let k = 0; k < lyr.lines.length; k++) {
    if (lyr.lines[k].t <= time + 0.3) i = k;
    else break;
  }
  if (i === lyr.active && !force) return;
  lyr.nodes.forEach((n, k) => {
    n.classList.toggle('active', k === i);
    n.classList.toggle('past', k < i);
  });
  lyr.active = i;
  const n = lyr.nodes[Math.max(0, i)];
  if (n && panelVisible() && Date.now() - userScrollAt > 3500) {
    const body = els.panelBody;
    const top = n.offsetTop - body.clientHeight * 0.38;
    body.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
  }
}

function qItem(t, orderPos, current = false) {
  return h('div.qi' + (current ? '.current' : ''), {
    dataset: { tid: t.id },
    onclick: (e) => {
      if (e.target.closest('button, .handle')) return;
      if (current) player.toggle();
      else player.jump(orderPos);
    },
  },
  art(coverOf(t), t.title, { ic: t.src === 'rd' ? 'radio' : null }),
  h('div.tr-main', h('div.tr-title', t.title), h('div.tr-sub', t.artist)),
  current ? h('span') : h('button.icon-btn.sm', { title: 'Убрать из очереди', 'aria-label': 'Убрать из очереди', onclick: () => player.removeAt(orderPos) }, icon('close')),
  current ? h('span') : h('div.icon-btn.sm.handle', { title: 'Перетащить', 'aria-label': 'Перетащить' }, icon('drag')));
}

function renderQueue() {
  const t = player.current;
  if (!t) {
    els.panelBody.replaceChildren(emptyState('queue', 'Очередь пуста', 'Включи любой трек, и здесь появится то, что заиграет дальше.'));
    return;
  }
  const scroll = els.panelBody.scrollTop;
  const up = player.order.slice(player.pos + 1);
  const list = h('div');
  up.slice(0, 300).forEach((qi, k) => list.append(qItem(player.queue[qi], player.pos + 1 + k)));
  els.panelBody.replaceChildren(
    h('div.q-label', 'Сейчас играет'),
    qItem(t, player.pos, true),
    h('div.q-label', h('span', up.length ? `Далее · ${up.length}` : 'Далее'), up.length ? h('button', { onclick: () => player.clearUpcoming() }, 'Очистить') : null),
    up.length ? list : h('p', { style: { color: 'rgba(255,255,255,.6)', fontSize: '14px' } }, 'Дальше ничего нет. Добавляй треки через меню «…» → «Добавить в очередь».'),
    up.length > 300 ? h('p', { style: { color: 'rgba(255,255,255,.5)', fontSize: '13px' } }, `и ещё ${up.length - 300}`) : null);
  els.panelBody.scrollTop = scroll;
  sortable(list, (from, to) => player.move(player.pos + 1 + from, player.pos + 1 + to));
}

/** Перетаскивание строк за «ручку» мышью и пальцем. */
function sortable(list, onMove) {
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    const item = handle.closest('.qi');
    e.preventDefault();
    const from = [...list.children].indexOf(item);
    item.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const body = els.panelBody;
    const move = (ev) => {
      const y = ev.clientY;
      const br = body.getBoundingClientRect();
      if (y < br.top + 50) body.scrollTop -= 12;
      else if (y > br.bottom - 50) body.scrollTop += 12;
      let before = null;
      for (const s of list.children) {
        if (s === item) continue;
        const r = s.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = s; break; }
      }
      if (before) { if (item.nextSibling !== before) list.insertBefore(item, before); }
      else if (list.lastChild !== item) list.append(item);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      item.classList.remove('dragging');
      const to = [...list.children].indexOf(item);
      if (to !== from) onMove(from, to);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
