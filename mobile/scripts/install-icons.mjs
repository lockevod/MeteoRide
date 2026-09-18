#!/usr/bin/env node
/**
 * Puts the MeteoRide icon into the iOS and Android projects.
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
 * Android gets the same drawing three ways: a square and a round icon for launchers
 * older than Android 8, and an adaptive icon (a transparent foreground over a colour)
 * for everything newer. `android/` is in git, so what this writes there is committed.
 *
 * Usage: `npm run icons` (after `npm run add:ios`, or any time the source changes).
 * It installs into whichever of the two projects exists.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(MOBILE, '../public/icons/icon-1024.png');
const APPICON = join(MOBILE, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
const SPLASH = join(MOBILE, 'ios/App/App/Assets.xcassets/Splash.imageset');
const ANDROID_RES = join(MOBILE, 'android/app/src/main/res');

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

/** Encodes RGB (no alpha, as iOS requires) or, with `channels` 4, RGBA. */
export function encodePng(width, height, rgb, channels = 3) {
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
  ihdr[9] = channels === 4 ? 6 : 2;   // colour type: RGBA, or RGB with no alpha
  const stride = width * channels;
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
  return renderOnto(source, size, size);
}

/**
 * The same drawing on a canvas of any shape, with `cover` saying how much of the
 * SHORTER side the artwork's longer side takes. `render` is this at 1:1 on a square,
 * which is why it comes out byte for byte as it did before this existed.
 *
 * The splash wants the other end of that range. A launch image is not an icon blown
 * up to the screen: the artwork sits small and centred on the app's colour, which is
 * also what makes one image work at 320x480 and at 1920x1280 without redrawing it.
 */
export function renderOnto(source, canvasW, canvasH, cover = 1, background = BACKGROUND) {
  const { width, height, rgba } = source;
  const box = contentBox(source);
  const scale = (Math.min(canvasW, canvasH) * cover) / Math.max(box.width, box.height);
  const drawW = Math.max(1, Math.round(box.width * scale));
  const drawH = Math.max(1, Math.round(box.height * scale));
  const offsetX = Math.round((canvasW - drawW) / 2);
  const offsetY = Math.round((canvasH - drawH) / 2);

  const out = Buffer.alloc(canvasW * canvasH * 3);
  for (let i = 0; i < canvasW * canvasH; i++) {
    out[i * 3] = background[0];
    out[i * 3 + 1] = background[1];
    out[i * 3 + 2] = background[2];
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
          r += rgba[i] * a + background[0] * (1 - a);
          g += rgba[i + 1] * a + background[1] * (1 - a);
          b += rgba[i + 2] * a + background[2] * (1 - a);
          n++;
        }
      }
      const to = ((y + offsetY) * canvasW + (x + offsetX)) * 3;
      out[to] = Math.round(r / n);
      out[to + 1] = Math.round(g / n);
      out[to + 2] = Math.round(b / n);
    }
  }
  return out;
}

/**
 * The foreground layer of an Android adaptive icon, RGBA. The canvas is 108dp and
 * launchers mask it to a circle, squircle or square that always shows the middle
 * 72dp, so the whole drawing goes there and the rest stays transparent over the
 * background colour. Filling the full 108dp would let a circular mask cut the wheel.
 */
export function adaptiveForeground(source, size) {
  const inner = Math.round((size * 72) / 108);
  const offset = Math.round((size - inner) / 2);
  const art = render(source, inner);
  const out = Buffer.alloc(size * size * 4);   // all transparent
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const from = (y * inner + x) * 3;
      const to = ((y + offset) * size + (x + offset)) * 4;
      out[to] = art[from];
      out[to + 1] = art[from + 1];
      out[to + 2] = art[from + 2];
      out[to + 3] = 255;
    }
  }
  return out;
}

/** The round legacy icon, RGBA: the square icon cut to a disc with a one-pixel soft edge. */
export function roundIcon(source, size) {
  const art = render(source, size);
  const out = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = Math.min(1, Math.max(0, r - Math.hypot(x + 0.5 - r, y + 0.5 - r) + 0.5));
      const from = (y * size + x) * 3;
      const to = (y * size + x) * 4;
      out[to] = art[from];
      out[to + 1] = art[from + 1];
      out[to + 2] = art[from + 2];
      out[to + 3] = Math.round(coverage * 255);
    }
  }
  return out;
}

/* ---------- installing ---------- */

const ANDROID_DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** Writes the launcher icons into an Android `res` directory. */
export async function installAndroid(source, res) {
  for (const [density, scale] of Object.entries(ANDROID_DENSITIES)) {
    const dir = join(res, `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    const canvas = Math.round(108 * scale);
    await writeFile(join(dir, 'ic_launcher.png'), encodePng(legacy, legacy, render(source, legacy)));
    await writeFile(join(dir, 'ic_launcher_round.png'), encodePng(legacy, legacy, roundIcon(source, legacy), 4));
    await writeFile(join(dir, 'ic_launcher_foreground.png'), encodePng(canvas, canvas, adaptiveForeground(source, canvas), 4));
    log(`wrote mipmap-${density} (${legacy}px, foreground ${canvas}px)`);
  }
  const hex = '#' + BACKGROUND.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
  await mkdir(join(res, 'values'), { recursive: true });
  await writeFile(
    join(res, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`,
  );
}

async function main() {
  const hasIos = existsSync(APPICON);
  const hasAndroid = existsSync(ANDROID_RES);
  if (!hasIos && !hasAndroid) {
    throw new Error('neither project is there — run `npm run add:ios` or `npx cap add android` first');
  }
  const source = decodePng(await readFile(SOURCE));
  log(`source ${source.width}x${source.height}`);
  if (hasIos) await installIos(source);
  else log('no iOS project, skipping it');
  if (existsSync(SPLASH)) await installIosSplash(source);
  if (hasAndroid) {
    await installAndroid(source, ANDROID_RES);
    await installAndroidSplash(source, ANDROID_RES);
  }
}

/**
 * How much of the shorter side of a launch image the artwork takes. Capacitor's own
 * placeholder is about a twentieth, which is a logo lost on a white field; filling the
 * screen would be a wall of icon. A bit over a quarter reads as an app opening.
 *
 * iOS gets a much smaller number for the same result on screen. Android picks a bitmap
 * already shaped like the device, so what is drawn is what is shown. iOS has one square
 * image and the storyboard scales it to FILL (`scaleAspectFill`, LaunchScreen.storyboard),
 * so a 2732 square on a 430x932 phone is scaled by 932/2732 and cropped left and right:
 * the artwork ends up sized against the screen's LONG side. 0.28 there came out at about
 * 60% of the width. 0.13 lands near a quarter of the width on a phone and a sixth on an
 * iPad, which is the same drawing Android gets.
 */
const SPLASH_COVER = 0.28;
const SPLASH_COVER_IOS = 0.13;

/**
 * The launch image's field, which is NOT `BACKGROUND`. `BACKGROUND` (#1E5F8F) is the blue
 * behind the icon, chosen to sit under the artwork; the app's own colour is #0B6297 — the
 * header in `style.css`, `theme-color` in `index.html`, and `backgroundColor` three times
 * in `capacitor.config.json`, which is what the window and the splash plugin paint. A
 * launch image in the icon's blue puts a visible step of colour between the image and the
 * window behind it, and again when the plugin hides the image.
 */
const SPLASH_BACKGROUND = [0x0b, 0x62, 0x97];

/**
 * The launch image, which nothing was writing. `install-icons` replaced the app icon and
 * left `Splash.imageset` and the Android `splash.png` drawables exactly as the template
 * shipped them: the Capacitor logo, a blue cross, on white. So the app's own icon was
 * right on the home screen and tapping it showed somebody else's mark on a white screen
 * for as long as the web view took to paint. `backgroundColor` in `capacitor.config.json`
 * does not help — the placeholder is an opaque full-bleed PNG and covers it.
 *
 * Android reads the size of every bitmap the template shipped and replaces each in place.
 * iOS does NOT: it writes one square for every slot, because the storyboard scales and
 * crops a single image to whatever the device is, and the three slots the template lists
 * are the same picture at 1x/2x/3x. The filename is read only to pick the side length, so
 * a template that ever ships a non-square name would still get a square — deliberate, and
 * the reason this says so rather than claiming to honour the template's shape.
 */
export async function installIosSplash(source) {
  const contents = JSON.parse(await readFile(join(SPLASH, 'Contents.json'), 'utf8'));
  const names = [...new Set((contents.images || []).map((i) => i.filename).filter(Boolean))];
  if (!names.length) throw new Error('Splash Contents.json names no image files');

  // One square canvas for every slot. iOS scales and crops it to whatever the device is,
  // and a square big enough for the largest iPad covers every phone in both orientations.
  const side = Math.max(...names.map((n) => parseInt(/(\d+)x\d+/.exec(n)?.[1] || '0', 10)), 2732);
  const png = encodePng(side, side, renderOnto(source, side, side, SPLASH_COVER_IOS, SPLASH_BACKGROUND));
  for (const name of names) await writeFile(join(SPLASH, name), png);
  log(`wrote ${names.length} iOS splash image${names.length === 1 ? '' : 's'} at ${side}px`);
}

export async function installAndroidSplash(source, res) {
  // Android keeps a separate bitmap per density AND per orientation, at sizes the
  // template chose. Read each one's header and write a replacement of the same shape,
  // so nothing here has to know what `drawable-land-xxxhdpi` is supposed to be.
  // Every `drawable` variant, not a list of the qualifiers seen today: `drawable-night`,
  // `drawable-v24` and `drawable-anydpi-v26` are all resource folders Android would pick
  // over the plain one, and a pattern that names only `land`/`port` and a density would
  // leave the placeholder in place in any of them while reporting the others written.
  // Nothing is written where there is no `splash.png` to replace.
  const folders = (await readdir(res)).filter((d) => d === 'drawable' || d.startsWith('drawable-'));
  let written = 0;
  for (const folder of folders) {
    const file = join(res, folder, 'splash.png');
    if (!existsSync(file)) continue;
    const before = await readFile(file);
    // Read the header only once it is certain there is one: a truncated file, or anything
    // that is not a PNG under that name, otherwise throws out of `readUInt32BE` and takes
    // the whole run with it — the size check below would come far too late.
    if (before.length < 24 || before.readUInt32BE(0) !== 0x89504e47) {
      log(`note: ${folder}/splash.png is not a readable PNG and was left alone`);
      continue;
    }
    const w = before.readUInt32BE(16);
    const h = before.readUInt32BE(20);
    if (!w || !h) { log(`note: ${folder}/splash.png has no readable size and was left alone`); continue; }
    await writeFile(file, encodePng(w, h, renderOnto(source, w, h, SPLASH_COVER, SPLASH_BACKGROUND)));
    written++;
  }
  log(written ? `wrote ${written} Android splash images` : 'no Android splash images found');
}

async function installIos(source) {
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

  log('iOS done — clean the build folder in Xcode (⇧⌘K) if the old icon lingers');
}

// Only install when run as a script; the tests import the pure functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[install-icons] failed:', err.message);
    process.exit(1);
  });
}
