// Tidy up: everything in your library worth a look, each with its own fix — the same book
// twice from one place, missing covers, one author spelled two ways, books left untouched for
// months, and finished books still taking space on the phone.
import { useMemo, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { library, progress, useStore, hideFromContinue } from '../lib/store.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { needsCover, autoCovers, setFix, fixFor, typedCovers } from '../lib/meta.js';
import { sameWork } from '../lib/works.js';
import { fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';

const src = (b) => String(b.source || b.uid || '').split(':')[0];
const authorKey = (a) => String(a || '').toLowerCase().replace(/[^a-z]/g, '');
const mb = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const SIX_MONTHS = 182 * 24 * 3600e3;

export function tidyFindings(lib, prog, dls) {
  const books = Object.values(lib).filter((b) => b?.uid && b.source !== 'pod' && b.kind !== 'pod');
  // The same book twice from the same place (two TorBox copies, two phone files).
  const dupes = [];
  const seen = new Set();
  for (const b of books) {
    if (seen.has(b.uid)) continue;
    const g = books.filter((x) => x.uid !== b.uid && !seen.has(x.uid) && src(x) === src(b) && sameWork(x, b));
    if (g.length) {
      const all = [b, ...g].sort((x, y) => (prog[y.uid]?.updatedAt || 0) - (prog[x.uid]?.updatedAt || 0));
      all.forEach((x) => seen.add(x.uid));
      dupes.push(all);
    }
  }
  const covers = books.filter((b) => needsCover(b));
  // One author, two spellings ("J K Rowling", "J.K. Rowling"), or none.
  const byKey = {};
  for (const b of books) {
    const a = String(b.author || '').split(',')[0].trim();
    if (!a) continue;
    (byKey[authorKey(a)] ||= {})[a] = [...((byKey[authorKey(a)] || {})[a] || []), b];
  }
  const authors = Object.values(byKey)
    .filter((forms) => Object.keys(forms).length > 1)
    .map((forms) => {
      const best = Object.entries(forms).sort((x, y) => y[1].length - x[1].length || y[0].length - x[0].length)[0][0];
      return { best, forms: Object.keys(forms), books: Object.values(forms).flat().filter((b) => String(b.author || '').split(',')[0].trim() !== best) };
    });
  const noAuthor = books.filter((b) => !String(b.author || '').trim() || /^unknown/i.test(b.author));
  const stale = Object.entries(prog)
    .filter(([, p]) => p?.book && !p.finished && !p.hidden && (p.global || 0) > 60 && Date.now() - (p.updatedAt || 0) > SIX_MONTHS)
    .map(([uid, p]) => ({ uid, p }));
  const big = Object.entries(dls)
    .filter(([uid, d]) => d?.status === 'done' && prog[uid]?.finished)
    .map(([uid, d]) => ({ uid, d, bytes: d.bytes || (d.tracks || []).reduce((n, t) => n + (t.size || 0), 0) }));
  return { dupes, covers, authors, noAuthor, stale, big };
}

function Group({ title, sub, action, onAction, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section class="tidy-g">
      <div class="tidy-head" onClick={() => setOpen(!open)}>
        <div>
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {action && (
          <button class="pill small on" onClick={(e) => (e.stopPropagation(), onAction())}>
            {action}
          </button>
        )}
      </div>
      {open && <div class="tidy-list">{children}</div>}
    </section>
  );
}

const Row = ({ b, note, children }) => (
  <div class="tidy-row">
    <Cover book={b} />
    <span>
      <b>{b.title}</b>
      <small>{note}</small>
    </span>
    {children}
  </div>
);

export function Tidy() {
  const lib = useStore(library);
  const prog = useStore(progress);
  const dls = useStore(downloads);
  useStore(typedCovers);
  const [busy, setBusy] = useState('');
  const f = useMemo(() => tidyFindings(lib, prog, dls), [lib, prog, dls, busy]);
  const dropCopy = (uid) => library.set((all) => ((all = { ...all }), delete all[uid], all));
  const fixAuthors = (a) => a.books.forEach((b) => setFix(b.uid, { ...(fixFor(b.uid) || {}), author: a.best }));
  const total = f.dupes.length + f.covers.length + f.authors.length + f.stale.length + f.big.length;
  return (
    <div class="screen tidy">
      <TopBar title="Tidy up" ask={false} />
      <p class="muted tidy-intro">{total ? 'Everything worth a look, with one fix each. Tap a group to see the books.' : 'All tidy — nothing needs a look.'}</p>

      {f.dupes.length > 0 && (
        <Group title="The same book twice" sub={`${f.dupes.length} book${f.dupes.length > 1 ? 's' : ''} in your library twice from one place`}>
          {f.dupes.map((g) =>
            g.map((b, i) => (
              <Row b={b} note={i === 0 ? 'The one you used last — kept' : `${prog[b.uid]?.global ? `${fmtDuration(prog[b.uid].global)} in` : 'Not played'}`}>
                {i > 0 && (
                  <button class="pill small" onClick={() => (dropCopy(b.uid), toast('Removed from the library — its place is kept'))}>
                    Remove
                  </button>
                )}
              </Row>
            ))
          )}
        </Group>
      )}

      {f.covers.length > 0 && (
        <Group
          title="Missing covers"
          sub={busy === 'covers' ? 'Finding covers…' : `${f.covers.length} book${f.covers.length > 1 ? 's' : ''} without a cover`}
          action={busy === 'covers' ? '…' : 'Find'}
          onAction={async () => {
            if (busy) return;
            setBusy('covers');
            const r = await autoCovers(f.covers, () => {}).catch(() => ({ found: 0 }));
            setBusy('');
            toast(`Found ${r.found} of ${f.covers.length} covers`);
          }}
        >
          {f.covers.map((b) => (
            <Row b={b} note={b.author || ''} />
          ))}
        </Group>
      )}

      {f.authors.length > 0 && (
        <Group title="One author, two spellings" sub={f.authors.map((a) => a.forms.join(' / ')).slice(0, 2).join(' · ')} action="Fix" onAction={() => (f.authors.forEach(fixAuthors), toast('Authors made the same'))}>
          {f.authors.map((a) => (
            <div class="tidy-row text">
              <span>
                <b>{a.best}</b>
                <small>also as {a.forms.filter((x) => x !== a.best).join(', ')} · {a.books.length} book{a.books.length > 1 ? 's' : ''}</small>
              </span>
              <button class="pill small" onClick={() => fixAuthors(a)}>
                Use “{a.best}”
              </button>
            </div>
          ))}
        </Group>
      )}

      {f.noAuthor.length > 0 && (
        <Group title="No author" sub={`${f.noAuthor.length} book${f.noAuthor.length > 1 ? 's' : ''} — tap one to fix its details`}>
          {f.noAuthor.map((b) => (
            <button class="tidy-row" onClick={() => nav.push('book', { book: b })}>
              <Cover book={b} />
              <span>
                <b>{b.title}</b>
                <small>Open → ⋯ → Fix details</small>
              </span>
            </button>
          ))}
        </Group>
      )}

      {f.stale.length > 0 && (
        <Group title="Not touched in 6 months" sub={`${f.stale.length} book${f.stale.length > 1 ? 's' : ''} you started`}>
          {f.stale.map(({ uid, p }) => (
            <Row b={p.book} note={`${Math.round(((p.global || 0) / Math.max(1, p.total || 1)) * 100)}% · last ${new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`}>
              <button class="pill small" onClick={() => progress.set((all) => ({ ...all, [uid]: { ...all[uid], finished: true, updatedAt: Date.now() } }))}>
                Finished
              </button>
              <button class="pill small" onClick={() => (hideFromContinue([uid]), toast('Off Continue — your place is kept'))}>
                Hide
              </button>
            </Row>
          ))}
        </Group>
      )}

      {f.big.length > 0 && (
        <Group
          title="Finished, still downloaded"
          sub={`${f.big.length} book${f.big.length > 1 ? 's' : ''} use ${mb(f.big.reduce((n, x) => n + x.bytes, 0))}`}
          action="Free"
          onAction={async () => {
            for (const x of f.big) await removeDownload(x.uid).catch(() => {});
            toast('Downloads of finished books removed');
          }}
        >
          {f.big.map((x) => (
            <Row b={x.d.book || { title: x.uid }} note={mb(x.bytes)}>
              <button class="pill small" onClick={() => removeDownload(x.uid)}>
                Remove
              </button>
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}
