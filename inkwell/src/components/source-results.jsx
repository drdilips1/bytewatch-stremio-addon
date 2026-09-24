import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { searchSources, sourceAddons, fmtSize } from '../sources/sourceaddons.js';
import { cloud, getDetails } from '../sources/index.js';
import { settings, useStore, debrid } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { waitlist, wait, cancel } from '../lib/waitlist.js';

const LABEL = { torbox: 'TorBox', realdebrid: 'Real-Debrid' };

/** Results from installed source addons, with Add-to-debrid and Play actions. */
export function SourceResults({ title = '', author = '', query = '', book = null, heading = true }) {
  const st = useStore(settings);
  useStore(debrid);
  const [groups, setGroups] = useState({});
  const [pending, setPending] = useState(false);
  const [account, setAccount] = useState(new Map());
  const refreshAccount = () => cloud.accountStatus().then(setAccount).catch(() => {});
  const count = sourceAddons().length;
  const provider = cloud.preferredProvider(st.debridPreferred);

  useEffect(() => {
    if (!count || !(title || query)) return;
    let alive = true;
    setGroups({});
    setPending(true);
    searchSources({ title, author, query }, (name, results, error) => {
      if (alive) setGroups((g) => ({ ...g, [name]: { results, error } }));
    }).then(() => alive && setPending(false));
    refreshAccount();
    return () => (alive = false);
  }, [title, author, query, count]);

  if (!count) return null;
  const entries = Object.entries(groups);
  const total = entries.reduce((a, [, g]) => a + g.results.length, 0);

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
        {entries.flatMap(([, g]) => g.results).map((r) => (
          <SourceRow key={r.key} r={r} provider={provider} book={book} inAccount={account.get(r.hash)} onChanged={refreshAccount} />
        ))}
      </div>
    </section>
  );
}

function seedClass(n) {
  return n >= 10 ? 'good' : n > 0 ? 'low' : 'none';
}

function SourceRow({ r, provider, book, inAccount, onChanged }) {
  const [busy, setBusy] = useState(null); // 'add' | 'play'
  const [status, setStatus] = useState('');
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
    try {
      toast(await cloud.addMagnetOnly(provider, r));
      cloud.forget();
      setTimeout(onChanged, 1500);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };

  const play = async () => {
    if (!need()) return;
    setBusy('play');
    setStatus('');
    try {
      const stub = await cloud.prepareMagnet(provider, r, setStatus);
      setStatus('Opening…');
      const details = await getDetails({
        ...stub,
        title: book?.title || stub.title,
        author: book?.author || r.author || stub.author,
        cover: book?.cover || stub.cover,
      });
      nav.openOverlay('player');
      player.playBook(details);
      setStatus('');
    } catch (e) {
      setStatus('');
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
      {waiting && !waiting.ready && (
        <div class="src-waiting">
          <span class="spinner small" /> Will play when ready · {Math.round((waiting.progress || 0) * 100)}%
          <button class="link-btn" onClick={() => cancel(waiting.hash)}>
            Cancel
          </button>
        </div>
      )}
      {dead && <div class="src-warn">No seeders — your debrid service may never finish downloading this one.</div>}
      {status && <div class="src-status">{status}</div>}
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
