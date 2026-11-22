# Audibrisk (minimal search & play)

- Code: `inkwell/brisk/` (screens.jsx, player.jsx, books.js, logic.js, scenes.jsx, brisk.css, app.jsx),
  config `inkwell/vite.brisk.config.js`, workflow `.github/workflows/brisk-apk.yml`.
  Tests: `inkwell/brisk/brisk.test.js` (runs in `npm test`). The shared eslint config only covers
  `src/`; lint brisk with a temp copy of it that adds `brisk/**/*.{js,jsx}` (clean as of v1.0.6).
- Build: a commit touching `inkwell/brisk/` with `[build brisk]` in the message (no `[skip ci]`).
  Releases `audibrisk-v1.0.N` (pre-releases, private repo — not downloadable by others yet).
- v1.0.5 — calm cream/sage look (lake scene, "Less app. More listening."), Home / Library /
  Downloads tabs, own TorBox/RD cloud first, RAR/ZIP copies skipped, tidied titles.
- v1.0.6 (21 Nov, released: https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.6) — user’s feedback list:
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
    notification-shade notification needs shared Android code — user said avoid for now (21 Nov).
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
- v1.0.7 (22 Nov) — fix: v1.0.6 froze taps for ~15 min on a big cloud library. Cause: cover
  finder looked up every cloud book at once (filled the shared meta lookup queue — 3 slots — that
  opening a book also waits on) and each found cover redrew Home + the whole Library grid. Now:
  covers one at a time, 2.5 s apart, max 24 a session, paused while a book opens, saved in batches
  of 4; Home doesn't redraw for covers; grids show 30 then "Show all"; Play/resume call
  getDetails with `{ fast: true }` (never wait for a lookup); cloud library re-read at most every
  5 min (was on every Home/Library visit after 60 s).
- v1.0.8 (22 Nov, released: https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.8):
  - Light / Dark / Auto (Settings, top). All colours are CSS variables on :root; `data-mode` and
    `data-scene` on <html> (scenes.jsx `watchLook`/`applyLook`); each dice scene tints the colours
    (sunrise sage, sunset terracotta, night indigo, meadow green, mountains slate); dark = warm
    charcoal, scene picture dimmed; status bar follows.
  - Speed: thumbnails ask Audible/Apple for small pictures (`thumb` in logic.js: 120–320 px instead
    of 500); a Library/Continue tap shows a spinner at once and plays (covers pause meanwhile);
    the book already in the player opens straight away; press feedback on every tap.
  - Logo: user chose B — a play button with speed lines. Header `Logo` (screens.jsx) and app
    icon / splash (make-icons.mjs: cream mark on a sage gradient) done.
  - Library / Downloads covers carry a small label saying where the book plays from: TorBox,
    Real-Debrid, Phone, Saved (downloaded here — wins), Free (`placeOf` in logic.js).
  - One screen, no tabs (app.jsx): greeting ("Good morning" by the clock) + "What shall we listen
    to?", search, Continue listening, Your library (`YourLibrary` in screens.jsx: saved + cloud +
    phone books in one grid with labels and filter chips when there's more than one kind).
  - Player: main row Speed · Sleep · More; More sheet = chapters, bookmarks, bookmark this moment,
    skip silence, volume boost (shared `player.setAudio`, kept per book).
  - Settings → Sources (folded): switch built-in/own sources off (`briskSourcesOff`, passed as
    `only` to shared searchSources), paste a link to add your own (shared addons.install;
    catalogue-only addons removed again), Remove for your own.
  - AllDebrid and Premiumize as extra services (shared moredebrid.js), behind "AllDebrid or
    Premiumize?" in Settings; labels AllDebrid / Premiumize.
  - Not done (need shared Android code — ask first): overnight downloads on Wi-Fi + charging;
    check Android Auto shows Audibrisk's library.
- Next (committed, not built): Skip credits switch in the player's More menu (settings.skipCredits,
  on by default since first start; shared player skips chapters titled Opening/End Credits,
  Publisher's intro… once, with a toast).
- Next (committed, not built): Ink & Echo shown as "Deep Search" (name/description only; id
  `inkandecho-v2-bestsearch-audiobook` kept so installs update by themselves). The old `client=ie_bbb06…` was
  the user's own (a fresh build gave a different one), so Deep Search now uses the user's new public
  link (provider.json v1.0.7, `client=ie_50d19612…`, made in a private window for public use).
  Checked live 22 Nov: Deep Search, AudiobookBay and Knaben all answer. (Audiohub+'s built-in
  Ink & Echo files in shared src/ still carry the old personal id — not touched, Audiohub+ window.)
  This repo's cloud environment now allows inkandecho-builder.pages.dev and
  sources.booksources.workers.dev.
- Public-safe build (22 Nov, built OK as v1.0.9 test: https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.9 — stripped Android code compiled) — `inkwell/vite.brisk.config.js` plugin
  `audibrisk-public-only`: Mobilism, Libby, Anna's, Bookshare, qbit/tracker, cfsync/sync,
  quoteshare, source-results, libby cards, Tracker screen, storyshots → generated stand-ins (same
  export names, do nothing); built-in source JSONs → public worker versions; small text edits
  (sourceaddons specials, http.js Libby/OverDrive relay hosts, report/transcript links →
  drdilips1/audibrisk); relay + Supabase env blanked (no personal relay for public users); hashed
  chunk names; the build FAILS if any banned word is left (myanonamouse, mam_id, mobilism,
  libbyapp, overdrive, annas-archive, bookshare, audiohubapp, drdilipgreat,
  bytewatch-stremio-addon). Android side: `brisk/rebrand.mjs` (CI copy only) empties
  trackerSearch/trackerGrab/trackerFetch/bookshareGet(→siteBookGet)/qbitSend and blanks site names
  (`brisk/publicjava.mjs`, tested), and fails if any is left. javac syntax check: no new errors.
- In-app update (A, the user's go-ahead): `brisk/update.js` reads the PUBLIC repo
  drdilips1/audibrisk (releases/latest), downloads in the app with % via the shared InkwellUpdate
  plugin, asks once for "install unknown apps", installs; Settings row Check → Update now.
  Workflow: `[build brisk]` = private test pre-release as before; `[release brisk]` = also publish
  `v1.0.N` (latest) in drdilips1/audibrisk — needs secret AUDIBRISK_PUBLIC_TOKEN (else a warning).
  Public repo drdilips1/audibrisk and secret AUDIBRISK_PUBLIC_TOKEN set up by the user (22 Nov).
- In v1.0.10: free LibriVox books inside the top 10 (3rd and 7th, rest at the
  end; all first without debrid) — `mixFree`; Deep Search follows the connected service
  (`deepSearchFor`: Real-Debrid when it's yours and TorBox isn't connected, else TorBox; Ink & Echo
  knows only these two — its builder gives TorBox for AllDebrid/Premiumize), re-set on
  connect/disconnect. Checked live: the Real-Debrid search answers.
- v1.0.10 (22 Nov) — FIRST PUBLIC RELEASE: run 10 built and published to drdilips1/audibrisk
  (tag v1.0.10, latest). Public link https://github.com/drdilips1/audibrisk/releases/latest — APK
  download checked (200, 18 MB). Installs on v1.0.9 or older must install it by hand once (they
  looked at the private repo); from v1.0.10 on, Settings → Update now. Reddit post text given to
  the user (r/RealDebrid, r/TorBox, r/Piracy; check each sub's rules).
- Next (committed, not built): when a copy won't play (e.g. RD "HTTP 503 — hoster_unavailable"):
  player shows "Try another copy" under the error → book page with `fresh` (searches copies even
  when the book already has one); long-press a library cover / Continue card → Play · Find other
  copies · Book page (`holdProps`/`HoldSheet` in screens.jsx); book page always offers "Find other
  copies"; picking a copy carries your place over (`play(..., { percent })` → shared playBook percent).
- Next (committed, not built): mini player shows × instead of back-15 when nothing is playing →
  shared `player.stop()` (saves place, clears the book; it stays under Continue listening).
- Next (committed, not built): automatic fallback — `watchFailures` (books.js, started in main.jsx)
  watches the player; when a cloud copy (tb/rd/ad/pm) errors, it finds the copies again (catalogue
  book via `links` when known), and plays the next one that gets ready (`rescueOrder`: not tried,
  instant first, ≤4; same RD/TB id = skipped), carrying the percent. Toasts "trying another…" /
  "Playing another copy"; only if none works the error stays (with "Try another copy"). Not
  testable here without a real failing copy — check on the phone.
- v1.0.11 (22 Nov, built OK, private test: https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.11) — user's "1 to 4":
  - Ready before you tap: `prewarm`/`warmed` (books.js) fetch the playable details of the first
    Continue book (Home, after 2.5 s) and of an open book page with a known copy; prepare/resume
    use them (10 min). NOT done: download-ahead while listening (needs shared native player buffer
    change — ask the user/Audiohub+ window first).
  - What worked: `briskHealth` (copies/sources ok/fail counts, uid → copy); `rank` adds
    `healthBonus`; failures noted in ready() and when a playing copy errors.
  - Endings: `watchEndings` → `upNext` (next in series via Audible: seriesOf/nextInSeries) shown on
    Home and in the player (`UpNext`): Get ready · Play. "Get ready" on book pages (`getReady` =
    prepare without playing; pending → background job with %).
  - Chapter names for "Track 01…" multi-file copies: Audnexus chapters by the catalogue ASIN
    (`briskChapters` cache) → `applyChapters` (same count → file names; else time marks when
    lengths match within 8%); applied before play (≤1.2 s wait) or later via player.patchBook.
  - Ready to play now: `findReadyNow` daily (20 s after start, slow, pauses while busy): Audible
    best sellers whose copies are instant on your service (TorBox mostly — RD has no instant
    flags) → row on Home (≥2 books), tap plays.
  - Also in this build: automatic copy fallback, Try another copy, long-press menu, × on the strip.
- Not Audibrisk (noted for Audiohub+): user asks for Mobilism as an in-app username/password login
  that re-logs in by itself when the site logs out, opening the website only if that fails.
- Pending / ideas: optional "Add your own source link" under Settings (recommended: keep built-in
  sources, offer adding one as an advanced option); public release link; notification-shade alert (on hold — user said avoid for now).
