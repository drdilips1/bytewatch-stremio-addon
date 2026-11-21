# AudioYam (public)

- Code: `drdilips1/Audiohub` (clone to `/home/user/audiohub`), work on branch `work`.
- Release: push `work` → `main` publishes Android `v1.0.N` (in-app update) and the web app; push to
  `test` builds a test APK only. iPhone: `.github/workflows/ios.yml` — **manual only** since 21 Nov
  (Actions → AudioYam iPhone app → Run workflow; each run publishes `ios-N` and updates the AltStore
  source `releases/download/ios-source/altstore.json`). It used to start on any push touching ios.yml;
  run 2 started that way on 21 Nov and was cancelled during install (nothing published).
- Latest released: Android v1.0.36 (15-feature port + old logo); iPhone ios-1.
- Built 21 Nov (user said "build"): iPhone `ios-3` from 26aa8e2 (run 3; files + player + transcribe plugins in;
  AltStore source updated) — not tried on a device yet. Android test APK from dea8d92 (run 38, release
  `test-build` / AudioYam-test.apk, not an update); run 37 failed: shareImage was in InkwellWebPlugin twice
  (AudioYam already had it lower down — only mailFile was missing). Not on `main`: Android v1.0.37 / web
  only when the user says release.
- On `work`, not released yet (17 Nov): quiet logo (theme colour), instant play, glow fade, duplicate-send fix,
  banner title fit, Goodreads messages, iPhone build.
- On `work`, not released yet (21 Nov, commits 547800a + 8c459ed) — port of Audiohub+ 678ea9e → 3f408eb:
  - iPhone own files: `ios-plugins/files` (InkwellLocal) + Info.plist UIFileSharingEnabled /
    LSSupportsOpeningDocumentsInPlace in ios.yml → Files app → On My iPhone → AudioYam; Library folder
    button / Settings → Your files on this phone: Add folder / audiobooks, Add EPUB / PDF, Rescan.
  - iPhone native player `ios-plugins/player` (InkwellPlayer, AVQueuePlayer) in ios.yml — not yet tried on
    a device; if it misbehaves, drop it from the two lines in ios.yml (falls back to web-view audio).
  - Android Auto screen off (onStop wake, setSkips, setCarLoading); AllDebrid / Premiumize / Debrid-Link
    (`moredebrid.js`); Usenet (Easynews + Newznab → TorBox, `usenet.js`, `usenet-results.jsx`); Real-Debrid
    downloads grouped on every device (`rdgroups.js`); Send to Kindle any SMTP (`smtp.js`; GmailSender.java +
    mailFile/shareImage added to InkwellWebPlugin — AudioYam's JS already called them, the Java was missing);
    Delete a book (+ cloud); newest first, a row per service on Home; Settings search; source boxes; book page
    audio files beside ebook files, ♡ by 👍/👎; long-press Play for catalogue books (playScene, no getplay.js);
    addon lists merge across devices (`addonmerge.js`); addon "Your details" headers + errors/partial shown;
    Get the ebook for Live text: best 3 per source with covers; iPhone lighter (html.ios); What's new `nov-2026g`.
  - Left out (private or not on AudioYam): Libby, Mobilism, Anna's, Bookshare, Book Hunt (worker, KEEP id,
    in-app-only filter, forum `downloads`), MAM / getplay.js, Knaben ebook torrents via debrid (needs
    unported onDownloadProgress / stopAutoEbook), spine shelf, ebookfile test (Mobilism). (Find books / Found added later, see below.)
  - Scrubbed: the user's first name / e-mail prefix in comments (Home.jsx, format.js — format.js was
    already public before). Still in the repo from before (old data clean-ups, ask before removing):
    `main.jsx` removes `inkwell:libby*` keys; `addons.js` RETIRED regex names Anna's Archive. The generic
    "your own tracker site" setting (Tracker.jsx, qbit.js) is old and not MAM-specific.
  - Checked: npm test (98), lint, vite build. Android Java not compiled here (no SDK) — first test APK
    (push to `test`) will tell.
- On `work`, not released yet (21 Nov, 05c2251): Find books (`lib/findbooks.js`, `screens/FindBooks.jsx`,
  route `find`, Discover camera button, Library ⋯ → Find books, Library → Found shelves + Edit) — cover / barcode /
  shelf / page photo, screenshot, pasted link or list; Android share-in of text / images (manifest SEND
  text/plain + image/*, InkwellLocalPlugin takeBook). `lib/getplay.js` is AudioYam's own (your copies →
  debrid sources → Audiobookshelf; no MAM / home-server step), also used by press and hold → Play.
  tests/findbooks.test.js. Photos need a Gemini / Claude key; barcode reader is Android's (none on iPhone).
- On `work`, not released yet (21 Nov): Cloudflare traffic fix from Audiohub+ 05a5761 — `lib/backoff.js`
  (tested), `lib/answers.js`, http.js waitFor/noteAnswer (localStorage `inkwell:backoff`), Goodreads out of
  RELAY_HOSTS / RELAY_ALLOWED and never sent from the web app, ratings.js refusals kept, hardcover.js gql kept
  24 h; `relay/index.ts` v9 (exports keepHours for tests/backoff.test.js; the shared workers/audiohub.js is not
  in AudioYam). People who host their own relay need to redeploy it for v9.
- What's new `nov-2026g` (user's choice, 9fda872, after the test builds): cloud services + Usenet, Send to Kindle,
  own audiobooks on iPhone, Find books, Delete a book, Android Auto, iPhone player, Settings search. "Fewer
  wasted requests" card dropped; no cards for the card frame, logo, instant play etc.
- Porting from Audiohub+: 3-way merge per file (`git merge-file`, base = the Audiohub+ commit of the last
  port, now 05a5761), then scrub everything private (see RULES.md) and grep.
- Pending: try the iPhone build (files + player) and a test APK when the user says "build"; Usenet only
  tested with sample answers; see ROADMAP.
