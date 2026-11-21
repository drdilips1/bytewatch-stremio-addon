// Motion: small, quiet animations (the cover breathing while it plays, play ⇄ pause, a ripple
// on skip, sparks on a like, the cover growing into the player, a moon for the sleep timer…).
// Settings → Appearance → Motion: Off / Gentle (default) / Full. Off — or the phone's own
// "reduce motion" with Gentle — keeps everything still. Only transform / opacity move (cheap),
// and the endless ones pause while the app is in the background.
import { settings } from './store.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 'off' | 'gentle' | 'full' — what the app does now. */
export function motionLevel() {
  const m = settings.get().motion || 'gentle';
  if (m === 'off') return 'off';
  if (m === 'gentle' && reduced()) return 'off';
  return m;
}
const apply = () => typeof document !== 'undefined' && (document.documentElement.dataset.motion = motionLevel());
if (typeof document !== 'undefined') {
  apply();
  settings.subscribe(apply);
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
  } catch {}
  // Nothing animates while you can't see it.
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('app-hidden', document.visibilityState === 'hidden'));
}
const on = () => motionLevel() !== 'off';

/** Two rings spreading out from a button (skip 15 / 30), and the icon gives a small turn. */
export function ripple(el) {
  if (!el || !on()) return;
  for (const delay of [0, 120]) {
    const r = document.createElement('span');
    r.className = 'mo-ripple';
    r.style.animationDelay = `${delay}ms`;
    el.appendChild(r);
    setTimeout(() => r.remove(), 800);
  }
  el.classList.remove('mo-turn');
  void el.offsetWidth;
  el.classList.add('mo-turn');
}

/** A quick squash-and-bounce (the play button). */
export function squash(el) {
  if (!el || !on()) return;
  el.classList.remove('mo-squash');
  void el.offsetWidth;
  el.classList.add('mo-squash');
}

/** A few sparks flying out of a button (a like, Read later). */
export function burst(el) {
  if (!el || !on()) return;
  const n = motionLevel() === 'full' ? 16 : 12;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'mo-spark' + (i % 2 ? ' alt' : '');
    s.style.setProperty('--a', `${(i * 360) / n}deg`);
    el.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }
}
