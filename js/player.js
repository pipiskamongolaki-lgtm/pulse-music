// Единый плеер приложения: очередь, перемешивание, повтор, системные кнопки.
// Источники: превью Deezer, полные треки через YouTube, Audius, радио, свои файлы.
import { settings, setSettings, pushHistory, clean } from './store.js';
import * as dz from './api/deezer.js';
import * as yt from './api/youtube.js';
import { streamUrl } from './api/audius.js';
import { click as radioClick } from './api/radio.js';
import { localUrl, localUrlSync, localCover } from './local.js';
import { isOffline, offlineUrl, offlineUrlSync, offlineCover } from './offline.js';
import { shuffled } from './util.js';

const SESSION = 'pulse:session';

export const coverOf = (t, big = false) => (!t ? '' : t.src === 'lc' ? localCover(t) : offlineCover(t.id) || (big && t.coverBig) || t.cover || '');

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off';
    this.backend = 'audio';
    this.mode = null; // preview | full | live
    this.status = 'idle'; // idle | loading | playing | paused
    this.wantPlay = false;
    this.token = 0;
    this.listened = 0;
    this.recorded = false;
    this.lastTick = 0;
    this.lastPersist = 0;
    this.lastPos = 0;
    this.errorCount = 0;
    this.pendingSeek = 0;
    this.needsLoad = false;
    this.sleepAt = 0;
    this.sleepEndOfTrack = false;
    this.notices = new Map();
    this.ytp = null;
    this.ytIds = [];
    this.ytIdx = 0;
    this._bindAudio();
    this._bindMediaSession();
    this._applyVolume();
    addEventListener('pagehide', () => this._persist());
    document.addEventListener('visibilitychange', () => document.hidden && this._persist());
  }

  on(type, fn) {
    const f = (e) => fn(e.detail);
    this.addEventListener(type, f);
    return () => this.removeEventListener(type, f);
  }
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /* ---------- состояние ---------- */
  get current() {
    return this.pos >= 0 && this.pos < this.order.length ? this.queue[this.order[this.pos]] : null;
  }
  get upcoming() {
    return this.order.slice(this.pos + 1).map((i) => this.queue[i]);
  }
  get time() {
    if (this.needsLoad) return this.pendingSeek;
    if (this.backend === 'yt') return this.ytp?.getCurrentTime?.() || 0;
    return this.audio.currentTime || 0;
  }
  get duration() {
    const t = this.current;
    if (!t || this.mode === 'live' || t.src === 'rd') return 0;
    if (this.backend === 'yt' && !this.needsLoad) return this.ytp?.getDuration?.() || t.duration || 0;
    const d = this.audio.duration;
    if (!this.needsLoad && isFinite(d) && d > 0) return d;
    return this.mode === 'preview' ? 30 : t.duration || 0;
  }
  get playing() {
    return this.status === 'playing';
  }

  /* ---------- очередь ---------- */
  playList(tracks, start = 0, { shuffle } = {}) {
    if (!tracks?.length) return;
    this.queue = tracks.slice();
    const all = this.queue.map((_, i) => i);
    if (shuffle !== undefined) this.shuffle = shuffle;
    start = Math.max(0, Math.min(start, all.length - 1));
    if (this.shuffle) {
      this.order = [start, ...shuffled(all.filter((i) => i !== start))];
      this.pos = 0;
    } else {
      this.order = all;
      this.pos = start;
    }
    this.needsLoad = false;
    this.errorCount = 0;
    this._queueChanged();
    this._load(true);
  }

  playNext(tracks) {
    if (!this.current) return this.playList(tracks, 0);
    const base = this.queue.length;
    this.queue.push(...tracks);
    this.order.splice(this.pos + 1, 0, ...tracks.map((_, i) => base + i));
    this._queueChanged();
  }

  addToQueue(tracks) {
    if (!this.current) {
      this.queue = tracks.slice();
      this.order = this.queue.map((_, i) => i);
      this.pos = 0;
      this._queueChanged();
      this._load(false);
      return;
    }
    const base = this.queue.length;
    this.queue.push(...tracks);
    this.order.push(...tracks.map((_, i) => base + i));
    this._queueChanged();
  }

  removeAt(orderPos) {
    if (orderPos === this.pos || orderPos < 0 || orderPos >= this.order.length) return;
    this.order.splice(orderPos, 1);
    if (orderPos < this.pos) this.pos--;
    this._queueChanged();
  }

  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.order.length || to >= this.order.length) return;
    const [x] = this.order.splice(from, 1);
    this.order.splice(to, 0, x);
    if (from === this.pos) this.pos = to;
    else if (from < this.pos && to >= this.pos) this.pos--;
    else if (from > this.pos && to <= this.pos) this.pos++;
    this._queueChanged();
  }

  clearUpcoming() {
    this.order.splice(this.pos + 1);
    this._queueChanged();
  }

  jump(orderPos) {
    if (orderPos < 0 || orderPos >= this.order.length) return;
    this.pos = orderPos;
    this.needsLoad = false;
    this._load(true);
    this._queueChanged();
  }

  toggleShuffle() {
    const cur = this.order[this.pos];
    this.shuffle = !this.shuffle;
    if (this.current) {
      const all = this.queue.map((_, i) => i);
      if (this.shuffle) {
        this.order = [cur, ...shuffled(all.filter((i) => i !== cur))];
        this.pos = 0;
      } else {
        this.order = all;
        this.pos = cur;
      }
    }
    this._queueChanged();
    this._emit('modes');
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this._persistSoon();
    this._emit('modes');
  }

  /* ---------- управление ---------- */
  next(auto = false) {
    if (!this.order.length) return;
    if (auto && this.repeat === 'one' && this.mode !== 'live') {
      this.seek(0);
      this.play();
      return;
    }
    if (this.pos < this.order.length - 1) {
      this.pos++;
      this.needsLoad = false;
      this._load(true);
    } else {
      // конец очереди: с повтором играем сначала, без повтора встаём на первый трек на паузе
      this.pos = 0;
      this.needsLoad = false;
      this._load(this.repeat === 'all');
    }
    this._queueChanged();
  }

  prev() {
    if (!this.current) return;
    if (this.time > 3 && this.mode !== 'live') return this.seek(0);
    if (this.pos > 0) {
      this.pos--;
      this.needsLoad = false;
      this._load(true);
      this._queueChanged();
    } else {
      this.seek(0);
    }
  }

  toggle() {
    if (!this.current) return;
    if (this.status === 'playing' || (this.status === 'loading' && this.wantPlay)) this.pause();
    else this.play();
  }

  play() {
    if (!this.current) return;
    this.wantPlay = true;
    if (this.needsLoad || this.status === 'idle') {
      const at = this.needsLoad ? this.pendingSeek : 0;
      this.needsLoad = false;
      this.pendingSeek = 0;
      return this._load(true, at);
    }
    if (this.backend === 'yt' && this.ytp) {
      this.ytp.playVideo();
      return;
    }
    if (this.mode === 'live' && this.pausedAt && Date.now() - this.pausedAt > 5000) {
      this.audio.src = this.current.url; // радио: возвращаемся в прямой эфир
    }
    this.audio.play().catch((e) => this._playFailed(e));
  }

  pause() {
    this.wantPlay = false;
    this.pausedAt = Date.now();
    if (this.backend === 'yt') this.ytp?.pauseVideo?.();
    else this.audio.pause();
    this._setStatus(this.current ? 'paused' : 'idle');
    this._persist();
  }

  seek(sec) {
    if (!this.current || this.mode === 'live') return;
    const d = this.duration;
    sec = Math.max(0, d ? Math.min(sec, d - 0.25) : sec);
    if (this.needsLoad) this.pendingSeek = sec;
    else if (this.backend === 'yt') this.ytp?.seekTo?.(sec, true);
    else {
      try {
        this.audio.currentTime = sec;
      } catch { /* ещё не загрузилось */ }
    }
    this._emit('time', { time: sec, duration: d });
  }

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    setSettings({ volume: v, muted: v === 0 ? settings.muted : false });
    this._applyVolume();
  }
  toggleMute() {
    setSettings({ muted: !settings.muted });
    this._applyVolume();
  }
  _applyVolume() {
    const v = settings.muted ? 0 : settings.volume;
    this.audio.volume = settings.volume;
    this.audio.muted = !!settings.muted;
    try {
      this.ytp?.setVolume?.(Math.round(v * 100));
    } catch { /* плеер ещё не готов */ }
    this._emit('volume', v);
  }

  setSleep(value) {
    clearTimeout(this.sleepTimer);
    this.sleepEndOfTrack = value === 'track';
    this.sleepAt = 0;
    if (typeof value === 'number' && value > 0) {
      this.sleepAt = Date.now() + value * 60e3;
      this.sleepTimer = setTimeout(() => {
        this.sleepAt = 0;
        this.pause();
        this._notice('Таймер сна: музыка на паузе');
        this._emit('sleep', null);
      }, value * 60e3);
    }
    this._emit('sleep', this.sleepEndOfTrack ? 'track' : this.sleepAt || null);
  }

  /* ---------- загрузка трека ---------- */
  async _load(autoplay, startAt = 0) {
    const t = this.current;
    if (!t) return;
    const token = ++this.token;
    this.wantPlay = autoplay;
    this.listened = 0;
    this.recorded = false;
    this.retried = false;
    this.lastTick = 0;
    this.needsLoad = false;
    this.pendingSeek = 0;
    const seekTo = t.src === 'rd' ? 0 : startAt;
    this._setStatus(autoplay ? 'loading' : 'paused');
    this._emit('track', t);
    this._emit('time', { time: seekTo, duration: t.duration || 0 });
    this._updateMeta(t);
    this._persistSoon();

    // 1) полная версия через YouTube, если есть ключ
    if (t.src === 'dz' && yt.fullEnabled()) {
      try {
        const ids = await yt.findVideos(t);
        if (token !== this.token) return;
        if (ids.length) return this._useYT(t, ids, autoplay, seekTo, token);
      } catch (e) {
        if (token !== this.token) return;
        this._notice(yt.explain(e), 'yt');
      }
    }

    // 2) обычный аудиоплеер (без await, если ссылка уже есть: так браузер разрешает автозапуск)
    let url = this._syncUrl(t);
    if (!url) {
      try {
        url = await this._asyncUrl(t);
      } catch (e) {
        if (token === this.token) this._fail(t, e);
        return;
      }
      if (token !== this.token) return;
    }
    this._useAudio(t, url, autoplay, seekTo);
  }

  _syncUrl(t) {
    if (isOffline(t.id)) {
      const u = offlineUrlSync(t);
      if (u) return u;
      return null; // скачан, но ссылка ещё не готова: возьмём из памяти асинхронно
    }
    if (t.src === 'au') return streamUrl(t);
    if (t.src === 'rd') return t.url;
    if (t.src === 'lc') return localUrlSync(t);
    if (t.src === 'dz') return dz.hasFreshPreview(t) ? t.preview : null;
    return null;
  }
  async _asyncUrl(t) {
    if (isOffline(t.id)) {
      const u = await offlineUrl(t);
      if (u) return u;
      if (t.src === 'au') return streamUrl(t);
    }
    if (t.src === 'lc') return localUrl(t);
    if (t.src === 'dz') {
      const u = await dz.freshPreview(t);
      if (!u) throw new Error('У этого трека нет превью');
      return u;
    }
    throw new Error('Неизвестный источник');
  }

  _useAudio(t, url, autoplay, seekTo) {
    this._stopYT();
    this.backend = 'audio';
    this.needsLoad = false;
    this.mode = t.src === 'rd' ? 'live' : t.src === 'dz' ? 'preview' : 'full';
    this._emit('mode', this.mode);
    const a = this.audio;
    a.src = url;
    if (t.src === 'rd') radioClick(t);
    if (seekTo > 0) {
      const f = () => {
        a.removeEventListener('loadedmetadata', f);
        try {
          a.currentTime = seekTo;
        } catch { /* пропускаем */ }
      };
      a.addEventListener('loadedmetadata', f);
    }
    if (autoplay) a.play().catch((e) => this._playFailed(e));
    else this._setStatus('paused');
    this._prefetchNext();
  }

  _prefetchNext() {
    const n = this.order[this.pos + 1] !== undefined ? this.queue[this.order[this.pos + 1]] : null;
    if (!n) return;
    if (n.src === 'dz' && !yt.fullEnabled()) dz.freshPreview(n).catch(() => {});
    if (n.src === 'lc') localUrl(n).catch(() => {});
  }

  _playFailed(e) {
    if (e?.name === 'AbortError') return; // трек сменился, это нормально
    if (e?.name === 'NotAllowedError') {
      // браузер не дал включить звук без нажатия: ждём кнопку «Играть»
      this.wantPlay = false;
      this._setStatus('paused');
      return;
    }
    // остальные ошибки придут событием error
  }

  _fail(t, e) {
    console.warn('Ошибка воспроизведения', t?.title, e);
    this.errorCount++;
    this._notice(t?.src === 'rd'
      ? `Станция «${t.title}» сейчас не отвечает${this.order.length > 1 ? ', включаю следующую' : ''}`
      : `Не получилось включить «${t?.title || 'трек'}»`, 'fail:' + t?.id);
    if (this.errorCount < 5 && this.order.length > 1 && this.wantPlay) {
      setTimeout(() => this.current === t && this.next(true), 1200);
    } else {
      this.wantPlay = false;
      this._setStatus('paused');
    }
  }

  _bindAudio() {
    const a = this.audio;
    a.addEventListener('playing', () => {
      if (this.backend !== 'audio') return;
      this.errorCount = 0;
      this._setStatus('playing');
    });
    a.addEventListener('pause', () => {
      if (this.backend !== 'audio' || this.status === 'loading' || a.ended) return;
      this._setStatus('paused');
    });
    a.addEventListener('waiting', () => {
      if (this.backend === 'audio' && this.wantPlay) this._setStatus('loading');
    });
    a.addEventListener('timeupdate', () => this.backend === 'audio' && this._tick());
    a.addEventListener('durationchange', () => this.backend === 'audio' && this._emit('time', { time: this.time, duration: this.duration }));
    a.addEventListener('ended', () => this.backend === 'audio' && this._ended());
    a.addEventListener('error', () => {
      if (this.backend !== 'audio' || !a.getAttribute('src')) return;
      const t = this.current;
      if (!t) return;
      if (t.src === 'dz' && !this.retried) {
        // ссылка на превью могла устареть: берём новую и пробуем ещё раз
        this.retried = true;
        const token = this.token;
        dz.freshPreview(t, true).then((u) => {
          if (token === this.token && u) {
            a.src = u;
            if (this.wantPlay) a.play().catch((e) => this._playFailed(e));
          }
        }).catch((e) => token === this.token && this._fail(t, e));
        return;
      }
      this._fail(t, a.error);
    });
  }

  _tick() {
    const t = this.current;
    if (!t) return;
    const time = this.time;
    const now = performance.now();
    if (this.status === 'playing') {
      if (this.lastTick) {
        const dt = (now - this.lastTick) / 1000;
        if (dt > 0 && dt < 3) this.listened += dt;
      }
      this.lastTick = now;
    } else {
      this.lastTick = 0;
    }
    const dur = this.duration;
    if (!this.recorded) {
      const need = this.mode === 'live' ? 60 : Math.max(10, Math.min(90, (dur || 30) * 0.5));
      if (this.listened >= need) {
        this.recorded = true;
        pushHistory(t);
      }
    }
    this._emit('time', { time, duration: dur });
    if (now - this.lastPersist > 5000) {
      this.lastPersist = now;
      this._persist();
    }
    const ms = navigator.mediaSession;
    if (ms?.setPositionState && dur > 0 && isFinite(dur) && now - this.lastPos > 1000) {
      this.lastPos = now;
      try {
        ms.setPositionState({ duration: dur, playbackRate: 1, position: Math.min(time, dur) });
      } catch { /* не все браузеры */ }
    }
  }

  _ended() {
    if (this.sleepEndOfTrack) {
      this.sleepEndOfTrack = false;
      this.pause();
      this._notice('Таймер сна: трек закончился, музыка на паузе');
      this._emit('sleep', null);
      return;
    }
    this.next(true);
  }

  /* ---------- YouTube ---------- */
  async _useYT(t, ids, autoplay, seekTo, token) {
    try {
      await yt.ytReady();
    } catch (e) {
      if (token !== this.token) return;
      this._notice(yt.explain(e), 'yt');
      return this._fallbackToPreview(t, autoplay);
    }
    if (token !== this.token) return;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.backend = 'yt';
    this.mode = 'full';
    this.needsLoad = false;
    this.ytIds = ids;
    this.ytIdx = 0;
    document.body.classList.add('yt-on');
    this._emit('mode', this.mode);
    const videoId = ids[0];
    if (!this.ytp) {
      await new Promise((resolve) => {
        this.ytp = new window.YT.Player('yt-player', {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, iv_load_policy: 3, fs: 0, cc_load_policy: 0, autoplay: autoplay ? 1 : 0, start: Math.floor(seekTo || 0), origin: location.origin },
          events: {
            onReady: () => {
              this._applyVolume();
              resolve();
            },
            onStateChange: (e) => this._ytState(e),
            onError: (e) => this._ytError(e),
          },
        });
      });
      if (token !== this.token) return;
      if (autoplay) this.ytp.playVideo();
    } else {
      const opts = { videoId, startSeconds: seekTo || 0 };
      if (autoplay) this.ytp.loadVideoById(opts);
      else this.ytp.cueVideoById(opts);
      this._applyVolume();
    }
    if (!autoplay) this._setStatus('paused');
    else {
      setTimeout(() => {
        // если браузер не дал запустить видео без нажатия, показываем кнопку «Играть»
        if (token === this.token && this.backend === 'yt' && this.status === 'loading') {
          const st = this.ytp?.getPlayerState?.();
          if (st !== 1 && st !== 3) this._setStatus('paused');
        }
      }, 3500);
    }
    clearInterval(this.ytPoll);
    this.ytPoll = setInterval(() => this.backend === 'yt' && this._tick(), 250);
  }

  _ytState(e) {
    if (this.backend !== 'yt') return;
    const S = window.YT.PlayerState;
    if (e.data === S.PLAYING) {
      this.errorCount = 0;
      this.wantPlay = true;
      this._setStatus('playing');
      try {
        this.ytp.unloadModule('captions'); // субтитры поверх «обложки» не нужны
      } catch { /* модуля нет */ }
    } else if (e.data === S.PAUSED) {
      if (this.status !== 'loading') this._setStatus('paused');
    } else if (e.data === S.BUFFERING) {
      if (this.wantPlay) this._setStatus('loading');
    } else if (e.data === S.ENDED) {
      this._ended();
    } else if (e.data === S.CUED && !this.wantPlay) {
      this._setStatus('paused');
    }
  }

  _ytError() {
    if (this.backend !== 'yt') return;
    const t = this.current;
    this.ytIdx++;
    if (this.ytIdx < this.ytIds.length && this.ytIdx < 4) {
      this.ytp.loadVideoById(this.ytIds[this.ytIdx]);
      return;
    }
    yt.forget(t.id);
    this._fallbackToPreview(t, true);
  }

  _fallbackToPreview(t, autoplay) {
    const token = ++this.token;
    this._stopYT();
    dz.freshPreview(t)
      .then((u) => token === this.token && this._useAudio(t, u, autoplay, 0))
      .catch((e) => token === this.token && this._fail(t, e));
  }

  _stopYT() {
    if (this.backend === 'yt') {
      try {
        this.ytp?.stopVideo?.();
      } catch { /* уже остановлен */ }
      this.backend = 'audio';
    }
    document.body.classList.remove('yt-on');
    clearInterval(this.ytPoll);
    this.ytPoll = null;
  }

  /* ---------- система ---------- */
  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    document.body.classList.toggle('is-playing', s === 'playing');
    if (navigator.mediaSession) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : this.current ? 'paused' : 'none';
    this._emit('status', s);
  }

  _notice(msg, key = msg) {
    const last = this.notices.get(key) || 0;
    if (Date.now() - last < 30000) return;
    this.notices.set(key, Date.now());
    this._emit('notice', msg);
  }

  _bindMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (a, f) => {
      try {
        ms.setActionHandler(a, f);
      } catch { /* действие не поддерживается */ }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('stop', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('seekbackward', (d) => this.seek(this.time - (d.seekOffset || 10)));
    set('seekforward', (d) => this.seek(this.time + (d.seekOffset || 10)));
  }

  _updateMeta(t) {
    const ms = navigator.mediaSession;
    if (!ms || !window.MediaMetadata) return;
    const small = coverOf(t);
    const big = coverOf(t, true);
    try {
      ms.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: t.src === 'rd' ? 'Радио' : t.album || '',
        artwork: small ? [{ src: small, sizes: '250x250', type: 'image/jpeg' }, { src: big, sizes: '1000x1000', type: 'image/jpeg' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch { /* старый браузер */ }
  }

  _queueChanged() {
    this._emit('queue');
    this._persistSoon();
  }
  _persistSoon() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this._persist(), 400);
  }
  _persist() {
    if (!this.current) return;
    try {
      // храним до 600 треков вокруг текущего
      let { queue, order, pos } = this;
      if (order.length > 600) {
        const from = Math.max(0, pos - 100);
        const ids = order.slice(from, from + 600);
        queue = ids.map((i) => this.queue[i]);
        order = queue.map((_, i) => i);
        pos -= from;
      } else {
        const used = [...new Set(order)];
        const remap = new Map(used.map((qi, k) => [qi, k]));
        queue = used.map((qi) => this.queue[qi]);
        order = order.map((qi) => remap.get(qi));
      }
      localStorage.setItem(SESSION, JSON.stringify({
        queue: queue.map(clean), order, pos, time: this.mode === 'live' ? 0 : this.time, shuffle: this.shuffle, repeat: this.repeat,
      }));
    } catch { /* нет места */ }
  }

  /** После перезапуска: та же очередь, трек и секунда, но без автозапуска. */
  restore() {
    let s;
    try {
      s = JSON.parse(localStorage.getItem(SESSION) || 'null');
    } catch {
      s = null;
    }
    if (!s?.queue?.length) return false;
    this.queue = s.queue;
    const valid = Array.isArray(s.order) && s.order.every((i) => Number.isInteger(i) && i >= 0 && i < s.queue.length);
    this.order = valid && s.order.length ? s.order : s.queue.map((_, i) => i);
    this.pos = Math.max(0, Math.min(s.pos || 0, this.order.length - 1));
    this.shuffle = !!s.shuffle;
    this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
    const t = this.current;
    this.mode = t.src === 'rd' ? 'live' : t.src === 'dz' && !yt.fullEnabled() ? 'preview' : 'full';
    this.pendingSeek = t.src === 'rd' ? 0 : s.time || 0;
    this.needsLoad = true;
    this.status = 'paused';
    this._emit('track', t);
    this._emit('mode', this.mode);
    this._emit('status', 'paused');
    this._emit('queue');
    this._emit('modes');
    this._emit('time', { time: this.pendingSeek, duration: this.duration });
    this._updateMeta(t);
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
    return true;
  }
}

export const player = new Player();
