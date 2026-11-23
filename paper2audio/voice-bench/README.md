# Copied-voice test bench (the "20-voice test")

Runs the app's copied-voice recipe (a Python port of `LocalTts` / `CloneCheck`) with the same Pocket TTS
engine (sherpa-onnx 1.13.8) on the 20 ready-made readers, then checks every line with a speech recogniser
(Moonshine) for skipped, extra (repeated) and wrong words, plus pitch movement. Listen to the WAVs too: the
numbers catch repeats and skips, not how a voice sounds.

Setup (about 600 MB, into `~/p2a-models` or `$P2A_MODELS`):

    pip install sherpa-onnx==1.13.8 numpy soundfile && pip install --no-deps num2words
    # from github.com/k2-fsa/sherpa-onnx/releases: tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2,
    # asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2 (unpack both into the models folder); ffmpeg

Run (4 cores: about 25 minutes per recipe for 20 readers × 18 lines):

    python3 run.py recipe_old base                       # the recipe before 6.9.14
    SPLIT=1 LIVELY=0.7 python3 run.py recipe_v2 new   # the current recipe
    python3 check.py base new                            # word errors, problem lines per test line
    LINESET=emo ...                                      # the 10 emotional lines instead
    python3 ltas.py new                                  # brightness of the copies vs the real recordings

Results for 6.9.14 (Nov 2026): word errors 6.1% → 3.9%, extra words 60 → 15 (see HANDOFF-PAPER2AUDIO.md).
