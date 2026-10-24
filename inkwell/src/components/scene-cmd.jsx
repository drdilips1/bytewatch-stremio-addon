// "Play a scene" on Home: say (or type) a moment from a book; it finds your copy and
// starts 30 seconds before it.
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import { nav, useBackClose } from '../lib/nav.js';
import { aiReady } from '../lib/ai.js';
import { canListen, listen } from '../lib/voiceask.js';

export function SceneButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="icon-btn glass" onClick={() => setOpen(true)} aria-label="Play a scene by voice">
        <Icon name="mic" />
      </button>
      {open && createPortal(<SceneSheet close={() => setOpen(false)} />, document.body)}
    </>
  );
}

function SceneSheet({ close }) {
  useBackClose(true, close);
  const [text, setText] = useState('');
  const [hearing, setHearing] = useState(false);
  // Once it has your words the box goes away; progress and the result show as short messages.
  const run = async (said) => {
    if (!said.trim()) return;
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    close();
    toast(`🎧 Finding “${said.trim().slice(0, 60)}”…`);
    try {
      const { playScene } = await import('../lib/voicecmd.js');
      const r = await playScene(said, (t) => t.startsWith('Opening') && toast(t));
      nav.openOverlay('player');
      toast(`▶ ${r.scene || r.book.title}${r.where ? ` · ${r.where}` : ''}`);
    } catch (e) {
      toast(e.message);
      if (e.want) import('../screens/Discover.jsx').then((m) => m.openSearch(`${e.want.title} ${e.want.author || ''}`.trim()));
    }
  };
  const hear = async () => {
    setHearing(true);
    try {
      const said = await listen('Which scene should I play?');
      setHearing(false);
      if (said) run(said);
    } catch (e) {
      setHearing(false);
      toast(e.message);
    }
  };
  useEffect(() => {
    if (canListen() && aiReady()) hear();
  }, []);
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet scene-cmd" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>Play a scene</h3>
        <p class="muted small">Say a moment from a book, like “play when Harry first boards the Hogwarts Express”. It starts 30 seconds before it.</p>
        <form
          class="scene-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <input value={text}  placeholder="Or type it here" onInput={(e) => setText(e.currentTarget.value)} />
          {canListen() && (
            <button type="button" class={'icon-btn' + (hearing ? ' active' : '')} disabled={hearing} onClick={hear} aria-label="Speak">
              <Icon name="mic" />
            </button>
          )}
          <button type="submit" class="icon-btn" disabled={!text.trim()} aria-label="Play">
            <Icon name="play" />
          </button>
        </form>
        {hearing && <p class="muted">Listening…</p>}
        {!aiReady() && <p class="err small">This uses your AI service — add a key in Settings → AI.</p>}
      </div>
    </div>
  );
}
