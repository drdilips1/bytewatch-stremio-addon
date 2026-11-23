import math, numpy as np
def shelf_coefs(rate, fc, gain_db, q=0.707):
    """RBJ high shelf."""
    A = 10**(gain_db/40); w = 2*math.pi*fc/rate; cw, sw = math.cos(w), math.sin(w); al = sw/(2*q); s = 2*math.sqrt(A)*al
    b0 = A*((A+1)+(A-1)*cw+s); b1 = -2*A*((A-1)+(A+1)*cw); b2 = A*((A+1)+(A-1)*cw-s)
    a0 = (A+1)-(A-1)*cw+s; a1 = 2*((A-1)-(A+1)*cw); a2 = (A+1)-(A-1)*cw-s
    return [b0/a0, b1/a0, b2/a0, a1/a0, a2/a0]
def biquad(x, c):
    b0,b1,b2,a1,a2 = c; y = np.empty_like(x); x1=x2=y1=y2=0.0
    for i, v in enumerate(x):
        o = b0*v + b1*x1 + b2*x2 - a1*y1 - a2*y2; x2=x1; x1=v; y2=y1; y1=o; y[i]=o
    return y
def crisp(x, rate, gain_db=3.5, fc=4500):
    y = biquad(x.astype(np.float64), shelf_coefs(rate, fc, gain_db)).astype(np.float32)
    pk = np.abs(y).max()
    return y * (0.99/pk) if pk > 0.99 else y
