"""Prints every ONNX model's inputs and outputs (names, types, shapes) in a folder."""
import glob, os, sys
import onnxruntime as ort

for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.onnx"))):
    try:
        s = ort.InferenceSession(p, providers=["CPUExecutionProvider"])
    except Exception as e:
        print(f"## {os.path.basename(p)}: cannot load: {e}")
        continue
    print(f"## {os.path.basename(p)} ({os.path.getsize(p) // 1_000_000} MB)")
    for i in s.get_inputs():
        print(f"   in  {i.name:28s} {i.type:22s} {i.shape}")
    for o in s.get_outputs():
        print(f"   out {o.name:28s} {o.type:22s} {o.shape}")
