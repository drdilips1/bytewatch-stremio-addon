"""Makes Hindi samples from a converted pack with sherpa-onnx (the phone's engine).

usage: check_pack.py <pack dir> <variant name>
"""
import os, sys, time
import numpy as np
import sherpa_onnx
import soundfile as sf

P, name = sys.argv[1], sys.argv[2]
print("sherpa-onnx", getattr(sherpa_onnx, "__version__", "?"), "pack:", sorted(os.listdir(P)))

cfg = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
            lm_flow=f"{P}/lm_flow.int8.onnx",
            lm_main=f"{P}/lm_main.int8.onnx",
            encoder=f"{P}/encoder.onnx",
            decoder=f"{P}/decoder.int8.onnx",
            text_conditioner=f"{P}/text_conditioner.onnx",
            vocab_json=f"{P}/vocab.json",
            token_scores_json=f"{P}/token_scores.json",
        ),
        num_threads=4,
    ),
)
tts = sherpa_onnx.OfflineTts(cfg)
ref, sr = sf.read("refs/voice1.wav", dtype="float32")
if ref.ndim > 1:
    ref = ref.mean(axis=1)
lines = {
    "hindi_greeting": "नमस्ते! आज हम एक नई कहानी पढ़ेंगे।",
    "hindi_story": "एक छोटे से गाँव में एक बूढ़ा किसान रहता था। हर सुबह वह सूरज निकलने से पहले अपने खेतों में चला जाता था, और शाम को थककर लौटता था।",
    "hinglish": "मैंने अपना laptop restart किया और फिर meeting join की।",
}
for key, text in lines.items():
    g = sherpa_onnx.GenerationConfig()
    g.reference_audio = ref.tolist()
    g.reference_sample_rate = sr
    g.num_steps = 5
    g.extra = {"seed": "1", "temperature": "0.6", "max_reference_audio_len": "12"}
    t0 = time.time()
    a = tts.generate(text, g)
    took = time.time() - t0
    out = f"out/phone_{name}_voice1_{key}.wav"
    sf.write(out, np.array(a.samples, dtype=np.float32), a.sample_rate)
    secs = len(a.samples) / a.sample_rate
    print(f"{key}: {secs:.2f}s audio in {took:.2f}s -> {out}")
