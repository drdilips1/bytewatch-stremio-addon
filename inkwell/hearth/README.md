# Hearth

A calm, private library for the books you already have — on the phone, your Audiobookshelf,
TorBox and Real-Debrid — with a plain player and reader. No sources, no AI.

- Screens: `hearth/` (Home, Library, book page, player, Settings); the player, reader and the
  connections are Audiohub's own (`src/`).
- Build: a commit with `[build hearth]` in its message (or Actions → Hearth Android APK → Run
  workflow once it's on the main branch). Releases: pre-releases tagged `hearth-v…`.
- Icons / splash: `node hearth/make-icons.mjs` → `hearth/android-res/`.
- Try it in a browser: `npx vite build --config vite.hearth.config.js && npx vite preview --config vite.hearth.config.js`.

- v1.0.2: themes + dice, made covers, chapters and bookmarks on the book page, ebooks open.
