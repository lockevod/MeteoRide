// The app version lives in mobile/package.json and has to agree everywhere else it is
// written down by hand: Android's versionName, iOS's MARKETING_VERSION, and the generated
// public/scripts/version.js the help pages read. Nothing enforces that agreement at build
// time for Android/iOS (they are not rebuilt by `npm test`), so this is the only thing that
// would catch one of them drifting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(MOBILE, '..');

async function packageVersion() {
  const { version } = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  return version;
}

test('public/scripts/version.js matches mobile/package.json', async () => {
  const version = await packageVersion();
  const src = await readFile(join(REPO, 'public/scripts/version.js'), 'utf8');
  assert.match(
    src,
    new RegExp(`window\\.CW_VERSION\\s*=\\s*["']${version.replace(/\./g, '\\.')}["']`),
    `version.js does not declare window.CW_VERSION = "${version}"`
  );
});

test('Android versionName matches mobile/package.json', async () => {
  const version = await packageVersion();
  const gradle = await readFile(join(MOBILE, 'android/app/build.gradle'), 'utf8');
  assert.match(
    gradle,
    new RegExp(`versionName\\s+"${version.replace(/\./g, '\\.')}"`),
    `build.gradle versionName does not match package.json version ${version}`
  );
});

test('iOS MARKETING_VERSION matches mobile/package.json', async (t) => {
  // Two different situations, and conflating them cost this test its job for days. A
  // missing `mobile/ios/` means nothing to check yet: skip. A PRESENT `mobile/ios/` whose
  // project is not `App.xcodeproj` means the project was renamed in Xcode — and then this
  // test skipped, announcing "run cap add ios first", which was false, while `cap sync`
  // stopped writing Package.swift and build-www stopped syncing MARKETING_VERSION for the
  // very same reason. Capacitor hardcodes the name; that case has to be loud.
  const appDir = join(MOBILE, 'ios/App');
  if (!existsSync(appDir)) {
    t.skip('mobile/ios/ is not present — run `cap add ios` (or `npm run add:ios`) first');
    return;
  }
  const pbxprojPath = join(appDir, 'App.xcodeproj/project.pbxproj');
  assert.ok(
    existsSync(pbxprojPath),
    'mobile/ios/App exists but App.xcodeproj does not: the Xcode project has been renamed. ' +
    'Capacitor hardcodes App/App.xcodeproj, so Package.swift and MARKETING_VERSION both ' +
    'stop being written. Rename it back; the app name lives in CFBundleDisplayName.'
  );
  const version = await packageVersion();
  const pbxproj = await readFile(pbxprojPath, 'utf8');
  const marketingVersions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(marketingVersions.length > 0, 'project.pbxproj has no MARKETING_VERSION entries');
  for (const found of marketingVersions) {
    assert.equal(found, version, `MARKETING_VERSION ${found} does not match package.json version ${version}`);
  }
});
