"""Draws ESC/POS printer bytes as a picture of the paper slip, to check what a printer would print.
   python3 test/render.py slip.bin out.png [cols]"""
import sys
from PIL import Image, ImageDraw, ImageFont

data = open(sys.argv[1], "rb").read()
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 48
W = 576 if cols >= 48 else 384
CW, CH = W // cols, 24
try:
    FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"; ImageFont.truetype(FONT, 10)
except Exception:
    FONT = None
img = Image.new("L", (W + 40, 20000), 255)
d = ImageDraw.Draw(img)
X0 = 20
y = 10; line = []; align = 0; bold = False; rev = False; sw = sh = 1; buzz = 0; cuts = 0
CP = {0x9C: "£", 0xFA: "·", 0x82: "é", 0x85: "à", 0x97: "ù", 0x95: "ò", 0x8A: "è"}

def font(sz, b):
    if FONT is None: return ImageFont.load_default()
    return ImageFont.truetype(FONT.replace(".ttf", "-Bold.ttf") if b else FONT, sz)

def flush():
    global y, line
    if not line: y += CH; return
    h = max(s[3] for s in line) * CH
    w = sum(len(s[0]) * CW * s[2] for s in line)
    x = X0 + (0 if align == 0 else (W - w) // 2 if align == 1 else W - w)
    for t, b, a, bb, r in line:
        f = font(int(CH * 0.85), b)
        for ch in t:
            cw = CW * a
            if r: d.rectangle([x, y, x + cw, y + h], fill=0)
            tmp = Image.new("L", (CW, CH), 255); ImageDraw.Draw(tmp).text((0, 0), ch, font=f, fill=0)
            tmp = tmp.resize((cw, CH * bb))  # double width / height
            if r: tmp = Image.eval(tmp, lambda v: 255 - v)
            img.paste(tmp, (x, y + h - CH * bb))
            x += cw
    y += h; line = []

i = 0
while i < len(data):
    b = data[i]
    if b == 0x1B:
        c = data[i + 1]
        if c == 0x40: i += 2; continue
        if c == 0x74: i += 3; continue
        if c == 0x61: align = data[i + 2]; i += 3; continue
        if c == 0x45: bold = data[i + 2] == 1; i += 3; continue
        if c == 0x47: i += 3; continue
        if c == 0x64: flush(); y += CH * (data[i + 2] - 1); i += 3; continue
        if c == 0x4A: flush(); y += data[i + 2]; i += 3; continue
        if c == 0x42: buzz += 1; i += 4; continue
        i += 2; continue
    if b == 0x1D:
        c = data[i + 1]
        if c == 0x21: n = data[i + 2]; sw, sh = (n >> 4) + 1, (n & 15) + 1; i += 3; continue
        if c == 0x42: rev = data[i + 2] == 1; i += 3; continue
        if c == 0x56: flush(); d.line([X0, y + 6, X0 + W, y + 6], fill=0, width=1); d.text((X0 + W - 60, y + 8), "✂ cut", fill=0); y += 30; cuts += 1; i += 4; continue
        if c == 0x76:
            if line: flush()
            bpr = data[i + 4] | (data[i + 5] << 8); h = data[i + 6] | (data[i + 7] << 8)
            px = data[i + 8:i + 8 + bpr * h]
            for yy in range(h):
                for bx in range(bpr):
                    v = px[yy * bpr + bx]
                    if v:
                        for bit in range(8):
                            if v & (0x80 >> bit): img.putpixel((X0 + bx * 8 + bit, y + yy), 0)
            y += h; i += 8 + bpr * h; continue
        if c == 0x28 and data[i + 2] == 0x6B:
            pl = data[i + 3] | (data[i + 4] << 8); fn = data[i + 6]
            if fn == 0x50: qrtext = data[i + 8:i + 3 + 2 + pl].decode("utf8", "replace")
            if fn == 0x51:
                flush(); s = 150; x = X0 + (W - s) // 2
                d.rectangle([x, y, x + s, y + s], outline=0, width=4); d.text((x + 10, y + s // 2 - 6), "QR: " + qrtext[:18], fill=0); y += s + 4
            i += 5 + pl; continue
        i += 2; continue
    if b == 0x0A: flush(); i += 1; continue
    ch = chr(b) if 32 <= b < 127 else CP.get(b, "?")
    if line and line[-1][1:] == (bold, sw, sh, rev): line[-1] = (line[-1][0] + ch,) + line[-1][1:]
    else: line.append((ch, bold, sw, sh, rev))
    i += 1
flush()
img = img.crop((0, 0, W + 40, y + 20))
img.save(sys.argv[2])
print(f"{sys.argv[2]}: {y}px tall, buzz={buzz}, cuts={cuts}")
