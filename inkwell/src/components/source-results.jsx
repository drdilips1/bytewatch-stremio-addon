import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { searchSources, sourceAddons, fmtSize } from '../sources/sourceaddons.js';
import { cloud, getDetails } from '../sources/index.js';
import { settings, useStore, debrid } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';

const LABEL = { torbox: 'TorBox', realdebrid: 'Real-Debrid' };

/** Results from installed source addons, with Add-to-debrid and Play actions. */
export function SourceResults({ title = '', author = '', query = '', book = null, heading = true }) {
  const st = useStore(settings);
  useStore(debrid);
  const [groups, setGroups] = useState({});
  const [pending, setPending] = useState(false);
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
          <SourceRow key={r.key} r={r} provider={provider} book={book} />
        ))}
      </div>
    </section>
  );
}

function SourceRow({ r, provider, book }) {
  const [busy, setBusy] = useState(null); // 'add' | 'play'
  const [status, setStatus] = useState('');
  const cached = provider && (r.cache[provider] || (provider === 'torbox' ? false : r.cache.any));
  const meta = [r.addon, r.format && String(r.format).toUpperCase(), fmtSize(r.size), r.seeders ? `${r.seeders} seeds` : '', r.language].filter(Boolean);

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
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="src-row">
      <div class="src-title">
        {cached && (
          <span class="src-instant" title="Cached — plays instantly">
            ⚡
          </span>
        )}
        {r.title}
      </div>
      {(r.author || r.narrator) && (
        <div class="src-sub">
          {r.author}
          {r.narrator ? ` · read by ${r.narrator}` : ''}
        </div>
      )}
      <div class="src-meta">{meta.join(' · ')}</div>
      {status && <div class="src-status">{status}</div>}
      <div class="src-actions">
        <button class="btn outline" disabled={!!busy} onClick={add}>
          {busy === 'add' ? <span class="spinner" /> : <Icon name="download" size={16} />} {provider ? `Add to ${LABEL[provider]}` : 'Add to debrid'}
        </button>
        <button class="btn primary" disabled={!!busy} onClick={play}>
          {busy === 'play' ? <span class="spinner" /> : <Icon name="play" size={16} />} Play
        </button>
      </div>
    </div>
  );
}
