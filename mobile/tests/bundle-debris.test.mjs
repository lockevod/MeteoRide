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
import { readFile, readdir, stat } from 'node:fs/promises';
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

test('every vendored library ships with its licence', async () => {
  // MIT, BSD and the icon font's OFL all ask for the notice to travel with the copies. The
  // vendored files alone did not carry it: an external review of the App Store reply found
  // "bundled components retain their licences" unsupported by what was in the bundle.
  const missing = [];
  for (const dir of await readdir(join(WWW, 'vendor'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(WWW, 'vendor', dir.name, 'LICENSE.txt');
    const size = await stat(file).then((s) => s.size, () => 0);
    if (size < 200) missing.push(dir.name);
  }
  assert.deepEqual(missing, [], 'vendored without its licence; see copyVendorLicences in build-www.mjs');
});

test('the notices file names every shipped package and carries every kept licence', async () => {
  // The vendor folders are not all that ships: pako is also under Zlib, the start and end
  // markers are BSD-2 icons from another project, and Capacitor, its plugins and the Apache
  // Cordova code inside it are compiled into the app. A second external review found all of
  // these missing after the vendor licences were fixed.
  const notices = await readFile(join(WWW, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const pkg = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  const shipped = [...Object.keys(pkg.dependencies), '@capacitor/ios', '@capacitor/android'];
  const unnamed = shipped.filter((name) => !notices.includes(`\n== ${name} `));
  assert.deepEqual(unnamed, [], 'shipped without a section in THIRD-PARTY-NOTICES.txt');
  const kept = await readdir(join(MOBILE, 'licenses'));
  const dropped = [];
  for (const n of kept) {
    if (!notices.includes((await readFile(join(MOBILE, 'licenses', n), 'utf8')).trim())) dropped.push(n);
  }
  assert.deepEqual(dropped, [], 'a licence kept in mobile/licenses is not in THIRD-PARTY-NOTICES.txt');
});
