# PDF Editor (Android, offline)

A self-use PDF editor APK. Everything runs on the phone: no internet permission,
no accounts, no watermarks, no page/file limits.

**Install:** grab `dist/PdfEditor.apk` (or the `pdf-editor-latest` release / the
`PdfEditor-apk` artifact from the *PDF Editor APK* GitHub Action), open it on the
phone and allow "Install unknown apps" when prompted. Android 8.0+.

## Features

| | |
|---|---|
| **Add Text** | Tap anywhere to type. Font (sans/serif/mono), size, bold, italic, colour, white background. |
| **Edit Text** | Existing text is outlined; tap a line to rewrite it. The old text is covered and the new text is written in a matching font and size. |
| **Draw / Highlight** | Freehand pen and a translucent highlighter (straightens itself over a line of text). |
| **Whiteout** | Drag a box to erase anything (any colour). |
| **Shapes** | Box, circle, line, arrow; outline or filled. |
| **Tick / Cross / Date** | One-tap stamps for filling in forms. |
| **Image** | Insert photos/logos, move and resize them. |
| **Sign** | Draw a signature; the last few are remembered for reuse. |
| **Forms** | Fill real PDF form fields (text, checkboxes, dropdowns, radios), optionally flatten. |
| **Pages** | Rotate, reorder, duplicate, delete, insert blank pages, extract selected pages to a new PDF. |
| **Merge** | Append other PDFs; turn images into PDF pages. |
| **Convert** | PDF → JPG, PNG (ZIP for several pages), Word (.docx) and Text; images → PDF. Text hidden under whiteout/edits is left out. |
| **Compress** | Recommended / Strong shrink photos and scans but keep text selectable; Extreme turns pages into compact images. |
| **Protect / Unlock** | AES-256 password, optionally blocking editing & copying. Save any PDF without its password or restrictions. |
| **Read** | Full-screen reading mode with night mode and "go to page". |
| **Print** | Straight to Android's print dialog (printers or "Save as PDF"). |
| **Undo / Redo**, zoom, Save As, Share, "Open with" / "Share to" from any app. |

Protected PDFs: password-protected files ask for the password; files with
editing/printing restrictions open normally. Both are saved decrypted with
their text intact (a page is only saved as an image if its encryption type
can't be read).

While typing, tap **Done**, tap anywhere outside the text box, or press Back to finish.

Everything you add is selectable in **Select** mode: drag to move, pull the
round handle to resize, and use the bar above the tools to change colour/size,
duplicate or delete.

## How it's built

- `app/src/main/assets/www/` – the editor UI (HTML/JS). Uses bundled
  [pdf.js](https://mozilla.github.io/pdf.js/) for rendering and
  [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (a pdf-lib fork that
  adds encryption/decryption) for writing PDFs.
- `MainActivity.java` – a WebView host that serves the assets locally, blocks
  all network requests, and bridges open/save/share to Android.

### Build

With the Android SDK: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
(signed with the debug key unless `SIGNING_KEYSTORE_FILE` etc. are set).

Without the Android SDK (Debian/Ubuntu packages):

```sh
sudo apt install aapt apksigner zipalign dalvik-exchange openjdk-17-jdk
ANDROID_JAR=/path/to/android-34/android.jar ./build-local.sh   # -> build/local/PdfEditor.apk
```

The GitHub Action builds on every push that touches this folder. To keep one
signature across builds (so updates install over the previous version) add
repository secrets `SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`,
`SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD`.

To try the editor in a desktop browser: `cd app/src/main/assets/www && python3 -m http.server`
and open http://localhost:8000.
