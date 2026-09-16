#!/usr/bin/env node
/**
 * Two small fixes to @capacitor/background-runner's notification code, applied on
 * `npm install`. The runner is what delivers a ride alert while the app is in the
 * background, and its notification API is what these touch:
 *
 * iOS — CapacitorNotifications.schedule() ignores `interruptionLevel`, so every alert
 * would be an ordinary banner: silenced by a Focus mode and easy to miss under a
 * locked screen. The @capacitor/local-notifications plugin supports the field, but
 * it cannot be called from the runner. `timeSensitive` still needs the "Time
 * Sensitive Notifications" capability on the App target (docs/IOS.md); without it
 * iOS quietly downgrades to `active`.
 *
 * Android — `scheduleAt` arrives as the ISO string JSON makes of a Date, which ends
 * in Z, and the plugin parses it with a SimpleDateFormat that treats the Z as a
 * literal and the time as local. East of Greenwich the alarm lands in the past and
 * fires at once, which hides the bug; west of it the alert is hours late.
 *
 * Both edits are idempotent, and each fails the install loudly if the plugin's
 * source no longer looks the way it expects, so an upgrade cannot silently lose it.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(MOBILE, 'node_modules/@capacitor/background-runner');

const PATCHES = [
  {
    name: 'iOS interruption level',
    file: 'ios/Sources/CapacitorBackgroundRunner/CapacitorAPI/Notifications.swift',
    mark: '// meteoride: interruption level',
    anchor: '                    if let sound = notificationOption.sound {',
    insert: (mark) => `                    ${mark}
                    if #available(iOS 15.0, *), let level = option["interruptionLevel"] as? String {
                        switch level {
                        case "timeSensitive": content.interruptionLevel = .timeSensitive
                        case "passive": content.interruptionLevel = .passive
                        default: content.interruptionLevel = .active
                        }
                    }

`,
    hint: 'Check whether the plugin now supports interruptionLevel itself; if it does, drop this patch.',
  },
  {
    name: 'Android scheduleAt as UTC',
    file: 'android/src/main/java/io/ionic/backgroundrunner/plugin/api/Notification.kt',
    mark: '// meteoride: the Z means UTC',
    anchor: '            val sdf = SimpleDateFormat(jsDateFormat)\n',
    insert: (mark) => `            ${mark}
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
`,
    after: true,
    hint: 'Check whether the plugin now parses scheduleAt as UTC; if it does, drop this patch.',
  },
];

const log = (...a) => console.log('[patch-background-runner]', ...a);

if (!existsSync(PLUGIN)) {
  // A pruned tree: nothing to do, and not an error on a machine that never builds.
  log('plugin not installed; skipping');
  process.exit(0);
}

for (const patch of PATCHES) {
  const file = join(PLUGIN, patch.file);
  const src = await readFile(file, 'utf8');
  if (src.includes(patch.mark)) {
    log(`${patch.name}: already applied`);
    continue;
  }
  if (!src.includes(patch.anchor)) {
    console.error(
      `[patch-background-runner] ${patch.file} has changed and the "${patch.name}" patch no longer fits.\n` +
      `  ${patch.hint} Otherwise update its anchor. Until then the install fails on purpose.`
    );
    process.exit(1);
  }
  const block = patch.insert(patch.mark);
  await writeFile(file, src.replace(patch.anchor, patch.after ? patch.anchor + block : block + patch.anchor));
  log(`${patch.name}: applied to ${patch.file}`);
}
