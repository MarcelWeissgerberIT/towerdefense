#!/usr/bin/env python3
"""Asset pipeline for Iron Sentinel.

Takes the raw OpenArt renders (white background PNGs) and turns them into
game-ready sprites:

  * removes the white studio background (border flood fill + enclosed holes)
  * soft, de-haloed alpha edges (un-premultiplies the white matte)
  * trims, optionally mirrors, scales and stores as WebP with alpha

Ground / road textures are made seamlessly tileable with an offset cross-fade.

Usage:
  python3 tools/process_assets.py <raw_dir> <out_dir>

The list of source images and their OpenArt URLs lives in tools/sources.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent


def remove_white_bg(img: Image.Image, thresh=26, hole_min=90, hole_d=7, color=(255, 255, 255)):
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    bgc = np.array(color, dtype=np.int16)
    # distance of each pixel from the flat background colour
    d = np.abs(rgb - bgc).max(axis=2).clip(0, 255)
    work = Image.fromarray(np.minimum(d, 200).astype(np.uint8), "L")

    # flood fill background from the border
    seeds = []
    for x in range(0, w, 8):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, 8):
        seeds += [(0, y), (w - 1, y)]
    arr = np.asarray(work)
    for (x, y) in seeds:
        if arr[y, x] <= thresh // 2 and work.getpixel((x, y)) != 255:
            ImageDraw.floodfill(work, (x, y), 255, thresh=thresh)
    arr = np.array(work)
    bg = arr == 255

    # enclosed white holes (gaps between legs/arms that don't touch the border)
    cand = (d <= hole_d) & (~bg)
    ys, xs = np.nonzero(cand)
    visited = np.zeros_like(cand)
    for y, x in zip(ys[::3], xs[::3]):
        if visited[y, x]:
            continue
        tmp = work.copy()
        ImageDraw.floodfill(tmp, (int(x), int(y)), 254, thresh=hole_d)
        comp = np.asarray(tmp) == 254
        visited |= comp
        if comp.sum() >= hole_min:
            bg |= comp

    # soft alpha around the background boundary
    bg_img = Image.fromarray((bg * 255).astype(np.uint8), "L")
    near = np.asarray(bg_img.filter(ImageFilter.MaxFilter(5))) > 0
    alpha = np.where(bg, 0.0, 1.0)
    edge = near & ~bg
    a_edge = np.clip((d.astype(np.float32) - 4) / 60.0, 0, 1)
    alpha = np.where(edge, np.minimum(alpha, a_edge), alpha)

    # un-premultiply the white matte from edge pixels
    a3 = np.maximum(alpha, 1e-3)[..., None]
    col = (rgb.astype(np.float32) - (1 - alpha[..., None]) * bgc.astype(np.float32)) / a3
    col = np.clip(col, 0, 255)
    if tuple(color) == (255, 0, 255):
        # magenta despill: remove the part of R and B that exceeds G on both channels
        m = np.clip(np.minimum(col[..., 0], col[..., 2]) - col[..., 1], 0, None)
        col[..., 0] -= m
        col[..., 2] -= m
    out = np.dstack([col, alpha[..., None] * 255]).astype(np.uint8)
    res = Image.fromarray(out, "RGBA")
    # light 1px erosion of the alpha to kill remaining fringe
    a = res.getchannel("A").filter(ImageFilter.MinFilter(3))
    a = Image.fromarray(np.maximum(np.asarray(a), (np.asarray(res.getchannel("A")) * 0.35).astype(np.uint8)))
    res.putalpha(a)
    return res


def trim(img: Image.Image, pad=6):
    a = np.asarray(img.getchannel("A"))
    ys, xs = np.nonzero(a > 10)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    box = (max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad + 1), min(img.height, y1 + pad + 1))
    return img.crop(box)


def make_seamless(img: Image.Image, size=1024):
    im = img.convert("RGB").resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    rolled = np.roll(np.roll(a, size // 2, axis=0), size // 2, axis=1)
    t = np.linspace(0, 1, size)
    # weight: 1 in the centre, 0 at the borders (smooth)
    wv = np.clip(np.minimum(t, 1 - t) * 2 / 0.6, 0, 1)
    wv = wv * wv * (3 - 2 * wv)
    w2 = np.minimum.outer(wv, wv)[..., None]
    out = a * w2 + rolled * (1 - w2)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGB")


def main():
    raw = Path(sys.argv[1])
    out = Path(sys.argv[2])
    only = set(sys.argv[3:])
    cfg = json.loads((HERE / "sources.json").read_text())
    manifest_path = out / "sprites" / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for name, spec in cfg["sprites"].items():
        if only and name not in only:
            continue
        src = raw / spec["file"]
        if not src.exists():
            print("missing", src)
            continue
        img = Image.open(src)
        cut = trim(remove_white_bg(img, **spec.get("bg", {})))
        if spec.get("mirror"):
            cut = cut.transpose(Image.FLIP_LEFT_RIGHT)
        target = spec.get("size", 320)
        s = target / max(cut.width, cut.height)
        if s < 1:
            cut = cut.resize((round(cut.width * s), round(cut.height * s)), Image.LANCZOS)
        dst = out / "sprites" / f"{name}.webp"
        cut.save(dst, "WEBP", quality=spec.get("q", 86), method=6)
        manifest[name] = {"w": cut.width, "h": cut.height}
        print(f"{name}: {cut.width}x{cut.height} -> {dst.stat().st_size // 1024} KB")
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))

    for name, spec in cfg.get("textures", {}).items():
        if only and name not in only:
            continue
        src = raw / spec["file"]
        if not src.exists():
            print("missing", src)
            continue
        tex = make_seamless(Image.open(src), spec.get("size", 1024))
        dst = out / "tex" / f"{name}.jpg"
        tex.save(dst, "JPEG", quality=spec.get("q", 82), optimize=True, progressive=True)
        print(f"{name}: texture -> {dst.stat().st_size // 1024} KB")

    for name, spec in cfg.get("images", {}).items():
        if only and name not in only:
            continue
        src = raw / spec["file"]
        if not src.exists():
            print("missing", src)
            continue
        im = Image.open(src).convert("RGB")
        w = spec.get("width", 1600)
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        dst = out / f"{name}.jpg"
        im.save(dst, "JPEG", quality=spec.get("q", 80), optimize=True, progressive=True)
        print(f"{name}: image -> {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
