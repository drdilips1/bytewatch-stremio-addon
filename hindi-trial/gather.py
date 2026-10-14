"""Gathers exported ONNX files into the sherpa-onnx Pocket pack names.

usage: gather.py <exported dir> <english pack dir> <tokenizer dir> <out dir>
The sound codec (encoder/decoder) is taken from the export when present, else from the
English pack (Jugnu uses Kyutai's frozen codec unchanged).
"""
import os, shutil, sys

src, en, tok, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
files = os.listdir(src)
print("exported:", sorted(files))


def find(stem):
    for cand in (f"{stem}_int8.onnx", f"{stem}.int8.onnx", f"{stem}_q8.onnx", f"{stem}.onnx"):
        if cand in files:
            return os.path.join(src, cand)
    return None


want = {
    "lm_main.int8.onnx": ["flow_lm_main", "lm_main"],
    "lm_flow.int8.onnx": ["flow_lm_flow", "lm_flow"],
    "text_conditioner.onnx": ["text_conditioner"],
    "encoder.onnx": ["mimi_encoder", "encoder"],
    "decoder.int8.onnx": ["mimi_decoder", "decoder"],
}
for dst, stems in want.items():
    got = next((p for p in (find(s) for s in stems) if p), None)
    if got is None and dst in ("encoder.onnx", "decoder.int8.onnx"):
        got = os.path.join(en, dst)
    if got is None:
        sys.exit(f"missing {dst}")
    shutil.copy(got, os.path.join(out, dst))
    print(got, "->", dst)
for f in ("vocab.json", "token_scores.json", "tokenizer.model"):
    shutil.copy(os.path.join(tok, f), os.path.join(out, f))
