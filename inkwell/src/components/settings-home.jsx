// Settings' first screen: about ten groups, each a row with a gradient icon tile, a one-line summary
// of what's set up there, and an arrow to its page (27 Nov, after Kelp's tidy Settings). The pages
// hold the same sections as before — nothing removed — and search still finds any setting.
import { Icon } from './icons.jsx';
import { useStore, settings, abs, debrid, kindle, goodreads, hardcover } from '../lib/store.js';
import { GROUPS } from '../lib/settingsgroups.js';
import { account } from '../lib/sync.js';
import { localCfg } from '../sources/local.js';
import { libby } from '../sources/libby.js';
import { usenetCfg } from '../sources/usenet.js';
import { sourceAddons } from '../sources/sourceaddons.js';
import { aiReady } from '../lib/ai.js';
import { ttsCfg } from '../lib/tts.js';
import { downloads } from '../lib/downloads.js';
import { PALETTES, activePalette, resolvedMode } from '../lib/theme.js';
import { MORE } from '../sources/moredebrid.js';
import { APP_VERSION } from './update.jsx';

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const join = (list, none) => list.filter(Boolean).join(' · ') || none;

/** What each group's row says: what's set up there, at a glance. */
function useSummaries() {
  const st = useStore(settings);
  const acc = useStore(account);
  const a = useStore(abs);
  const deb = useStore(debrid);
  const loc = useStore(localCfg);
  const lib = useStore(libby);
  const use = useStore(usenetCfg);
  const kin = useStore(kindle);
  const g = useStore(goodreads);
  const h = useStore(hardcover);
  const tts = useStore(ttsCfg);
  const dls = useStore(downloads);
  const signed = !!(acc.cfUser || acc.userId || acc.refreshToken);
  const clouds = [deb.torbox && 'TorBox', deb.realdebrid && 'Real-Debrid', ...Object.entries(MORE).map(([p, m]) => deb[p] && m.name)].filter(Boolean);
  const pal = PALETTES.find((p) => p.id === activePalette(st) && p.light === (resolvedMode(st) === 'light'));
  const done = Object.values(dls || {}).filter((d) => d?.status === 'done').length;
  return {
    account: signed ? join(['Signed in', acc.lastSync && `synced ${ago(acc.lastSync)}`], 'Signed in') : 'Not signed in — keep your books on all your devices',
    books: join([a.token && 'Audiobookshelf', (loc.folders || []).length && 'Phone folders', lib.key || lib.name ? 'Libby' : ''], 'Add your server, phone folders or library'),
    cloud: join([clouds.length ? clouds.join(', ') : '', (use.easynews?.user || (use.indexers || []).length) && 'Usenet'], 'Connect TorBox, Real-Debrid or Usenet'),
    finding: join([`${sourceAddons().length} sources`, (st.sourceOrder || []).length ? 'your order' : ''], 'Where books are searched'),
    playback: join([`${st.skipBack || 15}s / ${st.skipForward || 30}s`, `${st.speed || 1}×`, st.skipSilence && 'skip silence'], ''),
    voices: join([tts.engine ? 'Your voice engine' : 'Phone voices', tts.voice && 'voice chosen'], 'Reading voices and Text'),
    reading: (kin.targets || []).length ? 'Send to Kindle set up' : 'Reader and Send to Kindle',
    appearance: join([pal?.name, st.finish === 'plain' ? 'Plain' : 'Premium', st.mode === 'system' ? 'like phone' : st.mode], ''),
    taste: join([aiReady() ? 'AI on' : 'AI off', (g.books || []).length && 'Goodreads', h.token && 'Hardcover'], ''),
    storage: join([done && `${done} downloaded`], 'Downloads, space and backup'),
  };
}

export function SettingsHome({ open }) {
  const sum = useSummaries();
  const groups = GROUPS.filter((g) => g.id !== 'help');
  const bands = [];
  for (const g of groups) {
    const last = bands[bands.length - 1];
    if (last && last.band === (g.band || '')) last.list.push(g);
    else bands.push({ band: g.band || '', list: [g] });
  }
  return (
    <div class="sh">
      {bands.map((b) => (
        <>
          {b.band && <p class="sh-band">{b.band}</p>}
          <div class="sh-card">
            {b.list.map((g) => (
              <button class="sh-row" onClick={() => open(g.id)}>
                <span class="sh-ic" style={{ '--ic': g.hue }}>
                  <Icon name={g.icon} size={19} />
                </span>
                <span class="sh-t">
                  <b>{g.title}</b>
                  {sum[g.id] && <small>{sum[g.id]}</small>}
                </span>
                <Icon name="chevron" size={18} />
              </button>
            ))}
          </div>
        </>
      ))}
      <p class="sh-about">
        Audiohub {APP_VERSION} ·{' '}
        <button class="link-btn" onClick={() => open('help')}>
          Help & about
        </button>
      </p>
    </div>
  );
}
