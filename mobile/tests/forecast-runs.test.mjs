// A computation publishes through publish(), and only the latest one may. Two runs in
// flight — a speed preset changed while the first was still fetching — used to
// interleave their steps and their notices, and the one that finished last won.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { openMeteo, openWeather } from './fixtures/providers.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts');
const src = await readFile(join(SCRIPTS, 'app.js'), 'utf8');
const rules = await readFile(join(SCRIPTS, 'forecast-rules.js'), 'utf8');
const start = src.indexOf('let forecastRun');
const end = src.indexOf('\nfunction processWeatherData(');
assert.ok(start !== -1 && end > start && src.slice(start, end).includes('function publish('),
  'app.js no longer looks the way this test expects');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ok = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
const failed = (status) => ({ ok: false, status, text: async () => '' });
const waitFor = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };
const twoSteps = () => {
  const t1 = new Date(Date.now() + 3600000);
  const t2 = new Date(Date.now() + 7200000);
  return [[{ lat: 41, lon: 2, time: t1, distanceM: 0 }, { lat: 41.1, lon: 2, time: t2, distanceM: 1000 }], [t1, t2]];
};

/** The real computation and publish(), with the network, the cache and the page replaced. */
function harness({ provider = 'openmeteo', stubs = {} } = {}) {
  const pending = [];
  const s = {
    console, Date, Promise, setTimeout, clearTimeout, structuredClone,
    apiSource: provider, weatherData: [],
    MS_PER_DAY: 86400000, MS_PER_HOUR: 3600000, OPENMETEO_MAX_DAYS: 14, METEOBLUE_MAX_DAYS: 7,
    OPENWEATHER_MAX_DAYS: 4, OPENWEATHER_MAX_HOURS: 1, AROMEHD_MAX_HOURS: 48, isAromeHdCovered: () => false,
    values: { datetimeRoute: new Date().toISOString(), tempUnits: 'C', windUnits: 'kmh',
      apiKey: 'a-valid-looking-key', apiKeyOW: 'a-valid-looking-key' },
    logDebug() {}, t: (key) => key,
    getCache: () => null, setCache() {}, makeCacheKey: () => 'key',
    buildProviderUrl: (prov) => prov, classifyProviderError: () => 'http',
    // The request is held until the test answers it. Answering notes the outcome in the
    // recorder the request carried, the way the fetch wrapper in utils.js does.
    fetch: (url, init) => new Promise((resolve) => pending.push({ url, init, resolve })),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    renders: [], notices: [], cleared: 0, events: [], hidden: 0, alertChecks: 0, shownAlerts: [],
    activeWeatherAlerts: [], elements: {},
  };
  Object.assign(s, {
    getVal: (id) => s.values[id] ?? '',
    document: {
      getElementById: (id) => s.elements[id] || { checked: true, style: {}, querySelectorAll: () => [] },
      dispatchEvent: (ev) => s.events.push(ev),
    },
    setNotice: (msg, type) => s.notices.push([msg, type]), clearNotice: () => { s.cleared++; },
    showLoading() {}, hideLoading: () => { s.hidden++; },
    checkWeatherAlertsIndependent: async (steps, timeSteps, sink) => {
      s.alertChecks++;
      if (s.independentAlerts) sink.push(...s.independentAlerts);
      if (s.onAlertCheck) await s.onAlertCheck();
    },
    showWeatherAlerts: () => { s.shownAlerts.push(s.activeWeatherAlerts.map((a) => a.event)); },
    hideAndCleanupAlertIndicator() {},
    processWeatherData: () => { s.renders.push(s.weatherData.map((x) => x.lat)); },
    cw: { utils: { createRecorder: () => ({ ok: 0, failed: 0, lastFailStatus: '', staleAgeMs: 0 }), isOffline: () => false } },
  });
  s.window = s;
  Object.assign(s, stubs);
  vm.runInNewContext(`${rules}\n${src.slice(start, end)}`, s);
  const run = (lat) => {
    const time = new Date(Date.now() + 3600000);
    return s.fetchWeatherForSteps([{ lat, lon: 2, time, distanceM: 0 }], [time]);
  };
  const answer = (i, res) => {
    const { init, resolve } = pending[i];
    const rec = init && init.cwRecorder;
    if (rec) {
      if (res.ok) rec.ok++;
      else { rec.failed++; rec.lastFailStatus = String(res.status); }
    }
    resolve(res);
  };
  s.rendered = () => plain(s.renders);
  s.published = () => s.events.filter((e) => e.type === 'cw:forecast').map((e) => e.detail.snapshot);
  return { s, run, answer, pending };
}

test('a run replaced before it finishes publishes nothing, whichever finishes first', async () => {
  for (const order of [[1, 0], [0, 1]]) {
    const { s, run, answer, pending } = harness();
    const runs = [run(41), run(42)];
    assert.equal(pending.length, 2);
    for (const i of order) { answer(i, ok(openMeteo())); await runs[i]; }
    assert.deepEqual(s.rendered(), [[42]], `order ${order}`);
    assert.equal(s.published().length, 1, `order ${order}: one cw:forecast`);
    assert.equal(s.published()[0].steps[0].lat, 42, `order ${order}`);
    assert.equal(s.alertChecks, 1, `order ${order}: only the current run looks up alerts`);
  }
});

test('a replaced run does not hide the loading indicator of the run that replaced it', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  answer(0, ok(openMeteo())); await a;
  assert.equal(s.hidden, 0, 'A finished and hid the indicator while B was still loading');
  answer(1, ok(openMeteo())); await b;
  assert.equal(s.hidden, 1);
});

test('a replaced run does not raise the official warnings its response carried', async () => {
  const now = Math.floor(Date.now() / 1000);
  const body = (event) => ({ hourly: [{ dt: now + 3600, temp: 20, wind_speed: 3 }],
    alerts: [{ sender_name: 'AEMET', event, start: now, end: now + 6 * 3600 }] });
  const { s, run, answer } = harness({ provider: 'openweather' });
  const a = run(41);
  const b = run(42);
  answer(0, ok(body('from A'))); await a;
  assert.deepEqual(plain(s.shownAlerts), [], 'the replaced run published its warnings');
  answer(1, ok(body('from B'))); await b;
  assert.deepEqual(plain(s.shownAlerts), [['from B']]);
});

test('warnings are kept near the ride and shown only from now to its end', async () => {
  const now = Math.floor(Date.now() / 1000);
  const H = 3600;
  const warn = (event, start, end) => ({ sender_name: 'AEMET', event, start, end });
  const { s, run, answer } = harness();
  // The single step is an hour from now, so the ride starts and ends then.
  s.independentAlerts = [
    warn('long gone', now - 8 * H, now - 5 * H),     // ended before start - 4 h: not kept
    warn('just over', now - 2 * H, now - 1800),      // kept, but over before now: not shown
    warn('during', now, now + 2 * H),                 // shown
    warn('later', now + 3 * H, now + 4 * H),          // kept, but after the end: not shown
    warn('during', now, now + 2 * H),                 // the same warning from another point
  ];
  const a = run(41);
  answer(0, ok(openMeteo())); await a;
  const [snapshot] = s.published();
  assert.deepEqual(plain(snapshot.alerts.map((x) => x.event)), ['just over', 'during', 'later']);
  assert.deepEqual(plain(s.shownAlerts), [['during']]);
});

test('a computation without warnings clears the warnings of the one before', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { s, run, answer } = harness();
  let hides = 0;
  s.hideAndCleanupAlertIndicator = () => { hides++; };
  s.independentAlerts = [{ sender_name: 'AEMET', event: 'Viento', start: now, end: now + 7200 }];
  const a = run(41);
  answer(0, ok(openMeteo())); await a;
  s.independentAlerts = null;
  const b = run(42);
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual(plain(s.shownAlerts), [['Viento']]);
  assert.deepEqual(plain(s.activeWeatherAlerts), []);
  assert.equal(hides, 2);
});

test('a run replaced while it looks up official warnings publishes nothing', async () => {
  const { s, run, answer } = harness();
  let b;
  s.onAlertCheck = () => { s.onAlertCheck = null; b = run(42); };
  const a = run(41);
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual(s.rendered(), [], 'A rendered after B had replaced it');
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual(s.rendered(), [[42]]);
});

test('publish refuses a snapshot from a computation that is no longer the latest', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  const stale = { computationId: 1, steps: [], outcome: {}, settings: {} };
  assert.equal(s.publish(stale), false);
  assert.deepEqual(s.rendered(), []);
  assert.equal(s.hidden, 0);
  assert.deepEqual(s.published(), []);
  answer(0, ok(openMeteo())); await a;
  answer(1, ok(openMeteo())); await b;
});

test('a run on its own publishes the table, a clean notice, cw:forecast and the indicator, once each', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual(s.rendered(), [[41]]);
  assert.equal(s.hidden, 1);
  assert.equal(s.alertChecks, 1);
  assert.deepEqual(s.notices, []);
  assert.equal(s.cleared, 1);
  const [snapshot] = s.published();
  assert.equal(snapshot.origin, 'live');
  assert.equal(snapshot.outcome.usableSteps, 1);
  assert.deepEqual(plain(snapshot.steps[0].payload), openMeteo());
  assert.equal(s.events[0].detail.steps, s.weatherData, 'steps stay the rendered mirror, for the ride watch');
});

test('a replaced run whose provider failed leaves no notice over the run that replaced it', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  answer(0, failed(503)); await a;
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual(s.notices, [], 'the failure of the replaced run became a notice');
  assert.equal(s.cleared, 1);
});

test('an empty table whose request failed says the provider is not responding', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  answer(0, failed(503)); await a;
  assert.deepEqual(s.notices, [['provider_unreachable', 'warn']]);
  const [snapshot] = s.published();
  assert.deepEqual(plain(snapshot.outcome).usableSteps, 0);
  assert.equal(snapshot.outcome.transportFailures, 1);
  assert.equal(snapshot.outcome.lastFailStatus, '503');
  assert.equal(snapshot.outcome.providers.openmeteo.httpStatus, 503);
});

test('a forecast read from the cache without connection says how old it is', async () => {
  const { s, run } = harness({ stubs: {
    getCache: (key, rec) => { if (rec) rec.staleAgeMs = 100 * 60000; return openMeteo(); },
  } });
  await run(41);
  assert.deepEqual(s.notices, [['offline_stale_forecast', 'warn']]);
});

test('settings changed while a computation is fetching do not reach the rest of it', async () => {
  const { s, answer, pending } = harness({ stubs: {
    buildProviderUrl: (prov, p, t, key, wind, temp) => `${prov}:${temp}:${key}`,
  } });
  const done = s.fetchWeatherForSteps(...twoSteps());
  assert.equal(pending[0].url, 'openmeteo:C:');
  s.apiSource = 'openweather';
  s.values.tempUnits = 'F';
  answer(0, ok(openMeteo()));
  await waitFor(() => pending.length === 2);
  assert.equal(pending[1].url, 'openmeteo:C:', 'the second step used what changed after the start');
  answer(1, ok(openMeteo()));
  await done;
  assert.deepEqual(plain(s.published()[0].settings),
    { provider: 'openmeteo', units: { temp: 'C', wind: 'kmh' }, noticeAll: true, alerts: true });
});

test('an API key changed while a computation is fetching is not used by its later steps', async () => {
  const { s, answer, pending } = harness({ provider: 'openweather', stubs: {
    buildProviderUrl: (prov, p, t, key) => `${prov}:${key}`,
  } });
  const done = s.fetchWeatherForSteps(...twoSteps());
  s.values.apiKeyOW = 'a-key-typed-later';
  answer(0, ok(openWeather('metric')));
  await waitFor(() => pending.length === 2);
  assert.equal(pending[1].url, 'openweather:a-valid-looking-key');
  answer(1, ok(openWeather('metric')));
  await done;
});

// When the chosen provider answers with an error, each branch falls back to Open-Meteo
// and, when that is cached, used to label the step with `cached2.provider` — a field
// the raw Open-Meteo JSON does not have. The step then carried no provider at all, so
// the table parsed Open-Meteo JSON as the primary provider's format.
for (const provider of ['meteoblue', 'openweather', 'aromehd']) {
  test(`a ${provider} error served from the cached Open-Meteo forecast is labelled openmeteo`, async () => {
    const cached = { hourly: { time: [] } };
    const { s, run } = harness({ provider, stubs: {
      isAromeHdCovered: () => true,
      makeCacheKey: (prov) => prov,
      getCache: (key) => (key === 'openmeteo' ? cached : null),
      fetch: async () => failed(500),
    } });
    await run(41);
    assert.deepEqual(s.rendered(), [[41]]);
    assert.deepEqual(plain(s.weatherData.map((x) => x.provider ?? null)), ['openmeteo']);
    assert.equal(s.weatherData[0].weather, cached);
  });
}
