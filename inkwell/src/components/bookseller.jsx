import { useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Cover } from './common.jsx';
import { nav } from '../lib/nav.js';
import { fmtDuration } from '../lib/format.js';
import { askBookseller, aiReady } from '../lib/bookseller.js';

const EXAMPLES = ['Atmospheric sci-fi under 12 hours that feels like Project Hail Mary', 'A cosy mystery with a great narrator', 'Big-idea non-fiction like Sapiens, but shorter', 'Something funny for a long drive'];

/** Ask for books in plain words, like talking to a bookseller. */
export function AskBookseller() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const ask = async (text) => {
    const t = (text ?? q).trim();
    if (!t) return;
    setQ(t);
    setBusy(true);
    setErr('');
    setRes(null);
    try {
      setRes(await askBookseller(t));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="bookseller">
      <div class="bookseller-head">
        <Icon name="sparkle" size={18} />
        <b>Ask the bookseller</b>
      </div>
      {!aiReady() && (
        <p class="muted small">
          Works now with the Audible catalogue. For smarter, more personal picks add a free AI key in{' '}
          <button class="link-btn" onClick={() => nav.tab('settings')}>
            Settings → AI
          </button>
          .
        </p>
      )}
      <>
        <form
          class="bookseller-form"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <textarea rows={2} value={q} placeholder="e.g. atmospheric sci-fi under 12 hours that feels like Project Hail Mary" onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())} />
          <button class="btn primary" disabled={busy || !q.trim()} aria-label="Ask">
            {busy ? <span class="spinner" /> : <Icon name="sparkle" size={16} />}
          </button>
        </form>
        {!res && !busy && (
          <div class="chips bookseller-examples">
            {EXAMPLES.map((x) => (
              <button class="pill small" onClick={() => ask(x)}>
                {x}
              </button>
            ))}
          </div>
        )}
        {busy && <p class="muted">Thinking about what you'd love…</p>}
        {err && <p class="err">{err}</p>}
        {res && (
          <div class="bookseller-results">
            {res.intro && <p class="bookseller-intro">{res.intro}</p>}
            {res.books.length ? (
              res.books.map((b) => (
                <button class="bookseller-item" onClick={() => nav.push('book', { book: b })}>
                  <Cover book={b} />
                  <div>
                    <b>{b.title}</b>
                    <small>
                      {b.author}
                      {b.duration ? ` · ${fmtDuration(b.duration)}` : b.aiHours ? ` · ~${Math.round(b.aiHours)} h` : ''}
                      {b.rating ? ` · ★ ${Number(b.rating).toFixed(1)}` : ''}
                    </small>
                    {b.why && <p>{b.why}</p>}
                  </div>
                </button>
              ))
            ) : (
              <p class="muted">Couldn't find those in the catalogue — try asking differently.</p>
            )}
          </div>
        )}
      </>
    </section>
  );
}
