import os, sys, json, soundfile as sf, numpy as np
from pipe import *
from recipe_v2 import cut_at_pause
VOICES = {"emma":64194,"lily":90538,"grace":34312,"isla":4618,"sophie":92620,"daniel":20604,"henry":54287,"oscar":15734,"jack":81386,"arthur":57008,
          "ava":97744,"clara":41723,"maya":56628,"nora":98730,"rose":6471,"leo":31250,"sam":84032,"theo":31800,"ethan":92573,"ryan":41746}
W = sys.argv[1]; out = f"well_{W}"; os.makedirs(out, exist_ok=True)
LS = ["Well, I suppose that settles it.", "Well. That was unexpected.", "Well done, she said, and smiled."]
for v, seed in VOICES.items():
    ref = load_ref(v); lead = end_on_pause(cut_at_pause(ref, RATE, 30*RATE-RATE//10)); hears = (len(lead)+RATE-1)//RATE
    for i, t in enumerate(LS):
        sp = prepare_text(end_sentence(t))
        def take(sd):
            led = gen(" "*8 + f"{W}. " + sp.strip(), lead, sd, 12, spoken=sp, hears=hears)
            c = after_lead_in(led, RATE)
            return led[c:] if c is not None else gen(sp, lead, sd, spoken=sp, hears=hears)
        a = take(seed); b = take(seed+7919)
        a = a if distance(len(a)/RATE, sp.strip()) <= distance(len(b)/RATE, sp.strip()) else b
        sf.write(f"{out}/{v}_{i:02d}.wav", a, RATE); open(f"{out}/{v}_{i:02d}.wav.meta","w").write("{}")
