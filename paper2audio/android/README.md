# Paper to Audio for Android

An Android app that reads research papers and e-books aloud. It runs entirely on
the phone: no server, no account, no limits.

## Features

- **Library** of your papers and books with thumbnails (a PDF's first page or an
  EPUB's cover), title, author, length and listening progress. Search the
  library, sort it, and group documents into **collections** (long-press a
  document). A mini player at the bottom shows what's playing.
- **Find** (magnifier icon): search 70,000+ free public-domain e-books from
  Project Gutenberg (popular titles shown first) and research papers on arXiv,
  and add them to the library in one tap.
- **Book details** (ⓘ in the player): looks up the cover, author, year and
  description on Open Library, arXiv (for papers) or, with your own API key from
  hardcover.app/account/api, Hardcover. You confirm before anything changes.
- **9 color themes**: System (follows light/dark mode), Ocean, Forest, Sunset,
  Lavender, Rose, Sepia, Midnight and Black. Tap the palette icon.
- **Add** a PDF, EPUB, Word (.docx), Markdown, text or saved web page, **paste
  text**, or add an **arXiv ID, web article link** or file link. Web articles
  are reduced to the article text (no menus, ads or reference lists). You can
  also share files, links, text and screenshots to the app.
- **Scan**: photograph printed pages with the camera (several pages in a row),
  or pick photos and screenshots; the text is recognized on the phone with
  Google ML Kit. **Scanned PDFs** are recognized automatically when added.
- The same cleanup as the desktop tool: headers, footers, page numbers,
  citations, URLs, captions, equations and references are skipped; EPUB
  footnotes, contents and copyright pages are dropped.
- **Reader view** that follows along, highlighting the sentence being read.
  Tap a paragraph to listen from there; long-press it to **bookmark** it, add a
  **note** or copy it. Bookmarks and notes sync.
- **Listen now** with play/pause, previous/next paragraph, a position slider,
  time left, a **table of contents** and a **sleep timer** (minutes or end of
  chapter). Reading continues with the screen off, with controls in the
  notification and on the lock screen.
- **Voice studio** (voice icon in the library and player):
  - **Natural on-device voices** that work offline and unlimited: Luna and Bria
    (female) and Carter, Declan, Elliot, Felix, Grant, Hugo, Ian, James and Kit
    (male; James and Kit British), after a one-time 98 MB download.
  - **Clone a voice**: record 15–20 seconds (a reading script is shown) or import
    a recording, and the app reads in that voice, on the phone. Only with the
    speaker's permission.
  - **Supertonic voices**: 10 on-device voices that read 31 languages,
    including Hindi (one-time 129 MB download). Kokoro is still available.
  - **Voice design**: describe a voice ("a calm, deep British man") and the app
    picks and tunes the closest one; pitch control for online voices.
  - **Stories**: a second voice reads everything in quotation marks, like an
    audiobook with two narrators.
- **Language aware**: the app detects each document's language on the phone
  and offers a voice that speaks it.
- **Transcribe audio and video** (Add › Audio or video → text, or share a
  recording to the app): lectures, podcasts, interviews and voice notes become
  documents, with speakers labeled (Gemini). **Dictate** text with voice typing.
- **Translate and listen** (Options › AI): the whole document in Hindi, Spanish
  and 24 other languages, read by a voice that speaks the language.
- **Audiobook export**: save each chapter as its own file in a folder, with
  title, author, track number and cover (MP3), ready for audiobook apps.
- **AI, free with Google Gemini** (Options tab; needs a free key from
  aistudio.google.com/apikey, no card): short and long summaries of a document
  or chapter (listen to them or add them to the library), spoken explanations of
  a PDF's **figures, tables and equations** read where the text first mentions
  them, and **Explain with AI** for any paragraph (long-press it). The free tier
  has a daily limit and never charges; Google may use what's sent to improve its
  products.
- **Offline listening**: download the whole document's audio in advance;
  previews for every voice.
- **Remembers where you stopped** in each document.
- **Save as audio file**: renders the whole document to one file in
  `Music/Paper2Audio` (MP3 for natural voices, M4A for phone voices), playable in
  any music or podcast app.
- Speed from 0.5× to 4×.

## Sync across devices (Google Drive)

Tap the cloud icon in the library and sign in with Google. Your documents,
thumbnails, listening positions and deletions sync through the hidden
app-data folder of your own Google Drive (it uses your Drive storage; the app
can't see anything else in your Drive). Sync runs when you open the app, add or
remove a document, and leave the player; the newest listening position wins.

### One-time setup

Google only allows sign-in from an app it knows, identified by its package
name and signing key. Do this once:

1. **Signing key**: add the repository secrets `P2A_KEYSTORE_B64`,
   `P2A_KEYSTORE_PASSWORD` and `P2A_KEY_ALIAS` (see *Keeping updates
   installable* below), then let GitHub Actions build a new APK. The build log's
   "Show signing certificate" step prints the key's SHA-1.
2. In [Google Cloud Console](https://console.cloud.google.com/), create a project
   (any name).
3. **APIs & Services → Library**: enable the **Google Drive API**.
4. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Paper to Audio", your email as support
     and developer contact.
   - Data access / scopes: add `https://www.googleapis.com/auth/drive.appdata`.
   - Audience: either add your Google account under **Test users**, or
     **Publish app** (this scope doesn't need Google's verification).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type **Android**, package name `com.paper2audio.app`, and the SHA-1 from
   step 1.
6. Install the new APK (uninstall the old one first this last time), then tap
   the cloud icon and sign in. Repeat on your other devices with the same APK.

If sign-in says it "isn't set up for this build", the SHA-1 or package name in
the OAuth client doesn't match the installed APK.

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

**Latest build (direct download):**
https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/paper2audio-apk/Paper2Audio.apk

Every build also stays available as a workflow artifact:

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

## Credits

Voice engines run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
(Apache-2.0): Pocket TTS by Kyutai (CC-BY-4.0), Supertonic by Supertone (MIT)
and Kokoro (Apache-2.0). The Luna and Bria voices are cloned from Kyutai's
sample recordings (MIT/Apache-2.0); the male voices from clips made with the
Supertonic and Kokoro voices. Features inspired by VoiceStudio (no code from
it is used).

## Limitations

- Requires Android 8.0 or newer.
- Natural voices use an unofficial Microsoft service. If Microsoft changes it,
  they may stop working until the app is updated; phone voices keep working.
- DRM-protected e-books can't be read. Text recognition supports Latin-script
  languages (English, Spanish, French, German and so on).
- Complex multi-column PDFs can occasionally read out of order.
