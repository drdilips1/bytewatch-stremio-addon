"""Prototype of the app's emotion shaping: WSOLA tempo + resample pitch + gain."""
import re, numpy as np
RATE = 24000
CUES = [  # priority order
 ("whisper", r"\b(whisper\w*|murmur\w*|breathed|under (?:his|her|their|my|its) breath|(?:said|asked|added|replied) (?:softly|quietly)|hushed)\b"),
 ("shout",   r"\b(shout\w*|yell\w*|scream\w*|roar\w*|bellow\w*|howl\w*|cried out|at the top of (?:his|her|their|my) (?:voice|lungs))\b"),
 ("angry",   r"\b(snapped|snarl\w*|growl\w*|spat|angrily|furiously|irritably|impatiently|fiercely|savagely|hissed)\b"),
 ("sad",     r"\b(sob\w*|wept|weeping|sigh(?:ed|ing)|sadly|mournfully|tearfully|choked|miserably|sorrowfully|wistfully)\b"),
 ("fear",    r"\b(stammer\w*|stutter\w*|trembl\w*|nervously|fearfully|gasp\w*|shakily|whimper\w*|anxiously)\b"),
 ("gentle",  r"\b(gently|softly|quietly|kindly|tenderly|calmly|soothingly)\b"),
 ("happy",   r"\b(laugh\w*|giggl\w*|chuckl\w*|beam\w*|cheerfully|happily|brightly|excitedly|grinn\w*|delightedly|gleefully)\b"),
]
SHAPE = {  # gain dB, tempo, pitch semitones (no pitch: shifting it changed the voice's timbre)
 "whisper": (-6.0, 0.95, 0.0), "shout": (3.0, 1.05, 0.0), "angry": (2.0, 1.04, 0.0), "sad": (-2.0, 0.93, 0.0),
 "fear": (0.0, 1.05, 0.0), "gentle": (-2.0, 0.97, 0.0), "happy": (1.0, 1.03, 0.0),
}
def emotion(text):
    if not re.search("[\"“”]", text): return None
    for name, pat in CUES:
        if re.search(pat, text, re.I): return name
    return None
def wsola(x, r, frame=720, tol=180):
    """Output length = len(x) / r."""
    hop = frame // 2; win = np.hanning(frame).astype(np.float32)
    n_out = int(len(x) / r); out = np.zeros(n_out + frame, np.float32); norm = np.zeros_like(out)
    xp = np.concatenate([np.zeros(tol, np.float32), x, np.zeros(2 * frame + 2 * tol, np.float32)])
    prev = None; k = 0
    while k * hop < n_out:
        c = min(int(k * hop * r) + tol, len(xp) - frame - hop - 1)
        if prev is None: best = c
        else:
            target = xp[prev + hop: prev + hop + frame]
            lo = max(0, c - tol); hi = min(len(xp) - frame - hop - 1, c + tol)
            seg = np.lib.stride_tricks.sliding_window_view(xp[lo:hi + frame], frame)[::4]
            best = lo + 4 * int(np.argmax(seg @ target))
        out[k*hop:k*hop+frame] += xp[best:best+frame] * win; norm[k*hop:k*hop+frame] += win
        prev = best; k += 1
    norm[norm < 1e-3] = 1
    return (out / norm)[:n_out]
def resample(x, f):
    """Length / f (linear)."""
    n = int(len(x) / f); pos = np.arange(n) * f; j = np.minimum(pos.astype(int), len(x)-2); fr = pos - j
    return (x[j] * (1 - fr) + x[j+1] * fr).astype(np.float32)
def shape(x, name):
    if name is None: return x
    g, t, s = SHAPE[name]; f = 2 ** (s / 12)
    y = x
    if abs(t - 1) > 1e-3 or abs(s) > 1e-3:
        y = wsola(y, t / f)
        if abs(s) > 1e-3: y = resample(y, f)
    y = y * 10 ** (g / 20); pk = np.abs(y).max()
    return y * (0.99 / pk) if pk > 0.99 else y

from emo2 import wsola2 as wsola  # the finer stretch
