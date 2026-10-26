// "What's new": a short list of what changed, shown once after an update (and from
// Settings any time). Add the newest entry at the top of CHANGES with each build.
import { useEffect, useState } from 'preact/hooks';
import { persisted, useStore, library, progress } from '../lib/store.js';

export const CHANGES = [
  {
    id: '2026-10-26',
    title: 'Tags, highlights and Send to Kindle',
    items: [
      ['🏷️', 'Your own tags', 'Add tags like Psychology or Science on any book page, then filter by them in Library → Audiobooks / Ebooks.'],
      ['✍️', 'Highlight what you hear', 'In the player’s Text view, long-press a line to highlight it. It shows up in Notes as a quote — tap it to play from that moment.'],
      ['📚', 'Send to Kindle, directly', 'Add your Kindles and a Gmail app password in Settings → Send to Kindle: Kindle buttons then e-mail the book straight to the Kindle. Several Kindles? You pick one, or all.'],
      ['👋', 'Greeting', 'Type “.” as your name in Settings to be greeted without one.'],
    ],
  },
  {
    id: '2026-10-25',
    title: 'A fresh look and better sources',
    items: [
      ['🎨', 'New look', 'A cleaner font, polished covers (books without one get a printed-jacket cover) and six new light themes: Linen, Cloud, Apricot, Sage, Lilac, Stone & Brass.'],
      ['🔎', 'Sources, tidied', 'Audiobooks first, then ebooks, three of each with “Show more”; readable titles and format badges. Ebook results always say Read, never Play.'],
      ['⚡', 'Fewer hangs', '“Getting the file list” now stops at once with the reason, and problem reports include what TorBox said.'],
    ],
  },
];

const seen = persisted('changesSeen', '');

/** The update box: shown once for the newest entry the app hasn't shown yet. */
export function WhatsNew() {
  const last = useStore(seen);
  const [forced, setForced] = useState(null);
  showWhatsNew = () => setForced(CHANGES[0].id);
  // A brand-new install has nothing to catch up on: remember this version quietly.
  // (Someone updating from before this box existed has books or progress: show the newest.)
  const newInstall = !last && !Object.keys(library.get()).length && !Object.keys(progress.get()).length;
  useEffect(() => {
    if (newInstall) seen.set(CHANGES[0].id);
  }, [newInstall]);
  if (newInstall && !forced) return null;
  const fresh = forced ? CHANGES.slice(0, 2) : last ? CHANGES.filter((c) => c.id > last) : CHANGES.slice(0, 1);
  if (!fresh.length) return null;
  const close = () => {
    seen.set(CHANGES[0].id);
    setForced(null);
  };
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet whats-new" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <small class="wn-kicker">What’s new</small>
        {fresh.map((c) => (
          <section>
            <h3>{c.title}</h3>
            <ul>
              {c.items.map(([icon, head, text]) => (
                <li>
                  <span class="wn-icon">{icon}</span>
                  <span>
                    <b>{head}</b>
                    <small>{text}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button class="btn primary wide" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Open the box again (Settings → What's new). */
export let showWhatsNew = () => {};
