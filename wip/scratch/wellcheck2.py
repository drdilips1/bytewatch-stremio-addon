import sys, os, numpy as np, soundfile as sf
os.environ.setdefault("LINES", "/tmp/claude-0/well.txt")
src = open("voicetest2.py").read().split("for path in files:")[0]
exec(src)
V = "/home/user/bytewatch-stremio-addon/paper2audio/android/app/src/lite/assets/voices"
seeds = {"clara": 90001, "ava": 0}
def jseed(i):
    h = java_hash("clone:" + i); h = h - (1 << 32) if h >= 1 << 31 else h
    return (h & 0x7fffffff) % 100000 + 1
def asr(x, rate):
    s = rec.create_stream(); s.accept_waveform(rate, x); rec.decode_stream(s); return s.result.text.strip()
for name, sd in seeds.items():
    ref, sr = sf.read(f"{V}/{name}.wav", dtype="float32")
    lead = end_on_pause(ref[: 30*sr - sr//10], sr); hears = (len(lead)+sr-1)//sr
    seed = sd or jseed(name)
    for t in TEXTS:
        sp = prepare(t)
        def gen(say, extra=0):
            g = sherpa_onnx.GenerationConfig(); g.reference_audio = lead.tolist(); g.reference_sample_rate = sr
            g.num_steps = 5; g.silence_scale = 1.0
            g.extra = {"seed": str(seed), "max_reference_audio_len": str(hears), "temperature": "0.6", "chunk_size": "15",
                       "max_frames": str(max_frames(sp.strip()) + extra), "frames_after_eos": "2"}
            a = tts.generate(say, g); return np.array(a.samples, dtype=np.float32), a.sample_rate
        x, rate = gen(" "*8 + "Well. " + sp.strip(), 12)
        c = after_lead_in(x, rate)
        plain, _ = gen(sp)
        kept = x[c:] if c is not None else plain
        e1,n1 = wer(t, asr(kept, rate)); e2,n2 = wer(t, asr(plain, rate))
        print(f"{name:6s} lead-in {e1} wrong: {asr(kept,rate)!r:55s} | none {e2} wrong: {asr(plain,rate)!r}", flush=True)
