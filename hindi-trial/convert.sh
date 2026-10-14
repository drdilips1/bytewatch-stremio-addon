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
git clone --recurse-submodules https://github.com/lookbe/pocket-tts-onnx-export exporter
echo "----- .gitmodules"; cat exporter/.gitmodules 2>/dev/null
if [ ! -f exporter/pocket_tts/models/model_state.py ]; then
  # The fork's copy of the engine is incomplete: use the Pocket TTS that Jugnu installed.
  echo "exporter's pocket_tts is incomplete: using the installed one"
  rm -rf exporter/pocket_tts
fi
python -c "import pocket_tts, os; print('pocket_tts from', os.path.dirname(pocket_tts.__file__))"
echo "exporter commit: $(git -C exporter rev-parse HEAD)"
git -C exporter log --oneline | head -15
find exporter -type f -not -path "*/.git/*" | head -60
echo "----- README"; head -150 exporter/README.md
echo "----- export.py"; cat exporter/export.py | head -300
[ -f exporter/requirements.txt ] && { echo "----- requirements"; cat exporter/requirements.txt; pip install -q -r exporter/requirements.txt; }
pip install -q onnxscript || true
mkdir -p pocket-tts-onnx
(cd exporter && python export.py --help) || true

echo "----- how the scripts take their model"
grep -n "add_argument\|load_model\|yaml\|config" exporter/scripts/export_flow_lm.py exporter/scripts/export_mimi_and_conditioner.py exporter/scripts/quantize.py | head -80
grep -n "def load_model\|def from_config\|config" exporter/pocket_tts/models/tts_model.py | head -40
echo "----- exporter english.yaml"; cat exporter/pocket_tts/config/english.yaml
echo "----- Jugnu config"; cat "$JUGNU_CONFIG"
WEIGHTS=$(grep weights_path "$JUGNU_CONFIG" | awk '{print $2}')
echo "Jugnu weights: $WEIGHTS"
echo "===== Export (legacy full-cache layout, as in the English pack)"
mkdir -p variants/legacy
(
  cd exporter && export PYTHONPATH=. && mkdir -p onnx &&
  python scripts/export_mimi_and_conditioner.py --output_dir onnx --weights_path "$WEIGHTS" --config "$JUGNU_CONFIG" &&
  python scripts/export_flow_lm.py --output_dir onnx --weights_path "$WEIGHTS" --config "$JUGNU_CONFIG" --no_kv_delta &&
  python scripts/quantize.py --input_dir onnx --output_dir onnx
) || echo "EXPORT FAILED"
ls -la exporter/onnx 2>/dev/null
cp exporter/onnx/*.onnx variants/legacy/ 2>/dev/null
ls -la variants/legacy

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
