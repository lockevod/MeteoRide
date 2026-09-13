#!/usr/bin/env node
/**
 * Teaches @capacitor/background-runner's iOS notification API the interruption level.
 *
 * The runner is what delivers a ride alert while the app is in the background, and
 * on iOS its CapacitorNotifications.schedule() ignores `interruptionLevel`, so every
 * alert would be an ordinary banner: silenced by a Focus mode and easy to miss under
 * a locked screen. The @capacitor/local-notifications plugin supports the field, but
 * it cannot be called from the runner. Hence this: run on `npm install`, it inserts
 * the few lines the plugin lacks. Idempotent, and it fails loudly if the plugin's
 * source no longer looks the way it expects, so an upgrade cannot silently lose it.
 *
 * `timeSensitive` still needs the "Time Sensitive Notifications" capability on the
 * App target in Xcode (docs/IOS.md). Without it iOS quietly downgrades to `active`.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(
  MOBILE,
  'node_modules/@capacitor/background-runner/ios/Sources/CapacitorBackgroundRunner/CapacitorAPI/Notifications.swift'
);
const MARK = '// meteoride: interruption level';
const ANCHOR = '                    if let sound = notificationOption.sound {';
const PATCH = `                    ${MARK}
                    if #available(iOS 15.0, *), let level = option["interruptionLevel"] as? String {
                        switch level {
                        case "timeSensitive": content.interruptionLevel = .timeSensitive
                        case "passive": content.interruptionLevel = .passive
                        default: content.interruptionLevel = .active
                        }
                    }

`;

const log = (...a) => console.log('[patch-background-runner]', ...a);

if (!existsSync(FILE)) {
  // `npm install --omit=optional` or a pruned tree: nothing to do, and not an error
  // on a machine that will never build the iOS app.
  log('plugin not installed; skipping');
  process.exit(0);
}

const src = await readFile(FILE, 'utf8');
if (src.includes(MARK)) {
  log('already applied');
  process.exit(0);
}
if (!src.includes(ANCHOR)) {
  console.error(
    '[patch-background-runner] Notifications.swift has changed and the patch no longer fits.\n' +
    '  Check whether the plugin now supports interruptionLevel itself; if it does, delete\n' +
    '  this script and the postinstall entry in package.json. If not, update ANCHOR.'
  );
  process.exit(1);
}
await writeFile(FILE, src.replace(ANCHOR, PATCH + ANCHOR));
log('applied to', FILE.replace(MOBILE + '/', ''));
