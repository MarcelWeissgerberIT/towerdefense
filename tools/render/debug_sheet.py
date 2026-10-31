#!/usr/bin/env python3
"""Contact sheet of rendered frames with the intended facing arrow per frame (for calibrating yaw0)."""
import glob, json, math, sys
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
meta = json.load(open(d + '/meta.json'))
fs = sorted(glob.glob(d + '/f*.png'))
ims = [Image.open(f).convert('RGBA') for f in fs]
w, h = ims[0].size
sc = max(1, 220 // max(w, h))
sheet = Image.new('RGBA', (w * len(ims) * sc, h * sc), (90, 80, 70, 255))
base = Image.open(d + '/base.png').convert('RGBA') if glob.glob(d + '/base.png') else None
ax, ay = meta['anchor']
for i, im in enumerate(ims):
    tile = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if base: tile.alpha_composite(base)
    tile.alpha_composite(im)
    tile = tile.resize((w * sc, h * sc))
    dr = ImageDraw.Draw(tile)
    a = 2 * math.pi * i / meta['N']
    sx, sy = math.cos(a) - math.sin(a), (math.cos(a) + math.sin(a)) / 2
    L = 40 * sc / max(1e-6, math.hypot(sx, sy))
    dr.line([(ax * sc, ay * sc), (ax * sc + sx * L, ay * sc + sy * L)], fill=(0, 255, 0, 255), width=2)
    if 'muzzles' in meta:
        mx, my = meta['muzzles'][i]
        dr.ellipse([(ax + mx) * sc - 4, (ay + my) * sc - 4, (ax + mx) * sc + 4, (ay + my) * sc + 4], outline=(255, 0, 0, 255), width=2)
    dr.text((4, 4), str(i), fill=(255, 255, 0, 255))
    sheet.alpha_composite(tile, (i * w * sc, 0))
sheet.save(out)
