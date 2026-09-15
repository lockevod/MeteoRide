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

// AROME HD sends minutely_15.weathercode as nulls; the hour, filled from standard Open-Meteo, has one.
test('Open-Meteo: a quarter with no weather code takes the hour\'s', () => {
  const w = openMeteo();
  w.minutely_15.weathercode = w.minutely_15.weathercode.map(() => null);
  const r = rules.extractStep(w, { provider: 'aromehd', time: at('2026-09-20T09:30:00Z') });
  assert.equal(r.source, 'minutely_15');
  assert.equal(r.temp, 114);               // the rest still on the quarter
  assert.equal(r.weatherCode, [0, 1, 3, 61, 80][11 % 5]); // tie → 11:00 → slot 11
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

test('OpenWeather uses daily when the nearest hourly entry is more than an hour away', () => {
  // 6h past the last of the 48 hourly slots: too far for hourly, so it should read daily.
  const beyond = rules.extractStep(openWeather('metric'), { provider: 'openweather', time: at('2026-09-22T03:00:00Z'), payloadUnits: 'metric' });
  assert.equal(beyond.source, 'daily');
  assert.equal(beyond.temp, 22);           // daily entry 2

  // 30 min from an hourly slot stays close enough to read hourly.
  const near = rules.extractStep(openWeather('metric'), { provider: 'openweather', time: at('2026-09-20T14:30:00Z'), payloadUnits: 'metric' });
  assert.equal(near.source, 'hourly');
});

test('OpenWeather daily: picks the entry whose local date matches the step, not the nearest dt', () => {
  // 2026-09-22T22:00:00Z is 23 Sept 00:00 local (offset +7200): equidistant in raw UTC
  // terms from the 22 Sept and 23 Sept daily entries, so a tie-break on nearest `dt`
  // keeps the earlier (22 Sept, temp 22) one. The step's local calendar day is 23 Sept.
  const midnight = rules.extractStep(openWeather('metric'),
    { provider: 'openweather', time: at('2026-09-22T22:00:00Z'), payloadUnits: 'metric' });
  assert.equal(midnight.source, 'daily');
  assert.equal(midnight.temp, 23);

  // Same idea in a different timezone_offset: local midnight of 23 Sept at UTC-5.
  const otherOffset = { ...openWeather('metric'), timezone_offset: -18000 };
  const r = rules.extractStep(otherOffset,
    { provider: 'openweather', time: at('2026-09-23T05:00:00Z'), payloadUnits: 'metric' });
  assert.equal(r.source, 'daily');
  assert.equal(r.temp, 23);
});

test('OpenWeather daily: a temperature of 0°C is not treated as missing', () => {
  const w = openWeather('metric');
  w.hourly = [];
  w.daily[0] = { ...w.daily[0], temp: { day: 0 } };
  const r = rules.extractStep(w,
    { provider: 'openweather', time: at('2026-09-20T06:00:00Z'), payloadUnits: 'metric' });
  assert.equal(r.source, 'daily');
  assert.equal(r.temp, 0);
});

test('no answer, no hourly block or an unhandled provider gives null', () => {
  assert.equal(rules.extractStep(null, { provider: 'openmeteo', time: new Date() }), null);
  assert.equal(rules.extractStep({}, { provider: 'openmeteo', time: new Date() }), null);
  assert.equal(rules.extractStep(openMeteo(), { provider: 'unknown', time: new Date() }), null);
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

/* ---------- replaying a prepared snapshot (spec §4.4, §4.9) ---------- */

const H = 3600000;
const REPLAY = { maxGapMs: H, allowDaily: false };
const tempAt = (payload, time, over = {}) =>
  rules.extractStep(payload, { provider: 'openmeteo', time: typeof time === 'string' ? Date.parse(time) : time, ...REPLAY, ...over })?.temp ?? null;

test('replay: further than the gap from the nearest hourly entry has no data; live reads it anyway', () => {
  // The last hourly slot is 21 Sept 23:00 local (21:00Z).
  assert.equal(tempAt(openMeteo(), '2026-09-21T22:00:00Z'), 57);          // exactly the gap
  assert.equal(tempAt(openMeteo(), '2026-09-21T22:01:00Z'), null);        // past it
  assert.equal(rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-21T22:01:00Z') }).temp, 57);
});

test('replay: minutely_15 is read only within fifteen minutes of a quarter, otherwise the hour or nothing', () => {
  // The quarters run 08:00–13:45 local. 07:50 is ten minutes from the first one: live reads the
  // hour (outside the range), replay reads the quarter.
  const near = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T05:50:00Z'), ...REPLAY });
  assert.equal(near.source, 'minutely_15');
  assert.equal(near.temp, 100);
  assert.equal(rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T05:50:00Z') }).source, 'hourly');
  // 07:45 is exactly fifteen minutes away: still the quarter.
  const edge = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T05:45:00Z'), ...REPLAY });
  assert.equal(edge.source, 'minutely_15');
  assert.equal(edge.temp, 100);
  // 07:40 is twenty minutes away: the hour, 08:00 → slot 8.
  const far = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T05:40:00Z'), ...REPLAY });
  assert.equal(far.source, 'hourly');
  assert.equal(far.temp, 18);
  // Far from both: nothing.
  assert.equal(tempAt(openMeteo(), '2026-09-23T12:00:00Z'), null);
});

test('replay: OpenWeather never falls back to daily, and reads the same wind in km/h from metric and imperial', () => {
  const w = openWeather('metric');
  w.hourly = [];
  const t = at('2026-09-22T11:00:00Z');
  assert.equal(rules.extractStep(w, { provider: 'openweather', time: t, payloadUnits: 'metric' }).source, 'daily');
  assert.equal(rules.extractStep(w, { provider: 'openweather', time: t, payloadUnits: 'metric', ...REPLAY }), null);
  // Beyond the hourly range, where live reads daily.
  assert.equal(rules.extractStep(openWeather('metric'),
    { provider: 'openweather', time: at('2026-09-22T03:00:00Z'), payloadUnits: 'metric', ...REPLAY }), null);
  // The gap is the one asked for: 50 minutes past the last hourly entry is data within an hour
  // (live's own limit), and nothing within half an hour.
  const pastLast = at('2026-09-21T21:50:00Z');
  assert.equal(rules.extractStep(openWeather('metric'), { provider: 'openweather', time: pastLast, payloadUnits: 'metric', ...REPLAY }).temp, 57);
  assert.equal(rules.extractStep(openWeather('metric'),
    { provider: 'openweather', time: pastLast, payloadUnits: 'metric', maxGapMs: H / 2, allowDaily: false }), null);

  const t2 = at('2026-09-20T14:10:00Z');
  const metric = rules.extractStep(openWeather('metric'), { provider: 'openweather', time: t2, payloadUnits: 'metric', ...REPLAY });
  const imperial = rules.extractStep(openWeather('imperial'), { provider: 'openweather', time: t2, payloadUnits: 'imperial', ...REPLAY });
  // Temperatures come back as sent (the fixture sends the same numbers in both), so only the
  // wind, turned into km/h, has anything to compare.
  assert.ok(Math.abs(metric.wind - 21) < 1e-9 && Math.abs(imperial.wind - 21) < 1e-9, `${metric.wind} / ${imperial.wind}`);
  assert.ok(Math.abs(metric.gust - imperial.gust) < 1e-9);
});

const snapshotAt = (iso, payload = openMeteo({ minutely: false })) => ({
  version: 1, route: { name: 'r.gpx', fingerprint: 'fp' }, origin: 'live', createdAt: 1,
  settings: { start: Date.parse(iso), speed: 12, interval: 15 },
  steps: [{ lat: 41.4, lon: 2.2, time: new Date(iso), distanceM: 0, provider: 'openmeteo', payloadUnits: null, payload }],
  outcome: {}, alerts: [],
});

test('retime moves every step and the start, and the values follow the hour the step lands on', () => {
  const base = snapshotAt('2026-09-20T09:00:00Z');          // 11:00 local → slot 11
  const value = (diff) => { const s = rules.retime(base, diff).steps[0]; return tempAt(s.payload, new Date(s.time).getTime()); };
  assert.equal(value(0), 21);
  assert.equal(value(45 * 60000), 22);                       // 11:45 → 12:00
  assert.equal(value(-H), 20);                               // 10:00
  assert.equal(value(3 * H), 24);                            // 14:00

  const moved = rules.retime(base, 3 * H);
  assert.equal(moved.origin, 'prepared');
  assert.equal(moved.settings.start, base.settings.start + 3 * H);
  assert.equal(new Date(moved.steps[0].time).getTime(), Date.parse('2026-09-20T12:00:00Z'));
  assert.equal(base.origin, 'live', 'the input changed');
  assert.equal(base.settings.start, Date.parse('2026-09-20T09:00:00Z'), 'the input start changed');
  assert.equal(base.steps[0].time.getTime(), Date.parse('2026-09-20T09:00:00Z'), 'the input step changed');

  // Near the end of the answer: three hours later still lands within an hour of the last slot,
  // a minute more does not.
  const late = snapshotAt('2026-09-21T19:00:00Z');
  const lateValue = (diff) => { const s = rules.retime(late, diff).steps[0]; return tempAt(s.payload, new Date(s.time).getTime()); };
  assert.equal(lateValue(3 * H), 57);
  assert.equal(lateValue(3 * H + 60000), null);
});

test('preparedCoverage counts the steps with data at every start from three hours before to three after', () => {
  same(rules.preparedCoverage(snapshotAt('2026-09-20T09:00:00Z')), { covered: 1, total: 1 });

  // A hole in the middle of the answer: 13:00–16:00 local are missing.
  const holed = openMeteo({ minutely: false });
  const keep = (_, i) => i < 13 || i > 16;
  for (const k of Object.keys(holed.hourly)) holed.hourly[k] = holed.hourly[k].filter(keep);
  assert.equal(tempAt(holed, '2026-09-20T09:00:00Z'), 21, 'the step itself still has data');
  same(rules.preparedCoverage(snapshotAt('2026-09-20T09:00:00Z', holed)), { covered: 0, total: 1 });

  // Only the earlier starts fall off the answer: 01:30 local minus three hours is an hour and a
  // half before its first slot, while three hours later reads 04:30 → slot 4.
  const early = snapshotAt('2026-09-19T23:30:00Z');
  assert.equal(tempAt(early.steps[0].payload, Date.parse('2026-09-19T23:30:00Z') + 3 * H), 14);
  same(rules.preparedCoverage(early), { covered: 0, total: 1 });

  // Three hours later is inside the margin: a step a minute past the end of its answer at +3 h is
  // not covered, though at +2 h 45 it still reads the last slot.
  assert.equal(tempAt(openMeteo({ minutely: false }), Date.parse('2026-09-21T19:01:00Z') + 165 * 60000), 57);
  same(rules.preparedCoverage(snapshotAt('2026-09-21T19:01:00Z')), { covered: 0, total: 1 });

  // Every quarter hour counts: an answer with nothing within an hour of 11:15, and data at 11:00
  // and 11:30, leaves a step at 09:00 uncovered.
  const sparseTimes = ['05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '12:20', '13:00'].map((h) => `2026-09-20T${h}`);
  const sparse = { utc_offset_seconds: 0, hourly: { time: sparseTimes, temperature_2m: sparseTimes.map((_, i) => i) } };
  assert.equal(tempAt(sparse, '2026-09-20T11:00:00Z'), 5);
  assert.equal(tempAt(sparse, '2026-09-20T11:15:00Z'), null);
  assert.equal(tempAt(sparse, '2026-09-20T11:30:00Z'), 6);
  same(rules.preparedCoverage(snapshotAt('2026-09-20T09:00:00Z', sparse)), { covered: 0, total: 1 });

  // A step whose request failed is never covered.
  const twoSteps = snapshotAt('2026-09-20T09:00:00Z');
  twoSteps.steps.push({ ...twoSteps.steps[0], payload: null });
  same(rules.preparedCoverage(twoSteps), { covered: 1, total: 2 });
});

test('usablePrepared: the same route, and a start at most three hours from the prepared one', () => {
  const start = Date.parse('2026-09-20T09:00:00Z');
  const record = { version: 1, snapshot: snapshotAt('2026-09-20T09:00:00Z') };
  assert.equal(rules.usablePrepared(record, { fingerprint: 'fp', startMs: start }), true);
  assert.equal(rules.usablePrepared(record, { fingerprint: 'other', startMs: start }), false);
  assert.equal(rules.usablePrepared(record, { fingerprint: 'fp', startMs: start + 3 * H }), true);
  assert.equal(rules.usablePrepared(record, { fingerprint: 'fp', startMs: start - 3 * H }), true);
  assert.equal(rules.usablePrepared(record, { fingerprint: 'fp', startMs: start + 3 * H + 60000 }), false);
  assert.equal(rules.usablePrepared(record, { fingerprint: 'fp', startMs: start - 3 * H - 60000 }), false);
  assert.equal(rules.usablePrepared(null, { fingerprint: 'fp', startMs: start }), false);
  // A fingerprint is a string on both sides: two missing ones are not the same route.
  const unnamed = { version: 1, snapshot: { ...snapshotAt('2026-09-20T09:00:00Z'), route: { name: 'r.gpx' } } };
  assert.equal(rules.usablePrepared(unnamed, { fingerprint: undefined, startMs: start }), false);
  assert.equal(rules.usablePrepared(unnamed, { startMs: start }), false);
  assert.equal(rules.usablePrepared(record, { startMs: start }), false);
});

test('effectiveStart is now rounded up when the chosen time has passed, and the chosen time when it is ahead', () => {
  const roundUp = (ms) => Math.ceil(ms / 900000) * 900000;
  const now = Date.parse('2026-09-20T08:07:00Z');
  assert.equal(rules.effectiveStart(now, Date.parse('2026-09-20T07:00:00Z'), roundUp), Date.parse('2026-09-20T08:15:00Z'));
  assert.equal(rules.effectiveStart(now, Date.parse('2026-09-20T12:00:00Z'), roundUp), Date.parse('2026-09-20T12:00:00Z'));
  assert.equal(rules.effectiveStart(now, NaN, roundUp), Date.parse('2026-09-20T08:15:00Z'));
});
