// Read along: speaks the reader's paragraphs with the chosen free voice.
// Built-in voices render a few sentences ahead while the current one plays, so
// there are no gaps; a clip that fails is retried once and then skipped
// instead of stopping the reading.
import { speak, stopSpeaking, canPrepare, prepareClip, playClip, splitLong, speakable } from './tts.js';

export function readAloud(elements, from, { onIndex, onDone, onError } = {}) {
  let stopped = false;
  let i = from;

  // Pieces of about a sentence or two, each tagged with its paragraph — split
  // as reading goes (a long book has thousands of paragraphs).
  const pieces = [];
  let nextEl = from;
  const fill = (n) => {
    while (pieces.length <= n && nextEl < elements.length) {
      const k = nextEl++;
      const text = speakable(elements[k].textContent);
      if (text) for (const t of splitLong(text, 320)) pieces.push({ k, t });
    }
    return n < pieces.length;
  };

  (async () => {
    if (canPrepare()) {
      const ready = new Map();
      const prep = (n) => {
        if (!fill(n) || ready.has(n)) return;
        const p = prepareClip(pieces[n].t).catch(() => prepareClip(pieces[n].t));
        p.catch(() => {});
        ready.set(n, p);
      };
      let failures = 0;
      for (let n = 0; fill(n) && !stopped; n++) {
        if (pieces[n].k !== i || n === 0) {
          i = pieces[n].k;
          onIndex?.(i, elements[i]);
        }
        for (let a = 0; a <= 3; a++) prep(n + a); // keep three pieces ready ahead
        try {
          const uri = await ready.get(n);
          if (stopped) break;
          await playClip(uri, pieces[n].t.split(' ').length);
          failures = 0;
        } catch (e) {
          if (stopped || e?.message === 'stopped') return;
          // Skip a piece that won't render or play; give up only if nothing works.
          if (++failures >= 4) return onError?.(e);
        }
        ready.delete(n);
      }
      if (!stopped) onDone?.();
      return;
    }
    // Phone TTS engine: it queues and speaks by itself, paragraph by paragraph.
    while (!stopped && i < elements.length) {
      const el = elements[i];
      onIndex?.(i, el);
      const text = speakable(el.textContent);
      if (text) {
        try {
          await speak(text);
        } catch (e) {
          if (stopped || e?.message === 'stopped') return;
          try {
            await speak(text);
          } catch (e2) {
            if (!stopped) onError?.(e2);
            return;
          }
        }
      }
      if (!stopped) i++;
    }
    if (!stopped) onDone?.();
  })();
  return {
    stop() {
      stopped = true;
      stopSpeaking();
    },
    get index() {
      return i;
    },
  };
}
