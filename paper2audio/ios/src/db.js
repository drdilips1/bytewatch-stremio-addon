// The library, kept on the phone (IndexedDB): each book is its title, author and blocks
// ({ t: text, h: true for a chapter heading }), as the reader shows and reads them.
const DB = 'p2a-ios';
const STORE = 'books';

let opened = null;
function db() {
  return (opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      const d = req.result;
      // iOS closes the connection when the app goes to the background (choosing a file in Files does
      // that): the next call opens a fresh one instead of failing with "the database connection is closing".
      d.onclose = () => (opened = null);
      d.onversionchange = () => {
        d.close();
        opened = null;
      };
      resolve(d);
    };
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
  }));
}

/** The connection was closed or lost under us (app was in the background): worth one more try on a new one. */
const lostConnection = (e) =>
  e?.name === 'InvalidStateError' || e?.name === 'UnknownError' || /closing|closed|lost|connection/i.test(e?.message || '');

function attempt(d, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage full'));
  });
}

async function run(mode, fn) {
  try {
    return await attempt(await db(), mode, fn);
  } catch (e) {
    if (!lostConnection(e)) throw e;
    opened = null; // reopen and try once more
    return attempt(await db(), mode, fn);
  }
}

export const getBook = (id) => run('readonly', (s) => s.get(id));
export const putBook = (book) => run('readwrite', (s) => s.put(book));
export const deleteBook = (id) => run('readwrite', (s) => s.delete(id));

/** The library list, newest first, without the books' text. */
export async function listBooks() {
  const all = (await run('readonly', (s) => s.getAll())) || [];
  return all
    .map(({ blocks, ...rest }) => ({ ...rest, words: rest.words ?? 0, paras: blocks?.length || 0 }))
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
