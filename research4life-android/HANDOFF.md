# DermScholar + Lesionaut: handoff for a new session

## READ FIRST: state on 27 Nov 2026 (newest; overrides older notes below)

**Repo / branch:** `drdilips1/bytewatch-stremio-addon`, branch **`claude/dreamy-einstein-sphnl8`**, folder `research4life-android/`. Both apps live here and share the Android project (two Gradle flavours).

**Owner's standing rules**
- **Build only when the owner says "build for both" / "build for Android" / "build for iOS"** (a plain "Build" has been treated as both). Otherwise commit with `[skip ci]`. When the owner says "just note", add the point to `BACKLOG.md` (Lesionaut table at the bottom) and don't build.
- Bump versions for every build: DermScholar `versionCode`/`versionName` in `defaultConfig` of `app/build.gradle` **and** `'5.xx iOS' : '5.xx web'` in `web/web.js`; Lesionaut `versionCode`/`versionName` inside `productFlavors { lesionaut { … } }`.
- The owner's reports are about **iOS** unless they say Android (Lesionaut reports so far are Android).
- Never ask for API keys in chat; never put keys in code. No `#` comment lines in Terminal commands for the owner. No Sci-Hub/LibGen. Don't remove features. No visible AI-limit/countdown messages.
- The owner is credit-conscious: short replies, no guess-builds; ask for the exact error text instead of guessing.
- After each build, check the runs with the GitHub MCP `actions_list` (and a `send_later` reminder ~7 min later), then give links. Maven Central HTTP 429 = re-run once. iOS runs can fail/cancel when GitHub's Mac minutes run out (not our code).

**Current versions (28 Nov 2026):** DermScholar **5.50** (versionCode 78: daily-suggestion batch of 28 Nov — photo check in Diagnose, one-tap Looks + high contrast, Weekly digest, faster Home + web service worker `web/sw.js`, Library search in highlights/PDF text; see "Daily suggestions" in BACKLOG.md). 5.49 (77): Diagnose from picture takes 12 pictures, BACKLOG #90; 5.48/76 was the Lesionaut L1–L6 build, commit c2504df); Lesionaut **2.2** (versionCode 4).
- DermScholar APK: https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/dermscholar-latest/DermScholar.apk
- DermScholar IPA: `releases/download/dermscholar-ios-<run>/DermScholar.ipa` (owner installs with **SideStore** now; AltStore's servers gave HTTP 503)
- DermScholar web: https://drdilips1.github.io/bytewatch-stremio-addon/dermscholar/
- Lesionaut APK: https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/lesionaut-latest/Lesionaut.apk (own channel `lesionaut-latest` + version.json)
- Lesionaut web (iPhone): https://drdilips1.github.io/bytewatch-stremio-addon/dermscholar/lesionaut/ (must stay inside `dermscholar/`: Audiohub's gh-pages publisher deletes other top-level folders)

### Lesionaut (the diagnosis app)
- **Separate app, own UI and code** in `app/src/main/assets/www/lx/`: `index.html`, `lx.css`, `lx-core.js` (shell, router, tabs, sheets, phone bridge `window.Native` or web.js `WebNative`, AI calls `ai()`/`aiPics()`, IndexedDB `lesionaut` cases, background jobs bar), `lx-data.js` (pattern library), `lx-case.js` (home, cases, case workspace Evidence/Assessment/Work-up/Notes, correlation engine prompt+JSON schema, specialist debate, rare-disease detective + Europe PMC case reports, treatment assistant, linked follow-up visits + AI comparison, SOAP/referral/presentation/MCQ/patient docs, annotation studio), `lx-explore.js` (pattern library, Teach me this slide, standalone detective, disease relationships, literature), `lx-tools.js` (PASI, EASI, SCORAD, SALT, VASI, UAS7, DLQI, GAGS, BSA/BMI, eGFR), `lx-settings.js` (AI keys, "Bring keys from your DermScholar account" = decrypts the Supabase vault, theme, updates, privacy/about).
- Android flavour `lesionaut` (`applicationId app.lesionaut`, `START_PAGE lx/index.html`, `RELEASE_TAG lesionaut-latest`, `APK_NAME Lesionaut.apk`), icon `app/src/lesionaut/res/drawable/ic_launcher.xml`, name in `app/src/lesionaut/res/values/strings.xml`. Web build: `bash web/build-lesionaut.sh <out>` (icons/manifest in `web/lesionaut/`).
- Tested only in a browser with a mocked AI (Playwright, served on localhost:8765); the sandbox can't reach the real AI/EPMC hosts.
- Cases and pictures stay on the device (not synced).

### AI layer (both apps)
- Several pictures in one request: `Native.aiRunImages(id, system, task, dataUrlsJson, max)` (MainActivity `runImages`, Gemini/Claude/Groq `completeWithImages`; web.js `aiRunImages`). Android also has `Native.captureImage(id)` (camera → `imagePicked`) and picks up to 12 photos at once.
- Picture order: **Claude (always Sonnet 5.5 for pictures, even if Opus is chosen for text) → Gemini → Groq → OpenRouter**; per-AI read timeouts 45 s (one picture) / 75 s (several). Text order unchanged (chosen AI first, then Groq, Claude, Gemini, OpenRouter).
- Errors name the cause (`LlmProvider.netWhy`: DNS, timeout, secure connection, refused).
- Sync no longer overwrites an AI key already on the phone (MainActivity `importSecrets`): the account is shared with the owner's wife's phone and the iPad, which kept uploading old keys.
- Owner's experience: Gemini free daily quota runs out (it's per Google **project**, not per key); the phone's DNS once failed for Gemini/Claude (fixed with Private DNS `dns.google`).

### Lesionaut L1–L6: done locally, NOT built yet (commit after 6dfa9a2, all `[skip ci]`)
Next "build for both" ships them: bump Lesionaut to versionCode 4 / 2.2 (and DermScholar as usual, since the Android project is shared: the new `AiKeepService`, `pickFiles`, `keepAlive`, `aiTake` are in MainActivity for both flavours). The Java was **not compiled** here (no Android SDK in the sandbox): check the first build's log carefully.
- **L1** `AiKeepService.java` (foreground service type dataSync + `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`), JS `runJob` calls `Native.keepAlive(true/false, label)`; `keepAliveReset` on page load. Requests with ids starting `keep_` are kept in SharedPreferences `ai_results` until `Native.aiTake(id)`; lx-case.js `pendingAssess` + `recoverAssess()`; retry once if the job saw the app hidden.
- **L2** SYSTEM/SCHEMA in lx-case.js picture-first; `refine` line; banner only for `sufficiency: unreadable`.
- **L3** Evidence → "Reports and case papers"; `L.pickFiles` (Android `pickFiles` + PdfRenderer; web pdf.js from `../vendor/pdfjs/`); `SCAN_TASK`, review sheet, `c.papers`, `c.scan`, PT field `biopsy`.
- **L4** Teach me: × remove, Replace, Crop (`L.crop` in lx-core.js), clears old teaching.
- **L5** `lx-history.js` + History tab; IndexedDB `lesionaut` v2 store `history`; `L.keep` in lx-explore.js; calculators save after 1.5 s idle.
- **L6** broken-format fix: `L.json` repairs cut-off JSON (`closeJson`), higher token limits, one re-ask.
Tested in Chromium with a mocked AI (scan → fill → assess with a cut-off answer, teach + crop, calculator, History, recovery after a rebuilt screen).

### PENDING
**DermScholar:**
- Research4Life/ClinicalKey Get PDF: last state 5.41+ (taps "Log in here" by its link, menu → Content → Reference Sources → Clinical Key, 20 s re-tap); the owner reported it worked once after ~2 min and once needed manual taps; awaiting the "Details" text if it stalls again.
- Older open items: see "Roadmap: still open" below and the DermScholar rows of BACKLOG.md.

---


> **Owner's build rule (6 Oct 2026):** build only on "build for iOS", "build for Android" or "build for both" (not a plain "build now"); commit everything else with `[skip ci]`. Android Get PDF works — don't change Android unless asked. **Research4Life → ClinicalKey link:** `https://auth.elsevier.com/ShibAuth/institutionLogin?entityID=http://stsr4l.who.int/adfs/services/trust&appReturnURL=<article>` (WHO ADFS sign-in). **The owner's reports are about iOS (iPhone/iPad) unless they say Android.**


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
- **Shipped: 5.11** (versionCode 39, BACKLOG #72–#73: ClinicalKey sign-in renewed through Research4Life by itself, Details shows what each page said, readable failed rows). **Shipped: 5.10** (versionCode 38, iPhone build 6, BACKLOG #65–#71). **Shipped: 5.7** (versionCode 35), release `dermscholar-44`, iPhone build `dermscholar-ios-3`: BACKLOG #52-#56 (JAAD Get PDF via ClinicalKey not MyLOFT, Open via R4L keeps the article link, meter reads all 20 papers with fairer No and Consensus-style counts/headline, explanation waits out AI per-minute limits, both AIs' errors shown). **Shipped: 5.8** (versionCode 36), release `dermscholar-45`, iPhone build `dermscholar-ios-4`: BACKLOG #57-#63 (full meter explanation without timers, per-AI usage, Gemini free-model switching, ClinicalKey via www.clinicalkey.com directly, wrong-PDF check and Remove this PDF, quick Get PDF failures, MyLOFT warm start and link/sign-in guidance). **Shipped: 5.9** (versionCode 37), release `dermscholar-46`, iPhone build `dermscholar-ios-5`; next build 5.10 / versionCode 38 (already bumped: BACKLOG #65, ClinicalKey PDF layout): BACKLOG #64 (two PDF buttons only, R4L loop cap, account in status, Details trail). Owner preference: no visible AI-limit/countdown messages; full Consensus-style explanation (second request, Gemini covers Groq limits). The owner keeps the "Open via R4L" name. Earlier, 5.6 contained: BACKLOG #48 Elsevier PDFs via ClinicalKey, #49 shared AI-planned search for the Evidence Map and Consensus meter (`planSearch`/`evidencePool` in intel.js), #50 Consensus-style explanation, #51 Word/slides export (`exportWord`/`exportSlides` in intel.js, libraries in `www/vendor/office`, bridge `Native.exportFile(name, base64, mime)` on Android and in web.js).
- **Web app for iPhone (BACKLOG #23), published** (owner approved): workflow `.github/workflows/dermscholar-web.yml` builds it on every push (not on `[skip ci]`) and publishes it to the `dermscholar/` folder of the `gh-pages` branch → https://drdilips1.github.io/bytewatch-stremio-addon/dermscholar/ . The site root is **Audiohub's** (the owner's other app, branch `claude/books-tbm-apk-enhancement-h1p51j`, `inkwell-web.yml`); until 5 Oct 2026 DermScholar wrongly overwrote it. Both workflows now push a single-commit gh-pages, each replacing only its own part, serialized by the `pages-publish` concurrency group. Pages source: gh-pages branch. **iPhone updates (BACKLOG #71):** screens update over the air from `/dermscholar/ota.json` (ScreenUpdates.swift); native changes through the AltStore source (`dermscholar-ios-latest/altstore.json`). **Raise `ScreenUpdates.nativeLevel` (now 2) whenever web.js starts calling something new in the iPhone app** — otherwise older apps would download screens they can't run. **iPadOS/iOS 15 support** (owner's wife's iPad, 15.8): no regex look-behind (CI checks), CSS `color-mix()` always with a plain fallback line before it, pdf.js legacy build for old Safari in `web/pdfjs-legacy` (see its README). **Open:** Audiohub's `inkwell-apk.yml` still deploys Pages through Actions (deploy-pages) — needs the owner's OK to switch it to the same gh-pages push. The owner's wife uses it with her own account.

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
