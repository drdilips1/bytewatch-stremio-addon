# Audiohub — ideas and to-do

Noted while building; to pick up after Saturday.

## Reported 24 Oct (v1.0.125) — noted, not looked at yet
- Transcript: the text does move with the audio, but the current line's highlight is too faint
  (low contrast, hard to see). And the current line sits too high, partly hidden under the
  top fade; it should be a bit lower, clearly in view.

## Pending — agreed, not started yet
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
