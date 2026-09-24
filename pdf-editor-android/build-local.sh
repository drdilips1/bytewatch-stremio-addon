#!/usr/bin/env bash
# Builds the APK without Gradle/Android SDK downloads, using Debian/Ubuntu packages:
#   sudo apt install aapt apksigner zipalign dalvik-exchange openjdk-17-jdk
# Needs an android.jar (API 34):  ANDROID_JAR=/path/to/android.jar ./build-local.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_JAR:?set ANDROID_JAR to an API 34 android.jar}"
PKG=com.selfuse.pdfeditor
OUT=build/local
KEYSTORE=${KEYSTORE:-$HOME/.android/pdfeditor-debug.keystore}
rm -rf "$OUT" && mkdir -p "$OUT"/{gen,classes,dex}

# Manifest placeholders (Gradle normally fills these in).
sed -e "s/\${applicationId}/$PKG/g" \
    -e "s#<manifest #<manifest package=\"$PKG\" #" \
    app/src/main/AndroidManifest.xml > "$OUT/AndroidManifest.xml"

aapt2 compile --dir app/src/main/res -o "$OUT/res.zip"
aapt2 link -I "$ANDROID_JAR" --manifest "$OUT/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 34 --version-code 6 --version-name 1.5 \
  -A app/src/main/assets --java "$OUT/gen" -o "$OUT/unsigned.apk" "$OUT/res.zip"

javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find app/src/main/java "$OUT/gen" -name '*.java') 2>&1 | grep -v 'warning: \[options\]' || true
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/dex/classes.dex" "$OUT/classes"
(cd "$OUT/dex" && zip -q ../unsigned.apk classes.dex)

zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=PDF Editor Self Use" >/dev/null
fi
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/PdfEditor.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/PdfEditor.apk"
echo "Built $OUT/PdfEditor.apk"
