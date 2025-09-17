
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import argparse
from PIL import Image

def trim_transparency(im, alpha_threshold=1):
    """Return a cropped copy by removing transparent margins based on alpha.
    Pixels with alpha > alpha_threshold are considered content.
    """
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    alpha = im.split()[3]  # L-mode alpha 0..255
    if alpha_threshold > 0:
        # Binarize: 0..A -> 0, A+1..255 -> 255
        mask = alpha.point(lambda p: 255 if p > alpha_threshold else 0, mode='L')
        bbox = mask.getbbox()
    else:
        bbox = alpha.getbbox()
    if bbox:
        return im.crop(bbox)
    return im.copy()

def resize_keep_aspect(im, fit=None, width=None, height=None):
    """Resize preserving aspect ratio. Exactly one of fit/width/height may be set.
    - fit: longest side becomes 'fit'
    - width: set final width, compute height
    - height: set final height, compute width
    """
    if sum(x is not None for x in (fit, width, height)) == 0:
        return im  # no resize
    if sum(x is not None for x in (fit, width, height)) > 1:
        raise ValueError("Use only one of --fit, --width, or --height")

    w, h = im.size
    if fit is not None:
        ratio = fit / max(w, h)
        new_w, new_h = max(1, int(round(w * ratio))), max(1, int(round(h * ratio)))
        return im.resize((new_w, new_h), Image.LANCZOS)
    if width is not None:
        ratio = width / w
        new_w, new_h = width, max(1, int(round(h * ratio)))
        return im.resize((new_w, new_h), Image.LANCZOS)
    if height is not None:
        ratio = height / h
        new_w, new_h = max(1, int(round(w * ratio))), height
        return im.resize((new_w, new_h), Image.LANCZOS)

def main():
    ap = argparse.ArgumentParser(description="Trim transparent borders, then resize without changing aspect ratio.")
    ap.add_argument("inp", help="Input image (PNG/JPG/WebP etc.)")
    ap.add_argument("out", help="Output image (PNG recommended)")
    ap.add_argument("--alpha-th", type=int, default=1, dest="alpha_th",
                    help="Alpha threshold (0-255) to consider a pixel as content (default 1)")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--fit", type=int, help="Scale so the longest side equals this value")
    group.add_argument("--width", type=int, help="Scale to this width (keeps aspect)")
    group.add_argument("--height", type=int, help="Scale to this height (keeps aspect)")
    ap.add_argument("--no-resize", action="store_true", help="Only trim; don't resize")
    args = ap.parse_args()

    im = Image.open(args.inp).convert("RGBA")
    im = trim_transparency(im, alpha_threshold=args.alpha_th)

    if not args.no_resize:
        im = resize_keep_aspect(im, fit=args.fit, width=args.width, height=args.height)

    # Ensure PNG to preserve transparency if needed
    save_kwargs = {}
    if args.out.lower().endswith(".png"):
        save_kwargs["optimize"] = True

    im.save(args.out, **save_kwargs)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", str(e), file=sys.stderr)
        sys.exit(1)
