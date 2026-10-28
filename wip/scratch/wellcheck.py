import sys, os, numpy as np, soundfile as sf
os.environ.setdefault("LINES", "/tmp/claude-0/well.txt")
src = open("voicetest2.py").read().split("for path in files:")[0]
exec(src)
V = "/home/user/bytewatch-stremio-addon/paper2audio/android/app/src/lite/assets/voices"
seeds = {"ava": 0, "clara": 90001, "theo": 0, "oscar": 15734, "emma": 64194}
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
        head = kept[: int(rate*1.3)]
        print(f"{name:6s} cut at {c/rate if c else -1:4.2f}s | lead-in kept {len(kept)/rate:4.2f}s vs plain {len(plain)/rate:4.2f}s | first 1.3 s heard: '{asr(head, rate)}' | {t[:40]}", flush=True)
