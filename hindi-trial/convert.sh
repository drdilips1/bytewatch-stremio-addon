#!/usr/bin/env bash
# Converts Jugnu Lite to the sherpa-onnx Pocket TTS layout the apps use, then checks it
# by making Hindi samples with sherpa-onnx itself (the same engine as on the phone).
# Each stage logs what it finds; a failing stage doesn't hide what the others show.
set -u
W=$PWD
mkdir -p pack out

echo "===== Jugnu Lite config"
python - <<'PY'
import inspect, pocket_tts
from jugnu_tts import api as J
print("MODELS:", J.MODELS)
cfg = J._assemble(J.MODELS["lite"])
print("config:", cfg)
open("jugnu_config_path", "w").write(str(cfg))
try:
    print(open(cfg).read()[:3000])
except Exception as e:
    print("(not text)", e)
print("load_model signature:", inspect.signature(pocket_tts.TTSModel.load_model))
PY
export JUGNU_CONFIG=$(cat jugnu_config_path)
echo "JUGNU_CONFIG=$JUGNU_CONFIG"
ls -la "$(dirname "$JUGNU_CONFIG")" || true

echo "===== Exporter"
git clone --depth 1 https://github.com/KevinAHM/pocket-tts-onnx-export exporter || true
git clone --depth 1 https://github.com/KevinAHM/pocket-tts-onnx pocket-tts-onnx || true
echo "exporter commit: $(git -C exporter rev-parse HEAD 2>/dev/null)"
find exporter -type f -not -path "*/.git/*" | head -60
echo "----- README"; head -200 exporter/README.md 2>/dev/null
echo "----- export.py"; head -250 exporter/export.py 2>/dev/null
[ -f exporter/requirements.txt ] && { echo "----- requirements"; cat exporter/requirements.txt; pip install -q -r exporter/requirements.txt; }
pip install -q onnx onnxruntime onnxscript || true
(cd exporter && python export.py --help) || true

echo "===== Export (Jugnu config swapped in for Kyutai's)"
(cd exporter && PYTHONPATH=$W/hindi-trial/patch python export.py --language english_2026-04 --quantize) \
  || (cd exporter && PYTHONPATH=$W/hindi-trial/patch python export.py --language english_2026-04) || echo "EXPORT FAILED"
echo "----- ONNX files made"
find exporter pocket-tts-onnx -name "*.onnx" -newer jugnu_config_path -exec ls -la {} \; 2>/dev/null

echo "===== Tokenizer"
TOK=$(find hf -name "tokenizer.model" -path "*jugnu*" | head -1)
echo "Jugnu tokenizer: $TOK"
git clone --depth 1 --filter=blob:none --sparse https://github.com/k2-fsa/sherpa-onnx sherpa-src && git -C sherpa-src sparse-checkout set scripts/pocket-tts
head -80 sherpa-src/scripts/pocket-tts/convert_tokenizer.py
pip install -q sentencepiece protobuf
cp "$TOK" pack/tokenizer.model 2>/dev/null
(cd pack && python ../sherpa-src/scripts/pocket-tts/convert_tokenizer.py) || (cd pack && python ../sherpa-src/scripts/pocket-tts/convert_tokenizer.py --help) || true
ls -la pack

echo "===== Gather the pack in sherpa-onnx names"
python - <<'PY'
import glob, os, shutil
names = {"flow_lm_main": "lm_main", "flow_lm_flow": "lm_flow", "mimi_encoder": "encoder",
         "mimi_decoder": "decoder", "text_conditioner": "text_conditioner"}
found = [p for p in glob.glob("exporter/**/*.onnx", recursive=True) + glob.glob("pocket-tts-onnx/**/*.onnx", recursive=True)
         if os.path.getmtime(p) > os.path.getmtime("jugnu_config_path")]
for p in sorted(found): print(p, os.path.getsize(p))
for src, dst in names.items():
    for suffix, out in (("_int8.onnx", ".int8.onnx"), (".int8.onnx", ".int8.onnx"), (".onnx", ".onnx")):
        c = [p for p in found if os.path.basename(p) == src + suffix]
        if c:
            shutil.copy(c[0], f"pack/{dst}{out}")
            print(c[0], "->", f"pack/{dst}{out}")
PY
ls -la pack

echo "===== Check with sherpa-onnx"
pip install -q sherpa-onnx soundfile
python "$W/hindi-trial/check_pack.py" || echo "CHECK FAILED"
ls -la out
