// Voices: the app's own (Audiohub's voice settings are its own Microsoft / offline voices).
import { useEffect, useState } from 'preact/hooks';
import { App } from '../shims/capacitor.js';

export function VoicesCard() {
  const [name, setName] = useState('');
  const load = () => App.voice().then((v) => setName(v.name || '')).catch(() => {});
  useEffect(() => {
    load();
    // A voice chosen in the app's voice list.
    const h = App.addListener('voice', (v) => setName(v.name || ''));
    return () => h.then((x) => x.remove());
  }, []);
  return (
    <>
      <p class="muted pad-s">
        Read aloud uses the app's voice{name ? <> — now <b>{name}</b></> : ''}. It keeps reading with the screen off.
      </p>
      <div class="set-row">
        <b>Voice</b>
        <button type="button" class="pill small" onClick={() => App.pickVoice().catch(() => {})}>
          Choose a voice
        </button>
      </div>
    </>
  );
}
