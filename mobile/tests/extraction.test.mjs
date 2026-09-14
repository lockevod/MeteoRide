// What processWeatherData makes of each provider's answer, pinned before the extraction
// moves into forecast-rules.js. The golden file is generated from the code as it was
// before the refactor; regenerate it only on purpose:
//   UPDATE_GOLDEN=1 node --test tests/extraction.test.mjs
process.env.TZ = 'Europe/Madrid';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { openMeteo, openWeather, STEP_TIMES } from './fixtures/providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '../../public/scripts');
const GOLDEN = join(HERE, 'fixtures/extraction-golden.json');

const app = await readFile(join(SCRIPTS, 'app.js'), 'utf8');
const utils = await readFile(join(SCRIPTS, 'utils.js'), 'utf8');
const rules = await readFile(join(SCRIPTS, 'forecast-rules.js'), 'utf8');

function between(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a !== -1 && b > a, `app no longer looks the way this test slices it: ${from}`);
  return src.slice(a, b);
}

// The real code, not copies: the functions processWeatherData leans on for extraction.
// Presentation helpers (luminance, cell formatting, table) are stubbed below because
// the characterization is about which values are read, not how they are drawn.
const code = [
  app.match(/const PRECIP_MIN\s*=[^;]*;/)[0],
  between(app, 'function fallbackWmoFromBasics(', '\n// Presentation helper'),
  between(app, 'function reconcileAromeVsOmCode(', '\n}\n') + '\n}\n',
  between(utils, 'function safeNum(', '\n  function normalUnit('),
  between(utils, 'function findClosestIndex(', '\n  function findClosestFutureIndex('),
  between(utils, 'function windToUnits(', '\n  // NEW: pick which wind'),
  rules,
  between(app, 'function processWeatherData(', '\nfunction buildSunHeaderCell('),
].join('\n');

const FIELDS = ['temp', 'windSpeed', 'windDir', 'windGust', 'humidity', 'precipitation',
  'precipProb', 'weatherCode', 'uvindex', 'isDaylight', 'cloudCover', '__useMinutely', 'timeLabel'];

function run(provider, payload, units = { temp: 'C', wind: 'kmh' }, events = [], payloadUnits) {
  const steps = STEP_TIMES.map((iso) => ({
    lat: 41.4, lon: 2.2, time: new Date(iso), provider, payloadUnits, weather: structuredClone(payload),
  }));
  const ctx = {
    console, structuredClone,
    apiSource: provider,
    weatherData: steps,
    getVal: (id) => ({ tempUnits: units.temp, windUnits: units.wind }[id] ?? ''),
    formatTime: (d) => new Date(d).toISOString().slice(11, 16),
    computeLuminance: () => null,
    formatWindCell: () => '',
    formatRainCell: () => '',
    renderWeatherTable() {},
    setTimeout: () => 0,
    map: null,
    trackLayer: null,
    SunCalc: {
      getPosition: (d) => {
        const h = new Date(d).getUTCHours();
        return { altitude: h >= 5 && h < 18 ? 1 : -1 };
      },
    },
    document: { getElementById: () => null, dispatchEvent: (e) => events.push(e) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  ctx.window = ctx;
  vm.runInNewContext(`${code}\nprocessWeatherData();`, ctx);
  return steps.map((s) => Object.fromEntries(
    FIELDS.map((f) => [f, s[f] === undefined ? '(undefined)' : s[f]])));
}

const CASES = {
  'openmeteo': () => run('openmeteo', openMeteo()),
  'openmeteo-no-minutely': () => run('openmeteo', openMeteo({ minutely: false })),
  'openmeteo-wind-ms': () => run('openmeteo', openMeteo(), { temp: 'C', wind: 'ms' }),
  'aromehd': () => run('aromehd', openMeteo()),
  'aromehd-missing-code-and-day': () => run('aromehd', openMeteo({ drop: ['weathercode', 'is_day'] })),
  'openweather-metric': () => run('openweather', openWeather('metric')),
  'openweather-imperial': () => run('openweather', openWeather('imperial'), { temp: 'F', wind: 'kmh' }),
};

const actual = Object.fromEntries(
  Object.entries(CASES).map(([name, make]) => [name, JSON.parse(JSON.stringify(make()))]));

if (process.env.UPDATE_GOLDEN) {
  await writeFile(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
}
const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));

test('the golden covers every case and no other', () => {
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(CASES).sort());
});

// Guards the golden itself: if it were generated from broken code these would not hold.
test('the golden is about the hours the fixtures were built for', () => {
  const om = golden.openmeteo;
  assert.equal(om[0].__useMinutely, true);
  assert.equal(om[0].temp, 100);            // 08:00 local → quarter 0
  assert.equal(om[1].temp, 101);            // 08:20 local → nearest quarter 08:15
  assert.equal(om[3].temp, 114);            // 11:30 local → quarter 14
  assert.equal(om[4].__useMinutely, false); // 16:10 local is outside minutely_15
  assert.equal(om[4].temp, 26);             // nearest hour 16:00 → slot 16
  assert.equal(golden['openmeteo-no-minutely'][2].temp, 19); // 08:40 → nearest hour 09:00
  assert.equal(golden['openweather-metric'][4].temp, 26);    // 16:10 local → 16:00
  assert.equal(golden['openweather-metric'][5].temp, 57);    // beyond range: last hour, not daily
  // Wind read in m/s, outside minutely_15: pins the unit conversion, not just kmh's.
  assert.equal(golden['openmeteo-wind-ms'][4].windSpeed, 5.833333333333333);
  // weathercode and is_day dropped: weatherCode falls back to the synthesized value (63 with
  // the fields present, 80 without), pinning the AROME fallback path.
  assert.equal(golden['aromehd-missing-code-and-day'][4].weatherCode, 80);
});

for (const name of Object.keys(CASES)) {
  test(`processWeatherData extracts ${name} as before`, () => {
    assert.deepEqual(actual[name], golden[name]);
  });
}

// cw:forecast announces a computation, and only publish() may send it: a repaint (a
// language or unit change) is not a new forecast, and used to arm the ride watch again.
test('repainting the table announces nothing', () => {
  const events = [];
  run('openmeteo', openMeteo(), undefined, events);
  assert.equal(events.length, 0);
});

// A cached metric answer repainted after switching to °F used to have its wind read as
// mph. The units the answer was requested in travel with the step now.
test('an OpenWeather answer is read in the units it was requested in, not the ones shown now', () => {
  const metric = run('openweather', openWeather('metric'));
  const repainted = run('openweather', openWeather('metric'), { temp: 'F', wind: 'kmh' }, [], 'metric');
  assert.deepEqual(repainted.map((x) => x.windSpeed), metric.map((x) => x.windSpeed));
});
