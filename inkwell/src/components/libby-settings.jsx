// Settings → Libby (Audiohub+): your library cards (yours and your family's) and extra
// library catalogues. Signed in, the book pages can borrow, hold, renew and return.
import { useEffect, useState } from 'preact/hooks';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import * as libbySrc from '../sources/libby.js';

/** Type a library's name (or its short name / Libby link) and pick it from the matches. */
function LibraryFinder({ value, onPick }) {
  const [q, setQ] = useState(value || '');
  const [hits, setHits] = useState(null);
  const picked = value && libbySrc.parseLibrary(value) === value && q === value;
  useEffect(() => {
    setHits(null);
    if (q.trim().length < 2 || picked) return;
    let alive = true;
    const t = setTimeout(() => libbySrc.findLibraries(q).then((r) => alive && setHits(r)).catch(() => alive && setHits([])), 450);
    return () => ((alive = false), clearTimeout(t));
  }, [q]);
  return (
    <div class="lib-finder">
      <input
        value={q}
        placeholder="Library name, e.g. Los Angeles Public Library"
        onInput={(e) => {
          setQ(e.currentTarget.value);
          onPick(libbySrc.parseLibrary(e.currentTarget.value) || '');
        }}
      />
      {!picked && q.trim().length >= 2 && (
        <div class="lib-hits">
          {hits === null ? (
            <p class="muted small">Looking for “{q.trim()}”…</p>
          ) : hits.length ? (
            hits.map((h) => (
              <button type="button" class={'lib-hit' + (h.key === value ? ' on' : '')} onClick={() => (onPick(h.key), setQ(h.key), setHits(null))}>
                <b>{h.name}</b>
                <small>{h.key}</small>
              </button>
            ))
          ) : (
            <p class="muted small">No library found by that name — try its short name from Libby (in the library's link: libbyapp.com/library/<b>shortname</b>).</p>
          )}
        </div>
      )}
      {picked && <p class="muted small">Library: {value}</p>}
    </div>
  );
}

/** Sign in (or add another card) with a library card number and PIN. */
function LibbyCardSignIn({ busy, run, adding = false }) {
  useStore(libbySrc.libby);
  const libs = libbySrc.libraries({ all: true });
  const [lib, setLib] = useState(libs[0]?.key || '');
  const [other, setOther] = useState('');
  const [card, setCard] = useState('');
  const [pin, setPin] = useState('');
  const target = lib === '__other' || !libs.length ? other : lib;
  // The library's sign-in types (card, student ID, a partner library…): pick yours.
  const [forms, setForms] = useState([]);
  const [ils, setIls] = useState('');
  useEffect(() => {
    setForms([]);
    setIls('');
    if (!target.trim()) return;
    let alive = true;
    const t = setTimeout(() => {
      libbySrc
        .cardForms(target)
        .then((f) => alive && (setForms(f), setIls(f[0]?.ils || '')))
        .catch(() => {});
    }, 500);
    return () => ((alive = false), clearTimeout(t));
  }, [target]);
  const chosen = forms.find((f) => f.ils === ils);
  return (
    <div class="libby-cardform">
      <p class="muted">
        <b>{adding ? 'Add another library card' : 'Sign in with your library card'}</b> — card number and PIN (add each card: yours, then your family's).
      </p>
      {libs.length > 0 && (
        <select value={lib} onChange={(e) => setLib(e.currentTarget.value)}>
          {libs.map((l) => (
            <option value={l.key}>{l.name}</option>
          ))}
          <option value="__other">Another library…</option>
        </select>
      )}
      {(lib === '__other' || !libs.length) && <LibraryFinder value={other} onPick={setOther} />}
      {forms.length > 1 && (
        <select value={ils} onChange={(e) => setIls(e.currentTarget.value)} aria-label="Sign-in type">
          {forms.map((f) => (
            <option value={f.ils}>{f.label}</option>
          ))}
        </select>
      )}
      {chosen?.external && <p class="muted small">This one signs in on the library's own website — use the code option below instead.</p>}
      <input value={card} inputmode="text" autocomplete="username" placeholder="Library card number" onInput={(e) => setCard(e.currentTarget.value)} />
      <input value={pin} type="password" autocomplete="current-password" placeholder="PIN / password (if your library uses one)" onInput={(e) => setPin(e.currentTarget.value)} />
      <button
        class="btn primary"
        disabled={busy || !target.trim() || !card.trim()}
        onClick={() =>
          run(async () => {
            const names = await libbySrc.signInWithCard(target, card, pin, ils);
            setCard('');
            setPin('');
            return `Signed in: ${names}`;
          })
        }
      >
        {busy ? <span class="spinner small" /> : adding ? 'Add card' : 'Sign in'}
      </button>
    </div>
  );
}

/** Troubleshooting: run each Libby step and show what Libby answered. */
function LibbyCheck() {
  const [lines, setLines] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setLines(null);
    try {
      setLines(await libbySrc.diagnose());
    } catch (e) {
      setLines([`Check failed: ${e.message}`]);
    } finally {
      setBusy(false);
    }
  };
  const text = (lines || []).join('\n');
  return (
    <div class="libby-check">
      <button class="pill small ghost" disabled={busy} onClick={go}>
        {busy ? <span class="spinner small" /> : 'Run Libby check'}
      </button>
      {lines && (
        <>
          <pre>{text}</pre>
          <button class="pill small ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => {})}>
            Copy
          </button>
        </>
      )}
    </div>
  );
}

/** Libby: your public library — catalogue search, plus your account via Libby's setup code. */
export function LibbySettings() {
  const lib = useStore(libbySrc.libby);
  const acct = useStore(libbySrc.libbyAccount);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      toast(await fn());
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div class="set-row">
        <div>
          <b>Also check other big libraries</b>
          <small>Book pages show where a book is ready now at libraries you have no card for (New York, Los Angeles, Queens, Houston, Fairfax…) — several sell cards to people who don't live there.</small>
        </div>
        <input type="checkbox" class="switch" checked={!lib.noOthers} onChange={(e) => libbySrc.libby.set((l) => ({ ...l, noOthers: !e.currentTarget.checked }))} />
      </div>
      {acct.identity ? (
        <div class="set-row">
          <div>
            <b>Signed in to Libby</b>
            <small>
              {(acct.cards || []).map((c) => c.library?.name || c.cardName).join(', ') || 'Your cards'} · {(acct.loans || []).length} loan{(acct.loans || []).length === 1 ? '' : 's'} · {(acct.holds || []).length} hold{(acct.holds || []).length === 1 ? '' : 's'}
              {libbySrc.tokenInfo() ? ` · ${libbySrc.tokenInfo()}` : ''}
            </small>
          </div>
          <div class="chips">
            <button class="pill small" disabled={busy} onClick={() => run(async () => (await libbySrc.syncAccount(), 'Libby synced'))}>
              Sync
            </button>
            <button class="pill small ghost" onClick={() => libbySrc.signOut()}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <>
          <LibbyCardSignIn busy={busy} run={run} />
        </>
      )}
      {acct.identity && <LibbyCardSignIn busy={busy} run={run} adding />}
      <LibbyCheck />
      {libbySrc.libraries({ all: true }).length > 0 && (
        <div class="libby-cards">
          <small class="muted">Your libraries (switch off any you don't want in results):</small>
          {libbySrc.libraries({ all: true }).map((l) => (
            <div class="set-row">
              <div>
                <b>{l.name}</b>
                <small>{l.card ? 'Library card in Libby' : 'Added by link · catalogue only'}</small>
              </div>
              <div class="chips">
                {!l.card && (
                  <button class="pill small ghost" onClick={() => libbySrc.removeLibrary(l.key)}>
                    Remove
                  </button>
                )}
                <input type="checkbox" class="switch" checked={!(lib.skip || []).includes(l.key)} onChange={(e) => libbySrc.toggleLibrary(l.key, e.currentTarget.checked)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p class="muted">Add a library's catalogue by its Libby link (libbyapp.com/library/…) or short name — add as many as you like.</p>
      <div class="set-row">
        <input value={input} placeholder="libbyapp.com/library/…" onInput={(e) => setInput(e.currentTarget.value)} />
        <button class="btn" disabled={busy || !input.trim()} onClick={() => run(async () => { const n = await libbySrc.connect(input); setInput(''); return `Added ${n}`; })}>
          {busy ? <span class="spinner small" /> : 'Add'}
        </button>
      </div>
    </>
  );
}
