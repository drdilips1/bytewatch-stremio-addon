// Shared quotes: a highlight, note or transcript quote as a link (and a quote card image)
// that another Audiohub user can open — to read it, or to play / read the book from there.
// The quote travels inside the link itself (nothing is stored on a server):
//   https://api.audiohubapp.com/q/<data>   (a web page anyone can read; "Open in Audiohub")
//   audiohub://q/<data>                    (opens the app straight away)
import { Capacitor, registerPlugin, CapacitorHttp } from '@capacitor/core';
import { persisted, library, progress } from './store.js';
import { sameWork, preferred } from './works.js';
import { fmtTime } from './format.js';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');
export const SHARE_BASE = 'https://api.audiohubapp.com/q/';

const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/**
 * A quote to share: { kind: 'audio' | 'text', title, author, cover, quote, note, global }
 * (global: seconds into the whole audiobook).
 */
export function quoteLink(q) {
  const data = {
    v: 1,
    k: q.kind === 'text' ? 'e' : 'a',
    t: String(q.title || '').slice(0, 140),
    a: String(q.author || '').slice(0, 80),
    q: String(q.quote || '').slice(0, 600),
    ...(q.note ? { n: String(q.note).slice(0, 400) } : {}),
    ...(q.cover && /^https:\/\//.test(q.cover) && q.cover.length < 300 ? { c: q.cover } : {}),
    ...(q.kind !== 'text' && q.global >= 0 ? { g: Math.round(q.global) } : {}),
  };
  return SHARE_BASE + b64u(JSON.stringify(data));
}

/** The quote in a shared link (either form), or null. */
export function parseQuoteLink(url) {
  const m = /(?:api\.audiohubapp\.com\/q\/|^(?:audiohub|app\.inkwell\.books):\/\/q\/)([A-Za-z0-9_-]{8,})/.exec(String(url || '').trim());
  if (!m) return null;
  try {
    const d = JSON.parse(unb64u(m[1]));
    if (!d?.t || !d?.q) return null;
    return { kind: d.k === 'e' ? 'text' : 'audio', title: d.t, author: d.a || '', quote: d.q, note: d.n || '', cover: d.c || '', global: d.g ?? null };
  } catch {
    return null;
  }
}

export const atLabel = (q) => (q.kind === 'audio' && q.global != null ? fmtTime(q.global) : '');

// ---- receiving -----------------------------------------------------------------
// The open quote (shown by SharedQuoteSheet) and the one waiting until you have the book.
export const sharedQuote = persisted('sharedQuote', { open: null, pending: null });

export function openSharedQuote(q) {
  sharedQuote.set((s) => ({ ...s, open: q }));
}

/** Your copy of the quoted book (audiobook or ebook, as quoted), if you have one. */
export function findMine(q) {
  const want = { title: q.title, author: q.author };
  const prog = progress.get();
  const all = [...Object.values(library.get()), ...Object.values(prog).map((p) => p?.book)].filter(Boolean);
  const fits = all.filter((b) => sameWork(b, want) && (q.kind === 'text' ? b.kind === 'text' : b.kind !== 'text'));
  return fits.length ? preferred(fits) : null;
}

/** The quote waiting for this book (once you have it), if any. */
export function pendingFor(book) {
  const p = sharedQuote.get().pending;
  return p && sameWork(book, { title: p.title, author: p.author }) ? p : null;
}
export const clearPending = () => sharedQuote.set((s) => ({ ...s, pending: null }));

/** The paragraph of an ebook that holds the quote (its first words), or -1. */
export function findQuoteBlock(blocks, quote) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = norm(quote).split(' ').filter(Boolean);
  for (const n of [8, 5, 3]) {
    if (words.length < Math.min(n, 3)) continue;
    const probe = words.slice(0, n).join(' ');
    const i = blocks.findIndex((b) => norm(b.textContent).includes(probe));
    if (i >= 0) return i;
  }
  return -1;
}

// ---- sharing -------------------------------------------------------------------
async function coverData(url) {
  if (!url) return null;
  try {
    if (native) {
      const r = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 10000, readTimeout: 15000 });
      if (r.status >= 400 || !r.data) return null;
      const type = (r.headers?.['Content-Type'] || r.headers?.['content-type'] || 'image/jpeg').split(';')[0];
      return String(r.data).startsWith('data:') ? r.data : `data:${type};base64,${r.data}`;
    }
    const blob = await (await fetch(url, { mode: 'cors' })).blob();
    return await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const loadImg = (src) =>
  new Promise((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });

function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The quote card (1080×1350 JPEG, base64 without the data: prefix). */
export async function quoteCard(q) {
  const W = 1080, H = 1350, P = 92;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const serif = "'Fraunces Variable', Georgia, serif";
  const sans = "'Figtree Variable', system-ui, sans-serif";
  try {
    await document.fonts?.load(`500 60px ${serif}`);
    await document.fonts?.load(`700 30px ${sans}`);
  } catch {}
  const coverSrc = await coverData(q.cover);
  const cover = coverSrc ? await loadImg(coverSrc).catch(() => null) : null;
  // Background: the cover's own colour, deepened.
  let hue = [122, 40, 30];
  if (cover) {
    const s = document.createElement('canvas');
    s.width = s.height = 8;
    const sx = s.getContext('2d');
    sx.drawImage(cover, 0, 0, 8, 8);
    const d = sx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) (r += d[i]), (g += d[i + 1]), (b += d[i + 2]);
    const n = d.length / 4;
    hue = [r / n, g / n, b / n].map((v) => Math.round(v * 0.55));
  }
  const [r, g, b] = hue;
  const bg = x.createRadialGradient(W * 0.85, 0, 40, W * 0.6, H * 0.4, H);
  bg.addColorStop(0, `rgb(${Math.min(255, r * 1.6)},${Math.min(255, g * 1.6)},${Math.min(255, b * 1.6)})`);
  bg.addColorStop(0.55, `rgb(${r * 0.6},${g * 0.6},${b * 0.6})`);
  bg.addColorStop(1, '#0e0b09');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  // Big opening quote mark.
  x.fillStyle = 'rgba(255,220,180,0.22)';
  x.font = `600 300px ${serif}`;
  x.fillText('“', P - 14, 300);
  // The quote: as large as fits.
  const quote = String(q.quote).trim();
  let size = 70, lines = [];
  const maxH = q.note ? 690 : 820;
  for (; size >= 34; size -= 4) {
    x.font = `500 ${size}px ${serif}`;
    lines = wrap(x, quote, W - P * 2);
    if (lines.length * size * 1.36 <= maxH) break;
  }
  if (lines.length * size * 1.36 > maxH) {
    const keep = Math.floor(maxH / (size * 1.36));
    lines = lines.slice(0, keep);
    lines[keep - 1] = lines[keep - 1].replace(/\s+\S*$/, '') + '…';
  }
  x.fillStyle = '#fff3e6';
  let y = 330;
  for (const l of lines) {
    x.fillText(l, P, y);
    y += size * 1.36;
  }
  // Your note, under an orange bar.
  if (q.note) {
    y += 30;
    x.font = `500 36px ${sans}`;
    const nl = wrap(x, q.note, W - P * 2 - 34).slice(0, 3);
    x.fillStyle = '#f7931e';
    x.fillRect(P, y - 34, 7, nl.length * 50);
    x.fillStyle = '#ecd2b8';
    for (const l of nl) {
      x.fillText(l, P + 30, y);
      y += 50;
    }
  }
  // Book: cover, title, author, where.
  const by = H - P - 150;
  if (cover) {
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.5)';
    x.shadowBlur = 30;
    x.shadowOffsetY = 10;
    const rr = new Path2D();
    rr.roundRect(P, by, 150, 150, 22);
    x.clip(rr);
    x.drawImage(cover, P, by, 150, 150);
    x.restore();
  }
  const tx = cover ? P + 180 : P;
  x.fillStyle = '#fff';
  x.font = `700 44px ${sans}`;
  x.fillText(wrap(x, q.title, W - tx - P - 200)[0] || '', tx, by + 52);
  x.fillStyle = '#d8c2ad';
  x.font = `500 34px ${sans}`;
  x.fillText(wrap(x, q.author, W - tx - P - 200)[0] || '', tx, by + 98);
  const at = atLabel(q);
  if (at || q.kind === 'text') {
    const label = q.kind === 'text' ? 'ebook' : `🎧 at ${at}`;
    x.font = `700 28px ${sans}`;
    const w = x.measureText(label).width + 36;
    x.fillStyle = 'rgba(247,147,30,0.18)';
    const pill = new Path2D();
    pill.roundRect(tx, by + 118, w, 44, 22);
    x.fill(pill);
    x.fillStyle = '#f7b267';
    x.fillText(label, tx + 18, by + 150);
  }
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.font = `700 28px ${sans}`;
  x.textAlign = 'right';
  x.fillText('A U D I O H U B', W - P, H - P + 6);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

/** Share a quote: the card image with the text and link (share sheet), else the text alone. */
export async function shareQuote(q) {
  const link = quoteLink(q);
  const at = atLabel(q);
  const text = `“${q.quote}”${q.note ? `\n\n${q.note}` : ''}\n— ${q.title}${q.author ? `, ${q.author}` : ''}${at ? ` (at ${at})` : ''}\n\nOpen in Audiohub: ${link}`;
  if (native) {
    const card = await quoteCard(q).catch(() => null);
    if (card) return Web.shareImage({ data: card, name: 'audiohub-quote.jpg', mime: 'image/jpeg', text, title: 'Share quote' });
  }
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  await navigator.clipboard?.writeText(text);
  return 'copied';
}
