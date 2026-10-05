#!/usr/bin/env bash
# Builds the web version (iPhone: Safari → Share → Add to Home Screen) into the folder given
# (default: web/_site): the Android app's screens plus web.js, which stands in for the Java side.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/_site}"
rm -rf "$out"
mkdir -p "$out"
cp -R "$here/../app/src/main/assets/www/." "$out/"
cp "$here/web.js" "$here/manifest.webmanifest" "$here"/icon-*.png "$out/"
head='  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="apple-touch-icon" href="icon-180.png">\n  <link rel="icon" type="image/png" href="icon-192.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-title" content="DermScholar">\n  <meta name="apple-mobile-web-app-status-bar-style" content="default">\n  <meta name="theme-color" content="#7C3AED">'
sed -i "s|  <title>DermScholar</title>|  <title>DermScholar</title>\n$head|" "$out/index.html"
sed -i 's#  <script src="journals.js"></script>#  <script src="web.js"></script>\n  <script src="journals.js"></script>#' "$out/index.html"
grep -q 'src="web.js"' "$out/index.html" && grep -q 'manifest.webmanifest' "$out/index.html"
touch "$out/.nojekyll"
echo "Web app built in $out"
