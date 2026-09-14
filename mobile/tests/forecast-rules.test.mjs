// cwForecastRules run the way the page does not: as a plain script in a bare context,
// no window, no DOM. Europe/Madrid, the zone the provider fixtures are written in.
process.env.TZ = 'Europe/Madrid';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { openMeteo, openWeather } from './fixtures/providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(HERE, '../../public/scripts/forecast-rules.js'), 'utf8');
const rules = vm.runInNewContext(`${src}; cwForecastRules`, {});
const at = (iso) => new Date(iso);

test('nearestIndex picks the closest entry, the earlier one on a tie, and -1 when empty', () => {
  const times = ['2026-09-20T08:00', '2026-09-20T09:00'];
  assert.equal(rules.nearestIndex(times, Date.parse('2026-09-20T06:10:00Z')), 0); // 08:10 local
  assert.equal(rules.nearestIndex(times, Date.parse('2026-09-20T06:50:00Z')), 1); // 08:50 local
  assert.equal(rules.nearestIndex(times, Date.parse('2026-09-20T06:30:00Z')), 0); // tie at 08:30
  assert.equal(rules.nearestIndex([], Date.now()), -1);
});

test('Open-Meteo: a step inside minutely_15 reads the quarter, outside it reads the hour', () => {
  const inside = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T09:30:00Z') });
  assert.equal(inside.source, 'minutely_15');
  assert.equal(inside.temp, 114);          // 11:30 local → quarter 14
  assert.equal(inside.cloudCover, 21);     // cloud cover always from hourly: tie → 11:00 → slot 11
  const outside = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T14:10:00Z') });
  assert.equal(outside.source, 'hourly');
  assert.equal(outside.temp, 26);          // 16:10 local → 16:00 → slot 16
  assert.equal(outside.wind, 21);
});

test('Open-Meteo: uv and rain probability fall back to hourly when the quarter has none', () => {
  const r = rules.extractStep(openMeteo(), { provider: 'aromehd', time: at('2026-09-20T09:30:00Z') });
  assert.equal(r.uvIndex, 11 % 9);
  assert.equal(r.precipProb, (11 * 7) % 100);
  assert.equal(r.weatherCode, 2);          // other variables stay on the quarter
});

test('OpenWeather: wind comes back in km/h whether the request was metric or imperial', () => {
  const t = at('2026-09-20T14:10:00Z');
  const metric = rules.extractStep(openWeather('metric'), { provider: 'openweather', time: t, payloadUnits: 'metric' });
  const imperial = rules.extractStep(openWeather('imperial'), { provider: 'openweather', time: t, payloadUnits: 'imperial' });
  assert.equal(metric.source, 'hourly');
  assert.ok(Math.abs(metric.wind - 21) < 1e-9, `metric wind ${metric.wind}`);
  assert.ok(Math.abs(imperial.wind - 21) < 1e-9, `imperial wind ${imperial.wind}`);
  assert.ok(Math.abs(imperial.gust - 31) < 1e-9, `imperial gust ${imperial.gust}`);
});

test('OpenWeather falls back to daily only when there are no hourly entries', () => {
  const w = openWeather('metric');
  w.hourly = [];
  const r = rules.extractStep(w, { provider: 'openweather', time: at('2026-09-22T11:00:00Z'), payloadUnits: 'metric' });
  assert.equal(r.source, 'daily');
  assert.equal(r.temp, 22);                // 22 Sept → daily entry 2
});

test('no answer, no hourly block or an unhandled provider gives null', () => {
  assert.equal(rules.extractStep(null, { provider: 'openmeteo', time: new Date() }), null);
  assert.equal(rules.extractStep({}, { provider: 'openmeteo', time: new Date() }), null);
  assert.equal(rules.extractStep(openMeteo(), { provider: 'meteoblue', time: new Date() }), null);
});

// Arrays built inside the vm context have their own prototypes; compare through JSON.
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

test('routeLine follows the first line with two points, whatever comes before it', () => {
  const geojson = { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.1, 41.3] } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[2.2, 41.4]] } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[2.3, 41.5, 120], [2.4, 41.6, 130]] } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[9, 9], [9, 10]] } },
  ] };
  same(rules.routeLine(geojson), [{ lat: 41.5, lon: 2.3 }, { lat: 41.6, lon: 2.4 }]);
});

test('routeLine joins the segments of a multi-segment track, in order', () => {
  const geojson = { features: [
    { geometry: { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6]]] } },
  ] };
  same(rules.routeLine(geojson), [{ lat: 2, lon: 1 }, { lat: 4, lon: 3 }, { lat: 6, lon: 5 }]);
});

test('routeLine gives null when there is no line to follow', () => {
  assert.equal(rules.routeLine({ features: [{ geometry: { type: 'Point', coordinates: [2, 41] } }] }), null);
  assert.equal(rules.routeLine({ features: [] }), null);
  assert.equal(rules.routeLine(null), null);
});

test('Open-Meteo: the first quarter of minutely_15 is read like any other', () => {
  const r = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T06:00:00Z') });
  assert.equal(r.source, 'minutely_15');
  assert.equal(r.minutelyIndex, 0);
  assert.equal(r.temp, 100);               // 08:00 local → quarter 0
  assert.equal(r.weatherCode, 2);
  assert.equal(r.isDay, 1);
});
