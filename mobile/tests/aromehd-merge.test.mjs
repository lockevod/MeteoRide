// How AROME HD answers are completed from the standard Open-Meteo answer, pinned before
// the merge moves out of fetchWeatherForSteps. While the block is still inline in app.js
// the test runs that block; once it is gone it runs cwForecastRules.mergeAromeWithStandard.
// Regenerate the golden only on purpose: UPDATE_GOLDEN=1 node --test tests/aromehd-merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '../../public/scripts');
const GOLDEN = join(HERE, 'fixtures/aromehd-merge-golden.json');

const app = await readFile(join(SCRIPTS, 'app.js'), 'utf8');
const INLINE_FROM = '                const stdH = std?.hourly || {};';
const INLINE_TO = '              }\n            } catch (_) {}\n            if (aromeResponseLooksInvalid(json)) {';
let merge;
const from = app.indexOf(INLINE_FROM);
if (from !== -1) {
  const to = app.indexOf(INLINE_TO, from);
  assert.ok(to > from, 'the inline AROME merge no longer ends where this test expects');
  merge = vm.runInNewContext(`(function (json, std) {\n${app.slice(from, to)}\nreturn json;\n})`, { window: {}, console });
} else {
  const rules = await readFile(join(SCRIPTS, 'forecast-rules.js'), 'utf8');
  merge = vm.runInNewContext(`${rules}; cwForecastRules.mergeAromeWithStandard`, {});
}

const hours = (from, n) => Array.from({ length: n }, (_, i) => `2026-09-20T${String(from + i).padStart(2, '0')}:00`);

const CASES = {
  'arome lacks variables, both have a time axis': () => merge(
    { hourly: { time: hours(8, 6), temperature_2m: [1, 2, 3, 4, 5, 6], cloud_cover: [10, null, 30, null, 50, null] } },
    { hourly: {
      time: hours(6, 10),
      cloud_cover: [900, 901, 902, 903, 904, 905, 906, 907, 908, 909],
      uv_index: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      weathercode: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69],
      is_day: [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
      precipitation_probability: [5, 15, 25, 35, 45, 55, 65, 75, 85, 95],
    } }),
  'arome has no time axis': () => merge(
    { hourly: { cloud_cover: [null, 20, null] } },
    { hourly: { time: hours(6, 4), cloud_cover: [7, 8, 9, 10] } }),
  'probability only as a fraction named pop': () => merge(
    { hourly: { time: hours(8, 3) } },
    { hourly: { time: hours(8, 3), pop: [0.1, 0.5, 1] } }),
  'probability under another name, in percent': () => merge(
    { hourly: { time: hours(8, 3) } },
    { hourly: { time: hours(8, 3), probability_of_precipitation: [10, 50, 100] } }),
  'uv from the standard current value': () => merge(
    { hourly: { time: hours(8, 2) } },
    { hourly: { time: hours(8, 3) }, current: { uvi: 4 } }),
  'minutely_15 copied when arome has none': () => merge(
    { hourly: { time: hours(8, 2) }, minutely_15: {} },
    { hourly: { time: hours(8, 2) }, minutely_15: { time: ['2026-09-20T08:00'], temperature_2m: [3] } }),
  'no hourly block in arome': () => merge({}, { hourly: { time: hours(8, 2), weathercode: [1, 2] } }),
  'no standard answer': () => merge({ hourly: { time: hours(8, 1), weathercode: [5] } }, null),
};

const actual = Object.fromEntries(
  Object.entries(CASES).map(([name, run]) => [name, JSON.parse(JSON.stringify(run()))]));

if (process.env.UPDATE_GOLDEN) await writeFile(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));

test('the merge golden covers every case and no other', () => {
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(CASES).sort());
});

test('the merge golden shows how the merge behaved before it moved', () => {
  const both = golden['arome lacks variables, both have a time axis'].hourly;
  // A variable AROME lacks is copied whole, slot by slot, although the time axes differ.
  assert.deepEqual(both.uv_index.slice(0, 3), [0, 1, 2]);
  // Gaps in a variable AROME has are filled by matching the time.
  assert.deepEqual(both.cloud_cover, [10, 903, 30, 905, 50, 907]);
  // Without a time axis on the AROME side, gaps are filled by position.
  assert.deepEqual(golden['arome has no time axis'].hourly.cloud_cover, [7, 20, 9, 10]);
  // A probability named pop is copied as it comes, even as a fraction.
  assert.deepEqual(golden['probability only as a fraction named pop'].hourly.precipitation_probability, [0.1, 0.5, 1]);
  assert.deepEqual(golden['probability under another name, in percent'].hourly.precipitation_probability, [10, 50, 100]);
});

for (const name of Object.keys(CASES)) {
  test(`AROME merge: ${name}`, () => assert.deepEqual(actual[name], golden[name]));
}
