import os, re
from pipe import *
SPLIT = os.environ.get("SPLIT", "1") == "1"
LIVELY = float(os.environ.get("LIVELY", "0"))  # temperature for exclamations/questions; 0 = off

def cut_at_pause(x, rate, limit):
    """The sample up to [limit] samples, ending at the last pause (120 ms or more, 30 dB under the
    speech) in its final 8 s, so it never stops in the middle of a word."""
    if len(x) <= limit:
        pass
    frame = rate // 50
    n = min(len(x), limit) // frame
    e = rms_frames(x[:n*frame], frame)
    if len(e) == 0: return x[:limit]
    loud = np.sort(e)[int(len(e)*.9)]
    quiet = loud * 10**(-30/20)
    # already ends in quiet (the whole clip fits and trails off): as it is
    if len(x) <= limit and e[-6:].max() < quiet: return x
    lo = max(0, n - 8*50)
    f = n - 1
    while f >= lo:
        if e[f] < quiet:
            s = f
            while s > lo and e[s-1] < quiet: s -= 1
            if f - s + 1 >= 6 and s * frame >= 4 * rate:
                return x[:(s + 3) * frame]   # keep 60 ms into the pause
            f = s - 1
        else: f -= 1
    return x[:limit]

WORD = re.compile(r"[A-Za-z0-9']+")
def repeats(t):
    """As the app's CloneCheck.repeatsPhrase: a word twice in a row, or two clauses opening with the same two words."""
    w = [x.lower() for x in WORD.findall(t)]
    if any(w[i] == w[i+1] for i in range(len(w) - 1)): return True
    st = [tuple(WORD.findall(c.lower())[:2]) for c in t.split(",")]; st = [x for x in st if len(x) == 2]
    return len(st) != len(set(st))

EXSPLIT = os.environ.get("EXSPLIT", "0") == "1"
def parts(text):
    """Lines that repeat a phrase, cut at commas into parts read one by one."""
    if EXSPLIT and re.search(r"[!?]\s+[a-z]", text):
        ps = [p for p in re.split(r"(?<=[!?])\s+(?=[a-z])", text) if p.strip()]
        if len(ps) > 1: return ps
    if not SPLIT or not repeats(text): return [text]
    ps = [p.strip() for p in re.split(r"(?<=,)\s+", text) if p.strip()]
    # join scraps so no part is under 3 words, unless the repeats are that short
    out = []
    for p in ps:
        if out and len(WORD.findall(out[-1])) < 2: out[-1] += " " + p
        else: out.append(p)
    return out if len(out) > 1 else [text]

def one(text, lead, hears, seed, pace, lead_in, temp):
    spoken = prepare_text(end_sentence(text))
    def take(sd):
        if not lead_in: return gen(spoken, lead, sd, spoken=spoken, hears=hears, temp=temp)
        w = "Right. " if STARTS_WELL.search(spoken.strip()) else "Well. "
        led = gen(" "*8 + w + spoken.strip(), lead, sd, 12, spoken=spoken, hears=hears, temp=temp)
        cut = after_lead_in(led, RATE)
        return led[cut:] if cut is not None else gen(spoken, lead, sd, spoken=spoken, hears=hears, temp=temp)
    first = take(seed); k = 1
    if not risky(spoken) and plausible(len(first)/RATE, spoken.strip(), pace): out = first
    else:
        second = take(seed+7919); k = 2
        out = second if distance(len(second)/RATE, spoken.strip(), pace) < distance(len(first)/RATE, spoken.strip(), pace) else first
    return runon_trim(out, RATE, text, pace), k

def synth(text, ref_raw, seed, pace=None, lead_in=True, lp=False):
    room = 30*RATE - RATE//10
    lead = end_on_pause(cut_at_pause(ref_raw, RATE, room)); hears = (len(lead)+RATE-1)//RATE
    temp = str(LIVELY) if LIVELY and re.search(r"[!?]", text) else "0.6"
    ps = parts(text); outs = []; takes = 0
    for j, p in enumerate(ps):
        # a part cut at a comma keeps a comma's pause, not a full stop
        a, k = one(p, lead, hears, seed, pace, lead_in, temp); takes += k
        outs.append(a)
        if j < len(ps) - 1: outs.append(np.zeros(int(RATE*0.18), np.float32))
    out = np.concatenate(outs)
    if os.environ.get("CRISP") == "1":
        from crisp import crisp
        out = crisp(out, RATE)
    return dehiss(out, RATE, lp), takes
