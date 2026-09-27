import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { searchSources, sourceAddons, fmtSize } from '../sources/sourceaddons.js';
import { cloud, getDetails, absSrc } from '../sources/index.js';
import { addLink } from '../sources/debrid.js';
import { settings, useStore, debrid } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { waitlist, wait, cancel } from '../lib/waitlist.js';
import { translit } from '../lib/translit.js';
import * as qb from '../sources/qbit.js';
import { cleanTitle } from '../sources/debrid.js';

const trackerWords = (name) => cleanTitle(name).replace(/\s[-–:]\s/g, ' ');
import { openExternal } from '../sources/summaries.js';
import { directEbookFile, directReaderBook } from '../lib/epub.js';
import { shareEbook } from '../lib/kindle.js';

const LABEL = { torbox: 'TorBox', realdebrid: 'Real-Debrid' };
const SHORT = { torbox: 'TorBox', realdebrid: 'RD' };

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
  const [showLoose, setShowLoose] = useState(false);
  const refreshAccount = () => cloud.accountStatus().then(setAccount).catch(() => {});
  const count = sourceAddons().length;
  const provider = cloud.preferredProvider(st.debridPreferred);
  // Every connected service, preferred one first.
  const providers = [provider, cloud.tbConnected() && 'torbox', cloud.rdConnected() && 'realdebrid'].filter((p, i, a) => p && a.indexOf(p) === i);

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
  // Your tracker (Settings → Tracker): open a search for this book there.
  const trackerSite = qb.available && qb.tracker.get().url ? qb.trackerName() : '';
  const trackerFilter = trackerSite ? qb.trackerFilterLabel() : '';
  const entries = Object.entries(groups);
  const total = entries.reduce((a, [, g]) => a + g.results.filter((r) => !r.loose).length, 0);
  // Results nobody is seeding can't be downloaded unless the service already has them.
  // Audiobook sources (torrents your debrid / home server can fetch) first; plain
  // download links (e.g. ebook sites) after. Order within each kind is kept.
  // Results that may be a different book (see sameBook in sourceaddons.js) wait behind a button.
  const everything = entries.flatMap(([, g]) => g.results);
  const looseCount = everything.filter((r) => r.loose).length;
  const all = everything.filter((r) => showLoose || !r.loose).sort((a, b) => Number(!(a.magnet || a.hash)) - Number(!(b.magnet || b.hash)));
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
      {trackerSite && (title || query) && (
        <button class="pill small ghost tracker-jump" onClick={() => qb.openTracker([title || query, author].filter(Boolean).join(' ')).catch((e) => toast(e.message))}>
          <Icon name="search" size={14} /> Search on {trackerSite}
        </button>
      )}
      {!provider && (
        <button class="btn ghost-wide" onClick={() => nav.tab('settings')}>
          <Icon name="link" size={16} /> Connect TorBox or Real-Debrid to play these
        </button>
      )}
      {pending && !total && !looseCount && (
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
      {!pending && !total && entries.length > 0 && <p class="muted pad-s">{looseCount ? 'No results that are clearly this book.' : 'No source results.'}</p>}
      <div class="src-list">
        {shownGroups.map((g) =>
          g.items.length === 1 || g.key.startsWith('h:') ? (
            <SourceRow key={g.items[0].key} r={g.items[0]} provider={provider} providers={providers} book={book} inAccount={account.get(g.items[0].hash)} onChanged={refreshAccount} />
          ) : (
            <SourceFolder key={g.key} g={g} provider={provider} providers={providers} book={book} account={account} onChanged={refreshAccount} />
          )
        )}
      </div>
      {looseCount > 0 && (
        <button class="btn ghost-wide" onClick={() => setShowLoose(!showLoose)}>
          {showLoose ? 'Hide' : 'Show'} {looseCount} loose match{looseCount === 1 ? '' : 'es'} (may be other books)
        </button>
      )}
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

function SourceRow({ r, provider, providers = [], book, inAccount, onChanged }) {
  const [busy, setBusy] = useState(null); // 'add:<provider>' | 'play'
  const [status, setStatus] = useState(null); // { text, pct (0..1) | null }
  const [links, setLinks] = useState(null); // { provider, name, files: [{ name, size, url?, err? }], zip, zipUrl? }
  const waiting = useStore(waitlist).find((w) => w.hash === r.hash);
  useStore(qb.qbitSent);
  useStore(qb.qbit);
  const acc = (p) => inAccount?.both?.[p] || (inAccount?.provider === p ? inAccount : null);
  const cachedOn = (p) => !!(r.cache[p] || (p === 'realdebrid' && r.cache.any && !r.cache.torbox));
  const readyOn = (p) => cachedOn(p) || !!acc(p)?.ready;
  // Play through whichever service already has it; otherwise the preferred one.
  const playVia = providers.find(readyOn) || provider;
  const ready = providers.some(readyOn);
  const dead = !ready && !inAccount && r.seeders === 0 && !!(r.magnet || r.hash);
  const downloading = providers.map((p) => [p, acc(p)]).find(([, a]) => a && !a.ready);

  const need = () => {
    if (provider) return true;
    toast('Connect TorBox or Real-Debrid in Settings first');
    nav.tab('settings');
    return false;
  };

  // Auto-send (Settings > Home server): what you add here goes to qBittorrent too.
  const autoSend = () =>
    qb
      .autoSendAdded({ hash: cloud.infoHash(r.magnet, r.hash), magnet: r.magnet, title: book?.title || r.title, author: book?.author || r.author || '', rawName: r.title, format: r.format })
      .then((m) => m && toast(m));

  const add = async (p) => {
    if (!need()) return;
    setBusy('add:' + p);
    setStatus({ text: `Adding to ${LABEL[p]}…`, pct: null });
    try {
      toast(await cloud.addMagnetOnly(p, r));
      autoSend(); // auto-send to the home server, if that's on
      cloud.forget();
      setTimeout(onChanged, 1500);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  const play = async (chosen) => {
    if (!need()) return;
    const via = typeof chosen === 'string' ? chosen : playVia;
    setBusy(via === playVia ? 'play' : 'play:' + via);
    setStatus({ text: readyOn(via) ? `Getting it from your ${LABEL[via]}…` : 'Contacting ' + LABEL[via] + '…', pct: null });
    try {
      const stub = await cloud.prepareMagnet(via, r, (text, pct) => setStatus({ text, pct }));
      autoSend();
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

  // Direct download links from TorBox / Real-Debrid for every file.
  const getLinks = async (via) => {
    if (!need()) return;
    setBusy('links');
    setLinks(null);
    setStatus({ text: `Getting links from ${LABEL[via]}…`, pct: null });
    try {
      const res = await cloud.downloadLinks(via, r, (text, pct) => setStatus({ text, pct }));
      autoSend();
      if (!res.files.length) throw new Error(`${LABEL[via]} lists no files for this one`);
      const files = res.files.map((f) => ({ ...f }));
      setLinks({ ...res, files });
      setStatus({ text: 'Preparing links…', pct: 0 });
      // Links are fetched up front (a few at a time) so Copy works with one tap.
      let done = 0;
      const queue = files.slice(0, 60).map((f, i) => [f, i]);
      const worker = async () => {
        while (queue.length) {
          const [f, i] = queue.shift();
          try {
            f.url = await f.resolve();
          } catch (e) {
            f.err = e.message;
          }
          done++;
          setStatus({ text: 'Preparing links…', pct: done / Math.min(files.length, 60) });
          setLinks((l) => l && { ...l, files: l.files.map((x, k) => (k === i ? { ...f } : x)) });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (res.zip) {
        const zipUrl = await res.zip().catch(() => '');
        setLinks((l) => l && { ...l, zipUrl });
      }
      cloud.forget();
      onChanged();
    } catch (e) {
      toast(e.message);
    } finally {
      setStatus(null);
      setBusy(null);
    }
  };

  // While it's downloading in an account, keep the progress bar moving.
  useEffect(() => {
    if (!downloading) return;
    const t = setInterval(() => {
      cloud.forget();
      onChanged();
    }, 6000);
    return () => clearInterval(t);
  }, [!!downloading]);

  const hasMagnet = !!(r.magnet || r.hash);
  // Direct ebook links (no torrent): EPUB opens in the reader; any ebook can be saved to another app.
  const ebook = hasMagnet ? null : directEbookFile(r);
  const shareDirect = async () => {
    setBusy('share');
    setStatus({ text: 'Downloading the ebook…', pct: null });
    try {
      await shareEbook(ebook, { title: book?.title || r.title });
    } catch (e) {
      toast(e.message);
    } finally {
      setStatus(null);
      setBusy(null);
    }
  };
  // Direct ebook links can also go to your TorBox (web download) or your Audiobookshelf ebooks library.
  const keepDirect = async (where) => {
    setBusy(where);
    if (where === 'abs') setStatus({ text: 'Downloading, then adding to Audiobookshelf…', pct: null });
    try {
      toast(
        where === 'tb'
          ? await addLink('torbox', r.link)
          : await absSrc.uploadEbook({ url: r.link, name: ebook.name, title: book?.title || r.title, author: book?.author || r.author || '' })
      );
    } catch (e) {
      toast(e.message);
    } finally {
      setStatus(null);
      setBusy(null);
    }
  };
  const home = hasMagnet && qb.available && qb.configured();
  const trackerSite = qb.available && qb.tracker.get().url ? qb.trackerName() : '';
  const trackerFilter = trackerSite ? qb.trackerFilterLabel() : '';
  const homeHash = home ? cloud.infoHash(r.magnet, r.hash) : '';
  const sentHome = !!homeHash && qb.wasSent(homeHash);
  const sendHome = async () => {
    setBusy('home');
    try {
      toast(await qb.send({ hash: homeHash, magnet: r.magnet, title: book?.title || r.title, author: book?.author || r.author || '', rawName: r.title }));
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };

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
        {r.format && <span class="chip">{String(r.format).toUpperCase()}</span>}
        {r.size > 0 && <span class="chip">{fmtSize(r.size)}</span>}
        {hasMagnet && <span class={'chip seeds ' + seedClass(r.seeders)}>{r.seeders} seed{r.seeders === 1 ? '' : 's'}</span>}
        {r.language && <span class="chip">{r.language}</span>}
        <span class="chip ghost">{r.addon}</span>
        {trackerSite && trackerFilter && (
          <button class="chip tracker-chip" onClick={() => qb.openTracker(trackerWords(r.title), true, qb.isEbookName(`${r.title} ${r.format || ''}`)).catch((e) => toast(e.message))} aria-label={`Search ${trackerSite} (${trackerFilter}) for this`}>
            <Icon name="search" size={12} /> {trackerFilter}
          </button>
        )}
        {trackerSite && (
          <button class="chip tracker-chip" onClick={() => qb.openTracker(trackerWords(r.title)).catch((e) => toast(e.message))} aria-label={`Search ${trackerSite} for this`}>
            <Icon name="search" size={12} /> {trackerFilter ? 'All' : trackerSite}
          </button>
        )}
      </div>
      {hasMagnet && (providers.length > 0 || home) && (
        <div class="src-services">
          {providers.map((p) => {
            const a = acc(p);
            const label = a ? (a.ready ? 'in your account · ready' : `in your account · ${Math.round((a.progress || 0) * 100)}%`) : cachedOn(p) ? 'cached · instant' : 'not cached';
            return (
              <div class={'svc' + (readyOn(p) ? ' ok' : '')}>
                <b>{LABEL[p]}</b>
                <span>{label}</span>
                {!a && (
                  <button class="pill small" disabled={!!busy} onClick={() => add(p)} aria-label={`Add to ${LABEL[p]}`}>
                    {busy === 'add:' + p ? <span class="spinner small" /> : <Icon name="plus" size={14} />} {SHORT[p]}
                  </button>
                )}
              </div>
            );
          })}
          {home && (
            <div class={'svc' + (sentHome ? ' ok' : '')}>
              <b>Home server</b>
              <span>{sentHome ? 'sent to qBittorrent' : 'qBittorrent'}</span>
              <button class="pill small" disabled={!!busy} onClick={sendHome} aria-label="Send to your home server">
                {busy === 'home' ? <span class="spinner small" /> : <Icon name={sentHome ? 'check' : 'plus'} size={14} />} Home
              </button>
            </div>
          )}
        </div>
      )}
      {downloading && !status && !waiting && <Progress text={`Downloading in your ${LABEL[downloading[0]]}`} pct={downloading[1].progress} />}
      {waiting && !waiting.ready && (
        <div class="src-waiting">
          <Progress text="Will play when ready" pct={waiting.progress || 0} />
          <button class="link-btn" onClick={() => cancel(waiting.hash)}>
            Cancel
          </button>
        </div>
      )}
      {ebook && (cloud.tbConnected() || absSrc.connected()) && (
        <div class="src-services">
          {cloud.tbConnected() && (
            <div class="svc">
              <b>TorBox</b>
              <span>keep a copy in your cloud</span>
              <button class="pill small" disabled={!!busy} onClick={() => keepDirect('tb')} aria-label="Add to TorBox">
                {busy === 'tb' ? <span class="spinner small" /> : <Icon name="plus" size={14} />} TorBox
              </button>
            </div>
          )}
          {absSrc.connected() && (
            <div class="svc">
              <b>Home server</b>
              <span>Audiobookshelf ebooks</span>
              <button class="pill small" disabled={!!busy} onClick={() => keepDirect('abs')} aria-label="Add to your Audiobookshelf ebooks library">
                {busy === 'abs' ? <span class="spinner small" /> : <Icon name="plus" size={14} />} Server
              </button>
            </div>
          )}
        </div>
      )}
      {dead && <div class="src-warn">No seeders — your debrid service may never finish downloading this one.</div>}
      {status && <Progress text={status.text} pct={status.pct} />}
      <div class="src-actions ready">
        {!hasMagnet && ebook ? (
          <>
            {ebook.format === 'EPUB' && (
              <button class="btn primary" onClick={() => nav.push('reader', { book: directReaderBook(r, ebook, book) })}>
                <Icon name="book" size={16} /> Read
              </button>
            )}
            <button
              class={ebook.format === 'EPUB' ? 'btn secondary play-alt' : 'btn primary'}
              disabled={!!busy}
              onClick={shareDirect}
              aria-label="Download and open in a reader app or Kindle"
            >
              {busy === 'share' ? <span class="spinner" /> : <Icon name="upload" size={ebook.format === 'EPUB' ? 14 : 16} />}{' '}
              {ebook.format === 'EPUB' ? 'Kindle' : 'Kindle / open in app'}
            </button>
            <a class="btn secondary play-alt src-web" href={r.link} target="_blank" rel="noopener" aria-label="Open in browser">
              <Icon name="external" size={14} />
            </a>
          </>
        ) : !hasMagnet ? (
          <a class="btn primary" href={r.link} target="_blank" rel="noopener">
            <Icon name="external" size={16} /> Open
          </a>
        ) : (
          <>
            <button class="btn primary" disabled={!!busy} onClick={() => play(playVia)}>
              {busy === 'play' ? <span class="spinner" /> : <Icon name="play" size={16} />} Play{providers.length > 1 && playVia ? ` · ${LABEL[playVia]}` : ''}
            </button>
            {providers
              .filter((p) => p !== playVia)
              .map((p) => (
                <button class="btn secondary play-alt" disabled={!!busy} onClick={() => play(p)} aria-label={`Play through ${LABEL[p]}`}>
                  {busy === 'play:' + p ? <span class="spinner" /> : <Icon name="play" size={14} />} {SHORT[p]}
                </button>
              ))}
            {provider && (
              <button class="btn secondary play-alt" disabled={!!busy} onClick={() => (links ? setLinks(null) : getLinks(playVia))} aria-label="Download links">
                {busy === 'links' ? <span class="spinner" /> : <Icon name="link" size={14} />} Links
              </button>
            )}
          </>
        )}
      </div>
      {links && (
        <LinksPanel
          links={links}
          others={providers.filter((p) => p !== links.provider)}
          onSwitch={(p) => getLinks(p)}
          onClose={() => setLinks(null)}
        />
      )}
    </div>
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: fall back to a hidden text box.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Direct download links for one result's files. */
function LinksPanel({ links, others, onSwitch, onClose }) {
  const [open, setOpen] = useState(links.files.length <= 8);
  const ready = links.files.filter((f) => f.url);
  const copy = async (text, what) => toast((await copyText(text)) ? `${what} copied` : 'Could not copy — long-press the link instead');
  const fileUrl = async (f) => f.url || (f.url = await f.resolve());
  return (
    <div class="links-panel">
      <div class="links-head">
        <b>Download links · {LABEL[links.provider]}</b>
        <button class="icon-btn" aria-label="Close links" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <small class="muted">Links are personal to your account and expire after a while — get fresh ones here any time.</small>
      <div class="links-bulk">
        {links.zipUrl && (
          <>
            <button class="pill small" onClick={() => copy(links.zipUrl, 'Folder .zip link')}>
              <Icon name="link" size={14} /> Copy whole folder (.zip)
            </button>
            <button class="pill small ghost" onClick={() => openExternal(links.zipUrl)}>
              <Icon name="download" size={14} /> Download .zip
            </button>
          </>
        )}
        {ready.length > 1 && (
          <button class="pill small" onClick={() => copy(ready.map((f) => f.url).join('\n'), `${ready.length} links`)}>
            <Icon name="link" size={14} /> Copy all {ready.length} links
          </button>
        )}
        {others.map((p) => (
          <button class="pill small ghost" onClick={() => onSwitch(p)}>
            Use {LABEL[p]} instead
          </button>
        ))}
      </div>
      {links.files.length > 8 && (
        <button class="link-btn" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} {links.files.length} files
        </button>
      )}
      {open &&
        links.files.map((f) => (
          <div class="link-row">
            <div class="link-name">
              <span>{f.name}</span>
              <small>{f.err ? f.err : f.size > 0 ? fmtSize(f.size) : f.url ? '' : 'preparing…'}</small>
            </div>
            <button
              class="icon-btn"
              aria-label={`Copy link for ${f.name}`}
              onClick={async () => {
                try {
                  copy(await fileUrl(f), 'Link');
                } catch (e) {
                  toast(e.message);
                }
              }}
            >
              <Icon name="link" size={16} />
            </button>
            <button
              class="icon-btn"
              aria-label={`Download ${f.name}`}
              onClick={async () => {
                try {
                  openExternal(await fileUrl(f));
                } catch (e) {
                  toast(e.message);
                }
              }}
            >
              <Icon name="download" size={16} />
            </button>
          </div>
        ))}
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

// Torrents are grouped only by info-hash (the same torrent listed twice shows as one card;
// different torrents with the same name stay separate). Direct files of one book — part 1,
// part 2… — fold into one card.
function groupResults(list) {
  const groups = [];
  const byKey = new Map();
  for (const r of list) {
    const key = r.hash ? `h:${String(r.hash).toLowerCase()}` : `t:${r.addon}:${baseName(r.title)}`;
    const alt = r.hash ? key : `t:${r.addon}:${baseName(r.title)}`;
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
function SourceFolder({ g, provider, providers, book, account, onChanged }) {
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
        g.items.map((r) => <SourceRow key={r.key} r={r} provider={provider} providers={providers} book={book} inAccount={account.get(r.hash)} onChanged={onChanged} />)}
    </div>
  );
}
