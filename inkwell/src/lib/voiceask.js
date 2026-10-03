// Voice for Ask AI: speak a question (Google's speech input on Android — very good
// with Indian English and Hindi; the browser's speech recognition on the web) and
// hear the answer read aloud — in its own voice (chosen on the Ask screen), or the one
// in Settings → Voices.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { speak, stopSpeaking, ttsCfg, nativeReader, Reader, voiceSpec, EDGE_VOICES } from './tts.js';

const Listen = registerPlugin('InkwellListen');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellListen');
const WebSR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const LANGS = [
  ['en-IN', 'English (India)'],
  ['hi-IN', 'हिंदी'],
];
export const voiceLang = persisted('askVoiceLang', 'en-IN');

// The voice answers are read in (Android): Microsoft's natural voices, Indian ones first.
// '' = the same as Settings → Voices.
export const askVoice = persisted('askVoice', '');
// Read every answer aloud (on by default); answers to spoken questions are always read.
export const autoRead = persisted('askAutoRead', true);
export const canPickVoice = nativeReader;
const indian = (id) => /-IN-/.test(id);
export const ASK_VOICES = [...EDGE_VOICES.filter(([id]) => indian(id)), ...EDGE_VOICES.filter(([id]) => !indian(id))];
export const canListen = () => native || !!WebSR;

/** Listen once; resolves the recognised text ('' if nothing was said). */
export function listen(prompt = 'Ask about this book') {
  const lang = voiceLang.get() || 'en-IN';
  if (native) return Listen.listen({ lang, prompt }).then((r) => r?.text || '');
  if (!WebSR) return Promise.reject(new Error('Voice input needs Chrome or Safari'));
  return new Promise((resolve, reject) => {
    const r = new WebSR();
    r.lang = lang;
    r.interimResults = false;
    r.maxAlternatives = 1;
    let got = '';
    r.onresult = (e) => (got = e.results?.[0]?.[0]?.transcript || '');
    r.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(e.error === 'not-allowed' ? 'Allow the microphone for this site' : e.error)));
    r.onend = () => resolve(got);
    r.start();
  });
}

// Plain text for speaking: no markdown marks, list numbers read naturally.
const plain = (t) =>
  String(t || '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

let run = 0;
let readerOn = false;
// The Microsoft voice to use, if any: the Ask screen's pick, else Settings' when it's a Microsoft voice.
function edgeVoice() {
  if (!nativeReader) return '';
  const c = ttsCfg.get();
  return askVoice.get() || (c.mode === 'edge' || !c.mode ? c.edgeVoice || EDGE_VOICES[0][0] : '');
}

/** Read an answer aloud, a few sentences at a time (so it starts quickly). */
export async function speakAnswer(text, onDone) {
  const my = ++run;
  const edge = edgeVoice();
  if (edge) {
    // The read-aloud engine plays the whole answer, paragraph by paragraph.
    const paras = plain(text).split('\n').map((x) => x.trim()).filter(Boolean);
    const done = () => {
      if (my !== run) return;
      readerOn = false;
      onDone?.();
    };
    try {
      readerOn = true;
      await Reader.start({ uid: 'ask-answer', title: 'Ask AI', paras, from: 0, rate: ttsCfg.get().rate || 1, voice: { ...voiceSpec(), engine: 'edge', edgeVoice: edge } });
      const h = await Reader.addListener('state', (st) => {
        if (st.uid !== 'ask-answer' || st.finished || !st.active || (!st.playing && st.error) || my !== run) {
          h.remove();
          done();
        }
      });
    } catch {
      done();
    }
    return;
  }
  const parts = [];
  let cur = '';
  for (const s of plain(text).split(/(?<=[.!?])\s+|\n/)) {
    if ((cur + ' ' + s).length > 320 && cur) {
      parts.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) parts.push(cur);
  try {
    for (const p of parts) {
      if (my !== run) return;
      if (p.trim()) await speak(p);
    }
  } catch {
    // stopped or no voice available
  } finally {
    if (my === run) onDone?.();
  }
}
export function stopAnswer() {
  run++;
  if (readerOn) {
    readerOn = false;
    Reader.stop().catch(() => {});
  }
  stopSpeaking();
}
