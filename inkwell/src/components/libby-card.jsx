// Libby on the book page (Audiohub+): copies at your public libraries — borrow, place a
// hold — and, for a book you've borrowed or put on hold, listen in Libby, renew, return.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import * as lb from '../sources/libby.js';
import { openExternal } from '../sources/summaries.js';

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

/** Copies of this book at your libraries, audiobook and ebook apart: what you can borrow now
 *  shows; waitlists and libraries you have no card for stay folded until tapped. */
export function LibbyCard({ book }) {
  const [hits, setHits] = useState(book.libby ? [book] : null);
  const [others, setOthers] = useState(null); // at libraries you have no card for
  useEffect(() => {
    let alive = true;
    setHits(book.libby ? [book] : null);
    setOthers(null);
    lb.availability(book).then((r) => alive && setHits(r.length ? r : book.libby ? [book] : []));
    lb.elsewhere(book).then((r) => alive && setOthers(r), () => alive && setOthers([]));
    return () => (alive = false);
  }, [book.uid]);
  const libs = lb.libraries();
  const isAudio = (h) => h.libby.format === 'audiobook';
  return (
    <section class="pad libby">
      <h3 class="section-label">
        <Icon name="library" size={16} /> {libs.length > 1 ? 'At your libraries' : `At your library · ${libs[0]?.name || ''}`}
      </h3>
      {hits === null ? (
        <p class="muted">
          <span class="spinner small" /> Checking Libby…
        </p>
      ) : hits.length === 0 && !others?.length ? (
        <div class="sum-actions">
          <span class="muted">Not in your libraries' Libby catalogues.</span>
          <button class="pill ghost" onClick={() => openExternal(`https://libbyapp.com/search/${libs[0]?.key || ''}/search/query-${encodeURIComponent(book.title)}/page-1`)}>
            <Icon name="search" size={14} /> Search in Libby
          </button>
        </div>
      ) : (
        <>
          <LibbyGroup name="Audiobook" icon="headphones" mine={hits.filter(isAudio)} others={(others || []).filter(isAudio)} many={libs.length > 1} />
          <LibbyGroup name="Ebook" icon="book" mine={hits.filter((h) => !isAudio(h))} others={(others || []).filter((h) => !isAudio(h))} many={libs.length > 1} />
        </>
      )}
    </section>
  );
}

const weeksOf = (h) => (h.libby.waitDays ? Math.max(1, Math.round(h.libby.waitDays / 7)) : null);

/** One format: borrowable copies shown, the rest folded behind a one-line summary. */
function LibbyGroup({ name, icon, mine, others, many }) {
  const [open, setOpen] = useState(false);
  if (!mine.length && !others.length) return null;
  const now = mine.filter((h) => h.libby.available);
  const wait = mine.filter((h) => !h.libby.available).sort((a, b) => (a.libby.waitDays ?? 999) - (b.libby.waitDays ?? 999));
  const readyElse = others.filter((h) => h.libby.available).length;
  const soonest = wait.length ? weeksOf(wait[0]) : null;
  const folded = [
    wait.length && `waitlist at ${wait.length}${soonest ? ` · shortest about ${soonest} week${soonest === 1 ? '' : 's'}` : ''}`,
    others.length && (readyElse ? `ready now at ${readyElse} other${readyElse === 1 ? '' : 's'} (no card)` : `${others.length} other${others.length === 1 ? '' : 's'} (no card)`),
  ].filter(Boolean);
  return (
    <div class="libby-group">
      <h4>
        <Icon name={icon} size={14} /> {name}
      </h4>
      {now.length > 0 && <div class="libby-list">{now.map((h) => <LibbyRow h={h} many={many} />)}</div>}
      {folded.length > 0 && (
        <button class="libby-fold" onClick={() => setOpen(!open)}>
          <span>{(now.length ? 'Also: ' : '') + folded.join(' · ')}</span>
          <Icon name={open ? 'up' : 'down'} size={14} />
        </button>
      )}
      {open && (
        <div class="libby-list">
          {wait.map((h) => <LibbyRow h={h} many={many} />)}
          {others.map((h) => (
            <div class={'libby-item' + (h.libby.available ? ' ok' : '')}>
              <div>
                <b>
                  {h.libby.library} <span class="libby-lib">· no card yet</span>
                </b>
                <small>{lb.describe(h.libby)}</small>
              </div>
              <button class="pill ghost" onClick={() => openExternal(`https://libbyapp.com/library/${h.libby.key}`)}>
                Get a card
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LibbyRow({ h, many }) {
  return (
    <div class={'libby-item' + (h.libby.available ? ' ok' : '')}>
      <div>
        <b>{many && h.libby.library ? h.libby.library : h.libby.available ? 'Available now' : 'Waitlist'}</b>
        <small>{lb.describe(h.libby)}</small>
      </div>
      <CopyAction h={h} />
    </div>
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
          <button class="btn big primary" onClick={() => openExternal(lb.libbyLink({ key: loan.key, titleId: loan.titleId, title: book.title }))}>
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
