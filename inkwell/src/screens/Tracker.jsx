import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast, Empty } from '../components/common.jsx';
import { useStore } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { pickTorrentFile } from '../lib/torrentfile.js';
import * as qb from '../sources/qbit.js';

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

/**
 * Tracker: open the tracker site you use (signed in inside the app); tapping a
 * .torrent download or magnet there sends it to your qBittorrent at home.
 * Also add magnets / .torrent files by hand and follow the downloads.
 */
export function Tracker() {
  const cfg = useStore(qb.qbit);
  const tr = useStore(qb.tracker);
  useStore(qb.qbitSent);
  const [site, setSite] = useState(tr.url || '');
  const [magnet, setMagnet] = useState('');
  const [busy, setBusy] = useState('');
  const [list, setList] = useState(null);
  const ready = qb.available && qb.configured();

  const run = async (what, fn) => {
    setBusy(what);
    try {
      const m = await fn();
      if (m) toast(m);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  const refresh = () => (ready ? qb.status().then(setList).catch(() => {}) : null);
  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 6000);
    return () => clearInterval(t);
  }, [cfg.url, cfg.apiKey]);

  return (
    <div class="screen tracker">
      <header class="screen-head">
        <h1 class="screen-title">Tracker</h1>
        <p class="muted">Sign in to your tracker here — tapping a .torrent or magnet on it sends it to qBittorrent at home, into your Audiobookshelf folder.</p>
      </header>

      {!ready ? (
        <Empty icon="server" title={qb.available ? 'Set up your home server first' : 'Works in the Android app'}>
          {qb.available && (
            <button class="btn primary" onClick={() => nav.tab('settings')}>
              Settings → Home server
            </button>
          )}
        </Empty>
      ) : (
        <>
          <section class="pad tracker-site">
            {tr.url ? (
              <div class="tracker-open">
                <button class="btn primary big" onClick={() => run('open', qb.openTracker)}>
                  <Icon name="external" size={18} /> Open {tr.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}
                </button>
                <button class="link-btn" onClick={() => qb.tracker.set({ url: '' })}>
                  Change site
                </button>
              </div>
            ) : (
              <form
                class="set-form inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (site.trim()) qb.tracker.set({ url: site.trim() });
                }}
              >
                <input value={site} placeholder="Your tracker's address (e.g. www.example.net)" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setSite(e.currentTarget.value)} />
                <button class="btn primary" disabled={!site.trim()}>
                  Save
                </button>
              </form>
            )}
          </section>

          <section class="pad">
            <h3 class="section-label">Add by hand</h3>
            <form
              class="set-form inline"
              onSubmit={async (e) => {
                e.preventDefault();
                const m = magnet.trim();
                if (!m) {
                  const file = await pickTorrentFile();
                  if (file) run('add', () => qb.sendFile(file));
                  return;
                }
                await run('add', () => qb.sendMagnet(m));
                setMagnet('');
                setTimeout(refresh, 1500);
              }}
            >
              <input value={magnet} placeholder="Magnet — or tap + for a .torrent file" autocapitalize="off" autocorrect="off" spellcheck={false} onInput={(e) => setMagnet(e.currentTarget.value)} />
              <button class="btn primary" disabled={!!busy} aria-label={magnet.trim() ? 'Send' : 'Choose a .torrent file'}>
                {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />}
              </button>
            </form>
          </section>

          <section class="pad">
            <div class="tracker-list-head">
              <h3 class="section-label">Downloads at home</h3>
              <button class="pill small ghost" disabled={!!busy} onClick={() => run('fix', async () => { const m = await qb.fixStuck(); setTimeout(refresh, 3000); return m; })}>
                {busy === 'fix' ? <span class="spinner small" /> : 'Fix stuck'}
              </button>
            </div>
            {!list ? (
              <div class="spinner" />
            ) : list.length ? (
              <div class="qbit-list">
                {list.slice(0, 40).map((t) => (
                  <div class="qbit-item">
                    <div>
                      <b>{t.name}</b>
                      <small>
                        {t.progress >= 1 ? 'Done — in your Audiobookshelf folder' : `${pct(t.progress)} · ${qb.stateLabel(t.state)}`}
                        {t.speed > 0 ? ` · ${(t.speed / 1e6).toFixed(1)} MB/s` : ''}
                      </small>
                    </div>
                    <div class="progress-bar">
                      <div style={{ width: pct(t.progress) }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p class="muted">Nothing yet — send something from your tracker, a magnet or a .torrent file.</p>
            )}
          </section>
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}
