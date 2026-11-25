# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.243; iPhone build 125 (25 Nov — iPhone downloads + Send to Kindle, .mp4 import, bookmark/highlight sync, Text "Ask me" ebook, author check, ABS > 500, Discover recent, bigger Picked-for-you cover; everything below is in them unless marked Not built yet).
- In v1.0.233 / iOS 114 (built 21 Nov): instant play (server place asked in the background),
  glow fade on player background, Libby live availability, auto-send never re-sends backlog + skips torrents
  qBittorrent has, Goodreads clearer refusal + CSV hint, ebook cards, banner title fit, Play timing line.
- Pending / feedback: see `inkwell/ROADMAP.md` (sections "Feedback 19 Nov", "Feedback 21 Nov", Usenet,
  book page people row, AudioYam items).
- Done 21 Nov (in v1.0.233 / iOS 114; shared `inkwell/src/` code, used by Hearth / Duet / Audibrisk too):
  - Android Auto, screen off: skip buttons seek on the phone itself (`setSkips`, no app JS needed);
    the app's page is kept "visible" while playing or after the car connects (`MainActivity.onStop`,
    `InkwellPlayerPlugin.wake`), so car picks / searches are answered; the car shows "Loading…" + the
    book's name while the app prepares a pick (`setCarLoading`) instead of "Media isn't available".
    Needs testing in the car.
  - Find and play: `sameBook` (match.js, tested); server / cloud copies found by `findOwned` are taken
    as they are, Library books count; Find books updates a book to "Yours" when a slow check answers.
  - Long-press → Play on Home for catalogue books: `getAndPlay` (your copy, else best source).
  - Player opens with no animation (cover fly / slide-up removed; background + glow fades kept).
  - Get the ebook: Knaben Ebooks torrents included (through TorBox / Real-Debrid), Knaben first,
    LibGen last; the phone's LibGen fallback tries every mirror.
  - Home greeting smaller, no "time left" line; book page ♡ (Library) moved next to 👍 / 👎 from the
    action row; Library → Found → Edit removes single books (bin = that list only, asks first);
    source results get a heading per source inside Audiobooks / Ebooks; Settings search box (filters
    the rows on the page, every section searched; `ELSEWHERE` shortcuts e.g. phone folders) and
    keywords on key sections.
- 19 / 21 Nov feedback: all done, built in v1.0.233 / iOS 114. Needs real-world checks: Android Auto in the
  car, the iPhone files plugin (first iOS build), the new debrid services with real accounts.
- Frosted-glass card (user picked "your choice" from samples based on their 21 Nov design image):
  `components/glass-card.jsx` on Home's Continue listening and the book page top (replaces the old
  Continue card, the big hero cover and the By / Read by row). Whole cover left (not cropped), the
  cover blurred behind 150 px glass panels (Author, Narrator — tap for their page; Duration; Format
  or, when in progress, % + time left + gold bar), dark strip with title + ★ (Goodreads). Pale
  covers darken the glass (`coverLight` / `meanLight` in color.js, tested). Small covers too:
  `BookCard` (common.jsx) glass mode — title + ★ strip on the cover, two chips (length + format, or
  % + "6h left"), gold progress line; Settings → Appearance → Book cards: Glass (default) / Classic.
  Library's Continue card is the glass card as well.
- Real-Debrid on other phones: books sent from a topic were kept only in the sending phone's
  `rdSent`; now Real-Debrid's own /downloads list is grouped into books (`lib/rdgroups.js`, tested;
  uid `rd:d:…`) on every device. RD torrents are read page by page (was the first 200 only).
- iPhone own files: `ios-plugins/files` (Swift, jsName `InkwellLocal`, same calls as Android:
  pickFolder / scan / cover / pickBook) — books live in the app's Documents, shown in the Files app
  (Info.plist UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace, set in audiohub-ios.yml);
  Add folder / Add files copy in. Rescanned at start (the container path changes per update).
  Compiled in iOS build 114.
- Person page voice: `voiceSample` / `voiceSearch` (people.js, tested) — a sample of a book the
  person reads (authors who read their own), else a YouTube search; "Where to start" beside it.
- More debrid: `sources/moredebrid.js` (AllDebrid v4 with apikey, Premiumize apikey, Debrid-Link v2
  bearer; tested with sample answers, not with real accounts). Sources `ad` / `pm` / `dl`;
  `debrid.js` routes prepareMagnet / downloadLinks / addMagnetOnly / details / verify / addLink;
  `connectedProviders`, `providerName`; Settings has a card each and Default debrid lists every
  connected one. No instant-cache badges for the new ones (they show as "fetch via …").
- After v1.0.233 (user feedback on the build): small covers are now the glass card itself
  (`GlassCard small`, 272×164 in rows, one column of them in grids) — cover uncovered on the left,
  panels on the right (author, narrator, length or progress, where it is), title + ★ strip; nothing
  under the card (match %, StoryShots S and the facts lines are gone in glass mode). Big card: the
  source is a "From" panel, panel borders fainter. Discover's "Picked for your taste" is a glass card.
  In v1.0.234.
- Glass panels: icons only (feather = author, headphones = narrator, clock, bookmark = file type,
  cloud = where), file type its own panel when there's room (5 big / 4 small), else joined to the
  length. Own files easy to find: Settings → "Your files on this phone" (first under Where your books
  are: folders, Add folder / Add files / Rescan, Show them) and a Library home button. In v1.0.234.
- Home: every service has its own row(s) in "Your services" (TorBox, Real-Debrid, phone, AllDebrid,
  Premiumize, Debrid-Link — like Audiobookshelf); the combined "Recently added" row is gone; the
  "Your books" count tiles stay. Source results: each source in its own box (name + count). In v1.0.234.

  Panel borders now very faint (0.07 white), softer fill.
- 21 Nov, after v1.0.234: the user asked for every cover as it was before 21 Nov — the glass cards
  (big and small, glass-card.jsx, Book cards setting, coverLight) are removed; Continue card, book
  page hero, Library Continue card, Discover pick and small covers are back to the 20 Nov look. Kept:
  a stronger glass sheen on all covers (`.cover::after`), and everything else from 21 Nov (service
  rows on Home, source boxes, phone-files shortcuts, ♡ by 👍/👎…). In v1.0.235/236.
- Newest first: debrid rows sort by date added only (not last played); phone books carry the files'
  date (Android scan COLUMN_LAST_MODIFIED, iOS contentModificationDate → `addedAt`, one rescan on
  update: localBooks v3); new debrid services sort by date; Shelf's "Recent" sorts by addedAt.
- Library header: folder button beside search → phone files view (Add folder / Rescan there); no folder yet → picker.
- Delete a book: press-and-hold → Delete… (forgetBook + download + Up next + Read later + ebook; folder books hidden via localCfg.hidden, Settings can bring them back; TorBox t/u/w and Real-Debrid torrents deleted from the cloud when confirmed — `deleteFromCloud`). In v1.0.236.
- Book page: Listen (narrower) and the download button on one line (download on the right). Source boxes: class renamed src-group (src-sub clashed with each row's subtitle), snugger margins. In v1.0.236.
- Book page: the audio files list moved up beside Ebook files, same rows (type / part chip, name, length · size, ▶); first five shown, Show all for more. In v1.0.236.
- 21 Nov evening: book page audio files fold to the one you're on when there are more than 5;
  iPhone Settings card says "Audiohub for iPhone build N" (not "web app"); Hear the voice only with a
  real sample (YouTube fallback removed); Get the ebook lists the best 3 per source (LibGen no longer
  pushed out by Knaben) with a cover thumbnail left, "Show all". In v1.0.236.
- Send to Kindle through any mail server (Reddit request, zfa): `lib/smtp.js` (tested) picks the
  sender's own host / port / security / username, else the provider's (Gmail, Outlook, iCloud, Yahoo,
  Fastmail, Zoho, GMX, AOL, Yandex, web.de), else Gmail as before; `GmailSender` now does SSL,
  STARTTLS or plain on any host; Settings → Send to Kindle "Use my own mail server". In v1.0.236.
- Usenet (Reddit request, Zee-Bln; user uses Easynews): `sources/usenet.js` — Easynews solr search
  with Basic auth (files grouped with `bookKey`, played with Authorization headers; source `en`,
  books kept in `easynewsBooks` for Continue) and Newznab indexers (JSON or XML, cat 3030/7020,
  `parseNewznab` tested) → `sendNzbToTorbox` (TorBox /usenet/createusenetdownload). Book page "Usenet"
  box (`components/usenet-results.jsx`), Settings → Usenet (Easynews sign-in, indexers with NZBgeek /
  NinjaCentral / Treasure Maps name chips). No language filter. Untested against real accounts. In v1.0.236.
- Still waiting on the user: boxed text under covers (sample A vs B sent, I suggested B); the
  server-side addon for Mobilism / Anna's on iPhone (explained bot checks + Mobilism login).
- Book cards: one faint glowing frame around cover + text (user picked sample B). In v1.0.236.
- Book Hunt worker (`inkwell/workers/bookhunt.js`, user deploys it as a new Cloudflare worker and adds
  https://<worker>/addon.json in Settings → Addons): Anna's Archive search (regex parser, mirrors
  .org/.li/.se/.pk or ANNAS_BASE) with files via LibGen by MD5 or ANNAS_KEY fast download (/file);
  Mobilism with secrets MOBILISM_USER / MOBILISM_PASS (phpBB sign-in, topic file-host links as
  `downloads`, which sourceaddons.js now maps → the existing TopicToCloud flow). Bot checks may block
  the server: errors come back in "errors". Parsers tested; not tried against the live sites (this
  sandbox can't reach them). In v1.0.236.
- iPhone / web app: Anna's Archive, Mobilism and Bookshare (hidden-browser sources) are left out of searches there instead of erroring; Book Hunt covers them. In v1.0.237.
- Source addons: an empty answer with "errors" (Book Hunt) now shows the reason under the results; Book Hunt is left out on Android when the built-in Anna's / Mobilism are set up (no repeats). In v1.0.237.
- Sync: addon lists merge across devices (lib/addonmerge.js, tested; addonLog of added/removed times) instead of the newer list replacing the other — the Android app saving its list had wiped Book Hunt added in the web app. In v1.0.237.
- Fix: Book Hunt was deleted right after installing by the old 'retired Anna's Archive addon' clean-up (its name has "Anna's Archive"); id audiohub-bookhunt exempt (checked in a browser). In v1.0.238.
- iPhone lighter: place saved every 12 s while playing (was 4 s: each save rewrites the whole progress list + redraws), no card glow (html.ios). The buffering itself still needs details from the user. In v1.0.238.
- iPhone/iPad: no in-file chapter reading (up to 80 ranged fetches through the web view, competing with the start of TorBox / Real-Debrid M4Bs); published chapters only. Proposed next: a native iOS player (AVPlayer) like Android's. In v1.0.238.
- Easynews: searches wait 45 s (was the 15 s default); the Settings check only signs you out when Easynews refuses the password (a slow answer keeps it). Note: on iPhone/iPad and the web app Easynews files can't play yet — their web-view audio can't send the sign-in (needs the native iOS player). In v1.0.238.
- Native iPhone/iPad player: `ios-plugins/player` (Swift, jsName `InkwellPlayer`, AVQueuePlayer):
  load / queue / play / pause / seek / setRate / setVolume / stop / setSkips (+ no-op setSkipSilence,
  setBoost, setSleepDetect); events state / progress / ended / error / advanced / remote like
  Android; sign-in headers per item (AVURLAssetHTTPHeaderFieldsKey — Easynews, Audiobookshelf);
  audio session .playback/.spokenAudio, lock-screen info + artwork, skip / next / previous / scrub
  commands, resumes after interruptions. Added in audiohub-ios.yml. Android-only extras hidden on iOS
  (`nativeExtras`). Compiled in iOS build 119 (on-device test pending); if it misbehaves, drop it from the workflow
  line to fall back to the web-view audio.
- Book Hunt shared safely: addons can declare `userConfig.fields` ({ key, label, header, secret });
  Settings → Addons shows "Your details" (saved in the addon entry's `config` on the device) and
  `userHeaders()` sends them with each search. The worker reads x-bh-mobilism-user / -pass and
  x-bh-annas-key (per-user Mobilism sessions; the user's key rides in the file link as `ak`), and
  uses its own secrets only for searches without details (`own=1` links). To share: redeploy
  bookhunt.js, delete the worker's own secrets, re-add the addon, enter details in the app. In v1.0.239.
- Book Hunt worker /file (worker-only change, redeploy bookhunt.js): tries the Anna's fast link and up to 4 LibGen mirrors in turn and skips any that send a web page or error instead of the book (that was "isn't a readable EPUB" / HTTP 502 on iPhone); the 502 now says why (e.g. Anna's "Invalid secret key"). isBookFile tested. Having the key both in the worker secrets and in the app is fine: the app's details win.
- Book Hunt in the app: when part of it fails (Anna's Archive errors but Mobilism answers) the reason shows under the results (results.partial → group error; such results aren't cached so Try again asks again). Mobilism posts (results with downloads) are never direct ebook files, so no Read on a viewtopic page ("isn't a readable EPUB"); tests/ebookfile.test.js. In v1.0.240.
- Open: iPhone can't unpack Mobilism archives (.zip/.rar) yet — unpack is the Android InkwellDownloads plugin only. On Android, Book Hunt's Mobilism can hit Mobilism's bot check on the server; the built-in Mobilism (hidden browser) passes it and Book Hunt then hides itself.
- FALL-BACK (user asked to remember): if the shared Book Hunt (each person's details) doesn't work,
  go back to `inkwell/workers/bookhunt-private-v1.js` — the private version that works for the user
  and their wife on their iPhone (worker secrets MOBILISM_USER / MOBILISM_PASS / ANNAS_KEY). The new
  bookhunt.js still uses those secrets for searches without details, so keep the secrets until the
  shared way is proven.
- Easynews: audiobook pages search audio only (m4b/m4a/mp3), ebook pages EPUB/PDF; each result shows its type; ebooks get Read (fetched with the sign-in into a blob, then the reader keeps it); names cleaned (cleanName, tested: "Bren&Atilde;&Acirc;&copy;" → "Brené"); title over details layout. In v1.0.239.


## Before every build (user, 22 Nov — after v1.0.240 broke playing Library books)
- Playing audiobooks comes first. A change that touches finding / opening / playing a book (player.js, debrid.js, sources/index.js getDetails) needs a test of that path, or it doesn't go in the build — say so instead.
- Nothing that changes the user's TorBox / Real-Debrid account (delete, re-add) ships switched on until tested on real books; new risky features go in off by default.
- v1.0.240 lesson: "re-add inactive torrents" deleted working torrents (rules too loose) → v1.0.241 switched it off, v1.0.242 repaired moved books.

## Book Hunt — pipeline (parked 21 Nov, user's choice)
- LIVE now: the user went back to `inkwell/workers/bookhunt-private-v1.js` (worker's own secrets) so their wife's iPhone works. Others who want Book Hunt make their own worker from that file (steps below) — no shared worker for now.
- Later, to make one shared worker work for everyone (`bookhunt.js`, Your details): find why Anna's search fails from the worker (the app now shows the reason), Mobilism's bot check on Cloudflare IPs, then test with the user before telling them to delete secrets.
- Also pending: unpack .zip on iPhone (native, e.g. ZIPFoundation in ios-plugins); .rar is harder.
- Own-worker steps (give to anyone interested): Cloudflare (free) → Workers & Pages → Create → Hello World → Deploy → Edit code → paste bookhunt-private-v1.js → Deploy; Settings → Variables and Secrets → add Secret MOBILISM_USER, MOBILISM_PASS, (optional) ANNAS_KEY; app Settings → Addons → add `https://<their-worker>.workers.dev/addon.json`.
- Note: the old worker doesn't allow the x-bh-* headers, so an addon entry with saved Your details would fail on iPhone/web — remove the addon and add it again after switching back (the old manifest has no fields, so nothing is sent).

## Cloudflare traffic fix (21 Nov) — not built yet
- App: `src/lib/backoff.js` (pure, tests/backoff.test.js) used by `http.js` request(): a refused request (4xx except 404, 429, 503) isn't sent again for a while (Goodreads 72 h, iTunes/Hardcover 6 h); 3 refusals in a row pause the host (Goodreads 1 h; iTunes/Hardcover 10 min doubling to 2 h; Retry-After honoured). State in localStorage `inkwell:backoff`. Errors carry `refused`.
- Goodreads: removed from RELAY_HOSTS / RELAY_ALLOWED (never via relay; Android no longer retries it through the relay); web app throws at once without a request. ratings.js `cached()` remembers refusals (`refused: true`, 72 h for gr kinds); goodreads() stops at the first refusal.
- `src/lib/answers.js`: Cache Storage answer keeping — iTunes search/lookup 12 h (getJson), Hardcover `query B(`/`query S(` 24 h (hardcover.js gql).
- Workers (user redeploys by pasting): `relay/index.ts` v9 (audiohub-relay.drdilipgreat.workers.dev) and `workers/audiohub.js` /relay v9 (api.audiohubapp.com): no Goodreads; caches.default keeps answers 12 h (Knaben 1 h), refusals 1 h, JSON/XML/text < 2 MB only; never TorBox/RD/AllDebrid/Premiumize, never Hardcover `me`/mutations; key = SHA-256 of method+url+body+Authorization; 240 req/min per IP (per isolate).

## Public addons worker (21 Nov) — `inkwell/workers/public-addons.js`, live address https://sources.booksources.workers.dev (separate public Cloudflare account; user pastes it)
- Only 4 public sources (user's decision): AudiobookBay (/abb/search, mirrors), Knaben AudioBooks / Ebooks (/knaben/…?q=, its own POST to api.knaben.org), LibGen English EPUB (/libgen/search, /libgen/download — libgen.js 10.8.2 wrapped in its own scope, mirror fallback). No EXTto, no RuTracker.
- `ORIGIN` constant = the address above: all manifests, /addons/all.json and LibGen download links use it (change it there if the address moves). Ids `public-…`.
- 12 h Cloudflare cache of search answers (only ones that found something; key ignores case/spacing); 30 searches/min per CF-Connecting-IP (per isolate); downloads not limited.
- No sync, keys, env, KV, or calls to personal workers / api.audiohubapp.com (tests/publicaddons.test.js checks).
- Ebooks from Premiumize / AllDebrid / Debrid-Link / Easynews opened blank (isCloudEbook missed ad|pm|dl|en; now /^(tb|rd|ad|pm|dl|en|src|loc|abs):/, tested in tests/ebookfile.test.js). Reported by AudioYam (Reddit). In v1.0.240.
- Goodreads "refused" for a public profile (Reddit): Goodreads requests now go with phone-browser headers (BROWSER_HEADERS in http.js — RSS shelves, auto_complete, search, book page); shelf RSS falls back to the Android hidden browser (pageVisit, rssFromPage tested); Sync you tap skips the backoff (request opts.force). Before 21 Nov the 403 fell back to the relay, which Goodreads also refuses — so this likely never worked on phones. Unverified against Goodreads (no network here). In v1.0.240. Port to AudioYam.
- Goodreads profile Connect REMOVED (22 Nov): Goodreads switched off shelf RSS (list_rss 404 even for public profiles, user-tested in AudioYam). Settings Goodreads card is CSV-only with Chrome export steps and a Remove button; old connected profiles cleared; pull-to-refresh no longer syncs; opts.force and hidden-browser RSS fallback removed. BROWSER_HEADERS kept for ratings. In v1.0.240.
- Easynews relay (22 Nov), for networks that block Easynews (user's Indian provider; Private DNS didn't help): `inkwell/workers/easynews-relay.js` (own worker, user deploys; /health, /fetch?url= only *.easynews.com over https, passes Authorization + Range, follows redirects only within easynews.com, nothing stored). App: `usenetCfg.easynews.relay`, `viaEasynewsRelay()` in usenet.js wraps search, tracks, ebook resolve and the reader fetch (stored file URLs stay real). Settings → Usenet: `EasynewsRelay` ("Easynews blocked on your network?" → Check and use / Stop). Connect/Remove keep the relay. Tests in tests/usenet.test.js. In v1.0.240.
- Inactive cloud copies revived (22 Nov): `src/lib/revive.js` (tbGone, rdGone, moveProgress, toKeepReady — tests/revive.test.js). debrid.js `revive(book)`: tb:t:/rd: book with hash whose entry is gone → delete dead entry, prepareMagnet again (usually instant), returns stub (or throws .pending when downloading again; null when the entry looks fine). player.js recover(): after the fresh-link retry, revive first (progress moved to the new uid, same place), then other copies / instantCopy while it re-downloads; if nothing else, a clear "downloading it again" message. `keepReady()` runs 30 s after start (once per 6 h, ≤3): unfinished books listened in the last 60 days whose torrent is gone are re-added quietly and progress moved. In v1.0.240.
- No "Android only" wording for Mobilism / Bookshare / Anna's on iPhone (22 Nov, user's rule): their settings rows and searches were already hidden there; now archive-only Mobilism posts say "can’t play here — try another post", unpack.js and the three sources' messages say "isn't available here", Open topic uses the phone's browser where there's no in-app one, and the What's New Book Hunt card no longer mentions Your details. In v1.0.240.
- iPhone unpacking (22 Nov): new `inkwell/ios-plugins/unpack` (package inkwell-unpack-ios, SPM InkwellUnpackIos, jsName **InkwellUnpack** — not InkwellDownloads, so iPhone downloads stay off). Same unpack()/unpackProgress as Android. Deps: ZIPFoundation ≥0.9.19 (.zip), mtgto/Unrar.swift 0.5.4 exact (RARLAB unrar: RAR4+RAR5, split .partN.rar from part 1; entries streamed to disk). Output in Application Support/Unpacked/<title> (not Documents, which InkwellLocal scans). lib/unpack.js picks the plugin by platform. audiohub-ios.yml installs it. Compiled in iPhone build 121 (Unrar.swift builds for iOS). Known risk: absolute file:// paths if iOS moves the app container on update (same as own files). In v1.0.240.
- v1.0.240 report: "lots of books say not available when tapped in Library". Suspect: revive treating working torrents as gone. Made tbGone/rdGone strict (only TorBox state inactive/expired, or finished && present===false; RD dead/error status; no answer = not gone; "not active"/"stalled" no longer count) and every re-add is logged ("Revive" in Report a problem). Cause not confirmed yet — waiting for a screenshot. In v1.0.241.
- v1.0.240 broke tapping books in Library (AudioYam, without this feature, fine) → revive in recover() and keepReady at start SWITCHED OFF (player.js REVIVE = false; app.jsx keepReady call removed; What's New card removed). Code and tests kept for later. In v1.0.241.
- Repair for books v1.0.240 removed from TorBox ("This item is no longer in your TorBox account" when tapped in Library): tbDetails now finds the same torrent under its new entry by hash, exact name, or (old saved places without a hash) the newest TorBox audiobook with that title; if it isn't in TorBox at all and the hash is known, it is added back (no deleting). summarize() now keeps hash + rawName in saved places. In v1.0.242.
- iPhone import from Files could spin forever (AudioYam Reddit report, same plugin): InkwellLocal now copies picked files/folders inside an NSFileCoordinator read, so iOS fetches iCloud / provider files first (copyCoordinated). In iPhone build 124 (compiled).
- iPhone: .mp4 audiobooks (TorBox) played on Android but not iPhone. Tracks now carry `mime` (lib/mime.js mimeFor — MP4 family only: mp4/m4v → video/mp4, m4a/m4b → audio/mp4; MP3 etc. untouched, tests/mime.test.js) for TorBox, Real-Debrid and More debrid tracks; player.js passes it in load meta and queue items; iOS InkwellPlayer sets AVURLAssetOutOfBandMIMETypeKey and switches off video tracks when ready (keeps playing with the screen locked). Android ignores the field. In iPhone build 124.
- iPhone: "Open in Audiohub" on shared quote / bookmark pages failed in Safari — the iPhone app never registered the audiohub:// scheme. audiohub-ios.yml now adds CFBundleURLTypes (scheme audiohub); app.jsx already opens audiohub://q/… via appUrlOpen. workers/audiohub.js quote page: on iPhone, if the app doesn't open within 2 s, a note links the SideStore source (user redeploys the worker). In iPhone build 124.
- iPhone Text (live transcript) on a 1.8 GB single-file .mp4 said "too big to transcribe on iPhone": parts over 900 MB are now cut straight from the server (remote AVURLAsset with headers + out-of-band MIME → AVAssetExportSession per 45 s piece) instead of being downloaded; the old message stays only if Apple can't read the remote file's length. In iPhone build 124 (compiled).
- iPhone player: links with spaces/brackets are percent-encoded when URL(string:) refuses them (older iOS), and AVFoundation "Cannot Open" (-11828/-11829) is reported as "iPhone couldn't open this file's format" (the safety net then tries other copies). Same build as the .mp4 type fix. In iPhone build 124 (compiled).
- Sync: deleted bookmarks came back within seconds (AudioYam GitHub #9, same code here). Ported AudioYam's fix: src/lib/marks.js (markKey, mergeGone, mergeBookmarks with a gone map; tests/marks.test.js), store.js removedMarks + removeBookmark(uid, createdAt) used by bookmarks.jsx and player.js toggleQuote; sync SECTIONS removedMarks (mergeGone) before bookmarks. Highlights too: highlightsGone now syncs (mergeGone) before highlights, and mergeHighlights drops deleted ones from this device's list as well. In v1.0.243.
- Transcript ebook choice (user: "auto adding books is weird — let me choose, else auto"): settings.ebookPick 'ask' (default) | 'auto' | 'off' (findorder.js ebookMode(); old autoEbook=false → off). Ask: in Text, a bar "Pick this book's ebook — or one is chosen for you in 15 s" (Choose / Choose for me); closing the list without picking also auto-chooses (transcript.js autoPickEbook → autoFindEbook force + bookTextFor). Once per book per session. Background auto-attach only in Automatic. Settings → Finding books: select instead of the switch. In v1.0.243. Open: Android Text with ebook "a gap of a couple of lines" — asked the user which way (ahead/behind/skipped lines) before touching booksync.
- From AudioYam (user: Audiohub+ = AudioYam without Supabase; bring the iPhone fixes): iPhone Send to Kindle (ios-plugins/mail, jsName InkwellMail; kindle.js from AudioYam abb66bc: canMailHere / sendsDirect on iPhone) and iPhone offline downloads (ios-plugins/downloads, jsName InkwellDownloads — Files → On My iPhone → Audiohub → Downloads, `rel` paths rebuilt at start, afterFiles for parts deleted in Files; tests/iosdownloads.test.js; downloads.js / absupload.js (ABS upload Android-only) / Downloads.jsx copied from AudioYam 5250df1 — identical before apart from the iPhone parts; settings-extra iPhone note; InkwellLocal skips Documents/Downloads). audiohub-ios.yml installs both. iPhone unpacking keeps its own InkwellUnpack plugin. Android unchanged. In v1.0.243 / iPhone build 125 (compiled).
- 25 Nov fixes (from AudioYam's feedback list, applied here): iPhone import accepts .mp4 (picker .mpeg4Movie, Swift audio set, local.js AUDIO on iPhone only); import says why a copy failed (f.failed / added) and "Add audiobooks (files or folders)" / "Add ebooks (EPUB / PDF)" labels; iPhone downloads folder renamed "Audiohub downloads" (a picked "Downloads" folder is no longer skipped). Author page: bioOf(name, titles) — Wikipedia / Open Library only if they name one of your books, else Wikipedia search "name + title" (people.js mentionsBook, tested; cache v2). Source cards: smaller action buttons so the "…" stays on the row; "Show more" / "loose matches" as wide as the source boxes (checked in a 390 px mock-up). Home "Downloading for you": whole card tappable (ready → play, else progress toast). Ebook download progress: already in Audiohub+. Floating play button: not found in Audiohub+ (AudioYam only?). Battery, Find-books-from-link: need data / an example. In v1.0.243.
- Audiobookshelf: Home tile / whole library stopped at 500 books (one request, limit 500) → allPages() fetches 500 a page until total (≤10,000); tests/absitems.test.js. Discover: Recent searches only while you're in the search box (filtered as you type), gone after you search / clear / leave (browser-tested). AudiobookBay: nothing to do here (Audiohub+ uses api.audiohubapp.com, works). In v1.0.243.
- Home "Picked for you" banner: cover 112 → 136 px inside the same box (checked: box stays 214 px, long titles still 2 lines); Continue listening unchanged. In v1.0.243.

## PLAN — ChatGPT idea list (25 Nov, planned, NOT started; source: handoff/audioyam.md "Ideas" 1–32)
Rules: never touch playing books (new features are separate screens / cards, off or optional); AI ones use the
user's own key and stay spoiler-safe (never past your place); no new server (Audiohub+ has its own Cloudflare sync
worker if a shared feature is ever wanted). Build once here, then port to AudioYam (or the reverse) — not twice.
Building blocks already here: askbook.js (Ask the book, "Remember this"), xray.jsx, scenefind.js, transcripts,
catchup.jsx / resume.js, quoteshare.js, stats.js, taste.js, series.js, people.js, voiceask.js, highlights.js.
- Phase 1 — quick wins (small, safe): #21 Book Resurrection (Home card after ~3 weeks away: recap + who's who + your
  notes, one tap to resume) · #11 Listener Challenges (from stats) · #8 Audio Postcards (quote card + chapter +
  your reaction).
- Phase 2 — the core: #1 Story Companion (one tap from the player into spoiler-safe chat, voice too) · #18 Whisper
  Notes (record a voice note at a moment, it plays back when you reach it again; on-device) · #4 Time Machine
  (one search across everything heard: transcripts, notes, highlights, chapter titles → jump there) · #2 Character
  Tracker + X-Ray redesign (samples in handoff/samples/ — need the user's OK first).
- Phase 3 — discovery: #22 Book Universe (connections page per book) · #7 Audio DNA + #9 Mood Radio · #3/#14 What If /
  Unheard Chapter (clearly labelled "not the book").
- Phase 4 — bigger / later: #20 Silence Intelligence (touches playback → off by default, tested hard) · #10 Memory
  Palace (needs an index) · #12 Living Book · sharing-by-link ideas #16 #17 #19 #26 #27 · study / language / kids /
  car / sleep modes (#23–#25, #29, #30) · #31 book-to-podcast.
- Not planned: #5 Dream Cast (actors' faces: rights), #13 location Sidekick (privacy; later maybe), #15 other
  narrator voices (only TTS of your own EPUB, no voice cloning), listen parties / book club (need a shared server
  — decide first), #28 / #32 (store-edition money ideas).
- Questions for the user: which app first (suggest Audiohub+, then port); the X-Ray / Character Tracker samples OK?;
  start with Phase 1 + Story Companion?
- #21 Book Resurrection (25 Nov): lib/resurrect.js (comeBackTo — unfinished 3–95%, untouched 21 days–1 year, furthest through first; "Not now" hides 30 days; tests/resurrect.test.js). Home ComeBackCard under Continue: cover, "Come back to", % · N weeks ago · bookmarks waiting, Story so far (AI key) / Carry on, ✕. "Story so far" sets wantRecap → player-ui opens the recap sheet once the book is up. Browser-tested. Not built yet.
- #11 Listener Challenges (25 Nov): lib/challenges.js (this month: 10 hours, finish 2 books, 7 days in a row ≥5 min, an author new to you — from listenLog + progress; tests/challenges.test.js). Stats screen card "This month's challenges" with progress bars (listening view). Browser-tested. Not built yet.
- #8 Audio Postcards (25 Nov): quoteshare.js packs `h` chapter (chapterAt(list, g), tested in tests/quoteshare.test.js with the link round trip); bookmarks share passes the chapter when that book is open in the player; quote card: sound-wave strip for audio (same shape per quote) + chapter in the label line; message text includes chapter and your reaction; share sheet "Your reaction" box edits the note with a live preview; shared-quote sheet + worker quote page show the chapter (workers/audiohub.js — redeploy for the page). Card checked as an image. Not built yet.
- #1 Story Companion (25 Nov): components/talk-companion.jsx TalkButton in the player's AI row (now 5: Ask, Explain, Find, X-Ray, Talk) — tap, ask out loud, book pauses, spoiler-safe answer (askbook ask with hearing(), thread kept) is spoken, the book carries on; second tap stops; a card shows question + answer. Same flow as Drive mode. Layout checked in a mock-up; voice needs a phone. Not built yet.
- #18 Whisper Notes (25 Nov): lib/whispers.js (clips in Cache Storage "inkwell-whispers-v1", list in persisted `whispers`, whisperAt tested — offered from 1 s before to 20 s after, once per listen; whisperAutoPlay off by default) + components/whisper.jsx: Voice note button next to Remember (tap to record, tap to stop, max 60 s; book paused while recording), banner "🎙 You left a voice note here · Play" in the player, "Your voice notes" list in More (play / go there / delete + auto-play switch). Book paused/resumed only via player.pause/toggle. Android manifest RECORD_AUDIO + MODIFY_AUDIO_SETTINGS (asked only when recording); iOS mic text updated. Not synced (on this phone). Browser-tested record → keep → play → delete with a fake mic. Not built yet.
- #4 Time Machine (25 Nov): lib/heardarchive.js (every transcribed part kept in Cache Storage "inkwell-heard-v1" — transcript.js remember() archives it; the transcript cache itself still keeps 4) + lib/timemachine.js searchMoments (heard lines, bookmarks + notes, highlights, saved ideas; all words, accents ignored, your own notes first; snippet; tests/timemachine.test.js) + screens/TimeMachine.jsx (route timemachine; Library menu "Time Machine — search all you've heard"); tap → play at that moment (same book: playAt), highlights → reader. Heard lines start collecting from this version on. Browser-tested. Not built yet.
- #2 Character Tracker + X-Ray redesign (25 Nov, from the samples): the one X-Ray AI request per chapter now also returns group, status (alive/missing/dead/unknown at your point), kind (real/fictional), connections [{to, label, type}] and open questions; the previous chapter's snapshot is kept (xray store `prev`, previousXray). lib/xraytrack.js (groupsOf, counts, changesSince, initials, hueOf; tests/xraytrack.test.js). components/xray.jsx rewritten: header "up to … · no spoilers", In this scene cards, tabs People / Places / Who's who (counts + legend + groups with status dots) / Since last (changes, open questions, also called); person page (hero, aliases, Real person, First seen / Chapters / Status now, story so far, connections → their page, moments → jump). Portraits = initials in the name's colour (no photos yet; Wikipedia photos and a drawn relationship map are a later step). Browser-rendered all four views. Not built yet.
- Text view: tapping a character name opened a small cut-off card (the sheet was drawn inside the Text panel, whose layout clips fixed children). CharacterCard now uses createPortal to document.body (as scene-cmd does) and shows the X-Ray tracker details when known (aliases, group, status, real person, connections). Browser-checked inside a clipped container. Not built yet.
- X-Ray map + photos (25 Nov): xraytrack.js mapAround (person centred, ≤8 connections in a ring, links between ring people from either side, once; tested) → RelationMap on the person page (SVG lines by type: family grey, enemy red dashed, ally green; labels; nodes tap → that person; legend). lib/xrayphotos.js photoFor: Wikipedia generator=search + pageimages (free images only) + description; pickPage (tested) accepts only the same name, a character page only for fictional (description says character/fictional), a person page for real people; kept 30 days incl. misses (xrayPhotos). Face shows the photo when found, hero shows it with "Photo: Wikipedia". Map browser-checked; Wikipedia not reachable from this machine, so photos untested live. Not built yet.
