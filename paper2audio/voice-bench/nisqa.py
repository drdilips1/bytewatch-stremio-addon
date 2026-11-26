"""NISQA-TTS naturalness (1-5), per voice averaged over its lines."""
import sys, glob, inspect, numpy as np, torch, librosa as lb
from pipe import M
sys.path.insert(0, f"{M}/nisqa")
import NISQA_lib as NL
ck = torch.load(f"{M}/nisqa/nisqa_tts.tar", map_location="cpu", weights_only=True); A = ck["args"]
params = inspect.signature(NL.NISQA.__init__).parameters
net = NL.NISQA(**{k: v for k, v in A.items() if k in params}); net.load_state_dict(ck["model_state_dict"]); net.eval()
torch.set_num_threads(4)
def nat(x, sr=24000):
    S = lb.feature.melspectrogram(y=x, sr=sr, n_fft=A["ms_n_fft"], hop_length=int(sr*A["ms_hop_length"]), win_length=int(sr*A["ms_win_length"]),
                                  window="hann", center=True, pad_mode="reflect", power=1.0, n_mels=A["ms_n_mels"], fmin=0.0, fmax=A["ms_fmax"], htk=False, norm="slaney")
    spec = lb.amplitude_to_db(S, ref=1.0, amin=1e-4, top_db=80.0)
    seg, n = NL.segment_specs("x", spec, A["ms_seg_length"], A["ms_seg_hop_length"], A["ms_max_segments"])
    with torch.no_grad(): return float(net(seg[None].float(), torch.tensor([int(n)]))[0, 0])
def folder(d):
    import soundfile as sf
    out = {}
    for f in sorted(glob.glob(f"{d}/*.wav")):
        v = f.split("/")[-1].split("_")[0]; x = sf.read(f, dtype="float32")[0]
        if len(x) < 24000 * 0.5: continue
        out.setdefault(v, []).append(nat(x))
    return {v: float(np.mean(s)) for v, s in out.items()}
if __name__ == "__main__":
    res = {}
    for d in sys.argv[1:]:
        if d == "REAL":
            from pipe import load_ref
            import soundfile as sf
            vs = sorted({f.split('/')[-1].split('_')[0] for f in glob.glob("base/*.wav")})
            res[d] = {}
            for v in vs:
                x = load_ref(v); ch = [x[i:i+24000*4] for i in range(0, len(x)-24000*4, 24000*4)]
                res[d][v] = float(np.mean([nat(c) for c in ch]))
        else: res[d] = folder(d)
    common = sorted(set.intersection(*[set(r) for r in res.values()]))
    for d, r in res.items(): print(f"{d:10s} voices {len(common):2d}  naturalness {np.mean([r[v] for v in common]):.3f}")
    print("per voice:", {v: tuple(round(res[d][v], 2) for d in res) for v in common})
