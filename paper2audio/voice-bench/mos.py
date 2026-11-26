"""DNSMOS (Microsoft, P.835): SIG = speech quality, BAK = background, OVRL = overall, 1-5. Per voice: its lines
joined with short gaps, scored in 9 s windows (as dnsmos_local.py), averaged."""
import sys, glob, numpy as np, soundfile as sf, onnxruntime as ort, subprocess
from pipe import M, load_ref
S = ort.InferenceSession(f"{M}/dnsmos/pkx/speechmos/dnsmos_models/sig_bak_ovr.onnx", providers=["CPUExecutionProvider"])
P_OVR = np.poly1d([-0.06766283, 1.11546468, 0.04602535]); P_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439]); P_BAK = np.poly1d([-0.13166888, 1.60915514, -0.39604546])
def to16(x):
    import math
    from scipy.signal import resample_poly
    return resample_poly(x, 2, 3).astype(np.float32)
def score16(x):
    L = 144160
    if len(x) < L: x = np.tile(x, int(np.ceil(L / len(x))))[:L]
    out = []
    for st in range(0, len(x) - L + 1, 16000):
        seg = x[st:st+L][None, :].astype(np.float32)
        sig, bak, ovr = S.run(None, {"input_1": seg})[0][0]
        out.append((P_SIG(sig), P_BAK(bak), P_OVR(ovr)))
    return np.mean(out, 0)
def voice_score(files):
    gap = np.zeros(int(24000 * 0.3), np.float32); parts = []
    for f in files: parts += [sf.read(f, dtype='float32')[0], gap]
    return score16(to16(np.concatenate(parts)))
def folder(d, voices=None):
    vs = sorted({f.split('/')[-1].split('_')[0] for f in glob.glob(f"{d}/*.wav")})
    if voices: vs = [v for v in vs if v in voices]
    return {v: voice_score(sorted(glob.glob(f"{d}/{v}_*.wav"))) for v in vs}
if __name__ == "__main__":
    voices = None
    res = {}
    for d in sys.argv[1:]:
        if d == "REAL":
            from pipe import load_ref
            vs = sorted({f.split('/')[-1].split('_')[0] for f in glob.glob("base/*.wav")})
            res[d] = {v: score16(to16(load_ref(v))) for v in vs}
        else: res[d] = folder(d)
    common = sorted(set.intersection(*[set(r) for r in res.values()]))
    for d, r in res.items():
        a = np.array([r[v] for v in common])
        print(f"{d:10s} voices {len(common):2d}  SIG {a[:,0].mean():.3f}  BAK {a[:,1].mean():.3f}  OVRL {a[:,2].mean():.3f}")
