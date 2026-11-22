# Narrato – handover notes (read this first in a new session)

Narrato is the Play Store edition of Paper to Audio: Android package `com.narrato.reader`, the `lite`
flavor of `paper2audio/android` (`BuildConfig.LITE`). Developer account "Aashvee Labs". It is **live on
Google Play** (production, 1.9.26, version code 36).

## Branches – which one Narrato is built from

| Branch | What it is |
|---|---|
| `claude/narrato-stable` | **The Play Store line.** 1.9.18 (the first production version) plus only tested fixes. Every Play build comes from here. |
| `backup/narrato-stable` | Backup of the stable line (pushed with `[skip ci]` so it never builds). |
| `claude/paper2audio-unlimited-u69i8w` | The main development line (Paper to Audio and Narrato). Its Narrato (lite) is older-numbered (1.9.22, code 32) and has extra features not on Play (light voices first, addons, R8, PowerWise charging job…). **Don't build Narrato from here** unless the user asks; if ever, bump lite to version code **37+**. |

The user chose: **no experiments on Play – add only to the stable line.**

## Builds (only when the user says so)

- **"Build now Narrato"**: on `claude/narrato-stable`, bump the `lite` flavor in
  `paper2audio/android/app/build.gradle.kts` (next: **versionCode 37, versionName 1.9.27**), commit with
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
Audiohub").

## Remove ads ($2.99, product id `remove_ads`)

- Code: `paper2audio/android/app/src/lite/java/com/paper2audio/app/RemoveAds.kt` (Play Billing 8), stub in
  `src/full`. Menu rows appear only once Play returns the product's price.
- Blocked on the user's Google payments verification: BillDesk video KYC (application ID 2611083835, link
  valid 500 days). The user will do it from their permanent (parents') address on a visit home; then create
  `remove_ads` at $2.99 in Play Console → Monetize → One-time products → Activate. No app update needed.
- US tax form (W-8BEN) done; legal address verified (bank statement); public merchant profile should match
  the verified address; GSTIN alert can be ignored (no GST registration needed at this income).

## Other pending items

- AdMob → "Finish app setup": link to Google Play choosing **"Add to an existing AdMob app"** (Narrato).
  Then app-ads.txt on GitHub Pages and that site as the Play listing's website.
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
