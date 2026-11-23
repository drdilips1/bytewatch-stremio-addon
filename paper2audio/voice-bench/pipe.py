"""Port of LocalTts' copied-voice recipe (Android), for measuring changes offline."""
import math, re, subprocess, numpy as np, sherpa_onnx as so

import os
M = os.environ.get("P2A_MODELS", os.path.expanduser("~/p2a-models"))
VOICES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../android/app/src/main/assets/voices")
RATE = 24000

_tts = None
def tts():
    global _tts
    if _tts is None:
        p = f"{M}/sherpa-onnx-pocket-tts-int8-2026-01-26"
        mc = so.OfflineTtsModelConfig()
        mc.pocket = so.OfflineTtsPocketModelConfig(f"{p}/lm_flow.int8.onnx", f"{p}/lm_main.int8.onnx", f"{p}/encoder.onnx",
                                                   f"{p}/decoder.int8.onnx", f"{p}/text_conditioner.onnx", f"{p}/vocab.json", f"{p}/token_scores.json")
        mc.num_threads = int(__import__("os").environ.get("TH","4"))
        c = so.OfflineTtsConfig(); c.model = mc; c.silence_scale = 1.0
        _tts = so.OfflineTts(c)
    return _tts

def load_ref(vid):
    import os
    f = next(f"{VOICES}/{vid}.{e}" for e in ("wav", "mp3") if os.path.exists(f"{VOICES}/{vid}.{e}"))
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", f, "-t", "32", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()

def end_on_pause(x, rate=RATE):
    frame = rate // 50; n = len(x) // frame
    db = np.array([20 * math.log10(math.sqrt(np.mean(x[f*frame:(f+1)*frame].astype(np.float64)**2)) + 1e-12) for f in range(n)])
    last = max(i for i in range(n) if db[i] > db.max() - 35)
    end = (last + 1) * frame
    out = np.zeros(end + rate * 8 // 100, np.float32); out[:end] = x[:end]
    fade = min(rate // 50, end)
    out[end-fade:end] *= 1 - np.arange(fade) / fade
    return out

def prepare_text(t):
    s = t.strip().replace(';', ',')
    s = re.sub(r'([.!?…])\s*[,;:]', r'\1', s)
    s = re.sub(r'(?<!\d):\s+(?=[A-Z])', '. ', s)
    s = re.sub(r'(?<!\d):(?!\d)', ',', s)
    s = re.sub(r'!\s+(?=[a-z])', ', ', s)
    if not s: return s
    if not s[0].isupper(): s = s[0].upper() + s[1:]
    if len(s.split()) < 5: s = " " * 8 + s
    return s

def end_sentence(t):
    t = t.strip().rstrip(',;—–-').rstrip()
    t = re.sub(r'^(\d+(?:\.\d+)*)\.\s+', r'\1 ', t)
    if t and t[-1] not in '.!?…:;"”\')': t += '.'
    return t

def max_frames(t): return int(min(400, max(25, len(t) * 1.15 + 15)))

def rms_frames(x, frame):
    n = len(x) // frame
    return np.sqrt(np.mean(x[:n*frame].astype(np.float64).reshape(n, frame)**2, axis=1)).astype(np.float32) if n else np.zeros(0, np.float32)

def after_lead_in(x, rate):
    frame = rate // 100; rms = rms_frames(x, frame); n = len(rms)
    if n < 40: return None
    loud = np.sort(rms)[min(n-1, int(n*0.9))]
    onset = next((f for f in range(n-12) if np.sum(rms[f:f+12] > loud*0.2) >= 10), None)
    if onset is None: return None
    quiet = loud * 0.06; f = onset + 15
    while f < min(n, 160):
        if rms[f] < quiet:
            e = f
            while e < n and rms[e] < quiet: e += 1
            if e - f >= 9:
                after = np.sum(rms[e:min(n, e+30)] > loud*0.2)
                return max(0, e-3)*frame if after >= 5 else None
            f = e
        else: f += 1
    return None

STAMMER = re.compile(r'(?i)\b(\w+)\b[\s,.…-]+\1\b'); STARTS_WELL = re.compile(r'(?i)^\W*well\b')
def risky(t): t = t.strip(); return sum(1 for w in t.split() if any(c.isalnum() for c in w)) <= 4 or bool(STAMMER.search(t)) or bool(STARTS_WELL.search(t))
def expected(t, pace=None): return 0.3 + len(t) / (pace or 13.0)
def distance(sec, t, pace=None): return abs(math.log(sec / expected(t, pace)))
def plausible(sec, t, pace=None):
    e = expected(t, pace); r = sec / e
    if r < 0.6: return False
    return r <= 1.75 if pace is None else (r <= 1.4 or sec - e < 0.8)

def runon_trim(s, rate, text, pace=None):
    sec = len(s) / rate
    if pace is None:
        exp = max(1.5, len(text) / 11.0)
        if sec <= exp * 1.5: return s
    else:
        exp = max(1.0, 0.3 + len(text) / pace)
        if sec <= exp * 1.4 or sec - exp < 0.8: return s
    frame = rate // 20
    frm = int(exp * (1.05 if pace is None else 0.9) * rate) // frame; to = len(s) // frame
    if to - frm < 2: return s
    en = np.array([np.mean(s[f*frame:(f+1)*frame].astype(np.float64)**2) for f in range(to)])
    sp = np.sort(en)[min(len(en)-1, int(len(en)*0.7))]
    cut = next((f for f in range(frm, to) if f+1 < to and en[f] < sp*0.02 and en[f+1] < sp*0.02), None)
    if cut is None: cut = frm + int(np.argmin(en[frm:to]))
    return s[:cut*frame]

def lowpass(x, rate, cutoff, taps=31):
    fc = cutoff / rate; m = taps // 2
    k = np.arange(taps) - m
    h = np.where(k == 0, 2*fc, np.sin(2*math.pi*fc*k) / (math.pi*np.where(k == 0, 1, k)))
    h *= 0.54 - 0.46*np.cos(2*math.pi*np.arange(taps)/(taps-1)); h /= h.sum()
    return np.convolve(x, h, mode='same').astype(np.float32)

def dehiss(x, rate, lp=True):
    y = lowpass(x, rate, 7500.0) if lp and rate > 16000 else x.copy()
    frame = rate // 100; rms = rms_frames(y, frame); n = len(rms)
    if n < 5: return y
    loud = np.sort(rms)[min(n-1, int(n*0.9))]; floor = loud*0.03; g = 1.0
    for f in range(n):
        soon = np.any(rms[f:min(n, f+9)] >= floor); target = 1.0 if soon else 0.3
        g = target if target > g else g + (target-g)*0.2
        y[f*frame:(f+1)*frame] *= g
    return y

def gen(say, ref, seed, extra_frames=0, spoken=None, temp="0.6", hears=None):
    c = so.GenerationConfig()
    c.reference_audio = ref.tolist(); c.reference_sample_rate = RATE; c.num_steps = 5; c.silence_scale = 1.0
    c.extra = {"seed": str(seed), "max_reference_audio_len": str(hears), "temperature": temp, "chunk_size": "15",
               "max_frames": str(max_frames((spoken or say).strip()) + extra_frames), "frames_after_eos": "2"}
    a = tts().generate(say, c)
    return np.array(a.samples, np.float32)
