import sys, json, time, os, importlib, re, numpy as np, soundfile as sf
from num2words import num2words
from pipe import load_ref, RATE
recipe = importlib.import_module(sys.argv[1]); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
VOICES = {"emma":64194,"lily":90538,"grace":34312,"isla":4618,"sophie":92620,"daniel":20604,"henry":54287,"oscar":15734,"jack":81386,"arthur":57008,
          "ava":97744,"clara":41723,"maya":56628,"nora":98730,"rose":6471,"leo":31250,"sam":84032,"theo":31800,"ethan":92573,"ryan":41746}
LINES = [
 "Where have you been? she asked, smiling.",
 "Stop! he cried, and the whole room fell silent.",
 "No.",
 "I can't believe it, she whispered.",
 "We won! We actually won!",
 "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.",
 "Thirty, thirty, thirty-one, he counted under his breath.",
 "Well, I suppose that settles it.",
 "In 1984, about 2,500 people lived in the village, and the rent was 350 dollars a month.",
 "The meeting is on the 21st at 10:30, in room 4.",
 "Chapter Seven.",
 "Honestly, I think those stormy evenings were my favorite.",
 "Are you sure? Absolutely sure?",
 "He paused. Then, very slowly, he opened the door.",
 "The results were clear: the treatment reduced symptoms by 42 percent.",
 "Oh no, oh no, oh no!",
 "Yes.",
 "She looked at him for a long moment, and then, without a word, she turned and walked away into the rain.",
]
EMO = [
 "Get out! Get out of my house!",
 "Really? You came all this way just to see me?",
 "I'm so sorry, she said softly. I never meant to hurt you.",
 "Run! They're coming!",
 "We won! We actually won!",
 "Are you sure? Absolutely sure?",
 "Stop! he cried, and the whole room fell silent.",
 "Where have you been? she asked, smiling.",
 "How could you do this to me?",
 "That's wonderful news, I'm so happy for you!",
]
if os.environ.get("LINESET") == "emo": LINES = EMO
def spell(t):
    t = t.replace(",", " , ")
    t = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: num2words(int(m.group(1)), to="ordinal"), t)
    t = re.sub(r"(\d+):(\d\d)", lambda m: num2words(int(m.group(1))) + " " + num2words(int(m.group(2))), t)
    t = re.sub(r"\b(1[1-9]\d\d)\b", lambda m: num2words(int(m.group(1)), to="year"), t)
    t = re.sub(r"\d+(?: , \d{3})*", lambda m: num2words(int(m.group(0).replace(" , ", ""))), t)
    return t.replace(" , ", ", ").replace("$", "")
res = []
for v, seed in VOICES.items():
    if only and v not in only: continue
    ref = None
    for i, line in enumerate(LINES):
        if os.environ.get("IDX") and str(i) not in os.environ["IDX"].split(","): continue
        f = f"{out}/{v}_{i:02d}.wav"
        if os.path.exists(f) and os.path.exists(f + ".meta"): continue
        if ref is None: ref = load_ref(v)
        t = time.time(); a, takes = recipe.synth(line, ref, seed); dt = time.time() - t
        sf.write(f, a, RATE); open(f + ".meta", "w").write(json.dumps(dict(gen=dt, takes=takes)))
        print(v, i, f"{dt:.1f}s", flush=True)
print("SYNTH DONE", flush=True)
