import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

// Built into the Android app's assets (committed, so the app's build needs no Node).
export default defineConfig({
  plugins: [preact()],
  base: './',
  resolve: { alias: { '@capacitor/core': fileURLToPath(new URL('./src/shims/capacitor.js', import.meta.url)) } },
  build: {
    outDir: '../android/app/src/main/assets/reader',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});
