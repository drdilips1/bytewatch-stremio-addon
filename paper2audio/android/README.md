# Paper to Audio for Android

An Android app that reads research papers and e-books aloud. It runs entirely on
the phone: no server, no account, no limits.

## Features

- Open a **PDF, EPUB or text file**, share one to the app from another app, or
  paste an **arXiv ID or link**.
- The same cleanup as the desktop tool: headers, footers, page numbers,
  citations, URLs, captions, equations and references are skipped; EPUB
  footnotes, contents and copyright pages are dropped.
- **Listen now** with play/pause, previous/next paragraph, a position slider and
  a chapter list. Reading continues with the screen off, with controls in the
  notification and on the lock screen.
- **Remembers where you stopped** in each document.
- **Save as audio file**: renders the whole document to an `.m4a` file in
  `Music/Paper2Audio`, playable in any music or podcast app.
- Speed from 0.5× to 3×, and any voice installed on your phone.

## Voices

The app uses your phone's text-to-speech engine, which is free and unlimited. For
the best voices, install or update **Speech Services by Google** from the Play
Store, then tap **Get more voices** in the app to download high-quality voices
for your languages. Voices marked *(online)* need internet; the others work
offline.

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

## Limitations

- Requires Android 8.0 or newer.
- Scanned PDFs (images only) and DRM-protected e-books can't be read.
- Complex multi-column PDFs can occasionally read out of order.
