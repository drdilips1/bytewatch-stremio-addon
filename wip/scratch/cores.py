import sys, time, numpy as np, soundfile as sf, sherpa_onnx
P = "/tmp/claude-0/enpack/sherpa-onnx-pocket-tts-int8-2026-01-26"
ref, rate = sf.read(sys.argv[1], dtype="float32")
if ref.ndim > 1: ref = ref.mean(1)
text = "Mister Flamel, who celebrated his six hundred and sixty-fifth birthday last year, enjoys a quiet life in Devon."
out = {}
for n in (2, 1):
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
        lm_flow=f"{P}/lm_flow.int8.onnx", lm_main=f"{P}/lm_main.int8.onnx", encoder=f"{P}/encoder.onnx",
        decoder=f"{P}/decoder.int8.onnx", text_conditioner=f"{P}/text_conditioner.onnx",
        vocab_json=f"{P}/vocab.json", token_scores_json=f"{P}/token_scores.json"), num_threads=n), silence_scale=1.0))
    cfg = sherpa_onnx.GenerationConfig(); cfg.reference_audio = ref[: rate * 10]; cfg.reference_sample_rate = rate
    cfg.num_steps = 5; cfg.silence_scale = 1.0; cfg.extra = {"seed": "64194"}
    t = time.time(); a = tts.generate(text, cfg); dt = time.time() - t
    s = np.array(a.samples); out[n] = s
    print(f"{n} core(s): {dt:.1f}s for {len(s)/a.sample_rate:.1f}s of speech")
a, b = out[2], out[1]
same = len(a) == len(b) and np.array_equal(a, b)
print("identical:", same, "| max difference:", float(np.max(np.abs(a[:min(len(a),len(b))] - b[:min(len(a),len(b))]))) if not same else 0, "| lengths", len(a), len(b))
