// The ebook open while its audiobook plays: light up the paragraph being heard and keep it
// on screen (like Kindle's Whispersync). Found by the words the phone recognises, so it
// works with any edition of the ebook; reading on your own pauses the scrolling a while.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import * as player from '../lib/player.js';
import { sameWork } from '../lib/works.js';
import { blockText } from '../lib/tts.js';
import { toast } from './common.jsx';

export function FollowAudio({ book, blocks, scroller, ready }) {
  const [ps, setPs] = useState(player.getState());
  useEffect(() => player.subscribe(setPs), []);
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState('');
  const [need, setNeed] = useState(false); // no speech model on this phone yet
  const index = useRef(null);
  const near = useRef(null);
  const lit = useRef(null);
  const touched = useRef(0);
  const playing = ps.book && ps.book.kind !== 'text' && ps.book.uid !== book.uid && sameWork(ps.book, book);

  // You scrolling yourself: leave the page alone for a few seconds.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => (touched.current = Date.now());
    el.addEventListener('touchstart', mark, { passive: true });
    el.addEventListener('wheel', mark, { passive: true });
    return () => (el.removeEventListener('touchstart', mark), el.removeEventListener('wheel', mark));
  }, [ready]);

  useEffect(() => {
    if (!on || !playing || !ready) return;
    let alive = true;
    let tr = null;
    let bt = null;
    let quiet = 0;
    let unsub = null;
    (async () => {
      [tr, bt] = await Promise.all([import('../lib/transcript.js'), import('../lib/booktext.js')]);
      if (!alive) return;
      if (!tr.transcriptAvailable) return setStatus('Needs speech recognition (Android app, Settings → Text)');
      tr.followInReader(true);
      setStatus('Listening for where you are…');
      // Say what the recogniser is doing — above all when there's no speech model on this
      // phone yet (each app downloads its own): without one it would wait for ever.
      unsub = tr.subscribeTranscript((t) => {
        if (!alive) return;
        setNeed(t.status === 'no-model');
        if (t.status === 'no-model') setStatus('');
        else if (t.status === 'loading') setStatus('Getting speech recognition ready…');
        else if (t.status === 'error') setStatus(t.error || 'Speech recognition stopped');
      });
    })();
    const tick = setInterval(() => {
      if (!tr || !bt || !alive) return;
      const list = blocks();
      if (!list.length) return;
      if (!index.current || index.current.n !== list.length) index.current = { n: list.length, w: bt.wordIndex(list.map((el) => blockText(el))) };
      const heard = tr.heardNow();
      if (!heard) {
        if (++quiet > 12 && player.getState().playing) setStatus('Waiting for speech… (the phone is still recognising it)');
        return;
      }
      const w = index.current.w;
      const r = bt.locate(w, heard, near.current);
      if (!r) return;
      quiet = 0;
      near.current = r.to;
      const el = list[bt.paraOf(w, r.to - 1)];
      if (!el) return;
      setStatus('');
      if (lit.current !== el) {
        lit.current?.classList.remove('listen-now');
        lit.current?.parentElement?.classList.remove('following-audio');
        el.classList.add('listen-now');
        el.parentElement?.classList.add('following-audio'); // the rest of the page dims a little
        lit.current = el;
      }
      // Keep it in view (unless you've been scrolling yourself just now).
      const box = scroller.current?.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (box && Date.now() - touched.current > 6000 && (b.top < box.top + 60 || b.bottom > box.bottom - 120)) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 1200);
    return () => {
      alive = false;
      unsub?.();
      clearInterval(tick);
      tr?.followInReader(false);
      lit.current?.parentElement?.classList.remove('following-audio');
      lit.current?.classList.remove('listen-now');
      lit.current = null;
    };
  }, [on, playing, ready]);

  if (!playing) return null;
  return (
    <div class={'follow-audio' + (on ? ' on' : '')}>
      <button class="pill small" onClick={() => setOn(!on)}>
        <Icon name="headphones" size={14} /> {on ? 'Following the audio' : 'Follow the audio'}
      </button>
      {on && status && <small>{status}</small>}
      {on && need && <SpeechModel compact />}
    </div>
  );
}

/**
 * The speech model read-along listens with: downloaded once per app (≈100 MB, Wi-Fi
 * recommended), works offline after. `compact`: one line with a button (in the reader).
 */
export function SpeechModel({ compact = false }) {
  const [tr, setTr] = useState(null);
  const [have, setHave] = useState(null);
  const [busy, setBusy] = useState(null); // { id, pct, phase }
  useEffect(() => {
    import('../lib/transcript.js').then(async (m) => {
      setTr(m);
      setHave(m.transcriptAvailable ? (await m.installedModels()).map((x) => x.id) : []);
    });
  }, []);
  if (!tr) return null;
  if (!tr.transcriptAvailable) return compact ? null : <p class="h-note">Read-along listens with the phone's speech recognition — in the Android app.</p>;
  const get = async (m) => {
    setBusy({ id: m.id, pct: 0 });
    try {
      await tr.downloadModel(m, (e) => setBusy({ id: m.id, pct: e.total ? Math.round((e.received / e.total) * 100) : 0, phase: e.phase }));
      setHave((h) => [...(h || []), m.id]);
      tr.restartTranscript();
      tr.followInReader(true);
      toast(`${m.name} speech model ready`);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };
  const list = compact ? tr.MODELS.slice(0, 1) : tr.MODELS;
  return (
    <div class={'speech-model' + (compact ? ' compact' : '')}>
      {compact && <small>Read-along needs the speech model once (English, {list[0].size}).</small>}
      {list.map((m) => (
        <div class="sm-row">
          {!compact && (
            <span>
              <b>{m.name}</b>
              <small>
                {m.what} · {m.size}
              </small>
            </span>
          )}
          {have?.includes(m.id) ? (
            <span class="pill small active">Ready</span>
          ) : busy?.id === m.id ? (
            <span class="pill small">{busy.phase === 'unpack' ? 'Unpacking…' : `Downloading ${busy.pct}%`}</span>
          ) : (
            <button class="pill small" disabled={!!busy} onClick={() => get(m)}>
              <Icon name="download" size={14} /> {compact ? 'Download now' : 'Get'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
