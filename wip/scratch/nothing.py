import sys, numpy as np, soundfile as sf, sherpa_onnx, importlib.util
spec = importlib.util.spec_from_file_location("vt", sys.argv[3]); 
P = "/tmp/claude-0/enpack/sherpa-onnx-pocket-tts-int8-2026-01-26"; A = "/tmp/claude-0/asr/sherpa-onnx-whisper-base.en"
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
    lm_flow=f"{P}/lm_flow.int8.onnx", lm_main=f"{P}/lm_main.int8.onnx", encoder=f"{P}/encoder.onnx", decoder=f"{P}/decoder.int8.onnx",
    text_conditioner=f"{P}/text_conditioner.onnx", vocab_json=f"{P}/vocab.json", token_scores_json=f"{P}/token_scores.json"), num_threads=4), silence_scale=1.0))
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{A}/base.en-encoder.int8.onnx", decoder=f"{A}/base.en-decoder.int8.onnx", tokens=f"{A}/base.en-tokens.txt", num_threads=4)
ref, sr = sf.read(sys.argv[1], dtype="float32")
def end_on_pause(x, rate):
    frame = max(1, rate // 50); n = len(x) // frame
    db = np.array([20*np.log10(np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) + 1e-12) for f in range(n)])
    last = max(i for i in range(n) if db[i] > db.max() - 35); end = (last+1)*frame
    out = np.zeros(end + rate*8//100, dtype=np.float32); out[:end] = x[:end]; return out
lead = end_on_pause(ref[: 10*sr - sr//10], sr); hears = (len(lead)+sr-1)//sr
import os; text = os.environ.get("T", "Nothing, nothing…"); sp = " "*8 + text
mf = lambda t: max(25, min(400, int(len(t)*1.15 + 15)))
def after_lead_in(x, rate):
    frame = rate//100; n = len(x)//frame
    if n < 40: return None
    rms = np.array([np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) for f in range(n)]); loud = np.sort(rms)[min(n-1, int(n*0.9))]
    onset = next((f for f in range(n-12) if (rms[f:f+12] > loud*0.2).sum() >= 10), None)
    if onset is None: return None
    q = loud*0.06; f = onset+15
    while f < min(n,160):
        if rms[f] < q:
            e = f
            while e < n and rms[e] < q: e += 1
            if e-f >= 9:
                after = (rms[e:min(n,e+30)] > loud*0.2).sum()
                return max(0,e-3)*frame if after >= 5 else None
            f = e
        else: f += 1
    return None
def take(sd):
    g = sherpa_onnx.GenerationConfig(); g.reference_audio = lead.tolist(); g.reference_sample_rate = sr; g.num_steps = 5; g.silence_scale = 1.0
    g.extra = {"seed": str(sd), "max_reference_audio_len": str(hears), "temperature": "0.6", "chunk_size": "15", "max_frames": str(mf(sp.strip()) + 12), "frames_after_eos": "2"}
    tail = os.environ.get("TAIL", "")
    if tail: g.extra["max_frames"] = str(mf(sp.strip() + tail) + 12)
    a = tts.generate(" "*8 + "Well. " + sp.strip() + tail, g); x = np.array(a.samples, dtype=np.float32); c = after_lead_in(x, a.sample_rate)
    x = x[c:] if c is not None else x
    if os.environ.get("TAIL"):
        frame = a.sample_rate//100; n = len(x)//frame
        rms = np.array([np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) for f in range(n)]); loud = np.sort(rms)[int(n*0.9)]
        q = loud*0.06; cut = None; f = n-1
        while f > 0 and rms[f] < q: f -= 1          # end of speech
        end = f
        while f > 0:
            if rms[f] < q:
                e = f
                while e > 0 and rms[e] < q: e -= 1
                if f - e >= 9 and 25 <= end - f <= 110: cut = e + 6; break
                f = e
            else: f -= 1
        x = x[: cut*frame] if cut else x
    return x, a.sample_rate
def best(sd):
    exp = 0.3 + len(text) / 13.0
    for k in range(3):
        x, r = take(sd + 7919 * k)
        if len(x) / r >= 0.65 * exp: return x, r, k + 1
    return x, r, 3
import re
norm = lambda t: re.sub(r"[^a-z ]", "", t.lower().replace("-", " ")).split()
ok = 0; seeds = [int(s) for s in sys.argv[2].split(",")]
for sd in seeds:
    if os.environ.get("TAIL"): x, r, tries = best(sd)
    else:
        exp = 0.3 + len(text) / 13.0
        a1 = take(sd); a2 = take(sd + 7919)   # the app now: two takes, the one nearer the expected length
        x, r = min((a1, a2), key=lambda a: abs(np.log(len(a[0]) / a[1] / exp))); tries = 2; s = rec.create_stream(); s.accept_waveform(r, x); rec.decode_stream(s)
    frame = r//100; n = len(x)//frame
    rms = np.array([np.sqrt(np.mean(x[f*frame:(f+1)*frame]**2)) for f in range(n)]); loud = np.sort(rms)[int(n*0.9)]
    on = rms > loud*0.12; bursts = 0; gap = 99
    for v in on:
        if v:
            if gap >= 12: bursts += 1
            gap = 0
        else: gap += 1
    good = norm(s.result.text) == norm(text); ok += good
    print(f"seed {sd}: {'OK ' if good else 'BAD'} heard: {s.result.text.strip()}")
print(f"RESULT {text!r}: {ok}/{len(seeds)} right")
