import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, SkipIcon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { usePlayer } from './player-ui.jsx';
import * as player from '../lib/player.js';
import { nav } from '../lib/nav.js';
import { persisted, useStore } from '../lib/store.js';
import { aiReady, aiHint } from '../lib/ai.js';
import { ask, threadFor, hearing } from '../lib/askbook.js';
import { mainTitle } from '../lib/match.js';
import { fmtTime } from '../lib/format.js';
import { canListen, listen, speakAnswer, stopAnswer, voiceLang, aiVoiceOn } from '../lib/voiceask.js';

let pendingListen = false;
/** Open driving mode; `listenNow` starts listening for a question straight away ('scene': for a scene to play). */
export function openDrive(listenNow = false) {
  pendingListen = listenNow;
  nav.openOverlay('drive');
}

// After an answer, listen again for a follow-up (nothing said → the book carries on).
export const driveCfg = persisted('driveMode', { followUp: true });

/**
 * Driving mode: huge controls and one big "Ask" area — a single tap anywhere on it
 * pauses the book, listens, answers out loud (short), then the book carries on.
 * `listenNow` starts listening straight away (from the "Ask while driving" shortcut).
 */
export function DriveMode() {
  const s = usePlayer();
  const cfg = useStore(driveCfg);
  const lang = useStore(voiceLang);
  const [phase, setPhase] = useState('idle'); // idle | listening | thinking | speaking
  const [said, setSaid] = useState('');
  const [answer, setAnswer] = useState('');
  const alive = useRef(true);
  const resumeAfter = useRef(false);

  // Keep the screen on while driving.
  useEffect(() => {
    let lock = null;
    const grab = () => navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    grab();
    const onVis = () => document.visibilityState === 'visible' && grab();
    document.addEventListener('visibilitychange', onVis);
    if (pendingListen) setTimeout(() => (pendingListen === 'scene' ? sceneNow() : askNow()), 500);
    pendingListen = false;
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch(() => {});
      stopAnswer();
    };
  }, []);

  const carryOn = () => {
    setPhase('idle');
    if (resumeAfter.current && !player.getState().playing) player.toggle();
    resumeAfter.current = false;
  };

  // Three buttons, each its own kind of request (so a question is never taken for a search):
  // 'book' — a scene or a question about the book playing; 'play' — another book, the next in
  // the series, something to find; 'cmd' — quick controls (no AI).
  const KIND = {
    book: { prompt: (bk) => (bk ? `About ${mainTitle(bk.title)}: a scene or a question` : 'Start a book first'), needsAi: true },
    play: { prompt: () => 'Which book? Or what kind of book?', needsAi: true },
    cmd: { prompt: () => 'Say a command', needsAi: false },
  };
  const [kind, setKind] = useState('');
  const speak = (text, wasPlaying, followKind = '') =>
    new Promise((done) => {
      setAnswer(text);
      setPhase('speaking');
      speakAnswer(text, () => {
        done();
        if (!alive.current) return;
        if (followKind && driveCfg.get().followUp) return voice(followKind, true, wasPlaying);
        setPhase('idle');
        if (wasPlaying && !player.getState().playing) player.toggle();
      });
    });

  const voice = async (k, followUp = false, playingBefore = null, preset = '') => {
    if (!canListen() && !preset) return toast(aiVoiceOn.get() === false ? 'Voice is off (Settings → AI)' : 'Voice input is not available on this device');
    if (KIND[k].needsAi && !aiReady()) return toast(aiHint());
    if (k === 'book' && !player.getState().book) return toast('Nothing is playing — use “Play something else” first');
    stopAnswer();
    const wasPlaying = playingBefore ?? player.getState().playing;
    if (player.getState().playing) player.pause();
    setKind(k);
    let q = preset;
    if (!q) {
      setPhase('listening');
      try {
        q = (await listen(KIND[k].prompt(player.getState().book))).trim();
      } catch (e) {
        toast(e.message || 'Voice input failed');
      }
    }
    if (!alive.current) return;
    if (!q) {
      setPhase('idle');
      if (wasPlaying && !player.getState().playing) player.toggle();
      return;
    }
    setSaid(q);
    setAnswer('');
    setPhase('thinking');
    try {
      const vc = await import('../lib/voicecmd.js');
      const r = k === 'cmd' ? await vc.runQuickCommand(q) : k === 'play' ? await vc.runPlay(q, () => {}) : await vc.runInBook(q, () => {});
      if (!alive.current) return;
      if (r.question || r.find) {
        // A question about this book, or books to find: answered out loud (short, for driving).
        const book = r.find ? null : r.book || player.getState().book;
        let a = '';
        try {
          a = await ask(book, q, { msgs: threadFor(book), description: book?.description || '', where: hearing(book), drive: true, voice: true });
        } catch (e) {
          a = e.message || "Sorry, I couldn't get an answer right now.";
        }
        if (!alive.current) return;
        return speak(a, wasPlaying, r.question ? 'book' : '');
      }
      setPhase('idle');
      if (r.message) {
        // A control: the book carries on (unless you asked to pause).
        if (wasPlaying && r.action !== 'pause' && !player.getState().playing) player.toggle();
        toast(r.message);
      } else if (r.notFound) toast(r.scene, 8000);
      else toast(`▶ ${r.scene || r.book?.title || ''}${r.where ? ` · ${r.where}` : ''}`, 4000);
    } catch (e) {
      if (!alive.current) return;
      speak(e.message, wasPlaying);
    }
  };
  const sceneNow = (preset = '') => voice('book', false, null, preset);
  const askNow = () => voice('book');

  const book = s.book;
  const ch = book ? player.chapters().find((c) => player.globalTime() >= c.start && player.globalTime() < (c.end || Infinity)) : null;
  const status = {
    idle: '',
    listening: kind === 'cmd' ? 'Listening… say a command' : kind === 'play' ? 'Listening… which book?' : 'Listening… a scene or a question',
    thinking: kind === 'play' ? 'Finding it…' : kind === 'book' ? 'Working it out…' : 'Doing it…',
    speaking: 'Answering — tap to stop',
  }[phase];

  return (
    <div class="drive">
      <header class="drive-top">
        <button class="drive-exit" onClick={() => nav.closeOverlay()} aria-label="Exit driving mode">
          <Icon name="close" size={26} /> Exit
        </button>
        <div class="drive-now">
          {book ? (
            <>
              <Cover book={book} class="drive-cover" />
              <div>
                <b>{mainTitle(book.title)}</b>
                <small>{ch?.title ? `${ch.title} · ` : ''}{fmtTime(player.globalTime())}</small>
              </div>
            </>
          ) : (
            <div>
              <b>Nothing playing</b>
              <small>Start a book, or ask about your library</small>
            </div>
          )}
        </div>
      </header>

      {book && (
        <div class="drive-controls">
          <button onClick={() => player.skip(-30)} aria-label="Back 30 seconds">
            <SkipIcon seconds={30} size={56} />
          </button>
          <button class="drive-play" onClick={() => player.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}>
            {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={64} />}
          </button>
          <button onClick={() => player.skip(30)} aria-label="Forward 30 seconds">
            <SkipIcon seconds={30} forward size={56} />
          </button>
        </div>
      )}

      {phase !== 'idle' ? (
        <button
          class={'drive-ask ' + phase}
          onClick={() => {
            stopAnswer();
            carryOn();
          }}
          aria-label={status}
        >
          <span class="drive-mic">{phase === 'thinking' ? <span class="spinner" /> : '🎙'}</span>
          <b>{status}</b>
          {said && <small class="drive-said">“{said}”</small>}
          {answer && phase === 'speaking' && <p class="drive-answer">{answer.replace(/[*_#`]/g, '')}</p>}
        </button>
      ) : (
        <div class="drive-voices">
          <button class="drive-v v-book" disabled={!book} onClick={() => voice('book')}>
            <span class="drive-v-i">📖</span>
            <span>
              <b>In this book</b>
              <small>“Play the part where…” · “Who is…?” · “What just happened?”</small>
            </span>
          </button>
          <button class="drive-v v-play" onClick={() => voice('play')}>
            <span class="drive-v-i">▶</span>
            <span>
              <b>Play something else</b>
              <small>“Play Atomic Habits” · “Next book in the series” · “Something short about history”</small>
            </span>
          </button>
          <button class="drive-v v-cmd" onClick={() => voice('cmd')}>
            <span class="drive-v-i">⚙</span>
            <span>
              <b>Quick command</b>
              <small>“Back 1 minute” · “Next chapter” · “Start this chapter again” · “Sleep in 20 minutes”</small>
            </span>
          </button>
        </div>
      )}

      <div class="drive-opts">
        <label>
          <input type="checkbox" class="switch" checked={cfg.followUp} onChange={(e) => driveCfg.set({ ...cfg, followUp: e.currentTarget.checked })} />
          Listen for a follow-up after each answer
        </label>
        <button class="drive-lang" onClick={() => voiceLang.set(lang === 'hi-IN' ? 'en-IN' : 'hi-IN')}>
          {lang === 'hi-IN' ? 'हिंदी' : 'English'}
        </button>
      </div>
    </div>
  );
}
