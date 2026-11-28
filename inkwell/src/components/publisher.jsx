// What Audible knows that a copy may not: the audio studio ("HarperAudio", "Penguin Audio") and
// the narrator — a phone M4B with Apple's details has neither, so its page showed no "Read by".
// Asked once per book and remembered. The publisher sits under "By / Read by"; a tap opens their
// other audiobooks.
import { useEffect, useState } from 'preact/hooks';
import { persisted } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { audible } from '../sources/catalogs.js';
import { mainTitle } from '../lib/match.js';

const known = persisted('audibleFacts', {}, { delay: 3000 }); // uid -> { p, n } ({} = Audible had none)

/** { publisher, narrator } from Audible for this book (the book's own Audible details when it is one). */
export function useAudibleFacts(book) {
  const own = () => (book.source === 'au' ? { p: book.publisher || '', n: book.narrator || '' } : known.get()[book.uid]);
  const [facts, setFacts] = useState(() => own() || {});
  useEffect(() => {
    const have = own();
    setFacts(have || {});
    if (have || !book.title || book.kind === 'text' || ['pod', 'sum', 'tts'].includes(book.source)) return;
    let alive = true;
    audible
      .find(mainTitle(book.title), (book.author || '').split(',')[0])
      .then((p) => {
        const same = p && mainTitle(p.title).toLowerCase() === mainTitle(book.title).toLowerCase();
        const f = same ? { p: p.publisher || '', n: p.narrator || '' } : {};
        known.set((all) => ({ ...all, [book.uid]: f }));
        if (alive) setFacts(f);
      })
      .catch(() => {});
    return () => (alive = false);
  }, [book.uid]);
  return { publisher: facts.p || '', narrator: facts.n || '' };
}

/**
 * The publisher: Audible's name for the audio studio; a server's details often name the print
 * publisher ("Harper"), so that's only the fallback.
 */
export function Publisher({ book, facts }) {
  const name = facts.publisher || book.publisher || '';
  if (!name) return null;
  return (
    <button class="book-publisher" onClick={() => nav.push('shelf', { title: name, subtitle: 'Audiobooks they publish, best-selling first', load: () => audible.byPublisher(name) })}>
      {name} ›
    </button>
  );
}
