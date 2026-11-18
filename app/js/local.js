// Свои файлы: копируются в хранилище браузера и играют без интернета.
import { idbAll, idbDel, idbGet, idbPut } from './idb.js';
import { emit } from './store.js';
import { uid } from './util.js';

const EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm)$/i;
const urls = new Map(); // id -> objectURL файла
const coverUrls = new Map(); // id -> objectURL обложки
let cachedList = null;

export const isAudioFile = (f) => (f.type && f.type.startsWith('audio/')) || EXT.test(f.name);

export async function listLocal() {
  if (cachedList) return cachedList;
  const metas = await idbAll('local').catch(() => []);
  metas.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  await Promise.all(metas.map(async (m) => {
    if (m.hasCover && !coverUrls.has(m.id)) {
      const blob = await idbGet('covers', m.id).catch(() => null);
      if (blob) coverUrls.set(m.id, URL.createObjectURL(blob));
    }
  }));
  cachedList = metas.map(toTrack);
  return cachedList;
}

function toTrack(m) {
  const cover = coverUrls.get(m.id) || '';
  return { id: m.id, src: 'lc', title: m.title, artist: m.artist, album: m.album || 'Мои файлы', duration: m.duration || 0, cover, coverBig: cover, fileName: m.fileName };
}

/** Обложка локального трека (blob-ссылки не переживают перезагрузку, поэтому берём заново). */
export function localCover(t) {
  return coverUrls.get(t.id) || '';
}

export async function localUrl(t) {
  if (urls.has(t.id)) return urls.get(t.id);
  const blob = await idbGet('files', t.id);
  if (!blob) throw new Error('Файл не найден в хранилище');
  const u = URL.createObjectURL(blob);
  urls.set(t.id, u);
  return u;
}
export const localUrlSync = (t) => urls.get(t.id) || null;

export async function deleteLocal(id) {
  await idbDel('files', id).catch(() => {});
  await idbDel('covers', id).catch(() => {});
  await idbDel('local', id).catch(() => {});
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
  cachedList = null;
  emit('local');
}

export async function importFiles(fileList, onProgress = () => {}) {
  const files = [...fileList].filter(isAudioFile);
  const existing = await idbAll('local').catch(() => []);
  const seen = new Set(existing.map((m) => m.fileName + '|' + m.size));
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(i, files.length, f.name);
    if (seen.has(f.name + '|' + f.size)) { skipped++; continue; }
    try {
      const tags = await readTags(f).catch(() => ({}));
      const fromName = parseName(f.name);
      const id = 'lc:' + uid();
      const meta = {
        id,
        fileName: f.name,
        size: f.size,
        title: tags.title || fromName.title,
        artist: tags.artist || fromName.artist || 'Неизвестный исполнитель',
        album: tags.album || '',
        duration: await probeDuration(f),
        hasCover: !!tags.picture,
        addedAt: Date.now() + i,
      };
      await idbPut('files', id, f);
      if (tags.picture) await idbPut('covers', id, tags.picture);
      await idbPut('local', id, meta);
      seen.add(f.name + '|' + f.size);
      added++;
    } catch (e) {
      console.warn('Не удалось добавить', f.name, e);
      failed++;
    }
  }
  onProgress(files.length, files.length, '');
  cachedList = null;
  emit('local');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return { added, skipped, failed, total: files.length };
}

function parseName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-_]+/, '').trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base };
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const u = URL.createObjectURL(file);
    const done = (d) => {
      URL.revokeObjectURL(u);
      a.removeAttribute('src');
      resolve(d);
    };
    const t = setTimeout(() => done(0), 4000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(t); done(isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { clearTimeout(t); done(0); };
    a.src = u;
  });
}

/* ---------- Чтение тегов ---------- */
async function readTags(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const sig = String.fromCharCode(...head.slice(0, 4));
  if (sig.startsWith('ID3')) {
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    const buf = new Uint8Array(await file.slice(0, Math.min(size + 10, 12e6)).arrayBuffer());
    return parseId3(buf);
  }
  if (sig === 'fLaC') {
    const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 12e6)).arrayBuffer());
    return parseFlac(buf);
  }
  return {};
}

const td = (enc) => { try { return new TextDecoder(enc); } catch { return new TextDecoder(); } };
const latin = td('windows-1251'); // старые русские теги почти всегда в cp1251
const utf8 = td('utf-8');
const utf16 = td('utf-16le');
const utf16be = td('utf-16be');

function decodeText(enc, bytes) {
  let s;
  if (enc === 0) s = latin.decode(bytes);
  else if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) s = utf16be.decode(bytes.subarray(2));
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) s = utf16.decode(bytes.subarray(2));
    else s = utf16.decode(bytes);
  } else if (enc === 2) s = utf16be.decode(bytes);
  else s = utf8.decode(bytes);
  return s.replace(/\0+$/g, '').split('\0')[0].trim();
}

function parseId3(b) {
  const ver = b[3];
  const out = {};
  let p = 10;
  if (b[5] & 0x40) { // расширенный заголовок
    const ext = ver === 4 ? syncsafe(b, 10) : be32(b, 10) + 4;
    p += ext;
  }
  const end = b.length;
  while (p + 10 < end) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    const data = b.subarray(p + 10, p + 10 + size);
    p += 10 + size;
    if (size <= 0) continue;
    if (id === 'TIT2') out.title = decodeText(data[0], data.subarray(1));
    else if (id === 'TPE1') out.artist = decodeText(data[0], data.subarray(1));
    else if (id === 'TALB') out.album = decodeText(data[0], data.subarray(1));
    else if (id === 'APIC' && !out.picture) out.picture = apic(data);
  }
  return out;
}

function apic(d) {
  const enc = d[0];
  let i = 1;
  let mime = '';
  while (i < d.length && d[i] !== 0) mime += String.fromCharCode(d[i++]);
  i++; // ноль после mime
  i++; // тип картинки
  if (enc === 1 || enc === 2) { while (i + 1 < d.length && !(d[i] === 0 && d[i + 1] === 0)) i += 2; i += 2; }
  else { while (i < d.length && d[i] !== 0) i++; i++; }
  const img = d.slice(i);
  if (img.length < 100) return null;
  return new Blob([img], { type: mime && mime.includes('/') ? mime : 'image/jpeg' });
}

function parseFlac(b) {
  const out = {};
  let p = 4;
  while (p + 4 <= b.length) {
    const last = b[p] & 0x80;
    const type = b[p] & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    const d = b.subarray(p + 4, p + 4 + len);
    if (type === 4) {
      let i = 0;
      const vlen = le32(d, i); i += 4 + vlen;
      const n = le32(d, i); i += 4;
      for (let k = 0; k < n && i < d.length; k++) {
        const l = le32(d, i); i += 4;
        const kv = utf8.decode(d.subarray(i, i + l)); i += l;
        const eq = kv.indexOf('=');
        const key = kv.slice(0, eq).toUpperCase();
        const val = kv.slice(eq + 1).trim();
        if (key === 'TITLE') out.title = val;
        else if (key === 'ARTIST' && !out.artist) out.artist = val;
        else if (key === 'ALBUM') out.album = val;
      }
    } else if (type === 6 && !out.picture) {
      let i = 4;
      const ml = be32(d, i); i += 4;
      const mime = utf8.decode(d.subarray(i, i + ml)); i += ml;
      const dl = be32(d, i); i += 4 + dl + 16;
      const plen = be32(d, i); i += 4;
      out.picture = new Blob([d.slice(i, i + plen)], { type: mime || 'image/jpeg' });
    }
    p += 4 + len;
    if (last) break;
  }
  return out;
}

const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
