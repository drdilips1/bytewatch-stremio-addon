# Audibrisk (minimal search & play)

- Code: `inkwell/brisk/` (screens.jsx, player.jsx, books.js, logic.js, scenes.jsx, brisk.css, app.jsx),
  config `inkwell/vite.brisk.config.js`, workflow `.github/workflows/brisk-apk.yml`.
  Tests: `inkwell/brisk/brisk.test.js` (runs in `npm test`). The shared eslint config only covers
  `src/`; lint brisk with a temp copy of it that adds `brisk/**/*.{js,jsx}` (clean as of v1.0.6).
- Build: a commit touching `inkwell/brisk/` with `[build brisk]` in the message (no `[skip ci]`).
  Releases `audibrisk-v1.0.N` (pre-releases, private repo — not downloadable by others yet).
- v1.0.5 — calm cream/sage look (lake scene, "Less app. More listening."), Home / Library /
  Downloads tabs, own TorBox/RD cloud first, RAR/ZIP copies skipped, tidied titles.
- v1.0.6 (21 Nov, building) — user's feedback list:
  - Sources: `audio-sources.json` = public worker (sources.booksources.workers.dev) AudiobookBay
    (`public-audiobookbay`) + Knaben AudioBooks (`public-knaben-audiobooks`) + Ink & Echo.
    `retired` ids (my-audiobookbay, my-knaben-audiobooks, extto-audiohub,
    rutracker-english-audiobooks) are dropped from existing installs; bundled manifests replace
    installed ones on every start (`syncSources` in logic.js).
  - LibriVox in search (shared `src/sources/librivox.js`, used read-only), "Free" tag, plays and
    saves with no debrid; listed first when no debrid is connected.
  - Search: Audible relevance + best sellers for the same words, ranked so the word itself in the
    title comes first ("everyday" → The Design of Everyday Things) — `rankResults`.
  - Book page: copies as small boxes (⚡ Instant, or seeds · size · format; no site names), one
    status line that always says where it will play from (phone / your cloud / copies / still
    looking — fixes "no copy found" while your cloud copy plays), % while your service fetches.
  - Not-cached copies: kept as background jobs (`briskJobs`), checked every 20 s, card on Home with
    %, "Ready to play" toast (Android pop-up when the app is in the background). A real
    notification-shade notification needs shared Android code — asked the user, not done.
  - TorBox and Real-Debrid both at once (copy ready on either plays; Library shows both clouds).
  - Folder on this phone (Settings): phone copy plays first, Save hidden when it's on the phone,
    Library → On this phone. Uses shared `src/sources/local.js` read-only.
  - Player: chapter + time left in the whole book (mini and full). 5 s back after any audio
    interruption, even short notification sounds (shared resume.js skips pauses < 1.5 s); never
    doubles the shared rewind (`backAfterInterruption`).
  - Speed: no backdrop blur on tab bar / mini player, lighter cover glow, touch-action
    manipulation, keyboard hides when results are touched (taps no longer lost), Play no longer
    waits for the whole cloud library, covers fixed (a failed cover no longer blocks a later good
    one; missing covers looked up 4 at a time like the book page does — `briskCovers`).
  - Theme dice in the header: sunrise lake, sunset sea, night sky, meadow, mountains (drawn SVG).
- Not Audibrisk (noted for Audiohub+): user asks for Mobilism as an in-app username/password login
  that re-logs in by itself when the site logs out, opening the website only if that fails.
- Pending / ideas: optional "Add your own source link" under Settings (recommended: keep built-in
  sources, offer adding one as an advanced option); public release link; notification-shade alert.
