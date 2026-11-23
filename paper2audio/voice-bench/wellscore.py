import sys, os, json, glob
os.environ["LINESET"] = ""
import check
from asr import errors
LS = ["Well, I suppose that settles it.", "Well. That was unexpected.", "Well done, she said, and smiled."]
for d in sys.argv[1:]:
    res = check.check(d); bad = [0,0,0]; extra = 0
    for k, x in res.items():
        i = int(k[:-4].split("_")[1]); s, dd, ii, n = errors(LS[i], x["heard"]); bad[i] += (s+dd+ii) > 0; extra += ii
    print(d, "bad lines per test line:", bad, "extra words:", extra, "of", len(res), "lines")
