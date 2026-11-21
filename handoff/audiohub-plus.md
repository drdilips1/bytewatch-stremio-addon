# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.236; iPhone build 117 (21 Nov — everything below is in them).
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
- iPhone / web app: Anna's Archive, Mobilism and Bookshare (hidden-browser sources) are left out of searches there instead of erroring; Book Hunt covers them. Not built yet.
- Source addons: an empty answer with "errors" (Book Hunt) now shows the reason under the results; Book Hunt is left out on Android when the built-in Anna's / Mobilism are set up (no repeats). Not built yet.
