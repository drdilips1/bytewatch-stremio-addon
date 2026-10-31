# Audiohub — ideas and to-do

Noted while building; to pick up after Saturday.

## Notes of 31 Oct (from the PDF)
Done 31 Oct, not built yet: #1, #3, and points 1, 2, 4, 9, 10, 11, 17, 18, 19, 29 (see git log).
Still to do: the rest (design work gets samples first).
GitHub (public app page): keep watching issues; tell first, fix, then wait for "build now".
- #1 Audiobookshelf sync: resume from the newer position (server vs app), sync/close the ABS session,
  show failed syncs, clientName "Audiohub".
- #2 Playback history: log play / pause / skip / seek / sleep stop with time and position; tap to jump.
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
- Audiobooks only, played through debrid (TorBox / Real-Debrid) — that's all.
- Left out completely: AI (Ask, X-Ray, Story, recaps, explain…), ebooks and the reader
  (and everything ebook-related: ebook sources/results, Send to Kindle, highlights, translate,
  transcript ebook matching), tracker / qBittorrent, Audiobookshelf, sync account / sign-in.
- To decide then: built from the public app or the main app; its own name, icon and package id
  (so it installs next to the others); which source add-ons it ships with (none, like public?).

## Public app — don't push anything until asked (27 Oct)
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
  handles unavailable sources, interrupted downloads and network changes.
- Audio playlists ("Best ideas about wealth") built from saved passages across books (book + timestamp each).
- Chapter summaries to browse (AI, kept once per book) and indexed passages.
- Listening plans: 10 / 30 / 60 minutes from unfinished books and saved passages, with topics/books excluded.
  Helpful, no streaks or nagging notifications.
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
