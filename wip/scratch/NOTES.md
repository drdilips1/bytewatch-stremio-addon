# Paper to Audio / Narrato: working notes

## Standing rules (from the owner)
- Build only on "Build now" (Paper to Audio: bump the full version, push without a narrato marker) or
  "Build now Narrato" (bump the lite version, push with `[narrato-only]`).
- Don't remove things that work; add features. Say plainly before changing working behaviour.
- No model names in commits. No PR unless asked. Never commit the keystore or secrets.
- Work branch: `claude/paper2audio-unlimited-u69i8w`. This backup branch, `backup/paper2audio-wip`, is
  pushed with `[skip ci]` on top after every commit, so a container reset loses nothing.

## Restoring after a reset
    git fetch origin claude/paper2audio-unlimited-u69i8w backup/paper2audio-wip
    git checkout -B claude/paper2audio-unlimited-u69i8w origin/claude/paper2audio-unlimited-u69i8w
    git merge --ff-only origin/backup/paper2audio-wip~1   # commits not yet pushed to the work branch
    git show origin/backup/paper2audio-wip:wip/post-commit-hook.sh > .git/hooks/post-commit; chmod +x .git/hooks/post-commit
    # scripts and design files: git checkout origin/backup/paper2audio-wip -- wip/  (then move them out, don't commit wip/)
- Voice test tools: python3 -m pip install sherpa-onnx soundfile numpy; models from k2-fsa/sherpa-onnx releases:
  tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2 -> /tmp/claude-0/enpack,
  asr-models/sherpa-onnx-whisper-base.en.tar.bz2 -> /tmp/claude-0/asr. Test: wip/scratch/voicetest.py.

## Compiling locally (before every push)
- dl.google.com is allowed in the environment's network settings (the owner added it).
- SDK: download commandlinetools-linux-11076708_latest.zip from dl.google.com/android/repository to
  /tmp/claude-0/android-sdk/cmdline-tools/latest, accept licences, sdkmanager "platforms;android-36"
  "build-tools;36.0.0" "platform-tools"; paper2audio/android/local.properties: sdk.dir=/tmp/claude-0/android-sdk
- Maven Central answers 404 at random through the proxy: ~/.gradle/init.d/central-mirror.gradle points
  repo.maven.apache.org at https://maven-central.storage-download.googleapis.com/maven2/ (copy in wip/).
- ANDROID_HOME=/tmp/claude-0/android-sdk ./gradlew -q --no-daemon compileLiteDebugKotlin compileFullDebugKotlin

## State (2026-10-24)
- Narrato 1.9.8 built and sent (lead-in still off for 4 voices there). Paper to Audio last built 6.9.5.
- Waiting for "Build now": lead-in on for all Narrato voices; "Mr." without its dot for online voices;
  unknown full-cast speakers read by the narrator; "Shhh" -> "Shush".
- New voices uploaded to voices-incoming/ as N1-N5 Male/Female; N1 Female and N3 Female are the same file.
  Being tested with voicetest.py; the owner chooses which to add. Keep the older voices too.
- Design: light themes canvas https://claude.ai/artifact/Aughdag7BjAiF6uGJtgkJW (Paper & Ink from
  Audiohub's work branch, Paper & Teal, Linen, Sage, Sky; light Now-listening tile like Paper to Audio's
  hero; logo + "Good evening, <name>"; a welcome step asking the name). Waiting for the owner's pick,
  then build it into Narrato.
- Ideas offered, not yet requested: 15-second skip, favourite voices, listening stats.
- Later (owner said "will do later"): in Paper to Audio, after copying a voice, read one line with 3-4 seeds
  and let the owner pick; "Try another take" on a copied voice; seed saved with the voice and in the share
  file name. Cause: each copy gets a random seed (from its id), and some seeds sound off.
- Old 8 Narrato voices are gone from the owner's Paper to Audio: they keep their tested seeds.
