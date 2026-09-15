// checkWeatherAlertsIndependent's alerts-setting gate: the forecast-runs harness stubs
// the whole function, so nothing exercised `settings ? !settings.alerts : ...` against
// the real body. This slices the real function out of app.js and runs it directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts');
const src = await readFile(join(SCRIPTS, 'app.js'), 'utf8');
const start = src.indexOf('async function checkWeatherAlertsIndependent(');
const end = src.indexOf('\n// Process weather alerts from OpenWeather API');
assert.ok(start !== -1 && end > start, 'app.js no longer looks the way this test expects');
const code = src.slice(start, end);

/** The real checkWeatherAlertsIndependent, with the network, cache and page replaced. */
function harness() {
  const s = {
    console, Promise,
    setTimeout: (fn) => fn(), // skip the 200 ms delay between requests
    getCache: () => null, setCache() {}, getVal: () => '',
    processWeatherAlerts() {}, fetchCalls: 0,
  };
  s.fetch = async () => { s.fetchCalls++; return { ok: true, json: async () => ({ alerts: [{ event: 'Viento' }] }) }; };
  // The recorder and body reader of utils.js, without the deadline the browser suite holds.
  s.window = s;
  s.cw = { utils: { createRecorder: (signal) => ({ failed: 0, timedOut: [], signal }), readJson: (res) => res.json() } };
  vm.runInNewContext(code, s);
  return s;
}

const step = () => [{ lat: 41, lon: 2 }];
const times = () => [new Date()];
const settings = (alerts) => ({ alerts, keys: { openweather: 'a-valid-looking-key' }, units: { temp: 'C' } });

test('settings.alerts === false skips the lookup entirely', async () => {
  const s = harness();
  const sink = [];
  await s.checkWeatherAlertsIndependent(step(), times(), sink, settings(false));
  assert.equal(s.fetchCalls, 0, 'no request should have been made');
  assert.deepEqual(sink, []);
});

test('settings.alerts === true lets the lookup run and fill the sink', async () => {
  const s = harness();
  const sink = [];
  await s.checkWeatherAlertsIndependent(step(), times(), sink, settings(true));
  assert.equal(s.fetchCalls, 1);
  assert.deepEqual(sink, [{ event: 'Viento' }]);
});

test('a lookup whose computation was replaced stops before the next point', async () => {
  const s = harness();
  const writes = [];
  // Stays current through the whole first point (several isCurrent checks land inside
  // that one iteration); replaced only once that point is fully written, before the next.
  let current = true;
  s.setCache = (key) => { writes.push(key); current = false; };
  const threeSteps = () => [{ lat: 41, lon: 2 }, { lat: 41.1, lon: 2 }, { lat: 41.2, lon: 2 }];
  const threeTimes = () => [new Date(), new Date(), new Date()];
  const sink = [];
  await s.checkWeatherAlertsIndependent(threeSteps(), threeTimes(), sink, settings(true), () => current);
  assert.equal(s.fetchCalls, 1);
  assert.equal(writes.length, 1);
});

test('a lookup replaced while its request was in flight writes nothing and fills nothing', async () => {
  const s = harness();
  let current = true;
  s.fetch = async () => {
    s.fetchCalls++;
    current = false; // the computation was replaced before this request came back
    return { ok: true, json: async () => ({ alerts: [{ event: 'Viento' }] }) };
  };
  const writes = [];
  s.setCache = (key) => writes.push(key);
  const sink = [];
  await s.checkWeatherAlertsIndependent(step(), times(), sink, settings(true), () => current);
  assert.equal(s.fetchCalls, 1);
  assert.deepEqual(sink, []);
  assert.deepEqual(writes, []);
});

test('a lookup replaced while reading the response body writes nothing and fills nothing', async () => {
  const s = harness();
  let current = true;
  s.fetch = async () => {
    s.fetchCalls++;
    return {
      ok: true,
      json: async () => {
        current = false; // the computation was replaced while the body was being read
        return { alerts: [{ event: 'Viento' }] };
      },
    };
  };
  const writes = [];
  s.setCache = (key) => writes.push(key);
  const sink = [];
  await s.checkWeatherAlertsIndependent(step(), times(), sink, settings(true), () => current);
  assert.equal(s.fetchCalls, 1);
  assert.deepEqual(sink, []);
  assert.deepEqual(writes, []);
});
