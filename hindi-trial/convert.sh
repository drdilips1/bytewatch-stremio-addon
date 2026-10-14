#!/usr/bin/env bash
# Converts Jugnu Lite to the sherpa-onnx Pocket TTS layout the apps use, then checks it
# by making Hindi samples with sherpa-onnx itself (the same engine as on the phone).
# Each stage logs what it finds; a failing stage doesn't hide what the others show.
set -u
W=$PWD
mkdir -p out

echo "===== Jugnu Lite config"
python - <<'PY'
from jugnu_tts import api as J
cfg = J._assemble(J.MODELS["lite"])
print("config:", cfg)
open("jugnu_config_path", "w").write(str(cfg))
PY
export JUGNU_CONFIG=$(cat jugnu_config_path)
TOK=$(grep tokenizer_path "$JUGNU_CONFIG" | awk '{print $2}')
echo "JUGNU_CONFIG=$JUGNU_CONFIG tokenizer=$TOK"

echo "===== The English pack the apps use now (for its I/O layout, and its sound codec)"
curl -fsSL -o en.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
tar xjf en.tar.bz2 && rm en.tar.bz2
EN=$(ls -d sherpa-onnx-pocket-tts-int8-2026-01-26)
ls -la "$EN"
pip install -q onnx onnxruntime
python "$W/hindi-trial/io.py" "$EN"

echo "===== Exporter (lookbe fork of KevinAHM/pocket-tts-onnx-export)"
git clone https://github.com/lookbe/pocket-tts-onnx-export exporter
echo "exporter commit: $(git -C exporter rev-parse HEAD)"
git -C exporter log --oneline | head -15
find exporter -type f -not -path "*/.git/*" | head -60
echo "----- README"; head -150 exporter/README.md
echo "----- export.py"; cat exporter/export.py | head -300
[ -f exporter/requirements.txt ] && { echo "----- requirements"; cat exporter/requirements.txt; pip install -q -r exporter/requirements.txt; }
pip install -q onnxscript || true
mkdir -p pocket-tts-onnx
(cd exporter && python export.py --help) || true

export_variant() {  # $1 = name, rest = extra flags
  local name=$1; shift
  echo "===== Export variant '$name' (Jugnu config swapped in for Kyutai's): $*"
  touch marker
  (cd exporter && PYTHONPATH=$W/hindi-trial/patch python export.py --language english_2026-04 --quantize "$@") \
    || echo "EXPORT '$name' FAILED"
  mkdir -p "variants/$name"
  find exporter pocket-tts-onnx -name "*.onnx" -newer marker -print -exec cp {} "variants/$name/" \;
  ls -la "variants/$name"
}
export_variant default
export_variant legacy --legacy_kv_cache

echo "===== Tokenizer"
pip install -q sentencepiece protobuf
mkdir -p tok && cp "$TOK" tok/tokenizer.model
git clone --depth 1 --filter=blob:none --sparse https://github.com/k2-fsa/sherpa-onnx sherpa-src && git -C sherpa-src sparse-checkout set scripts/pocket-tts
(cd tok && python ../sherpa-src/scripts/pocket-tts/convert_tokenizer.py)
ls -la tok

echo "===== Build a sherpa pack per variant and check it"
pip install -q sherpa-onnx soundfile
for v in variants/*; do
  name=$(basename "$v")
  pack="pack-$name"
  python "$W/hindi-trial/gather.py" "$v" "$EN" tok "$pack" || continue
  python "$W/hindi-trial/io.py" "$pack"
  python "$W/hindi-trial/check_pack.py" "$pack" "$name" || echo "CHECK '$name' FAILED"
  (cd "$pack" && zip -q -r "../jugnu-lite-$name.zip" .)
done
ls -la out *.zip
