# Audibrisk

Search any audiobook and play it: streamed through your TorBox or Real-Debrid, or saved for offline.
Covers and details come by themselves (Audible's catalogue); the only setting is your debrid key.

- Screens and look: `brisk/` (Home with search, Continue and On this phone; book page; player;
  settings sheet). Player engine, downloads and debrid code are Audiohub's own (`src/`).
- Sources: the audio-only addons in `brisk/audio-sources.json` (AudiobookBay, Knaben AudioBooks,
  EXTto, RuTracker English Audiobooks, Ink & Echo Audiobooks), installed quietly on first open.
  The same file installs in Audiohub/AudioYam as one addon collection.
- Play picks the best copy: ready-to-stream on your debrid first, then M4B, then seeds.
  "Choose another copy" on the book page lists the rest.
- Build: a commit with `[build brisk]` in its message. Releases: pre-releases tagged `audibrisk-v…`.
- Icons / splash: `node brisk/make-icons.mjs` → `brisk/android-res/`.
