// Рисует иконки приложения (PNG) без сторонних библиотек.
// Запуск: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'app', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Геометрия та же, что в icons/icon.svg (холст 512).
const BARS = [120, 208, 296, 208, 120];
const BAR_W = 44, GAP = 26, BAR_R = 22, BG_R = 112;
const STOPS = [[0, [124, 58, 237]], [0.55, [236, 72, 153]], [1, [249, 115, 22]]];

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function render(size, { fullBleed = false, contentScale = 1 } = {}) {
  const S = 4; // сглаживание: 4x4 сэмпла на пиксель
  const px = Buffer.alloc(size * size * 4);
  const total = BARS.length * BAR_W + (BARS.length - 1) * GAP;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = ((x + (sx + 0.5) / S) / size) * 512;
          const v = ((y + (sy + 0.5) / S) / size) * 512;
          const inBg = fullBleed || sdRoundBox(u, v, 256, 256, 256, 256, BG_R) < 0;
          if (!inBg) continue;
          bg++;
          // полоски эквалайзера в центре
          const cu = 256 + (u - 256) / contentScale;
          const cv = 256 + (v - 256) / contentScale;
          let x0 = 256 - total / 2;
          for (const hgt of BARS) {
            if (sdRoundBox(cu, cv, x0 + BAR_W / 2, 256, BAR_W / 2, hgt / 2, BAR_R) < 0) { fg++; break; }
            x0 += BAR_W + GAP;
          }
        }
      }
      const i = (y * size + x) * 4;
      const n = S * S;
      const t = (x / size + y / size) / 2;
      const g = gradient(t);
      const a = bg / n;
      const f = bg ? fg / bg : 0;
      // лёгкий блик сверху
      const shine = 1 + 0.08 * Math.max(0, 1 - y / (size * 0.6));
      px[i] = Math.min(255, Math.round((g[0] * (1 - f) + 255 * f) * (f ? 1 : shine)));
      px[i + 1] = Math.min(255, Math.round((g[1] * (1 - f) + 255 * f) * (f ? 1 : shine)));
      px[i + 2] = Math.min(255, Math.round((g[2] * (1 - f) + 255 * f) * (f ? 1 : shine)));
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, px);
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { fullBleed: true, contentScale: 0.78 }],
  ['apple-touch-icon.png', 180, { fullBleed: true, contentScale: 0.85 }],
  ['favicon-32.png', 32, {}],
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), render(size, opts));
  console.log('ok', name);
}

// Иконка для ярлыка Windows (.ico с PNG внутри: 16, 24, 32, 48, 64, 256)
const icoSizes = [16, 24, 32, 48, 64, 256];
const pngs = icoSizes.map((s) => render(s));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const entries = icoSizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bit count
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync(path.join(__dirname, '..', 'pulse.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log('ok pulse.ico');
