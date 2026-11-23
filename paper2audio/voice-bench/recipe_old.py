from pipe import *
def synth(text, ref_raw, seed, pace=None, lead_in=True, lp=False):
    room = 30*RATE - RATE//10
    lead = end_on_pause(ref_raw[:room]); hears = (len(lead)+RATE-1)//RATE
    spoken = prepare_text(end_sentence(text))
    def take(sd):
        if not lead_in: return gen(spoken, lead, sd, spoken=spoken, hears=hears)
        led = gen(" "*8 + "Well. " + spoken.strip(), lead, sd, 12, spoken=spoken, hears=hears)
        cut = after_lead_in(led, RATE)
        return led[cut:] if cut is not None else gen(spoken, lead, sd, spoken=spoken, hears=hears)
    first = take(seed); takes = 1
    if not risky(spoken) and plausible(len(first)/RATE, spoken.strip(), pace): out = first
    else:
        second = take(seed+7919); takes = 2
        out = second if distance(len(second)/RATE, spoken.strip(), pace) < distance(len(first)/RATE, spoken.strip(), pace) else first
    out = dehiss(runon_trim(out, RATE, text, pace), RATE, lp)
    return out, takes
