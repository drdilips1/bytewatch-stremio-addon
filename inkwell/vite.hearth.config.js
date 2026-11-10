// Hearth: a calm, private library of the books you already have (phone, Audiobookshelf,
// TorBox, Real-Debrid) — its own screens, sharing the player, reader and connections with
// Audiohub. Build: npx vite build --config vite.hearth.config.js  →  dist-hearth/
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [preact()],
  root: fileURLToPath(new URL('./hearth', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist-hearth', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: { assetFileNames: (a) => (/\.mjs$/.test(a.names?.[0] || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') },
    },
  },
});
