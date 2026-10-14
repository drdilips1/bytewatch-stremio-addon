"""Makes Hindi samples from the converted pack with sherpa-onnx (the phone's engine)."""
import inspect, json, os
import numpy as np
import sentencepiece as spm
import sherpa_onnx
import soundfile as sf

P = "pack"
print("sherpa-onnx", getattr(sherpa_onnx, "__version__", "?"))
print("pack:", sorted(os.listdir(P)))


def pick(*names):
    for n in names:
        if os.path.exists(f"{P}/{n}"):
            return f"{P}/{n}"
    raise SystemExit(f"missing in pack: {names}")


# Does sherpa's tokenizer data match SentencePiece's own splitting of Hindi?
sp = spm.SentencePieceProcessor(model_file=f"{P}/tokenizer.model")
print("tokenizer type:", sp.GetPieceSize(), "pieces")
for t in ["नमस्ते! आज हम एक नई कहानी पढ़ेंगे।", "मैंने अपना laptop restart किया।"]:
    print(t, "->", sp.EncodeAsPieces(t))

print("Pocket config fields:", inspect.signature(sherpa_onnx.OfflineTtsPocketModelConfig))
cfg = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
            lm_flow=pick("lm_flow.int8.onnx", "lm_flow.onnx"),
            lm_main=pick("lm_main.int8.onnx", "lm_main.onnx"),
            encoder=pick("encoder.onnx", "encoder.int8.onnx"),
            decoder=pick("decoder.int8.onnx", "decoder.onnx"),
            text_conditioner=pick("text_conditioner.onnx", "text_conditioner.int8.onnx"),
            vocab_json=pick("vocab.json"),
            token_scores_json=pick("token_scores.json"),
        ),
        num_threads=4,
    ),
)
tts = sherpa_onnx.OfflineTts(cfg)
ref, sr = sf.read("refs/voice1.wav", dtype="float32")
if ref.ndim > 1:
    ref = ref.mean(axis=1)
print("GenerationConfig fields:", [f for f in dir(sherpa_onnx.GenerationConfig) if not f.startswith("_")])
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
    a = tts.generate(text, g)
    out = f"out/phone_voice1_{key}.wav"
    sf.write(out, np.array(a.samples, dtype=np.float32), a.sample_rate)
    print(key, "->", out, len(a.samples) / a.sample_rate, "s")
