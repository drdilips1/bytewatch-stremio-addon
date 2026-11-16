#!/usr/bin/env bash
# Builds Lesionaut's web version into the folder given (default: web/_lesionaut): DermScholar's web
# build, opened on lesionaut.html (as index.html) with Lesionaut's own name, icon and manifest.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/_lesionaut}"
bash "$here/build.sh" "$out" >/dev/null
cp "$here"/lesionaut/icon-*.png "$here/lesionaut/manifest.webmanifest" "$out/"
mv "$out/lesionaut.html" "$out/index.html"
rm -f "$out/files.json" "$out/ota.json"
perl -0pi -e 's|  <title>Lesionaut</title>\n|  <title>Lesionaut</title>\n  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="apple-touch-icon" href="icon-180.png">\n  <link rel="icon" type="image/png" href="icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-title" content="Lesionaut">\n  <meta name="theme-color" content="#0B2233">\n|' "$out/index.html"
perl -0pi -e 's|  <script src="journals.js"></script>|  <script src="web.js"></script>\n  <script src="journals.js"></script>|' "$out/index.html"
grep -q 'src="web.js"' "$out/index.html" && grep -q 'manifest.webmanifest' "$out/index.html"
echo "Lesionaut web app built in $out"
