import os, glob, numpy as np, soundfile as sf
V = "emma lily grace isla daniel henry oscar theo".split()
def wsola2(x, r, frame=960, tol=240):
    """Finer WSOLA: 40 ms frames, normalised correlation at every sample."""
    hop = frame // 2; win = np.hanning(frame).astype(np.float32)
    n_out = int(len(x) / r); out = np.zeros(n_out + frame, np.float32); norm = np.zeros_like(out)
    xp = np.concatenate([np.zeros(tol, np.float32), x, np.zeros(2*frame + 2*tol, np.float32)])
    prev = None; k = 0
    while k * hop < n_out:
        c = min(int(k * hop * r) + tol, len(xp) - frame - hop - 1)
        if prev is None: best = c
        else:
            t = xp[prev + hop: prev + hop + frame]
            lo = max(0, c - tol); hi = min(len(xp) - frame - hop - 1, c + tol)
            seg = np.lib.stride_tricks.sliding_window_view(xp[lo:hi + frame], frame)
            sc = (seg @ t) / (np.sqrt((seg * seg).sum(1)) + 1e-6)
            best = lo + int(np.argmax(sc))
        out[k*hop:k*hop+frame] += xp[best:best+frame] * win; norm[k*hop:k*hop+frame] += win
        prev = best; k += 1
    norm[norm < 1e-3] = 1
    return (out / norm)[:n_out]
