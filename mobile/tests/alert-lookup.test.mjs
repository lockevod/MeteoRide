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
