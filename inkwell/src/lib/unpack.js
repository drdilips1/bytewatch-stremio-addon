// A Mobilism topic's files, played: through Real-Debrid as they are (audio files), or — when
// they're archives (.zip / .rar, often split) — downloaded and unpacked on the phone, then
// played from there (kept like a download: Library → Downloaded).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { downloads } from './downloads.js';

const Native = registerPlugin('InkwellDownloads');
export const canUnpack = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellDownloads');
const ARCHIVE = /\.(zip|rar|7z|r\d\d)$|\.part\d+\.rar$/i;
export const isArchive = (name) => ARCHIVE.test(String(name || ''));

// topic key -> { phase, pct, text, error }
export const unpacking = persisted('unpacking', {}, { delay: 500 });
const patch = (k, p) => unpacking.set((all) => ({ ...all, [k]: { ...all[k], ...p } }));

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

/** Topic → the book as a download on the phone, then playing. `files`: [{ url, name }] (direct links). */
export async function unpackAndPlay(r, files) {
  if (!canUnpack()) throw new Error('Unpacking works in the Android app');
  const key = r.key;
  const uid = `mob:${String(key).split(':').pop()}`;
  const job = `unpack:${uid}:${Date.now()}`;
  patch(key, { phase: 'download', pct: 0, text: 'Downloading…', error: '' });
  const sub = Native.addListener('unpackProgress', (e) => {
    if (e.job !== job) return;
    if (e.phase === 'unpack') return patch(key, { phase: 'unpack', text: 'Unpacking…' });
    const part = e.parts > 1 ? `part ${e.part + 1} of ${e.parts} · ` : '';
    patch(key, { pct: e.total > 0 ? e.got / e.total : 0, text: `Downloading ${part}${e.total > 0 ? `${mb(e.got)} of ${mb(e.total)}` : mb(e.got)}` });
  });
  try {
    const out = await Native.unpack({ urls: files.map((f) => f.url), names: files.map((f) => f.name), folder: r.title || 'Audiobook', job });
    const audio = (out.files || [])
      .filter((f) => /\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav|wma)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (!audio.length) throw new Error('No audio files inside the archive');
    const book = { uid, source: 'download', kind: 'audio', title: r.title || 'Audiobook', author: r.author || '', narrator: r.narrator || '', cover: '' };
    downloads.set((all) => ({
      ...all,
      [uid]: {
        book,
        status: 'done',
        folder: out.folder,
        tracks: audio.map((f) => ({ title: f.name.replace(/\.[^.]+$/, ''), uri: f.uri, size: f.size, name: f.name })),
        bytes: audio.reduce((n, f) => n + (f.size || 0), 0),
        total: audio.length,
        done: audio.length,
        finishedAt: Date.now(),
        error: '',
      },
    }));
    patch(key, { phase: 'done', pct: 1, text: `Unpacked · ${audio.length} file${audio.length === 1 ? '' : 's'}` });
    const [{ getDetails }, player] = await Promise.all([import('../sources/index.js'), import('./player.js')]);
    const { nav } = await import('./nav.js');
    nav.openOverlay('player');
    player.playBook(await getDetails(book));
    return audio.length;
  } catch (e) {
    patch(key, { phase: 'error', error: e.message, text: '' });
    throw e;
  } finally {
    sub.then((h) => h.remove());
  }
}

