// Takes the product site's screenshots from the real app: mobile/www (what the app ships,
// libraries vendored) served on its own port, every weather and tile request answered from
// site/fixtures/, a fixed clock and time zone, and the example route. Four scenes per
// language, on a phone and on a desktop, into site/img/shots/<code>-<scene>-<device>.jpg.
// Run: cd mobile && npm run build && npm run site:shots   (CW_SHOTS_LANG=es,de for a few)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from './build.mjs';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(SITE_DIR, '../mobile');
const PORT = 4183; // never 4173: that one is the test suite's
const BASE = `http://127.0.0.1:${PORT}`;
const fixture = (f) => readFileSync(join(SITE_DIR, 'fixtures', f));
const WEATHER = JSON.parse(fixture('weather.json'));
const WARNING = JSON.parse(fixture('warning.json'));
for (const code of LANGS) if (!WARNING.text[code]) throw new Error(`site/fixtures/warning.json: no warning text for ${code}`);
const TILE = fixture('tile.png');
// OpenStreetMap tiles of the example route's area at the zooms the shots use, fetched once
// and committed (© OpenStreetMap contributors, ODbL; credited on the page). Any other tile is
// the neutral one. A missing one at zoom 10-13 (where a fitted route lands) is reported, so a
// changed layout shows up as a gap to fill; the zoom-14 view before the route loads is not.
const missing = new Set();
function tile(path) {
  const file = join(SITE_DIR, 'fixtures/tiles', path);
  if (existsSync(file)) return readFileSync(file);
  if (!/^\/1[0-3]\//.test(path) || missing.has(path)) return TILE;
  missing.add(path);
  console.warn(`shots: no fixture tile ${path}, using the neutral one`);
  return TILE;
}

export const SCENES = ['table', 'map', 'compare', 'warning'];
export const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
// Saturday 13 June 2026, 08:00 in Madrid (UTC+2): the ride starts on the hour.
const TZ = 'Europe/Madrid';
const OFFSET = 7200;
const T0 = Date.UTC(2026, 5, 13, 6, 0);
// Date inputs follow the browser's own language, not the context locale: one browser per language.
const REGION = { es: 'es-ES', en: 'en-GB', ca: 'ca-ES', gl: 'gl-ES', eu: 'eu-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };

// Each provider sees the same day a little differently, so compare has something to show.
const NUDGE = {
  openmeteo: { temp: 0, rain: 1, gust: 0, wind: 0 },
  aromehd: { temp: -1, rain: 1.4, gust: 6, wind: 2 },
  openweather: { temp: 1, rain: 0.6, gust: -5, wind: -2 },
};
const at = (name, localHour) => WEATHER[name][((localHour % 24) + 24) % 24];
const nudged = (prov, localHour) => {
  const n = NUDGE[prov];
  return {
    temp: at('temperature_2m', localHour) + n.temp,
    rain: Math.round(at('precipitation', localHour) * n.rain * 10) / 10,
    prob: at('precipitation_probability', localHour),
    humidity: at('relative_humidity_2m', localHour),
    wind: at('wind_speed_10m', localHour) + n.wind,
    gust: at('wind_gusts_10m', localHour) + n.gust,
    dir: at('winddirection_10m', localHour),
    code: at('weathercode', localHour),
    uv: at('uv_index', localHour),
    isDay: at('is_day', localHour),
    cloud: at('cloud_cover', localHour),
  };
};

function openMeteo(url) {
  const prov = url.searchParams.get('models') ? 'aromehd' : 'openmeteo';
  const from = Date.parse(`${url.searchParams.get('start_date')}T00:00:00Z`);
  const to = Date.parse(`${url.searchParams.get('end_date')}T23:00:00Z`);
  const hourly = { time: [], temperature_2m: [], precipitation: [], precipitation_probability: [], relative_humidity_2m: [],
    wind_speed_10m: [], wind_gusts_10m: [], winddirection_10m: [], weathercode: [], uv_index: [], is_day: [], cloud_cover: [] };
  for (let t = from; t <= to; t += 3600000) {
    const w = nudged(prov, new Date(t).getUTCHours());
    hourly.time.push(new Date(t).toISOString().slice(0, 16));
    hourly.temperature_2m.push(w.temp);
    hourly.precipitation.push(w.rain);
    hourly.precipitation_probability.push(w.prob);
    hourly.relative_humidity_2m.push(w.humidity);
    hourly.wind_speed_10m.push(w.wind);
    hourly.wind_gusts_10m.push(w.gust);
    hourly.winddirection_10m.push(w.dir);
    hourly.weathercode.push(w.code);
    hourly.uv_index.push(w.uv);
    hourly.is_day.push(w.isDay);
    hourly.cloud_cover.push(w.cloud);
  }
  return { latitude: Number(url.searchParams.get('latitude')), longitude: Number(url.searchParams.get('longitude')),
    utc_offset_seconds: OFFSET, timezone: TZ, hourly };
}

// WMO code → OpenWeather condition id and icon.
const OW_CODE = { 0: [800, '01'], 1: [801, '02'], 2: [802, '03'], 3: [804, '04'], 61: [500, '10'], 63: [501, '10'], 80: [520, '09'] };
function openWeather(url, code) {
  const sec = Math.floor(T0 / 1000);
  const hourly = Array.from({ length: 48 }, (_, i) => {
    const dt = sec - 3600 + i * 3600;
    const w = nudged('openweather', new Date((dt + OFFSET) * 1000).getUTCHours());
    const [id, icon] = OW_CODE[w.code];
    return { dt, temp: w.temp, humidity: w.humidity, wind_speed: w.wind / 3.6, wind_gust: w.gust / 3.6, wind_deg: w.dir,
      pop: w.prob / 100, uvi: w.uv, clouds: w.cloud, weather: [{ id, icon: `${icon}${w.isDay ? 'd' : 'n'}` }],
      ...(w.rain ? { rain: { '1h': w.rain } } : {}) };
  });
  const alerts = code ? [{ sender_name: WARNING.sender_name, ...WARNING.text[code],
    start: sec + WARNING.start * 3600, end: sec + WARNING.end * 3600 }] : [];
  return { lat: Number(url.searchParams.get('lat')), lon: Number(url.searchParams.get('lon')), timezone: TZ,
    timezone_offset: OFFSET, current: { dt: sec, uvi: 2 }, hourly, daily: [], alerts };
}

// `warning`: the language to send the official warning in, or nothing for no warning.
async function stub(page, warning) {
  // Anything else from outside would make a shot depend on the network. Registered first:
  // the last matching route wins.
  await page.route((u) => !u.href.startsWith(BASE) && /^https?:/.test(u.protocol), (r) => r.abort());
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route((u) => u.hostname === 'api.open-meteo.com', (r) => json(r, openMeteo(new URL(r.request().url()))));
  await page.route((u) => u.hostname === 'api.openweathermap.org', (r) => json(r, openWeather(new URL(r.request().url()), warning)));
  await page.route((u) => u.hostname.endsWith('tile.openstreetmap.org'), (r) => r.fulfill({ status: 200, contentType: 'image/png', body: tile(new URL(r.request().url()).pathname) }));
}

async function shootOne(browser, code, scene, device, out) {
  const context = await browser.newContext({ ...DEVICES[device], timezoneId: TZ, locale: REGION[code], reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    // Installed, not frozen: Leaflet fades tiles in by comparing Date.now() across frames,
    // so with a fixed time (setFixedTime) no tile ever became visible. Starting at the same
    // instant each time is what keeps the shots identical run to run (checked by md5).
    await page.clock.install({ time: T0 - 60000 });
    await page.addInitScript((s) => { if (!localStorage.getItem('cwSettings')) localStorage.setItem('cwSettings', s); },
      JSON.stringify({ language: code, apiKeyOW: 'a-valid-looking-key', showWeatherAlerts: scene === 'warning',
        apiSource: 'openmeteo', windUnits: 'kmh', cyclingSpeed: 20, intervalSelect: '15' }));
    await stub(page, scene === 'warning' ? code : null);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => !!window.map, null, { timeout: 15000 });
    await page.locator('#exampleRoute').click();
    await page.waitForFunction(() => document.querySelectorAll('#weatherTable td').length > 0, null, { timeout: 15000 });
    if (scene === 'compare') {
      await page.evaluate(() => {
        const sel = document.getElementById('apiSource');
        sel.value = 'compare';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => document.getElementById('weatherTable').classList.contains('compare-mode'), null, { timeout: 15000 });
    }
    if (scene === 'warning') await page.locator('#weather-alerts-container .weather-alert').first().waitFor();
    // The app scrolls the forecast into view by itself, retrying for a while; let it finish.
    await page.waitForTimeout(1500);
    // A tap on a column is how the app ties a stretch of the table to its point on the map
    // (it pans there): the map shots show the rainy 09:30 stretch picked, the phone's table
    // shot is scrolled to the rain.
    const col = scene === 'map' ? 6 : scene === 'table' && device === 'phone' ? 4 : null;
    if (col != null) {
      await page.locator(`#weatherTable [data-col="${col}"]`).first().click();
      await page.waitForTimeout(800);
    }
    if (scene === 'map') {
      // The page barely scrolls on either device (a phone gives the map at most 40vh under
      // the table), so the map shot is told apart from the table shot the way a rider would
      // look closer: one step of zoom on the picked stretch, the map at its full height.
      // Without animation: Leaflet's zoom animation never finished under the fake clock, and
      // its pan to the picked point had not either; centred on that point's marker instead.
      await page.evaluate(() => {
        const picked = Object.values(window.map._layers)
          .find((l) => l.getElement && l.getElement()?.classList.contains('is-selected'));
        window.map.setView(picked.getLatLng(), window.map.getZoom() + 1, { animate: false });
      });
      await page.waitForTimeout(2000);
      await page.evaluate((phone) => (phone
        ? document.getElementById('map').scrollIntoView({ block: 'end' })
        : (document.body.scrollTop = 0)), device === 'phone');
    } else if (device === 'desktop') {
      // Every desktop shot starts at the top, header whole: the app's own nudge cut it by
      // 24 px, and scrolling the table into view cut it by 12 (the table runs on past the
      // bottom of 900 px either way).
      await page.evaluate(() => { document.body.scrollTop = 0; document.documentElement.scrollTop = 0; });
    }
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(out, `${code}-${scene}-${device}.jpg`), type: 'jpeg', quality: 82 });
  } finally {
    await context.close();
  }
}

// Resolves when our own server says it is listening (server.mjs prints "serving … on"). A
// fetch alone could be answered by whatever else holds the port; an exit first is that case.
function serverUp(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`shots: no server on ${BASE} after 10 s`)), 10000);
    server.stdout.on('data', (d) => { if (/serving .* on /.test(d)) { clearTimeout(timer); resolve(); } });
    server.once('exit', (c) => { clearTimeout(timer); reject(new Error(`shots: the server exited (code ${c}); is port ${PORT} taken?`)); });
  });
}

export async function shoot({ langs = LANGS, out = join(SITE_DIR, 'img/shots') } = {}) {
  // Playwright lives in mobile/node_modules, out of this folder's reach for a bare import.
  const { chromium } = createRequire(join(MOBILE, 'package.json'))('@playwright/test');
  await mkdir(out, { recursive: true });
  const server = spawn(process.execPath, [join(MOBILE, 'tests/server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await serverUp(server);
    for (const code of langs) {
      const browser = await chromium.launch({ args: [`--lang=${REGION[code]}`], executablePath: process.env.CHROMIUM_PATH || undefined });
      try {
        const jobs = SCENES.flatMap((scene) => Object.keys(DEVICES).map((device) => [scene, device]));
        await Promise.all(Array.from({ length: 4 }, async () => {
          for (let job; (job = jobs.shift());) {
            await shootOne(browser, code, ...job, out);
            console.log(`shots: ${code}-${job.join('-')}`);
          }
        }));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.kill();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const langs = process.env.CW_SHOTS_LANG ? process.env.CW_SHOTS_LANG.split(',') : LANGS;
  shoot({ langs }).catch((e) => { console.error(e); process.exit(1); });
}
