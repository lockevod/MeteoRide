/* What must never reach the shipped app.
 *
 * `build-www.mjs` copies `public/` wholesale into `www/`, and `www/` is what Capacitor
 * packs into the IPA and the APK. So anything a local tool drops into `public/` ships —
 * to the App Store reviewer and to every user. That is not hypothetical: two code-analysis
 * databases, `scripts/.neuralmind/synapses.db` and `scripts/graphify-out/**`, about 160 KB
 * of them, were riding into the bundle until a review pass noticed. They are untracked, so
 * `git status` never showed them, and nothing failed. This test is the thing that would
 * have failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(MOBILE, 'www');

/** Every path under `dir`, relative to it, files and directories alike. */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push(relative(base, full));
    if (entry.isDirectory()) out.push(...await walk(full, base));
  }
  return out;
}

test('the shipped bundle carries no hidden directories or local databases', async () => {
  const paths = await walk(WWW);
  const debris = paths.filter((p) => {
    const name = p.split('/').pop();
    return name.startsWith('.')
      || name === 'graphify-out'
      || name === 'node_modules'
      || /\.(sqlite|sqlite3|db)$/i.test(name);
  });
  assert.deepEqual(debris, [],
    'these would be packed into the IPA and shipped to every user; ' +
    'filter them in build-www.mjs rather than deleting them by hand');
});

test('nothing in the bundle is implausibly large for a static app', async () => {
  // A second net with a different shape: debris that is not a dot-dir or a database still
  // announces itself by size. Every legitimate file here is a script, a style, an icon or
  // a vendored library.
  const big = [];
  for (const p of await walk(WWW)) {
    const info = await stat(join(WWW, p));
    if (info.isFile() && info.size > 2 * 1024 * 1024) big.push(`${p} (${Math.round(info.size / 1024)} KB)`);
  }
  assert.deepEqual(big, [], 'an unexpectedly large file is in the shipped bundle');
});
