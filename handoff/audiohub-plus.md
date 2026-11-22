# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.239; iPhone build 120 (21 Nov — everything below is in them; build 119+ has the native iOS player).
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
- Book Hunt in the app: when part of it fails (Anna's Archive errors but Mobilism answers) the reason shows under the results (results.partial → group error; such results aren't cached so Try again asks again). Mobilism posts (results with downloads) are never direct ebook files, so no Read on a viewtopic page ("isn't a readable EPUB"); tests/ebookfile.test.js. Not built yet.
- Open: iPhone can't unpack Mobilism archives (.zip/.rar) yet — unpack is the Android InkwellDownloads plugin only. On Android, Book Hunt's Mobilism can hit Mobilism's bot check on the server; the built-in Mobilism (hidden browser) passes it and Book Hunt then hides itself.
- FALL-BACK (user asked to remember): if the shared Book Hunt (each person's details) doesn't work,
  go back to `inkwell/workers/bookhunt-private-v1.js` — the private version that works for the user
  and their wife on their iPhone (worker secrets MOBILISM_USER / MOBILISM_PASS / ANNAS_KEY). The new
  bookhunt.js still uses those secrets for searches without details, so keep the secrets until the
  shared way is proven.
- Easynews: audiobook pages search audio only (m4b/m4a/mp3), ebook pages EPUB/PDF; each result shows its type; ebooks get Read (fetched with the sign-in into a blob, then the reader keeps it); names cleaned (cleanName, tested: "Bren&Atilde;&Acirc;&copy;" → "Brené"); title over details layout. In v1.0.239.

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
- Ebooks from Premiumize / AllDebrid / Debrid-Link / Easynews opened blank (isCloudEbook missed ad|pm|dl|en; now /^(tb|rd|ad|pm|dl|en|src|loc|abs):/, tested in tests/ebookfile.test.js). Reported by AudioYam (Reddit). Not built yet.
