#!/usr/bin/env node
/**
 * Puts the MeteoRide icon into the generated iOS project.
 *
 * `ios/` is not in git, so dropping the icon in by hand would be lost the next time
 * the project is regenerated. This reads whatever `AppIcon.appiconset/Contents.json`
 * the template shipped, and writes an image for every filename it references, at the
 * size that entry declares.
 *
 * Two things it does to the source that matter:
 *
 *  - **Removes the alpha channel.** `public/icons/icon-1024.png` is RGBA, and an iOS
 *    app icon must not be: Xcode warns and App Store Connect rejects the upload.
 *    Transparent pixels are composited onto the app's blue rather than onto black,
 *    which is what a naive flatten would give.
 *  - **Resizes** with a box filter, which is the right average for a clean downscale
 *    and needs no dependencies — the point being that this runs with plain Node on
 *    any machine, including one with no ImageMagick.
 *
 * Usage: `npm run icons` (after `npm run add:ios`, or any time the source changes).
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(MOBILE, '../public/icons/icon-1024.png');
const APPICON = join(MOBILE, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');

/**
 * The blue behind the icon. This is the one `tools/scripts/fix_icon_ios.py` used to
 * make `public/icons/icon-ios.png`, the icon iOS already shows for the installed web
 * app — so the native app ends up looking like the thing people recognise, rather
 * than like a second, slightly different icon.
 */
export const BACKGROUND = [30, 95, 143];

const log = (...a) => console.log('[install-icons]', ...a);

/* ---------- PNG ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Decodes a non-interlaced 8-bit RGB/RGBA PNG to {width, height, rgba}. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let header = null;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (!header) throw new Error('PNG has no header');
  const { width, height, depth, colour, interlace } = header;
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
    throw new Error(`unsupported PNG: 8-bit non-interlaced RGB or RGBA only (got depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  }

  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    // Undo the per-row filter (PNG spec, section 9.2).
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown row filter ${filter}`);
      line[i] = value & 0xff;
    }
    line.copy(previous);
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
  }
  return { width, height, rgba };
}

/** Encodes RGB (no alpha, as iOS requires) at the given size. */
export function encodePng(width, height, rgb) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type: RGB, no alpha
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;   // filter: none. Icons compress well enough.
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The smallest rectangle holding every pixel that is not fully transparent. */
export function contentBox({ width, height, rgba }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, width, height };   // nothing but transparency
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Renders the icon at `size`, the same way `fix_icon_ios.py` made the web app's
 * icon: crop away the transparent margin, scale the artwork so its longer side
 * fills the canvas, centre it, and composite onto the background.
 *
 * The cropping is the part that matters. The source has a 93px transparent margin,
 * so merely flattening it leaves a small logo adrift on a large blue square — which
 * is not what iOS shows for the installed web app, and looks wrong beside it.
 */
export function render(source, size) {
  const { width, height, rgba } = source;
  const box = contentBox(source);
  const scale = size / Math.max(box.width, box.height);
  const drawW = Math.max(1, Math.round(box.width * scale));
  const drawH = Math.max(1, Math.round(box.height * scale));
  const offsetX = Math.round((size - drawW) / 2);
  const offsetY = Math.round((size - drawH) / 2);

  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    out[i * 3] = BACKGROUND[0];
    out[i * 3 + 1] = BACKGROUND[1];
    out[i * 3 + 2] = BACKGROUND[2];
  }

  for (let y = 0; y < drawH; y++) {
    // Box filter: average the source pixels this output pixel covers. When scaling
    // up, the range is a single pixel and this is a nearest-neighbour read.
    const sy0 = box.y + Math.floor((y * box.height) / drawH);
    const sy1 = Math.min(box.y + box.height, Math.max(sy0 + 1, box.y + Math.floor(((y + 1) * box.height) / drawH)));
    for (let x = 0; x < drawW; x++) {
      const sx0 = box.x + Math.floor((x * box.width) / drawW);
      const sx1 = Math.min(box.x + box.width, Math.max(sx0 + 1, box.x + Math.floor(((x + 1) * box.width) / drawW)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * width + sx) * 4;
          const a = rgba[i + 3] / 255;
          // Over the background rather than over black, which is what discarding
          // the channel would leave around the soft edges.
          r += rgba[i] * a + BACKGROUND[0] * (1 - a);
          g += rgba[i + 1] * a + BACKGROUND[1] * (1 - a);
          b += rgba[i + 2] * a + BACKGROUND[2] * (1 - a);
          n++;
        }
      }
      const to = ((y + offsetY) * size + (x + offsetX)) * 3;
      out[to] = Math.round(r / n);
      out[to + 1] = Math.round(g / n);
      out[to + 2] = Math.round(b / n);
    }
  }
  return out;
}

/* ---------- installing ---------- */

async function main() {
  if (!existsSync(APPICON)) {
    throw new Error(`${APPICON.replace(MOBILE + '/', '')} is missing — run \`npm run add:ios\` first`);
  }
  const source = decodePng(await readFile(SOURCE));
  log(`source ${source.width}x${source.height}`);

  const contents = JSON.parse(await readFile(join(APPICON, 'Contents.json'), 'utf8'));
  const wanted = new Map();   // filename -> pixel size
  for (const image of contents.images || []) {
    if (!image.filename) continue;
    const base = parseFloat(image.size) || 1024;
    const scale = parseFloat(image.scale) || 1;
    wanted.set(image.filename, Math.max(wanted.get(image.filename) || 0, Math.round(base * scale)));
  }
  if (!wanted.size) throw new Error('Contents.json names no image files; nothing to install');

  for (const [filename, size] of wanted) {
    await writeFile(join(APPICON, filename), encodePng(size, size, render(source, size)));
    log(`wrote ${filename} at ${size}px`);
  }

  // The template ships placeholder PNGs; anything left over would just be dead weight.
  const stale = (await readdir(APPICON)).filter((f) => f.endsWith('.png') && !wanted.has(f));
  if (stale.length) log(`note: ${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} not referenced by Contents.json and was left alone`);

  log('done — clean the build folder in Xcode (⇧⌘K) if the old icon lingers');
}

// Only install when run as a script; the tests import the pure functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[install-icons] failed:', err.message);
    process.exit(1);
  });
}
