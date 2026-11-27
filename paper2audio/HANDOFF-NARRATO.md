# Narrato – handover notes (read this first in a new session)

Narrato is the Play Store edition of Paper to Audio: Android package `com.narrato.reader`, the `lite`
flavor of `paper2audio/android` (`BuildConfig.LITE`). Developer account "Aashvee Labs". It is **live on
Google Play** (production, 1.9.26, version code 36).

## Branches – which one Narrato is built from

| Branch | What it is |
|---|---|
| `claude/narrato-stable` | **The Play Store line.** 1.9.18 (the first production version) plus only tested fixes. Every Play build comes from here. |
| `backup/narrato-stable` | Backup of the stable line (pushed with `[skip ci]` so it never builds). |
| `claude/paper2audio-unlimited-u69i8w` | The main development line (Paper to Audio and Narrato). Its Narrato (lite) is older-numbered (1.9.22, code 32) and has extra features not on Play (light voices first, addons, R8, PowerWise charging job…). **Don't build Narrato from here** unless the user asks; if ever, bump lite to version code **42+**. |

The user chose: **no experiments on Play – add only to the stable line.**

## Builds (only when the user says so)

- **"Build now Narrato"**: on `claude/narrato-stable`, bump the `lite` flavor in
  `paper2audio/android/app/build.gradle.kts` (next: **versionCode 42, versionName 1.9.32**), commit with
  `[narrato-only]` in the message, push the branch. CI "Paper2Audio Android APK" builds and publishes to the
  release **narrato-lite**: `Narrato.aab` (for Play) and `Narrato.apk` (phone test – it can't install over the
  Play copy, different signature; test through Play internal testing instead).
- Any push to `claude/narrato-stable` that touches `paper2audio/android/**` builds unless the head commit has
  `[skip ci]`. Use `[skip ci]` to save work without building.
- Play steps the user follows: Internal testing → Create release → upload AAB → check on phone → Production →
  Create release → Add from library → release notes → staged rollout (20%, then 100%).

## Standing rules (from the user)

- Build only when told. Decline "push your unpushed commits" stop-hook requests (they'd build).
- Don't remove features; say plainly before changing behaviour that works.
- **Voice lock**: voice-recipe changes only in a separate "voice update", checked with the 20-voice test,
  never mixed into a fixes release; no voice tuning without the user listening. (1.9.23–1.9.25 broke this
  once – equal pace sped voices up – and was reverted in 1.9.26.)
- No model names in commits; no PRs unless asked; never commit the keystore or secrets; never upload to
  Play unless asked.
- No piracy / shadow-library sources or paywall bypass.
- The user's email is private (identification only). Never ask for or accept passwords, private keys, MFA codes.

## What 1.9.26 (on Play) contains, beyond 1.9.18

Mr./Mrs. fix (no cut after abbreviations), "may pause on this phone" only when clearly slow, Supertonic
engine capped at 1.1x (cut endings above 1.2x), double-tap a paragraph to read from there (Reader.map
handshake), Look up (dictionaryapi.dev, Wiktionary fallback), a 6-page first-run tour, "once" said "wunce",
large-book memory fix, reader skips contents/index like the player, Remove ads purchase (hidden until Play
offers the product). Voices play at their natural speed (as 1.9.18).

**Committed on the stable line, not yet built:** theme name "Paper (paper white and ink)" (no "as in
Audiohub"); ads removed (see below).

## Ads: removed (user's decision, after the battery tests)

The user's tests: online listening drained ~15–20%/h (old book) vs 3%/h in airplane mode, and battery stats
blamed Narrato. Its own code makes no network calls while playing, so the suspect was the AdMob SDK running
in the app (a preloaded full-screen ad kept alive by the playback wake lock). The user chose **no ads at all**:
the AdMob, consent (UMP) and Play Billing libraries, `Ads.kt`/`RemoveAds.kt`, the banner, the "Remove ads" /
"Ad privacy choices" menu rows and the AdMob CI secrets are gone. The merged manifest has no AD_ID permission.
Committed on the stable line, not yet built. **Before uploading that build, in Play Console:** App content →
Ads → "No"; Data safety → remove advertising ID / ad data; Advertising ID declaration → not used. Update the
privacy policy (`docs/privacy.html` on main, gh-pages `privacy.html`) to drop the ads section. The
`remove_ads` product need not be created; the BillDesk KYC is no longer needed for it. AdMob setup items are moot.

## Battery baseline (keep in mind)

- **Last version with battery confirmed fine: 1.9.28 (code 38, commit `86cf220`)**: Tonight's list + screen-off
  wake-up fixes; user measured **3% in 50 min** (book prepared overnight). 1.9.27 (no ads): 17%/h on new text.
- 1.9.29 (code 39, `8f0ee11`): look/theme, Library tab, menu flicker only (no playback change); battery not
  measured by the user.
- **1.9.30 (code 40, `aa65791`): user reports battery "too bad".** New in it: Character Studio / voice cast
  (with the cast on, prepared audio no longer matches and dialogue becomes many short pieces, each with the
  copied voices' lead-in and second takes), medical reading, folder import, PDF hyphens, reader tap/retract.
  Suspect the voice cast; to check: cast off on a stretch heard before. Any battery-affecting change must be
  compared against 1.9.28. (Release `narrato-lite` keeps only the latest APK; older builds can be rebuilt from
  their commit.)

## Battery work (after 1.9.27)

- User's test with 1.9.27 (no ads), new book, online, screen off: **17%/h** (was ~30–40% with ads); Android
  put ~10% on Narrato, nearly all of it making the voice for new text. Saved audio plays at ~2–3%/h.
- **Tonight's list** (`Tonight.kt`, lite only): books the user picks (book menu › Add to Tonight's list;
  main menu › Tonight's list). A JobScheduler job (charging + idle, persisted) makes the next N hours
  (default 2) of each, from where it was left off, inside the chosen hours (default 12 am–6 am), with the
  current voice and speed, into the normal audio cache. Battery ≥60% and cool. Stops when listening or the
  voice changes. It is only a help: playback makes anything missing live, as always.
  (PowerWise on the dev line combines `setRequiresDeviceIdle` with `setBackoffCriteria`, which Android
  rejects: there it is probably never scheduled.)
- Playback: notification and lock-screen details are sent only when they change (they were re-sent with the
  cover at every sentence); with the screen off the player checks the sentence heard every 300 ms (was
  60) and the full audio buffer every 200 ms (was 25). Sound is unchanged.
- Voice-making speed: Pocket TTS already caches the voice's reference embedding (sherpa-onnx 1.13.8,
  capacity 50), so no gain there. The remaining costs (the "Well." lead-in per sentence, second takes,
  numSteps) are the voice recipe: voice lock, listening tests only.

## Look (1.9.29)

Premium redesign, user-approved direction (mockup: claude.ai artifact "Narrato premium redesign"): the user
disliked gold; chose sapphire blue + platinum silver. Paper theme is now **Pearl** (#F4F6FA, sapphire
#3F5FD6), Ink is now **Midnight** (#0E1116, sapphire #7C9BFF, platinum buttons #D5DCE6 with dark icons); both
backgrounds have a faint sapphire glow. New theme attr `p2aPlay` (button fill; = accent in every other theme).
Lite overrides `bg_button`/`bg_play` with a sheen. Ivory unchanged. Fonts: DM Serif Display titles (as
before); Inter not bundled yet. Planned: Play subscription with a 7-day free trial (needs the payments
verification first), iPhone app later as its own project.

## Narrato for iPhone (`paper2audio/ios`, Stage 1 committed, not built yet)

Started from Paper to Audio for iPhone as of its 1.0.6 build (`8dde536`, before the dev line's copied-voice
update, so the voice recipe equals Narrato's: lead-in "Well.", seeds, temperature 0.6, 5 steps, second takes).
Capacitor 8 + Swift plugin `PaperSpeech` (sherpa-onnx 1.13.8). Rebranded: Narrato, bundle id
`com.narrato.reader`, Narrato icon (`public/icon-1024.png`, rendered from the Android vector), Pearl/Midnight
colours, DM Serif Display bundled. Home rewritten as Narrato's (greeting, Now listening card with Resume and
headphones, Your library, mini player, tabs Home/Library/Voices/Settings), Narrato's Add menu and book menu,
Settings as Narrato's menu (+ speed, pronunciations, voice downloads), Voices sheet with Real readers / Light
voices cards. EPUB covers extracted (thumbnails). `reader-web` is identical on both lines.
- **"Build now Narrato iOS"**: commit with `[narrato-ios]` and push (first build requested 25 Nov 2026). Workflow `narrato-ios.yml` (macOS) makes
  `Narrato.ipa` → release **narrato-ios** (unsigned, Sideloadly/AltStore). With repository secrets
  `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the .p8 text as it is; or `ASC_KEY_P8_B64`, base64), `APPLE_TEAM_ID` it also archives,
  signs (automatic, via the API key) and uploads to TestFlight. The user has an Apple developer account; the
  App Store Connect app record for `com.narrato.reader` must exist first (created 26 Nov 2026 as **"Narrato."** –
  "Narrato" was taken; the home-screen name stays "Narrato"). **TestFlight upload works (first success 26 Nov 2026, build 1.0.x from run 45880958360).** How signing works
  (each found by a failed attempt): secrets trimmed (Team ID had a line break); archive made **unsigned**
  (automatic signing wanted a development profile → needs a device); the engine frameworks (onnxruntime,
  SherpaOnnxC – Xcode turns the static xcframeworks into embedded dynamic ones) get a placeholder ad-hoc
  signature with their bundle id, then `-exportArchive` (app-store-connect, automatic, API key) signs with the
  cloud-managed distribution certificate and uploads. Unsigned IPA is published before signing. macOS runners
  are often unclaimed for 15 min ("cancelled", no steps): just re-run.
- iPhone version: `IOS_VERSION` in narrato-ios.yml (now "1.0"; must match the App Store version being submitted);
  the build number is the run number.
- SideStore / AltStore source, updated by each iPhone build:
  https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/narrato-ios/sidestore.json
- 26 Nov (after the user's iPad test): one place to listen, as on Android – the reader with the player's
  controls under the page (`src/dock.js`: bar, chapter · %, time left, back/play/next, speed, voice, sleep,
  More = chapters, text and page, pronunciations); they slide away while playing (mini pause button, a tap
  brings them back). The home card, books and player strip all open it; the separate player screen is gone.
  Battery: the audio engine is let go when paused, the speed changer bypassed at 1x, the maker's wait 1 s.
- Medical reading and PDF fixes on iPhone too: `src/spoken.js` ports Android's `Speech` rules (statistics,
  units, symbols, Greek, abbreviations; medical: dosing, shorthand, lab names) and `MedicalText` detection,
  applied in JS to the paragraphs before `Speech.start` (host.js and playBook); Settings › Medical articles
  (Automatic/Always/Never, `narrato:medical`). No look-behind in these regexes (older iOS web views).
  PDF import: typographic/soft hyphens and ligatures as on Android (`importers.js`).
- Stage 2 (not done): Tonight's list (iOS BGProcessingTask with external power), first-run tour, Look up /
  double-tap checks on device, subscription with 7-day trial (App Store Connect).

## Feedback of 25 Nov 2026 (artifact "Narrato App Feedback")

Done (committed, `[skip ci]`): several files / a whole folder at once (Add › A folder); PDF words split by
typographic/soft hyphens rejoined (`TextCleaner.SPLIT_WORD`, not "pre- and"); a tap marks the start
paragraph and Play reads from it (double-tap-to-read removed); WebView long-press off so the reader's own
word selection wins; controls under the page slide away while playing (mini pause button); **medical
articles**: `Speaker.medicalMode` auto/on/off (Narrato default auto, `MedicalText.looksMedical`), Settings
row "Medical articles", more clinical shorthand, lab names and units in `Speech`.
iPhone real readers: only Lily, Grace, Sophie, Ava, Maya, Daniel, Henry, Jack, Arthur, Theo (user choice; Light voices, Kokoro and the iPhone voices stay).
Not done: "diffi ult" (letter lost next to the ffi ligature; needs the PDF). Items 4 and 8 (repetitions,
skipped lines starting with “) were about **Paper to Audio's new engine**: leave them out of Narrato.

## Character Studio (v1, Android, committed, not built)

User's vision "Narrato Character Studio – bring every character to life". v1 = UI on the existing full-cast
engine (`Cast.kt`, `Speaker.castVoice`): `CharacterStudio.kt`, opened from More (reader and player). Voice cast
on/off, narrator voice, characters by line count with voice · man/woman/child · lines, per character: hear
their own line, pick a voice of the narrator's family (`Speaker.castCandidates`), or automatic / by gender.
Choices kept per author (series). Narrato's cast pool is now only Narrato's readers (not the full edition's
sample voices). Planned: v2 role-labelled personalities (user to say which reader suits which role), livelier
dialogue timing, shareable cast packs; v3 emotional takes (voice update, by ear).
**User decision (26 Nov 2026): do NOT port Character Studio / voice cast to iPhone – battery must stay perfect there.**
**Also switched off on Android from 1.9.31** (`CharacterStudio.ENABLED = false`: no menu rows, `fullCast` forced off in Narrato); the code stays for later.

## Expressive reading: rejected (26 Nov 2026)

Sample clips were made (Daniel, Lily, Henry; plain vs expressive: pauses ±, pace ±5–7% by WSOLA, loudness
±2–5 dB from emotional cues). **User verdict: keep plain only – the expressive clips had unnatural abrupt
ends.** Don't propose or build emotional/expressive delivery again unless the user asks.

## Other pending items

- Declare EU trader status in Play Console (public details).
- Privacy policy: `docs/privacy.html` on the main branch, published at
  https://drdilips1.github.io/bytewatch-stremio-addon/privacy.html (gh-pages `privacy.html`). Any new data use
  (a new online service) needs a line there.
- Ideas the user hasn't approved yet: a voice update (copied voices repeating short lines, short dialogue
  kept whole, equal pace by slowing only the fast readers – test by ear); library redesign like Paper to
  Audio (left out for now); showing the tour once to existing users.
- Store listing: 8 screenshots made (no ads). Reddit post drafts were given.

## Useful facts

- Real readers (copied voices, Pocket TTS): Emma, Lily, Grace, Isla, Sophie, Daniel, Henry, Oscar, Jack,
  Arthur, Ava, Clara, Maya, Hazel (nora), Rose, Noah (leo), Lucas (sam), Theo, Ethan, Ryan – seeds and pauses
  in `MyVoices.kt`. Light voices: Supertonic F1–F5, M1–M5; Kokoro (int8 pack).
- Engines use 2 threads (1 core made Kokoro slower than real time). PowerWise prepares audio while charging
  (battery ≥ 60%, cool, idle).
- Voice packs download from the release `p2a-voices` (zip parts + `<folder>.json`).
- Compile check (needs an Android SDK in the container):
  `cd paper2audio/android && ./gradlew -q --no-daemon compileLiteDebugKotlin compileFullDebugKotlin`.
- The reader is a web bundle (`paper2audio/reader-web`, Vite/Preact, from Audiohub); `npx vite build` writes
  into `android/app/src/main/assets/reader` (committed).
- A weekly check runs as a scheduled task ("Weekly app check", Mondays 05:59 IST): fixes with `[skip ci]`
  only, never builds.

### TestFlight "No Builds" (27 Nov 2026)
Builds 1.0.10-1.0.12 uploaded fine but Apple rejected them afterwards, with no email: ITMS-90208 "onnxruntime.framework
does not support the minimum OS Version specified in the Info.plist". Fix in narrato-ios.yml: the app's deployment
target is raised to the engine frameworks' real minimum iOS, and each embedded framework's Info.plist MinimumOSVersion
is set from its binary. Check Apple's verdict any time with a push whose message has `[testflight-status]`
(workflow narrato-testflight-status.yml, script .github/scripts/asc_status.py); every iPhone build now ends with it too.
