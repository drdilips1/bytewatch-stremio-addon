// Usenet on a book page: Easynews books (play straight away) and your indexers' NZBs (sent to
// TorBox's Usenet downloader, then they play like any TorBox book). In a box like the sources.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { usenetOn, searchUsenet, easynewsBook, easynewsReaderBook } from '../sources/usenet.js';
import { fmtBytes } from '../lib/downloads.js';
import { cleanName as cleanTitle } from '../sources/usenet.js';

export function UsenetResults({ title, author, book }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!usenetOn() || !title) return;
    let alive = true;
    setRes(null);
    searchUsenet(title, author, { ebooks: book?.kind === 'text' })
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ easynews: [], indexers: [] }));
    return () => (alive = false);
  }, [title, author]);
  if (!usenetOn()) return null;

  const playEasynews = async (g) => {
    setBusy(g.key);
    try {
      const { getDetails } = await import('../sources/index.js');
      const d = await getDetails(easynewsBook(g, { title: book?.title || g.title, author: book?.author || author, cover: book?.cover || '' }));
      nav.openOverlay('player');
      player.playBook(d, { exact: true });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  const readEasynews = async (g) => {
    setBusy(g.key);
    try {
      toast('Getting the ebook from Easynews…');
      nav.push('reader', { book: await easynewsReaderBook(g, { title: book?.title || g.title, author: book?.author || author, cover: book?.cover || '' }) });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  // Where an NZB can go: TorBox and Premiumize both download Usenet (each shown when connected;
  // with neither, TorBox — its message says to connect it).
  const [nzbTo, setNzbTo] = useState(['torbox']);
  useEffect(() => {
    Promise.all([import('../sources/debrid.js'), import('../sources/moredebrid.js')]).then(([c, m]) => {
      const to = [c.tbConnected() && 'torbox', m.moreConnected('premiumize') && 'premiumize'].filter(Boolean);
      setNzbTo(to.length ? to : ['torbox']);
    });
  }, []);
  const NAME = { torbox: 'TorBox', premiumize: 'Premiumize' };
  const sendNzb = async (r, to = 'torbox') => {
    setBusy(r.nzb + to);
    try {
      const out =
        to === 'premiumize'
          ? await (await import('../sources/moredebrid.js')).sendNzbToPremiumize(r.nzb, r.title, (t) => toast(t))
          : await (await import('../sources/debrid.js')).sendNzbToTorbox(r.nzb, r.title, (t) => toast(t));
      if (out.book) {
        const { getDetails } = await import('../sources/index.js');
        nav.openOverlay('player');
        player.playBook(await getDetails({ ...out.book, title: book?.title || out.book.title, author: book?.author || out.book.author, cover: book?.cover || '' }), { exact: true });
      } else toast(`Sent to ${NAME[to]} — it shows in Your ${NAME[to]} when the download is done (usually a few minutes)`);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };

  const rows = res ? [...res.easynews.map((g) => ({ kind: 'en', g })), ...res.indexers.map((r) => ({ kind: 'nzb', r }))] : [];
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <section class="src-sec usenet-results">
      <div class="src-sec-head">
        <span>Usenet</span>
        <small>{res ? rows.length : ''}</small>
      </div>
      {!res ? (
        <p class="muted pad-s">
          <span class="spinner small" /> Searching Usenet…
        </p>
      ) : !rows.length ? (
        <p class="muted pad-s">Nothing on Usenet for this book.</p>
      ) : (
        <div class="src-group">
          <div class="src-list">
            {shown.map((x) =>
              x.kind === 'en' ? (
                <div class="src-row usenet-row">
                  <span class="fmt-chip">{x.g.format || (x.g.kind === 'ebook' ? 'Ebook' : 'Audio')}</span>
                  <div class="usenet-text">
                    <b>{x.g.title}</b>
                    <small>
                      Easynews · {x.g.files.length} {x.g.files.length === 1 ? 'file' : 'files'}
                      {x.g.files.reduce((a, f) => a + f.size, 0) > 0 ? ` · ${fmtBytes(x.g.files.reduce((a, f) => a + f.size, 0))}` : ''}
                    </small>
                  </div>
                  {x.g.kind === 'ebook' ? (
                    <button class="pill small" disabled={!!busy} onClick={() => readEasynews(x.g)}>
                      {busy === x.g.key ? <span class="spinner small" /> : <Icon name="book" size={14} />} Read
                    </button>
                  ) : (
                    <button class="pill small active" disabled={!!busy} onClick={() => playEasynews(x.g)}>
                      {busy === x.g.key ? <span class="spinner small" /> : <Icon name="play" size={14} />} Play
                    </button>
                  )}
                </div>
              ) : (
                <div class="src-row usenet-row">
                  <span class="fmt-chip">NZB</span>
                  <div class="usenet-text">
                    <b>{cleanTitle(x.r.title)}</b>
                    <small>
                      {x.r.indexer}
                      {x.r.size ? ` · ${fmtBytes(x.r.size)}` : ''}
                      {x.r.date ? ` · ${new Date(x.r.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}
                    </small>
                  </div>
                  <div class="usenet-to">
                    {nzbTo.map((to) => (
                      <button class="pill small" disabled={!!busy} onClick={() => sendNzb(x.r, to)}>
                        {busy === x.r.nzb + to ? <span class="spinner small" /> : <Icon name="download" size={14} />} {NAME[to]}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
          {rows.length > shown.length && (
            <button class="link-btn" onClick={() => setAll(true)}>
              Show all {rows.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
