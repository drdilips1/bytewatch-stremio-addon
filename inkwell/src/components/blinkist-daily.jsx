// Home: Blinkist's free book of the day (with Blinkist switched on), opened in its own player.
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { blinkist, freeDaily, openBlinkist, DAILY } from '../sources/blinkist.js';

export function BlinkistDaily() {
  const cfg = useStore(blinkist);
  const [d, setD] = useState(null);
  useEffect(() => {
    if (cfg.on) freeDaily().then(setD).catch(() => setD({ title: '', url: DAILY }));
  }, [cfg.on]);
  if (!cfg.on) return null;
  return (
    <button class="bl-daily" onClick={() => openBlinkist(d?.url || DAILY)}>
      <span class="bl-badge">B</span>
      <span>
        <small>BLINKIST · FREE TODAY</small>
        <b>{d?.title || 'Today’s free book'}</b>
      </span>
    </button>
  );
}
