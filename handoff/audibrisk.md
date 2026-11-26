# Audibrisk (minimal search & play)

- iPhone LEFT OUT (user, 24 Nov): don't build or check the iPhone app unless the user asks again
  (no `[build brisk ios]` in commits). Its 24 Nov kit had already gone to the public repo.
- iPhone: private Mac minutes ran out (first run 23 Nov queued 15 min, cancelled, never started),
  so the IPA is built in the PUBLIC repo drdilips1/audibrisk (free Mac runners), source stays
  private. `.github/workflows/brisk-ios.yml` (Linux; Run workflow or `[build brisk ios]`) builds
  dist-brisk with the public-only check, packs the kit (`brisk/ios-kit/make-kit.mjs`: screens,
  capacitor.config, ios-plugins player + files, icon, VERSION, package.json with the same Capacitor
  versions, and `brisk/ios-kit/ios.yml` as the public repo's workflow; fails on banned words) and
  force-pushes it to the public repo's branch `ios-kit`; that repo's workflow (macos-15) makes
  Audibrisk.ipa → pre-release `ios-<version>` (never latest) + AltStore source
  https://github.com/drdilips1/audibrisk/releases/download/altstore/altstore.json. Kit tested on
  Linux (npm install + cap add ios → 6 plugins). Token has Contents + Workflows (user, 23 Nov).
  FIRST IPA OK (23 Nov): kit run #2 → public Mac build → release ios-1.0.2
  https://github.com/drdilips1/audibrisk/releases/download/ios-1.0.2/Audibrisk.ipa (1.5 MB) and the
  AltStore source above (both checked 200). This session can't read the public repo's logs (not
  attached) — ask the user to paste errors from github.com/drdilips1/audibrisk/actions. No Save on iPhone (shared downloads are
  Android-only); Settings says updates come through AltStore.
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
- v1.0.14 (24 Nov, built OK as Android private test — run 14, https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.14 ; called "v1.0.12" in the README line; iPhone left out — user: "Audible rating and my fixes, then build; see you
  Saturday"): Audible rating (`fmtRating`) on results and the book page (no Goodreads: slow and
  blocked); search shows Audible's results as soon as they come (`searchBooks(term, onFirst)`,
  250 ms wait), "In your library" matches first (`libraryMatches`, `MineInSearch`); covers for
  cloud books from the catalogue book they were played as (`linkCover`), cover look-ups up to 60 a
  session and each retried after a day (`briskCoverTried`); long-press → "Find cover"
  (`CoverSheet`, shared searchCovers → setFix). NOT done: iPhone downloads (needs a new shared
  Swift plugin — can't compile/test it here or read the public repo's logs).
- Redesign IN PROGRESS (26 Nov, not built). User: no Ivory (light = the warm cream look, now with
  champagne), keep the scenes and add more, champagne everywhere. DONE steps 1–2: tokens renamed
  --b-sage → --b-acc/--b-acc2 + --b-on-acc; dark = Midnight; per-scene colour tints removed;
  champagne gradient on play buttons / chips / segments / progress; Now Playing glow from the cover
  colour (champagne when no cover), 26px artwork, glowing progress, halo play button; frosted mini
  player; reduced-motion respected. Scenes +4: autumn, dunes, aurora, blossom (9 in all).
  DONE steps 3–5 (26 Nov): Continue card bigger (serif title, 100px cover); Your library: sort
  (Recent / Title / Author / Series — `sortBooks`) and grid/list switch, kept in `briskLibView`;
  Settings grouped (Appearance / Listening services / Folder on this phone / About) with uppercase
  champagne headings; sheets with a handle and a soft spring; pages ease in, covers fade in on
  load, small vibration on the big play button. Not built yet. Earlier plan: Two themes: Ivory (#F5F3EE / white / #202630 / accent #9C8055) as the
  default, Midnight (#0B1018 / #151E2B / #F4F2ED / champagne #D6BD91) for dark; champagne play
  button with glow, ambient cover-colour light on Now Playing, thin glowing progress, Continue
  hero card, glass only on the small floating mini player. Keep: one screen (no bottom tabs /
  Library tab / Discover), no blur on scrolling surfaces (v1.0.7 taps), no queue (Audibrisk has
  none), haptics via navigator.vibrate. Files: brisk/brisk.css (tokens + all surfaces),
  scenes.jsx (themes: Ivory/Midnight + Auto; scenes become optional), player.jsx (Now Playing +
  mini), screens.jsx (Home hero, library grid/list + sort, settings groups), app.jsx (page
  transitions). Open questions to the user: Ivory default?; keep the dice scenes?; sage → champagne.
- v1.0.15 BUILT OK (26 Nov, run 15, private test: https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/audibrisk-v1.0.15 — Android only): the redesign (steps 1–5) + "What's new"
  card (`brisk/whatsnew.js`: EDITION 1 + NEWS list, `briskSeenEdition`; fresh installs marked seen
  in main.jsx — bump EDITION for future news) + Settings → About → "Report a problem"
  (`reportUrl` in logic.js → github.com/drdilips1/audibrisk/issues/new, pre-filled with version,
  platform, service names, book, last error — never keys; reporters need a GitHub login).
- Personal sources (26 Nov): the user's EXTto / RuTracker stay OFF the public bundle (personal
  worker; the build bans audiohubapp). The user adds them on their own phone via Settings → Sources
  → paste: https://api.audiohubapp.com/addons/extto.json and …/addons/rutracker-audiobooks.json.
  `syncSources` now drops retired ids only for the app's own copies (no url), so pasted ones stay.
  Also (26 Nov, user asked): the personal worker `inkwell/workers/audiohub.js` (shared with
  Audiohub+) serves /addons/audiobooks.json — every audiobook addon on it (ABB, Knaben AudioBooks,
  EXTto, RuTracker; contentType audiobook, new ones join by themselves). Needs a redeploy (paste).
- NOTED, not built (24 Nov, user "just note"):
  - iPhone: Save / download for offline (needs a shared iOS downloads plugin — shared native code).
  - ChatGPT list — already in: one-tap resume, copy fallback keeping place, theme dice, chapters,
    continuity across files, sleep fade (shared player fades out). Worth doing: search your own
    library first (cloud/phone), shake to extend sleep, a small private "your listening" card
    (shared stats exist), playback-reliability check (resume after restart, expired links,
    file-to-file joins, Bluetooth/lock screen). Needs shared native: download-ahead cache, widget.
    Don't add: AI recommendations, podcasts, social, profiles, cloud accounts, discovery feeds.
  - Personality: user's/ChatGPT's "D" (elegant outside, capable engine) — keep the surface as
    plain as "C" (search, play, resume); extras only via long-press / More.
- Not Audibrisk (noted for Audiohub+): user asks for Mobilism as an in-app username/password login
  that re-logs in by itself when the site logs out, opening the website only if that fails.
- Pending / ideas: optional "Add your own source link" under Settings (recommended: keep built-in
  sources, offer adding one as an advanced option); public release link; notification-shade alert (on hold — user said avoid for now).
