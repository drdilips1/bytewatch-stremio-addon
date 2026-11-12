// The library, kept on the phone (IndexedDB): each book is its title, author and blocks
// ({ t: text, h: true for a chapter heading }), as the reader shows and reads them.
const DB = 'p2a-ios';
const STORE = 'books';

let opened = null;
function db() {
  return (opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage full'));
  });
}

export const getBook = (id) => run('readonly', (s) => s.get(id));
export const putBook = (book) => run('readwrite', (s) => s.put(book));
export const deleteBook = (id) => run('readwrite', (s) => s.delete(id));

/** The library list, newest first, without the books' text. */
export async function listBooks() {
  const all = (await run('readonly', (s) => s.getAll())) || [];
  return all
    .map(({ blocks, ...rest }) => ({ ...rest, words: rest.words ?? 0 }))
    .sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
}

/** How far into each book the reader is (its own saved progress), 0–100. */
export function percentOf(id) {
  try {
    const p = JSON.parse(localStorage.getItem('inkwell:progress') || '{}')[id];
    return Math.round(p?.percent ?? 0);
  } catch {
    return 0;
  }
}

// Keep the library when the phone is short of space (asks iOS not to clear it).
navigator.storage?.persist?.().catch(() => {});
