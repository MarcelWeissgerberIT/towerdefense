#!/usr/bin/env python3
"""Packs rendered frames (tools/render/render.mjs output) into WebP sprite sheets + models.json.

  python3 tools/render/pack.py <frames_dir> <assets/models> [name ...]
"""
import glob
import json
import os
import sys

from PIL import Image, ImageChops, ImageFilter


def soft_shadow(d_path, a_path, scale):
    """Key-light shadow (lightly blurred) combined with a wide contact shadow, as an alpha mask."""
    d = Image.open(d_path).getchannel('A').filter(ImageFilter.GaussianBlur(2.2 * scale))
    a = Image.open(a_path).getchannel('A').filter(ImageFilter.GaussianBlur(7 * scale))
    d = d.point(lambda v: int(v * 0.62))
    a = a.point(lambda v: int(v * 0.55))
    # screen-combine: 1 - (1-d)(1-a)
    return ImageChops.screen(d, a)

src, dst = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
os.makedirs(dst, exist_ok=True)
meta_path = os.path.join(dst, 'models.json')
allmeta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}

for d in sorted(glob.glob(os.path.join(src, '*'))):
    name = os.path.basename(d)
    if only and name not in only:
        continue
    mp = os.path.join(d, 'meta.json')
    if not os.path.exists(mp):
        continue
    meta = json.load(open(mp))
    frames = [Image.open(f).convert('RGBA') for f in sorted(glob.glob(os.path.join(d, 'f*.png')))]
    base = Image.open(os.path.join(d, 'base.png')).convert('RGBA') if os.path.exists(os.path.join(d, 'base.png')) else None
    shadows = []
    for i in range(len(frames)):
        sd, sa = os.path.join(d, f's{i:02d}_d.png'), os.path.join(d, f's{i:02d}_a.png')
        if os.path.exists(sd):
            m = soft_shadow(sd, sa, (meta.get('P') or 128) / 128)
            sh = Image.new('RGBA', m.size, (8, 6, 4, 0))
            sh.putalpha(m)
            shadows.append(sh)
    # union bbox of all frames (+ base) to trim empty margins uniformly
    box = None
    for im in frames + ([base] if base else []):
        b = im.getchannel('A').point(lambda v: 255 if v > 6 else 0).getbbox()
        if not b:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - 2), max(0, y0 - 2)
    x1, y1 = min(frames[0].width, x1 + 2), min(frames[0].height, y1 + 2)
    w, h = x1 - x0, y1 - y0
    n = len(frames)
    cols = meta.get('af') or (8 if n >= 8 else n)
    rows = (n + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * w, rows * h), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        sheet.paste(im.crop((x0, y0, x1, y1)), ((i % cols) * w, (i // cols) * h))
    sheet.save(os.path.join(dst, f'{name}.webp'), 'WEBP', quality=88, method=6)
    shadow_meta = None
    if shadows:
        # shadows get their own trimmed box (they extend away from the light)
        sb = None
        for im in shadows:
            b = im.getchannel('A').point(lambda v: 255 if v > 3 else 0).getbbox()
            if b:
                sb = b if sb is None else (min(sb[0], b[0]), min(sb[1], b[1]), max(sb[2], b[2]), max(sb[3], b[3]))
        sx0, sy0, sx1, sy1 = sb
        sw, shh = sx1 - sx0, sy1 - sy0
        ss = Image.new('RGBA', (cols * sw, rows * shh), (0, 0, 0, 0))
        for i, im in enumerate(shadows):
            ss.paste(im.crop((sx0, sy0, sx1, sy1)), ((i % cols) * sw, (i // cols) * shh))
        ss.save(os.path.join(dst, f'{name}_shadow.webp'), 'WEBP', quality=80, method=6)
        shadow_meta = {'w': sw, 'h': shh, 'ax': round(meta['anchor'][0] - sx0, 2), 'ay': round(meta['anchor'][1] - sy0, 2)}
    out = {
        'w': w, 'h': h, 'n': n, 'cols': cols,
        'ax': round(meta['anchor'][0] - x0, 2), 'ay': round(meta['anchor'][1] - y0, 2),
        'P': meta.get('P'),
    }
    if meta.get('af'):
        out['af'] = meta['af']
    if shadow_meta:
        out['shadow'] = shadow_meta
    if base:
        base.crop((x0, y0, x1, y1)).save(os.path.join(dst, f'{name}_base.webp'), 'WEBP', quality=88, method=6)
        out['base'] = True
        out['muzzles'] = [[round(m[0], 1), round(m[1], 1)] for m in meta['muzzles']]
        out['cut'] = round(meta['cutPx'], 1)
    if 'center' in meta:
        out['center'] = [round(v, 1) for v in meta['center']]
        out['top'] = [round(v, 1) for v in meta['top']]
    allmeta[name] = out
    kb = os.path.getsize(os.path.join(dst, f'{name}.webp')) // 1024
    print(f'{name}: {n} frames {w}x{h} sheet {sheet.width}x{sheet.height} {kb} KB')

json.dump(allmeta, open(meta_path, 'w'), indent=1, sort_keys=True)
