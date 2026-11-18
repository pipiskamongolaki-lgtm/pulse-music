// Точка входа: тема, навигация, плеер, горячие клавиши.
import { $, $$, h, go, isTyping } from './util.js';
import { player, coverOf } from './player.js';
import * as store from './store.js';
import { applyTheme } from './theme.js';
import { canInstall, install, onInstallChange } from './pwa.js';
import { bindGlobalHighlights, toast, art, ask, closeOverlay } from './ui.js';
import { initBar } from './bar.js';
import { initNP, isNPOpen, closeNP } from './np.js';
import { coverColor } from './color.js';
import { listLocal } from './local.js';
import { warmOffline } from './offline.js';
import home from './views/home.js';
import search from './views/search.js';
import radio from './views/radio.js';
import library from './views/library.js';
import settingsView from './views/settings.js';
import * as pages from './views/pages.js';

const routes = [
  [/^(home)?$/, home, 'home'],
  [/^search$/, search, 'search'],
  [/^radio$/, radio, 'radio'],
  [/^library$/, library, 'library'],
  [/^settings$/, settingsView, 'settings'],
  [/^album\/(\d+)$/, pages.album],
  [/^artist\/(\d+)$/, pages.artist],
  [/^playlist\/(\d+)$/, pages.dzPlaylist],
  [/^my\/([\w-]+)$/, pages.myPlaylist, 'library'],
  [/^liked$/, pages.liked, 'library'],
  [/^chart\/(\d+)$/, pages.chart, 'home'],
  [/^audius$/, pages.audius, 'home'],
  [/^local$/, pages.local, 'library'],
  [/^history$/, pages.historyPage, 'library'],
];

const scrollPos = new Map();
let cleanups = [];
let lastKey = null;

function parseHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, qs] = raw.split('?');
  return { path: path.replace(/\/$/, ''), params: new URLSearchParams(qs || '') };
}

function router() {
  if (isNPOpen() && !history.state?.np) closeNP(true);
  closeOverlay();
  if (lastKey) scrollPos.set(lastKey, scrollY);
  const fresh = window.__pulseFreshNav;
  window.__pulseFreshNav = false;
  const { path, params } = parseHash();
  let found = routes.find(([re]) => re.test(path));
  if (!found) found = routes[0];
  const [re, fn, nav] = found;
  const match = path.match(re) || [];
  cleanups.forEach((f) => f());
  cleanups = [];
  const view = $('#view');
  view.className = 'view';
  view.removeAttribute('style');
  view.replaceChildren();
  const ctx = { params, match, onCleanup: (f) => cleanups.push(f) };
  try {
    fn(view, ctx);
  } catch (e) {
    console.error(e);
    view.append(h('div.empty', h('h3', 'Что-то пошло не так'), h('p', String(e.message || e))));
  }
  const key = location.hash || '#/home';
  lastKey = key;
  const navKey = nav || '';
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  $$('.side-pl').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === key));
  const y = fresh ? 0 : scrollPos.get(key) || 0;
  requestAnimationFrame(() => scrollTo(0, y));
}

/* ---------- боковое меню: плейлисты ---------- */
function renderSidePlaylists() {
  const box = $('#side-pls');
  const likes = store.getLikes();
  box.replaceChildren(
    h('a.side-pl', { href: '#/liked' }, art('', 'Любимые', { ic: 'heart-fill' }), h('span', `Любимые треки`)),
    ...store.getPlaylists().map((p) => h('a.side-pl', { href: '#/my/' + p.id }, art(coverOf(p.tracks[0]), p.name), h('span', p.name))));
  box.firstChild.querySelector('.art').style.setProperty('--g', 'linear-gradient(135deg, var(--accent), var(--accent-2))');
  box.firstChild.title = `${likes.length} треков`;
  const key = location.hash;
  $$('.side-pl').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === key));
}

/* ---------- горячие клавиши ---------- */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isNPOpen() && !$('#overlay-root').children.length) return closeNP();
    if (isTyping() || $('#overlay-root').children.length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space' && !mod) {
      e.preventDefault();
      player.toggle();
    } else if (mod && e.key === 'ArrowRight') {
      e.preventDefault();
      player.next();
    } else if (mod && e.key === 'ArrowLeft') {
      e.preventDefault();
      player.prev();
    } else if (mod && e.code === 'KeyF') {
      e.preventDefault();
      if (isNPOpen()) closeNP();
      go('#/search');
      setTimeout(() => $('#search-input')?.focus(), 80);
    } else if (!mod && !e.altKey && !e.shiftKey) {
      if (e.key === 'ArrowRight' && player.current) player.seek(player.time + 5);
      else if (e.key === 'ArrowLeft' && player.current) player.seek(player.time - 5);
      else if (e.code === 'KeyM') player.toggleMute();
      else if (e.code === 'KeyL' && player.current && player.current.src !== 'rd') toast(store.toggleLike(player.current) ? 'Добавлено в «Любимые»' : 'Убрано из «Любимых»');
    }
  });
}

/* ---------- подкраска под обложку ---------- */
function bindTint() {
  let lastCover = null;
  player.on('track', async (t) => {
    if (!t) return;
    document.title = `${t.title} · ${t.artist} — Pulse`;
    const c = coverOf(t);
    if (!c || c === lastCover) return;
    lastCover = c;
    const rgb = await coverColor(c);
    if (rgb && player.current === t) document.documentElement.style.setProperty('--tint', rgb.join(', '));
  });
}

/* ---------- запуск ---------- */
function boot() {
  applyTheme();
  initBar();
  initNP();
  bindGlobalHighlights();
  bindKeys();
  bindTint();
  renderSidePlaylists();
  store.on('playlists', renderSidePlaylists);
  store.on('settings', (p) => {
    if ('theme' in p || 'accent' in p) applyTheme();
  });

  $('#side-new-pl').addEventListener('click', async () => {
    const name = await ask('Новый плейлист', { placeholder: 'Название плейлиста', ok: 'Создать' });
    if (!name) return;
    const p = store.createPlaylist(name);
    go('#/my/' + p.id);
  });
  const installBtn = $('#side-install');
  const syncInstall = () => (installBtn.hidden = !canInstall());
  onInstallChange(syncInstall);
  syncInstall();
  installBtn.addEventListener('click', () => install());

  player.on('notice', (m) => toast(m, 3800));

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (a) window.__pulseFreshNav = true;
  }, true);
  addEventListener('hashchange', router);
  addEventListener('scroll', () => {
    const tb = $('#view .topbar');
    if (tb) tb.classList.toggle('solid', scrollY > 120);
  }, { passive: true });

  // интернет пропал или вернулся: подсказка и обновлённая главная
  const netChange = () => {
    toast(navigator.onLine ? 'Интернет вернулся' : 'Нет интернета: играют скачанные треки и твои файлы', 3500);
    const { path } = parseHash();
    if (path === '' || path === 'home') router();
  };
  addEventListener('online', netChange);
  addEventListener('offline', netChange);
  addEventListener('pulse:db-blocked', () => toast('Pulse открыт в другой вкладке со старой версией. Закрой или обнови ту вкладку', 6000));

  router();
  // свои и скачанные файлы готовим до восстановления сессии, чтобы были обложки и мгновенный старт
  Promise.allSettled([listLocal(), warmOffline()]).finally(() => player.restore());

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

try {
  boot();
  window.__pulseBooted = true;
} catch (e) {
  console.error(e);
  window.__pulseBootFail?.(e.message || e);
}
