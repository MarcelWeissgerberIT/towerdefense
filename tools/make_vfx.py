#!/usr/bin/env python3
"""Turns an explosion video (black background) into an RGBA sprite sheet.
  python3 tools/make_vfx.py <frames_dir> <out.webp> <first> <last> <count> <size> <cols>
Alpha is derived from brightness and the black matte is un-premultiplied, so the
sheet can be drawn with normal blending (smoke stays visible)."""
import glob, sys
import numpy as np
from PIL import Image
d, out, first, last, count, size, cols = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8])
fs = sorted(glob.glob(d + '/f*.png'))
idx = np.linspace(first, last, count).round().astype(int)
rows = (count + cols - 1) // cols
sheet = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
for k, i in enumerate(idx):
    a = np.asarray(Image.open(fs[i]).convert('RGB').resize((size, size), Image.LANCZOS)).astype(np.float32) / 255
    lum = a.max(axis=2)
    alpha = np.clip((lum - 0.03) * 2.2, 0, 1) ** 0.8
    # fade the frame border so nothing gets clipped hard
    yy, xx = np.mgrid[0:size, 0:size] / (size - 1)
    edge = np.clip(np.minimum.reduce([xx, yy, 1 - xx, 1 - yy]) / 0.08, 0, 1)
    alpha *= edge
    # limited un-premultiply: keeps fire bright but smoke dark and sooty
    rgb = np.clip(a / np.maximum(alpha[..., None], 0.6), 0, 1)
    sat = (a.max(axis=2) - a.min(axis=2))[..., None]
    rgb = rgb * (0.72 + 0.28 * np.clip(sat * 4, 0, 1))
    img = np.dstack([rgb, alpha]) * 255
    sheet.paste(Image.fromarray(img.astype(np.uint8), 'RGBA'), ((k % cols) * size, (k // cols) * size))
sheet.save(out, 'WEBP', quality=78, method=6)
print(out, sheet.size)
