import sys, time, numpy as np, soundfile as sf, sherpa_onnx
I = "/tmp/claude-0/enpack/sherpa-onnx-pocket-tts-int8-2026-01-26"
F = "/tmp/claude-0/fp32/sherpa-onnx-pocket-tts-2026-01-26"
ref, rate = sf.read(sys.argv[1], dtype="float32")
if ref.ndim > 1: ref = ref.mean(1)
out = sys.argv[2]
text = ("There have been many reports of the Sorcerer's Stone over the centuries. "
        "She said it softly, but the sharp hiss of the kettle made everyone stop and listen.")
def engine(decoder):
    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
        lm_flow=f"{I}/lm_flow.int8.onnx", lm_main=f"{I}/lm_main.int8.onnx", encoder=f"{I}/encoder.onnx",
        decoder=decoder, text_conditioner=f"{I}/text_conditioner.onnx",
        vocab_json=f"{I}/vocab.json", token_scores_json=f"{I}/token_scores.json"), num_threads=2), silence_scale=1.0))
def gen(tts):
    cfg = sherpa_onnx.GenerationConfig(); cfg.reference_audio = ref[: rate * 10]; cfg.reference_sample_rate = rate
    cfg.num_steps = 5; cfg.silence_scale = 1.0; cfg.extra = {"seed": "64194", "temperature": "0.6"}
    t = time.time(); a = tts.generate(text, cfg); return np.array(a.samples, dtype=np.float32), a.sample_rate, time.time() - t
def hf(x, sr):  # share of energy above 4 kHz
    X = np.abs(np.fft.rfft(x)) ** 2; f = np.fft.rfftfreq(len(x), 1 / sr); return X[f > 4000].sum() / X.sum()
def shelf(x, sr, gain_db=4.0, f0=3500.0):  # RBJ high-shelf biquad
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / sr; c, s = np.cos(w), np.sin(w); al = s / 2 * np.sqrt(2)
    b0 = A*((A+1)+(A-1)*c+2*np.sqrt(A)*al); b1 = -2*A*((A-1)+(A+1)*c); b2 = A*((A+1)+(A-1)*c-2*np.sqrt(A)*al)
    a0 = (A+1)-(A-1)*c+2*np.sqrt(A)*al; a1 = 2*((A-1)-(A+1)*c); a2 = (A+1)-(A-1)*c-2*np.sqrt(A)*al
    y = np.zeros_like(x); x1=x2=y1=y2=0.0
    for n, v in enumerate(x):
        o = (b0*v + b1*x1 + b2*x2 - a1*y1 - a2*y2) / a0; y[n] = o; x2, x1, y2, y1 = x1, v, y1, o
    return y / max(1.0, np.abs(y).max() / 0.98)
a, sr, ta = gen(engine(f"{I}/decoder.int8.onnx"))
b, _, tb = gen(engine(f"{F}/decoder.onnx"))
c = shelf(a, sr)
for name, x, t in (("A_now", a, ta), ("B_full_decoder", b, tb), ("C_clarity_boost", c, ta)):
    sf.write(f"{out}/{name}.wav", x, sr); print(f"{name}: {len(x)/sr:.1f}s audio, made in {t:.1f}s, high-frequency share {100*hf(x, sr):.2f}%")
