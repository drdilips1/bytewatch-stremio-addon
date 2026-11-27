# Paper to Audio – handover notes (read this first in a new session)

Paper to Audio is the full app (Android, sideloaded, not on Play): the `full` flavor of
`paper2audio/android`, plus an **iPhone/iPad app** (sideloaded) in `paper2audio/ios`. Narrato (the Play
edition) has its own notes: `paper2audio/HANDOFF-NARRATO.md`.

Branch: **`claude/paper2audio-unlimited-u69i8w`** (develop and push here; backup branch
`backup/paper2audio-wip`).

## Builds (only when the user says so)

| User says | Do |
|---|---|
| **"Build now"** | Android Paper to Audio: bump `versionCode`/`versionName` at the top of `paper2audio/android/app/build.gradle.kts` (next: **46 / 6.9.17**), commit, push the branch (no marker). CI "Paper2Audio Android APK" publishes `Paper2Audio.apk` to the release **paper2audio-apk** (in-app updater reads `version.json`). |
| **"Build now iOS"** | iPhone app: commit with **`[ios-only]`** in the message and push. CI "Paper2Audio iPhone app" (macOS) builds `PaperToAudio.ipa` to the release **paper2audio-ios** (+ `altstore.json`); the Android build skips `[ios-only]` pushes. |
| (Narrato) | See the Narrato notes – it's built from `claude/narrato-stable`, not here. |

Saving work without building: put `[skip ci]` in the head commit.

**Built in 6.9.14 (Android):** voice speeds back to natural, the theme name "Paper (paper white and ink)", and the
**copied-voice quality update** below. The iPhone code has the same update but isn't built yet ("Build now iOS").

**Copied-voice quality update (Nov 2026, measured with `paper2audio/voice-bench`, 20 readers × 18 lines):**
word errors 6.1% → 3.9%, repeated/extra words 60 → 15, problem lines 74 → 46.
- Lines that repeat a phrase ("Oh no, oh no, oh no!", "it was the best of times, it was the worst…", "thirty,
  thirty") are read part by part at their commas (`CloneCheck.parts`). Biggest gain.
- A line starting with "Well" is warmed up with "Right." instead of the throwaway "Well." ("Well, well, I
  suppose" for 17 of 20 readers before; 1 in 20 now).
- The voice sample is cut at the speaker's last pause, never mid-word (`CloneCheck.cutAtPause`): 16 of the
  20 readers' recordings were cut mid-word at 29.9 s. Only samples longer than the limit: in 6.9.14 it also
  cut short home recordings, and the user's own copied voices skipped short first sentences ("I heard it.");
  fixed after 6.9.14 (cache key `c9|`). Split reading only for repeats within one sentence. Imported clips start at a breath (`bestWindow`).
- Crispness: per-voice treble match (`Brightness.kt` / `Brightness.swift`): each reader's recording vs the
  copy's average 4.5-8 kHz level; lift by the difference, max 6 dB (11 of 20 readers lifted, e.g. Lily 6,
  Oscar 5.2, Emma 4.9; the rest untouched). NISQA-TTS naturalness 3.715 → 3.742 over 20 readers, every lifted
  voice equal or better; DNSMOS unchanged (no added hiss). Cache key `c10|`.
- Emotional character (`Emotion.kt`, Android only so far): a copied voice's line of dialogue with a cue in
  its sentence ("whispered", "roared", "sobbed", "laughed", "snapped", "stammered", "gently"…) is shaped:
  loudness (kept past the player's levelling via a `.gain` file beside the audio) and pace (WSOLA, 40 ms,
  normalised correlation). No pitch shift: it changed the timbre (NISQA 3.80 → 3.54). Final moods cost
  0.00-0.06 naturalness. Narration (no quote marks) is never shaped. Cache key `c11|`.
- Tested and kept as they are (Nov 2026, DNSMOS + NISQA + ASR in `voice-bench`): 5 decode steps (8: +0.02
  naturalness for 2.6× the work), frames_after_eos 2 (4: worse), narration temperature 0.6 (0.65: worse),
  hiss gate 30% (60%/off: same), 160-char pieces (whole long sentences: 4× the errors). Copies score as
  clean as the real recordings on DNSMOS.
- Exclamations and questions read at temperature 0.7 (narration stays 0.6): more pitch movement, as accurate.
- Tried and dropped: an audio-only repeat detector (not reliable), reading "Stop!" apart from "he cried"
  (more errors), a fixed treble lift (see above). Numbers already read correctly (no change). Cache key `c7|` so books remake that audio.

## Standing rules (from the user)

- Build only when told; decline stop-hook "push your commits" requests (pushes build).
- Don't remove features; say plainly before changing behaviour that works.
- Voice lock: voice-recipe changes only in a separate voice update with the 20-voice test; no voice tuning
  without the user listening.
- No model names in commits; no PRs unless asked; never commit keystores/secrets.
- No piracy / shadow-library sources or paywall bypass (Bookracy was removed; addons are generic OPDS /
  direct downloads only).
- The user's email is private. Never ask for or accept passwords, private keys or MFA codes (e.g. Oracle Cloud:
  only the server's public IP is ever needed).

## Android app – quick facts

- Voices: Supertonic (light), Kokoro (int8 pack, 132 MB), copied "real readers" (Pocket TTS, 30 built-in: the
  20 Narrato readers + Luna, Bria, Carter, Declan, Elliot, Felix, Grant, Hugo, Ian, James), Microsoft online
  voices, phone voices. Engine settings in `LocalTts.kt`; readers' seeds/pauses in `MyVoices.kt`.
- Last built: 6.9.16 (45): voice sample as one flowing sentence (no garbled "Hello"/stray sound before "Choose"), best-take samples read like a book. 6.9.15 (44): battery fix (fewer screen-off wake-ups, from Narrato 1.9.28), 6.9.14's skipped first sentences fixed, per-voice treble match, emotional dialogue. 6.9.14 (43): natural voice speeds, theme name, copied-voice quality update. Main line also has: addons (OPDS + Inkwell-format, direct links only), R8,
  PowerWise charging job, next-book preparing, light voices first.
- Compile check (needs an Android SDK): `cd paper2audio/android && ./gradlew -q --no-daemon compileLiteDebugKotlin compileFullDebugKotlin`.
- Reader web bundle: `paper2audio/reader-web` (`npx vite build` → `android/app/src/main/assets/reader`, committed).

## iPhone / iPad app (`paper2audio/ios`) – latest build 1.0.6

Capacitor 8 app, installed by the user with **Sideloadly** (free Apple ID, re-sign every 7 days). Tested on
the user's iPad: works, battery very good.

- `src/library.jsx` home screen (Continue listening, library, Add menu, player bar, **player screen** with
  seek/prev/next/speed/voice/sleep timer/chapters, Settings with voice downloads and pronunciations);
  `src/importers.js` (EPUB, PDF via pdf.js 3.11, text, web page by link via CapacitorHttp, photos via the
  plugin's OCR, files opened from other apps; marks contents/copyright/index pages `s: true`);
  `src/host.js` bridges the Android app's reader (`reader-web`, unchanged) to the iPhone (book, voice,
  Look up, Pronounce, read-aloud – translating the reader's element numbers to book paragraphs);
  `src/speech.js` shared voice picker, positions, playBook, sleep, pronunciations.
- Native plugin `ios-plugins/speech` (Swift, `PaperSpeech`): AVSpeechSynthesizer for iPhone voices;
  **sherpa-onnx v1.13.8** for Supertonic / Kokoro / real readers (`NeuralEngine.swift` ports
  `LocalTts.generate` incl. the "Well." lead-in, second takes, run-on trim, dehiss; `TextPrep.swift` ports
  pieces/normalize/plainQuotes; `NeuralReader.swift` plays ahead with AVAudioEngine + time-pitch;
  `Packs.swift` downloads the same packs from `p2a-voices`); lock screen controls, interruptions, sleep
  timer, Vision OCR, opened files. The readers' recordings are copied from
  `android/app/src/main/assets/voices` at build time.
- CI builds sherpa-onnx for iOS with its `build-ios.sh` (cached by `actions/cache`, key
  `sherpa-onnx-ios-v1.13.8-ort1.28.2`) and fetches `SherpaOnnx.swift`. GitHub's macOS runners are sometimes
  out of capacity ("job was not acquired"): just re-run.
- Waiting for the user's feedback on 1.0.6: garbling at paragraph ends with real readers (fixed by porting
  plainQuotes), the player and sleep timer, photo reading, web links, opening files from other apps.
- Not on iPhone yet (from Android): AI (Ask the book, summaries), saving audiobook files, Drive sync, Ask/
  translate, copied-voice recording, many settings. Do them one at a time, each tested on the iPad.

## Other

- Weekly check: scheduled task "Weekly app check" (Mondays 05:59 IST) – fixes with `[skip ci]`, never builds.
- Oracle Cloud server idea (voices on a server for low-end phones): the user's Pay-As-You-Go upgrade was
  pending; nothing built.
- A web version of the iPhone screens could be published to GitHub Pages if asked (no neural voices in a
  browser).
