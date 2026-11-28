// The publisher under "By / Read by" — "Tantor Audio", "Penguin Audio" — and a tap opens their
// other audiobooks. Audible's name for the audio studio, asked once per book and remembered;
// your server's publisher only when Audible has none.
import { useEffect, useState } from 'preact/hooks';
import { persisted } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { audible } from '../sources/catalogs.js';
import { mainTitle } from '../lib/match.js';

const known = persisted('audioPublishers', {}, { delay: 3000 }); // uid -> name ('' = Audible had none)

export function Publisher({ book }) {
  // Audible names the audio studio ("HarperAudio", "Penguin Audio"); a server's details often
  // name the print publisher ("Harper"), so that's only the fallback.
  const fromAudible = () => (book.source === 'au' ? book.publisher || '' : known.get()[book.uid]);
  const [name, setName] = useState(() => fromAudible() || book.publisher || '');
  useEffect(() => {
    const au = fromAudible();
    setName(au || book.publisher || '');
    if (au != null || !book.title || book.kind === 'text' || ['pod', 'sum', 'tts'].includes(book.source)) return;
    let alive = true;
    audible
      .find(mainTitle(book.title), (book.author || '').split(',')[0])
      .then((p) => {
        const n = p && mainTitle(p.title).toLowerCase() === mainTitle(book.title).toLowerCase() ? p.publisher || '' : '';
        known.set((all) => ({ ...all, [book.uid]: n }));
        if (alive) setName(n || book.publisher || '');
      })
      .catch(() => {});
    return () => (alive = false);
  }, [book.uid, book.publisher]);
  if (!name) return null;
  return (
    <button class="book-publisher" onClick={() => nav.push('shelf', { title: name, subtitle: 'Audiobooks they publish, best-selling first', load: () => audible.byPublisher(name) })}>
      {name} ›
    </button>
  );
}
