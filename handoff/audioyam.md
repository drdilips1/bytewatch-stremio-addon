# AudioYam (public)

- Code: `drdilips1/Audiohub` (clone to `/home/user/audiohub`), work on branch `work`.
- Subreddit: r/audiohubapp (https://www.reddit.com/r/audiohubapp/) — in Settings → Issues & support (report.jsx
  SupportLinks) and the README on `work` since 22 Nov; put it in Reddit posts.
- Release: push `work` → `main` publishes Android `v1.0.N` (in-app update) and the web app; push to
  `test` builds a test APK only. iPhone: `.github/workflows/ios.yml` — **manual only** since 21 Nov
  (Actions → AudioYam iPhone app → Run workflow; each run publishes `ios-N` and updates the AltStore
  source `releases/download/ios-source/altstore.json`).
  Every AltStore-destination build also uploads to the fixed release `ios-latest`
  (releases/download/ios-latest/AudioYam.ipa — the link to give iPhone users; live since iPhone build 8, 23 Nov,
  from `work` 9d9d1a0 — build 8 also has the bookmark / highlight deletion fixes). It used to start on any push touching ios.yml;
  run 2 started that way on 21 Nov and was cancelled during install (nothing published).
- Latest released (22 Nov, "release"): Android v1.0.42 + web + iPhone ios-5 from `main` 87bb711 — cloud EPUBs
  (ad/pm/dl/en) open, Goodreads CSV-only with steps, reports skip "already registered". No new What's new card.
  On `work` after it (not released): subreddit link in Settings / README (998a5be).
- Before that: (21 Nov, user said "build and release"): Android v1.0.39 + web app from `main` ed4b61f
  (= `work`), iPhone ios-4 (run 4, AltStore source updated). Everything in the "On `work`" notes below is in it.
  Reddit post text for 1.0.39 given to the user (incl. public addon pack sources.booksources.workers.dev/addons/all.json).
- Earlier: Android v1.0.36; iPhone ios-1.
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
- On `work`, not released (22 Nov, Reddit report): EPUBs from Premiumize / AllDebrid / Debrid-Link / Easynews opened
  blank at 0% — `isCloudEbook` (epub.js) only knew tb|rd|src|loc, so they went to the Gutenberg loader. Now
  tb|rd|ad|pm|dl|en|src|loc; tests/ebookroute.test.js. Same bug in Audiohub+ (told that window).
- On `work`, not released (22 Nov, 81262d6): Goodreads Connect "refused" for public profiles — ported from Audiohub+
  8eed093: BROWSER_HEADERS (http.js) on Goodreads RSS / search / auto_complete / book page, request opts.force for
  Sync. Left out: the hidden-browser fallback (AudioYam has no pageVisit). Not checked against Goodreads live.
- On `work`, not released (22 Nov): Goodreads refusal shows Goodreads' HTTP code and logs each shelf's answer
  (5b025bc) — the user sees "Goodreads refused" on their own public profile in 1.0.39; next step depends on the
  code (403 → hidden browser like Audiohub+, 404 → needs the RSS key). Report a problem skips Capacitor's
  "plugin already registered" warnings (ef21df5).
- 22 Nov: user's own public profile gives HTTP 404 on list_rss without key (test APK 1.0.40). Fix on `work`
  d4985d9: on an all-404 sync without key, `findKey` reads the key from review/list/<id>?shelf=read
  (`keyFromShelfPage`, tests/goodreadskey.test.js), saves it and retries; logs "Goodreads key" / "Goodreads sync".
  Test APK 1.0.41 (run 41) built — waiting for the user's result. Next release will be 1.0.42.
- 22 Nov result: Goodreads RSS feeds are gone (every list_rss 404, the shelf page has no RSS link, even on the
  website). User decided: CSV only. Settings → Goodreads now shows the 4 export steps (Chrome, not the Goodreads
  app — it can't save the file; goodreads.com/review/import → Export Library → "Your export from …" link →
  Downloads → Import CSV) + "Open Goodreads export page" (Capacitor Browser). Profile sync, findKey, the
  pull-to-refresh sync, request opts.force and tests/goodreadskey.test.js removed; a saved userId is cleared.
  BROWSER_HEADERS kept for ratings. On `work`, not released; next release 1.0.42.
- On `work`, not released (22 Nov, r/audiohubapp report "import on iOS keeps spinning"): ported Audiohub+ 0d35043 —
  InkwellLocal documentPicker copies through NSFileCoordinator (`copyCoordinated`) so iCloud Drive files not yet
  downloaded are fetched first. Not compiled or tried on a phone; needs an iPhone build (manual ios.yml).
- On `work`, not released (23 Nov, Reddit question "Send to Kindle just downloads"): direct mail needs the Android
  InkwellWeb plugin (mailFile); iPhone / web only download. Settings → Send to Kindle now says so on iPhone / web
  (`canMailHere` in kindle.js) and the download shows a toast with what to do. A real iPhone sender would need a
  native Swift SMTP plugin (pending idea, not started).
- TestFlight (23 Nov, user asked; Apple Developer enrollment submitted Fri 20 Nov, still pending Mon): ios.yml has
  input `destination` (altstore default | testflight). testflight = archive signed via API key
  (-allowProvisioningUpdates, cloud signing) + exportArchive method app-store-connect destination upload; skips
  release / AltStore steps. Secrets needed: APPLE_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (Admin key);
  app record app.audiohub.player in App Store Connect. VITE_IOS_CHANNEL → Settings card says TestFlight. Icon
  flattened (no alpha). Plan: full app for INTERNAL testers only (no review); public TestFlight/App Store =
  store edition (store-edition/STORE_PLAN.md). Not run yet (on `work`, needs the account).
- 23 Nov, iPhone first (user: "do 1 to 5, Android can wait"): ported Audiohub+ eca3784 (lib/mime.js + tests, mime on
  TorBox / RD / more-debrid tracks, player.js passes it; Swift player out-of-band MIME + video off), 41dac5c (player
  percent-encodes links, "Cannot Open" → clear message + safety net), 16d4c06 (Text on >900 MB parts from the
  server), 7b94708 (CFBundleURLTypes audiohub in ios.yml). Player + transcribe Swift now identical to Audiohub+
  (compiled there in build 124). With the Files-import fix: iPhone ios-6 from `work` 56ba5b6 — built 23 Nov (compiled; plugins + audiohub://
  scheme in; AltStore source updated; SideStore post text given to the user),
  Android not released (work is ahead of main: Goodreads-free since 1.0.42 plus these).
  Not ported (user's list B): iPhone unpack (.zip/.rar), Easynews relay, revive.
- 23 Nov: Send to Kindle on iPhone (user said yes): new `ios-plugins/mail` (package inkwell-mail-ios, SPM
  InkwellMailIos, jsName **InkwellMail** — not InkwellWeb, so iPhone doesn't claim Android's other native parts).
  mailFile(url, name, mime, to[], from, password, host, port, security, user) like Android GmailSender: URLSession
  download, ≤18 MB, web-page check, SMTP over Foundation streams (SSL before open, STARTTLS mid-stream via
  socketSecurityLevel), AUTH LOGIN, base64 MIME. kindle.js: canMailHere = Android || iOS plugin; sendsDirect uses
  it; web-only note in Settings. Added to ios.yml install. AudioYam-only (Audiohub+ doesn't have it yet).
  iPhone ios-7 from abb66bc BUILT 23 Nov (compiled, InkwellMailPlugin in the app, AltStore source updated) — not
  tested with a real mail server / Kindle yet.
- iPhone vs Android gaps (list given to the user 23 Nov): offline downloads, Send to ABS, skip silence / boost / sleep
  detect, in-file M4B chapters, CarPlay, natural voices + read aloud screen-off, voice asking, Siri, open-with EPUB,
  share-in to Find books, native save/share, in-app update, backups outside the app, tracker browser, widgets.
  Suggested order: offline downloads → open-with + backups in Files → proper sharing.
- GitHub issues (23 Nov check): #10 iPhone ios-5 "Cannot Open" on TorBox (fixed in ios-6, waiting for the reporter);
  #9 bookmarks come back after delete — sync merged lists with no deletions; fixed on `work` (lib/marks.js +
  tests/marks.test.js, removedMarks synced before bookmarks, removeBookmark in store.js) — same bug likely in
  Audiohub+ sync.js (its own sync); #8 own files (answered by the user; now visible + iPhone); #11 comics idea (no
  details). Replies drafted for the user, not posted. Highlights had half the same bug (highlightsGone local only):
  now synced (mergeGone) before highlights and mergeHighlights filters local lists too (from Audiohub+'s check). Login: user said avoid built-in Supabase for now.
- 23 Nov: offline downloads on iPhone (user said build): new `ios-plugins/downloads` (inkwell-downloads-ios, SPM
  InkwellDownloadsIos, jsName **InkwellDownloads** — same calls as Android: download {url, headers, name, folder,
  job} → {uri, rel, size, location}, progress events, cancel, remove, move, publicAvailable=false, plus `paths`).
  Saved in Application Support/Downloads (excluded from iCloud backup, not Documents so InkwellLocal doesn't list
  them). downloads.js stores `rel` per part and rebuilds uris at every iOS start (container moves on update).
  Foreground URLSession + beginBackgroundTask: leaving the app pauses big downloads, the app resumes them next
  start. Send to Audiobookshelf stays Android-only (canSendToAbs). Settings → Downloads note on iPhone.
  iPhone build 9 from `work` 59b6259 BUILT 23 Nov (compiled, InkwellDownloadsPlugin in; ios-latest + source updated)
  — not tried on a phone yet. User chose Files: since 5250df1 downloads live in Documents/Downloads (Files →
  AudioYam → Downloads, excluded from iCloud backup), InkwellLocal scan skips Documents/Downloads, build-9
  downloads are moved over in the plugin's load(), `paths` also returns `missing` and downloads.js afterFiles()
  (tested, tests/iosdownloads.test.js) marks a book not downloaded from the first missing part. iPhone build 10
  BUILT 23 Nov (compiled; ios-latest + source updated) — user confirmed 23 Nov: downloads work on iPhone.
- Still Android-only on iPhone (list given 23 Nov): Send to Audiobookshelf, skip silence / boost / sleep detect, in-file
  M4B chapters, CarPlay (needs paid account + Apple entitlement), natural voices + read aloud with screen off,
  voice asking, Siri, open-with EPUB, share-in to Find books, native save/share of files, in-app update, backups
  outside the app, tracker browser, widgets. Send to Kindle built (ios-7), not confirmed with a real Kindle.
- 23 Nov: "can manage downloads but can't import local files" (iPhone). Fixed on `work`, not built: folder-mode
  copy failures were swallowed (pickFolder now returns added / failed, addFolder shows it); downloads folder renamed
  Documents/"AudioYam downloads" (scan skips only that) so a user's "Downloads" folder (Safari's) isn't skipped —
  load() moves build 9 (App Support/Downloads) and build 10 (Documents/Downloads/Audiohub) downloads over; iPhone
  buttons now "Add audiobooks (files or folders)" / "Add ebooks (EPUB / PDF)" (ebook picker greys out audio).
  Exact cause not confirmed (the user's own iPad import worked on build 10). iPhone build 11 from b00c281 BUILT 23 Nov.
- 23 Nov: Apple Developer account approved; TestFlight setup steps given (app ID app.audiohub.player, App Store
  Connect app, Admin API key, 4 GitHub secrets) — waiting for the user to add the secrets, then run ios.yml with
  destination testflight. Money model decided (store edition only, see store-edition/STORE_PLAN.md): free +
  one-time Plus + optional AI pass. `src/lib/plus.js` (hasPlus, always true here) added as groundwork.
- Porting from Audiohub+: 3-way merge per file (`git merge-file`, base = the Audiohub+ commit of the last
  port, now abafa7ac), then scrub everything private (see RULES.md) and grep.
- Pending: try the iPhone build (files + player) and a test APK when the user says "build"; Usenet only
  tested with sample answers; see ROADMAP.

## Ideas: beyond a player (noted 24 Nov, user's list, NOT started, no code)
User's 12 ideas + "social network around stories". Status = what AudioYam already has to build on.
1. **Story Companion** (spoiler-safe AI that knows your position; voice): mostly exists: Ask the book
   (askbook.js, "ask about what I'm hearing", never past your place), voiceask.js, X-Ray. Gap: one tap
   from the player straight into a spoiler-safe chat; works best with the ebook or Live Text.
2. **Character Tracker** (aliases, relations, first appearance, alive/dead at your point): partly: X-Ray
   (xray.js, people per chapter up to your place) + story-sheet knownCharacters. Gap: kept per book over time,
   relationships, status at your point, tap for a spoiler-safe profile.
3. **What If?** (non-canonical alternate scenes): new; easy with AI (own key), clearly marked "not the book".
4. **Time Machine** (search everything you've listened to): partly: Play a scene (scenefind.js, inside one
   book via its ebook), transcripts cache, bookmarks / highlights / notes, playback history. Gap: one search
   across all books (index transcripts + notes + chapter titles), jump to the moment.
5. **Dream Cast**: new; portraits = image AI (costly, rights questions with real actors' faces → keep to names
   + optional AI art, never real-photo deepfakes).
6. **Nightly Book Club**: new; needs shared accounts / server (sync is per-user Supabase today; no shared
   server in AudioYam by rule). Could start as a shared schedule link + discussion questions by AI.
7. **Audio DNA** (suspense / mystery / romance %): partly: taste.js profile, mood shelves, "why this pick".
   Gap: per-book profile shown on the book page + "experience" based recommendations.
8. **Audio Postcards**: mostly exists: quote cards / shared quote links (quoteshare.js). Gap: waveform look,
   reaction note, chapter reference; text excerpt + timestamp only (no audio clip: copyright).
9. **Mood Radio**: partly: Discover moods, bookseller.js AI picks, taste ranking. Gap: a "what do I want to
   feel" queue built from books you already have / can get.
10. **Memory Palace** (what did I learn across books, with sources): new on top of Ask the book (library mode)
    + transcripts / highlights; needs a per-user index (embeddings) — biggest but most unique.
11. **Listener Challenges**: easy; stats.js + Your year already count authors / genres / books.
12. **Living Book** (timeline of events, places, objects, open questions): extends X-Ray / Character Tracker;
    very AI-heavy.
- **Stories-not-people social layer** (who's on the same book / chapter, listening parties, voice-note recs):
  needs a shared server and accounts → conflicts with AudioYam's "no own sync server" rule; would be an
  Audiohub+ / store-edition decision. Privacy first (opt-in, no follower counts).
- **Suggestion (Claude):** agree with starting from Story Companion + Character Tracker + Time Machine — all three
  extend code that exists (askbook, xray, scenefind, transcripts) and need only the user's own AI key, no server.
  Listening Rooms / Book Club / social need a server → decide the server question first. Store edition: these
  are natural **Plus** (own key) / **AI pass** (no key) features (see store-edition/STORE_PLAN.md).

## WAITING (user away until Saturday 28 Nov, out of credit) — nothing to build until they say
- **X-Ray redesign:** sample shown 24 Nov (`handoff/samples/audioyam-xray-sample.png`, its HTML next to it): main
  screen with "In this scene" photo cards + People / Places / Topics list with round photos; character page like the
  author page (big photo + credit, aliases, quick facts First seen / Chapters / Status now, "In the story so far",
  Connections with photos, timeline of moments → play); real-person page (Wikipedia photo + bio, role in this book).
  Photos: Wikipedia for real people and adapted characters (credited), else a portrait tile in the cover's colours
  (no AI faces). Needs the X-Ray AI request to return kind (real / fictional), wiki title, connections, status at
  your point (still spoiler-safe, own key). Waiting for the user's feedback or "go".
- **Character Tracker idea:** sample shown 24 Nov (`handoff/samples/audioyam-character-tracker-sample.png` + HTML):
  who's who grouped by house / family with status dots (alive / missing / dead / unknown) and counts; relationship
  map centred on one character (family / enemies / allies lines, links appear only once revealed); "Since you last
  listened" catch-up (status changes, new people, new links), open questions so far, "also called" aliases.
  Would share data with the X-Ray redesign (one AI request per chapter gives groups, links, status). Waiting.
- Also open: GitHub replies drafted (#8–#11, close done ones) — not posted; TestFlight — waiting for the 4 GitHub
  secrets; Android / web release of what's on `work` (bookmark + highlight deletion fixes, subreddit link, Kindle
  note, Plus switch, iPhone fixes) — waiting for "release"; Support link (Ko-fi / Sponsors) — waiting for the account.
- 25 Nov: a user's video (couldn't be opened here: Streamable download refused by the session's safety check) shows
  the same iPhone problem — downloads work, importing own files doesn't. Likely on build ≤10 → asked them to update
  to build 11 and send the on-screen reason if it still fails. Suggested for Saturday (not built): log import results
  (picked / copied / failed / scan found) to Report a problem when an import adds no books.
  Reporter IS on build 11. Found (not fixed): .mp4 audiobook files aren't audio anywhere on iPhone import — picker
  types (.folder/.audio/.mp3/.mpeg4Audio/m4b → .mp4 greyed out), Swift scan `audio` set and local.js AUDIO regex lack
  mp4 → folder copied but 0 books, no error. Also: imported books only in Library → Audiobooks → On this phone (and
  Home row if the 'loc' source is on). Asked the user to get: file type, the message shown, whether it's under On this phone.
  Fix for Saturday: accept .mp4 (picker + Swift scan + AUDIO), log import results, toast where the books went.
- 25 Nov user feedback with screenshots (Android 1.0.42), all NOT fixed yet:
  1. Author page wrong / empty: Robert Greene showed "Born 1558? · 278 works" = the Elizabethan dramatist (Open Library
     name match). Fix: prefer Wikipedia, disambiguate by a book of theirs (e.g. "Robert Greene (American author)"),
     check OL works overlap with the author's known titles before using its dates/bio (people.js).
  2. Source result cards: inner boxes (TorBox / RD chips, Read / Save / Kindle buttons) a tiny bit smaller, and keep
     the "…" more button on the same row (it wraps to its own row when Kindle is there).
  3. "Show / Hide N loose matches" and "Show N more ebooks" boxes: same width as the source boxes (they're narrower).
  4. Find books from a link: sometimes only the web link comes back, not the books (need an example link; check page
     fetch failure → falls back to the raw text).
  5. Battery drain / phone hot: investigate — suspects: on-device Live Text (speech recognition), motion (breathing
     cover, glows, blurs), place saved every 4 s, frequent re-renders, background polling (Downloading for you,
     debrid status). Add a "what was busy" line to Report a problem.
  6. Home "Downloading for you" card (e.g. "Ready to play · TorBox") can't be tapped — make it play / open the book.
  7. Live Text "Get the ebook" → Download spins a long time with no progress — show status + MB progress
     (Audiohub+ has onDownloadProgress in http.js; not ported).
  8. Home top-right floating play button overlaps the search button again.
  9. Question: listen parties like watch parties? → needs a shared server (see ideas section; AudioYam rule).


## Ideas 13–22 (noted 24 Nov, user's list, NOT started) + Claude's notes
13. **Sidekick / listen to the world** (location → short history, related chapters): new; needs location permission,
    a places source (Wikipedia geosearch is free) — privacy-sensitive, opt-in only. Later.
14. **The Unheard Chapter** (AI side-scene, labelled fiction): same engine as What If? (#3); cheap with own key.
15. **Voice Constellation** (other narrator styles, keep position): only for text the user owns (EPUB) via TTS; the app
    already has read-aloud voices + Live Text alignment. Never clone real narrators' voices (rights).
16. **Book DNA between friends**: needs two people's histories → share a "taste card" link/QR (no server: data inside
    the link, like quote links) and compare on the other phone. Viral-friendly.
17. **Alternate Ending Debate**: votes need a server; light version = after finishing, AI-posed questions + share your
    answers as a card/link; friends compare.
18. **Whisper Notes** (user's favourite): partly exists — "Remember this" (askbook.js) saves spoken ideas as text cards.
    Gap: keep the actual voice clip at the timestamp, play it when you reach that chapter again, share with a friend.
    On-device recording, no server. Strong candidate.
19. **Audiobook Relay** (chapter per person + 30 s reaction): needs sharing between people; could start as a shared
    "relay diary" link passed along (each adds a reaction), no server. Families / classrooms.
20. **Silence Intelligence**: Android has skip silence (player extra); new = classify pauses (sentence / paragraph /
    dramatic / recording gap) and per-user rules; analysis on-device for local + downloaded files. iPhone needs it too.
21. **Book Resurrection**: mostly exists in parts — catchup.jsx (recap on resume), resume.js, story sheet, bookmarks;
    gap: a gentle "come back to …" card after N weeks with recap + characters + your notes in one place. Easy win.
22. **Book Universe** (connected books: same era, figures, interpretations): parts exist (series.js, people.js, X-Ray real
    people, Wikipedia); gap: a "connections" page per book. Good discovery feature without a server.
- User's shortlist: 18, 21, 22, 19, 20. Claude agrees; order by effort: 21 (easy) → 18 → 22 → 20 → 19.
- Next-10 direction (user asked): Claude suggests **revenue without a cloud subscription** mixed with **viral sharing**
  (link/QR cards, no server) — see the 10 ideas given in chat on 24 Nov (23–32 below).
23. Study mode (non-fiction → flashcards/quiz from what you heard, spaced repetition) — Plus.
24. Language-learner mode (dual-language Live Text, tap a word, slow repeat) — Plus.
25. Kids / family profiles with a parent's voice reading the EPUB at bedtime (own recording, on-device) — Plus.
26. "Listening passport" share card (books, hours, places visited in stories) — viral.
27. Gift a listen: send a friend a link that opens the book page + your voice note — viral.
28. Offline AI pack (small on-device model for recaps without any key/cloud) — one-time purchase.
29. Car mode pro (big-button, voice-only control, auto-resume per car) — Plus.
30. Sleep story mode (gentle fade, auto-rewind to where you dozed via motion/no-interaction) — Plus.
31. Book-to-podcast (your highlights + notes as a private mini audio episode via TTS) — Plus.
32. Classroom pack (teacher shares a relay/quiz link; no accounts) — one-time / school licence.

## Comics (25 Nov) — Audiohub Comics worker integration, on `work`, NOT released
- Worker https://audiohub-comics.booksources.workers.dev (v2.4.0, user's own; code was pasted in chat, not in a repo).
  Manifest maps only title/author/url/format/date/cover/description; the app reads unmapped fields from the row.
- App: sourceaddons.js keeps `provider_name` (r.provider), `original_title` (as title), `download_links_url`
  (r.downloadsUrl, absolute, only http(s), skipped when download_available === false). source-results.jsx: provider
  label per result; results with downloadsUrl get "Download options" (in-app list via lib/comiclinks.js, tested:
  reads {links:[{label,host,url,direct_file}]} and other shapes, drops non-web links) + "Release page"; direct files
  → existing saveToDownloads, others → open in browser; loading / empty / error (Try again, Open the release page).
  contentType 'comic' counts as reading (Ebooks group, book icon); the "Connect TorBox…" hint only shows when a
  result has a magnet.
- Tested against a local stand-in with the worker's exact shapes (Batman search, provider label, 3 links of which 1
  Save, empty answer, HTTP 502) + an audiobook torrent source (still Play, no label). Real worker not reachable here.
- Worker bug to tell the user: getComicsDownloads allowed-hosts list contains a markdown artefact
  "[www.getcomics.org](https://www.getcomics.org)" instead of "www.getcomics.org".
- Reader: EPUB / PDF only — CBZ / CBR / manga need an image page reader (see chat 25 Nov).
- Corrected worker 2.4.1 given to the user (copy in handoff/workers/audiohub-comics.js): www.getcomics.org host fix
  (CONFIG.GETCOMICS_HOSTS), one CONFIG.VERSION, manifest maps provider_name / original_title / download_*. Tested
  locally with a fake fetch (www + plain host accepted, other hosts refused, manifest 2.4.1).
- Worker 2.5.0 (25 Nov, user: remove sources that don't work; one-tap download): only GetComics + Internet Archive
  (Kitsu and the fake link-out sources removed), GetComics main download links followed by HEAD redirects (≤5 hops,
  5 s) → direct_file + real file URL; /api/archive/downloads?id= gives Internet Archive files in the same links shape;
  manifest searches source=all, GetComics first. Tested with fake sites. handoff/workers/audiohub-comics.js = 2.5.0.
  The app needs the `work` comics code (not released) to show Download options.
- Comic / manga viewer PLAN (25 Nov, not started; sample sent 25 Nov, waiting for feedback or "go"): one viewer for CBZ (fflate, already used
  for EPUB) + PDF; swipe pages, pinch / double-tap zoom, right-to-left per book (auto for manga), double pages in landscape
  / tablet, vertical webtoon mode, page remembered, only nearby pages decoded (battery); Download options Save keeps
  comics in the app; Add files accepts CBZ. Then RTL / double pages, CBR (needs a RAR library) last.
  Sample: handoff/samples/audioyam-comic-viewer-sample.png (comic page with tap controls + thumbnail strip;
  manga RTL with "Reading settings · this book" sheet: Direction / Pages / Fit; Comics shelf + Download options
  with "Read in app" / "Save" for files and "Open ↗" for browser-only hosts).
- COMICS SOURCES + COMIC READER (25 Nov, user's full spec; app on `work` e0863c8, NOT released; worker 2.6.0
  given, NOT deployed by me — the user deploys it). Investigated first (this session got its own "AudioYam"
  environment with the comic hosts allowed):
  - ReadComicsOnline: every page incl. search is behind a Cloudflare managed challenge (403 "Just a moment").
    robots.txt + sitemaps are open: sitemap-comics.xml (9,671 series, caption + cover on cdn.readcomicsonline.ru),
    sitemap-chapters-1/2.xml (every issue URL). Worker searches slugs word by word, issues from chapter maps.
    Reader pages NOT scraped (would mean getting round the bot check) → issues open in Custom Tabs. No downloads.
  - GlobalComix: no public API; terms forbid robots/scrapers/framing; OpenSearch RSS (search?q=&format=rss) now
    302s to /browse (script-drawn). Only a web-search link (search?q=, its OpenSearch template). Its page
    carries a web client key (gck_…) for api.globalcomix.com — deliberately NOT used.
  - Comics Plus / LibraryPass: External API is free but licensed to LIBRARIES via a support ticket, not readers;
    each library has its own sign-in. → manifest userConfig "library_link" (no header: never sent to the worker),
    shown as a web-search link. Card number only ever typed on Comics Plus's own page.
  - Kitsu restored in the worker as its own source (/api/kitsu/search, /api/kitsu/item) but NOT in source=all.
- Worker 2.6.0 (handoff/workers/audiohub-comics.js): unify() gives every result the same fields (access_type,
  reading_url, external_url, download_options_url, issue_count…, null when unknown); /api/readcomicsonline/search,
  /series?slug= (= /issues), /api/kitsu/*, /api/globalcomix/search + /api/comicsplus/search (explain, no fake
  results, open_url); /api/search source=all = GetComics + IA + RCO, results interleaved; manifest maps the new
  fields + webSearch + userConfig. Tested locally (node, real sites): Batman 230 / Spider-Man 11 / Superman 69 RCO
  series, One Piece 0 (site has no manga — Kitsu has it); batman-2016 169 issues; GetComics + IA download options
  unchanged. Free-plan CPU (10 ms) may be tight on the first uncached sitemap read — watch for 1102 errors.
- App (`work`): lib/comics.js (+ tests/comics.test.js, 9 tests): comicPages natural order, isComicArchive,
  accessInfo, webSearches, issueList, turnPage (RTL), resumePage. components/comic-reader.jsx (Reader.jsx routes
  CBZ there): page / vertical strip, LTR / RTL, tap thirds + swipe, zoom buttons + double-tap, fit width, full
  screen (+ StatusBar.hide), brightness (comicLook), page + settings in progress (comicPage, comicMode, comicRtl,
  comicFit). epub.js: CBZ sniffed (zip of pictures, no container.xml), kept in the ebook cache as CBZ (offline,
  Downloaded), READABLE = EPUB|PDF|CBZ, CBR says it can't open yet; http.getBytes onProgress + signal (Cancel).
  source-results: cover, access label, year, issues count; Issues (IssueList) + Read online (openInApp = Custom
  Tabs) for reading-only results; DownloadOptions Read for CBZ/PDF/EPUB files; WebSearchLinks under each source.
  addons.js: refreshSourceAddons() once a day (keeps config); reinstall keeps config. What's new card, nov-2026h.
  UI-tested in Chromium with the real worker locally (all results labelled by provider, 20 covers, issues, links,
  reader taps / RTL / zoom / strip / resume / offline reopen with file server cut off, audiobook rows unchanged).
- Not done / can't: in-app page reading for RCO (bot check) and GlobalComix (terms); Comics Plus catalogue search
  (library API); CBR (needs a RAR library); double-page spreads; issue-to-issue "next issue" inside the reader
  (local CBZ files have no series link); pinch-zoom is the browser's own (buttons + double-tap are ours).
- Test APK #43 (e0863c8) feedback 25 Nov: (1) Read on GetComics "DOWNLOAD NOW" → HTTP 403 from fs3.comicfiles.ru
  (the file server refuses the app; works from the site's button in a browser). Probing which headers it wants was
  blocked by the safety check as access circumvention — NOT spoofing Referer/UA. Fix 803359a: reader explains and
  offers "Download in the browser", then Library → Add EPUB / PDF / CBZ. (2) Save → "InkwellWeb.saveToDownloads()
  is not implemented on android": the JS came with the Audiohub+ port but the Java method didn't (ebook Save was
  broken too). Ported (DownloadManager → Downloads). Also CBZ accepted by Android/iPhone pickers, Open with, phone
  folders (local.js EBOOK). AudioYam env got fs1/fs2/fs3.comicfiles.ru + comicfiles.ru (for the diagnosis).
  Not built yet (waiting for "build").
- More feedback 25 Nov (build 44): added CBZ was there but titled by "Author - Title" split → 3568f34 comic files keep
  the whole name, first page = cover, one added file opens at once; skipped files are named (7b1f78f).
  Then: (1) separate Comics shelf → Library tab "comics" + home shelf (lib/comics isComicBook; summarize keeps
  comic flag; directReaderBook / local books set comic). (2) Comics Plus should read in app → opens in
  InkwellWebActivity (openReaderScreen, manifest webSearch inApp:true); it's still their web reader (DRM, no
  pages extracted). (3) GetComics Read 403 → on Android the phone's DownloadManager fetches it (saveToDownloads
  now returns id; new downloadState; InkwellLocal.importDownload copies it in) with progress in the reader,
  then opens it (ComicReader onReplace). No header spoofing. (4) RCO read online unusable (captcha + pop-ups):
  worker 2.6.1 drops RCO from source=all. (5) IA mostly unrelated: worker 2.6.1 only items with Comic Book
  ZIP/RAR formats, CBZ first. App commit on work; worker 2.6.1 = handoff/workers/audiohub-comics.js.
- "Batman under the red hood" gave every Batman: book page srcTitle = searchTitle → mainTitle cuts after ":".
  Fix: SourceResults passes fullTitle; sourceaddons runOnce uses it for contentType 'comic' addons. Worker 2.6.1
  (updated): IA title words ANDed (archiveWords). Tested: Under the Red Hood → GetComics 1 exact; Absolute
  Batman / Spider-Man: Blue precise. User still had 2.6.0 deployed (RCO showing).
- Weeb Central (user: "weebventral") 25 Nov: no bot check, robots.txt allows all (Crawl-delay 10). search/data
  (HTML, Full Display), /series/ID/full-chapter-list, /chapters/ID/images?…reading_style=long_strip → plain
  image links (scans-hot.planeptune.us) that load with a plain request → read IN the app's reader. Worker 2.7.0:
  /api/weebcentral/search|series?id=&title=|chapter?id= (pages), in source=all, reading_direction rtl/vertical.
  App: comics.js chapterBook / nearChapters / pageList (tests), ebookFormat 'PAGES' (ebookUrl = pages endpoint),
  uid pg:…#comic, summarize keeps seriesUrl + direction, reader Prev/Next chapter, "Chapters" button, comic titles
  keep brackets. Browser test: headless desktop UA got ERR_BLOCKED_BY_ORB on images; Pixel 7 emulation loads them
  (1200 px) — confirm on the phone. Envs: AudioYam has weebcentral + image hosts.
- NOTED 25 Nov (test APK #45, NOT fixed — user said "just note"): Weeb Central chapters work on the phone
  (Solo Leveling · Chapter 1 read, cover + authors show, Continue · 5%). But the book page of a comic / chapter
  says "Ebook" (under the title and as the chip) and offers Listen (read aloud) — wrong for pictures. To do:
  label it "Comic" / "Manga" (chapter), hide Listen / read-aloud there (and probably the text-only AI chips
  "5 key ideas" etc., or point them at the series), keep Continue. isComicBook() in lib/comics.js tells them apart.
- NOTED 25 Nov (NOT fixed): app says AudiobookBay is down while its website works. Checked from here at the same
  time: the addon (sources.booksources.workers.dev/abb/search?q=Project Hail Mary) answered HTTP 200 in 0.2 s with
  results — so the source is up. Suspect the app's "slow source" memory in sourceaddons.js (slowSources: a source
  that timed out twice in 30 min gets 10 s and "isn't answering — skipped for now") or a remembered failure that
  isn't cleared once it answers again. To do: ask the user for the exact message / screenshot + Settings → Report a
  problem (recentSearches log), check slowSources reset on success, and offer "Try again" that ignores it.
  User adds: Audiohub+ AudiobookBay works — it uses its own server: built-in addon
  inkwell/src/sources/builtin/audiobookbay.json → https://api.audiohubapp.com/abb/api/search (private, POST-style
  /api/search, 30 s timeout). AudioYam's public pack uses https://sources.booksources.workers.dev/abb/search?q=
  (Cloudflare worker, 45 s). So the difference is the server: likely AudiobookBay intermittently refusing /
  slowing the Cloudflare worker (or its domain list being out of date) while the + server gets through. To do
  (when told): compare the two servers' ABB code (domains / mirrors, headers, retries), port what makes the +
  one reliable into the public worker — without anything private (no + server address in AudioYam).
- NOTED 25 Nov (asked, NOT built — design change, show sample first): a series (e.g. Weeb Central Solo Leveling,
  201 chapters) should be ONE book, not a chapter list + one book per chapter. Plan: one shelf item per series
  (uid by series url), progress = { chapter, page }; result row "Read" (start / Continue · Ch 13) + "Chapters"
  optional; reader flows from the last page of a chapter straight into the next (swipe on, no button needed),
  a chapter picker sheet in the reader (current marked, newest/oldest toggle), Continue / Library show
  "Solo Leveling · Chapter 13 · page 5"; old per-chapter entries folded into the series. Same model can later
  serve GetComics/IA issues of one series.
- 25 Nov: user — GlobalComix is paid, remove it. Worker 2.7.1 (handoff/workers/audiohub-comics.js): no GlobalComix
  webSearch link, route (404), registry entry or web_search in /api/search. Manifest webSearch = Comics Plus only.
  App unchanged (webSearch is generic); the link disappears once 2.7.1 is deployed and the manifest refreshes.
- 25 Nov: user's library Comics Plus (daytonmetrolibraryohfl.librarypass.com) redirects every page to
  login.librarypass.com, /search is 404, robots.txt Disallow: / → it can't be searched. User: show it only when it
  has a result, else nothing → app: webSearches().searches (url has {TITLE}); results show only searching links;
  site homes (Comics Plus) → Settings → Addons → Audiohub Comics → Your details → "Open Comics Plus" (in-app
  screen). Comics Plus link on the phone opened a worker "Route not found" page → their saved library link is
  probably the worker/manifest address — asked the user to check Your details.
  Confirmed: the saved value was "https://audiohub-comics…/manifest.jsonhttps://daytonmetrolibraryohfl.librarypass.com/"
  (pasted onto the manifest link). Fix 0a34ef3: webSearches uses the last http(s) link in a field (test). The
  library link itself opens the Dayton Metro LibraryPass sign-in fine (checked in an emulated phone).
- 25 Nov comics site checks: YSK Comics (ysk-comics.com) — no bot check, search/series allowed, but pages only via
  /api/v1 which robots.txt disallows → user: avoid it. comicslovers.com — every URL is a JS redirect to /lander
  (parked/lander shell, renders empty in an emulated phone) → not the Hindi comics site; asked the user for the real
  address. BatCave — no address yet. Comics Plus in app reader: impossible (DRM / licensed reader); offered
  full-screen web screen or the official app — waiting for the user's choice.
- NOTED 25 Nov (just note): the Hindi comics site (old comicslovers.com, now parked; real address not given yet)
  sends download links through GPLinks. App won't get past GPLinks itself. User could pay GPLinks premium (~₹5/day):
  then — sign in once in the app's web screen (InkwellWebActivity keeps cookies), Download options open links
  there, premium passes straight to Drive / Mega, finished Drive downloads caught and put on Comics (like
  importDownload); Mega usually needs the Mega app (decrypts in page) → hand over, then Add files. Needs the
  site's real address + a sample comic page first.
- USER 25 Nov: "Leave comics for now." Open comics items (all noted, none started): comic book page says
  Ebook + Listen; series as one book (sample first); fan-fiction EPUB from the book-page ebook lookup; Comics Plus
  full-screen vs official app (choice pending); GPLinks site; BatCave (no address); CBR reading; chapters offline;
  worker 2.7.1 to deploy; unbuilt on work since APK #45: b6d40da (Comics Plus → settings), 0a34ef3 (last link).
- COMICS WRAP-UP 25 Nov (user: finish the pending comics items, then enough; keep only GetComics, Internet Archive,
  Comics Plus). Worker 2.8.0 (handoff/workers/audiohub-comics.js): Weeb Central, ReadComicsOnline, Kitsu removed
  with routes (404); sources getcomics / internet_archive / comicsplus; tested live. App (work): CBR via
  node-unrar-js 2.0.2 (MIT; src/lib/cbr.js + cbr-wasm.js, wasm 208 KB lazy; tests/cbr.test.js with real RAR4/RAR5
  fixtures from the rarfile project in tests/files) — open, keep (CBR), cover, Read in Download options, Add files
  (Android/iOS pickers, Open with, folders); comic book page says Comic/Manga, no Listen / AskCard, badges Comic;
  fan fiction: src/lib/fanfic.js (tests) ranks it last in findEbookInSources and loadEbook refuses+marks a
  fan-fiction EPUB from a source; Comics Plus web screen reader mode (InkwellWebActivity "reader" extra: no Copy
  link / Desktop view, black slim bar, fullscreen). Dropped with the removed sites: series-as-one-book, chapters
  offline, GPLinks/BatCave/YSK. The generic chapter / issue-list code stays (addon features, unused by 2.8.0).
  Not built yet. Comics DONE unless the user asks.
- CORRECTION 25 Nov: user — keep Weeb Central too ("keep weeb central, internet archive, comic plus"); GetComics
  kept as well (it was on the previous list; told the user, remove only if asked). Worker 2.8.1 = 2.7.1 minus
  ReadComicsOnline + Kitsu: sources getcomics / internet_archive / weebcentral / comicsplus (tested live: Chainsaw
  Man 232 chapters, 30 pages). 2.8.0 superseded. Series-as-one-book and offline chapters are back on the noted
  list (sample first), not started.
- 25 Nov: user — include them. BUILT (work): series as one book (lib/comics seriesBook / chapterIndex /
  seriesPercent, tests; uid ser:…#comic, ebookFormat SERIES, ebookUrl = issues list; reader loads the list, opens
  your chapter / the picked one / chapter 1 (oldest), page turns past a chapter's end flow into the next / back into
  the previous, Chapters sheet in the reader bar, progress comicChapter + comicChapterTitle + series percent; old
  pg: chapter books upgraded to their series and pg progress entries folded; result row Read / Continue · Chapter N
  (useStoreKey) + Chapters; IssueList Read → series at that chapter; chapterBook / nearChapters removed). Offline
  chapters: src/lib/chapters.js (Cache API 'audioyam-chapters', keptChapters store, keepChapter / keptChapter /
  forgetChapter, series list kept for offline) — phone app only (image host sends no CORS; Capacitor's native fetch).
  Browser-tested live (Solo Leveling: Read → Chapter 0, last page → Chapter 1, back → Chapter 0's last page, sheet
  201 chapters, pick Chapter 5, Continue · Chapter 5, one Library entry). Offline download NOT testable here (web has
  no native fetch) — check on the phone. Comics now has nothing open besides phone checks.
- 25 Nov, message from the Audiohub+ session: it fixed four of the 25 Nov feedback items in Audiohub+ commit
  f9660234 (inkwell/): (1) author page — people.js mentionsBook(text, titles) + bioOf(name, titles) checks the
  Wikipedia summary names one of the person's books, else Wikipedia search "name + first title", Open Library 5
  authors picking the one whose top_work is one of the books, cache v2, Person.jsx passes titles; tests/people.test.js.
  (2) source cards: override .src-actions.ready > .btn:first-child min-width inside .src-row (92px, 40px high,
  padding 0 9px, 12.5px) so Read + Save + Kindle + … stay on one row at 390 px; .src-more / .src-fold width
  calc(100% + 20px), margin -10px. (3) whole "Downloading for you" card tappable. (4) iPhone .mp4 import: picker
  .mpeg4Movie, Swift audio set + mp4, local.js AUDIO mp4 on iPhone only. → To PORT to AudioYam when the user says
  (3-way merge as before; scrub anything private). Not ported yet.
- NOTED 26 Nov (Reddit, r/audiohubapp, Shabbypenguin): "different voices on iOS? choose voice setting but you can't
  install or pick any others". Cause: on iPhone only SystemVoices (settings-extra.jsx) — Microsoft (Edge) needs
  nativeReader and offline voices need InkwellVoices, both Android-only; and tts.voices() reads
  speechSynthesis.getVoices() once (WKWebView fills it async → empty/short list, no voiceschanged wait).
  To do (when told): wait for voiceschanged + re-list; iPhone hint "add voices: Settings → Accessibility → Spoken
  Content → Voices (Enhanced / Premium), they then show here"; bigger: an iOS AVSpeechSynthesizer plugin (premium
  voices, screen-off) and/or the Microsoft voices on iPhone.
  26 Nov user: "go for both". BUILT (work): ios-plugins/tts (InkwellTts, Swift, AVSpeechSynthesizer: getEngines /
  getVoices (identifier as name, title with Enhanced/Premium, quality 300/400/500, novelty voices skipped) / speak
  (.playback + .spokenAudio) / stop / synthesize (write → WAV in Caches via a temp *.part.wav) / clearCache), added to
  ios.yml; nativeTts true on iPhone → Listen narrates into an audiobook for the iOS player. settings-extra: v.title,
  iPhone "More iPhone voices" hint instead of Play Store engines, re-list on return. tts.js web voices wait for
  voiceschanged (≤2 s). Microsoft voices NOT ported to iPhone: EdgeTts is an unofficial protocol posing as the Edge
  browser with its built-in token — declined; Apple Premium voices offered instead. Swift not compiled here (no
  Xcode) — needs an iPhone build ("build iPhone"; ios.yml is manual).
  26 Nov: iPhone build 12 (e8f1fe5) passed — InkwellTtsIos compiled in. User checks voices on the iPad at home.
  User: "comics thing needs more refinement" — no specifics yet; wait for the user's list / screenshots.
- Comics refinement 26 Nov: (1) Download options cluttered (How To Download, YAC Reader, ComicRack, CDisplayEx,
  7-Zip, Related Article) → worker 2.8.2 isDownloadLink (GetComics: /dls/ or download/mirror/host labels; else known
  file hosts or file extensions; NOT_DOWNLOADS list) + app comiclinks.js NOT_DOWNLOADS (test) + Download options
  shows files first, browser-only mirrors under "Other mirrors (N)". (2) Read download stopped when leaving the page
  → src/lib/comicdl.js: Android DownloadManager for comic files (persisted pending, 1 s watcher, resumes after
  restart via app.jsx import, imports when done → Comics shelf, toast "ready — Library → Comics"); reader uses it
  for remote CBZ/CBR (not loc:), refused files too; Save for comics uses it. (3) Tapping a saved .cbz/.cbr offered
  no AudioYam → AndroidManifest VIEW + SEND mime types for comicbook zip/rar, x-cbz, x-cbr. Not built yet.
  (4) No file size while downloading → worker 2.8.3 reads the GetComics details line ("Language : English | Image
  Format : JPG | Year : 2026 | Size : 127 MB") into details + size_bytes on direct links; app comiclinks
  releaseDetails / link size (tests), Download options header "CBR · 127 MB · English · 2026", Read/Save pass the
  size, progress falls back to it. (5) Ebooks and comics had the same icon → new 'comic' speech-bubble icon for comic
  results. Fixed: comicdl follower keys (string ids) and the reader's listener left behind after leaving.
  (6) No covers on comic results → worker 2.8.4: GetComics search via wp/v2/posts (_fields incl.
  jetpack_featured_media_url, excerpt) → cover, "Year : | Size :" + blurb from the excerpt, publisher from the URL
  section (/dc/, /marvel/…), size_bytes mapped; IA cover = archive.org/services/img/{id}. App: r.publisher, r.blurb
  (2 lines), size in meta. (7) "Comics can have a similar page" → comicPage(r) (comics.js, test) opens the book page
  (kind discover, comic, source cmx): whole cover, Comic · size · year, by publisher, blurb, Where to read it with
  SourceResults; no Goodreads/Audible/editions/Usenet for comics. Fixed Cover (common.jsx): tall pictures shown whole
  (shaped ratio wins over the fraction-based frame), and a cached cover's ratio re-read after the uid reset effect.
  Optional later: ComicVine (free API key, worker secret) for writers/artists/issue data — not added (needs a key).
- NOTED 26 Nov (user shared a "dream comic/manga reader" vision, from another AI chat): immersive reader, modes
  (RTL/LTR/vertical/paginated/double spreads), page transitions, reading environments (warm paper, OLED, sepia,
  grayscale), PanelFlow (panel-by-panel), smart zoom, character encyclopedia, panel memories, AI translator /
  tap-to-understand / Who's who / recaps with Spoiler Shield, image enhancement, streaming-style library (reading
  now / on hold / plan to read / completed / favourites / collections / smart filters / stats), chapter preloading,
  auto-download on Wi-Fi, volume keys, gestures, one-hand mode, AniList/MAL sync, mood shelves, ambient themes.
  Gap analysis + proposed order given in chat; nothing built — waiting for the user's pick / "go" (samples first).
  Sample sent 26 Nov: handoff/samples/audioyam-comic-reader-next-sample.png — reader themes (OLED / warm paper /
  sepia / grayscale) + page turn + volume keys + orientation lock; "This page" sheet (Translate / Explain / Who's
  who / Save panel, spoiler-safe, your AI key); "Previously in…" recap with Continue; Comics shelf statuses
  (Reading / Plan to read / On hold / Completed / Favourites) + panel memories; tablet double-page spread with
  next chapter preloaded. Waiting for feedback / "go".
  26 Nov user: "Build all" → BUILT (work bff5ed4) + test APK started: comicLook {theme oled/paper/sepia/gray (filter +
  bg), turn slide/curl/fade/none (keyed .comic-page animation, rtl mirrored, reduced-motion off), pages single/
  double/auto (landscape) via comics.js spreadStart/turnSpread, volume (Android: InkwellWebPlugin.volumeKeys +
  MainActivity.dispatchKeyEvent → "volumeKey" event), orient (InkwellWebPlugin.orientation)}; long-press / ✦ →
  PageSheet (comic-extras.jsx; lib/comicai.js askPage via askAiImage, pagePrompt spoiler-safe, answers kept in
  comicNotes for recaps; Save panel → lib/memories.js snapshot (crop when zoomed) + addMemory); RecapCard (offered
  when a series is reopened after 7+ days, or Settings → Recap so far; recapPrompt); next chapter preloaded near the
  end ("Chapter N ready"); lib/comicstatus.js (hold / completed) + comics.js shelfStatus → Library Comics chips
  Reading / Plan to read / On hold / Completed / ♡ Favourites + Panel memories row (tap → reader startPage, long-
  press → remove). Browser-tested (themes, curl, long-press sheet, no-key message, memory saved + opens at page,
  spreads 2–3 → 4–5, recap card, chips, Weeb Central "Chapter 1 ready"). Not tested: AI answers (no key here),
  volume keys / orientation (Android only).
- NOTED: fan-fiction EPUB ("JUSTICE(1) Batman: Under the Red Hood", fanfiction.net) opened as the comic. Live
  worker 2.7.0 returns only GetComics for that title, so it came from the app's ebook lookup on the book page
  (Internet Archive EPUBs). Asked where it was tapped. Fix idea: for comic titles, don't offer "the ebook" from
  generic ebook search, or filter fanfiction (Publisher: www.fanfiction.net / FicFab packages).

## GitHub issues #12 / #13 (26 Nov)
- **#12 "Torbox music"** (Shabbypenguin, iPhone): the song "sombr — 12 to 12" was in the Home banner with "Show music too" off. Fixed on `work` (612fffe, not built):
  - the banner (`heroCache`) and the TorBox / Real-Debrid rows now reload as soon as the switch changes (`forgetHero`, `clearRowCache`, banner effect depends on `showMusic`);
  - the music check moved to `src/lib/music.js`, tested in `tests/music.test.js`; a single FLAC / WAV file under 150 MB now counts as a song.
  - Still a guess: a song without file sizes from TorBox can still slip through. If it happens again, ask for the item's exact name. No reply posted.
- **#13** (tehrzky, feature request): done on `work`, not built. When no cloud service and no home server are set up (`offerTorrentApp`), torrent results show a "Torrent app" chip. Android opens the magnet (`InkwellWeb.openExternal`, ACTION_VIEW); if no app takes it, the magnet is copied. iPhone copies it; web opens it and copies it.
  - `src/lib/magnet.js` now holds `TRACKERS`, `withTrackers` (moved from qbit.js, which re-exports it) and `appMagnet`; tested in `tests/magnet.test.js`.
  - What's new card added, EDITION `nov-2026i`. No reply posted on GitHub.
- Built 27 Nov: test APK (run 48) and iPhone ios-14 from 368661a, both green (include #12, #13, iPad Save to Files). Not released to main.

## Premium polish (27 Nov) — BUILT on work (user: greeting + name on one line, tagline stays; will judge in the app)
- handoff/samples/audioyam-premium-sample.html/.png: Fraunces heads + spaced eyebrow labels, book-like covers (spine shade, 2-layer shadow), 1px top sheen on cards, glossy accent pills, cover-colour glow, film grain (off on AMOLED / reduce motion), 20/30 px spacing, fewer top-bar icons (Ask into search, tagline gone), floating glass tab bar. Applies on top of every palette. Nothing built.
- Done: `src/premium.css`, loaded after styles.css, everything under `:root[data-polish]`. Set by applyTheme unless `settings.finish === 'plain'`; Settings → Appearance → Finish: Premium / Plain.
  - Fonts: own `--serif` (Fraunces), because some palettes set `--display` to their plain font. Row subtitles become spaced labels above the title (column-reverse). Greeting stays on one line (clamp + ellipsis), name in an accent italic `<em>`.
  - Covers get a spine via `.cover::before`; `.cover::after` already had the sheen.
  - Tab bar floats with NO backdrop blur (blur was removed earlier for Android scroll flicker); `.tabbar::after` is a fade behind it; `--tabbar-h` is 76px.
  - Ask button kept in the top bar. What's new EDITION `nov-2026j`. Test APK + iPhone build started.
- Fixes from the user's first look (27 Nov, on work, not built yet):
  - the gloss is now shadows only (background-image hid gradient-painted buttons in dark themes);
  - tabular numbers only in the player and progress lines (they cut "4.1 (2" on cards);
  - grain sits behind the content (z-index -1);
  - dark mode --muted / --faint mixed closer to --text;
  - Home banner 236 px with a lighter edge in dark.
- Torrent app follow-up: the user chose the external app ("no compromise on battery"). Done on `work` (ec71c01), not built.
  - Settings → Torrent app (Android only, `TorrentAppCard`): pick an app (`InkwellWeb.magnetApps`, `<queries>` for magnet) and its "move after download" folder (added as a phone folder). Stored in `settings.torrentApp {package, name, folder, folderName}`.
  - Play on torrent results (no cloud, no home server) → `src/lib/appwait.js` `playViaApp`: if the book is already in phone folders it plays; else `openExternal({url, package})` and an entry in `torrentAppWaits`.
  - The folder is checked every 20 s ONLY while the app is visible (timer cleared when hidden). `findDownloaded` (magnet.js, tested) matches by samePhoneBook or folder name (local.js audio books now carry `rawName`). Gives up after 3 days. Auto-plays unless something else is playing.
  - Playing a half-downloaded book: NOT done. Libtorrent apps preallocate files, so completeness can't be told; the user was told to use the app's "move after download" folder.
  - What's new EDITION `nov-2026k`.
- 27 Nov, user test of run #50: a book played at 20% (the user's app downloads INTO the chosen folder; files are preallocated at full size, sequential didn't help). Also, Play after deleting the download played the stale scanned entry (IO error).
  - Fixed on `work` (e54f519), not built: `InkwellLocal.filled({uris})` reads 7 × 16 KB blocks per file (incl. the last); any all-zero block = not complete.
  - JS `finished()` rescans, then checks the size (≥ 95 % of the result's size) and `filled`. The same check runs before Play's "already there".
  - Settings text: the folder = the one it downloads to.
- Ebooks via torrent app (on work, not built): Read → playViaApp(r, book, 'text'); findDownloaded matches kind both ways (+ ebookName); complete() checks ebookUri; opens nav.push('reader'). Save/Kindle hidden when viaApp.

## Audiohub+ → AudioYam: not ported yet (checked 27 Nov; Audiohub+ commits since the last port base 41dac5c)
User: skip Audiohub+'s new look. PORTED 27 Nov (all below except Mobilism / look / c1699299 / 82cfee01).
- Fixes:
  - f9660234 (iPhone .mp4 import + why a file failed; right author on author pages; tidier source cards; Downloading-for-you card opens).
  - 06cb3557: Audiobookshelf whole library (AudioYam still has limit 500 in audiobookshelf.js) + recent searches only while typing.
  - 5682af2b: a same-author different book shows as "on your Audiobookshelf".
  - c01e080e: deleted bookmarks / highlights come back via sync — only if AudioYam's account sync has the same path.
- Features:
  - ae7926e1: Discover Free tab (LibriVox + Gutenberg; AudioYam has the sources, no tab).
  - ee11545f: Home "Come back to …".
  - 3f6cc783: Listener Challenges.
  - 1bddae54: quote postcards.
  - 6c9dec6a: Talk (ask out loud in the player).
  - 8f81459d: Whisper Notes.
  - 982ef590: Time Machine search.
  - 91a9c427: pick the ebook for Text (15 s auto).
  - 7c13293a: bigger cover in the Picked-for-you banner.
- X-Ray family: a7b1877a (Character Tracker), 7397d43e (relationship map + Wikipedia photos), b38456d9 (Fandom pictures), abafa7ac (map redesign), 8cbbe520 (character card fix).
- Never: 452b5223 (Mobilism). Skipped: 1a246588 / 76fba596 (look), c1699299 (AudioYam already has it).

- PORT DONE 27 Nov (work 4ee6223, test APK + iPhone build started). Method: `git am -p2 --3way` of per-commit patches (inkwell/ paths), with bytewatch objects as a temporary alternate (removed after repack).
  - Already in AudioYam: c01e080e.
  - Hand-merged: transcript-view (AudioYam's takeEbook kept; then added `onDownloadProgress` in http.js — getBytes tells subscribers — plus the progress line in Text "Get the ebook").
  - local.js / InkwellLocalPlugin.swift: mp4 on iPhone AND cbz/cbr kept. AudioYam names kept (AudioYam downloads, Open in AudioYam). Tidy screen NOT ported (only the Time Machine link). qbit.js imports trimmed.
  - What's new EDITION `nov-2026l` (3 cards). iOS mic text mentions Whisper Notes.
  - New port base for next time: Audiohub+ abafa7ac.
- Still pending in AudioYam (need the user / outside):
  - AudiobookBay public worker reliability (compare with the + server, nothing private);
  - Find books from a link (needs an example link);
  - battery "what was busy" line;
  - GitHub replies;
  - TestFlight secrets;
  - Support link;
  - ComicVine key;
  - GPLinks site address;
  - comic vision items;
  - release to main.
- AudiobookBay "down" FIXED (27 Nov) in the public worker `inkwell/workers/public-addons.js` (the public worker's own file; Audiohub+ uses its server):
  - Cause: a search with no results came back without the "Nothing Found" words, so every mirror was tried (.fi gives HTTP 526) and the worker answered 502 "AudiobookBay didn't answer" after ~17 s. The app then retried and said down. Reproduced with q=xqzv nonsense; real titles answered in 1–2 s.
  - Fix: `abbAnswered(status, html)`: any 2xx full HTML page from the site counts (bot-check / parked pages don't); 10 s per mirror. Test in inkwell/tests/publicaddons.test.js.
  - The USER must paste the file into the sources.booksources.workers.dev worker.
  - Same fix for LibGen (27 Nov): a search with nothing found (no results table, HTTP 200) threw 'No LibGen mirror answered' → 502 'down'. Now `libgenDown(pageReports)`: only no answer / 5xx / 403 / 429 counts as down. Tested.
- Torrent app progress % (27 Nov, work, not built): InkwellLocal.filled now samples about 120 × 16 KB blocks shared by file size and returns { complete, fraction }. `downloadProgress` (magnet.js, tested) caps at 99 % until complete. appWaits entries store pct / found / doneOnce; the book plays only after 2 complete checks in a row; checks every 15 s while visible. The result shows 'Starting in X…' and then a bar with %.
- Free tab speed (27 Nov, work d0f0f25, not built): it waited for both IA (~0.5 s) and Gutendex (slow) — now each list shows on arrival; Gutendex timeout 12 s; the last list per lang|genre|sort is kept (freeClassicsSeen, 1 day, 8 newest) and shown at once.
- Phone copy deleted (27 Nov, work, not built): local.details throws { gone: true }; Book.jsx then shows the page as kind 'discover' (goneFromPhone): a quiet note, Where to get it, findEditions + SourceResults, no red error, no Phone badge.
  - Extended (27 Nov): tbDetails (missing or download_state inactive/expired), rdDetails (404 unknown_ressource, or status dead/error/virus) and RD sent/downloaded lists throw { gone: true }. Book.jsx uses goneFrom = source for the note. Offline downloads whose files were deleted already stream again (iPhone afterFiles; Android player falls back).
- ABS still 500 on APK #51 (user, 27 Nov). Likely cause: page 2 failed or timed out (15 s), all() threw, and the persisted yourBookCounts kept the old 500. Fix (work, not built):
  - `count()` = sum of server totals (limit=1) for the tile;
  - pages 60 s (call() now passes timeout);
  - allPages retries a failed later page once, then returns what it has (partial). Test added.

## Pipeline (27 Nov)
- Ko-fi / GitHub Sponsors: the user will make a page. When the link comes, fill KOFI_URL / SPONSORS_URL in src/components/report.jsx (the line stays hidden until then). Remind them daily.
- Daily check-in: scheduled task "AudioYam daily pending + ideas" (trig_01PCpiyjJTBAffk5JnV6Rknr), 9:23 am IST, fires into this session. It covers pending items + new GitHub issues + 3–5 fresh suggestions (logged below under "Daily suggestions"). It never builds, pushes or posts by itself.
- Public sources worker: fixes live (checked 27 Nov: empty AudiobookBay / LibGen searches → 200 []); the label still says 1.0.0 (the user pasted the file before the bump).

## Daily suggestions
- Settings → Storage (27 Nov, work, not built):
  - Android: InkwellWeb.storageUsage / storageClear('update'|'temp'); temp spares local-covers and the WebView dir (clearCache(true) instead).
  - InkwellUpdatePlugin.load() deletes the old update APK at start.
  - src/lib/storage.js storageGroups / voiceLabel / fmtBytes (tests/storage.test.js); components/storage-card.jsx; epub.js ebookBytes, chapters.js chapterBytes.
  - Remove: forgetEbook, forgetChapter, removeImported, voices.remove. On iPhone only the app-side groups show.
- Comics & ebooks in Downloads/Audiohub (27 Nov, work 8ecba68 + fix 4a?, not built; Android only):
  - Native: InkwellDownloads writeStart / writeChunk (base64, 3 MB) / writeEnd / adopt (own 'files' executor); saveToDownloads folder param; importDownload { link } returns the DownloadManager uri (no copy).
  - lib/sharedfiles.js (folderFor, fileName, mimeOf tested). epub.js keepBytes writes there (savedEbooks fileUri); cachedBytes reads via convertFileSrc and forgets a deleted file; forgetEbook deletes it.
  - One-time moves: Cache API → Downloads (savedEbooks.__moved, 20 s after start); files/books → adopt (localCfg.movedOut, 25 s).
  - local.js imported shared entries: ebookUri; details 'gone' check by Range fetch. comicdl → Audiohub/Comics.
  - Storage screen: group 'shared' (outside the app's total).
  - Lesson: an unescaped apostrophe in whats-new broke the build, and was pushed because the commit didn't stop on lint. Always check lint output before committing.
- Text free highlighting (27 Nov, work, not built): .tl is user-select:text (was none + touch-callout none). Long-press-a-line removed. selectionchange inside .transcript → floating .tl-sel-bar (Highlight → player.toggleQuote(time at the selection start via data-w / data-i, text), Copy). A tap while selecting doesn't seek. Ebook sentences inside a quote get .tb-s.hl.
- 27 Nov: ported Audiohub+ X-Ray commits a479b575, e8be964e, 4cd61da8 (photo from the character's own page; no mother / family / wand pages; scene-card names readable, card photos, themed search box); styles conflict → kept only the X-Ray part. New port base: 4cd61da8. Not yet ported (offer): b7ff931e / 9e891158 / a88a3241 Text view (tap plays, light-mode readability), 1b94ea49 ABS speed. What's new rewritten for the release: 9 cards, EDITION nov-2026-release. Test APK + iPhone ios-19 started from 2b40e39.
- RELEASED 27 Nov 09:04 UTC: main = work 2b40e39 (fast-forward; banned-words grep clean). Android release + web deploy running; the version is expected to be 1.0.56. Reddit post: handoff/release/audioyam-reddit-post.md (title without AI features; put the version in the title once confirmed).
- RELEASE CONFIRMED: v1.0.56 (https://github.com/drdilips1/Audiohub/releases/tag/v1.0.56, AudioYam-v1.0.56.apk 22.5 MB, published 09:07 UTC). Web app workflow run 16 succeeded. Release base for the next notes: 2b40e39.
- Reddit 27 Nov (after v1.0.56):
  - (1) iPhone ios-19: Find books → Photo of the cover crashed. Cause: no NSCameraUsageDescription. Added it, plus NSPhotoLibraryUsageDescription, in ios.yml.
  - (2) 'Gap between the navigation toolbar & keyboard': the iOS form accessory bar (⌃ ⌄ Done). Added @capacitor/keyboard 8.0.5; main.jsx hides the accessory bar on iOS only.
  - On work, NOT built (needs 'build iPhone').
- Store edition (27 Nov, user: sources and debrid stay as bring-your-own with neutral wording): on Audiohub work, not built.
  - src/lib/edition.js STORE (VITE_EDITION=store); ios.yml input edition full|store.
  - Hidden in store: qBittorrent, Tracker, Torrent app, Usenet (settings + Book page); seeds; torrent hand-off. Wording: 'Your cloud services' / 'Default cloud service' / 'Connect your cloud service'. What's new: full-only cards + storeText.
  - public/privacy.html (+ #support). Delete my account added (sync.deleteAccount + SQL audiohub_delete_me — the user must re-run the setup SQL in Supabase).
  - Review notes: store-edition/APP_REVIEW_NOTES.md.
  - Open: Sign in with Apple if Google sign-in is offered; age rating; screenshots.
- 27–28 Nov, Reddit (nikhil48) + user (work c347fb6, not built):
  - Ebook Pages layout: settings.readerLayout 'pages'; lib/paging.js (tested); Reader columns via --colw / --gap / --aw; paged firstVisible / reveal / goPage; tap or swipe turns; Page X of Y; FollowAudio takes reveal / paged; chapters content-visibility visible when paged. Checked in the browser with a 5-chapter EPUB: 44 pages phone, 19 tablet (2 columns), taps and swipes turn.
  - Ebook recap: lib/ebookrecap.js (recapDue after 7 days, readSoFar, ebookRecapPrompt; tested); recap panel in Reader (auto when due + Contents → Recap the story so far).
  - Discover .d-tabs one line (from Audiohub+).
  - Also on work: Home horizontal overflow fix (a7ac629), iOS camera / keyboard (425aac6). What's new EDITION nov-2026-ebooks.
- 28 Nov:
  1. Port Audiohub+ 1b94ea49 — Hidden gems / Browse open in seconds (Audiobookshelf read once, pages fetched together, kept 10 min). Speed.
  2. Port Audiohub+ b7ff931e / a88a3241 — Text view: tapping a sentence always plays from it; readable in Light mode.
  3. Ebook dictionary: long-press one word → a quick definition from a free dictionary, no AI key needed.
  4. Stats → "Your month in books" share card (image), so listeners spread the word instead of Reddit posts.
  5. Store-edition App Store screenshots made automatically from the web build (Playwright, the 6.7" and 5.5" sizes).
