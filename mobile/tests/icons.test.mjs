// The icon installer decodes, flattens and resizes a PNG with nothing but Node's
// zlib, so it is worth proving it produces what iOS demands: no alpha channel, the
// right dimensions, and transparent pixels composited onto the app's blue rather
// than onto black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePng, encodePng, render, renderOnto, contentBox, BACKGROUND,
  adaptiveForeground, roundIcon, installAndroid, installAndroidSplash,
} from '../scripts/install-icons.mjs';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '../../public/icons/icon-1024.png');
const source = decodePng(await readFile(SOURCE));

/** Reads the header of an encoded PNG without going through the full decoder. */
function header(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colour: buf[25] };
}

test('the source icon is the 1024 RGBA one, which is why flattening is needed', () => {
  assert.equal(source.width, 1024);
  assert.equal(source.height, 1024);
  assert.equal(source.rgba.length, 1024 * 1024 * 4);
});

test('every size comes out as RGB with no alpha channel', () => {
  for (const size of [1024, 180, 76]) {
    const png = encodePng(size, size, render(source, size));
    const head = header(png);
    assert.deepEqual(head, { width: size, height: size, depth: 8, colour: 2 },
      `colour type 2 is RGB; 6 would be RGBA, which App Store Connect rejects`);
    // And it round-trips: what we wrote is readable as an image of that size.
    const back = decodePng(png);
    assert.equal(back.width, size);
    assert.ok(back.rgba.every((_, i) => i % 4 !== 3 || back.rgba[i] === 255), 'fully opaque');
  }
});

test('the artwork is cropped and scaled to fill, not left adrift with a margin', () => {
  // The source carries a 9% transparent margin. Flattening without cropping would
  // put a small logo on a large blue square, which is not what iOS shows for the
  // installed web app.
  const box = contentBox(source);
  assert.ok(box.width < source.width * 0.9, 'this test assumes a source with a transparent margin');

  const size = 180;
  const rgb = render(source, size);
  const isBackground = (x, y) => {
    const i = (y * size + x) * 3;
    return rgb[i] === BACKGROUND[0] && rgb[i + 1] === BACKGROUND[1] && rgb[i + 2] === BACKGROUND[2];
  };
  // The longer side fills the canvas, so the middle row reaches both edges.
  const middle = size >> 1;
  assert.ok(!isBackground(0, middle) || !isBackground(size - 1, middle),
    'the artwork should reach the edge on its longer side');
  // And the margin that remains on the shorter side is small.
  let top = 0;
  while (top < size && isBackground(middle, top)) top++;
  assert.ok(top < size * 0.1, `a ${top}px band of background at the top is too much for a 180px icon`);
});

test('transparent corners become the app blue, not black', () => {
  // The source is a rounded/soft-edged icon, so its very corner is transparent.
  const corner = source.rgba.subarray(0, 4);
  assert.equal(corner[3], 0, 'this test assumes a transparent top-left pixel');

  const size = 64;
  const rgb = render(source, size);
  assert.deepEqual([rgb[0], rgb[1], rgb[2]], BACKGROUND, 'a naive flatten would leave 0,0,0 here');
});

test('the scaled icon is not blank: it still carries the source colours', () => {
  const rgb = render(source, 64);
  const middle = (64 * 32 + 32) * 3;
  const centre = [rgb[middle], rgb[middle + 1], rgb[middle + 2]];
  assert.notDeepEqual(centre, BACKGROUND, 'the middle of the icon should not be plain background');
  const distinct = new Set();
  for (let i = 0; i < rgb.length; i += 3) distinct.add(`${rgb[i]},${rgb[i + 1]},${rgb[i + 2]}`);
  assert.ok(distinct.size > 50, `only ${distinct.size} distinct colours; the resize probably collapsed`);
});

// Android launchers mask the adaptive foreground to a circle, a squircle or a square,
// and every one of them shows at least the middle 72dp of the 108dp canvas.
test('the Android adaptive foreground keeps the artwork inside the part every mask shows', () => {
  const size = 108;
  const rgba = adaptiveForeground(source, size);
  assert.equal(rgba.length, size * size * 4);
  const alpha = (x, y) => rgba[(y * size + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(17, 54), 0, 'left of the visible 72px must be see-through');
  assert.equal(alpha(90, 54), 0, 'right of the visible 72px must be see-through');
  assert.equal(alpha(18, 54), 255);
  assert.equal(alpha(89, 54), 255);
  assert.equal(alpha(54, 54), 255);
});

test('the round legacy icon is a disc: clear corners, solid middle', () => {
  const size = 96;
  const rgba = roundIcon(source, size);
  const alpha = (x, y) => rgba[(y * size + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(size - 1, size - 1), 0);
  assert.equal(alpha(48, 48), 255);
  assert.equal(alpha(48, 1), 255, 'the disc reaches the edge');
});

test('installing for Android writes every density, both shapes, and the background colour', async () => {
  const res = await mkdtemp(join(tmpdir(), 'meteoride-icons-'));
  await installAndroid(source, res);
  const densities = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
  const icons = [['ic_launcher', 48, 2], ['ic_launcher_round', 48, 6], ['ic_launcher_foreground', 108, 6]];
  for (const [density, scale] of densities) {
    for (const [name, dp, colour] of icons) {
      const png = await readFile(join(res, `mipmap-${density}`, `${name}.png`));
      const px = Math.round(dp * scale);
      assert.deepEqual(header(png), { width: px, height: px, depth: 8, colour }, `${density}/${name}`);
    }
  }
  const xml = await readFile(join(res, 'values/ic_launcher_background.xml'), 'utf8');
  assert.match(xml, /<color name="ic_launcher_background">#1E5F8F<\/color>/);
});

/* ---------- the launch image ----------
 *
 * Nothing wrote it for a long time: the icon was installed and `Splash.imageset` and the
 * Android splash drawables were left as Capacitor shipped them — its own logo on white.
 * So the home screen showed MeteoRide and tapping it showed somebody else's mark until
 * the web view painted. These pin down the drawing; whether the files get written is the
 * installer's business and is checked by running it.
 */

/** The pixel at (x, y) of an RGB buffer of the given width. */
const at = (buf, w, x, y) => [buf[(y * w + x) * 3], buf[(y * w + x) * 3 + 1], buf[(y * w + x) * 3 + 2]];

test('the icon canvas is exactly what it was before the splash needed a rectangular one', async () => {
  // The first version of this compared `render(source, size)` with
  // `renderOnto(source, size, size, 1)` and proved nothing: `render` IS that call, so a
  // change to the centring or the sampling moves both sides together. An equivalence test
  // needs a reference the new code did not produce.
  //
  // The committed launcher icons are one: `mipmap-*/ic_launcher.png` is in git, written by
  // the renderer as it was before any of this, and `installAndroid` writes exactly
  // `encodePng(px, px, render(source, px))`. So re-encoding here and comparing bytes
  // compares against the old drawing. (`npm run icons` leaves those files untouched in
  // `git status`, which is the same proof by another route.)
  const RES = join(dirname(fileURLToPath(import.meta.url)), '../android/app/src/main/res');
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const px = Math.round(48 * scale);
    const committed = await readFile(join(RES, `mipmap-${density}`, 'ic_launcher.png'));
    assert.deepEqual(encodePng(px, px, render(source, px)), committed,
      `mipmap-${density}/ic_launcher.png is not what the renderer produces any more`);
  }
});

test('the Android splash installer replaces each bitmap keeping its own shape', async () => {
  // Removing the installer calls left every drawing test green while the placeholder went
  // back on screen, so the installer itself needs exercising. Shapes on purpose: portrait,
  // landscape, square, and a qualifier the old folder pattern did not match.
  const res = await mkdtemp(join(tmpdir(), 'meteoride-splash-'));
  const shapes = {
    'drawable': [480, 320],
    'drawable-port-xxxhdpi': [1280, 1920],
    'drawable-land-mdpi': [480, 320],
    'drawable-night': [640, 640],
  };
  for (const [folder, [w, h]] of Object.entries(shapes)) {
    await mkdir(join(res, folder), { recursive: true });
    // A placeholder of the right shape and unmistakably not ours: solid white.
    await writeFile(join(res, folder, 'splash.png'), encodePng(w, h, Buffer.alloc(w * h * 3, 255)));
  }
  await mkdir(join(res, 'drawable-nosplash'), { recursive: true });   // nothing to replace

  await installAndroidSplash(source, res);

  for (const [folder, [w, h]] of Object.entries(shapes)) {
    const png = await readFile(join(res, folder, 'splash.png'));
    assert.deepEqual(header(png), { width: w, height: h, depth: 8, colour: 2 }, `${folder} changed shape`);
    const out = decodePng(png);
    const corner = [out.rgba[0], out.rgba[1], out.rgba[2]];
    assert.notDeepEqual(corner, [255, 255, 255], `${folder} was left white`);
    // The app's own blue (#0B6297), not the icon's (#1E5F8F): the launch image sits in
    // front of a window painted that colour, and two blues make a visible step.
    assert.deepEqual(corner, [0x0b, 0x62, 0x97], `${folder} used the icon blue`);
  }
});

test('a splash is the artwork small and centred on the app blue, at any shape', () => {
  for (const [w, h] of [[320, 480], [1920, 1280], [2732, 2732]]) {
    const out = renderOnto(source, w, h, 0.28);
    assert.equal(out.length, w * h * 3);

    // Corners and edge midpoints are background: the artwork is nowhere near them.
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [Math.floor(w / 2), 0]]) {
      assert.deepEqual(at(out, w, x, y), [...BACKGROUND], `${w}x${h} at ${x},${y} should be the app blue`);
    }
    // And the middle is not: something is drawn there.
    assert.notDeepEqual(at(out, w, Math.floor(w / 2), Math.floor(h / 2)), [...BACKGROUND],
      `${w}x${h} came out as a blank rectangle`);
  }
});

test('the splash artwork takes the share of the shorter side it is asked for', () => {
  // Width of the drawn artwork, measured by scanning the middle row for pixels that are
  // not the background. The guard against "it fills the screen" and "it is a speck".
  const w = 1000, h = 1600, cover = 0.28;
  const out = renderOnto(source, w, h, cover);
  const y = Math.floor(h / 2);
  let first = -1, last = -1;
  for (let x = 0; x < w; x++) {
    const p = at(out, w, x, y);
    if (p[0] === BACKGROUND[0] && p[1] === BACKGROUND[1] && p[2] === BACKGROUND[2]) continue;
    if (first < 0) first = x;
    last = x;
  }
  const drawn = last - first + 1;
  const wanted = Math.min(w, h) * cover;
  assert.ok(Math.abs(drawn - wanted) <= wanted * 0.08,
    `the artwork spans ${drawn}px where ${Math.round(wanted)} was asked for`);
  // Centred: the margins either side match.
  assert.ok(Math.abs(first - (w - 1 - last)) <= 2, `off centre by ${Math.abs(first - (w - 1 - last))}px`);
});

test('a splash has no alpha channel either, and survives a round trip', () => {
  const png = encodePng(320, 480, renderOnto(source, 320, 480, 0.28));
  assert.deepEqual(header(png), { width: 320, height: 480, depth: 8, colour: 2 });
  const back = decodePng(png);
  assert.equal(back.width, 320);
  assert.equal(back.height, 480);
});
