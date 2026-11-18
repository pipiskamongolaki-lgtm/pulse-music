// Нижний плеер: мини-плеер на телефоне и полноценная панель на компьютере.
import { $, h, icon, setIcon, fmtTime } from './util.js';
import { player, coverOf } from './player.js';
import { settings } from './store.js';
import * as store from './store.js';
import { art, likeButton, toast } from './ui.js';
import { openNP, openPanel } from './np.js';

export function modeLabel(mode, t) {
  if (!t) return '';
  if (t.src === 'rd') return 'Прямой эфир';
  if (mode === 'preview') return 'Превью 30 сек';
  if (t.src === 'au') return 'Audius';
  if (t.src === 'lc') return 'Мой файл';
  if (mode === 'full' && t.src === 'dz') return 'YouTube';
  return '';
}

export function initBar() {
  const bar = $('#bar');
  const coverBox = h('div');
  const title = h('div.bar-title');
  const artist = h('div.bar-artist');
  const likeSlot = h('span');
  const left = h('div.bar-left', { title: 'Открыть плеер' }, coverBox, h('div.bar-meta', title, artist), likeSlot);
  left.addEventListener('click', (e) => !e.target.closest('button') && openNP());

  const shuffleB = h('button.icon-btn.sm.shuffle', { title: 'Перемешивание', 'aria-label': 'Перемешивание', onclick: () => player.toggleShuffle() }, icon('shuffle'));
  const prevB = h('button.icon-btn.prev', { title: 'Назад (Ctrl+←)', 'aria-label': 'Предыдущий', onclick: () => player.prev() }, icon('prev'));
  const ppB = h('button.icon-btn.playpause', { title: 'Играть / пауза (пробел)', 'aria-label': 'Играть или пауза', onclick: () => player.toggle() }, icon('play'));
  const nextB = h('button.icon-btn.next', { title: 'Далее (Ctrl+→)', 'aria-label': 'Следующий', onclick: () => player.next() }, icon('next'));
  const repeatB = h('button.icon-btn.sm.repeat', { title: 'Повтор', 'aria-label': 'Повтор', onclick: () => player.cycleRepeat() }, icon('repeat'));
  const cur = h('span', '0:00');
  const dur = h('span', '0:00');
  const seek = h('input.range', { type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Перемотка' });
  const line = h('i');

  const volB = h('button.icon-btn.sm', { title: 'Звук (M)', 'aria-label': 'Выключить звук', onclick: () => player.toggleMute() }, icon('volume'));
  const vol = h('input.range.vol', { type: 'range', min: '0', max: '100', value: String(Math.round(settings.volume * 100)), 'aria-label': 'Громкость' });
  vol.addEventListener('input', () => player.setVolume(vol.value / 100));
  const right = h('div.bar-right',
    h('button.icon-btn.sm', { title: 'Текст песни', 'aria-label': 'Текст песни', onclick: () => openPanel('lyrics') }, icon('lyrics')),
    h('button.icon-btn.sm', { title: 'Очередь', 'aria-label': 'Очередь', onclick: () => openPanel('queue') }, icon('queue')),
    volB, vol,
    h('button.icon-btn.sm', { title: 'Полный экран', 'aria-label': 'Открыть плеер', onclick: () => openNP() }, icon('up')));

  bar.append(
    left,
    h('div.bar-center', h('div.bar-controls', shuffleB, prevB, ppB, nextB, repeatB), h('div.bar-progress', cur, seek, dur)),
    right,
    h('div.bar-line', line));

  // свайп вверх по мини-плееру открывает полный плеер
  let sy = null;
  bar.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  bar.addEventListener('touchmove', (e) => {
    if (sy != null && sy - e.touches[0].clientY > 40) {
      sy = null;
      openNP();
    }
  }, { passive: true });

  let seeking = false;
  seek.addEventListener('input', () => {
    seeking = true;
    const p = seek.value / 1000;
    cur.textContent = fmtTime(p * player.duration);
    seek.style.setProperty('--p', p * 100 + '%');
  });
  seek.addEventListener('change', () => {
    player.seek((seek.value / 1000) * player.duration);
    seeking = false;
  });

  const renderArtist = () => {
    const t = player.current;
    if (!t) return;
    const m = modeLabel(player.mode, t);
    const badge = m && (player.mode === 'preview' || t.src === 'rd') ? h('span.badge' + (player.mode === 'preview' ? '' : '.full'), player.mode === 'preview' ? '30с' : 'LIVE') : null;
    artist.replaceChildren(...[badge, t.artist].filter(Boolean));
  };

  player.on('track', (t) => {
    bar.hidden = !t;
    document.body.classList.toggle('has-track', !!t);
    if (!t) return;
    coverBox.replaceChildren(art(coverOf(t), t.title, { ic: t.src === 'rd' ? 'radio' : null }));
    title.textContent = t.title;
    renderArtist();
    if (t.src === 'rd') {
      const fav = store.isStationFav(t.id);
      const b = h('button.icon-btn.sm.like-btn' + (fav ? '.liked' : ''), {
        title: 'В мои станции', 'aria-label': 'В мои станции',
        onclick: () => {
          const v = store.toggleStation(t);
          b.classList.toggle('liked', v);
          setIcon(b.querySelector('svg'), v ? 'heart-fill' : 'heart');
          toast(v ? 'Станция сохранена' : 'Станция убрана');
        },
      }, icon(fav ? 'heart-fill' : 'heart'));
      likeSlot.replaceChildren(b);
    } else {
      likeSlot.replaceChildren(likeButton(t, '.icon-btn.sm.like-btn.like'));
    }
  });
  player.on('mode', renderArtist);
  player.on('status', (s) => {
    ppB.replaceChildren(s === 'loading' ? h('div.spinner') : icon(s === 'playing' ? 'pause' : 'play'));
  });
  player.on('time', ({ time, duration }) => {
    if (seeking) return;
    const live = player.mode === 'live';
    const p = duration ? Math.min(1, time / duration) : 0;
    seek.value = String(Math.round(p * 1000));
    seek.style.setProperty('--p', p * 100 + '%');
    seek.disabled = live || !duration;
    cur.textContent = live ? '' : fmtTime(time);
    dur.textContent = live ? 'LIVE' : fmtTime(duration);
    line.style.width = (live ? 100 : p * 100) + '%';
  });
  player.on('modes', () => {
    shuffleB.classList.toggle('on', player.shuffle);
    repeatB.classList.toggle('on', player.repeat !== 'off');
    setIcon(repeatB.querySelector('svg'), player.repeat === 'one' ? 'repeat-one' : 'repeat');
  });
  player.on('volume', (v) => {
    if (document.activeElement !== vol) vol.value = String(Math.round((settings.muted ? 0 : settings.volume) * 100));
    vol.style.setProperty('--p', (settings.muted ? 0 : settings.volume) * 100 + '%');
    setIcon(volB.querySelector('svg'), v === 0 ? 'volume-off' : 'volume');
  });
  vol.style.setProperty('--p', settings.volume * 100 + '%');
}
