#!/usr/bin/env bash
# Downloads the sherpa-onnx Android library (on-device neural text-to-speech) into app/libs.
# It is ~50 MB, so it isn't kept in git; the build workflow runs this before Gradle.
set -euo pipefail
VERSION=1.13.8
DEST="$(dirname "$0")/../app/libs/sherpa-onnx-$VERSION.aar"
mkdir -p "$(dirname "$DEST")"
if [ ! -s "$DEST" ]; then
  curl -fL --retry 4 -o "$DEST" "https://huggingface.co/csukuangfj2/sherpa-onnx-libs/resolve/main/android/aar/sherpa-onnx-$VERSION.aar"
fi
ls -l "$DEST"
