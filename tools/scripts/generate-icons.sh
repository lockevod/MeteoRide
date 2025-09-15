#!/usr/bin/env bash
set -euo pipefail

# generate-icons.sh
# Generate PNG icon variants and favicon.ico from icon.svg (preferred) or from icon-512.png fallback.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

SVG="icon.svg"
BASEPNG="icon-512.png"

SIZES=(120 152 167 180 192 512)

have_magick() { command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; }
have_rsvg() { command -v rsvg-convert >/dev/null 2>&1; }
have_inkscape() { command -v inkscape >/dev/null 2>&1; }

echo "Generating icons in $DIR"

if have_rsvg; then
  echo "Using rsvg-convert to rasterize SVG (better fidelity)"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    rsvg-convert -w $s -h $s "$SVG" -o "$out"
  done
  # create favicon.ico using rsvg variants
  for s in 16 32 48; do
    tmp="tmp-${s}.png"
    rsvg-convert -w $s -h $s "$SVG" -o "$tmp"
  done
  if command -v png2ico >/dev/null 2>&1; then
    png2ico favicon.ico tmp-16.png tmp-32.png tmp-48.png >/dev/null
  else
    # try to use ImageMagick convert if available
    if have_magick; then
      CMD="$(command -v magick || command -v convert)"
      "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico
    fi
  fi
  rm -f tmp-16.png tmp-32.png tmp-48.png
elif have_inkscape; then
  echo "Using Inkscape to rasterize SVG"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    inkscape "$SVG" --export-type=png --export-filename="$out" --export-width=$s --export-height=$s >/dev/null 2>&1 || inkscape --export-png="$out" -w $s -h $s "$SVG" >/dev/null 2>&1
  done
  # favicon via ImageMagick if available
  if have_magick; then
    CMD="$(command -v magick || command -v convert)"
    for s in 16 32 48; do
      tmp="tmp-${s}.png"
      inkscape "$SVG" --export-type=png --export-filename="$tmp" --export-width=$s --export-height=$s >/dev/null 2>&1 || inkscape --export-png="$tmp" -w $s -h $s "$SVG" >/dev/null 2>&1
    done
    "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico
    rm -f tmp-16.png tmp-32.png tmp-48.png
  else
    echo "No ImageMagick for favicon creation; favicon.ico skipped (png2ico or ImageMagick recommended)" >&2
  fi
elif have_magick; then
  echo "Using ImageMagick to render from $SVG (with transparency and density)"
  CMD="$(command -v magick || command -v convert)"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    # use density for better vector rasterization quality and keep transparency
    "$CMD" -background none -density 300 "$SVG" -resize ${s}x${s} -strip "$out"
  done
  # create favicon.ico (16,32,48)
  echo " - favicon.ico"
  for s in 16 32 48; do
    tmp="tmp-${s}.png"
    "$CMD" -background none -density 300 "$SVG" -resize ${s}x${s} -strip "$tmp"
  done
  "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico
  rm -f tmp-16.png tmp-32.png tmp-48.png
else
  echo "ImageMagick not found; falling back to sips using $BASEPNG (macOS)"
  if [ ! -f "$BASEPNG" ]; then
    echo "Error: $BASEPNG not found and ImageMagick missing. Please install ImageMagick or provide $BASEPNG." >&2
    exit 1
  fi
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    sips -Z $s "$BASEPNG" --out "$out" >/dev/null
  done
  # create a minimal favicon.ico using sips + png2ico if available
  if command -v png2ico >/dev/null 2>&1; then
    png2ico favicon.ico icon-16.png icon-32.png icon-48.png >/dev/null
    echo " - favicon.ico (png2ico)"
  else
    echo "png2ico not found, skipping favicon.ico creation. Install png2ico or ImageMagick to generate favicon.ico." >&2
  fi
fi

echo "Icons generated. Update your manifest if needed."
