import sys
from PIL import Image, ImageDraw
N = 1024; S = 4  # draw 4x larger, then shrink (smooth edges)
W = N * S
img = Image.new('RGB', (W, W), '#2F5BEA'); d = ImageDraw.Draw(img)
s = W * 0.46 / 24; ox = W / 2 - 12 * s; oy = W / 2 - 10.5 * s
P = lambda x, y: (ox + x * s, oy + y * s)
white = '#FFFFFF'
# Headband: a ring from (12,10) radius 9 to 7, top half, with straight sides down to y=12.
d.pieslice([*P(3, 1), *P(21, 19)], 180, 360, fill=white)
d.pieslice([*P(5, 3), *P(19, 17)], 180, 360, fill='#2F5BEA')
d.rectangle([*P(3, 10), *P(5, 12)], fill=white); d.rectangle([*P(19, 10), *P(21, 12)], fill=white)
# Ear cups (rounded on the outer bottom corner).
r = 3 * s
for x0, x1 in ((3, 9), (15, 21)):
    d.rounded_rectangle([*P(x0, 12), *P(x1, 20)], radius=r, fill=white)
img.resize((N, N), Image.LANCZOS).save(sys.argv[1])
