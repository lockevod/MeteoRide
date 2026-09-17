// native.js is one IIFE that boots itself, so these tests load the real file in a VM
// with a stub bridge and stop it short of boot() — `document.readyState === 'loading'`
// parks the boot on a DOMContentLoaded that never fires. What is left are the handles
// the file hangs off `window`, which is how the rest of the app reaches it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const NATIVE_JS = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts/native.js');

/** Loads native.js against a stub Android bridge and returns its window. */
async function loadNative({ plugins = {}, configOpen = false, alertsOn = false } = {}) {
  const menu = { style: { display: configOpen ? 'block' : 'none' } };
  const rideAlerts = { checked: alertsOn };
  const routes = [];

  const window = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: plugins,
    },
    location: { pathname: '/index.html', search: '' },
    history: { back: () => { window.history.backs++; } },
    cwReceiveRoute: (req) => routes.push(req),
    addEventListener() {},
  };
  window.history.backs = 0;

  const document = {
    readyState: 'loading',            // keeps boot() parked
    documentElement: { classList: { add() {} } },
    addEventListener() {},
    querySelector: () => null,
    getElementById: (id) => {
      if (id === 'configMenu') return menu;
      if (id === 'rideAlerts') return rideAlerts;
      return null;
    },
  };

  const sandbox = { window, document, console, localStorage: { getItem: () => null }, navigator: { onLine: true } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(await readFile(NATIVE_JS, 'utf8'), sandbox, { filename: 'native.js' });
  return { window, menu, routes };
}

test('a batch of eleven shared routes is drained whole, not ten of it', async () => {
  let offered = 11;
  const { window, routes } = await loadNative({
    plugins: {
      MeteoRideShare: {
        consumePending: async () =>
          (offered-- > 0 ? { gpx: `<gpx n="${11 - offered}"/>`, name: `route-${11 - offered}.gpx` } : null),
      },
    },
  });

  await window.cwConsumePendingShare();
  assert.equal(routes.length, 11, 'the drain stopped before the inbox was empty');
  assert.ok(offered <= 0, 'the drain never saw the empty answer that ends it');
});

test('the drain still stops on an empty inbox instead of spinning', async () => {
  let asked = 0;
  const { window, routes } = await loadNative({
    plugins: { MeteoRideShare: { consumePending: async () => { asked++; return null; } } },
  });

  await window.cwConsumePendingShare();
  assert.equal(routes.length, 0);
  assert.equal(asked, 1, 'an empty inbox was asked more than once');
});

test('an inbox that never empties stops the drain instead of looping for ever', async () => {
  // Both native stores hand a route back even when the delete that should remove it
  // fails — they log and carry on. Before the ceiling, the repeat flag turned that into
  // an endless re-import of the same file: the app stays responsive and keeps loading
  // the same route until it is force-quit. This test hangs if the ceiling goes.
  let asked = 0;
  const { window, routes } = await loadNative({
    plugins: {
      MeteoRideShare: {
        consumePending: async () => { asked++; return { gpx: '<gpx/>', name: 'stuck.gpx' }; },
      },
    },
  });

  await window.cwConsumePendingShare();
  assert.ok(routes.length >= 10, 'the drain gave up before finishing even one batch');
  assert.ok(routes.length <= 210, `the drain delivered ${routes.length} routes: no ceiling`);
  assert.equal(asked, routes.length, 'the drain stopped asking before it stopped injecting');
});

test('Back closes the config panel instead of leaving the app', async () => {
  let exited = false;
  const { window, menu } = await loadNative({
    plugins: { App: { exitApp: () => { exited = true; } } },
    configOpen: true,
  });

  window.cwHandleBack({ canGoBack: false });
  assert.equal(menu.style.display, 'none', 'the panel stayed open');
  assert.equal(exited, false, 'the app was left with the panel open');
});

test('Back walks the pages before it leaves the app', async () => {
  let exited = false;
  const { window } = await loadNative({
    plugins: { App: { exitApp: () => { exited = true; } } },
  });
  window.location.pathname = '/help.html';

  window.cwHandleBack({ canGoBack: true });
  assert.equal(window.history.backs, 1, 'Back did not go back a page');
  assert.equal(exited, false, 'Back left the app from a page it could go back from');
});

test('Back still leaves the app from a clear index', async () => {
  let exited = false;
  const { window } = await loadNative({
    plugins: { App: { exitApp: () => { exited = true; } } },
  });

  window.cwHandleBack({ canGoBack: false });
  assert.equal(exited, true, 'Back no longer leaves the app');
  assert.equal(window.history.backs, 0);
});

/* ---------- the key the watch keeps its own copy of ---------- */

/*
 * These once fed `revokeWatchKey` a hand-written payload using the *snapshot's* field
 * names, not the ones `saveSettings` persists — so they agreed with a bug that made
 * every settings save wipe the key from the armed watch. The behaviour is now covered
 * end to end through the real form in smoke.spec.mjs; what is left here is the contract
 * those two files share, read out of utils.js rather than assumed.
 */

test('revokeWatchKey reads the field names saveSettings actually writes', async () => {
  const utils = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts/utils.js'), 'utf8');
  const saved = utils.slice(utils.indexOf('function saveSettings()'));
  const body = saved.slice(0, saved.indexOf('JSON.stringify'));
  const native = await readFile(NATIVE_JS, 'utf8');
  const revoke = native.slice(native.indexOf('async function revokeWatchKey'));
  const read = [...revoke.slice(0, revoke.indexOf('\n  }')).matchAll(/saved\.(\w+)/g)].map((m) => m[1]);

  assert.ok(read.length >= 2, 'revokeWatchKey no longer reads the saved settings by name');
  for (const field of read) {
    assert.match(
      body, new RegExp(`\\b${field}\\s*:`),
      `revokeWatchKey reads "${field}", which saveSettings does not write — that is how it ` +
      'came to wipe the key on every save. The names are utils.js\'s, not the snapshot\'s.'
    );
  }
});
