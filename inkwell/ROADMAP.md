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

## Other ideas
- Add Google Gemini as a third free AI option (often better Hindi/Hinglish than Groq).
- Driving mode: a "🎙 Ask" button in the playback notification / lock screen (native work).
- Web app live transcript via Groq Whisper — decided not to do.
