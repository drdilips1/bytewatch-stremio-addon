import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { settings, addons, abs, debrid, hardcover, goodreads, useStore, exportBackup, importBackup } from '../lib/store.js';
import { SOURCES, absSrc, addonSrc, cloud, hc, gr } from '../sources/index.js';
import { clearHttpCache } from '../lib/http.js';
import { ACCENTS } from '../lib/theme.js';
import { APP_VERSION } from '../components/update.jsx';
import { PROVIDERS, clearMetaCache } from '../lib/meta.js';
import { AccountCard, VoicesCard } from './settings-extra.jsx';
import { UpdateCard } from '../components/update.jsx';

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
  const [alt, setAlt] = useState(cfg.altServer || '');
  const [inUse, setInUse] = useState('');
  useEffect(() => {
    if (cfg.token && cfg.altServer) absSrc.resolveServer(true).then(setInUse).catch(() => {});
  }, [cfg.token, cfg.altServer]);
  const [server, setServer] = useState(cfg.server || '');
  const [mode, setMode] = useState('password');
  const [user, setUser] = useState(cfg.username || '');
  const [pass, setPass] = useState('');
  const [key, setKey] = useState('');
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
              {cfg.altServer && (
                <>
                  <br />
                  In use: {inUse || 'checking…'}
                </>
              )}
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
        <form
          class="set-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const used = await absSrc.setAltServer(alt);
              setInUse(used);
              toast(alt.trim() ? `Saved — now using ${used}` : 'Second address removed');
            } catch (err) {
              toast(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <small class="muted">Second address — e.g. Tailscale (100.x.y.z:port or your MagicDNS name). Inkwell uses whichever address answers and switches automatically when one stops working.</small>
          <div class="btn-row">
            <input placeholder="http://100.101.102.103:13378" value={alt} onInput={(e) => setAlt(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
            <button class="btn secondary" style={{ flex: 'none' }} disabled={busy}>
              {busy ? <span class="spinner" /> : 'Save'}
            </button>
          </div>
        </form>
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
          const l = mode === 'key' ? await absSrc.loginWithKey(server, key) : await absSrc.login(server, user, pass);
          setLibs(l);
          setPass('');
          setKey('');
          toast('Connected to Audiobookshelf');
        } catch (err) {
          toast(err.message || 'Could not connect');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="muted">Stream from your own Audiobookshelf server. Progress syncs both ways. A LAN address like 192.168.1.20:13378 works.</p>
      <input placeholder="Server address, e.g. 192.168.1.20:13378" value={server} onInput={(e) => setServer(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
      <div class="segmented tight">
        <button type="button" class={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>
          Password
        </button>
        <button type="button" class={mode === 'key' ? 'on' : ''} onClick={() => setMode('key')}>
          API key
        </button>
      </div>
      {mode === 'password' ? (
        <>
          <input placeholder="Username" value={user} onInput={(e) => setUser(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
          <input placeholder="Password" type="password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} />
        </>
      ) : (
        <input placeholder="API key (ABS → Settings → API Keys)" value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      )}
      <button class="btn primary" disabled={busy || !server || (mode === 'password' ? !user : !key)}>
        {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
      </button>
    </form>
  );
}

function DebridCard({ provider, label, keyHint, keyUrl }) {
  const cfg = useStore(debrid);
  const saved = cfg[provider];
  const [key, setKey] = useState('');
  const [who, setWho] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  if (!saved) {
    return (
      <form
        class="set-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const name = await cloud.verify(provider, key);
            debrid.patch({ [provider]: key.trim() });
            cloud.forget();
            setWho(name);
            setKey('');
            toast(`Connected to ${label}`);
          } catch (err) {
            toast(err.status === 401 || err.status === 403 ? `${label} rejected that key` : err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p class="muted">
          Stream the audiobooks already in your {label} cloud. Get your key at{' '}
          <a href={keyUrl} target="_blank" rel="noopener">
            {keyHint}
          </a>
          .
        </p>
        <input placeholder={`${label} API key`} value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={busy || !key.trim()}>
          {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
        </button>
      </form>
    );
  }
  return (
    <>
      <div class="set-row">
        <div>
          <b>Connected</b>
          <small>{who || `${label} key saved`}</small>
        </div>
        <button
          class="pill danger small"
          onClick={() => {
            debrid.patch({ [provider]: '' });
            cloud.forget();
          }}
        >
          Remove
        </button>
      </div>
      <form
        class="set-form inline"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            toast(await cloud.addLink(provider, link));
            cloud.forget();
            setLink('');
          } catch (err) {
            toast(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="Add a magnet or link to your cloud" value={link} onInput={(e) => setLink(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={busy || !link.trim()} aria-label="Add">
          {busy ? <span class="spinner" /> : <Icon name="plus" size={16} />}
        </button>
      </form>
    </>
  );
}

function HardcoverCard() {
  const cfg = useStore(hardcover);
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState('');
  if (cfg.token) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>Connected</b>
            <small>@{cfg.username} · shelves on Home, status buttons on book pages</small>
          </div>
          <button class="pill danger small" onClick={() => hc.disconnect()}>
            Sign out
          </button>
        </div>
        <div class="set-row">
          <div>
            <b>Shelves</b>
            <small>{check || 'Check that your shelves load'}</small>
          </div>
          <button
            class="pill small"
            onClick={async () => {
              setCheck('Loading…');
              try {
                const c = await hc.counts();
                setCheck(`Want to read ${c.want} · Reading ${c.reading} · Read ${c.read}`);
              } catch (e) {
                setCheck('Error: ' + e.message);
              }
            }}
          >
            Test
          </button>
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
          toast(`Connected as @${await hc.connect(tok)}`);
          setTok('');
        } catch (err) {
          toast(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p class="muted">
        Show your Want to Read / Currently Reading shelves and update them from Inkwell. Copy your token from{' '}
        <a href="https://hardcover.app/account/api" target="_blank" rel="noopener">
          hardcover.app/account/api
        </a>
        .
      </p>
      <input placeholder="Hardcover API token" value={tok} onInput={(e) => setTok(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      <button class="btn primary" disabled={busy || !tok.trim()}>
        {busy ? <span class="spinner" /> : <Icon name="link" size={16} />} Connect
      </button>
    </form>
  );
}

function GoodreadsCard() {
  const data = useStore(goodreads);
  return (
    <>
      <p class="muted pad-s">
        Goodreads no longer offers an API, so import your library export: goodreads.com → My Books → Import and export → <b>Export library</b>, then pick the CSV here.
      </p>
      <div class="set-row">
        <div>
          <b>{data.books.length ? `${data.books.length} books imported` : 'No library imported'}</b>
          {data.importedAt > 0 && <small>{gr.shelves().join(' · ')}</small>}
        </div>
        <div class="chips">
          <label class="pill small">
            {data.books.length ? 'Re-import' : 'Import CSV'}
            <input
              type="file"
              accept=".csv,text/csv,text/comma-separated-values"
              hidden
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                try {
                  toast(`Imported ${gr.importCsv(await f.text())} books`);
                } catch (err) {
                  toast(err.message);
                }
              }}
            />
          </label>
          {data.books.length > 0 && (
            <button class="pill danger small" onClick={() => goodreads.set({ books: [], importedAt: 0 })}>
              Clear
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function AddonsCard() {
  const list = useStore(addons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(null);
  return (
    <>
      <p class="muted pad-s">
        Paste an addon link: InkShelf-style source addons (JSON on jsonkeeper etc.), Stremio-style manifests, or addon collections. Only install addons you trust.
      </p>
      {list.map((a) => (
        <div class="set-row addon-row">
          {a.manifest.logo || a.manifest.icon ? <img src={a.manifest.logo || a.manifest.icon} alt="" class="addon-logo" /> : <span class="addon-logo"><Icon name="puzzle" size={18} /></span>}
          <div>
            <b>{a.manifest.name}</b>
            <small>
              v{a.manifest.version} · {a.kind === 'source' ? 'source addon · results in Search & book pages' : `${(a.manifest.catalogs || []).length} catalogs`}
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
          setRaw(null);
          try {
            const m = await addonSrc.install(url);
            toast(`Installed ${m.name}`);
            setUrl('');
          } catch (err) {
            toast(err.message || 'Install failed');
            if (err.raw) setRaw({ message: err.message, json: JSON.stringify(err.raw, null, 2) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="https://…/manifest.json or a JSON link" value={url} onInput={(e) => setUrl(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
        <button class="btn primary" disabled={busy || !url}>
          {busy ? <span class="spinner" /> : <Icon name="plus" size={16} />}
        </button>
      </form>
      {raw && (
        <div class="raw-box">
          <p>
            <b>{raw.message}</b> Tap Copy and send this to the developer to get it supported:
          </p>
          <pre>{raw.json.length > 4000 ? raw.json.slice(0, 4000) + '\n…' : raw.json}</pre>
          <div class="chips">
            <button
              class="pill small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(raw.json);
                  toast('Copied');
                } catch {
                  toast('Long-press the text to copy it');
                }
              }}
            >
              Copy
            </button>
            <button class="pill small ghost" onClick={() => setRaw(null)}>
              Hide
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function MetadataCard() {
  const st = useStore(settings);
  const order = (st.metaOrder || Object.keys(PROVIDERS)).filter((k) => PROVIDERS[k]);
  const on = st.metaProviders || {};
  const move = (i, d) => {
    const next = order.slice();
    [next[i], next[i + d]] = [next[i + d], next[i]];
    settings.patch({ metaOrder: next });
  };
  return (
    <>
      <p class="muted pad-s">Used for covers, clean titles, narrators and descriptions of TorBox / Real-Debrid files, addon results and Goodreads imports. Tried top to bottom.</p>
      {order.map((k, i) => (
        <div class="set-row meta-row">
          <div class="meta-order">
            <button class="icon-btn tiny" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ▲
            </button>
            <button class="icon-btn tiny" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ▼
            </button>
          </div>
          <div class="meta-name">
            <b>{PROVIDERS[k].name}</b>
            <small>{PROVIDERS[k].blurb}</small>
          </div>
          <input type="checkbox" class="switch" checked={on[k] !== false} onChange={(e) => settings.patch({ metaProviders: { ...on, [k]: e.currentTarget.checked } })} />
        </div>
      ))}
      <div class="set-row">
        <b>Metadata cache</b>
        <button
          class="pill small"
          onClick={() => {
            clearMetaCache();
            toast('Metadata will be looked up again');
          }}
        >
          Refresh all
        </button>
      </div>
    </>
  );
}

function PreferredDebrid() {
  const st = useStore(settings);
  const d = useStore(debrid);
  if (!d.torbox || !d.realdebrid) return null;
  return (
    <Section icon="download" title="Default debrid">
      <div class="set-row">
        <div>
          <b>Use for Add / Play</b>
          <small>Source addon results go to this service</small>
        </div>
        <div class="chips">
          {[
            ['torbox', 'TorBox'],
            ['realdebrid', 'Real-Debrid'],
          ].map(([k, label]) => (
            <button class={'pill small' + (st.debridPreferred === k ? ' active' : '')} onClick={() => settings.patch({ debridPreferred: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function Settings() {
  const st = useStore(settings);
  const setSource = (k, v) => settings.patch({ sources: { ...st.sources, [k]: v } });
  return (
    <div class="screen settings">
      <h1 class="screen-title">Settings</h1>

      <UpdateCard />
      <Section icon="server" title="Account & sync">
        <AccountCard />
      </Section>

      <Section icon="server" title="Audiobookshelf">
        <AbsCard />
      </Section>
      <Section icon="download" title="TorBox">
        <DebridCard provider="torbox" label="TorBox" keyHint="torbox.app/settings" keyUrl="https://torbox.app/settings" />
      </Section>
      <Section icon="download" title="Real-Debrid">
        <DebridCard provider="realdebrid" label="Real-Debrid" keyHint="real-debrid.com/apitoken" keyUrl="https://real-debrid.com/apitoken" />
      </Section>
      <PreferredDebrid />
      <Section icon="puzzle" title="Addons">
        <AddonsCard />
      </Section>
      <Section icon="headphones" title="Free voices">
        <VoicesCard />
      </Section>
      <Section icon="sparkle" title="Metadata providers">
        <MetadataCard />
      </Section>
      <Section icon="book" title="Hardcover">
        <HardcoverCard />
      </Section>
      <Section icon="library" title="Goodreads">
        <GoodreadsCard />
      </Section>

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
        {Object.entries(SOURCES).filter(([, x]) => !x.hidden).map(([k, s]) => (
          <Toggle label={s.name} hint={s.blurb} on={st.sources[k === 'addon' ? 'addons' : k] !== false} onChange={(v) => setSource(k === 'addon' ? 'addons' : k, v)} />
        ))}
        <Stepper label="Ebook language" value={st.language} options={['en', 'fr', 'de', 'es', 'it', 'pt', 'nl']} fmt={(v) => v.toUpperCase()} onChange={(v) => settings.patch({ language: v })} />
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
        Inkwell {APP_VERSION} · Built-in sources are free and public domain.
        <br />
        Addons and servers you add are your responsibility.
      </p>
      <div class="footer-space" />
    </div>
  );
}
