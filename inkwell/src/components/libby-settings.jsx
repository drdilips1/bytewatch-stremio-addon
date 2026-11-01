// Settings → Libby (Audiohub+): your library cards (yours and your family's) and extra
// library catalogues. Signed in, the book pages can borrow, hold, renew and return.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import * as libbySrc from '../sources/libby.js';

/** Sign in to Libby: this app shows a code, you enter it in Libby on your phone. */
function LibbySignIn({ busy, run, code, setCode }) {
  const [shown, setShown] = useState(null); // { code, expires }
  const [pairing, setPairing] = useState(null); // { cancel }
  const [left, setLeft] = useState(0);
  const [manual, setManual] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => () => pairing?.cancel(), [pairing]);
  useEffect(() => {
    if (!shown) return;
    const tick = () => setLeft(Math.max(0, Math.round((shown.expires - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [shown]);
  const stop = () => {
    pairing?.cancel();
    setPairing(null);
    setShown(null);
  };
  const start = () => {
    pairing?.cancel();
    setShown(null);
    setStatus('');
    const p = libbySrc.pairWithCode(setShown, setStatus);
    setPairing(p);
    p.done
      .then((names) => names && toast(`Signed in: ${names}`))
      .catch((e) => toast(e.message))
      .finally(() => {
        setPairing(null);
        setShown(null);
      });
  };
  return (
    <>
      <p class="muted">
        <b>Sign in with your library cards</b> (loans, holds and borrowing here): tap <b>Get code</b>, then on your phone open <b>Libby → Menu (☰) → Copy To Another Device</b> and enter the code shown here. Keep this screen open — Audiohub+ finishes by itself.
      </p>
      {pairing ? (
        <div class="libby-code">
          {shown ? <b>{shown.code}</b> : <span class="spinner" />}
          <small>
            {shown ? `Enter this in Libby · ${left > 0 ? `${left}s left` : 'getting a new code…'} · ` : 'Getting a code… '}
            waiting for Libby <span class="spinner small" />
          </small>
          {status && <small class="libby-status">{status}</small>}
          <button class="link-btn" onClick={stop}>
            Cancel
          </button>
        </div>
      ) : (
        <button class="btn primary" onClick={start}>
          Get code
        </button>
      )}
      <button class="link-btn" onClick={() => setManual(!manual)}>
        {manual ? 'Hide' : 'My Libby shows a code instead'}
      </button>
      {manual && (
        <div class="set-row">
          <input value={code} inputmode="numeric" maxlength="9" placeholder="8-digit code from Libby" onInput={(e) => setCode(e.currentTarget.value)} />
          <button class="btn" disabled={busy || code.replace(/\D/g, '').length !== 8} onClick={() => run(async () => `Signed in: ${await libbySrc.signInWithCode(code)}`)}>
            {busy ? <span class="spinner small" /> : 'Sign in'}
          </button>
        </div>
      )}
    </>
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
  return (
    <div class="libby-cardform">
      <p class="muted">
        <b>{adding ? 'Add another library card' : 'Or sign in with your library card'}</b> — card number and PIN, no phone needed.
      </p>
      {libs.length > 0 && (
        <select value={lib} onChange={(e) => setLib(e.currentTarget.value)}>
          {libs.map((l) => (
            <option value={l.key}>{l.name}</option>
          ))}
          <option value="__other">Another library…</option>
        </select>
      )}
      {(lib === '__other' || !libs.length) && <input value={other} placeholder="Library link (libbyapp.com/library/…) or short name" onInput={(e) => setOther(e.currentTarget.value)} />}
      <input value={card} inputmode="text" autocomplete="username" placeholder="Library card number" onInput={(e) => setCard(e.currentTarget.value)} />
      <input value={pin} type="password" autocomplete="current-password" placeholder="PIN / password (if your library uses one)" onInput={(e) => setPin(e.currentTarget.value)} />
      <button
        class="btn primary"
        disabled={busy || !target.trim() || !card.trim()}
        onClick={() =>
          run(async () => {
            const names = await libbySrc.signInWithCard(target, card, pin);
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
  const [code, setCode] = useState('');
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
          <LibbySignIn busy={busy} run={run} code={code} setCode={setCode} />
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
