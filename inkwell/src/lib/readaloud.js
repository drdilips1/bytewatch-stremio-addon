// Read along: speaks the reader's paragraphs one by one with the chosen free voice.
import { speak, stopSpeaking } from './tts.js';

export function readAloud(elements, from, { onIndex, onDone, onError } = {}) {
  let stopped = false;
  let i = from;
  (async () => {
    while (!stopped && i < elements.length) {
      const el = elements[i];
      onIndex?.(i, el);
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text) {
        try {
          await speak(text);
        } catch (e) {
          if (!stopped && e?.message !== 'stopped') onError?.(e);
          return;
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
