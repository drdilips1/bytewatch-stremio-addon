# DermScholar (Android)

A dermatology research app with a Consensus-style search, built around
[Research4Life](https://portal.research4life.org/signin) access.

## Features

- **Evidence search** over Europe PMC (PubMed, PMC and more). Ask plain-language questions.
  - Each result shows its **key finding**, taken from the abstract's own conclusion.
  - **Study-type badges** (meta-analysis, RCT, observational…), plus "Leading journal", "Highly cited" and "Open access".
  - An **evidence snapshot** breaks down study types, median year, open-access share and top journal.
  - Filters: dermatology focus, study type, date range, open access, and sort (relevance, newest, most cited).
- **Paper view**: structured abstract, cited-by and reference lists, topic chips, and citations in Vancouver, APA and BibTeX.
- **Offline library**, stored on the phone:
  - Save papers with notes, a reading status and collections.
  - Save **PDFs** into app storage and read them in the built-in reader. It supports zoom and remembers your page.
  - Save the **full text** of open-access papers for offline reading.
  - Import PDFs you already have.
  - Export the library as RIS (Zotero, Mendeley, EndNote), BibTeX, CSV or a Vancouver reference list.
- **Journals**: 50+ curated dermatology journals in five groups (leading clinical, research, open access, India and regional, subspecialty).
  - Each journal has tabs for **Issues** (current issue, plus every issue by year back to 8 years), **Latest**, **In press**, **Most cited** and **Reviews**, plus search inside the journal.
  - Each issue opens a table of contents grouped into sections (reviews and meta-analyses, trials, original research, case reports, letters).
  - Share buttons on journals, issues (the table of contents with DOI links) and every article card.
  - Follow journals for a "new in your journals" feed; journal pages also show h-index and citation metrics (OpenAlex).
- **Get PDF (one tap)** on every result and paper. It runs in the background; the website never appears:
  1. A free copy is downloaded directly when one exists.
  2. Otherwise a hidden browser opens the paper through the Research4Life access proxy (`login.research4life.org/tacsgr1doi_org/<DOI>`).
  3. It signs in with your saved account when asked, follows the publisher's PDF link and saves the file.
  A small tray shows each step and ends with **Open**. If a publisher needs a human tap, the tray offers **Show page**.
- **Mobile reader** for every PDF (pdf.js, bundled for offline use):
  - Two-column journal pages reflow into one readable column, with headings, paragraphs and references.
  - Figures and tables are cropped from the pages and placed in the text; tap one for a full-screen, pinch-zoom viewer that swipes through all of them.
  - A side panel lists the contents, figures and tables.
  - Reading settings: text size, serif/sans, light/sepia/dark theme, line spacing. Reading position is remembered.
  - Original page layout is one tap away; scanned PDFs open in page view automatically.
  - Open-access full text (Europe PMC) uses the same reader, with its figures and HTML tables.
- **UpToDate inside the app**: save your UpToDate login once.
  - Search has a **Papers | UpToDate** switch. UpToDate results (topics, patient education, drug information) are listed in the app.
  - Topics open in the app's reader, with contents, tables and graphics in the side panel and your reading theme.
  - Links to other topics stay in the app. Topics can be saved to the library for offline reading.
  - A hidden WebView with your session loads UpToDate in the background (`UtdClient`) and signs in automatically when asked.
  - If UpToDate needs you to sign in by hand, the app offers it and continues afterwards.
- **Multiple Research4Life accounts**: save several, pick the active one; Get PDF retries with the next account if one fails.
- **Listen to anything** (Import → Understand → Listen → Ask → Learn → Review):
  - **Add document**: PDF, EPUB, Word (.docx), text, Markdown, a web link, pasted text, or a **photo of a page**. In any app, **Share → DermScholar** sends a page, link, text or file straight in ("Read anything").
  - Everything is parsed into one reading model (`docs.js`): title, author, chapters/sections, paragraphs, lists, tables, figures and captions. Web pages lose their ads and menus; scanned PDFs and photos go through **on-device text recognition** (ML Kit) with running headers, footers and page numbers removed, two-column pages put back in order, and hyphenated words rejoined. The original file is kept.
  - **Smart narration** (`speech.js`): statistics ("p less than 0.001", "95 percent confidence interval"), units ("milligrams per kilogram per day"), symbols, abbreviations and clinical shorthand are read the way a person would say them. Citation numbers are dropped.
  - **Skip controls**: references, appendix, acknowledgements/funding/disclosures, figure captions and citation numbers, each on or off.
  - **Natural voices on the phone** (sherpa-onnx): download **Kokoro studio voices** (11 US/UK voices, 103 MB) or **Piper** voices (≈20–35 MB each, including Hindi) once in Listening settings; they then run offline and free. Speech is generated a sentence ahead and streamed without gaps, every clip is cached (replays and offline listening cost nothing), and speed changes instantly without regenerating. The AI Discussion pairs two contrasting natural voices automatically.
  - **Audiobook player**: cover, section, elapsed/remaining time, seek bar, 15 s back / 30 s forward, previous/next section, speed 0.5–4×, sleep timer (minutes or end of section), bookmarks with context (and AI-suggested titles), section list, AI **Explain** and **Ask** while listening. Resumes exactly where you stopped. Plays in the background with lock-screen, notification and Bluetooth/headset controls (Android media session).
  - Home shows **Continue listening**, **Recently added** and a prominent **Add document** button. The library filters by type (papers, books, articles, study material, documents) and shows duration and listening progress.
- **AI studio** (Groq by default, or Claude — your own API key): for any document —
  - **Quick Brief** (1–3 min), **5-minute summary** and **Key takeaways**, each playable as audio.
  - **Ask this document**: answers grounded in the text with tappable **¶ citations** that jump to the passage.
  - **Tap-to-explain**: long-press a paragraph or select a sentence → simple / detailed / expert explanation, example, define terms, summarise or translate (17 languages, read aloud with a matching voice). Also highlight, note, copy, share, listen from here.
  - **Study mode**: flashcards (Anki export), a "Test me" quiz with explanations and sources, viva and short-answer questions (with spoken practice), glossary and revision notes.
  - **Paper → Podcast**: a NotebookLM-style host/expert episode built for papers (the question, how they studied it, what they found, the catch, what it means in practice), Quick / Standard / Deep-dive lengths, two natural voices, segments as chapters, always labelled as AI-generated. **Interrupt any time** with Ask (typed or spoken: "explain that hazard ratio"): the hosts answer from the paper, then the episode carries on from the same line. Ask works the same while listening to the paper itself.
  - AI section titles for poorly formatted documents, and AI clean-up of text-recognition errors.
  - **Groq** (fast, free tier): GPT-OSS 120B by default, GPT-OSS 20B or Qwen, or any chat model your key can use (listed live). Structured answers (study sets, discussions) use Groq's strict JSON mode. On the free tier (≈8K tokens/minute) documents that don't fit are sent as the most relevant excerpts — abstract and conclusions for summaries, matching paragraphs for questions — and the app learns your account's limit; answers note when they're based on excerpts.
  - **Claude** (Opus 5 / Sonnet 5 / Haiku 4.5) remains available as a second provider. Explanation level and a monthly usage/cost estimate in Settings; every answer is saved on the phone.
- **My notes**: highlights, notes and saved AI explanations from every document in one place, with an AI summary of all your notes and Markdown export.
- **Search your library**: titles, authors, the full text of every document on the phone, notes and AI summaries, with passages that open at the right paragraph.
- **Privacy**: documents, notes and positions stay in app-private storage; nothing leaves the phone unless you use an AI feature, and then only that document's text goes to Anthropic over HTTPS. The API key and logins are encrypted with the Android Keystore.
- **Architecture**: prompts live in the web app; the native side talks to an `LlmProvider` (`GroqProvider`, `ClaudeProvider`), `Narrator` (Android TTS), `Ocr` (ML Kit) and `DocInbox` (imports), so providers can be swapped.
- **Themes**: light/dark/system mode, 8 accent colours, 5 light and 4 dark backgrounds; bundled Inter, Literata and Fraunces fonts.
  The reader has 8 reading themes plus custom text and background colours, 4 fonts, and line-spacing and margin options.
- **Bottom bar**: Research4Life and UpToDate tabs can be shown or hidden in Settings (hidden by default).
- **Research4Life session**: one browser session is kept alive while the app runs, so going back and forth doesn't log you out.
  Your R4L user ID and password can be saved once (Settings, or the first time you tap Get PDF). They're encrypted with an Android Keystore key and never leave the phone.

## Getting the APK

Every push that changes this folder runs **Build DermScholar APK**, which publishes
`DermScholar.apk` on the repository's Releases page. Builds are signed with the key in
`app/dermscholar.keystore`, so new versions install over old ones and keep the library.

## Layout

- `app/src/main/assets/www/` — the app UI (HTML/CSS/JS), served locally via `WebViewAssetLoader`
- `MainActivity` — hosts the UI, exposes `window.Native` (PDF store, sharing, export)
- `ApiProxy` — same-origin proxy to Europe PMC and OpenAlex
- `R4LSession` — shared R4L WebView, encrypted credentials, sign-in and PDF-finder scripts
- `PdfFetcher` — background Get PDF: DOI → R4L sign-in → publisher PDF → library, one paper at a time
- `UtdClient` — background UpToDate search and topic reader (hidden WebView, shared cookies)
- `PortalActivity` — visible Research4Life / UpToDate browser (R4L tab, or Show page when a fetch needs help)
- `assets/www/reflow.js` — PDF → mobile reading layout (columns, headings, figure and table crops)
- `assets/www/vendor/pdfjs/` — Mozilla pdf.js 4.10.38 (Apache-2.0)
- `PdfViewerActivity` — offline PDF reader
- `tools/check-journals.mjs` — verifies each curated journal query returns articles
