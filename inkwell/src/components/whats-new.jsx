// "What's new": a short list of what changed, shown once after an update (and from
// Settings any time). Add the newest entry at the top of CHANGES with each build.
import { useEffect, useState } from 'preact/hooks';
import { persisted, useStore, library, progress } from '../lib/store.js';

export const CHANGES = [
  {
    id: '2026-10-28',
    title: 'Select by sliding, and fixes',
    items: [
      ['👆', 'Press, hold and slide', 'In ebooks, press on a word, hold a moment, then slide your finger — the selection follows it, word by word (the page scrolls at the edges). Lift, then Highlight.'],
      ['💬', 'Nicer quote sharing', 'Pick the look (Paper, Cover colours, Night) with a preview; text set like a book page. The message is just the book and a short “Open in Audiohub” link — and a long note goes in full as text, or share it all as text.'],
      ['📖', 'The ebook follows the audiobook', 'An ebook attached to an audiobook now works for every copy of it — another source, a download — so the Text view shows the book’s real words, not misheard ones.'],
    ],
  },
  {
    id: '2026-10-27',
    title: 'Share what you love',
    items: [
      ['💬', 'Share a quote', 'In Notes, tap Share on a highlight, transcript quote or bookmark: a quote card with a link goes to WhatsApp, Telegram, anywhere.'],
      ['🔗', 'Open shared quotes', 'Tap a shared link to read it — or open it in Audiohub to play from that exact moment (or the passage in the ebook).'],
      ['⬇️', 'Don’t have the book?', 'Get it first; when you play it, the app offers “Jump to the shared quote”.'],
      ['🖍️', 'Highlights stay put', 'Highlights and notes are now also saved in the app’s own files, so a full phone storage can’t lose them — and they’re in backups and sync. They show however you open the book (source, Downloads, another copy).'],
      ['✂️', 'Easier highlighting', 'Long-press a word, then tap Sentence, Paragraph or + Next to select exactly that — no fiddly dragging. The page no longer jumps while you select, and the buttons stay at the bottom.'],
      ['🌐', 'Translate into your language', 'Translate now works in Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Urdu, Spanish, French and more — and 🔊 reads the translation in a natural voice for that language.'],
      ['📖', 'Read a whole book in Hindi', 'In the reader, Text (T) → “Read this book in…”: pages are translated as you read (and kept), and Read aloud speaks them in a natural Hindi (or other) voice.'],
      ['📝', 'This book’s notes, right there', 'In the reader, tap ✎ at the top; in the player, More → Notes. Highlights, notes and bookmarks of that book — from its ebook and its audiobook — to jump to, edit or share.'],
    ],
  },
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
