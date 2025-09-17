
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remove off-white border connected to the edges while preserving interior whites.
Samples edge background color and flood-fills only pixels within a small
color distance of that background. This avoids deleting pure-white interior
graphics (e.g., route lines, sun, etc.).

Usage:
  python remove_border_preserve_white.py input.png output.png [--crop] [--th 12]

Args:
  input.png   Path to source PNG/JPG
  output.png  Path to result PNG (RGBA with transparency where border was)
Options:
  --crop      Additionally crops canvas to the non-transparent content.
  --th N      Color distance threshold (0-441). Default 12 is conservative.
"""
import sys, argparse
from PIL import Image
import numpy as np
from collections import deque

def parse_args():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('inp')
    p.add_argument('out')
    p.add_argument('--crop', action='store_true')
    p.add_argument('--th', type=float, default=12.0)
    p.add_argument('--pad', type=int, default=0, help='Extra pixels of padding after crop')
    p.add_argument('-h','--help', action='help')
    return p.parse_args()

def sample_edge_color(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    # Take small strips from the four edges and average
    strip = 8
    samples = []
    samples.append(rgb[0:strip, :, :].reshape(-1,3))
    samples.append(rgb[h-strip:h, :, :].reshape(-1,3))
    samples.append(rgb[:, 0:strip, :].reshape(-1,3))
    samples.append(rgb[:, w-strip:w, :].reshape(-1,3))
    s = np.concatenate(samples, axis=0).astype(np.float32)
    return s.mean(axis=0)  # float32 length-3

def remove_border(inp_path, out_path, th=12.0, crop=False, pad=0):
    im = Image.open(inp_path).convert('RGBA')
    arr = np.array(im)
    h, w = arr.shape[:2]
    rgb = arr[..., :3].astype(np.float32)

    bg = sample_edge_color(rgb)  # background "off-white" estimate
    # compute color distance to background
    dist = np.linalg.norm(rgb - bg, axis=-1)

    # Only consider "background-like" pixels: distance <= th
    bg_like = dist <= th

    # Flood-fill from edges over bg_like to get border region
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    # seed from edges
    for x in range(w):
        if bg_like[0, x]:
            visited[0, x] = True; q.append((0, x))
        if bg_like[h-1, x]:
            visited[h-1, x] = True; q.append((h-1, x))
    for y in range(h):
        if bg_like[y, 0]:
            visited[y, 0] = True; q.append((y, 0))
        if bg_like[y, w-1]:
            visited[y, w-1] = True; q.append((y, w-1))

    # 4-connected to reduce diagonal leakage
    for y, x in q:
        pass
    nbrs = [(-1,0),(1,0),(0,-1),(0,1)]
    while q:
        y, x = q.popleft()
        for dy, dx in nbrs:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if bg_like[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))

    # Build new alpha: zero only where visited (true border)
    rgba = arr.copy()
    alpha = rgba[..., 3].copy()
    alpha[visited] = 0
    rgba[..., 3] = alpha

    out = Image.fromarray(rgba, 'RGBA')

    if crop:
        nz = np.argwhere(alpha > 0)
        if nz.size > 0:
            ymin, xmin = nz.min(axis=0)
            ymax, xmax = nz.max(axis=0)
            xmin = max(0, xmin - pad)
            ymin = max(0, ymin - pad)
            xmax = min(w-1, xmax + pad)
            ymax = min(h-1, ymax + pad)
            out = out.crop((xmin, ymin, xmax+1, ymax+1))

    out.save(out_path, optimize=True)

if __name__ == "__main__":
    args = parse_args()
    remove_border(args.inp, args.out, th=args.th, crop=args.crop, pad=args.pad)
