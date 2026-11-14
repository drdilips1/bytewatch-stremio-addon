// Driving mode by itself: when the car audio you picked (Settings → Playback → Your car)
// connects, driving mode opens; when it goes, driving mode closes.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { settings } from './store.js';
import { nav } from './nav.js';

const ON = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellPlayer');
const Native = registerPlugin('InkwellPlayer');

/** Headphones / car audio connected now (names), [] where it can't be told. */
export async function audioOutputs() {
  if (!ON) return [];
  try {
    return (await Native.audioOutputs()).outputs || [];
  } catch {
    return [];
  }
}

const isCar = (name) => (settings.get().carDevices || []).includes(name);
let pending = false;
const open = async () => {
  if (document.visibilityState !== 'visible') return (pending = true);
  pending = false;
  if (nav.state().overlay === 'drive') return;
  const { openDrive } = await import('../components/drive-mode.jsx');
  openDrive();
};

if (ON) {
  Native.addListener('route', (e) => {
    if (settings.get().autoDrive === false) return;
    if ((e.added || []).some(isCar)) open();
    if ((e.removed || []).some(isCar)) {
      pending = false;
      if (nav.state().overlay === 'drive') nav.closeOverlay();
    }
  }).catch(() => {});
  // Connected while the app was in the background: driving mode is there when you open it.
  document.addEventListener('visibilitychange', () => pending && document.visibilityState === 'visible' && open());
  // Already in the car when the app starts.
  setTimeout(async () => {
    if (settings.get().autoDrive !== false && (await audioOutputs()).some(isCar)) open();
  }, 2500);
}
