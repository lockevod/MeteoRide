// A computation publishes through publish(), and only the current one may: the latest
// computation launched, of the route last confirmed. Two computations in flight used to
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
const start = src.indexOf('function segmentRouteByTime(');
const end = src.indexOf('\nfunction processWeatherData(');
const slice = src.slice(start, end);
assert.ok(start !== -1 && end > start && ['let confirmedRoute', 'window.cwLaunchComputation', 'function publish(']
  .every((s) => slice.includes(s)), 'app.js no longer looks the way this test expects');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ok = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
const failed = (status) => ({ ok: false, status, text: async () => '' });
const waitFor = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };
const haversine = (a, b) => {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
// A line whose two points coincide is one step; 41 → 41.1 at 12 km/h and an hour's
// interval is two, the start and the arrival.
const line = (lat, lat2 = lat) => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[2, lat], [2, lat2]] } }] });

/** The real launch, computation and publish(), with the network, the cache and the page replaced. */
function harness({ provider = 'openmeteo', stubs = {} } = {}) {
  const pending = [];
  const quiet = { log() {}, debug() {}, warn() {}, error: console.error };
  const s = {
    console: quiet, Date, Promise, setTimeout, clearTimeout, structuredClone,
    apiSource: provider, weatherData: [], offline: false,
    MS_PER_DAY: 86400000, MS_PER_HOUR: 3600000, OPENMETEO_MAX_DAYS: 14, METEOBLUE_MAX_DAYS: 7,
    OPENWEATHER_MAX_DAYS: 4, OPENWEATHER_MAX_HOURS: 1, AROMEHD_MAX_HOURS: 48, isAromeHdCovered: () => false,
    values: { datetimeRoute: new Date().toISOString(), cyclingSpeed: '12', intervalSelect: '60',
      tempUnits: 'C', windUnits: 'kmh', apiKey: 'a-valid-looking-key', apiKeyOW: 'a-valid-looking-key' },
    dateValidation: { valid: true },
    logDebug() {}, t: (key) => key, haversine,
    getValidatedDateTime: () => new Date(Date.now() + 3600000),
    getCache: () => null, setCache() {}, makeCacheKey: () => 'key',
    buildProviderUrl: (prov) => prov, classifyProviderError: () => 'http',
    // The request is held until the test answers it. Answering notes the outcome in the
    // recorder the request carried, the way the fetch wrapper in utils.js does.
    fetch: (url, init) => new Promise((resolve, reject) => pending.push({ url, init, resolve, reject })),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    renders: [], notices: [], cleared: 0, events: [], alertChecks: 0, shownAlerts: [],
    activeWeatherAlerts: [], elements: {}, claims: new Set(), released: [], runs: [],
  };
  Object.assign(s, {
    getVal: (id) => s.values[id] ?? '',
    validateDateRange: () => s.dateValidation,
    document: {
      getElementById: (id) => s.elements[id] || { checked: true, style: {}, querySelectorAll: () => [] },
      dispatchEvent: (ev) => s.events.push(ev),
    },
    setNotice: (msg, type) => s.notices.push([msg, type]), clearNotice: () => { s.cleared++; },
    checkWeatherAlertsIndependent: async (steps, timeSteps, sink) => {
      s.alertChecks++;
      if (s.independentAlerts) sink.push(...s.independentAlerts);
      if (s.onAlertCheck) await s.onAlertCheck();
    },
    showWeatherAlerts: () => { s.shownAlerts.push(s.activeWeatherAlerts.map((a) => a.event)); },
    hideAndCleanupAlertIndicator() {},
    processWeatherData: () => { s.renders.push(s.weatherData.map((x) => x.lat)); },
    cw: {
      utils: {
        createRecorder: () => ({ ok: 0, failed: 0, lastFailStatus: '', staleAgeMs: 0, offline: false }),
        isOffline: () => s.offline,
      },
      claimLoading: (owner) => s.claims.add(owner),
      releaseLoading: (owner) => { s.released.push(owner); s.claims.delete(owner); },
      releaseLoadingPrefix: (prefix) => { for (const o of [...s.claims]) if (o.startsWith(prefix)) s.cw.releaseLoading(o); },
    },
  });
  s.window = s;
  Object.assign(s, stubs);
  vm.createContext(s);
  vm.runInContext(`${rules}\n${slice}`, s);
  // Keep every computation's promise so a test can wait for it to end.
  const compute = s.fetchWeatherForSteps;
  s.fetchWeatherForSteps = (...args) => { const p = compute(...args); s.runs.push(p); return p; };

  /** Confirms a route, the way committing a request does, without launching anything. */
  const confirm = (requestId, geojson) => vm.runInContext(
    `confirmedRoute = { requestId: ${requestId}, name: 'r${requestId}.gpx', fingerprint: 'fp${requestId}', text: '', geojson: ${JSON.stringify(geojson)} };`, s);
  /** Launches a computation of `geojson` as request `requestId`; resolves when it ends. */
  const launch = (geojson, requestId = 1) => {
    confirm(requestId, geojson);
    const before = s.runs.length;
    s.cwLaunchComputation();
    return s.runs.length > before ? s.runs[s.runs.length - 1] : Promise.resolve();
  };
  const run = (lat, requestId) => launch(line(lat), requestId);
  const answer = (i, res) => {
    const { init, resolve } = pending[i];
    const rec = init && init.cwRecorder;
    if (rec) {
      if (res.ok) rec.ok++;
      else { rec.failed++; rec.lastFailStatus = String(res.status); if (s.offline) rec.offline = true; }
    }
    resolve(res);
  };
  s.rendered = () => plain(s.renders);
  s.published = () => s.events.filter((e) => e.type === 'cw:forecast').map((e) => e.detail.snapshot);
  return { s, run, launch, confirm, answer, pending };
}

test('a computation replaced by another publishes nothing, whichever finishes first', async () => {
  for (const order of [[1, 0], [0, 1]]) {
    const { s, run, answer, pending } = harness();
    const runs = [run(41), run(42)];
    assert.equal(pending.length, 2);
    for (const i of order) { answer(i, ok(openMeteo())); await runs[i]; }
    assert.deepEqual(s.rendered(), [[42]], `order ${order}`);
    assert.equal(s.published().length, 1, `order ${order}: one cw:forecast`);
    assert.equal(s.published()[0].steps[0].lat, 42, `order ${order}`);
    assert.equal(s.alertChecks, 1, `order ${order}: only the current computation looks up alerts`);
  }
});

test('a computation of a route replaced by another confirmation stops and publishes nothing', async () => {
  const { s, launch, confirm, answer, pending } = harness();
  const a = launch(line(41, 41.1), 1);
  // Request 2 confirms its route and has not launched yet: A is still the latest
  // computation, but of a route no longer on screen.
  confirm(2, line(42));
  answer(0, ok(openMeteo()));
  // A's second step would follow ~70 ms after its first answer.
  await new Promise((r) => setTimeout(r, 150));
  await a;
  assert.equal(pending.length, 1, 'A kept fetching for a route no longer on screen');
  assert.equal(s.alertChecks, 0);
  assert.deepEqual(s.rendered(), []);
  assert.deepEqual(s.published(), []);
  const b = s.cwLaunchComputation();
  assert.equal(b, 2);
  answer(1, ok(openMeteo())); await s.runs[1];
  assert.deepEqual(s.rendered(), [[42]]);
  assert.deepEqual(plain(s.published().map((x) => [x.requestId, x.computationId])), [[2, 2]]);
});

test('a snapshot carries its identities and the route it was computed for', async () => {
  const { s, run, answer } = harness();
  const a = run(41, 7);
  answer(0, ok(openMeteo())); await a;
  const [snapshot] = s.published();
  assert.equal(snapshot.requestId, 7);
  assert.equal(snapshot.computationId, 1);
  assert.deepEqual(plain(snapshot.route), { name: 'r7.gpx', fingerprint: 'fp7' });
});

test('a replaced computation does not let go of the indicator claimed by the one replacing it', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  assert.deepEqual([...s.claims], ['forecast:2'], 'launching B dropped A\'s claim');
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual([...s.claims], ['forecast:2'], 'A finished and let go of B\'s claim');
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual([...s.claims], []);
});

test('each computation notes its answers in its own recorder', async () => {
  const { s, run, answer, pending } = harness();
  const a = run(41);
  const b = run(42);
  assert.notEqual(pending[0].init.cwRecorder, pending[1].init.cwRecorder);
  answer(0, failed(503));
  answer(1, ok(openMeteo()));
  await a; await b;
  const [snapshot] = s.published();
  assert.equal(snapshot.outcome.transportFailures, 0, 'A\'s failure reached B\'s outcome');
  assert.equal(pending[0].init.cwRecorder.failed, 1);
});

test('a replaced computation does not raise the official warnings its response carried', async () => {
  const now = Math.floor(Date.now() / 1000);
  const body = (event) => ({ hourly: [{ dt: now + 3600, temp: 20, wind_speed: 3 }],
    alerts: [{ sender_name: 'AEMET', event, start: now, end: now + 6 * 3600 }] });
  const { s, run, answer } = harness({ provider: 'openweather' });
  const a = run(41);
  const b = run(42);
  answer(0, ok(body('from A'))); await a;
  assert.deepEqual(plain(s.shownAlerts), [], 'the replaced computation published its warnings');
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

test('a computation replaced while it looks up official warnings publishes nothing', async () => {
  const { s, run, answer } = harness();
  let b;
  s.onAlertCheck = () => { s.onAlertCheck = null; b = run(42); };
  const a = run(41);
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual(s.rendered(), [], 'A rendered after B had replaced it');
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual(s.rendered(), [[42]]);
});

test('a computation replaced mid-step stops fetching its remaining steps', async () => {
  const { s, launch, run, answer, pending } = harness();
  launch(line(41, 41.1));
  const b = run(42);
  assert.equal(pending.length, 2, 'A and B each made their first request');
  answer(0, ok(openMeteo()));
  // A's second step would follow ~70 ms after its first answer; give it time to
  // (wrongly) show up before checking it never does.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pending.length, 2, 'A kept fetching after B replaced it');
  answer(1, ok(openMeteo()));
  await b;
  assert.equal(s.published().length, 1);
});

test('publish refuses a snapshot that is not the current computation', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  const snap = (ids) => ({ ...ids, steps: [], outcome: {}, settings: {}, alerts: [] });
  assert.equal(s.publish(snap({ requestId: 1, computationId: 1 })), false);
  assert.equal(s.publish(snap({ computationId: 2 })), false, 'no requestId');
  assert.equal(s.publish(snap({ requestId: 1 })), false, 'no computationId');
  assert.deepEqual(s.rendered(), []);
  assert.deepEqual(s.released, ['forecast:1']);
  assert.deepEqual(s.published(), []);
  answer(0, ok(openMeteo())); await a;
  answer(1, ok(openMeteo())); await b;
});

test('a computation on its own publishes the table, a clean notice, cw:forecast and lets go of the indicator, once each', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  assert.deepEqual([...s.claims], ['forecast:1']);
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual(s.rendered(), [[41]]);
  assert.deepEqual(s.released, ['forecast:1']);
  assert.deepEqual([...s.claims], []);
  assert.equal(s.alertChecks, 1);
  assert.deepEqual(s.notices, []);
  assert.equal(s.cleared, 1);
  const [snapshot] = s.published();
  assert.equal(snapshot.origin, 'live');
  assert.equal(snapshot.outcome.usableSteps, 1);
  assert.deepEqual(plain(snapshot.steps[0].payload), openMeteo());
  assert.equal(s.events[0].detail.steps, s.weatherData, 'steps stay the rendered mirror, for the ride watch');
  assert.equal(s.cwHasCurrentForecast(), true);
});

test('a current computation that throws lets go of its claim and says so; a replaced one says nothing', async () => {
  const boom = { checkWeatherAlertsIndependent: async () => { throw new Error('boom'); } };
  let h = harness({ stubs: boom });
  let a = h.run(41);
  h.answer(0, ok(openMeteo())); await a;
  assert.deepEqual(h.s.notices, [['error_api', 'error']]);
  assert.deepEqual([...h.s.claims], []);
  assert.deepEqual(h.s.published(), []);
  assert.equal(h.s.cwHasCurrentForecast(), false, 'nothing current: a request ending may recompute it');

  h = harness({ stubs: boom });
  a = h.run(41);
  const b = h.run(42);
  h.answer(0, ok(openMeteo())); await a;
  assert.deepEqual(h.s.notices, []);
  assert.deepEqual([...h.s.claims], ['forecast:2']);
  h.answer(1, ok(openMeteo())); await b;
});

test('a computation that throws before it fetches lets go of its claim, says so and is not current', async () => {
  const breaks = {
    'while segmenting the route': (s) => { s.getVal = () => { throw new Error('boom'); }; },
    'at the start of the computation': (s) => { s.cw.utils.createRecorder = () => { throw new Error('boom'); }; },
  };
  for (const [where, breakIt] of Object.entries(breaks)) {
    const { s, run } = harness();
    breakIt(s);
    try { await run(41); } catch (_) { /* asserted below */ }
    assert.deepEqual([...s.claims], [], `${where}: the claim stayed`);
    assert.equal(s.cwHasCurrentForecast(), false, `${where}: a request ending would never compute it again`);
    assert.deepEqual(s.notices, [['error_api', 'error']], where);
  }
});

test('a computation that throws lets go of its claim first, even when saying so throws too', async () => {
  const breaks = {
    'while segmenting the route': (s) => { s.getVal = () => { throw new Error('boom'); }; },
    'at the start of the computation': (s) => { s.cw.utils.createRecorder = () => { throw new Error('boom'); }; },
  };
  for (const [where, breakIt] of Object.entries(breaks)) {
    const { s, run } = harness();
    breakIt(s);
    s.logDebug = () => { throw new Error('log'); };
    s.setNotice = () => { throw new Error('notice'); };
    try { await run(41); } catch (_) { /* asserted below */ }
    assert.deepEqual([...s.claims], [], `${where}: the claim stayed`);
    assert.equal(s.cwHasCurrentForecast(), false, where);
  }
});

test('a start date that is empty or not a date says so, and leaves nothing current', async () => {
  let h = harness();
  h.s.values.datetimeRoute = '';
  await h.run(41);
  assert.deepEqual(h.s.notices, [['route_date_empty', 'error']]);
  assert.deepEqual([...h.s.claims], []);
  assert.equal(h.s.cwHasCurrentForecast(), false);

  h = harness();
  h.s.getValidatedDateTime = () => new Date(NaN);
  await h.run(41);
  assert.deepEqual(h.s.notices, [['route_date_invalid', 'error']]);
  assert.deepEqual([...h.s.claims], []);
});

test('a computation in flight is current until it ends', async () => {
  const { s, run, answer } = harness();
  assert.equal(s.cwHasCurrentForecast(), false, 'no route');
  const a = run(41);
  assert.equal(s.cwHasConfirmedRoute(), true);
  assert.equal(s.cwHasCurrentForecast(), true);
  answer(0, failed(503)); await a;
  assert.equal(s.cwHasCurrentForecast(), true, 'published, even if empty');
});

test('the notice says offline when the request failed offline, even if the connection is back by publish', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  s.offline = true;
  answer(0, failed(503));
  s.offline = false;
  await a;
  assert.deepEqual(s.notices, [['offline_no_data', 'warn']]);
  assert.equal(s.published()[0].outcome.offline, true);
});

test('a start date out of range leaves its notice, and the computation before it does not publish over it', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  s.dateValidation = { valid: false, error: 'date_too_late' };
  const b = run(42);
  assert.deepEqual(s.notices, [['date_too_late', 'error']]);
  answer(0, ok(openMeteo())); await a; await b;
  assert.deepEqual(s.rendered(), []);
  assert.deepEqual(s.notices, [['date_too_late', 'error']]);
  assert.equal(s.cleared, 0, 'A cleared the date notice');
  assert.deepEqual([...s.claims], []);
  assert.equal(s.cwHasCurrentForecast(), false);
});

test('a replaced computation whose provider failed leaves no notice over the one that replaced it', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  const b = run(42);
  answer(0, failed(503)); await a;
  answer(1, ok(openMeteo())); await b;
  assert.deepEqual(s.notices, [], 'the failure of the replaced computation became a notice');
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
  const { s, launch, answer, pending } = harness({ stubs: {
    buildProviderUrl: (prov, p, t, key, wind, temp) => `${prov}:${temp}:${key}`,
  } });
  const done = launch(line(41, 41.1));
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
  const { s, launch, answer, pending } = harness({ provider: 'openweather', stubs: {
    buildProviderUrl: (prov, p, t, key) => `${prov}:${key}`,
  } });
  const done = launch(line(41, 41.1));
  s.values.apiKeyOW = 'a-key-typed-later';
  answer(0, ok(openWeather('metric')));
  await waitFor(() => pending.length === 2);
  assert.equal(pending[1].url, 'openweather:a-valid-looking-key');
  answer(1, ok(openWeather('metric')));
  await done;
});

test('provider URLs are built with the alerts setting the computation read', async () => {
  const seen = [];
  const { s, run, answer } = harness({ provider: 'openweather', stubs: {
    buildProviderUrl: (prov, p, t, key, wind, temp, alerts) => { seen.push(alerts); return prov; },
  } });
  s.elements.showWeatherAlerts = { checked: false };
  const a = run(41);
  answer(0, ok(openWeather('metric'))); await a;
  assert.deepEqual(seen, [false]);
});

test('unticking "show weather alerts" keeps warnings out of the computation', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { s, run, answer } = harness({ provider: 'openweather' });
  s.elements.showWeatherAlerts = { checked: false };
  const a = run(41);
  answer(0, ok({ hourly: [{ dt: now + 3600, temp: 20, wind_speed: 3 }],
    alerts: [{ sender_name: 'AEMET', event: 'Viento', start: now, end: now + 7200 }] }));
  await a;
  const [snapshot] = s.published();
  assert.equal(snapshot.settings.alerts, false);
  assert.deepEqual(plain(snapshot.alerts), []);
  assert.deepEqual(plain(s.shownAlerts), []);
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

test('a replaced computation writes nothing to the cache after it was replaced', async () => {
  const writes = [];
  const { run, answer } = harness({ stubs: {
    makeCacheKey: (prov, d, t, w, lat) => `${prov}:${lat}`,
    setCache: (key) => writes.push(key),
  } });
  const a = run(41);
  const b = run(42);
  answer(1, ok(openMeteo())); await b;
  answer(0, ok(openMeteo())); await a;
  assert.deepEqual(writes, ['openmeteo:42']);
});

test('an answer whose body cannot be read says the provider is not responding', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  answer(0, { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  await a;
  assert.deepEqual(s.notices, [['provider_unreachable', 'warn']]);
  const [snapshot] = s.published();
  assert.equal(snapshot.outcome.transportFailures, 1);
});

test('an answer whose body cannot be read without connection says offline', async () => {
  const { s, run, answer } = harness();
  const a = run(41);
  s.offline = true;
  answer(0, { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  await a;
  const [snapshot] = s.published();
  assert.equal(snapshot.outcome.offline, true);
  assert.deepEqual(s.notices, [['offline_no_data', 'warn']]);
});

test('a replaced computation writes nothing to the cache when its AROME standard companion answers after replacement', async () => {
  const writes = [];
  const { s, run, answer, pending } = harness({ provider: 'aromehd', stubs: {
    isAromeHdCovered: () => true,
    aromeResponseLooksInvalid: () => false,
    makeCacheKey: (prov, d, t, w, lat) => `${prov}:${lat}`,
    setCache: (key) => writes.push(key),
  } });
  const aromeBody = { hourly: { time: ['2026-01-01T00:00'], temperature_2m: [10] } };
  const a = run(41);
  answer(0, ok(aromeBody)); // A's own AROME answer, valid
  await waitFor(() => pending.length === 2); // A's standard Open-Meteo companion is now in flight
  s.apiSource = 'openmeteo';
  const b = run(42);
  answer(2, ok(openMeteo())); await b;
  answer(1, failed(500)); // A's companion answers only now, while A is replaced
  await a;
  assert.deepEqual(writes, ['openmeteo:42']);
});

test('a replaced computation writes nothing to the cache when its AROME standard companion rejects after replacement', async () => {
  const writes = [];
  const { s, run, answer, pending } = harness({ provider: 'aromehd', stubs: {
    isAromeHdCovered: () => true,
    aromeResponseLooksInvalid: () => false,
    makeCacheKey: (prov, d, t, w, lat) => `${prov}:${lat}`,
    setCache: (key) => writes.push(key),
  } });
  const aromeBody = { hourly: { time: ['2026-01-01T00:00'], temperature_2m: [10] } };
  const a = run(41);
  answer(0, ok(aromeBody)); // A's own AROME answer, valid
  await waitFor(() => pending.length === 2); // A's standard Open-Meteo companion is now in flight
  s.apiSource = 'openmeteo';
  const b = run(42);
  answer(2, ok(openMeteo())); await b;
  pending[1].reject(new TypeError('Load failed')); // A's companion rejects only now, while A is replaced
  await a;
  assert.deepEqual(writes, ['openmeteo:42']);
});
