# Audiohub — ideas and to-do

Noted while building; to pick up after Saturday.

## Done, waiting for the next build
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
