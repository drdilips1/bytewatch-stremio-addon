# Audibrisk

Search any audiobook and play it: streamed through your TorBox or Real-Debrid, or saved for offline.
Covers and details come by themselves (Audible's catalogue). Settings: TorBox, Real-Debrid,
AllDebrid, Premiumize (any or all), a folder on the phone, and a folded Sources list. Free LibriVox books play without any key.

- Screens and look: `brisk/` — one screen (greeting, search, Continue listening, Your library),
  book page, player (Speed · Sleep · More), settings sheet; light / dark / auto and a scene dice. Player engine, downloads and debrid code are Audiohub's own (`src/`).
- Sources: `brisk/audio-sources.json` — AudiobookBay and Knaben AudioBooks from the public worker
  (sources.booksources.workers.dev) and Deep Search (Ink & Echo's search, renamed; id unchanged). Kept in step on every start;
  ids under `retired` are removed from existing installs by themselves. Plus LibriVox (free).
- Play picks the best copy: ready-to-stream on your debrid first, then M4B, then seeds.
  The book page shows the copies as small boxes (Instant, or seeds · size · format) to pick by hand.
- Build: a commit with `[build brisk]` in its message. Releases: pre-releases tagged `audibrisk-v…`.
- Icons / splash: `node brisk/make-icons.mjs` → `brisk/android-res/`.
- Pure rules in `brisk/logic.js`, tested by `brisk/brisk.test.js` (part of `npm test`).
