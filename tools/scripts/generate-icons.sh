#!/usr/bin/env bash
set -euo pipefail

# generate-icons.sh
# Generate PNG icon variants and favicon.ico from icon.svg (preferred) or from icon-1024.png / icon-512.png fallback.

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DIR"

# Work inside the public icons folder if present
ICON_DIR="$DIR/public/icons"
ASSETS_DIR="$DIR/public/assets"
if [ -d "$ICON_DIR" ]; then
  cd "$ICON_DIR"
fi

SVG="icon.svg"
BASEPNG="icon-512.png"
BASEPNG_1024="icon-1024.png"

# Sizes to generate (include favicon sizes 48/32/16)
SIZES=(1024 512 192 180 167 152 120 48 32 16)

have_magick() { command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1; }
have_rsvg() { command -v rsvg-convert >/dev/null 2>&1; }
have_inkscape() { command -v inkscape >/dev/null 2>&1; }

echo "Generating icons in $(pwd)"

# Remember whether an original SVG existed before we start
# If icon.svg exists but contains an embedded raster (<image href=), treat it as a wrapper (not original)
ORIG_SVG_EXISTS=false
if [ -f "$SVG" ]; then
  if grep -q "<image[[:space:]]\+href=\|<image href=" "$SVG" >/dev/null 2>&1; then
    # wrapper SVG created previously by this script -> not original
    ORIG_SVG_EXISTS=false
    echo "Detected wrapper SVG (will treat as non-original)."
  else
    ORIG_SVG_EXISTS=true
  fi
fi

# Cleanup previous generated icons and preview (but keep source files like icon-1024.png and original icon.svg)
echo "Cleaning previous generated icons and preview..."
rm -f icon-16.png icon-32.png icon-48.png icon-120.png icon-152.png icon-167.png icon-180.png icon-192.png icon-512.png favicon.ico || true
# remove preview if exists
rm -f "$ASSETS_DIR/preview.png" || true
# remove wrapper svg only if original svg did not exist (i.e. we previously generated an icon.svg wrapper)
if [ "$ORIG_SVG_EXISTS" = false ] && [ -f "$SVG" ]; then
  echo "Removing previously generated wrapper $SVG"
  rm -f "$SVG"
fi

# Prefer rasterizing an actual SVG if present and we have toolchains
if [ "$ORIG_SVG_EXISTS" = true ] && have_rsvg; then
  echo "Using rsvg-convert to rasterize $SVG"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    rsvg-convert -w "$s" -h "$s" "$SVG" -o "$out"
  done
  # favicon.ico
  for s in 16 32 48; do
    tmp="tmp-${s}.png"
    rsvg-convert -w "$s" -h "$s" "$SVG" -o "$tmp"
  done
  if command -v png2ico >/dev/null 2>&1; then
    png2ico favicon.ico tmp-16.png tmp-32.png tmp-48.png >/dev/null 2>&1 && echo " - favicon.ico (png2ico)"
  elif have_magick; then
    CMD="$(command -v magick || command -v convert)"
    "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico >/dev/null 2>&1 && echo " - favicon.ico (ImageMagick)"
  else
    echo "png2ico/ImageMagick not found, favicon.ico skipped" >&2
  fi
  rm -f tmp-16.png tmp-32.png tmp-48.png
elif [ "$ORIG_SVG_EXISTS" = true ] && have_inkscape; then
  echo "Using Inkscape to rasterize $SVG"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    inkscape "$SVG" --export-type=png --export-filename="$out" --export-width="$s" --export-height="$s" >/dev/null 2>&1 || inkscape --export-png="$out" -w "$s" -h "$s" "$SVG" >/dev/null 2>&1
  done
  if have_magick; then
    CMD="$(command -v magick || command -v convert)"
    for s in 16 32 48; do
      tmp="tmp-${s}.png"
      inkscape "$SVG" --export-type=png --export-filename="$tmp" --export-width="$s" --export-height="$s" >/dev/null 2>&1 || inkscape --export-png="$tmp" -w "$s" -h "$s" "$SVG" >/dev/null 2>&1
    done
    "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico >/dev/null 2>&1 && echo " - favicon.ico (ImageMagick)"
    rm -f tmp-16.png tmp-32.png tmp-48.png
  else
    echo "No ImageMagick for favicon creation; favicon.ico skipped (png2ico or ImageMagick recommended)" >&2
  fi
elif [ "$ORIG_SVG_EXISTS" = true ] && have_magick; then
  echo "Using ImageMagick to render from $SVG"
  CMD="$(command -v magick || command -v convert)"
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    "$CMD" -background none -density 300 "$SVG" -resize ${s}x${s} -strip "$out" >/dev/null 2>&1
  done
  # favicon
  for s in 16 32 48; do
    tmp="tmp-${s}.png"
    "$CMD" -background none -density 300 "$SVG" -resize ${s}x${s} -strip "$tmp" >/dev/null 2>&1
  done
  "$CMD" tmp-16.png tmp-32.png tmp-48.png -colors 256 favicon.ico >/dev/null 2>&1 && echo " - favicon.ico (ImageMagick)"
  rm -f tmp-16.png tmp-32.png tmp-48.png
else
  # Fallback: use a high-resolution PNG if present (prefer 1024), else 512
  echo "No SVG toolchain available (or no $SVG). Falling back to PNG resizing via sips."
  SRCPNG=""
  if [ -f "$BASEPNG_1024" ]; then
    SRCPNG="$BASEPNG_1024"
  elif [ -f "$BASEPNG" ]; then
    SRCPNG="$BASEPNG"
  fi
  if [ -z "$SRCPNG" ]; then
    echo "Error: no source PNG found (expected $BASEPNG_1024 or $BASEPNG) and no SVG tool available. Please provide $SVG or a PNG source." >&2
    exit 1
  fi
  # If source is 1024 and 512 is missing, pre-create 512 to use as base
  if [ "$SRCPNG" = "$BASEPNG_1024" ] && [ ! -f "$BASEPNG" ]; then
    echo "Generating $BASEPNG from $BASEPNG_1024"
    sips -Z 512 "$SRCPNG" --out "$BASEPNG" >/dev/null 2>&1
    SRCPNG="$BASEPNG"
  fi
  for s in "${SIZES[@]}"; do
    out="icon-${s}.png"
    echo " - $out"
    sips -Z "$s" "$SRCPNG" --out "$out" >/dev/null 2>&1
  done
  # favicon
  if command -v png2ico >/dev/null 2>&1; then
    png2ico favicon.ico icon-16.png icon-32.png icon-48.png >/dev/null 2>&1 && echo " - favicon.ico (png2ico)"
  elif have_magick; then
    CMD="$(command -v magick || command -v convert)"
    "$CMD" icon-16.png icon-32.png icon-48.png -colors 256 favicon.ico >/dev/null 2>&1 && echo " - favicon.ico (ImageMagick)"
  else
    echo "png2ico/ImageMagick not found, skipping favicon.ico creation. Install png2ico or ImageMagick to create favicon.ico." >&2
  fi
fi

echo "Icons generated. Update your manifest if needed."

# Create preview image (Open Graph / social preview) in public/assets/preview.png (1200x630)
mkdir -p "$ASSETS_DIR"
PREVIEW="$ASSETS_DIR/preview.png"
echo "Generating preview image at $PREVIEW"
if [ "$ORIG_SVG_EXISTS" = true ] && have_rsvg; then
  rsvg-convert -w 1200 -h 630 "$SVG" -o "$PREVIEW" && echo " - $PREVIEW (from SVG via rsvg-convert)"
elif [ "$ORIG_SVG_EXISTS" = true ] && have_inkscape; then
  inkscape "$SVG" --export-type=png --export-filename="$PREVIEW" --export-width=1200 --export-height=630 >/dev/null 2>&1 && echo " - $PREVIEW (from SVG via Inkscape)"
elif [ "$ORIG_SVG_EXISTS" = true ] && have_magick; then
  CMD="$(command -v magick || command -v convert)"
  "$CMD" -background none -density 300 "$SVG" -resize 1200x630 -strip "$PREVIEW" >/dev/null 2>&1 && echo " - $PREVIEW (from SVG via ImageMagick)"
else
  # Use PNG fallback source to create preview
  SRCPNG=""
  if [ -f "$BASEPNG_1024" ]; then
    SRCPNG="$BASEPNG_1024"
  elif [ -f "$BASEPNG" ]; then
    SRCPNG="$BASEPNG"
  fi
  if [ -n "$SRCPNG" ]; then
    # sips allows exact sizing with -z <height> <width>
    sips -z 630 1200 "$SRCPNG" --out "$PREVIEW" >/dev/null 2>&1 && echo " - $PREVIEW (from $SRCPNG via sips)"
  else
    echo "No source available to generate preview.png (provide $SVG or $BASEPNG_1024/$BASEPNG)" >&2
  fi
fi

echo "Done."
