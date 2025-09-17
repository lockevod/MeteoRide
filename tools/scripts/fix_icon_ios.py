#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara iconos para PWA en iOS:
- Recorta transparencias
- Escala proporcionalmente
- Centra en lienzo 1024x1024 con fondo sólido azul (#1e5f8f)

Uso:
  python fix_icon_ios.py input.png output.png
"""

from PIL import Image

def fix_icon(inp, out, size=1024, bg_color=(30, 95, 143, 255)):
    im = Image.open(inp).convert("RGBA")

    # Paso 1: recortar a contenido
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    # Paso 2: escalar manteniendo proporción
    im.thumbnail((size, size), Image.LANCZOS)

    # Paso 3: centrar en lienzo con fondo
    bg = Image.new("RGBA", (size, size), bg_color)
    x = (size - im.width) // 2
    y = (size - im.height) // 2
    bg.paste(im, (x, y), im)

    bg.save(out, "PNG", optimize=True)

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Uso: python fix_icon_ios.py input.png output.png")
    else:
        fix_icon(sys.argv[1], sys.argv[2])