import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../components/icons.jsx';
import { toast } from '../components/common.jsx';
import { useStore } from '../lib/store.js';
import * as sync from '../lib/sync.js';
import { ttsCfg, ENGINES, synth, elevenVoices, clearAudioCache } from '../lib/tts.js';
import { deviceVoices } from '../lib/readaloud.js';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Long-press the text to copy it');
  }
}

export function AccountCard() {
  const a = useStore(sync.account);
  const [url, setUrl] = useState(a.url);
  const [key, setKey] = useState(a.anonKey);
  const [email, setEmail] = useState(a.email);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const run = (name, fn) => async (e) => {
    e?.preventDefault?.();
    setBusy(name);
    try {
      const msg = await fn();
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy('');
    }
  };

  if (sync.signedIn()) {
    return (
      <>
        <div class="set-row">
          <div>
            <b>{a.email}</b>
            <small>
              Last synced {ago(a.lastSync)}
              {a.status && ` · ${a.status}`}
            </small>
          </div>
          <button class="pill small" disabled={!!busy} onClick={run('sync', () => sync.syncNow().then(() => 'Synced'))}>
            {busy === 'sync' ? <span class="spinner small" /> : 'Sync now'}
          </button>
        </div>
        <label class="set-row">
          <div>
            <b>Sync service keys</b>
            <small>TorBox, Real-Debrid, Audiobookshelf, Hardcover & voice keys — so a new device is ready instantly</small>
          </div>
          <input type="checkbox" class="switch" checked={a.syncKeys} onChange={(e) => sync.account.patch({ syncKeys: e.currentTarget.checked })} />
        </label>
        <div class="set-row">
          <small>Library, progress, bookmarks, addons, shelves and settings sync automatically.</small>
          <button class="pill danger small" onClick={run('out', () => sync.signOut().then(() => 'Signed out'))}>
            Sign out
          </button>
        </div>
      </>
    );
  }

  if (!sync.configured() || showSetup) {
    return (
      <form
        class="set-form"
        onSubmit={run('cfg', async () => {
          sync.configure(url, key);
          setShowSetup(false);
          return 'Sync server saved — now create your account';
        })}
      >
        <p class="muted">
          Accounts sync your library, progress, addons and logins across devices. They run on your own free <b>Supabase</b> project (takes ~3 minutes):
        </p>
        <ol class="steps">
          <li>
            Sign up at{' '}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">
              supabase.com
            </a>{' '}
            and create a project.
          </li>
          <li>
            Open <b>SQL Editor</b>, paste the setup SQL below and press Run.{' '}
            <button type="button" class="link-btn" onClick={() => copy(sync.SETUP_SQL)}>
              Copy SQL
            </button>
          </li>
          <li>
            In <b>Project Settings → API</b>, copy the <b>Project URL</b> and the <b>anon public</b> key into the boxes below.
          </li>
        </ol>
        <pre class="sql">{sync.SETUP_SQL}</pre>
        <input placeholder="https://xxxx.supabase.co" value={url} onInput={(e) => setUrl(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} inputmode="url" />
        <input placeholder="anon public key (starts with eyJ…)" value={key} onInput={(e) => setKey(e.currentTarget.value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
        <button class="btn primary" disabled={!url.trim() || !key.trim() || !!busy}>
          <Icon name="link" size={16} /> Save sync server
        </button>
      </form>
    );
  }

  return (
    <form class="set-form" onSubmit={run('in', () => sync.signIn(email, pass))}>
      <p class="muted">Sign in or create an account to back up and sync everything. {a.status && <b>{a.status}</b>}</p>
      <input type="email" placeholder="Email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocapitalize="off" autocomplete="email" />
      <input type="password" placeholder="Password (6+ characters)" value={pass} onInput={(e) => setPass(e.currentTarget.value)} autocomplete="current-password" />
      <div class="btn-row">
        <button class="btn primary" disabled={!email || pass.length < 6 || !!busy}>
          {busy === 'in' ? <span class="spinner" /> : null} Sign in
        </button>
        <button type="button" class="btn secondary" disabled={!email || pass.length < 6 || !!busy} onClick={run('up', () => sync.signUp(email, pass))}>
          {busy === 'up' ? <span class="spinner" /> : null} Create account
        </button>
      </div>
      <button type="button" class="btn google" disabled={!!busy} onClick={run('g', () => sync.signInWith('google'))}>
        <span class="g-logo">G</span> Continue with Google
      </button>
      <div class="btn-row small">
        <button type="button" class="link-btn" disabled={!email} onClick={run('reset', () => sync.resetPassword(email))}>
          Forgot password?
        </button>
        <button type="button" class="link-btn" onClick={() => setShowSetup(true)}>
          Change sync server
        </button>
      </div>
      <p class="muted tiny">Google sign-in needs the Google provider switched on in your Supabase project (Authentication → Providers), with <code>app.inkwell.books://auth</code> added to Redirect URLs.</p>
    </form>
  );
}

export function VoicesCard() {
  const c = useStore(ttsCfg);
  const [open, setOpen] = useState(c.engine);
  const [phoneVoices, setPhoneVoices] = useState([]);
  const [eleven, setEleven] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    deviceVoices().then(setPhoneVoices);
  }, []);

  const preview = async (engine) => {
    setBusy(engine);
    try {
      const b64 = await synth(engine, 'Chapter one. It was a bright cold day in April, and the clocks were striking thirteen.');
      new Audio('data:audio/mpeg;base64,' + b64).play();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const e = ENGINES[open];
  const voices = open === 'elevenlabs' && eleven ? eleven : e.voices;
  const voiceField = open === 'openai' ? 'openaiVoice' : open === 'google' ? 'googleVoice' : 'elevenVoice';

  return (
    <>
      <p class="muted pad-s">
        Turn any ebook into an audiobook. <b>AI voices</b> sound like a real narrator and play in the audiobook player — they use your own API key and are generated only as you listen (cached on this phone). The <b>phone voice</b> is free and offline.
      </p>
      <div class="set-row column">
        <b>AI voice service</b>
        <div class="segmented tight">
          {Object.entries(ENGINES).map(([k, x]) => (
            <button type="button" class={open === k ? 'on' : ''} onClick={() => setOpen(k)}>
              {x.name}
              {c[x.keyField] ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <div class="set-form">
        <input
          type="password"
          placeholder={`${e.name} API key`}
          value={c[e.keyField]}
          onInput={(ev) => ttsCfg.patch({ [e.keyField]: ev.currentTarget.value.trim() })}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
        />
        <small class="muted">
          Get a key at{' '}
          <a href={e.keyUrl} target="_blank" rel="noopener">
            {e.keyUrl.replace(/^https:\/\//, '')}
          </a>
          . Billed by {e.name} per character — a typical novel is 400–600k characters.
        </small>
        {open === 'openai' && (
          <select value={c.openaiModel} onChange={(ev) => ttsCfg.patch({ openaiModel: ev.currentTarget.value })}>
            {e.models.map(([v, l]) => (
              <option value={v}>{l}</option>
            ))}
          </select>
        )}
        <div class="btn-row">
          <select
            value={c[voiceField]}
            onChange={(ev) => {
              const opt = ev.currentTarget.selectedOptions[0];
              ttsCfg.patch({ [voiceField]: ev.currentTarget.value, ...(open === 'elevenlabs' ? { elevenVoiceName: opt?.textContent || '' } : {}) });
            }}
          >
            {voices.map(([v, l]) => (
              <option value={v}>{l}</option>
            ))}
          </select>
          <button type="button" class="btn secondary" disabled={!c[e.keyField] || !!busy} onClick={() => preview(open)}>
            {busy === open ? <span class="spinner" /> : <Icon name="play" size={14} />} Preview
          </button>
        </div>
        {open === 'elevenlabs' && c.elevenKey && !eleven && (
          <button type="button" class="link-btn" onClick={() => elevenVoices().then(setEleven).catch((err) => toast(err.message))}>
            Load my ElevenLabs voices
          </button>
        )}
        <label class="set-row">
          <b>Use {e.name} by default</b>
          <input type="checkbox" class="switch" checked={c.engine === open} onChange={() => ttsCfg.patch({ engine: open })} />
        </label>
      </div>
      <div class="set-row column">
        <b>Phone voice</b>
        <div class="btn-row">
          <select value={c.deviceVoice} onChange={(ev) => ttsCfg.patch({ deviceVoice: +ev.currentTarget.value })}>
            <option value={-1}>System default</option>
            {phoneVoices.map((v) => (
              <option value={v.index}>
                {v.name} ({v.lang}){v.local === false ? ' · online' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn secondary"
            onClick={() =>
              TextToSpeech.speak({ text: 'This is how your phone voice sounds.', rate: c.deviceRate, voice: c.deviceVoice >= 0 ? c.deviceVoice : undefined }).catch((err) => toast(err.message))
            }
          >
            <Icon name="play" size={14} /> Preview
          </button>
        </div>
        <div class="chips">
          {[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((r) => (
            <button type="button" class={'pill small' + (c.deviceRate === r ? ' active' : '')} onClick={() => ttsCfg.patch({ deviceRate: r })}>
              {r}×
            </button>
          ))}
        </div>
        <small class="muted">Tip: for more natural phone voices, install “Speech Services by Google” and download a high-quality voice in Android Settings → Text-to-speech.</small>
      </div>
      <div class="set-row">
        <b>Generated audio</b>
        <button
          type="button"
          class="pill small"
          onClick={() => {
            clearAudioCache();
            toast('Cleared');
          }}
        >
          Clear cache
        </button>
      </div>
    </>
  );
}
