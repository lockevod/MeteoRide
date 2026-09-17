/* The two iOS privacy manifests.
 *
 * Apple rejects an upload that calls a required-reason API without declaring it, and
 * nothing in this repository builds iOS, so a missing or wrong declaration would only
 * surface at App Store Connect. `mobile/ios/` is generated and not in git; these files
 * are the tracked source of that declaration, and docs/IOS.md steps 4 and 5 add them
 * to the two targets.
 *
 * The check that matters most is the last one: a plugin added later can bring a new
 * required-reason category with it, and the only sign is a line in its README.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(MOBILE, 'native/ios/PrivacyInfo.xcprivacy');
const EXTENSION = join(MOBILE, 'native/ios/ShareExtension/PrivacyInfo.xcprivacy');

/* Apple's published reasons per category, from
 * developer.apple.com/documentation/bundleresources/app-privacy-configuration/
 * nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons, read out of the
 * documentation JSON rather than from a summary — an earlier version of this table was
 * wrong in three places and happily certified a manifest that declared an active
 * *keyboard* reason for user defaults. The codes are four hex characters and look
 * interchangeable; they are not. What each one means, in one line:
 *
 *   C617.1  file metadata inside the app / app group / CloudKit container
 *   DDA9.1  DISPLAYING a file timestamp to the person
 *   3B52.1  file metadata the person granted through e.g. a document picker
 *   CA92.1  user defaults readable only by this app
 *   1C8F.1  user defaults shared with an App Group
 *   AC6B.1  user defaults read of the MDM managed-configuration key
 *   54BD.1  ACTIVE KEYBOARDS, to present the right UI — not user defaults
 *   3EC4.1  active keyboards, for a custom keyboard app
 *
 * The two SDK-only wrappers (0A2A.1 file timestamp, C56D.1 user defaults) are left out:
 * an app may not declare them. */
const REASONS = {
  NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1', 'DDA9.1', '3B52.1'],
  NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1', '1C8F.1', 'AC6B.1'],
  NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1', '8FFB.1', '3D61.1'],
  NSPrivacyAccessedAPICategoryDiskSpace: ['85F4.1', 'E174.1', '7D9E.1', 'B728.1'],
  NSPrivacyAccessedAPICategoryActiveKeyboards: ['3EC4.1', '54BD.1'],
};

/** {category: [reason, …]} out of a manifest. Enough XML for a file this shape. */
function declarations(xml) {
  const out = {};
  for (const [, block] of xml.matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
    const type = block.match(/<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)</);
    if (!type) continue;
    out[type[1]] = [...block.matchAll(/<string>([0-9A-F]{4}\.\d)<\/string>/g)].map((m) => m[1]);
  }
  return out;
}

test('both manifests declare a file-timestamp reason, and only reasons Apple publishes', async () => {
  for (const [what, path] of [['App', APP], ['ShareExtension', EXTENSION]]) {
    const declared = declarations(await readFile(path, 'utf8'));
    const timestamps = declared.NSPrivacyAccessedAPICategoryFileTimestamp;
    assert.ok(
      timestamps && timestamps.length,
      `${what} declares no file-timestamp reason, but it compiles MeteoRideShareStore, ` +
      'whose prune reads .modificationDate'
    );
    for (const [category, reasons] of Object.entries(declared)) {
      assert.ok(REASONS[category], `${what} declares an unknown category: ${category}`);
      assert.ok(reasons.length, `${what} declares ${category} with no reason at all`);
      for (const reason of reasons) {
        assert.ok(
          REASONS[category].includes(reason),
          `${what} declares ${reason} under ${category}; Apple lists ${REASONS[category].join(', ')}`
        );
      }
    }
  }
});

test('the App manifest covers every category the installed plugins ask for', async () => {
  const declared = declarations(await readFile(APP, 'utf8'));
  const missing = [];
  for (const dep of await readdir(join(MOBILE, 'node_modules/@capacitor'))) {
    let readme;
    try { readme = await readFile(join(MOBILE, 'node_modules/@capacitor', dep, 'README.md'), 'utf8'); }
    catch { continue; }
    for (const [, category] of readme.matchAll(/(NSPrivacyAccessedAPICategory[A-Za-z]+)/g)) {
      if (!declared[category]) missing.push(`@capacitor/${dep} needs ${category}`);
    }
  }
  assert.deepEqual(
    [...new Set(missing)], [],
    'a plugin requires a privacy declaration the App manifest does not make'
  );
});

test('the extension declares nothing it has no plugins for', async () => {
  const declared = declarations(await readFile(EXTENSION, 'utf8'));
  assert.deepEqual(
    Object.keys(declared), ['NSPrivacyAccessedAPICategoryFileTimestamp'],
    'the extension compiles one shared file and links no Capacitor plugin; ' +
    'anything else declared here is either untrue or a change that needs this test updated'
  );
});
