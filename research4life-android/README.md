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
- **MyLoft**: MyLoft's website sends phones to its app and needs a browser extension on desktop, so the main route is the MyLoft app: "MyLoft" on a paper copies the title, remembers the paper and opens the MyLoft app; share the PDF from there (**Share / Open with → DermScholar**) and it saves to that paper. The in-app MyLoft browser is still available (with desktop, full-desktop and mobile modes in its ⋮ menu) but may not get past sign-in.
- **Multiple Research4Life accounts**: save several, pick the active one; Get PDF retries with the next account if one fails.
- **Listen** (read aloud): the phone's text-to-speech reads papers and UpToDate topics paragraph by paragraph with highlighting, speed 0.75–2×, voice and speech-engine choice with preview, "Abstract & conclusions" mode, and background playback with notification controls.
- **AI summaries** (Claude): the ✦ button in the reader, or "AI summary" on a paper, gives a structured summary (bottom line, design, key findings with numbers, clinical relevance, limitations) and answers questions about the paper. It uses your own Anthropic API key (Settings → AI & listening), stored encrypted; only the paper's text is sent. Summaries are kept on the phone.
- **MyLoft troubleshooting**: the ⋮ menu in the MyLoft browser can switch desktop/mobile mode, reset MyLoft's data, and copy diagnostics (page errors and blocked app links) to send to the developer.
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
