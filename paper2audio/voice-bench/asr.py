import re, numpy as np, sherpa_onnx as so
from pipe import M, RATE
_r = None
def rec():
    global _r
    if _r is None:
        p = f"{M}/sherpa-onnx-whisper-base.en"
        _r = so.OfflineRecognizer.from_whisper(encoder=f"{p}/base.en-encoder.int8.onnx", decoder=f"{p}/base.en-decoder.int8.onnx",
                                               tokens=f"{p}/base.en-tokens.txt", num_threads=4, language="en", task="transcribe")
    return _r
def hear(x, rate=RATE):
    s = rec().create_stream(); s.accept_waveform(rate, x.tolist()); rec().decode_stream(s); return s.result.text.strip()
def words(t): return re.findall(r"[a-z0-9']+", t.lower().replace("-", " "))
def errors(ref, hyp):
    """Word edit distance split into substitutions, deletions (skipped), insertions (extra/repeated)."""
    r, h = words(ref), words(hyp)
    d = np.zeros((len(r)+1, len(h)+1), int); d[:,0] = range(len(r)+1); d[0,:] = range(len(h)+1)
    for i in range(1, len(r)+1):
        for j in range(1, len(h)+1):
            d[i,j] = min(d[i-1,j]+1, d[i,j-1]+1, d[i-1,j-1]+(r[i-1]!=h[j-1]))
    i, j, S, D, I = len(r), len(h), 0, 0, 0
    while i or j:
        if i and j and d[i,j] == d[i-1,j-1]+(r[i-1]!=h[j-1]): S += r[i-1]!=h[j-1]; i-=1; j-=1
        elif i and d[i,j] == d[i-1,j]+1: D += 1; i -= 1
        else: I += 1; j -= 1
    return S, D, I, len(r)
