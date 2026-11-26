"""Post-processing variants on raw engine output (RAW=1 folders)."""
import sys, os, glob, json, numpy as np, soundfile as sf
from pipe import RATE, rms_frames, load_ref
from crisp import crisp
def gate(x, low):
    y = x.copy(); fr = RATE // 100; rms = rms_frames(y, fr); n = len(rms)
    if n < 5 or low >= 1: return y
    loud = np.sort(rms)[min(n-1, int(n*.9))]; floor = loud*0.03; g = 1.0
    for f in range(n):
        t = 1.0 if np.any(rms[f:min(n, f+9)] >= floor) else low
        g = t if t > g else g + (t-g)*0.2; y[f*fr:(f+1)*fr] *= g
    return y
def fade(x, ms_in=8, ms_out=25):
    y = x.copy(); a = min(len(y), RATE*ms_in//1000); b = min(len(y), RATE*ms_out//1000)
    y[:a] *= np.linspace(0, 1, a, dtype=np.float32); y[len(y)-b:] *= np.linspace(1, 0, b, dtype=np.float32); return y
def tilt(x):
    """4.5-8 kHz level relative to 0.5-2 kHz (dB), over speech frames."""
    n = 1024; fr = np.stack([x[i:i+n]*np.hanning(n) for i in range(0, len(x)-n, 512)])
    e = (fr**2).mean(1); fr = fr[e > np.percentile(e, 40)]
    sp = (np.abs(np.fft.rfft(fr, axis=1))**2).mean(0); f = np.fft.rfftfreq(n, 1/RATE)
    return 10*np.log10(sp[(f >= 4500) & (f < 8000)].mean() / sp[(f >= 500) & (f < 2000)].mean())
if __name__ == "__main__":
    src = sys.argv[1]
    files = sorted(glob.glob(f"{src}/*.wav")); voices = sorted({f.split('/')[-1].split('_')[0] for f in files})
    gains = {}
    for v in voices:
        out = np.concatenate([sf.read(f, dtype='float32')[0] for f in files if f.split('/')[-1].startswith(v + "_")])
        gains[v] = float(np.clip(tilt(load_ref(v)) - tilt(out), 0, 6))
    print("per-voice lift (dB):", {v: round(g, 1) for v, g in gains.items()})
    V = {"g3": lambda x, v: gate(x, .3), "g6": lambda x, v: gate(x, .6), "g10": lambda x, v: x,
         "g3f": lambda x, v: fade(gate(x, .3)), "g3eq": lambda x, v: gate(crisp(x, RATE, gains[v]) if gains[v] > 0.5 else x, .3)}
    for name, fn in V.items():
        d = f"{src}_{name}"; os.makedirs(d, exist_ok=True)
        for f in files:
            v = f.split('/')[-1].split('_')[0]; x = sf.read(f, dtype='float32')[0]
            sf.write(f"{d}/{os.path.basename(f)}", fn(x, v), RATE)
            if os.path.exists(f + ".meta"): open(f"{d}/{os.path.basename(f)}.meta", "w").write(open(f + ".meta").read())
