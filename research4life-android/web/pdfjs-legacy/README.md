pdf.js 4.10.38 legacy build (pdfjs-dist/legacy/build), lowered to Safari 15 syntax with
`esbuild --target=safari15 --minify --legal-comments=inline --format=esm`. The web and iPhone
builds copy it to vendor/pdfjs/legacy/; reflow.js loads it only where the current pdf.js can't
run (iPadOS / iOS 15). Not in the Android app.
