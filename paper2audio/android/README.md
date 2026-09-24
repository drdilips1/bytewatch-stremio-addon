# Paper to Audio for Android

An Android app that reads research papers and e-books aloud. It runs entirely on
the phone: no server, no account, no limits.

## Features

- **Library** of your papers and books with thumbnails (a PDF's first page or an
  EPUB's cover), title, author, length and listening progress. Tap to open,
  long-press to remove. A mini player at the bottom shows what's playing.
- **9 color themes**: System (follows light/dark mode), Ocean, Forest, Sunset,
  Lavender, Rose, Sepia, Midnight and Black. Tap the palette icon.
- Open a **PDF, EPUB or text file**, share one to the app from another app, or
  paste an **arXiv ID or link**.
- The same cleanup as the desktop tool: headers, footers, page numbers,
  citations, URLs, captions, equations and references are skipped; EPUB
  footnotes, contents and copyright pages are dropped.
- **Listen now** with play/pause, previous/next paragraph, a position slider and
  a chapter list. Reading continues with the screen off, with controls in the
  notification and on the lock screen.
- **Remembers where you stopped** in each document.
- **Save as audio file**: renders the whole document to one file in
  `Music/Paper2Audio` (MP3 for natural voices, M4A for phone voices), playable in
  any music or podcast app.
- Speed from 0.5× to 3×.

## Voices

- **◆ Kokoro voices (best, offline)**: an open-source AI voice model that runs
  on the phone itself. Very natural, no internet needed after a one-time
  download of about 300–350 MB (the app asks before downloading), and no
  limits. English only (American and British voices; *Heart* is the
  best-rated). Needs a 64-bit ARM phone (almost every phone from the last
  several years); fast on recent flagship phones, slower on budget ones.
- **★ Microsoft voices (default)**: Microsoft's neural voices, the same ones as
  Edge's "Read aloud" and the desktop tool. They sound close to a human
  narrator, cover 100+ languages (Indian English and Hindi included), and are
  free with no limits. They need an internet connection: each paragraph is
  fetched a moment before it is read.
- **Phone voices**: your phone's own text-to-speech engine. They work offline,
  but quality depends on the phone and is often robotic. Tap **Get more phone
  voices** to download better ones.

The voice list starts with the most natural Microsoft voices (★ Andrew, Ava,
Thomas, Emma, Brian), then other suggested voices, the ◆ Kokoro voices, all
remaining Microsoft voices, and finally phone voices. If you downloaded Kokoro
and don't use it, **Delete Kokoro voices** frees about 350 MB.

## Getting the APK

Every push that changes `paper2audio/android/` builds the app on GitHub Actions:

1. Open the repository on GitHub → **Actions** → **Paper2Audio Android APK**.
2. Open the latest successful run and download **Paper2Audio-apk** under
   *Artifacts* (you need to be signed in to GitHub).
3. Unzip it and open `Paper2Audio.apk` on your phone. Android will ask you to
   allow installing apps from your browser or file manager.

### Keeping updates installable (optional)

Without a signing key of your own, each build is signed with a throwaway debug
key, so you must uninstall the old app before installing a newer build (this
loses saved positions). To avoid that, create a key once and store it as
repository secrets:

```bash
keytool -genkeypair -keystore p2a.keystore -alias p2a -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 p2a.keystore   # copy the output
```

Then in GitHub → **Settings** → **Secrets and variables** → **Actions**, add
`P2A_KEYSTORE_B64` (the base64 text), `P2A_KEYSTORE_PASSWORD` and
`P2A_KEY_ALIAS` (`p2a`). Keep `p2a.keystore` safe and never commit it.

## Building locally

Open this folder in Android Studio, or run `./gradlew assembleRelease` with the
Android SDK installed. Requires JDK 17.

Kokoro needs the sherpa-onnx native libraries, which are not committed. Download
`sherpa-onnx-v1.13.8-android.tar.bz2` from the
[sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8)
and copy `jniLibs/arm64-v8a/*.so` into `app/src/main/jniLibs/arm64-v8a/`
(the GitHub workflow does this automatically). Without them the app still
builds and runs, just without Kokoro voices. The version must match the
vendored `app/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt`.

## Limitations

- Requires Android 8.0 or newer.
- Natural voices use an unofficial Microsoft service. If Microsoft changes it,
  they may stop working until the app is updated; phone voices keep working.
- Scanned PDFs (images only) and DRM-protected e-books can't be read.
- Complex multi-column PDFs can occasionally read out of order.
