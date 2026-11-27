// Settings → Storage: what Audiohub+ keeps on this phone, biggest parts first, and a safe way to
// clear each — never your library, progress, bookmarks or settings (Android's own "Clear data"
// wipes all of those too).
import { useEffect, useState } from 'preact/hooks';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { toast } from './common.jsx';
import { nav } from '../lib/nav.js';
import { useStore } from '../lib/store.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { savedEbooks } from '../lib/epub.js';
import { fmtSize, unpackedRows, leftoverBytes } from '../lib/storage.js';

const Native = registerPlugin('InkwellDownloads');
const android = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellDownloads');

export function StorageCard() {
  const dls = useStore(downloads);
  const kept = useStore(savedEbooks);
  const [use, setUse] = useState(null);
  const [folders, setFolders] = useState(null);
  const [web, setWeb] = useState(null);
  const [busy, setBusy] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (android) {
      Native.storageUse().then(setUse).catch(() => setUse({}));
      Native.unpackedFolders().then((r) => setFolders(r.folders || [])).catch(() => setFolders([]));
    }
    navigator.storage?.estimate?.().then((e) => setWeb(e.usage || 0)).catch(() => {});
  }, [round]);

  const again = () => setRound((n) => n + 1);
  const rows = unpackedRows(folders || [], dls);
  const spare = leftoverBytes(rows);
  const keptBytes = Object.values(kept || {}).reduce((n, x) => n + (x?.size || 0), 0);
  const run = async (key, work) => {
    setBusy(key);
    try {
      const freed = await work();
      if (freed) toast(`Freed ${fmtSize(freed)}`);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
      again();
    }
  };
  const dropFolder = (r) =>
    run(r.path, async () => {
      if (r.uid) await removeDownload(r.uid);
      const out = await Native.deleteFolder({ path: r.path });
      return out?.freed || r.size;
    });
  const dropLeftovers = () =>
    run('leftovers', async () => {
      let n = 0;
      for (const r of rows.filter((x) => x.leftover)) n += (await Native.deleteFolder({ path: r.path }).catch(() => null))?.freed || 0;
      return n;
    });
  const dropKept = () => {
    if (!confirm('Delete every ebook kept on this phone (Library → Ebooks → Downloaded)? Your reading places and highlights stay; a book opens again from its source when you read it.')) return;
    run('kept', async () => {
      await caches.delete('kathava-ebooks').catch(() => {});
      savedEbooks.set({});
      return keptBytes;
    });
  };

  if (!android)
    return (
      <p class="muted pad-s">
        Kept in this app's own storage{web != null ? `: ${fmtSize(web)}` : ''} (ebooks you opened, Time Machine lines). {keptBytes ? <button class="link-btn" onClick={dropKept}>Clear kept ebooks ({fmtSize(keptBytes)})</button> : null}
      </p>
    );

  const line = (label, bytes, hint, action) => (
    <div class="set-row storage-row">
      <div>
        <b>{label}</b>
        <small>{hint}</small>
      </div>
      <span class="storage-size">{bytes == null ? '…' : fmtSize(bytes)}</span>
      {action}
    </div>
  );

  return (
    <>
      <p class="muted pad-s">What Audiohub+ keeps on this phone. Clearing here never touches your library, places, bookmarks or settings — Android's own "Clear data" would wipe those too.</p>
      {line(
        'Unpacked Mobilism books',
        use?.unpacked,
        spare ? `${fmtSize(spare)} of it is left over from unpacks nothing plays any more` : 'Archives unpacked to play; each book listed below',
        spare ? (
          <button class="pill small" disabled={!!busy} onClick={dropLeftovers}>
            {busy === 'leftovers' ? <span class="spinner small" /> : 'Clear leftovers'}
          </button>
        ) : null
      )}
      {rows.length > 0 && (
        <div class="storage-list">
          {rows.map((r) => (
            <div class="storage-item">
              <div>
                <b>{r.title}</b>
                <small>
                  {fmtSize(r.size)}
                  {r.leftover ? ' · left over (not in your library)' : ' · in Downloads'}
                </small>
              </div>
              <button class="pill small" disabled={!!busy} onClick={() => (r.leftover || confirm(`Delete “${r.title}” from this phone? It plays from its source again when you need it.`)) && dropFolder(r)}>
                {busy === r.path ? <span class="spinner small" /> : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
      {line(
        'Downloads inside the app',
        use?.downloads,
        'Books downloaded to the app\'s own storage',
        <button class="pill small" onClick={() => nav.push('downloads')}>
          Open
        </button>
      )}
      {line('Voices', use?.voices, 'Reading voices and the Text view voice — remove them in Voices above', null)}
      {line(
        'Ebooks kept on this phone',
        keptBytes,
        'Ebooks you saved or opened, so they open at once',
        keptBytes ? (
          <button class="pill small" disabled={!!busy} onClick={dropKept}>
            {busy === 'kept' ? <span class="spinner small" /> : 'Clear'}
          </button>
        ) : null
      )}
      {line('App\'s own storage', use?.web ?? web, 'Your library, places and settings, Time Machine lines, cover pictures', null)}
      {line(
        'Cache',
        use?.cache,
        'Read-aloud audio, temporary files, the last update',
        use?.cache ? (
          <button class="pill small" disabled={!!busy} onClick={() => run('cache', async () => (await Native.clearCache())?.freed)}>
            {busy === 'cache' ? <span class="spinner small" /> : 'Clear'}
          </button>
        ) : null
      )}
    </>
  );
}
