// Тексты песен из открытой базы LRCLIB (часто с разметкой по времени).
const mem = new Map();

export async function getLyrics(t) {
  if (!t || t.src === 'rd') return null;
  if (mem.has(t.id)) return mem.get(t.id);
  const title = (t.titleShort || t.title || '').replace(/\s*[([].*?(remaster|version|edit|mix).*?[)\]]/i, '').trim();
  const artist = (t.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
  let res = null;
  try {
    const p = new URLSearchParams({ artist_name: artist, track_name: title });
    if (t.duration) p.set('duration', Math.round(t.duration));
    const r = await fetch('https://lrclib.net/api/get?' + p);
    if (r.ok) res = await r.json();
  } catch { /* дальше пробуем поиск */ }
  if (!res) {
    try {
      const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: title, artist_name: artist }));
      if (r.ok) {
        const arr = await r.json();
        const near = arr.filter((x) => !t.duration || Math.abs((x.duration || 0) - t.duration) < 8);
        res = near.find((x) => x.syncedLyrics) || near[0] || arr.find((x) => x.syncedLyrics) || arr[0] || null;
      }
    } catch { /* нет сети */ }
  }
  const out = res
    ? { synced: res.syncedLyrics ? parseLrc(res.syncedLyrics) : null, plain: res.plainLyrics || '', instrumental: !!res.instrumental }
    : null;
  mem.set(t.id, out);
  return out;
}

export function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) lines.push({ t: +m[1] * 60 + +m[2], text: line });
  }
  return lines.sort((a, b) => a.t - b.t);
}
