# Audiohub — ideas and to-do

Noted while building; to pick up after Saturday.

## Duet — on hold (noted 11 Nov)
Paused after the first phone test and a talk about whether it can compete (free Audiobookshelf
apps like Absorb, and Storyteller for read-along). Fixes from that test are committed, not built
(say "build duet"). If it's picked up again, the agreed direction is **Audiobookshelf first,
read-along as the reason to exist**:
- Library built on the server's own data (covers, authors, series, collections, progress) — no
  guessing on the phone; phone files a second source.
- Read-along done properly (step 2): pair each audiobook with its EPUB on the server, sentence
  highlight, tap a sentence to jump the audio, switch reading ↔ listening at the same spot.
  Faster first match than listening alone (start from the chapter, then refine).
- Then what Absorb does that's missed in daily use (ask which features).
- Later: manual details fixes, duplicate merge, custom player gestures, Plus through Google Play
  Billing, store listing, its own repo; multiple servers, search inside audio, smart sleep.
- Untested on the phone: ratings in the book menu, the automatic cover lookup, the cover picker.

## Code clean-up (3 Nov)
Order agreed: lint → tests → dead code → one shared codebase → split big files → split the stylesheet.
- [x] Tests (Vitest, 45) in both apps — private: tools in inkwell/tests/ with their own package.json (the app's lockfile trips an npm bug; `npm ci` must keep working). `npm test`.
- [x] Lint (ESLint, mistakes only) in both — `npm run lint`. Found and fixed a real crash: add-on torrent streams via debrid (AUDIO undefined). Unused imports removed.
- [x] Dead code removed (private 227 lines, public ~100): Libby code sign-in leftovers, old Waveform / X-Ray strip, unused helpers.
- [ ] Formatting: settings + `npm run format` added, **not run** — it rewrites ~92 of 133 files; do it in both apps on the same day when no other session has work in progress.
- [ ] One shared codebase (private / public / store as editions) — next big step, carefully staged.
- [ ] Split big files (Settings, player, Book, source results) — gradually.
- [ ] Split styles.css (11k lines) — last, screen by screen with before/after screenshots.

## AudioYam Lite — fixes noted 3 Nov (after testing lite-v0.1.5; not built)
- "Find cover & details" still says "Looking in Audible, Apple, Goodreads, Google Books and Open Library…" — the text must list only what Lite really searches.
- Settings → Finding your books still lists "TorBox / Real-Debrid" and the transcript's ebook option — make it neutral ("Your cloud") and match what Lite has.
- Bring the transcript back to Lite (the synced book text under the player).
- Better catalogue than Open Library alone: Apple's iTunes Search (free, no key, audiobooks with square covers up to 600px+) as the main catalogue and cover source; Google Books (free key) for descriptions; Open Library only as a fallback. Check each one's terms for store use first.
- Book page → Available still names the services: "Play now · instant · TorBox", "Get & play · TorBox · 12 seeds", "Listen · Real-Debrid". Use neutral words ("Play now · instant", "Get & play · your cloud"); drop seed counts too (torrent talk). Add-on names the user added themselves (e.g. LibGen) can stay, like Stremio shows its add-ons — or show just "Read" if we want it fully neutral.
- Under the cover (Available area / source pill / "Your copies" row) it still shows the add-on's name, e.g. "LibGen", and "TorBox" / "Real-Debrid". In Lite show neutral words only: "Add-on" (or "From your sources") and "Your cloud"; the add-on's own name only inside its result details.
- The source pill under the narrator still says "Audible" (from the book's details source) — Lite shouldn't show Audible anywhere; show nothing, or a neutral word.
- When the Available row works (Play now / Read), the big "Where to get it" button isn't needed in Lite — hide it then (keep it only when nothing is available, if at all).
- **Minimal book page (Lite): one Play button, one Read button, no source results list.**
  - Play picks the best audio result by itself. Format order on Android: M4B → M4A / AAC → Opus / OGG → MP3 → FLAC. On iPhone and the web, Opus / OGG are skipped (patchy support there): M4B → M4A / AAC → MP3 → FLAC. Never pick WMA, WAV or MKA (won't play on phones, or huge). Within a format: ready/instant in your cloud first, then most seeds.
  - Read picks EPUB first (smallest file), then PDF (smallest file).
  - Results with no seeds and not already in your cloud don't count. Nothing left → the button says "Not available".
  - My suggestion: a small "Other versions" link under the button for when the auto-pick is wrong (abridged, wrong narrator, other language).
- **Theme dice (Lite): one button on Home** that picks a random theme — light or dark, a palette and an accent. Keep all theme choices in Settings → Appearance.
  - My suggestion: only pick from combinations that pass a contrast check, so the dice can never produce unreadable text. Tap again for another; long-press goes back to the previous one.
- Most cloud books in Lite have no cover: Lite looks covers up on Open Library only, which rarely matches torrent names. The iTunes cover lookup (above) is the fix. (The banner itself now copes: title tile + readable text — fixed 3 Nov in all three apps, not built.)
- Covers from the free sources are poor: ask for the large sizes (Open Library `-L`, iTunes `600x600bb` or larger, Archive's own item image), and prefer an iTunes square cover whenever the title and author match.

## Store launch plan — AudioYam on Google Play (then App Store) (noted 2 Nov)
Started 3 Nov: local copy at /home/user/audioyam-store (app ID app.audioyam.store) — no self-updater, qBittorrent, tracker or built-in TorBox / Real-Debrid. Full checklist (light / medium / heavy) and the AudioYam Plus money plan are in its STORE_PLAN.md. Saved as store-edition/ (patch + plan) so it survives this container. **Waits for: the shared codebase step, and the user creating the empty private repo `audioyam-store`.**
**A separate, third app (own repo/folder, own package ID) — the private Audiohub+ and the public AudioYam are NOT changed for it.** It starts as a copy of the public app and is trimmed there.
Model: like Stremio / Ink & Echo — the app ships empty, users add their own add-ons.

1. **Store app = trimmed copy** (not a flag in the existing apps):
   - Remove: the built-in APK updater + "install unknown apps" permission (Play rule); unofficial APIs — Edge voices → on-device voices (or bring-your-own key), Audible/Goodreads/Apple scraping → official sources (Open Library, Google Books); any "recommended add-ons" links.
   - Keep: add-on system (empty), TorBox / Real-Debrid as "your cloud storage", paste a magnet/link, qBittorrent remote, Audiobookshelf, phone folders, all smart features.
2. **Compliance:** privacy policy page; Play Data safety form; account deletion in the app + on a web page; media-playback foreground service declared; content rating; neutral store listing (no "torrents" / "free audiobooks").
3. **Move add-on hosting off the app's name:** torrent / LibGen / RuTracker / EXTto add-ons from api.audiohubapp.com to a separate unbranded worker; not linked from the app, README, website or listing. audiohubapp.com stays for the web app, quote pages, sync.
4. **Add-on builder** on a neutral address (e.g. audioyam-addons.pages.dev): form → add-on JSON (search URL, results path, field mapping) + "test search"; generic for any source (Audiobookshelf, OPDS, podcasts…).
5. **Legal sources for day one:** free sources back (LibriVox, Archive, Gutenberg, Standard Ebooks) as switches; OPDS catalogues; later Google Drive / Dropbox / WebDAV, Jellyfin / Plex.
6. **Android Auto** (expected of audiobook apps); Chromecast / widgets polish.
7. **Closed test:** Play requires 12+ testers for 14 days on new personal accounts — invite Reddit users.
8. **Play launch** ($25 one-time). App Store later ($99/yr, stricter; needs iPhone downloads first).

Pitch: "AudioYam — the smart audiobook player for your own library: ask it questions, read along, and never lose your place." Lead with: Ask the book (no spoilers), live transcript + ebook sync, chapter summaries / X-Ray / recap, translate & read-aloud, one library from everywhere (phone copy first), listening plans / history / per-book speed / car mode.

## Public app — next release (noted 1 Nov; not Libby, which stays private)
Ported to public `work` (commit 9990f28, not test-built or released yet) — plus: phone copy plays first, Audible copycats below the real book:
- Light themes: pop-up sheets (book menu, What's New, tags…) were dark with unreadable dark text → now light; player sheets stay dark.
- Reader: read-aloud bar hint was squeezed into a word-per-line column → on its own line under the buttons.
- Reader: Voice list names unreadable (dark reader page + light app theme) → reader panels use the reader's colours.
- Book cards: a stray "0" showed under cards with a 0% match.
- (Already on public `work`: faster ebook search for transcripts.)

Requested on Reddit, to build for both apps:
- Offline "my books only" Home — Continue + On this phone, no banners / Discover / recommendations (user listens offline from an SD card).
- Catalogue in more languages — Discover / Bestsellers / genres from Audible FR, DE, ES, IT… via a "Catalogue language" setting (French user).
- App translated into other languages (same French user) — big job: move every string to language files; do once features settle.
- Then post in r/RealDebrid (test with a real RD account first; check the sub's rules; reword, lead with RD).

## Libby (private, 1 Nov)
Working: card + PIN sign-in (several cards), availability on book pages and in search, borrow, hold, loans & holds on Home, renew, return, cancel hold, Listen in Libby.
Dropped after testing: Libby's code transfer (Libby says "synchronized" but the cards never reach this app's sign-in) and Play here (a card sign-in gets "missing_chip"). Revisit only if Libby's protocol becomes clear.

## Public released 1 Nov: v1.0.25
Everything up to the TorBox fallback (minus the M grab) is out in Audiohub v1.0.25. Next public work goes on `work` again.

## Notes of 31 Oct (from the PDF)
Done 31 Oct, not built yet: #1, #2, #3, and points 1, 2, 4, 9, 10, 11, 17, 18, 19, 29 (see git log),
points 8, 12, 13, 14, 15, 25 (chat / compass), 26 (A), 27 (broadcast), 20, 22, 30, 3, 23, 24, 28, Ivory & Gold theme (default), 6, 7, 5 (A), 21 — every 31 Oct point done except 16 (needs the add-on JSON); plus: sources are ordinary add-ons (no built-ins, Bookracy dropped), AudiobookBay seeds ("seeds ?" + TorBox count).
Still to do: the rest (design work gets samples first).
Also done 31 Oct (private only, not built): background M grab for MyAnonamouse (search → pick free/VIP + format + seeders → optional wedge (off by default) → download with 4 tries → qBittorrent; hold M opens the search); Continue cards take each book's current cover. Public: port the M grab only if asked.
To fix later (v1.0.154): a Library book opened with long-press → Details (file-named, e.g. "The Selfish Gene Unabridged 2_005") shows copies under Available but the Sources list stays empty / loose only — the clean-title fix wasn't enough; look at what title/author the Details page passes to SourceResults and the source search query.
GitHub (public app page): keep watching issues; tell first, fix, then wait for "build now".
- #1 Audiobookshelf sync: resume from the newer position (server vs app), sync/close the ABS session,
  show failed syncs, clientName "Audiohub".
- #2 Playback history: log play / pause / skip / seek / sleep stop with time and position; tap to jump. (Done 31 Oct, private app.)
- #3 "No playable stream for this part" ×11 — The Hobbit via TorBox (public 1.0.18).

Player & Text view
1. "Looking for your ebook…" never ends when nothing is found — no stop, no search, no attach. Look in
   source results first; let you attach from the phone or search sources yourself.
2. "Use another ebook" sheet can't be closed (Back / tapping outside) while "Searching your sources…".
3. Controls take too much room; Text should open full-screen text with a slim play/pause strip.
4. Chapter label wrong: real "Chapter 6" shown as "Chapter 8" (intro / credits counted).
5. Player backgrounds: light ones, or from the cover's colours. Player revamp (ChatGPT layout: cover as
   centrepiece on blurred cover background, source pill, chapter / X-Ray / Story pills, signature row
   Ask · Explain · Find in book · X-Ray, utility row Speed · Sleep · Text · Voice · Bookmark · More;
   sleep timer with fade-out; long-press timeline / chapter; a useful More menu like Absorb's:
   details, read, find in ebook, equalizer, cast, playback history, car mode, notes, download).
6. Text sometimes not in sync even with the ebook attached (The Secret).
7. Listening to the audiobook with the ebook open in the reader: highlight the current passage there.
8. Tapping a highlight (ebook or audio) should start ~30 s before it.

Sources & matching
9. "The Secret" offered / played "The Greatest Secret" as TorBox instant — another book must never be
   shown as instant / Available.
10. Series (Red Rising): other books of the series in results; sometimes the first one is another book.
11. "Read · TorBox" text spills out of its button (also in the expanded row).
12. FL/VIP + All buttons → one "M" (MyAnonamouse) button.
13. Book page: Offline vs Save — explain or merge.
14. A book already on Audiobookshelf: the TorBox button shouldn't send it there again.
15. Send to Kindle missing on torrent ebook results (only Read · TorBox / Save).
16. Integrate the new source you added (private app) — need its details.
17. Ebooks that aren't readable EPUBs: skip / hide them.

Book page
18. Audiobook app first: Available row — Listen copies (phone, ABS, TorBox) before Read EPUB.
19. ABS server offline: "Couldn't load details", no covers — fall back to the phone or TorBox copy.

AI & voice
20. Ask AI says "I don't have the full text" although the ebook / transcript is there — use them.
21. Ask AI page revamp (font, alignment, polish); share answers to other apps.
22. Voice commands vs AI mixed up: "play <book>" must play it (even with another book loaded / paused);
    commands act, questions answer. Book not in the library: play the best source (most seeds) when
    it's not on the phone / ABS, instead of "showing results".

Home, Library, look
23. Home too spread out; show how many books each source has.
24. Covers low-res / cut off (text and pictures) — show the whole cover like Absorb; borders that blend.
25. No "two little stars" (✦) icon anywhere — pick another.
26. Greeting: name and greeting in different fonts — still looks bad.
27. Podcasts icon: something more fitting.
28. Long-press a book: an action sheet (play, download, collection, reset progress, remove from
    Continue, details…) like Absorb.

Settings & misc
29. Kindle addresses disappeared (maybe after sign-out).
30. Settings: "Issues & support" (open a GitHub issue, contact, logging) like Absorb.
31. Who are the contributors on GitHub? (Answered: see chat — commits co-signed by Claude, and the
    original 93bx project the private repo started from.)

## Planned for Saturday — "Audiohub Lite" (a third, stripped-down app)
**3 Nov: suggested dropping Lite as a separate app** — it conflicts with the store edition (built-in debrid vs none). A simple mode / an edition of the shared codebase can cover it later.
- Audiobooks only, played through debrid (TorBox / Real-Debrid) — that's all.
- Left out completely: AI (Ask, X-Ray, Story, recaps, explain…), ebooks and the reader
  (and everything ebook-related: ebook sources/results, Send to Kindle, highlights, translate,
  transcript ebook matching), tracker / qBittorrent, Audiobookshelf, sync account / sign-in.
- To decide then: built from the public app or the main app; its own name, icon and package id
  (so it installs next to the others); which source add-ons it ships with (none, like public?).

## Public app — don't push anything until asked (27 Oct)
- Rule (31 Oct): every fix / feature is checked in the private app first; only then ported to public.
- Ported 31 Oct to public `work` (cdc7e67, not built): everything up to v1.0.151 — look (Ivory & Gold, player,
  Text, Ask AI, covers, long-press), M4B/MP3 chapters, ABS sync + Absorb fix, history, addon torrents, 31 Oct fixes.
  Quote sharing + short links included (31 Oct, at your request). Left out: one-tap suggested addons, Audiohub+ branding.
- To port when asked: GitHub #1 (ABS sync), #2 (playback history), #3 (addon torrents), and the 31 Oct fixes.
- Also to port: M4B / MP3 chapters (QuickTime chapter track, ID3 CHAP, Audible fallback) — a public user reported
  "no M4B chapters" (31 Oct); public 1.0.18 only reads the 'chpl' list. Fixed in private since 28 Oct.
- The ebook reader port (slide-select, Notes panel, translate, speed, safe highlights) is parked
  on the public `work` branch (commit cdc3595) — not built, not released. Quote sharing left out.

## Reported 24 Oct (v1.0.125) — fixed, not built yet
- Transcript: the text does move with the audio, but the current line's highlight is too faint
  (low contrast, hard to see). And the current line sits too high, partly hidden under the
  top fade; it should be a bit lower, clearly in view.

## Public app — waiting on its `work` branch (test build later, then release)
Done and pushed, not built:
- Sources: audiobooks first, then ebooks; ready to play first, then the most seeded.
- Ebook sources' results open with Read, never "Play now" (fixes "Getting the file list…" hangs).
- "Getting the file list": stops at once with the reason (no audio / ebook files, TorBox not answering).
- Report a problem includes TorBox file-list errors.
- Backup: saving a big backup no longer crashes the app (empty file).
- Addon links that can't be reached say which site; broken addon icons show the puzzle piece.
- No ready-made (one-tap) addons — the public app ships with no sources.
- Share these addon links (own domain): https://api.audiohubapp.com/addons/{audiobookbay,knaben-audiobooks,knaben-ebooks,bookracy}.json
- Later: README screenshots + feature list; optional Sponsor / Ko-fi button.

## To do — noted 25 Oct (main app, not started, don't build yet)
- Book page sources: back to the old order — **Audiobooks first, then Ebooks**.
  Each section collapsed except its **top 3 results**, with "Show all" to open the rest.

## Later — agreed 25 Oct, remember these (not started)
- Search in a book: a box on the book page that searches the ebook text and the heard transcript, tap to jump.
- Personal tags (Psychology, Science, Spirituality…) with Library filters.
- Listen-later / Up next queue across sources (books and saved passages), each keeping its place;
  handles unavailable sources, interrupted downloads and network changes. (Done 31 Oct, not built.)
- Audio playlists ("Best ideas about wealth") built from saved passages across books (book + timestamp each).
- Chapter summaries to browse (AI, kept once per book) and indexed passages. (Summaries done 31 Oct, not built.)
- Listening plans: 10 / 30 / 60 minutes from unfinished books and saved passages, with topics/books excluded.
  Helpful, no streaks or nagging notifications. (Done 31 Oct without the exclusions, not built; private only so far.)
- Android Auto.
- Cross-library passage map: related passages in other books, tap to jump (needs those books' ebooks).
- Highlights from transcript lines linked to audio timestamps.

## 26 Oct — fixed, not built yet
- Battery / wayward transcript: the transcript's ebook matching is back to word triples near the line
  before (the looser pair / "where in the book" matching of 24 Oct re-ran on every line and misplaced some).
  Cover trimming saves its list once after a burst; X-Ray builds its name matching once.
- Voice: jumping to a scene ("play when…", "the chapter where…") switched off — such requests go to
  Ask AI as a question. Commands, play a book, chapter N, find books and questions stay.
  (Scene finding code kept for later: src/lib/scenefind.js.)

## Built 25 Oct (v1.0.129) — main app wrapped up for now
- Voice button does everything: commands, books, scenes, "the chapter where…", find / recommend books
  (Discover + bookseller), anything else to Ask AI; car mode answers aloud.
- Scenes: exact book of a series, whole-book check beside the AI's chapter, your own words when the AI
  gives none, "couldn't find" said plainly. Ask about what you're hearing gets the transcript.
- Player: chapter pill under the title; sheets readable in light theme. Book page: slim Ask AI row,
  your copies side by side. Appearance: all colour themes under Mode, each mode keeps its own.

## Built 25 Oct (v1.0.128)
- Bookmark notes (✎) and one Markdown export (highlights, bookmarks, saved ideas); welcome-back recap
  after 14+ days; per-book speed and volume boost; your own OpenAI-compatible AI + what-leaves-the-phone note.
- Podcasts: episode 👍 / 👎 / Not interested, Recommended episodes, auto-download per show on Wi-Fi.
- Library smart shelves (Not started, Short listens, Recently added), series progress; Downloads storage
  (biggest first, remove finished).
- Chapter marks read from one-file M4B books (chapter list, end-of-chapter sleep, next chapter);
  search what you've heard in the transcript; player one row + More; paste a link to add / play / read.
- Not done from this list: updating the public repo (on "update public repo"); Android Auto (later);
  "keep your place when a book's files are replaced"; episode votes not yet fed into the book taste engine.

## Pending — older list (most of it built 25 Oct, see above)
**Podcasts, second batch**
- Timestamped notes while listening (extend Saved ideas): note at this moment, tap to jump back, search all notes.
- Episode ratings + "not interested", fed into the taste engine, with a "Recommended episodes" row.
- Auto-download new episodes: first version downloads on Wi-Fi when the app opens, for shows marked "auto-download"; background version later.

**Next batch (agreed, in the pipeline)**
- Series: group a series in Library, reading order, progress across the series, "next in series".
- Podcast auto-download rules ("new episodes from these shows, keep the last 5").
- Storage manager: space used per book, one-tap cleanup of finished downloads.
- Sleep timer "end of chapter" inside single-file M4B books.
- Notes on bookmarks; search inside transcripts.
- Smart shelves: Short listens (under 5 h), Not started, Recently added.
- Player: one row of main buttons + "More".
- Later: paste any link (direct MP3/M4B, archive.org) to add a book; home-screen widget; Android Auto; keep your place when a book's files are replaced.

**Public repo (on "update public repo")**
- Bring over: music + video filter, player fixes (offline downloads, screen-off next part, whole-book progress, speeds), books on the phone (+ covers), podcast batch 1, StoryShots, new design (Atelier, Discover, Library), listening stats.
- Remove Supabase sign-in and Send to Kindle; short plain README with a "built with AI help" note; add-on backup links on GitHub.

## Reported 21 Oct — fixed, not built yet
All 12 done (plus the screen-tour fixes: Home width, Back closes sheets everywhere, Settings
icons and footer, Library sort row fade, Saved filter hidden when it equals All). Check on the phone:
- Available row shows your Audiobookshelf copy (Cultish).
- Phone ebooks: list view opens the reader; the book page works; covers from inside the EPUB /
  the PDF's first page; a cover picked with Find cover & details stays after rescans.
- Read aloud: headphones starts at once (voice picker: headphones again, or the mic in the bar);
  a tap shows / hides the bars, a double tap reads from that paragraph; a tapped preface or its
  chapter in Contents is read; "Part I" → "Part 1"; colons are a pause; jumping is quick.
- Reader panels have Close; Back closes panels / sheets / selection before leaving the book.
- AI sheet readable on Sepia / Paper; **bold** shown properly.
- Transcript: when the book's ebook is on the phone (kept, phone folder, the audiobook's own
  folder), the lines show the ebook's real words ("Words from your ebook of this book").
  Not done: a larger, more accurate English speech model (for books with no ebook).

## From the 24 Oct notes — built in v1.0.125
- Voice command on Home (mic button): "play when Harry first boards the Hogwarts Express" →
  AI names the book, chapter and how far in; your copy is found (playing, phone, downloads,
  played before, Audiobookshelf, TorBox / RD — else Search) and starts 30 s before it. A line
  heard earlier with the transcript on gives the exact moment.
- X-Ray in the player: a quiet line of the chapter's topic and who / where is in the scene
  (from the transcript's last 3 minutes, else the chapter's cast); the X-Ray sheet lists people
  and places so far — tap one for every chapter they're in and jump there. Spoiler-safe.
- Sources: EPUB / PDF torrents show Read · TorBox / RD (opens the reader) and Save keeps the ebook.
- Recommended cards: no description line.

## Made for the public app (20 Oct), not in this app yet
Built and tested in the public Audiohub (drdilips1/Audiohub, test build 1.0.12, not released).
Port when wanted:

1. **Backup saves a real file:** Export opens Android's Save screen (`audiohub-backup-<date>.json`
   in Downloads), Import opens the file picker; "Paste a backup instead" for text backups.
   Native `saveFile` / `openFile` in InkwellLocalPlugin.
2. **Backup includes everything:** podcasts, ratings, stats, addons, settings, plus logins and API
   keys (TorBox, Real-Debrid, Groq/OpenRouter, Audiobookshelf, qBittorrent, sync server) behind an
   "Include logins & API keys" switch. Caches and phone-only data left out. Restore reloads the app.
   This app's backup still holds only library, progress, bookmarks, addons and settings.
3. **Account: one Continue button** (signs in, or creates the account), no confirmation email:
   setup SQL adds `audiohub_confirm()` so the app confirms the account itself; also fixes accounts
   stuck waiting for the email. Messages stay on screen. Needs that SQL run on this app's server.
4. **Account: server URL tidied** (keeps only https://….supabase.co if /rest/v1/ is pasted) and
   newer `sb_publishable_` keys work. Shorter setup steps with the phone-paste tip.

(Already in this app, copied the other way: Ask AI; Microsoft voice not dropping to the phone
voice after a silent piece.)

## Done here, not built yet
- Text: no endless "Starting speech recognition…" after turning Text off and on (Android + iPhone).
- Text: smaller speech packs that unpack in seconds (.tar.gz; Hindi pack 94 MB instead of 208 MB).

## Done (v1.0.114–115)
- Atelier look; Discover (pick of the week, moods, genre tiles, trending, search + bookseller in one box); Library (On this phone, sort, list); big Continue card; cards with format · length · narrator; listening stats; faster AI.

## Done earlier
- Driving mode (🚗 on Home and in the player; app-icon shortcuts "Driving mode" and "Ask AI")
- Ask AI answers in Microsoft natural voices, with an "Answer voice" picker (Indian voices first)
- ✨ Ask AI button in the top corner of every screen (already in v1.0.104)
- Sources: show a source's earlier results for the book when it doesn't answer

## Welcome screen and sign-in (planned)
**First launch only**
- Animated logo: the "A" draws itself, then the sound-wave line pulses (about 1.5 s, SVG — no video).
- A soft chime plus a spoken "Welcome to Audiohub", pre-recorded in a natural voice and shipped with the app
  (a few KB). On by default, can be switched off. The web app plays it after the first tap,
  because browsers block sound before you touch the page.
- Then a short setup, 3 steps, each skippable:
  1. Where your books are (Audiobookshelf / TorBox / Real-Debrid)
  2. Pick a voice
  3. Free AI key (Groq or Gemini) for Ask AI
- Later launches: straight to Home. After sign-in the greeting uses your name ("Good evening, Dilip").

**Sign-in options (Supabase, which the app already uses)**
| Option | Cost | Notes |
|---|---|---|
| Continue with Google | Free | Already coded; needs a Google Cloud sign-in client set up once |
| Email code (6-digit code or magic link) | Free | No password to remember — easiest for family |
| Email + password | Free | Already works |
| Use without an account | Free | Everything stays on the phone, no sync |
| Microsoft / GitHub / Discord | Free | Possible, rarely needed |
| Sign in with Apple | $99/year Apple developer account | Not worth it for us; iPhone users can use Google or email code |
| Phone number (SMS code) | SMS charges | Skip |

Recommended: Google + Email code + Email/password + "Skip for now".

## Design overhaul (planned) — "calm & premium", whole app, Book page first
Like Apple Books / Audible: breathing room, big covers, soft cards, one accent colour.
- **One design system**: a single spacing scale (8-pt), 3 text sizes per screen (title / body / caption),
  one card style, one button style (filled primary, quiet secondary), one accent colour (cover colour only
  on the book page and player). Remove one-off styles that grew over time.
- **Fewer things on screen**: badges, chips and emojis only where they carry meaning; secondary actions
  move into a "⋯" menu.
- **Book page** (top to bottom): large cover on a soft blurred backdrop → title, author, narrator, length
  → one primary action (Play / Get it) → ratings as one quiet line (Goodreads ★ + Audible) → description
  with "More" → Ask AI as one compact card → Where to listen (sources) → More like this. Fix details,
  Hardcover and similar go into the ⋯ menu.
- **Home / Library / Discover / Settings**: consistent headers, same row/card sizes, quieter section
  titles, Settings as grouped lists (like iOS Settings).
- **Player**: bigger cover, cleaner control row, secondary chips (Speed, Sleep, Text, Story, Drive) in one
  tidy row.
- Light and dark both checked; screenshots of every screen before/after for approval.

## Ideas from Grok (only what the app doesn't have yet)
Built (waiting for the next build):
- Player "AI companion" row: ✨ Ask · 🧠 Explain · 🔍 Challenge · 🐇 Rabbit hole · 📚 Related · 💾 Remember —
  about the part you're hearing; the book pauses and the mini player brings you back.
- 💾 Remember this → saved idea cards (Ask my books → Saved ideas), and Ask my books answers from them.
- Book-vs-book debate and "idea that keeps coming up" questions in Ask my books.
- Mood requests for the bookseller ("I'm exhausted…", "I have 40 minutes…").

Possible next (medium):
- PDF / web page / Word → listen (text extraction + the read-aloud voices); EPUB already works.
- Research paper → two-voice "podcast" (AI writes a host/expert script, two Microsoft voices read it).
- Listening modes by time of day / time available (picks from your library).
- Auto-resume after an answer in the normal Ask screen (Driving mode already does it).

Hard or not realistic right now:
- "AI Director" (different acted voices per character, ambience) — needs the book's text and studio-grade
  voice acting; only possible for ebooks, and results would be uneven.
- Dynamic compression of an audiobook (70% / 40% / 12 minutes) — the app has the audio, not the text,
  so it can't cut the recording itself; AI summaries ("Blinks") already cover the short versions.
- Knowledge graph / visual concept map across books — large; Saved ideas + Ask my books is the first step.

## Other ideas
- Add Google Gemini as a third free AI option (often better Hindi/Hinglish than Groq).
- Driving mode: a "🎙 Ask" button in the playback notification / lock screen (native work).
- Web app live transcript via Groq Whisper — decided not to do.

## Your taste (recommendations) — later, both apps
Today the "Recommended / New releases / Top this month" rows use your top 3 non-fiction topics, learned
from genres of rated / finished / saved books; cloud and phone books carry no genres, so it often falls
back to Psychology, Science and History. Recommended rows are non-fiction only. No way to reset it.
- "Your taste" card in Settings: shows the 3 topics in use; pick your own (they replace the guess).
- Start fresh: forget learned listening history, keep ratings and "Not for me".
- Fiction too: a switch to let fiction into the recommended rows.
- Show samples/screenshots before building.
