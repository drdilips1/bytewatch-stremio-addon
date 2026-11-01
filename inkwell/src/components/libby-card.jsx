// Libby on the book page (Audiohub+): copies at your public libraries — borrow, place a
// hold — and, for a book you've borrowed or put on hold, listen in Libby, renew, return.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import * as lb from '../sources/libby.js';
import { openExternal } from '../sources/summaries.js';

const kindName = (f) => (f === 'audiobook' ? 'Audiobook' : f === 'ebook' ? 'Ebook' : f || 'Title');

function useAct() {
  const [busy, setBusy] = useState('');
  const act = async (id, fn) => {
    setBusy(id);
    try {
      toast(await fn());
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy('');
    }
  };
  return [busy, act];
}

/** Borrow / place hold / listen for one Libby copy. */
function CopyAction({ h }) {
  useStore(lb.libbyAccount);
  const [busy, act] = useAct();
  const loan = lb.signedIn() && lb.loanFor(h.libby.id);
  const listen = () => openExternal(lb.libbyLink({ key: h.libby.key, titleId: h.libby.id, title: h.title }));
  if (busy) return <span class="spinner small" />;
  if (loan)
    return (
      <button class="pill active" onClick={listen}>
        <Icon name={h.libby.format === 'audiobook' ? 'headphones' : 'book'} size={14} /> {h.libby.format === 'audiobook' ? 'Listen' : 'Read'} in Libby
      </button>
    );
  // Not signed in: Libby does the borrowing.
  if (!lb.signedIn())
    return (
      <button class={'pill' + (h.libby.available ? ' active' : '')} onClick={() => openExternal(h.libby.link)}>
        {h.libby.available ? 'Borrow in Libby' : 'Hold in Libby'}
      </button>
    );
  return h.libby.available ? (
    <button class="pill active" onClick={() => act('b', () => lb.borrow(h.libby.id, h.libby.format, h.libby.key))}>
      Borrow
    </button>
  ) : (
    <button class="pill" onClick={() => act('h', () => lb.placeHold(h.libby.id, h.libby.key))}>
      Place hold
    </button>
  );
}

/** Copies of this book at each of your libraries (available now first). */
export function LibbyCard({ book }) {
  const [hits, setHits] = useState(book.libby ? [book] : null);
  useEffect(() => {
    let alive = true;
    setHits(book.libby ? [book] : null);
    lb.availability(book).then((r) => alive && setHits(r.length ? r : book.libby ? [book] : []));
    return () => (alive = false);
  }, [book.uid]);
  const libs = lb.libraries();
  return (
    <section class="pad libby">
      <h3 class="section-label">
        <Icon name="library" size={16} /> {libs.length > 1 ? 'At your libraries' : `At your library · ${libs[0]?.name || ''}`}
      </h3>
      {hits === null ? (
        <p class="muted">
          <span class="spinner small" /> Checking Libby…
        </p>
      ) : hits.length === 0 ? (
        <div class="sum-actions">
          <span class="muted">Not in your libraries' Libby catalogues.</span>
          <button class="pill ghost" onClick={() => openExternal(`https://libbyapp.com/search/${libs[0]?.key || ''}/search/query-${encodeURIComponent(book.title)}/page-1`)}>
            <Icon name="search" size={14} /> Search in Libby
          </button>
        </div>
      ) : (
        <div class="libby-list">
          {hits.slice(0, 8).map((h) => (
            <div class={'libby-item' + (h.libby.available ? ' ok' : '')}>
              <div>
                <b>
                  {kindName(h.libby.format)}
                  {libs.length > 1 && h.libby.library ? <span class="libby-lib"> · {h.libby.library}</span> : null}
                </b>
                <small>{lb.describe(h.libby)}</small>
              </div>
              <CopyAction h={h} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A loan or hold you have: what to do with it. */
export function LibbyLoanActions({ book }) {
  useStore(lb.libbyAccount);
  const [busy, act] = useAct();
  const loan = book.libbyLoan;
  const hold = book.libbyHold;
  if (loan) {
    const d = lb.daysLeft(loan.due);
    const audio = loan.format === 'audiobook';
    return (
      <section class="pad libby-loan">
        <p class="libby-due">
          <Icon name="library" size={15} /> Borrowed{loan.library ? ` from ${loan.library}` : ''}
          {d != null && <b class={d <= 2 ? 'soon' : ''}> · {d < 0 ? 'overdue' : d === 0 ? 'due today' : `${d} day${d === 1 ? '' : 's'} left`}</b>}
        </p>
        <div class="libby-loan-actions">
          <button class="btn primary big" onClick={() => openExternal(lb.libbyLink({ key: loan.key, titleId: loan.titleId, title: book.title }))}>
            <Icon name={audio ? 'headphones' : 'book'} size={18} /> {audio ? 'Listen' : 'Read'} in Libby
          </button>
          <button class="btn secondary" disabled={!!busy} onClick={() => act('r', () => lb.renewLoan(loan.cardId, loan.titleId))}>
            {busy === 'r' ? <span class="spinner small" /> : 'Renew'}
          </button>
          <button
            class="btn secondary"
            disabled={!!busy}
            onClick={() => confirm(`Return “${book.title}” to the library now?`) && act('x', () => lb.returnLoan(loan.cardId, loan.titleId).then((m) => (history.back(), m)))}
          >
            {busy === 'x' ? <span class="spinner small" /> : 'Return'}
          </button>
        </div>
      </section>
    );
  }
  if (hold) {
    const weeks = hold.wait ? Math.max(1, Math.round(hold.wait / 7)) : null;
    return (
      <section class="pad libby-loan">
        <p class="libby-due">
          <Icon name="bookmark" size={15} /> {hold.ready ? <b class="soon">Ready to borrow</b> : 'On hold'}
          {hold.library ? ` at ${hold.library}` : ''}
          {!hold.ready && hold.position ? ` · #${hold.position} in line` : ''}
          {!hold.ready && weeks ? ` · about ${weeks} week${weeks === 1 ? '' : 's'}` : ''}
        </p>
        <div class="libby-loan-actions">
          {hold.ready && (
            <button class="btn primary big" disabled={!!busy} onClick={() => act('b', () => lb.borrow(hold.titleId, hold.format, hold.key))}>
              {busy === 'b' ? <span class="spinner small" /> : 'Borrow now'}
            </button>
          )}
          <button class="btn secondary" disabled={!!busy} onClick={() => confirm('Cancel this hold?') && act('c', () => lb.cancelHold(hold.cardId, hold.titleId))}>
            {busy === 'c' ? <span class="spinner small" /> : 'Cancel hold'}
          </button>
        </div>
      </section>
    );
  }
  return null;
}
