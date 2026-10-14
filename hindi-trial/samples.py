"""Trial: Jugnu Pocket TTS (Hindi/Hinglish/English voice copying) - make listening samples."""
import glob, os, time, traceback
import soundfile as sf

OUT = "out"
os.makedirs(OUT, exist_ok=True)

LINES = {
    "hindi_greeting": "नमस्ते! आज हम एक नई कहानी पढ़ेंगे।",
    "hindi_story": "एक छोटे से गाँव में एक बूढ़ा किसान रहता था। हर सुबह वह सूरज निकलने से पहले अपने खेतों में चला जाता था, और शाम को थककर लौटता था।",
    "hinglish": "मैंने अपना laptop restart किया और फिर meeting join की।",
    "english": "Hello. This is the Hindi voice engine, reading a sentence in English.",
}

refs = sorted(glob.glob("refs/*.wav"))
print("reference clips:", refs)

from jugnu_tts import Jugnu

for size in ["lite", "base"]:
    try:
        t0 = time.time()
        tts = Jugnu(size)
        print(f"[{size}] loaded in {time.time() - t0:.1f}s")
    except Exception:
        traceback.print_exc()
        continue
    for ref in refs:
        rname = os.path.splitext(os.path.basename(ref))[0]
        try:
            voice = tts.clone(ref)
        except Exception:
            traceback.print_exc()
            continue
        for key, text in LINES.items():
            out = f"{OUT}/{size}_{rname}_{key}.wav"
            try:
                t0 = time.time()
                tts.speak(text, voice, out=out)
                info = sf.info(out)
                took = time.time() - t0
                print(f"[{size}] {rname} {key}: {info.duration:.2f}s audio in {took:.2f}s ({info.duration / max(took, 1e-6):.1f}x real time)")
            except Exception:
                traceback.print_exc()
