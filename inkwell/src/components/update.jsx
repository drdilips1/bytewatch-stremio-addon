import { useEffect, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { getJson } from '../lib/http.js';
import { persisted, useStore } from '../lib/store.js';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const REPO = 'drdilips1/bytewatch-stremio-addon';
const update = persisted('update', { checkedAt: 0, latest: '', url: '', notes: '' });

const num = (v) => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return m ? +m[1] * 1e8 + +m[2] * 1e4 + +m[3] : 0;
};
// The web app is always the latest build; only the Android APK needs updating.
const isApk = Capacitor.isNativePlatform();
export const updateAvailable = () => isApk && APP_VERSION !== 'dev' && num(update.get().latest) > num(APP_VERSION);

export async function checkForUpdate() {
  const r = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, { fresh: true });
  const asset = (r.assets || []).find((a) => /\.apk$/i.test(a.name));
  update.set({ checkedAt: Date.now(), latest: (r.tag_name || '').replace(/^inkwell-v/, ''), url: asset?.browser_download_url || r.html_url, notes: r.name || '' });
  return updateAvailable();
}

export async function openDownload() {
  const { url } = update.get();
  if (!url) return;
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, '_blank');
}

// Check quietly on launch, at most every 6 hours.
if (isApk && APP_VERSION !== 'dev' && Date.now() - update.get().checkedAt > 6 * 3600e3) {
  setTimeout(() => {
    checkForUpdate()
      .then((yes) => yes && toast(`श्रवणीय ${update.get().latest} is available — see Settings`))
      .catch(() => {});
  }, 4000);
}

export function UpdateCard() {
  const u = useStore(update);
  const [busy, setBusy] = useState(false);
  const avail = isApk && APP_VERSION !== 'dev' && num(u.latest) > num(APP_VERSION);
  if (!isApk) {
    return (
      <section class="set-section">
        <div class="update-card">
          <div>
            <b>श्रवणीय web app</b>
            <small>Always the latest version — just reopen it.</small>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section class="set-section">
      <div class={'update-card' + (avail ? ' avail' : '')}>
        <div>
          <b>{avail ? `Update available: ${u.latest}` : `श्रवणीय ${APP_VERSION}`}</b>
          <small>{avail ? 'Installs over this version — your data stays.' : u.checkedAt ? 'You have the latest version' : 'Check for a newer build'}</small>
        </div>
        {avail ? (
          <button class="btn primary" onClick={openDownload}>
            <Icon name="download" size={16} /> Download
          </button>
        ) : (
          <button
            class="pill small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                toast((await checkForUpdate()) ? 'Update available' : 'You are up to date');
              } catch (e) {
                toast(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span class="spinner small" /> : 'Check'}
          </button>
        )}
      </div>
    </section>
  );
}
