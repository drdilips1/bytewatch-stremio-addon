# Paper to Audio for Android

An Android app that reads research papers and e-books aloud. It runs entirely on
the phone: no server, no account, no limits.

## Features

**Anything to audio**
- **Add** a PDF, EPUB, Word (.docx), **PowerPoint** (.pptx, read as a lecture:
  slides, bullets and speaker notes), Markdown, text or saved web page; **paste
  text**; or add an **arXiv ID, web article, YouTube video** (its captions) or
  file link. Share files, links, text, screenshots, audio and video to the app.
- **Scan** printed pages with the camera, or photos and screenshots; **scanned
  PDFs** are recognized page by page (mixed PDFs work too), all on the phone.
- **Transcribe audio and video** (lectures, podcasts, interviews, voice notes)
  into documents with speakers labeled (Gemini). **Dictate** text.

**Understands papers**
- Finds the **title, authors, sections, figure and table captions**; removes
  running headers and footers, page numbers, publisher banners, DOIs, emails,
  citations and references.
- **Smart chapters**: Introduction, Methods, Results, Discussion, Limitations,
  Conclusion. In Contents, **choose what to play**, e.g. *Skip Methods* or
  *Only Results and Discussion*; finished sections are ticked.
- **Paper-aware narration**: *View Figure 3* appears while the paragraph that
  mentions it is read, showing the page (zoomable) with its caption. AI can
  explain every figure and table (tables summarized, not read cell by cell),
  read where the text mentions them.
- **Says it properly**: "HR 0.72, 95% CI 0.54–0.96, p=0.03" is read as "the
  hazard ratio was 0.72, 95 percent confidence interval from 0.54 to 0.96, a
  p-value of 0.03"; units, ranges, symbols, Greek letters, Fig./Eq./e.g. and
  ALL-CAPS headings too. **Medical mode** reads doses, routes and trial terms in
  full (BID, PO, q8h, ITT, RCT, AE…).

**Listening**
- One **continuous stream**: every sentence trimmed and joined with natural
  pauses, so it sounds like one audiobook; voice changes continue from the
  sentence you were on.
- **⏮/⏭ step one sentence** (hold for a paragraph); position remembered to the
  sentence. **Speaking styles**: Standard, Academic, Conversational,
  Storytelling, Lecture. Speed 0.5× to 4×, sleep timer, reader view with the
  sentence highlighted, bookmarks and notes, lock-screen controls.
- **Download** a document's audio for offline listening (10 requests at a
  time), then **save it as an audio file** almost instantly, or as an
  **audiobook** (one file per chapter with cover, author and track numbers).

**Voices** (Voice studio)
- ★ Microsoft natural voices online; ♥ natural **on-device voices** (Luna,
  Bria, Carter, Declan, Elliot, Felix, Grant, Hugo, Ian, James) offline;
  **clone a voice** from 15–20 seconds of recording (with permission);
  ◆ **Supertonic** (31 languages, including Hindi) and Kokoro offline.
- **Voice design** (describe a voice) and pitch; **language-aware** voice
  suggestions.
- **Full cast**: a voice per character in stories (from "said Maya" and "he
  asked"), and per speaker in podcasts and transcripts. Choose several voices
  for male characters and several for female characters (Voice studio).
- **One voice list** (player › Voice): grouped by kind, searchable, with a
  preview button; downloaded Kokoro and Supertonic voices are listed in Voice
  studio with *Use* buttons.
- Cloning removes background noise from the recording first (a 0.5 MB
  on-device model), which is what made cloned voices mumble.

**Screens**: a bottom bar with Home (continue listening, recent books, quick
ways in), Library, Ask AI, Discover and Settings (sections that open and close:
account, appearance/themes, playback, voices, AI, updates).

**Listening anywhere**: lock-screen, headphone, car-stereo and watch controls
(media session); calls and navigation prompts pause the book; unplugging
headphones pauses. **Car mode**: huge buttons, the screen stays on, tap anywhere
and say "pause", "go back", "next chapter", "faster", or ask a question.
Books skip their front and back matter (contents, copyright, preface, index…)
and start at the introduction. **Family listening** style: slower and clearer.

**AI** (Settings › AI; free Groq key, or free Gemini). Three levels: 🟢 Pure
audiobook (no AI), 🔵 AI-assisted, 🟣 AI immersion (a recap and a question at
the end of every chapter).
- **Ask AI** by voice or text about what you're hearing: the answer is shown and
  read aloud (pause it any time), then the book carries on.
- **One book, several versions**: ⚡ Essential (~90 min), 🧠 Deep understanding
  (~3 h), 📝 Chapter summaries, 🎓 Teach me, 🧐 Challenge me; each becomes its own
  audiobook in the library.
- **Ask your library**: "What have I learned about consciousness?", "Which books
  disagree?" (the AI keeps a short digest of each document).
- **Discover**: learns your reading taste (editable) and recommends what to read
  next, with one tap to find it.
- **Cinematic full cast**: AI identifies the characters and their genders; each
  keeps their voice for the whole book and the author's other books.
- **5-minute briefing** before listening: what it's about, the question, how,
  main findings, limitations, implications; then *Listen to full text*.
- **Explain as you listen**: Explain the sentence being read, like I'm 10, at
  medical-professor level, give an example, why it matters, what terms mean.
- **Ask this document**: a chat whose answers cite **[Section ¶N]**; tap a
  citation to jump there. Voice questions; history kept.
- **Study mode**: 10 key points, flashcards (export to Anki), **Test me** quiz
  with score, viva and short-answer questions, revision summary, mind map,
  glossary.
- **Podcast mode**: a host and an expert discuss the document in two voices.
- Summaries (document or chapter) and **translate and listen** in 26 languages.

**Library**
- Thumbnails, progress, search, sort and **collections**; **Find** books on
  **Bookracy** (including recent ones), free classics (Project Gutenberg) and
  arXiv papers; book details from Open Library, arXiv or Hardcover; 9 color
  themes.
- **Account and sync**: sign in with email and password (the same account as
  Inkwell) to sync the library, listening positions, bookmarks, collections and
  voice settings; documents added from a link, Find or Bookracy download again
  on your other devices. Optional Google Drive backup copies your own files too.
- **Updates inside the app**: checked every time the app opens; a banner on the
  library says when a new version is ready (also ⋮ › Check for updates).

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
