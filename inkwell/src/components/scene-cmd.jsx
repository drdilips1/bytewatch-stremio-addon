// Voice command (Home, the player): say or type a scene, a book, or a command for what's
// playing ("back 30 seconds"). A scene: it finds your copy and
// starts 30 seconds before it.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav, useBackClose } from '../lib/nav.js';
import { aiReady } from '../lib/ai.js';
import { canListen, listen } from '../lib/voiceask.js';

/** chip: the player's small button ("Scene"), else Home's round one. */
export function SceneButton({ chip = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {chip ? (
        <button class="chip-btn" onClick={() => setOpen(true)} aria-label="Voice command">
          <Icon name="mic" size={16} /> Voice
        </button>
      ) : (
        <button class="icon-btn glass" onClick={() => setOpen(true)} aria-label="Voice command">
          <Icon name="mic" />
        </button>
      )}
      {open && createPortal(<SceneSheet close={() => setOpen(false)} />, document.body)}
    </>
  );
}

// Opened from outside (the widget, the app-icon shortcut): one sheet for the whole app.
const hostSubs = new Set();
/** Open "Play a scene"; `listenNow` starts listening at once. */
let pending = null; // asked for before the app had drawn (opened from the widget)
export function openScene(listenNow = false) {
  if (!hostSubs.size) pending = { listenNow };
  hostSubs.forEach((f) => f({ listenNow }));
}
export function SceneHost() {
  const [req, setReq] = useState(() => pending);
  useEffect(() => {
    pending = null;
    hostSubs.add(setReq);
    return () => hostSubs.delete(setReq);
  }, []);
  return req ? createPortal(<SceneSheet close={() => setReq(null)} listenNow={req.listenNow} />, document.body) : null;
}

function SceneSheet({ close, listenNow = false }) {
  useBackClose(true, close);
  const [text, setText] = useState('');
  const [hearing, setHearing] = useState(false);
  // Once it has your words the box goes away; progress and the result show as short messages.
  const run = async (said) => {
    if (!said.trim()) return;
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    close();
    try {
      const { runCommand } = await import('../lib/voicecmd.js');
      const r = await runCommand(said, (t) => (t.startsWith('Opening') || t.startsWith('Working')) && toast(t === 'Working it out…' ? `🎧 “${said.trim().slice(0, 60)}”…` : t));
      if (r.message) return toast(r.message);
      nav.openOverlay('player');
      toast(`▶ ${r.scene || r.book.title}${r.where ? ` · ${r.where}` : ''}`);
    } catch (e) {
      toast(e.message);
      if (e.want) import('../screens/Discover.jsx').then((m) => m.openSearch(`${e.want.title} ${e.want.author || ''}`.trim()));
    }
  };
  // What was heard goes in the box first: it plays by itself in a moment, unless you
  // tap the box to fix a misheard word (then ▶ when ready).
  const [soon, setSoon] = useState(null);
  const cancelSoon = () => soon && (clearTimeout(soon), setSoon(null));
  useEffect(() => () => soon && clearTimeout(soon), [soon]);
  const hear = async () => {
    cancelSoon();
    setHearing(true);
    try {
      const said = await listen('Say a scene, a book or a command');
      setHearing(false);
      if (!said) return;
      setText(said);
      setSoon(setTimeout(() => run(said), 2500));
    } catch (e) {
      setHearing(false);
      toast(e.message);
    }
  };
  useEffect(() => {
    if (listenNow && canListen() && aiReady()) hear();
  }, []);
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet scene-cmd" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>Voice command</h3>
        <p class="muted small">
          Say or type a moment from a book (“when Harry first boards the Hogwarts Express”), a book to play, or a command: “back 30 seconds”, “forward 2 minutes”, “next chapter”, “chapter 7”, “speed 1.5”, “sleep in 20
          minutes”, “bookmark”, “pause”.
        </p>
        <form
          class="scene-form"
          onSubmit={(e) => {
            e.preventDefault();
            cancelSoon();
            run(text);
          }}
        >
          <textarea
            rows={2}
            value={text}
            placeholder="A scene, a book, or a command"
            onFocus={cancelSoon}
            onInput={(e) => (cancelSoon(), setText(e.currentTarget.value))}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), cancelSoon(), run(text))}
          />
          <div class="scene-btns">
            {canListen() && (
              <button type="button" class={'btn secondary' + (hearing ? ' active' : '')} disabled={hearing} onClick={hear}>
                <Icon name="mic" size={16} /> {hearing ? 'Listening…' : 'Speak'}
              </button>
            )}
            <button type="submit" class="btn primary" disabled={!text.trim()}>
              <Icon name="play" size={16} /> Play
            </button>
          </div>
        </form>
        {soon && <p class="muted small">Playing in a moment — tap the text to fix it first.</p>}
        {!aiReady() && <p class="err small">This uses your AI service — add a key in Settings → AI.</p>}
      </div>
    </div>
  );
}
