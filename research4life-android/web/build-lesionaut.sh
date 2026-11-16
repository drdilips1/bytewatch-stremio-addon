#!/usr/bin/env bash
# Builds Lesionaut's web version into the folder given (default: web/_lesionaut): its own screens
# (app/src/main/assets/www/lx), its icon and manifest, and web.js, which stands in for the Android
# app's AI, photo and storage bridge in the browser.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/_lesionaut}"
rm -rf "$out"
mkdir -p "$out"
cp "$here"/../app/src/main/assets/www/lx/* "$out/"
cp "$here/web.js" "$out/"
cp "$here"/lesionaut/icon-*.png "$here/lesionaut/manifest.webmanifest" "$out/"
perl -0pi -e 's|  <title>Lesionaut</title>\n|  <title>Lesionaut</title>\n  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="apple-touch-icon" href="icon-180.png">\n  <link rel="icon" type="image/png" href="icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-title" content="Lesionaut">\n  <meta name="theme-color" content="#0B2233">\n|' "$out/index.html"
perl -0pi -e 's|  <script src="lx-core.js"></script>|  <script src="web.js"></script>\n  <script src="lx-core.js"></script>|' "$out/index.html"
grep -q 'src="web.js"' "$out/index.html" && grep -q 'manifest.webmanifest' "$out/index.html"
touch "$out/.nojekyll"
echo "Lesionaut web app built in $out"
