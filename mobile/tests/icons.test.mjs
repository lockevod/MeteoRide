// The icon installer decodes, flattens and resizes a PNG with nothing but Node's
// zlib, so it is worth proving it produces what iOS demands: no alpha channel, the
// right dimensions, and transparent pixels composited onto the app's blue rather
// than onto black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, render, contentBox, BACKGROUND } from '../scripts/install-icons.mjs';

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
