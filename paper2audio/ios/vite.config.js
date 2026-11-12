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
  resolve: {
    alias: {
      '@capacitor/core': rw('src/shims/capacitor.js'),
      preact: rw('node_modules/preact'),
    },
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
