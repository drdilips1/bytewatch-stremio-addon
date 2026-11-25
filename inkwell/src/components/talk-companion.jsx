// Story Companion: talk to the book without leaving the player. Tap Talk, ask out loud ("Who is
// Gurney again?"), the book pauses, the answer is spoken back — spoiler-safe, never past where
// you are — and the book carries on by itself. The same flow as Drive mode, in the full player.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { aiReady, aiHint } from '../lib/ai.js';
import { ask, threadFor, hearing } from '../lib/askbook.js';
import { canListen, listen, speakAnswer, stopAnswer, aiVoiceOn } from '../lib/voiceask.js';
import { mainTitle } from '../lib/match.js';

/** The Talk button (for the player's AI row) and, while it works, a small card with what was said. */
export function TalkButton({ book }) {
  const [phase, setPhase] = useState(''); // '' | listening | thinking | speaking
  const [said, setSaid] = useState('');
  const [answer, setAnswer] = useState('');
  const alive = useRef(true);
  const wasPlaying = useRef(false);
  useEffect(() => () => ((alive.current = false), stopAnswer()), []);
  const resume = () => {
    if (wasPlaying.current && !player.getState().playing) player.toggle();
  };
  const finish = () => {
    stopAnswer();
    setPhase('');
    resume();
  };
  const talk = async () => {
    if (phase) return finish(); // a second tap: stop and carry on
    if (!canListen()) return toast(aiVoiceOn.get() === false ? 'Voice is off (Settings → AI)' : 'Voice input is not available on this device');
    if (!aiReady()) return toast(aiHint());
    stopAnswer();
    wasPlaying.current = player.getState().playing;
    if (wasPlaying.current) player.pause();
    setSaid('');
    setAnswer('');
    setPhase('listening');
    let q = '';
    try {
      q = (await listen(`Ask about ${mainTitle(book.title)}`)).trim();
    } catch (e) {
      toast(e.message || 'Voice input failed');
    }
    if (!alive.current) return;
    if (!q) return finish();
    setSaid(q);
    setPhase('thinking');
    let a = '';
    try {
      a = await ask(book, q, { msgs: threadFor(book), description: book.description || '', where: hearing(book), voice: true, drive: true });
    } catch (e) {
      a = e.message || "Sorry, I couldn't get an answer right now.";
    }
    if (!alive.current) return;
    setAnswer(a);
    setPhase('speaking');
    speakAnswer(a, () => alive.current && (setPhase(''), resume()));
  };
  const label = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Stop' }[phase] || 'Talk';
  return (
    <>
      <button class={phase ? 'on' : ''} onClick={talk} aria-label="Talk to the book: ask out loud">
        {phase === 'thinking' ? <span class="spinner small" /> : <Icon name="mic" size={19} />}
        {label}
      </button>
      {(said || answer) && phase && (
        <div class="talk-card" onClick={finish}>
          {said && <p class="talk-q">“{said}”</p>}
          {answer && <p class="talk-a">{answer}</p>}
          <small>Tap to stop — the book carries on</small>
        </div>
      )}
    </>
  );
}
