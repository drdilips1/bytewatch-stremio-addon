import sys
from PIL import Image, ImageDraw, ImageFont
U = "/root/.claude/uploads/8cf5236a-09f9-5839-b72c-a3cfc65ab8b3/"
OUT = sys.argv[1]
W, H = 1080, 1920
BG, FG, SUB = (196, 65, 18), (255, 255, 255), (255, 226, 210)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 66)
reg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 38)
# file, crop box (left, top, right, bottom) in the 923x2000 screenshot, title, subtitle
shots = [
    ("ae670381-image.jpg", (0, 85, 923, 1890), "Read along as it speaks", "Each sentence lights up as it's read"),
    ("7d529588-image.jpg", (0, 195, 923, 1890), "Natural voices", "Real readers recorded by people"),
    ("2fa47b44-image.jpg", (0, 195, 923, 1300), "Easy on battery", "Light voices start fast, work offline"),
    ("f154d796-image.jpg", (0, 85, 923, 1600), "All your books in one place", "Books, documents and web pages"),
]
for n, (f, box, title, sub) in enumerate(shots, 1):
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    for text, font, y, col in ((title, bold, 90, FG), (sub, reg, 185, SUB)):
        w = d.textlength(text, font=font)
        d.text(((W - w) / 2, y), text, font=font, fill=col)
    img = Image.open(U + f).convert("RGB")
    k = img.width / 923
    shot = img.crop(tuple(int(v * k) for v in box))
    top, maxw, maxh = 280, W - 120, H - 280 - 60
    s = min(maxw / shot.width, maxh / shot.height)
    shot = shot.resize((int(shot.width * s), int(shot.height * s)), Image.LANCZOS)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=36, fill=255)
    x = (W - shot.width) // 2
    canvas.paste(shot, (x, top), mask)
    canvas.save(f"{OUT}/narrato-{n}.png")
    print(f"{OUT}/narrato-{n}.png", canvas.size)
