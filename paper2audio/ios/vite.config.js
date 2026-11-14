import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

// The iPhone app is two pages: the library (index.html) and the reader (reader.html), which is the
// Android app's reader (../reader-web) unchanged. Its Vite, Preact and fonts come from reader-web's
// node_modules, so both pages share one copy of each.
const rw = (p) => fileURLToPath(new URL('../reader-web/' + p, import.meta.url));

export default defineConfig({
  plugins: [preact()],
  base: './',
  // The build's version, shown in Settings (set by the iPhone build on GitHub).
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || '') },
  resolve: {
    // Exactly "@capacitor/core" is the reader's bridge to "the app"; the iPhone's own plugin calls use the real
    // Capacitor (src/host.js imports it by its file path, which this doesn't match).
    alias: [
      { find: /^@capacitor\/core$/, replacement: rw('src/shims/capacitor.js') },
      { find: 'preact', replacement: rw('node_modules/preact') },
    ],
  },
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        reader: fileURLToPath(new URL('./reader.html', import.meta.url)),
      },
    },
  },
});
