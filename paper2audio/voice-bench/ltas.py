import glob, numpy as np, soundfile as sf
from pipe import load_ref, RATE
EDGES = [100, 250, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 12000]
def ltas(x):
    n = 1024; hop = 512
    fr = np.stack([x[i:i+n]*np.hanning(n) for i in range(0, len(x)-n, hop)])
    e = (fr**2).mean(1); fr = fr[e > np.percentile(e, 40)]   # speech frames only
    sp = (np.abs(np.fft.rfft(fr, axis=1))**2).mean(0); f = np.fft.rfftfreq(n, 1/RATE)
    b = np.array([sp[(f >= EDGES[k]) & (f < EDGES[k+1])].mean() for k in range(len(EDGES)-1)])
    db = 10*np.log10(b); return db - db[2]   # relative to 500-1000 Hz
if __name__ == "__main__":
    import sys
    d = sys.argv[1]
    print("band edges:", EDGES)
    allv = []
    for v in sorted({p.split('/')[-1].split('_')[0] for p in glob.glob(f"{d}/*.wav")}):
        fs = sorted(glob.glob(f"{d}/{v}_*.wav"))
        if len(fs) < 18: continue
        y = np.concatenate([sf.read(f, dtype='float32')[0] for f in fs])
        diff = ltas(y) - ltas(load_ref(v)); allv.append(diff)
        print(f"{v:7s}", " ".join(f"{x:+5.1f}" for x in diff))
    print("mean   ", " ".join(f"{x:+5.1f}" for x in np.mean(allv, 0)))
