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
  - Follow journals to get a "new in your journals" feed.
  - Each journal page shows h-index and citation metrics (OpenAlex), plus latest, most-cited and review tabs, and search inside the journal.
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
- `PortalActivity` — visible Research4Life browser (R4L tab, or Show page when a fetch needs help)
- `assets/www/reflow.js` — PDF → mobile reading layout (columns, headings, figure and table crops)
- `assets/www/vendor/pdfjs/` — Mozilla pdf.js 4.10.38 (Apache-2.0)
- `PdfViewerActivity` — offline PDF reader
- `tools/check-journals.mjs` — verifies each curated journal query returns articles
