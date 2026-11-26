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
- Build: a commit with `[build brisk]` in its message → a private test pre-release `audibrisk-v…`.
  `[release brisk]` also publishes it in the public repo drdilips1/audibrisk (in-app updates read
  that; needs the AUDIBRISK_PUBLIC_TOKEN secret).
- Public-safe: `vite.brisk.config.js` leaves out Audiohub+-only code (Mobilism, Libby, Anna's,
  Bookshare, tracker, personal sync/relay) and fails the build if any of it is left;
  `rebrand.mjs` + `publicjava.mjs` do the same for the Android side in CI.
- Icons / splash: `node brisk/make-icons.mjs` → `brisk/android-res/`.
- Pure rules in `brisk/logic.js`, tested by `brisk/brisk.test.js` (part of `npm test`).
- v1.0.9: first public-safe build (stripped code, in-app updates from drdilips1/audibrisk).
- v1.0.10: first public release (drdilips1/audibrisk) — free books in the top 10, Deep Search follows your service.
- v1.0.11: ready before you tap, what worked ranks first, next in series + Get ready, chapter names for multi-file copies, Ready to play now.
- iPhone: built in the public repo drdilips1/audibrisk from a kit (brisk/ios-kit), AltStore source on its Releases page.
- v1.0.12: Audible ratings, faster search with your own books first, catalogue covers for cloud books, Find cover.
- v1.0.15: the premium redesign (champagne, Midnight, new Now Playing, nine scenes, library sort/list), What's new card, Report a problem.
- v1.0.16: dice changes the whole look, Dream mode, bookmark notes, Want to listen / Finished, 0.5–3× speeds, listening line, Back up / Restore.
