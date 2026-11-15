// "Just play it", wherever it is: your copies (phone, Audiobookshelf, TorBox / Real-Debrid),
// else the best torrent from your sources through your debrid service (plays in a minute),
// else MyAnonamouse → your home server, played as soon as it's on your Audiobookshelf.
import * as player from './player.js';
import { nav } from './nav.js';
import { mainTitle } from './match.js';

const note = (msg) => import('./report.js').then((r) => r.logError('Get and play', msg)).catch(() => {});
const waiting = new Map(); // title -> true while waiting for the server

/**
 * Plays the book or says what happens next: { playing: true } | { sentHome: true, message } |
 * { none: true, message }. `step(text)` shows progress.
 */
export async function getAndPlay(want, step = () => {}) {
  const title = mainTitle(want.title || '');
  const author = want.author || '';
  // 1. Your copies, then your sources through TorBox / Real-Debrid (the voice "play …" path).
  try {
    const { playScene } = await import('./voicecmd.js');
    await playScene('', step, { action: 'play_book', moment: false, title, author });
    nav.openOverlay('player');
    note(`“${title}”: playing (your copy or debrid)`);
    return { playing: true };
  } catch (e) {
    if (/downloading in your/i.test(e.message || '')) return { none: false, message: e.message };
    note(`“${title}”: not in your copies or debrid sources (${e.message})`);
  }
  // 2. MyAnonamouse → your home server, then it plays when Audiobookshelf has it.
  try {
    const q = await import('../sources/qbit.js');
    if (q.canGrab() && q.configured()) {
      step(`Looking on ${q.trackerName().replace(/^www\./, '')}…`);
      const picks = await q.mamResults({ words: `${title} ${author}`.trim(), title, author });
      if (picks[0]) {
        step(`Sending ${title} to your home server…`);
        const r = await q.grabMam(picks[0]);
        if (r?.sent) {
          note(`“${title}”: sent to the home server (${picks[0].title}) — waiting for Audiobookshelf`);
          waitForServer(title, author);
          return { sentHome: true, message: `${title} is downloading at home — it starts playing by itself when it’s on your Audiobookshelf (keep the app open)` };
        }
        note(`“${title}”: home server didn't take it (${r?.message || 'unknown'})`);
      }
    }
  } catch (e) {
    note(`“${title}”: tracker step failed (${e.message})`);
  }
  return { none: true, message: `No audiobook of ${title} found in your copies or sources — showing its page (ebooks are there)` };
}

/** Every 45 s for up to 40 minutes: on your Audiobookshelf yet? Then it plays. */
function waitForServer(title, author) {
  if (waiting.has(title)) return;
  waiting.set(title, true);
  const until = Date.now() + 40 * 60e3;
  const tick = async () => {
    if (Date.now() > until) return waiting.delete(title);
    try {
      const { onServer } = await import('../sources/qbit.js');
      const hit = await onServer({ title, author });
      if (hit) {
        waiting.delete(title);
        const { getDetails } = await import('../sources/index.js');
        const d = await getDetails(hit, { fast: true });
        // Don't cut into something else you started meanwhile.
        if (player.getState().playing) {
          const { toast } = await import('../components/common.jsx');
          return toast(`${title} is on your Audiobookshelf now — it’s in Library`);
        }
        nav.openOverlay('player');
        player.playBook(d, { autoplay: true });
        note(`“${title}”: on Audiobookshelf — playing`);
        return;
      }
    } catch {}
    setTimeout(tick, 45e3);
  };
  setTimeout(tick, 60e3);
}
