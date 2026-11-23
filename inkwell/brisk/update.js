// Updates, inside the app: Audibrisk's public releases live in the public repository
// drdilips1/audibrisk (the private repository's builds are only for trying out). Checked once a
// day and from Settings; the new version downloads here, with its %, and Android's installer opens.
// (Android asks once to allow installs from Audibrisk; the install carries on when you come back.)
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { getJson } from '../src/lib/http.js';
import { toast } from '../src/components/common.jsx';
import { persisted } from '../src/lib/store.js';
import { newer } from './logic.js';

export const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
export const PUBLIC_REPO = 'drdilips1/audibrisk';
const Updater = registerPlugin('InkwellUpdate');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellUpdate');
/** iPhone: updates come through AltStore (the releases here are Android APKs). */
export const isIphone = Capacitor.getPlatform() === 'ios';

export { newer };

// What the updater is doing: idle | downloading | permission | installing | error.
export const updState = persisted('briskUpdate', { latest: '', url: '', phase: 'idle', pct: 0, error: '' });
const put = (patch) => updState.set((s) => ({ ...s, ...patch }));
if (updState.get().phase === 'downloading') put({ phase: 'idle', pct: 0 }); // the app was closed mid-download

/** The newest public release: { version, url, newer }. No public release yet → not newer. */
export async function checkUpdate() {
  if (isIphone) return { newer: false, iphone: true };
  let rel;
  try {
    rel = await getJson(`https://api.github.com/repos/${PUBLIC_REPO}/releases/latest`, { fresh: true, timeout: 12000 });
  } catch (e) {
    if (e.status === 404) return { newer: false, none: true };
    throw e;
  }
  const version = String(rel?.tag_name || '').replace(/^(audibrisk-)?v/, '');
  const apk = (rel?.assets || []).find((a) => /\.apk$/i.test(a.name));
  const out = { version, url: apk?.browser_download_url || rel?.html_url || '', newer: !!version && VERSION !== 'dev' && newer(version, VERSION) };
  put({ latest: version, url: out.url });
  return out;
}

let dl = null;
/** Download the new version here, then open Android's installer. */
export async function installUpdate() {
  const { url, latest } = updState.get();
  if (!url) return;
  // Not the Android app (or an old one without the installer): the download page instead.
  if (!native) return Browser.open({ url }).catch(() => window.open(url, '_blank'));
  if (dl) return dl;
  dl = (async () => {
    try {
      const { allowed } = await Updater.canInstall();
      put({ phase: 'downloading', pct: 0, error: '' });
      const sub = await Updater.addListener('progress', (e) => e.pct >= 0 && put({ pct: e.pct }));
      try {
        await Updater.download({ url });
      } finally {
        sub.remove();
      }
      if (!allowed) {
        put({ phase: 'permission' });
        await Updater.allowInstall();
        return; // carries on when you come back from the setting
      }
      put({ phase: 'installing' });
      await Updater.install();
    } catch (e) {
      put({ phase: 'error', error: e?.message || 'The update didn’t download — try again' });
    } finally {
      dl = null;
    }
  })();
  toast(`Downloading Audibrisk ${latest}…`);
  return dl;
}

// Back from "Install unknown apps": install now if it was allowed.
if (native)
  CapApp.addListener('resume', async () => {
    if (updState.get().phase !== 'permission') return;
    const { allowed } = await Updater.canInstall().catch(() => ({ allowed: false }));
    if (allowed) {
      put({ phase: 'installing' });
      Updater.install().catch((e) => put({ phase: 'error', error: e?.message || 'Couldn’t open the installer' }));
    } else put({ phase: 'idle' });
  });

// Once a day: a note when a new version is out.
try {
  const last = Number(localStorage.getItem('brisk:updCheck') || 0);
  if (!isIphone && Date.now() - last > 864e5)
    setTimeout(() => {
      localStorage.setItem('brisk:updCheck', String(Date.now()));
      checkUpdate()
        .then((u) => u.newer && toast(`Audibrisk ${u.version} is ready — open Settings to update`, 6000))
        .catch(() => {});
    }, 8000);
} catch {}
