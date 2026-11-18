// Updates: Audibrisk's builds are the "audibrisk-v…" pre-releases of its repository. Checked once
// a day; Settings offers it too.
import { Browser } from '@capacitor/browser';
import { getJson } from '../src/lib/http.js';
import { toast } from '../src/components/common.jsx';

export const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const REPO = 'drdilips1/bytewatch-stremio-addon';
const newer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

export async function checkUpdate(asked = false) {
  const list = await getJson(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { fresh: true });
  const rel = (Array.isArray(list) ? list : []).find((r) => /^audibrisk-v/.test(r.tag_name || ''));
  if (!rel) return { newer: false };
  const version = rel.tag_name.replace(/^audibrisk-v/, '');
  const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
  const out = { version, url: apk?.browser_download_url || rel.html_url, newer: VERSION !== 'dev' && newer(version, VERSION) };
  if (out.newer && asked) Browser.open({ url: out.url }).catch(() => window.open(out.url, '_blank'));
  return out;
}

try {
  const last = Number(localStorage.getItem('brisk:updCheck') || 0);
  if (Date.now() - last > 864e5)
    setTimeout(() => {
      localStorage.setItem('brisk:updCheck', String(Date.now()));
      checkUpdate()
        .then((u) => u.newer && toast(`Audibrisk ${u.version} is ready — open Settings to update`))
        .catch(() => {});
    }, 8000);
} catch {}
