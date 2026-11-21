# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.232; iPhone build 112 (later iOS builds fail — Mac minutes used up).
- Built in since v1.0.232 (not yet in a build): instant play (server place asked in the background),
  glow fade on player background, Libby live availability, auto-send never re-sends backlog + skips torrents
  qBittorrent has, Goodreads clearer refusal + CSV hint, ebook cards, banner title fit, Play timing line.
- Pending / feedback: see `inkwell/ROADMAP.md` (sections "Feedback 19 Nov", "Feedback 21 Nov", Usenet,
  book page people row, AudioYam items).
- Done 21 Nov (not yet built; shared `inkwell/src/` code, used by Hearth / Duet / Audibrisk too):
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
- Still open from 19 / 21 Nov: RD book not reaching the iPhone (needs a look on the phone), local
  files on iPhone (Files folder + Add files), author's / narrator's voice on their page, more debrid
  services (AllDebrid, Premiumize, Debrid-Link).
- Frosted-glass card (user picked "your choice" from samples based on their 21 Nov design image):
  `components/glass-card.jsx` on Home's Continue listening and the book page top (replaces the old
  Continue card, the big hero cover and the By / Read by row). Whole cover left (not cropped), the
  cover blurred behind 150 px glass panels (Author, Narrator — tap for their page; Duration; Format
  or, when in progress, % + time left + gold bar), dark strip with title + ★ (Goodreads). Pale
  covers darken the glass (`coverLight` / `meanLight` in color.js, tested). Not done: the small
  version for Home rows (sample 6) — offer after the user sees the card in a build.

