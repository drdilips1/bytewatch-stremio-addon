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
- **Shipped: 5.5** (versionCode 33): Consensus meter fix and treatment-only evidence (BACKLOG #45). The next build is **5.6 / versionCode 34**.
- **Web app for iPhone (BACKLOG #23), built but not online.** The owner's wife will use it with her own account. Publishing it at a public address (e.g. GitHub Pages from a `gh-pages` branch) needs the owner's explicit OK.

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
- qBittorrent runs in Docker with bind mounts to `/Volumes/MyBook/...`. The watcher is `~/bin/mybook-watch.sh` with LaunchAgent `com.mybook.watch`. An old backup qBittorrent container is still there; the owner chose to leave it.
- Audiobookshelf runs natively: `cd ~/audiobookshelf-server && ALLOW_CORS=1 npm start` (port 3333, base path `/audiobookshelf`). If the drive was off, an empty root-owned `/Volumes/MyBook` placeholder makes it crash with `EACCES ... watch '/Volumes/MyBook'`. Fix: with the drive off, `sudo rmdir /Volumes/MyBook`, turn the drive on, then start it again.
