"""Reads test sentences with each voice the way the app's copied voices do (LocalTts.generate), and scores
them with Whisper: words missed or added, "Well" leaking in, pace and pitch steadiness."""
import sys, re, json, numpy as np, soundfile as sf, sherpa_onnx

P = "/tmp/claude-0/enpack/sherpa-onnx-pocket-tts-int8-2026-01-26"
A = "/tmp/claude-0/asr/sherpa-onnx-whisper-base.en"
files, OUT = sys.argv[1].split("|"), sys.argv[2]

tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
    lm_flow=f"{P}/lm_flow.int8.onnx", lm_main=f"{P}/lm_main.int8.onnx", encoder=f"{P}/encoder.onnx",
    decoder=f"{P}/decoder.int8.onnx", text_conditioner=f"{P}/text_conditioner.onnx",
    vocab_json=f"{P}/vocab.json", token_scores_json=f"{P}/token_scores.json"), num_threads=4), silence_scale=1.0))
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{A}/base.en-encoder.int8.onnx", decoder=f"{A}/base.en-decoder.int8.onnx",
                                                 tokens=f"{A}/base.en-tokens.txt", num_threads=4)

import os
TEXTS = [l.strip() for l in open(os.environ["LINES"]) if l.strip()] if os.environ.get("LINES") else [
    "When I first arrived in the city, I had no money, no friends, and no idea where I would sleep that night.",
    "Mister Dursley was the director of a firm called Grunnings, which made drills.",
    "Could I say good-bye to him, sir? asked Hagrid.",
    "She opened the door, looked outside, and saw nothing but rain.",
    "The real problem is that we developed no new drugs for many years.",
    "He paused, looked around the room, and then, with a sigh, sat down on the edge of the bed.",
    "Why? New classes of drugs to treat bacterial infections are not easy to find.",
    "It was late, and the house was quiet except for the ticking of the old clock.",
]

def java_hash(s):
    h = 0
    for c in s: h = (31 * h + ord(c)) & 0xFFFFFFFF
    return h

def end_on_pause(x, rate):
    frame = max(1, rate // 50); n = len(x) // frame
    db = np.array([20 * np.log10(np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) + 1e-12) for f in range(n)])
    last = max(i for i in range(n) if db[i] > db.max() - 35)
    end = (last + 1) * frame
    out = np.zeros(end + rate * 8 // 100, dtype=np.float32); out[:end] = x[:end]
    fade = min(rate // 50, end); out[end-fade:end] *= 1 - np.arange(fade) / fade
    return out

def after_lead_in(x, rate):
    frame = rate // 100; n = len(x) // frame
    if n < 40: return None
    rms = np.array([np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) for f in range(n)])
    loud = np.sort(rms)[min(int(n*0.9), n-1)]
    on = [f for f in range(n-12) if sum(rms[f:f+12] > loud*0.2) >= 10]
    if not on: return None
    quiet = loud*0.06; f = on[0] + 15
    while f < min(n, 160):
        if rms[f] < quiet:
            e = f
            while e < n and rms[e] < quiet: e += 1
            if e - f >= 9:
                after = sum(1 for i in range(e, min(n, e+30)) if rms[i] > loud*0.2)
                return max(0, e-3)*frame if after >= 5 else None
            f = e
        else: f += 1
    return None

def max_frames(t): return int(min(400, max(25, len(t)*1.15 + 15)))

def prepare(t):
    s = t.strip().replace(";", ",")
    s = re.sub(r"(?<!\d):(?!\d)", ",", s)
    if len(s.split()) < 5: s = " "*8 + s
    return s

def words(s): return re.sub(r"[^a-z' ]", " ", s.lower().replace("mr.", "mister").replace("-", " ")).split()

def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h)+1))
    for i in range(1, len(r)+1):
        p, d[0] = d[0], i
        for j in range(1, len(h)+1):
            p, d[j] = d[j], min(d[j]+1, d[j-1]+1, p + (r[i-1] != h[j-1]))
    return d[len(h)], len(r)

def f0(x, sr):
    fr, hop, out = int(sr*0.04), int(sr*0.01), []
    for s in range(0, len(x)-fr, hop*4):
        w = x[s:s+fr]
        if np.sqrt(np.mean(w**2)) < 0.02: continue
        w = w - w.mean(); ac = np.correlate(w, w, "full")[fr-1:]
        lo, hi = int(sr/400), int(sr/60)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3*ac[0]: out.append(sr/k)
    return float(np.median(out)) if out else 0.0

for path in files:
    name = re.sub(r"\W+", "_", path.rsplit("/", 1)[-1][:-4]).strip("_")
    ref, sr = sf.read(path, dtype="float32")
    if ref.ndim > 1: ref = ref.mean(1)
    lead = end_on_pause(ref[: 30*sr - sr//10], sr)
    hears = (len(lead) + sr - 1)//sr
    h = java_hash("clone:" + os.environ.get("VID", name.lower()))
    seed = int(os.environ.get("SEED", 0)) or ((h - (1 << 32) if h >= 1 << 31 else h) & 0x7fffffff) % 100000 + 1
    LEAD = os.environ.get("LEADIN", "1") == "1"
    pace, errs, total, leaks, retakes, pitches, rows = None, 0, 0, 0, 0, [], []
    for i, t in enumerate(TEXTS):
        sp = prepare(t)
        def gen(say, sd, extra=0):
            g = sherpa_onnx.GenerationConfig(); g.reference_audio = lead.tolist(); g.reference_sample_rate = sr
            g.num_steps = 5; g.silence_scale = 1.0
            g.extra = {"seed": str(sd), "max_reference_audio_len": str(hears), "temperature": "0.6", "chunk_size": "15",
                       "max_frames": str(max_frames(sp.strip()) + extra), "frames_after_eos": "2"}
            a = tts.generate(say, g); return np.array(a.samples, dtype=np.float32), a.sample_rate
        def take(sd):
            if not LEAD: return gen(sp, sd)
            x, rate = gen(" "*8 + "Well. " + sp.strip(), sd, 12)
            c = after_lead_in(x, rate)
            return (x[c:], rate) if c is not None else gen(sp, sd)
        expected = lambda: 0.3 + len(t) / (pace or 13.0)
        def plausible(sec):
            r = sec / expected()
            return r >= 0.6 and (r <= 1.75 if pace is None else (r <= 1.4 or sec - expected() < 0.8))
        x, rate = take(seed)
        if not plausible(len(x)/rate):
            retakes += 1
            y, _ = take(seed + 7919)
            if abs(np.log(len(y)/rate/expected())) < abs(np.log(len(x)/rate/expected())): x = y
        sec = len(x)/rate
        if len(t) >= 25 and sec >= 1: pace = len(t)/sec if pace is None else pace*0.85 + len(t)/sec*0.15
        s = rec.create_stream(); s.accept_waveform(rate, x); rec.decode_stream(s); heard = s.result.text.strip()
        e, n = wer(t, heard); errs += e; total += n
        if words(heard)[:1] == ["well"]: leaks += 1
        pitches.append(f0(x, rate))
        sf.write(f"{OUT}/{name}_{i}.wav", x, rate)
        rows.append(f"   {e:2d} err | {heard}")
    ok = [p for p in pitches if p > 0]
    spread = 12*np.log2(max(ok)/min(ok)) if len(ok) > 1 else 0
    print(f"{name:12s} ref {len(ref)/sr:5.1f}s | word errors {errs}/{total} ({100*errs/max(1,total):4.1f}%) | 'Well' leaks {leaks} | "
          f"retakes {retakes} | pitch {np.median(ok) if ok else 0:5.0f} Hz, spread {spread:4.1f} st", flush=True)
    for r in rows: print(r, flush=True)
