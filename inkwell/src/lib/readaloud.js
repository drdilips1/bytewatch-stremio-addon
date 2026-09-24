// Phone-voice read-aloud for the reader (Android TextToSpeech / Web Speech).
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { ttsCfg } from './tts.js';

let voicesCache = null;
export async function deviceVoices() {
  if (voicesCache) return voicesCache;
  try {
    const { voices } = await TextToSpeech.getSupportedVoices();
    voicesCache = (voices || []).map((v, i) => ({ index: i, name: v.name, lang: v.lang, local: v.localService }));
  } catch {
    voicesCache = [];
  }
  return voicesCache;
}

/**
 * Reads `elements` (paragraph nodes) one after another starting at `from`.
 * Returns a controller: { stop(), index }.
 */
export function readAloud(elements, from, { onIndex, onDone, onError, rate } = {}) {
  let stopped = false;
  let i = from;
  const c = ttsCfg.get();
  const run = async () => {
    while (!stopped && i < elements.length) {
      const el = elements[i];
      onIndex?.(i, el);
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text) {
        try {
          await TextToSpeech.speak({
            text,
            lang: document.documentElement.lang || 'en-US',
            rate: rate ?? c.deviceRate ?? 1,
            pitch: 1,
            volume: 1,
            voice: c.deviceVoice >= 0 ? c.deviceVoice : undefined,
            category: 'playback',
            queueStrategy: 0,
          });
        } catch (e) {
          if (!stopped) onError?.(e);
          return;
        }
      }
      if (!stopped) i++;
    }
    if (!stopped) onDone?.();
  };
  run();
  return {
    stop() {
      stopped = true;
      TextToSpeech.stop().catch(() => {});
    },
    get index() {
      return i;
    },
  };
}
