// Whisper Notes in the player: record your own voice at a moment, and get it back when you reach
// that moment again — a banner with Play (or it plays by itself, if you switch that on). The book
// is only ever paused and resumed through the player's own controls.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { toast } from './common.jsx';
import * as player from '../lib/player.js';
import { useStore } from '../lib/store.js';
import { whispers, whisperAutoPlay, whisperAt, saveWhisper, whisperUrl, deleteWhisper } from '../lib/whispers.js';
import { fmtTime } from '../lib/format.js';

const MAX_SECS = 60;
let clip = null; // the note playing now (one at a time)

/** Play a note's clip; the book pauses for it and carries on after (if it was playing). */
export async function playWhisper(w) {
  const url = await whisperUrl(w.id);
  if (!url) return toast('That voice note is no longer on this phone');
  clip?.pause();
  const was = player.getState().playing;
  if (was) player.pause();
  clip = new Audio(url);
  const back = () => {
    clip = null;
    if (was && !player.getState().playing) player.toggle();
  };
  clip.onended = back;
  clip.onerror = back;
  clip.play().catch(back);
}

/** Record a voice note at this moment (tap to start, tap again to stop; at most a minute). */
export function WhisperRecord({ book }) {
  const [rec, setRec] = useState(null); // { mr, at, started, chunks, stream, wasPlaying }
  const [secs, setSecs] = useState(0);
  const timer = useRef(0);
  useEffect(() => () => (clearInterval(timer.current), rec?.stream.getTracks().forEach((t) => t.stop())), [rec]);
  const stop = () => rec?.mr.state === 'recording' && rec.mr.stop();
  const start = async () => {
    if (rec) return stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Recording isn’t available on this device');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast('Allow the microphone to record a voice note');
    }
    const wasPlaying = player.getState().playing;
    if (wasPlaying) player.pause();
    const at = player.globalTime();
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const started = Date.now();
    mr.onstop = async () => {
      clearInterval(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      setRec(null);
      const len = (Date.now() - started) / 1000;
      if (len >= 1 && chunks.length) {
        try {
          await saveWhisper(book.uid, at, new Blob(chunks, { type: chunks[0].type || mr.mimeType || 'audio/webm' }), len);
          toast(`🎙 Voice note kept at ${fmtTime(at)} — it comes back when you reach here again`);
        } catch (e) {
          toast(e.message);
        }
      }
      if (wasPlaying && !player.getState().playing) player.toggle();
    };
    mr.start();
    setSecs(0);
    timer.current = setInterval(() => {
      const n = Math.round((Date.now() - started) / 1000);
      setSecs(n);
      if (n >= MAX_SECS) mr.state === 'recording' && mr.stop();
    }, 500);
    setRec({ mr, stream });
  };
  return (
    <button class={'comp-btn' + (rec ? ' rec' : '')} onClick={start} aria-label={rec ? 'Stop recording' : 'Record a voice note here'}>
      <Icon name="mic" size={19} />
      {rec ? `Stop · ${secs}s` : 'Voice note'}
    </button>
  );
}

/** "You left a voice note here": shown when the book reaches one (or it plays by itself). */
export function WhisperBanner({ book, time }) {
  const all = useStore(whispers);
  const auto = useStore(whisperAutoPlay);
  const done = useRef(new Set());
  const [gone, setGone] = useState(null);
  useEffect(() => {
    done.current = new Set();
  }, [book?.uid]);
  const w = book ? whisperAt(all[book.uid], time, { done: done.current }) : null;
  useEffect(() => {
    if (w && auto) {
      done.current.add(w.id);
      playWhisper(w);
    }
  }, [w?.id, auto]);
  if (!w || auto || gone === w.id) return null;
  const close = () => (done.current.add(w.id), setGone(w.id));
  return (
    <div class="welcome-back whisper-here">
      <span>🎙 You left a voice note here · {new Date(w.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      <button class="pill small" onClick={() => (close(), playWhisper(w))}>
        <Icon name="play" size={14} /> Play
      </button>
      <button class="icon-btn" aria-label="Not now" onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** This book's voice notes: play, go there, delete; and the "play by themselves" switch. */
export function WhisperList({ book }) {
  const list = useStore(whispers)[book?.uid] || [];
  const auto = useStore(whisperAutoPlay);
  if (!list.length) return null;
  return (
    <div class="whisper-list">
      <b>Your voice notes · {list.length}</b>
      {list.map((w) => (
        <div class="whisper-row">
          <button class="icon-btn" aria-label="Play the voice note" onClick={() => playWhisper(w)}>
            <Icon name="play" size={16} />
          </button>
          <button class="link-btn" onClick={() => player.playAt(w.global)}>
            at {fmtTime(w.global)} · {w.secs}s · {new Date(w.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </button>
          <button class="icon-btn" aria-label="Delete the voice note" onClick={() => deleteWhisper(book.uid, w.id)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
      <label class="whisper-auto">
        <input type="checkbox" checked={auto} onChange={(e) => whisperAutoPlay.set(e.currentTarget.checked)} /> Play them by themselves when I reach them
      </label>
    </div>
  );
}
