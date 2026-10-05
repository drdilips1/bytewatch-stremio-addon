# DermScholar: handoff for a new session

Read this first, then `BACKLOG.md` (the roadmap with every request and its status).

## Working rules (from the owner)
- **Build only when the owner says "build now".** Otherwise commit with `[skip ci]` in the message and add the item to `BACKLOG.md`.
- Branch: `claude/dreamy-einstein-sphnl8` in `drdilips1/bytewatch-stremio-addon`. Pushing without `[skip ci]` triggers the CI build.
- After a build: download the APK from the GitHub release `dermscholar-<run number>` (REST: `gh api -H "Accept: application/octet-stream" repos/drdilips1/bytewatch-stremio-addon/releases/assets/<id>`). Attach it in chat if under 30 MB (it's ~25 MB), and also give the release link.
- Bump `versionCode` / `versionName` in `app/build.gradle` for every build. CI also publishes `dermscholar-latest` (APK + `version.json`), which the in-app updater reads.
- Commands given to the owner for their Mac Terminal must not contain `#` comment lines (zsh errors on them). Give one step at a time.
- Don't integrate Sci-Hub/LibGen (declined: copyright).
- Keep the Android app's structure as is. The web app must not remove features: what needs Android opens the website in a browser tab instead.

## Current state
- **Shipped: 5.7** (versionCode 35), release `dermscholar-44`, iPhone build `dermscholar-ios-3`: BACKLOG #52-#56 (JAAD Get PDF via ClinicalKey not MyLOFT, Open via R4L keeps the article link, meter reads all 20 papers with fairer No and Consensus-style counts/headline, explanation waits out AI per-minute limits, both AIs' errors shown). **Shipped: 5.8** (versionCode 36), release `dermscholar-45`, iPhone build `dermscholar-ios-4`: BACKLOG #57-#63 (full meter explanation without timers, per-AI usage, Gemini free-model switching, ClinicalKey via www.clinicalkey.com directly, wrong-PDF check and Remove this PDF, quick Get PDF failures, MyLOFT warm start and link/sign-in guidance). **Shipped: 5.9** (versionCode 37), release `dermscholar-46`, iPhone build `dermscholar-ios-5`; next build 5.10 / versionCode 38 (already bumped: BACKLOG #65, ClinicalKey PDF layout): BACKLOG #64 (two PDF buttons only, R4L loop cap, account in status, Details trail). Owner preference: no visible AI-limit/countdown messages; full Consensus-style explanation (second request, Gemini covers Groq limits). The owner keeps the "Open via R4L" name. Earlier, 5.6 contained: BACKLOG #48 Elsevier PDFs via ClinicalKey, #49 shared AI-planned search for the Evidence Map and Consensus meter (`planSearch`/`evidencePool` in intel.js), #50 Consensus-style explanation, #51 Word/slides export (`exportWord`/`exportSlides` in intel.js, libraries in `www/vendor/office`, bridge `Native.exportFile(name, base64, mime)` on Android and in web.js).
- **Web app for iPhone (BACKLOG #23), published** (owner approved): workflow `.github/workflows/dermscholar-web.yml` builds it on every push (not on `[skip ci]`) and force-pushes it to the `gh-pages` branch → https://drdilips1.github.io/bytewatch-stremio-addon/ . The owner's wife uses it with her own account.

## App architecture
Hybrid Android app: a WebView UI plus a Java bridge.
- Web UI: `app/src/main/assets/www/`
  - `app.js`: core (search, reader, library, journals, AI calls, TTS). Exports `window.DS`.
  - `studio.js`: AI studio, podcast, home quick row, settings, MyLOFT settings.
  - `intel.js`: Intel hub, evidence map, trials, guidelines, desk, "Where to read", MyLOFT flow and queue, PDF auto-matching. Exports `window.DSI`.
  - `intel2.js`: research projects, gaps, compare, drug dossier, image search (Open-i).
  - `intel3.js`: clinical summary card, alerts, living guidelines, SR kit (PRISMA, meta-analysis, forest plot), private cases, drug protocols, laser guide, CME log, conferences, who's who, knowledge map, photo search, reading lists.
  - `intel4.js`: evidence pyramid, citation graph (OpenAlex), pipeline tracker, histology side by side, richer photo search, Consensus meter.
  - `reflow.js`: PDF → mobile layout. Handles columns, manuscript line numbers, superscripts and neighbouring-article trimming (`trimToArticle`). Bump `REFLOW_V` in `app.js` when the layout logic changes.
  - `sync.js`: Supabase account and sync (`user_data` row "dermscholar"), and the update banner.
- Java: `app/src/main/java/org/research4life/portal/`
  - `MainActivity` (Bridge `Native`, events via `emit`)
  - `PdfFetcher`, `PdfStore` (incl. `rename`), `UtdClient`, `Updater`
  - AI providers: Groq, Gemini, Claude (with streaming)
  - Voices: `VoiceStore`, `NeuralEngine` (Kokoro HD)
- New screens: add the route to `ext.routes` and to `TAB_OF` in `app.js`. A new JS file also needs a `<script>` tag in `index.html` and an entry in the CI `node --check` list (`.github/workflows/research4life-apk.yml`).
- Web app (iPhone): `web/web.js` is loaded before `app.js` only in the web build and provides `window.WebNative`, which `app.js` merges into its browser `Native`. It covers AI (Groq/Gemini/Claude from the browser), PDFs in the Cache API (`reflow.openPdf` asks `WebNative.pdfBytes`; a `fetch` wrapper serves `/pdf/` and `/import/`), read aloud (speechSynthesis), voice input, file/photo picking, OCR via AI vision. Keys stay in `dsweb.*` localStorage (not synced). Build: `bash web/build.sh [out]`.
- iPhone app (`ios/`, BACKLOG #46): `MainViewController` hosts the web build (`www/`, made by `web/build.sh` in CI) at `dsapp://app/` via `LocalFiles` (also `/native/<id>` for files handed over and `/proxy?u=` for native fetches with the in-app browser's cookies). web.js detects `window.webkit.messageHandlers.ios` and sends `browse`, `share`, `copy`, `ready`, `done`; native answers with `WebNative.fromNative({type:'nativeFile',…})`. `BrowserViewController` is the in-app browser; PDFs opened in it are saved (automatically when opened for a paper's PDF). Unsigned .ipa from `.github/workflows/dermscholar-ios.yml`; the owner sideloads it (Sideloadly/AltStore, free Apple ID, 7-day refresh). Nothing compiled locally (no Xcode here): the first CI build is the compile check.
- Build triggers: the APK workflow ignores `web/` and `ios/`; web and iOS workflows ignore Android-only Java/res changes.
- Roadmap priority from the owner: C5/S1 deep review next.
- Testing: Playwright with mocked `fetch` and `window.__aiMock` (Chromium at `/opt/pw-browsers/chromium`). Serve `www/` over `python3 -m http.server` when a test needs `/pdf/...` or ES modules.

## Done so far (highlights by version)
- **≤4.x:**
  - Research4Life, UpToDate and MyLOFT access
  - Get PDF
  - Groq + Gemini AI keys
  - Account sync
  - In-app updates
  - Smaller APK
  - Dermatoscope icon
- **5.0:**
  - Full journal issues (Crossref)
  - DOI/PMID search
  - Home redesign
  - Pull to refresh
  - Streaming AI
  - HD voices
  - UpToDate sign-in and MyLOFT fixes
- **5.1 (Grok brief G1–G17):**
  - Derm filters
  - Clinical summary card + practice-changing flag
  - Alerts
  - Living guidelines
  - Citation styles (AMA/JAAD, BJD)
  - SR kit
  - Private case library
  - Drug protocols
  - Laser guide
  - CME log
  - Conference radar
  - Who's who
  - Knowledge map
  - Photo search
  - Reading lists
  - Tablet layout
- **5.2:** manuscript PDFs read cleanly (line numbers, superscripts, titles).
- **5.3 (Gemini "DermaSynth" brief M1–M5, plus fixes):**
  - Evidence pyramid
  - Citation graph with AI supports/contradicts
  - Pipeline tracker
  - Histology side by side
  - Richer photo search
  - MyLOFT one-tap send, MyLOFT queue, and PDFs auto-filed by their own DOI/title
  - Reader keeps only the opened article
  - Continue listening follows podcasts
  - Player clock ticks
- **5.4 (from Consensus, C1–C2):**
  - Consensus meter for yes/no questions
  - Quality badges: age-adjusted citations, N from the abstract, Human/Animal/In vitro
  - Code-review fixes (image viewer, stale results)

## Roadmap: still open
- **#45:** fixed, waiting for the next build (see above).
- **#42 (proposal, needs owner's OK):** AI tidy-up button for badly jumbled PDFs.
- **Consensus ideas, not scheduled:**
  - **C3:** more filters (humans only, min citations, sample size, top journals, country)
  - **C4:** study snapshot on result cards
  - **C5:** deep review (screens hundreds of papers → structured literature review)
- **Waiting on the owner:**
  - **#11:** exact error text where Research4Life/MyLOFT Get PDF stops
  - **#21:** where "The site returned 403" appears
  - **#33:** screenshot of ClinicalKey "login first" inside MyLOFT
- **Verify on the phone after the next build:**
  - Consensus meter "Is psoriasis an autoimmune disease?" should now lean Yes (Consensus showed 73% Yes)
  - Treatment evidence for acne should be free of side-effect papers
  - MyLOFT auto-filing with real MyLOFT/ClinicalKey PDFs
  - The reader on real journal PDFs that share pages

## Side notes (owner's Mac, not part of the app)
- iPhone app install (owner's choice): **AltStore**. AltServer runs on the owner's always-on Mac (same Wi-Fi as the wife's iPhone), signed with the owner's free Apple ID; Finder → her iPhone → "Show this iPhone when on Wi-Fi" so AltStore refreshes the 7-day signature by itself. New versions: AirDrop the .ipa to her iPhone → AltStore → +. Developer Mode on and the profile trusted once on her iPhone.
- qBittorrent runs in Docker with bind mounts to `/Volumes/MyBook/...`. The watcher is `~/bin/mybook-watch.sh` with LaunchAgent `com.mybook.watch`. An old backup qBittorrent container is still there; the owner chose to leave it.
- Audiobookshelf runs natively: `cd ~/audiobookshelf-server && ALLOW_CORS=1 npm start` (port 3333, base path `/audiobookshelf`). If the drive was off, an empty root-owned `/Volumes/MyBook` placeholder makes it crash with `EACCES ... watch '/Volumes/MyBook'`. Fix: with the drive off, `sudo rmdir /Volumes/MyBook`, turn the drive on, then start it again.
