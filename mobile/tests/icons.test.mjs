// The icon installer decodes, flattens and resizes a PNG with nothing but Node's
// zlib, so it is worth proving it produces what iOS demands: no alpha channel, the
// right dimensions, and transparent pixels composited onto the app's blue rather
// than onto black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePng, encodePng, render, contentBox, BACKGROUND,
  adaptiveForeground, roundIcon, installAndroid,
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
