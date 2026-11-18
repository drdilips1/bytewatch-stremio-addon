// Audibrisk: search and play — its own screens, sharing the player, downloads and debrid code
// with Audiohub. Build: npx vite build --config vite.brisk.config.js  →  dist-brisk/
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [preact()],
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
      output: { assetFileNames: (a) => (/\.mjs$/.test(a.names?.[0] || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') },
    },
  },
});
