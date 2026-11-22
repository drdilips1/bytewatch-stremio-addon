// Audibrisk: search and play — its own screens, sharing the player, downloads and debrid code
// with Audiohub. Build: npx vite build --config vite.brisk.config.js  →  dist-brisk/
//
// Audibrisk can be shared publicly, so its build leaves out what only Audiohub+ has: Mobilism,
// Libby / OverDrive, Anna's Archive, Bookshare, the tracker (MyAnonamouse / qBittorrent) code and
// the personal sync / quote-share servers. Those modules are swapped for empty stand-ins with the
// same names (Audibrisk never opens them), the built-in source files point at the public worker,
// and the build fails if any of those names is still in the app. Shared code is not changed.
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = (p) => path.join(here, 'src', p);

// Whole modules left out (replaced by stand-ins that export the same names, doing nothing).
const LEFT_OUT = [
  'sources/mobilism.js',
  'sources/libby.js',
  'sources/annas.js',
  'sources/bookshare.js',
  'sources/qbit.js',
  'lib/cfsync.js',
  'lib/sync.js',
  'lib/quoteshare.js',
  'components/source-results.jsx',
  'components/libby-card.jsx',
  'components/libby-settings.jsx',
  'screens/Tracker.jsx',
  'sources/storyshots.js', // reads a list from Audiohub's own pages
].map(src);

// Built-in source files: the public worker's versions instead of the personal worker's.
const PUBLIC = 'https://sources.booksources.workers.dev';
const publicSource = (id, name, kind, url) => ({
  schemaVersion: '1.0.0',
  id,
  name,
  version: '1.0.0',
  provides: ['source'],
  contentType: kind,
  adapters: { source: { request: { method: 'GET', url, timeout: 30000, headers: { Accept: 'application/json' } }, response: { type: 'json', resultsPath: 'hits', mapping: { title: 'title', magnetUrl: 'magnetUrl', infoHash: 'hash', sizeBytes: 'bytes', seeders: 'seeders', date: 'date' } } } },
});
const BUILTIN_JSON = {
  [src('sources/builtin/audiobookbay.json')]: () => JSON.parse(fs.readFileSync(path.join(here, 'brisk/audio-sources.json'), 'utf8')).addons.find((a) => a.id === 'public-audiobookbay'),
  [src('sources/builtin/knaben-audiobooks.json')]: () => publicSource('public-knaben-audiobooks', 'Knaben AudioBooks', 'audiobook', `${PUBLIC}/knaben/audiobooks?q={TITLE}`),
  [src('sources/builtin/knaben-ebooks.json')]: () => publicSource('public-knaben-ebooks', 'Knaben Ebooks', 'ebook', `${PUBLIC}/knaben/ebooks?q={TITLE}`),
};

// Small text changes in shared files that stay in (the code works the same without these).
const EDITS = {
  [src('sources/sourceaddons.js')]: [
    [/https:\/\/api\.audiohubapp\.com\/addons\//g, `${PUBLIC}/addons/`],
    [/'mobilism'/g, "'x-m'"],
    [/'annas'/g, "'x-a'"],
    [/'bookshare'/g, "'x-b'"],
    [/Mobilism/g, 'Mx'],
    [/Bookshare/g, 'Bx'],
  ],
  [src('lib/http.js')]: [[/sentry\\\.libbyapp\\\.com\|thunder\\\.api\\\.overdrive\\\.com\|/g, '']],
  [src('lib/epub.js')]: [[/bookshare/gi, 'xb']],
  [src('lib/unpack.js')]: [[/mobilism/gi, 'xm']],
  [src('lib/getplay.js')]: [[/myanonamouse/gi, 'xmam']],
  [src('sources/addons.js')]: [[/mobilism/gi, 'xm']],
  [src('lib/ai.js')]: [[/https:\/\/drdilips1\.github\.io\/bytewatch-stremio-addon\//g, 'https://github.com/']],
  // Links to the private repository: the public Audibrisk repository instead.
  [src('lib/report.js')]: [[/drdilips1\/bytewatch-stremio-addon/g, 'drdilips1/audibrisk']],
  [src('lib/transcript.js')]: [[/drdilips1\/bytewatch-stremio-addon/g, 'drdilips1/audibrisk']],
};

// The stand-in for a left-out module: every name it exported, as something harmless.
function standIn(file) {
  const code = fs.readFileSync(file, 'utf8');
  const names = new Set();
  const stores = new Set();
  const fns = new Map(); // name -> async?
  for (const m of code.matchAll(/^export\s+(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) fns.set(m[2], !!m[1]);
  for (const m of code.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(persisted\()?/gm)) (m[2] ? stores : names).add(m[1]);
  for (const m of code.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(',')) {
    const n = part.trim().split(/\s+as\s+/).pop();
    if (n && n !== 'default') names.add(n);
  }
  const lines = ['const store = { get: () => ({}), set() {}, patch() {}, subscribe: () => () => {} };', 'const none = () => null;'];
  for (const [n, isAsync] of fns) lines.push(isAsync ? `export async function ${n}() { return null; }` : `export function ${n}() { return null; }`);
  for (const n of stores) lines.push(`export const ${n} = store;`);
  for (const n of names) if (!fns.has(n) && !stores.has(n)) lines.push(`export const ${n} = /^[A-Z][a-z]/.test('${n}') ? none : null;`);
  if (/^export\s+default/m.test(code)) lines.push('export default none;');
  return lines.join('\n');
}

// (An empty stand-in may keep an old function name such as trackerSearchUrl; the code behind it is gone.)
const BANNED = /myanonamouse|mam_id|mobilism|libbyapp|overdrive|annas-archive|bookshare|audiohubapp|drdilipgreat|bytewatch-stremio-addon/i;

function publicOnly() {
  return {
    name: 'audibrisk-public-only',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (LEFT_OUT.includes(file)) return standIn(file);
      if (BUILTIN_JSON[file]) return JSON.stringify(BUILTIN_JSON[file]());
      const edits = EDITS[file];
      if (edits) {
        let code = fs.readFileSync(file, 'utf8');
        for (const [from, to] of edits) code = code.replace(from, to);
        return code;
      }
      return null;
    },
    // The finished app must not mention any of them.
    generateBundle(_, bundle) {
      const found = [];
      for (const [name, chunk] of Object.entries(bundle)) {
        const text = chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : '';
        const m = BANNED.exec(text);
        if (m) found.push(`${name}: "${text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ')}"`);
      }
      if (found.length) this.error(`Audibrisk must not contain these (public build):\n${found.join('\n')}`);
    },
  };
}

export default defineConfig({
  plugins: [publicOnly(), preact()],
  // No relay: Audiohub's relay is a personal server (it would carry everyone's requests, debrid
  // keys included). Audibrisk asks every site straight from the phone.
  define: {
    'import.meta.env.VITE_RELAY_URL': '""',
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
  },
  root: fileURLToPath(new URL('./brisk', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist-brisk', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      // File names without module names (no "mobilism-….js" stand-in files in the app).
      output: { chunkFileNames: 'assets/[hash].js', entryFileNames: 'assets/[hash].js', assetFileNames: (a) => (/\.mjs$/.test(a.names?.[0] || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') },
    },
  },
});
