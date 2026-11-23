"""ASR + scoring of a bench folder."""
import sys, glob, json, os, re, soundfile as sf, numpy as np, sherpa_onnx as so
from pipe import M
from asr import errors
src = open('run.py').read()
LINES = eval("[" + src.split("LINES = [")[1].split("\n]")[0] + "]")
if os.environ.get("LINESET") == "emo": LINES = eval("[" + src.split("EMO = [")[1].split("\n]")[0] + "]")
from num2words import num2words
exec("def spell" + src.split("def spell")[1].split("res = []")[0])
p = f"{M}/sherpa-onnx-moonshine-base-en-int8"
r = so.OfflineRecognizer.from_moonshine(preprocessor=f"{p}/preprocess.onnx", encoder=f"{p}/encode.int8.onnx", uncached_decoder=f"{p}/uncached_decode.int8.onnx", cached_decoder=f"{p}/cached_decode.int8.onnx", tokens=f"{p}/tokens.txt", num_threads=2)
def pitch_range(x, rate=24000):
    """Spread of pitch in semitones (10th-90th percentile, autocorrelation pitch of loud 40 ms frames)."""
    win, hop, lo, hi = int(rate * 0.04), rate // 100, rate // 400, rate // 70
    loud = np.sqrt(np.mean(x ** 2)) if len(x) else 0; f0 = []
    for i in range(0, len(x) - win, hop):
        fr = x[i:i + win] - x[i:i + win].mean()
        if np.sqrt(np.mean(fr ** 2)) < loud * 0.5: continue
        ac = np.correlate(fr, fr, 'full')[win - 1:]
        if ac[0] <= 0: continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / ac[0] > 0.5: f0.append(rate / lag)
    if len(f0) < 10: return 0.0
    st = 12 * np.log2(np.array(f0) / np.median(f0)); return float(np.percentile(st, 90) - np.percentile(st, 10))
def fix(h):
    h = re.sub(r"\$(\d[\d,]*)", r"\1 dollars", h).replace("%", " percent")
    return re.sub(r"\b(\d+)\.(\d\d)\b", r"\1:\2", h)
def check(d):
    cache = f"{d}/asr.json"; res = json.load(open(cache)) if os.path.exists(cache) else {}
    for f in sorted(glob.glob(f"{d}/*.wav")):
        k = os.path.basename(f)
        if k in res: continue
        x, _ = sf.read(f, dtype='float32'); pad = np.zeros(12000, np.float32); s = r.create_stream(); s.accept_waveform(24000, np.concatenate([pad, x, pad, pad]).tolist()); r.decode_stream(s)
        meta = json.load(open(f + ".meta")) if os.path.exists(f + ".meta") else {}
        res[k] = dict(heard=s.result.text.strip(), sec=len(x)/24000, pr=pitch_range(x), **meta)
    json.dump(res, open(cache, "w"), indent=1)
    return res
def score(res, keys, name, lines=None):
    S=D=I=N=bad=0; per={}; gen=0; pr=[]
    for k in keys:
        x = res[k]; i = int(k[:-4].split("_")[1])
        if lines is not None and i not in lines: continue
        s,dd,ii,n = errors(spell(LINES[i]), spell(fix(x["heard"])))
        S+=s; D+=dd; I+=ii; N+=n; bad += (s+dd+ii)>0; per[i] = per.get(i,0) + ((s+dd+ii)>0); gen += x.get("gen",0); pr.append(x["pr"])
    print(f"{name:12s} n={len([1 for k in keys if lines is None or int(k[:-4].split('_')[1]) in lines])}  WER {(S+D+I)/max(1,N)*100:5.2f}%  sub {S:3d} skipped {D:3d} extra {I:3d}  bad lines {bad:3d}  gen {gen:5.0f}s  pitch range {np.mean(pr):.2f} st")
    return per
if __name__ == "__main__":
    ds = sys.argv[1:]
    R = {d: check(d) for d in ds}
    common = sorted(set.intersection(*[set(R[d]) for d in ds]))
    pers = {d: score(R[d], common, d) for d in ds}
    print("bad lines by test line:")
    for d in ds: print(f"  {d:12s}", " ".join(f"{pers[d].get(i,0):2d}" for i in range(len(LINES))))
