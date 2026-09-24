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
- **Get PDF (one tap)** on every result and paper:
  1. A free copy is downloaded directly when one exists.
  2. Otherwise the paper opens through the Research4Life access proxy (`login.research4life.org/tacsgr1doi_org/<DOI>`).
  3. If R4L asks, the app signs in with your saved account, then finds the publisher's PDF link, saves the PDF to the library and opens the reader.
  The page stays visible, so you can step in if a publisher needs a click.
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
- `PortalActivity` — Research4Life browser; in fetch mode, automates DOI → sign-in → PDF → library
- `PdfViewerActivity` — offline PDF reader
- `tools/check-journals.mjs` — verifies each curated journal query returns articles
