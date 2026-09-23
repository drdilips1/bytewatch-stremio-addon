import { useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { settings, addons, abs, useStore, exportBackup, importBackup } from '../lib/store.js';
import { SOURCES, absSrc, addonSrc } from '../sources/index.js';
import { clearHttpCache } from '../lib/http.js';
import { ACCENTS } from '../lib/theme.js';

function Section({ icon, title, children }) {
  return (
    <section class="set-section">
      <h3>
        <Icon name={icon} size={18} /> {title}
      </h3>
      <div class="set-card">{children}</div>
    </section>
  );
}

function Toggle({ on, onChange, label, hint }) {
  return (
    <label class="set-row">
      <div>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <input type="checkbox" class="switch" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

function Stepper({ label, value, options, onChange, fmt = (v) => v }) {
  return (
    <div class="set-row">
      <b>{label}</b>
      <div class="chips">
        {options.map((o) => (
          <button class={'pill small' + (o === value ? ' active' : '')} onClick={() => onChange(o)}>
            {fmt(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function AbsCard() {
  const cfg = useStore(abs);
  const [server, setServer] = useState(cfg.server || '');
  const [user, setUser] = useState(cfg.username || '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [libs, setLibs] = useState(null);
  if (cfg.token) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>Connected</b>
            <small>
              {cfg.username} @ {cfg.server}
            </small>
          </div>
          <button class="pill danger small" onClick={() => absSrc.logout()}>
            Sign out
          </button>
        </div>
        <div class="set-row">
          <b>Library</b>
          {libs ? (
            <select value={cfg.libraryId} onChange={(e) => abs.patch({ libraryId: e.currentTarget.value })}>
              {libs.map((l) => (
                <option value={l.id}>{l.name}</option>
              ))}
            </select>
          ) : (
            <button class="pill small" onClick={() => absSrc.libraries().then(setLibs).catch((e) => toast(e.message))}>
              Choose…
            </button>
          )}
        </div>
      </>
    );
  }
  return (
    <form
      class="set-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const l = await absSrc.login(server, user, pass);
          setLibs(l);
          setPass('');
          toast('Connected to Audiobookshelf');
        } catch (err) {
          toast(err.message || 'Could not connect');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="muted">Stream from your own Audiobookshelf server. Progress syncs both ways.</p>
      <input placeholder="https://abs.example.com" value={server} onInput={(e) => setServer(e.currentTarget.value)} autocapitalize="off" inputmode="url" />
      <input placeholder="Username" value={user} onInput={(e) => setUser(e.currentTarget.value)} autocapitalize="off" />
      <input placeholder="Password" type="password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} />
      <button class="btn primary" disabled={busy || !server || !user}>
        {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
      </button>
    </form>
  );
}

function AddonsCard() {
  const list = useStore(addons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p class="muted pad-s">Install catalog addons that speak the Stremio addon protocol (manifest.json). Only install addons you trust.</p>
      {list.map((a) => (
        <div class="set-row addon-row">
          {a.manifest.logo ? <img src={a.manifest.logo} alt="" class="addon-logo" /> : <span class="addon-logo"><Icon name="puzzle" size={18} /></span>}
          <div>
            <b>{a.manifest.name}</b>
            <small>
              v{a.manifest.version} · {(a.manifest.catalogs || []).length} catalogs
            </small>
          </div>
          <button class="icon-btn" aria-label="Remove addon" onClick={() => addonSrc.uninstall(a.manifest.id)}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      ))}
      <form
        class="set-form inline"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const m = await addonSrc.install(url);
            toast(`Installed ${m.name}`);
            setUrl('');
          } catch (err) {
            toast(err.message || 'Install failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="https://…/manifest.json" value={url} onInput={(e) => setUrl(e.currentTarget.value)} autocapitalize="off" inputmode="url" />
        <button class="btn primary" disabled={busy || !url}>
          {busy ? <span class="spinner" /> : <Icon name="plus" size={16} />}
        </button>
      </form>
    </>
  );
}

export function Settings() {
  const st = useStore(settings);
  const setSource = (k, v) => settings.patch({ sources: { ...st.sources, [k]: v } });
  return (
    <div class="screen settings">
      <h1 class="screen-title">Settings</h1>

      <Section icon="palette" title="Appearance">
        <div class="set-row">
          <b>Mode</b>
          <div class="chips">
            {['dark', 'amoled', 'light'].map((m) => (
              <button class={'pill small' + (st.mode === m ? ' active' : '')} onClick={() => settings.patch({ mode: m })}>
                {m === 'amoled' ? 'Black' : m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div class="set-row column">
          <b>Accent</b>
          <div class="accent-grid">
            {Object.entries(ACCENTS).map(([k, a]) => (
              <button
                class={'accent' + (st.accent === k ? ' active' : '')}
                style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})` }}
                onClick={() => settings.patch({ accent: k })}
                aria-label={a.name}
              >
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
        <Toggle label="Dynamic colour" hint="Tint the player and book pages from the cover art" on={st.dynamicColor} onChange={(v) => settings.patch({ dynamicColor: v })} />
      </Section>

      <Section icon="headphones" title="Playback">
        <Stepper label="Skip back" value={st.skipBack} options={[5, 10, 15, 30]} fmt={(v) => v + 's'} onChange={(v) => settings.patch({ skipBack: v })} />
        <Stepper label="Skip forward" value={st.skipForward} options={[10, 15, 30, 45, 60]} fmt={(v) => v + 's'} onChange={(v) => settings.patch({ skipForward: v })} />
      </Section>

      <Section icon="sparkle" title="Sources">
        {Object.entries(SOURCES).map(([k, s]) => (
          <Toggle label={s.name} hint={s.blurb} on={st.sources[k === 'addon' ? 'addons' : k] !== false} onChange={(v) => setSource(k === 'addon' ? 'addons' : k, v)} />
        ))}
        <Stepper label="Ebook language" value={st.language} options={['en', 'fr', 'de', 'es', 'it', 'pt', 'nl']} fmt={(v) => v.toUpperCase()} onChange={(v) => settings.patch({ language: v })} />
      </Section>

      <Section icon="server" title="Audiobookshelf">
        <AbsCard />
      </Section>

      <Section icon="puzzle" title="Addons">
        <AddonsCard />
      </Section>

      <Section icon="download" title="Data">
        <div class="set-row">
          <div>
            <b>Backup</b>
            <small>Library, progress, bookmarks & addons</small>
          </div>
          <div class="chips">
            <button
              class="pill small"
              onClick={async () => {
                const text = exportBackup();
                try {
                  await navigator.clipboard.writeText(text);
                  toast('Backup copied to clipboard');
                } catch {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                  a.download = 'inkwell-backup.json';
                  a.click();
                }
              }}
            >
              Export
            </button>
            <label class="pill small">
              Import
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  try {
                    importBackup(await f.text());
                    toast('Backup restored');
                  } catch (err) {
                    toast(err.message);
                  }
                }}
              />
            </label>
          </div>
        </div>
        <div class="set-row">
          <b>Network cache</b>
          <button
            class="pill small"
            onClick={() => {
              clearHttpCache();
              toast('Cache cleared');
            }}
          >
            Clear
          </button>
        </div>
      </Section>

      <p class="about">
        Inkwell 1.0 · Built-in sources are free and public domain.
        <br />
        Addons and servers you add are your responsibility.
      </p>
      <div class="footer-space" />
    </div>
  );
}
