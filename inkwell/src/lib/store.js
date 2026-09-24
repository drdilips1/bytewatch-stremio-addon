import { useEffect, useState } from 'preact/hooks';

// Tiny persistent reactive store backed by localStorage.
export function persisted(key, initial) {
  let value = initial;
  try {
    const raw = localStorage.getItem('inkwell:' + key);
    if (raw) value = mergeDefaults(initial, JSON.parse(raw));
  } catch {}
  const subs = new Set();
  let saveTimer;
  const store = {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? next(value) : next;
      subs.forEach((f) => f(value));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem('inkwell:' + key, JSON.stringify(value));
        } catch {}
      }, 150);
    },
    patch(part) {
      store.set((v) => ({ ...v, ...part }));
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
  return store;
}

function mergeDefaults(initial, saved) {
  if (initial && typeof initial === 'object' && !Array.isArray(initial) && saved && typeof saved === 'object') {
    const out = { ...initial, ...saved };
    for (const k of Object.keys(initial)) {
      const d = initial[k];
      if (d && typeof d === 'object' && !Array.isArray(d) && saved[k] && typeof saved[k] === 'object') out[k] = { ...d, ...saved[k] };
    }
    return out;
  }
  return saved;
}

export function useStore(store) {
  const [v, setV] = useState(store.get());
  useEffect(() => store.subscribe(setV), [store]);
  return v;
}

export const settings = persisted('settings', {
  mode: 'dark', // dark | light | amoled
  accent: 'aurora',
  dynamicColor: true,
  skipBack: 15,
  skipForward: 30,
  speed: 1,
  sources: { ia: true, lv: true, gb: true, ol: true, abs: true, addons: true, tb: true, rd: true, hc: true, gr: true },
  readerSize: 19,
  readerTheme: 'night', // night | sepia | paper | amoled
  readerFont: 'serif',
  language: 'en',
});

export const library = persisted('library', {}); // uid -> book summary + addedAt
export const progress = persisted('progress', {}); // uid -> { track, time, duration, percent, finished, updatedAt, book, kind }
export const bookmarks = persisted('bookmarks', {}); // uid -> [{ track, time, label, createdAt }]
export const addons = persisted('addons', []); // [{ url, manifest }]
export const abs = persisted('abs', { server: '', token: '', refreshToken: '', username: '', libraryId: '' });

export function summarize(book) {
  const { uid, source, kind, title, author, cover, year, duration } = book;
  return { uid, source, kind, title, author, cover, year, duration };
}

export function toggleLibrary(book) {
  library.set((lib) => {
    const next = { ...lib };
    if (next[book.uid]) delete next[book.uid];
    else next[book.uid] = { ...summarize(book), addedAt: Date.now() };
    return next;
  });
}

export function exportBackup() {
  return JSON.stringify(
    {
      app: 'inkwell',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings.get(),
      library: library.get(),
      progress: progress.get(),
      bookmarks: bookmarks.get(),
      addons: addons.get(),
    },
    null,
    2
  );
}

export function importBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'inkwell') throw new Error('Not an Inkwell backup file');
  if (data.settings) settings.set({ ...settings.get(), ...data.settings });
  if (data.library) library.set({ ...library.get(), ...data.library });
  if (data.progress) progress.set({ ...progress.get(), ...data.progress });
  if (data.bookmarks) bookmarks.set({ ...bookmarks.get(), ...data.bookmarks });
  if (Array.isArray(data.addons)) addons.set(data.addons);
}

export const debrid = persisted('debrid', { torbox: '', realdebrid: '' });
export const hardcover = persisted('hardcover', { token: '', username: '' });
export const goodreads = persisted('goodreads', { books: [], importedAt: 0 });
