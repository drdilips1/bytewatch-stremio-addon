import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { searchSources, sourceAddons, fmtSize } from '../sources/sourceaddons.js';
import { cloud, getDetails } from '../sources/index.js';
import { settings, useStore, debrid } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { waitlist, wait, cancel } from '../lib/waitlist.js';
import { translit } from '../lib/translit.js';

const LABEL = { torbox: 'TorBox', realdebrid: 'Real-Debrid' };

/** Results from installed source addons, with Add-to-debrid and Play actions. */
export function SourceResults({ title: rawTitle = '', author: rawAuthor = '', query: rawQuery = '', book = null, heading = true }) {
  // Source sites list Hindi books in Latin letters.
  const title = translit(rawTitle);
  const author = translit(rawAuthor);
  const query = translit(rawQuery);
  const st = useStore(settings);
  useStore(debrid);
  const [groups, setGroups] = useState({});
  const [pending, setPending] = useState(false);
  const [account, setAccount] = useState(new Map());
  const [showDead, setShowDead] = useState(false);
  const refreshAccount = () => cloud.accountStatus().then(setAccount).catch(() => {});
  const count = sourceAddons().length;
  const provider = cloud.preferredProvider(st.debridPreferred);

  useEffect(() => {
    if (!count || !(title || query)) return;
    let alive = true;
    setGroups({});
    setPending(true);
    // Wait until typing settles so half-typed words don't use up the addon's search allowance.
    const t = setTimeout(() => {
      searchSources({ title, author, query }, (name, results, error) => {
        if (alive) setGroups((g) => ({ ...g, [name]: { results, error } }));
      }).then(() => alive && setPending(false));
      refreshAccount();
    }, query && !title ? 900 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [title, author, query, count]);

  if (!count) return null;
  const entries = Object.entries(groups);
  const total = entries.reduce((a, [, g]) => a + g.results.length, 0);
  // Results nobody is seeding can't be downloaded unless the service already has them.
  const all = entries.flatMap(([, g]) => g.results);
  const alive = (r) => r.seeders > 0 || !(r.magnet || r.hash) || r.cache?.any || account.has(r.hash);
  const visible = showDead ? all : all.filter(alive);
  const hiddenDead = all.length - all.filter(alive).length;
  const shownGroups = groupResults(visible);

  return (
    <section class="source-results">
      {heading && (
        <h3 class="section-label">
          <Icon name="puzzle" size={16} /> Sources {total > 0 && <small>{total}</small>}
        </h3>
      )}
      {!provider && (
        <button class="btn ghost-wide" onClick={() => nav.tab('settings')}>
          <Icon name="link" size={16} /> Connect TorBox or Real-Debrid to play these
        </button>
      )}
      {pending && !total && (
        <p class="muted pad-s">
          <span class="spinner small" /> Searching {sourceAddons().map((a) => a.manifest.name).join(', ')}…
        </p>
      )}
      {entries.map(([name, g]) =>
        g.error ? (
          <p class="muted pad-s err-soft">
            {name}: {g.error.message}
          </p>
        ) : null
      )}
      {!pending && !total && entries.length > 0 && <p class="muted pad-s">No source results.</p>}
      <div class="src-list">
        {shownGroups.map((g) =>
          g.items.length === 1 ? (
            <SourceRow key={g.items[0].key} r={g.items[0]} provider={provider} book={book} inAccount={account.get(g.items[0].hash)} onChanged={refreshAccount} />
          ) : (
            <SourceFolder key={g.key} g={g} provider={provider} book={book} account={account} onChanged={refreshAccount} />
          )
        )}
      </div>
      {hiddenDead > 0 && (
        <button class="btn ghost-wide" onClick={() => setShowDead(!showDead)}>
          {showDead ? 'Hide' : 'Show'} {hiddenDead} result{hiddenDead === 1 ? '' : 's'} with no seeders
        </button>
      )}
    </section>
  );
}

function seedClass(n) {
  return n >= 10 ? 'good' : n > 0 ? 'low' : 'none';
}

function SourceRow({ r, provider, book, inAccount, onChanged }) {
  const [busy, setBusy] = useState(null); // 'add' | 'play'
  const [status, setStatus] = useState(null); // { text, pct (0..1) | null }
  const waiting = useStore(waitlist).find((w) => w.hash === r.hash);
  const cachedFor = provider && (r.cache[provider] || (provider === 'realdebrid' && r.cache.any && !r.cache.torbox));
  const ready = !!(cachedFor || inAccount?.ready);
  const dead = !ready && !inAccount && r.seeders === 0 && !!(r.magnet || r.hash);

  const need = () => {
    if (provider) return true;
    toast('Connect TorBox or Real-Debrid in Settings first');
    nav.tab('settings');
    return false;
  };

  const add = async () => {
    if (!need()) return;
    setBusy('add');
    setStatus({ text: `Adding to ${LABEL[provider]}…`, pct: null });
    try {
      toast(await cloud.addMagnetOnly(provider, r));
      cloud.forget();
      setTimeout(onChanged, 1500);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  const play = async () => {
    if (!need()) return;
    setBusy('play');
    setStatus({ text: ready ? 'Getting it from your cloud…' : 'Contacting ' + LABEL[provider] + '…', pct: null });
    try {
      const stub = await cloud.prepareMagnet(provider, r, (text, pct) => setStatus({ text, pct }));
      setStatus({ text: 'Opening the player…', pct: 1 });
      const details = await getDetails({
        ...stub,
        title: book?.title || stub.title,
        author: book?.author || r.author || stub.author,
        cover: book?.cover || stub.cover,
      });
      nav.openOverlay('player');
      player.playBook(details);
      setStatus(null);
    } catch (e) {
      setStatus(null);
      if (e.pending) {
        wait({
          ...e.pending,
          magnet: r.magnet,
          title: r.title,
          bookTitle: book?.title || '',
          author: book?.author || r.author || '',
          cover: book?.cover || '',
        });
        toast(`${e.message} — it will start playing automatically when it's ready`);
      } else toast(e.message);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  // While it's downloading in the account, keep the progress bar moving.
  useEffect(() => {
    if (!inAccount || inAccount.ready) return;
    const t = setInterval(() => {
      cloud.forget();
      onChanged();
    }, 6000);
    return () => clearInterval(t);
  }, [inAccount?.ready, !!inAccount]);

  const acct = inAccount
    ? `In your ${LABEL[inAccount.provider]} · ${inAccount.ready ? 'ready to play' : `${Math.round(inAccount.progress * 100)}%${inAccount.state ? ` · ${inAccount.state}` : ''}`}`
    : '';

  return (
    <div class={'src-row' + (ready ? ' is-ready' : '') + (dead ? ' is-dead' : '')}>
      <div class="src-title">{r.title}</div>
      {(r.author || r.narrator) && (
        <div class="src-sub">
          {r.author}
          {r.narrator ? ` · read by ${r.narrator}` : ''}
        </div>
      )}
      <div class="src-chips">
        {ready && <span class="chip ready">READY</span>}
        {r.format && <span class="chip">{String(r.format).toUpperCase()}</span>}
        {r.size > 0 && <span class="chip">{fmtSize(r.size)}</span>}
        {(r.magnet || r.hash) && <span class={'chip seeds ' + seedClass(r.seeders)}>{r.seeders} seed{r.seeders === 1 ? '' : 's'}</span>}
        {r.language && <span class="chip">{r.language}</span>}
        <span class="chip ghost">{r.addon}</span>
      </div>
      {acct && <div class={'src-acct' + (inAccount.ready ? ' ok' : '')}>{acct}</div>}
      {inAccount && !inAccount.ready && !status && !waiting && <Progress text={`Downloading in your ${LABEL[inAccount.provider]}`} pct={inAccount.progress} />}
      {waiting && !waiting.ready && (
        <div class="src-waiting">
          <Progress text="Will play when ready" pct={waiting.progress || 0} />
          <button class="link-btn" onClick={() => cancel(waiting.hash)}>
            Cancel
          </button>
        </div>
      )}
      {dead && <div class="src-warn">No seeders — your debrid service may never finish downloading this one.</div>}
      {status && <Progress text={status.text} pct={status.pct} />}
      <div class={'src-actions' + (ready || !(r.magnet || r.hash) ? ' ready' : '')}>
        {!(r.magnet || r.hash) ? (
          <a class="btn primary" href={r.link} target="_blank" rel="noopener">
            <Icon name="external" size={16} /> Open
          </a>
        ) : ready ? (
          <>
            <button class="btn primary" disabled={!!busy} onClick={play}>
              {busy === 'play' ? <span class="spinner" /> : <Icon name="play" size={16} />} Play
            </button>
            {!inAccount && (
              <button class="btn outline icon-only" disabled={!!busy} onClick={add} aria-label={`Add to ${LABEL[provider] || 'debrid'}`}>
                {busy === 'add' ? <span class="spinner" /> : <Icon name="download" size={18} />}
              </button>
            )}
          </>
        ) : (
          <>
            <button class="btn outline" disabled={!!busy || !!inAccount} onClick={add}>
              {busy === 'add' ? <span class="spinner" /> : <Icon name="download" size={16} />}{' '}
              {inAccount ? 'Added' : provider ? `Add to ${LABEL[provider]}` : 'Add to debrid'}
            </button>
            <button class="btn primary" disabled={!!busy} onClick={play}>
              {busy === 'play' ? <span class="spinner" /> : <Icon name="play" size={16} />} Play
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Progress bar with a label; pct null shows an indeterminate (moving) bar. */
function Progress({ text, pct }) {
  const known = pct != null;
  const p = known ? Math.max(0, Math.min(100, Math.round(pct * 100))) : 0;
  return (
    <div class="src-progress">
      <div class="src-progress-head">
        <span>{text}</span>
        {known && <b>{p}%</b>}
      </div>
      <div class={'src-progress-track' + (known ? '' : ' indeterminate')}>
        <div style={known ? { width: Math.max(p, 3) + '%' } : null} />
      </div>
    </div>
  );
}

// "Book - 01.mp3", "Book - 02.mp3"… or several rows for the same torrent: one folder.
const baseName = (t) =>
  String(t)
    .toLowerCase()
    .replace(/\.(mp3|m4a|m4b|aac|flac|ogg|opus|wav)$/i, '')
    .replace(/\b(part|pt|chapter|ch|track|disc|cd|file)\s*\d+\b/g, ' ')
    .replace(/[\s._-]*\d{1,3}\s*(of\s*\d+)?\s*$/g, ' ')
    .replace(/^\s*\d{1,3}[\s._-]+/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function groupResults(list) {
  const groups = [];
  const byKey = new Map();
  for (const r of list) {
    const key = (r.hash && `h:${r.hash}`) || `t:${r.addon}:${baseName(r.title)}`;
    const alt = `t:${r.addon}:${baseName(r.title)}`;
    let g = byKey.get(key) || byKey.get(alt);
    if (!g) {
      g = { key, items: [] };
      groups.push(g);
    }
    byKey.set(key, g);
    byKey.set(alt, g);
    g.items.push(r);
  }
  return groups;
}

/** Several files of one book, folded into one card. */
function SourceFolder({ g, provider, book, account, onChanged }) {
  const [open, setOpen] = useState(false);
  const first = g.items[0];
  const size = g.items.reduce((a, r) => a + (r.size || 0), 0);
  const seeds = Math.max(...g.items.map((r) => r.seeders || 0));
  return (
    <div class={'src-folder' + (open ? ' open' : '')}>
      <button class="src-folder-head" onClick={() => setOpen(!open)}>
        <Icon name="library" size={18} />
        <span class="src-folder-title">
          <b>{first.title.replace(/\.(mp3|m4a|m4b|aac|flac|ogg|opus)$/i, '').replace(/[\s._-]*(part|pt|chapter|ch|track|cd)?\s*\d{1,3}\s*$/i, '') || first.title}</b>
          <small>
            {g.items.length} files{size ? ` · ${fmtSize(size)}` : ''}
            {seeds ? ` · ${seeds} seeds` : ''} · {first.addon}
          </small>
        </span>
        <Icon name={open ? 'up' : 'down'} size={18} />
      </button>
      {open &&
        g.items.map((r) => <SourceRow key={r.key} r={r} provider={provider} book={book} inAccount={account.get(r.hash)} onChanged={onChanged} />)}
    </div>
  );
}
