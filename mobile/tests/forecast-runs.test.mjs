// fetchWeatherForSteps used to write every result straight into the global weatherData
// and render whatever was in it when it finished. Two runs in flight — a speed preset
// changed while the first was still fetching — interleaved their steps, and the one
// that finished last won, even when it was the one the user had already replaced.
// Only the run started most recently may publish anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts/app.js');
const src = await readFile(APP, 'utf8');
// The run counter sits just above the function; take it along when it is there.
const fnStart = src.indexOf('async function fetchWeatherForSteps(');
const counter = src.lastIndexOf('let forecastRun', fnStart);
const start = counter !== -1 && fnStart - counter < 400 ? counter : fnStart;
const end = src.indexOf('\nfunction processWeatherData(');
assert.ok(fnStart !== -1 && end > fnStart, 'app.js no longer looks the way this test expects');

/** The real fetchWeatherForSteps, with the network and the page replaced. */
function harness({ provider = 'openmeteo', body = { hourly: { time: [] } }, stubs = {} } = {}) {
  const pending = [];
  const s = {
    console, Date, Promise, setTimeout, clearTimeout,
    apiSource: provider, weatherData: [],
    MS_PER_DAY: 86400000, MS_PER_HOUR: 3600000, OPENMETEO_MAX_DAYS: 14, METEOBLUE_MAX_DAYS: 7,
    OPENWEATHER_MAX_DAYS: 4, OPENWEATHER_MAX_HOURS: 1, AROMEHD_MAX_HOURS: 48, isAromeHdCovered: () => false,
    getVal: (id) => ({ datetimeRoute: new Date().toISOString(), tempUnits: 'C', windUnits: 'kmh',
      apiKey: 'a-valid-looking-key', apiKeyOW: 'a-valid-looking-key' }[id] || ''),
    document: { getElementById: () => ({ checked: true }) },
    logDebug() {}, t: (x) => x,
    getCache: () => null, setCache() {}, makeCacheKey: () => 'key',
    buildProviderUrl: () => 'url',
    fetch: () => new Promise((resolve) => pending.push(resolve)),
    renders: [], notices: [], hidden: 0, alertChecks: 0, stepAlerts: 0,
  };
  Object.assign(s, {
    clearNotice() {}, setNotice: (...x) => s.notices.push(x),
    showLoading() {}, hideLoading: () => s.hidden++,
    checkWeatherAlertsIndependent: async () => { s.alertChecks++; if (s.onAlertCheck) await s.onAlertCheck(); },
    processWeatherAlerts: () => s.stepAlerts++,
    processWeatherData: () => s.renders.push(s.weatherData.map((x) => x.id)),
  });
  s.window = s;
  Object.assign(s, stubs);
  vm.runInNewContext(src.slice(start, end), s);
  // Arrays built inside the context have that context's Array.prototype, which strict
  // deep equality holds against them; compare their JSON instead.
  s.ids = () => JSON.parse(JSON.stringify(s.weatherData.map((x) => x.id)));
  s.rendered = () => JSON.parse(JSON.stringify(s.renders));
  const run = (id) => {
    const time = new Date(Date.now() + 3600000);
    return s.fetchWeatherForSteps([{ id, lat: 41, lon: 2, time }], [time]);
  };
  const answer = (i) => pending[i]({ ok: true, status: 200, json: async () => structuredClone(body) });
  return { s, run, answer, pending };
}

test('a run replaced before it finishes publishes nothing, whichever finishes first', async () => {
  for (const order of [[1, 0], [0, 1]]) {
    const { s, run, answer, pending } = harness();
    const runs = [run('A'), run('B')];
    assert.equal(pending.length, 2);
    for (const i of order) { answer(i); await runs[i]; }
    assert.deepEqual(s.rendered(), [['B']], `order ${order}`);
    assert.deepEqual(s.ids(), ['B'], `order ${order}`);
    assert.equal(s.alertChecks, 1, `order ${order}: only the current run looks up alerts`);
  }
});

test('a replaced run does not hide the loading indicator of the run that replaced it', async () => {
  const { s, run, answer } = harness();
  const a = run('A');
  const b = run('B');
  answer(0); await a;
  assert.equal(s.hidden, 0, 'A finished and hid the indicator while B was still loading');
  answer(1); await b;
  assert.equal(s.hidden, 1);
});

test('a replaced run does not raise the official warnings its response carried', async () => {
  const body = { hourly: [{ dt: Math.floor(Date.now() / 1000) + 3600 }], alerts: [{ event: 'Wind' }] };
  const { s, run, answer } = harness({ provider: 'openweather', body });
  const a = run('A');
  const b = run('B');
  answer(0); await a;
  assert.equal(s.stepAlerts, 0, 'the replaced run published its warnings');
  answer(1); await b;
  assert.equal(s.stepAlerts, 1);
});

test('a run replaced while it looks up official warnings publishes nothing', async () => {
  const { s, run, answer } = harness();
  let b;
  s.onAlertCheck = () => { s.onAlertCheck = null; b = run('B'); };
  const a = run('A');
  answer(0); await a;
  assert.deepEqual(s.rendered(), [], 'A rendered after B had replaced it');
  answer(1); await b;
  assert.deepEqual(s.rendered(), [['B']]);
});

test('a run on its own still publishes', async () => {
  const { s, run, answer } = harness();
  const a = run('A');
  answer(0); await a;
  assert.deepEqual(s.rendered(), [['A']]);
  assert.equal(s.hidden, 1);
  assert.equal(s.alertChecks, 1);
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
      classifyProviderError: () => 'http',
      fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
    } });
    await run('A');
    assert.deepEqual(s.rendered(), [['A']]);
    assert.deepEqual(JSON.parse(JSON.stringify(s.weatherData.map((x) => x.provider ?? null))), ['openmeteo']);
    assert.equal(s.weatherData[0].weather, cached);
  });
}
