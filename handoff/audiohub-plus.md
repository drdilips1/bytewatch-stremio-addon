# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.233; iPhone build 114 (21 Nov — everything below is in them).
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

