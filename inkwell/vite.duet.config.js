// Duet: an audiobook player for your own books (this phone and your Audiobookshelf) with
// read-along — its own screens, sharing the player, reader and connections with Audiohub.
// No sources, no debrid: the store-safe app. Build: npx vite build --config vite.duet.config.js  →  dist-duet/
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [preact()],
  root: fileURLToPath(new URL('./duet', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist-duet', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: { assetFileNames: (a) => (/\.mjs$/.test(a.names?.[0] || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') },
    },
  },
});
