// The publisher under "By / Read by" — "Tantor Audio", "Penguin Audio" — and a tap opens their
// other audiobooks. From the book's own details (Audible, your Audiobookshelf); else asked of
// Audible once per book and remembered.
import { useEffect, useState } from 'preact/hooks';
import { persisted } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { audible } from '../sources/catalogs.js';
import { mainTitle } from '../lib/match.js';

const known = persisted('publishers', {}, { delay: 3000 }); // uid -> name ('' = Audible had none)

export function Publisher({ book }) {
  const [name, setName] = useState(() => book.publisher || known.get()[book.uid] || '');
  useEffect(() => {
    const have = book.publisher || known.get()[book.uid];
    setName(have || '');
    if (have != null && have !== '') return;
    if (book.uid in known.get() || !book.title || book.kind === 'text' || ['pod', 'sum', 'tts'].includes(book.source)) return;
    let alive = true;
    audible
      .find(mainTitle(book.title), (book.author || '').split(',')[0])
      .then((p) => {
        const n = p && mainTitle(p.title).toLowerCase() === mainTitle(book.title).toLowerCase() ? p.publisher || '' : '';
        known.set((all) => ({ ...all, [book.uid]: n }));
        if (alive) setName(n);
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
