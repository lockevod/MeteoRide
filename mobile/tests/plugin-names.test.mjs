// The web layer reaches native plugins through `Capacitor.Plugins.<name>`, and that
// name is not the npm package's export: @capacitor/background-runner exports
// `BackgroundRunner` but registers with the bridge as `CapacitorBackgroundRunner`.
// Getting it wrong costs nothing at build time — the key is simply undefined — and
// silently removes the whole feature, which is exactly what happened once. So read
// the real names out of the installed packages and check native.js against them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The name a package passes to registerPlugin(), which is what the bridge keys on. */
async function registeredName(pkg) {
  const src = await readFile(join(MOBILE, 'node_modules', pkg, 'dist/esm/index.js'), 'utf8');
  const match = src.match(/registerPlugin\(\s*['"]([^'"]+)['"]/);
  assert.ok(match, `${pkg} does not call registerPlugin the way this test expects`);
  return match[1];
}

test('every plugin native.js reaches for is registered under that name', async () => {
  const native = await readFile(join(MOBILE, '../public/scripts/native.js'), 'utf8');
  const used = new Set([...native.matchAll(/plugins\.(\w+)/g)].map((m) => m[1]));
  assert.ok(used.size > 3, 'native.js no longer reaches plugins by property; this test is moot');

  // Registered by the app's own Swift/Java rather than by a package.
  used.delete('MeteoRideShare');

  const { dependencies } = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  const registered = new Map();
  for (const dep of Object.keys(dependencies)) {
    if (!dep.startsWith('@capacitor/') || dep === '@capacitor/core') continue;
    registered.set(await registeredName(dep), dep);
  }

  for (const name of used) {
    assert.ok(
      registered.has(name),
      `native.js uses Capacitor.Plugins.${name}, which no installed package registers. ` +
      `The names that exist are: ${[...registered.keys()].sort().join(', ')}`
    );
  }
});

test('the ride watch reaches the background runner at all', async () => {
  const native = await readFile(join(MOBILE, '../public/scripts/native.js'), 'utf8');
  const name = await registeredName('@capacitor/background-runner');
  assert.match(native, new RegExp(`plugins\\.${name}\\b`), 'nothing in native.js talks to the runner');
});
