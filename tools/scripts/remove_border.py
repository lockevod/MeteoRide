#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remove off-white border connected to the edges while preserving interior whites,
including shapes like a white route that might touch the border.

Usage:
  python remove_border.py input.png output.png [--crop] [--th 12] [--minw 4]

Args:
  input.png   Path to source PNG/JPG
  output.png  Path to result PNG (RGBA with transparency where border was)

Options:
  --crop      Additionally crop canvas to the non-transparent content.
  --th N      Color distance threshold to background (default 12).
  --minw N    Minimum thickness to preserve (default 4). Regions wider than N
              pixels will not be removed, even if connected to border.
"""

import sys, argparse
from PIL import Image
import numpy as np
from collections import deque

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("inp")
    p.add_argument("out")
    p.add_argument("--crop", action="store_true")
    p.add_argument("--th", type=float, default=12.0)
    p.add_argument("--minw", type=int, default=4,
                   help="Minimum thickness to preserve")
    return p.parse_args()

def sample_edge_color(rgb):
    h, w, _ = rgb.shape
    strip = 8
    samples = []
    samples.append(rgb[0:strip, :, :].reshape(-1,3))
    samples.append(rgb[h-strip:h, :, :].reshape(-1,3))
    samples.append(rgb[:, 0:strip, :].reshape(-1,3))
    samples.append(rgb[:, w-strip:w, :].reshape(-1,3))
    return np.concatenate(samples, axis=0).mean(axis=0)

def remove_border(inp, out, th=12.0, crop=False, minw=4):
    im = Image.open(inp).convert("RGBA")
    arr = np.array(im)
    h, w = arr.shape[:2]
    rgb = arr[..., :3].astype(np.float32)

    bg = sample_edge_color(rgb)
    dist = np.linalg.norm(rgb - bg, axis=-1)
    bg_like = dist <= th

    visited = np.zeros((h,w), dtype=bool)
    q = deque()
    for x in range(w):
        if bg_like[0,x]: visited[0,x]=True; q.append((0,x))
        if bg_like[h-1,x]: visited[h-1,x]=True; q.append((h-1,x))
    for y in range(h):
        if bg_like[y,0]: visited[y,0]=True; q.append((y,0))
        if bg_like[y,w-1]: visited[y,w-1]=True; q.append((y,w-1))

    nbrs = [(-1,0),(1,0),(0,-1),(0,1)]
    region_id = np.full((h,w), -1, dtype=int)
    rid = 0
    regions = {}

    # Flood-fill with region IDs
    while q:
        y,x = q.popleft()
        if region_id[y,x] != -1: continue
        # BFS to label region
        pix = []
        q2 = deque([(y,x)])
        region_id[y,x]=rid
        while q2:
            yy,xx=q2.popleft()
            pix.append((yy,xx))
            for dy,dx in nbrs:
                ny,nx=yy+dy,xx+dx
                if 0<=ny<h and 0<=nx<w and region_id[ny,nx]==-1 and bg_like[ny,nx]:
                    region_id[ny,nx]=rid
                    q2.append((ny,nx))
        # Save region pixels
        regions[rid] = pix
        rid+=1

    # For each region, check bounding box thickness
    to_remove = set()
    for rid,pix in regions.items():
        ys=[p[0] for p in pix]
        xs=[p[1] for p in pix]
        hspan = max(xs)-min(xs)+1
        vspan = max(ys)-min(ys)+1
        if hspan<=minw or vspan<=minw:
            # thin strip → remove
            to_remove.add(rid)

    rgba = arr.copy()
    alpha = rgba[...,3].copy()
    for rid,pix in regions.items():
        if rid in to_remove:
            for y,x in pix:
                alpha[y,x]=0
    rgba[...,3]=alpha

    out_img = Image.fromarray(rgba, "RGBA")

    if crop:
        nz = np.argwhere(alpha>0)
        if nz.size>0:
            ymin,xmin = nz.min(axis=0)
            ymax,xmax = nz.max(axis=0)
            out_img = out_img.crop((xmin,ymin,xmax+1,ymax+1))

    out_img.save(out, optimize=True)

if __name__ == "__main__":
    args = parse_args()
    remove_border(args.inp, args.out, th=args.th, crop=args.crop, minw=args.minw)