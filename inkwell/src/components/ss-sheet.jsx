// The choice after tapping a StoryShots "S": hear their written summary here, read
// by your voice, or open StoryShots for their own audio.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { registerChooser, storyShotsBook, openStoryShots } from '../sources/storyshots.js';

export function StoryShotsSheet() {
  const [pick, setPick] = useState(null);
  useEffect(() => {
    registerChooser(setPick);
    return () => registerChooser(null);
  }, []);
  if (!pick) return null;
  const close = () => setPick(null);
  const sb = storyShotsBook(pick.book, pick.url);
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet ss-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>
          <span class="ss-badge">S</span> {pick.book.title} on StoryShots
        </h3>
        <button
          class="btn primary big"
          onClick={() => {
            close();
            nav.push('reader', { book: sb, readAloud: true });
          }}
        >
          <Icon name="headphones" size={18} /> Listen here
        </button>
        <small class="muted">Their written summary, read aloud by your voice — with the lock-screen player and speed control.</small>
        <button
          class="btn secondary big"
          onClick={() => {
            close();
            nav.push('reader', { book: sb });
          }}
        >
          <Icon name="book" size={18} /> Read here
        </button>
        <button
          class="btn secondary big"
          onClick={() => {
            close();
            openStoryShots(pick.url);
          }}
        >
          <Icon name="external" size={18} /> Open StoryShots
        </button>
        <small class="muted">Their own narrated audio, in the StoryShots app with your account.</small>
      </div>
    </div>
  );
}
