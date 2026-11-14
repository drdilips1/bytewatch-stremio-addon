// "Your year in books": a picture to share — hours, books finished, the top author, the
// longest book finished and a favourite highlight, with four covers.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { progress, bookmarks } from './store.js';
import { listenLog } from './stats.js';
import { coverData, loadImg } from './quoteshare.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

/** This year's numbers: { year, hours, finished, topAuthor, longest, quote, covers }. */
export function yearStats(year = new Date().getFullYear()) {
  const inYear = (t) => new Date(t || 0).getFullYear() === year;
  const done = Object.values(progress.get() || {}).filter((p) => p?.book && p.finished && inYear(p.updatedAt) && p.kind !== 'text' && p.book.kind !== 'text');
  const longest = done.slice().sort((a, b) => (b.total || 0) - (a.total || 0))[0];
  const authors = {};
  for (const p of done) {
    const a = String(p.book.author || '').split(',')[0].trim();
    if (a) authors[a] = (authors[a] || 0) + 1;
  }
  const topAuthor = Object.entries(authors).sort((a, b) => b[1] - a[1])[0] || null;
  const quotes = Object.values(bookmarks.get() || {})
    .flat()
    .filter((b) => b?.quote && inYear(b.createdAt) && b.label && b.label.length < 160);
  const quote = quotes.sort((a, b) => b.label.length - a.label.length)[0]?.label || '';
  return {
    year,
    hours: Math.round(Math.max(yearSeconds(year), done.reduce((a, p) => a + (p.total || 0), 0)) / 3600),
    finished: done.length,
    topAuthor: topAuthor ? { name: topAuthor[0], n: topAuthor[1] } : null,
    longest: longest ? { title: longest.book.title, h: Math.round((longest.total || 0) / 3600) } : null,
    quote,
    covers: done.filter((p) => p.book.cover).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4).map((p) => p.book.cover),
  };
}

function yearSeconds(year) {
  const days = listenLog.get().days || {};
  return Object.entries(days)
    .filter(([k]) => k.startsWith(`${year}-`))
    .reduce((a, [, d]) => a + (d.s || 0), 0);
}

const wrap = (x, text, max) => {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > max && line) (out.push(line), (line = w));
    else line = t;
  }
  if (line) out.push(line);
  return out;
};

/** The picture: a JPEG data URL. */
export async function yearCard(y = yearStats()) {
  const W = 1080, H = 1350, P = 90;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const sans = "'Figtree Variable', system-ui, sans-serif";
  try {
    await document.fonts?.load(`800 60px ${sans}`);
  } catch {}
  const g = x.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, '#3b1d5e');
  g.addColorStop(1, '#0e2a3a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#d8c9ff';
  x.font = `700 30px ${sans}`;
  x.fillText(`YOUR ${y.year} IN BOOKS`.split('').join(String.fromCharCode(8202)), P, P + 30);
  x.fillStyle = '#fff';
  x.font = `800 190px ${sans}`;
  x.fillText(`${y.hours} h`, P - 8, P + 230);
  x.fillStyle = '#d8c9ff';
  x.font = `500 40px ${sans}`;
  x.fillText(`listened · ${y.finished} book${y.finished === 1 ? '' : 's'} finished`, P, P + 300);
  // Covers.
  const size = (W - P * 2 - 3 * 24) / 4;
  let cx = P;
  for (const url of y.covers) {
    const src = await coverData(url);
    const img = src ? await loadImg(src).catch(() => null) : null;
    if (img) {
      x.save();
      x.beginPath();
      x.roundRect(cx, 470, size, size, 22);
      x.clip();
      const s = Math.max(size / img.width, size / img.height);
      x.drawImage(img, cx + (size - img.width * s) / 2, 470 + (size - img.height * s) / 2, img.width * s, img.height * s);
      x.restore();
      cx += size + 24;
    }
  }
  // The box of facts.
  const top = cx > P ? 470 + size + 70 : 470;
  x.fillStyle = 'rgba(255,255,255,0.08)';
  x.beginPath();
  x.roundRect(P, top, W - P * 2, H - top - 170, 34);
  x.fill();
  let ty = top + 70;
  const fact = (label, value) => {
    if (!value) return;
    x.fillStyle = 'rgba(255,255,255,0.6)';
    x.font = `500 30px ${sans}`;
    x.fillText(label, P + 40, ty);
    x.fillStyle = '#fff';
    x.font = `700 40px ${sans}`;
    const lines = wrap(x, value, W - P * 2 - 80).slice(0, 2);
    lines.forEach((l, i) => x.fillText(l, P + 40, ty + 50 + i * 48));
    ty += 70 + lines.length * 48 + 10;
  };
  fact('Top author', y.topAuthor ? `${y.topAuthor.name} · ${y.topAuthor.n} book${y.topAuthor.n === 1 ? '' : 's'}` : '');
  fact('Longest book', y.longest ? `${y.longest.title} · ${y.longest.h} h` : '');
  fact('Favourite highlight', y.quote ? `“${y.quote}”` : '');
  x.fillStyle = '#d8c9ff';
  x.font = `600 32px ${sans}`;
  x.fillText('Audiohub+', P, H - 80);
  return c.toDataURL('image/jpeg', 0.9);
}

export async function shareYear(data) {
  const text = 'My year in books';
  if (native) return Web.shareImage({ data, name: 'my-year-in-books.jpg', mime: 'image/jpeg', text, title: text });
  const a = document.createElement('a');
  a.href = data;
  a.download = 'my-year-in-books.jpg';
  a.click();
}
