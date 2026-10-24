// "Play a scene" on Home: say (or type) a moment from a book; it finds your copy and
// starts 30 seconds before it.
import { useEffect, useState } from 'preact/hooks';
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
      {open && <SceneSheet close={() => setOpen(false)} />}
    </>
  );
}

function SceneSheet({ close }) {
  useBackClose(true, close);
  const [text, setText] = useState('');
  const [step, setStep] = useState('');
  const [hearing, setHearing] = useState(false);
  const run = async (said) => {
    if (!said.trim()) return;
    if (!aiReady()) return toast('Add an AI key in Settings → AI first');
    setText(said);
    try {
      const { playScene } = await import('../lib/voicecmd.js');
      const r = await playScene(said, setStep);
      close();
      nav.openOverlay('player');
      toast(`▶ ${r.scene || r.book.title}${r.where ? ` · ${r.where}` : ''}`);
    } catch (e) {
      setStep('');
      toast(e.message);
      if (e.want) {
        close();
        import('../screens/Discover.jsx').then((m) => m.openSearch(`${e.want.title} ${e.want.author || ''}`.trim()));
      }
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
          <input value={text} disabled={!!step} placeholder="Or type it here" onInput={(e) => setText(e.currentTarget.value)} />
          {canListen() && (
            <button type="button" class={'icon-btn' + (hearing ? ' active' : '')} disabled={!!step || hearing} onClick={hear} aria-label="Speak">
              <Icon name="mic" />
            </button>
          )}
          <button type="submit" class="icon-btn" disabled={!!step || !text.trim()} aria-label="Play">
            <Icon name="play" />
          </button>
        </form>
        {hearing && <p class="muted">Listening…</p>}
        {step && (
          <p class="muted">
            <span class="spinner small" /> {step}
          </p>
        )}
        {!aiReady() && <p class="err small">This uses your AI service — add a key in Settings → AI.</p>}
      </div>
    </div>
  );
}
