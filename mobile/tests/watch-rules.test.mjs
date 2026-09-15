// The rules behind ride alerts, run the way the background runner runs them: as a
// plain script in a bare context, no window, no DOM. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Values built inside the vm context have their own Array/Object prototypes, which
// deepStrictEqual rejects; comparing through JSON keeps the strictness that matters.
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(HERE, '../../public/scripts/watch-rules.js'), 'utf8');
const rules = vm.runInNewContext(`${src}; cwWatchRules`, {});

const HOUR = 3600;
const now = 1_800_000_000_000;               // ms
const t0 = Math.round(now / 1000) + 2 * HOUR; // ride in two hours, seconds

const points = [
  { lat: 41.48, lon: 2.31, t: t0, label: '10:00', km: 0 },
  { lat: 41.50, lon: 2.35, t: t0 + HOUR, label: '11:00', km: 20 },
  { lat: 41.55, lon: 2.40, t: t0 + 2 * HOUR, label: '12:00', km: 40 },
];

/** An Open-Meteo multi-location answer with the same hourly values everywhere. */
function openMeteo(values, n = points.length) {
  const time = Array.from({ length: 48 }, (_, i) => t0 - 3 * HOUR + i * HOUR);
  const fill = (v) => time.map(() => v);
  return Array.from({ length: n }, () => ({
    hourly: {
      time,
      precipitation: fill(values.rain),
      wind_speed_10m: fill(values.wind),
      wind_gusts_10m: fill(values.gust),
    },
  }));
}

const reading = (v) => rules.readForecast(openMeteo(v), points);
const watchWith = (baseline, extra = {}) => ({
  name: 'Collserola', lang: 'es', start: t0 * 1000, end: (t0 + 2 * HOUR) * 1000,
  points, baseline, notified: [], ...extra,
});

test('levels: dry, rain, heavy; calm, moderate, strong, and gusts alone count', () => {
  assert.equal(rules.rainLevel(0), 0);
  assert.equal(rules.rainLevel(0.5), 1);
  assert.equal(rules.rainLevel(5), 2);
  assert.equal(rules.rainLevel(NaN), null);
  assert.equal(rules.windLevel(10, 15), 0);
  assert.equal(rules.windLevel(25, 30), 1);
  assert.equal(rules.windLevel(40, 45), 2);
  assert.equal(rules.windLevel(10, 60), 2, 'a 60 km/h gust is strong wind whatever the mean');
  assert.equal(rules.windLevel(NaN, 45), 1, 'gusts alone still classify');
});

test('the request carries every point once, in km/h and unix time', () => {
  const url = rules.forecastUrl(points, now);
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(url, /latitude=41\.4800,41\.5000,41\.5500/);
  assert.match(url, /longitude=2\.3100,2\.3500,2\.4000/);
  assert.match(url, /wind_speed_unit=kmh/);
  assert.match(url, /timeformat=unixtime/);
  assert.match(url, /forecast_days=2\b/);
});

test('a long route is sampled to a dozen points, keeping both ends', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ lat: i, lon: i, t: t0 + i }));
  const some = rules.sample(many);
  assert.equal(some.length, rules.MAX_POINTS);
  assert.equal(some[0], many[0]);
  assert.equal(some[some.length - 1], many[many.length - 1]);
  assert.equal(rules.sample(points).length, 3, 'short routes are left alone');
});

test('readForecast picks the hour the rider passes and gives up beyond an hour', () => {
  const r = reading({ rain: 1.2, wind: 10, gust: 20 });
  same(r[1], { rain: 1.2, wind: 10, gust: 20 });
  const far = rules.readForecast(openMeteo({ rain: 0, wind: 0, gust: 0 }), [{ ...points[0], t: t0 + 100 * HOUR }]);
  assert.equal(far[0], null);
  const single = rules.readForecast(openMeteo({ rain: 0, wind: 5, gust: 9 }, 1)[0], [points[0]]);
  assert.equal(single[0].wind, 5, 'a single-location answer is an object, not an array');
});

// Open-Meteo's hourly value is the hour before its label. The table shows the hour being ridden,
// (H, H+60 min] with H the point's time floored to the hour, so that is the entry labelled H+60.
// The nearest entry read the hour before from :00 to :30. Wind and gust stay on the nearest.
test('readForecast reads rain from the hour being ridden, as the table does, and wind from the nearest hour', () => {
  assert.equal(t0 % HOUR, 0, 't0 is on the hour (UTC, the base the request asks in)');
  const time = Array.from({ length: 6 }, (_, i) => t0 - HOUR + i * HOUR); // 09:00 … 14:00
  const answer = { hourly: {
    time,
    precipitation: time.map((_, i) => i),
    wind_speed_10m: time.map((_, i) => 10 * i),
    wind_gusts_10m: time.map((_, i) => 100 + i),
  } };
  const at = (minutes) => ({ lat: 0, lon: 0, t: t0 + minutes * 60 });
  const steps = [at(0), at(5), at(59), at(60), at(240)]; // 10:00, 10:05, 10:59, 11:00, 14:00
  const r = rules.readForecast(steps.map(() => answer), steps);
  same(r.slice(0, 4).map((x) => x.rain), [2, 2, 2, 3], 'rain of 10–11 for 10:00, 10:05 and 10:59; 11–12 for 11:00');
  same(r.slice(0, 4).map((x) => x.wind), [10, 10, 20, 20]);
  same(r.slice(0, 4).map((x) => x.gust), [101, 101, 102, 102]);
  // 14:00 is the last entry: no 15:00, so no rain value, as for any missing value; the wind stays.
  assert.ok(Number.isNaN(r[4].rain), String(r[4].rain));
  assert.equal(r[4].wind, 50);
});

test('dry to rain is reported, with the first step it happens at', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  const cur = reading({ rain: 1.5, wind: 10, gust: 15 });
  cur[0] = base[0];   // still dry at the start
  const out = rules.evaluate(watchWith(base), cur, [], now);
  assert.ok(out.notification, 'a notification');
  assert.match(out.notification.title, /Collserola/);
  assert.match(out.notification.body, /^Lluvia a las 11:00 \(km 20\), no estaba previsto$/m);
  same(out.watch.baseline, cur, 'the baseline moves on, so it is not repeated');
});

test('the same reading again is silent, and a further worsening speaks again', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  const rainy = reading({ rain: 1.5, wind: 10, gust: 15 });
  const first = rules.evaluate(watchWith(base), rainy, [], now);
  assert.ok(first.notification);
  const again = rules.evaluate(first.watch, rainy, [], now + 1);
  assert.equal(again.notification, null);
  const heavy = reading({ rain: 6, wind: 10, gust: 15 });
  const worse = rules.evaluate(again.watch, heavy, [], now + 2);
  assert.match(worse.notification.body, /Lluvia fuerte/);
});

test('calm to wind is reported with the speed; wind easing is not', () => {
  const calm = reading({ rain: 0, wind: 10, gust: 15 });
  const windy = reading({ rain: 0, wind: 42, gust: 60 });
  const up = rules.evaluate(watchWith(calm), windy, [], now);
  assert.match(up.notification.body, /^Viento fuerte \(42 km\/h\) a las 10:00 \(km 0\), no estaba previsto$/m);
  const down = rules.evaluate(watchWith(windy), calm, [], now);
  assert.equal(down.notification, null);
});

test('a reading on the boundary does not wake anyone', () => {
  const base = reading({ rain: 0.2, wind: 19, gust: 30 });
  const nudge = reading({ rain: 0.35, wind: 21, gust: 41 });
  assert.equal(rules.evaluate(watchWith(base), nudge, [], now).notification, null);
  const clear = reading({ rain: 0.5, wind: 24, gust: 45 });
  assert.ok(rules.evaluate(watchWith(base), clear, [], now).notification);
});

test('english when asked', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  const cur = reading({ rain: 1, wind: 10, gust: 15 });
  const out = rules.evaluate(watchWith(base, { lang: 'en' }), cur, [], now);
  assert.match(out.notification.body, /^Rain at 10:00 \(km 0\), not forecast before$/m);
});

test('an official warning over the ride is reported once', () => {
  const same = reading({ rain: 0, wind: 10, gust: 15 });
  const alerts = rules.readAlerts({ alerts: [
    { sender_name: 'AEMET', event: 'Aviso naranja por viento', start: t0 - HOUR, end: t0 + 5 * HOUR },
    { sender_name: 'AEMET', event: 'Tormentas', start: t0 + 10 * HOUR, end: t0 + 12 * HOUR },
  ] });
  const first = rules.evaluate(watchWith(same), same, alerts, now);
  assert.equal(first.notification.body, 'Aviso oficial: Aviso naranja por viento · AEMET', 'the later one is outside the ride');
  const again = rules.evaluate(first.watch, same, alerts, now + 1);
  assert.equal(again.notification, null);
});

test('without a baseline the first check only seeds one', () => {
  const cur = reading({ rain: 5, wind: 50, gust: 80 });
  const alerts = rules.readAlerts({ alerts: [{ sender_name: 'X', event: 'Y', start: t0, end: t0 + HOUR }] });
  const out = rules.evaluate(watchWith(null), cur, alerts, now);
  assert.equal(out.notification, null);
  same(out.watch.baseline, cur);
});

test('a point with no data neither triggers nor loses its baseline', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  const cur = reading({ rain: 3.5, wind: 10, gust: 15 });
  cur[2] = null;
  const out = rules.evaluate(watchWith(base), cur, [], now);
  assert.match(out.notification.body, /Lluvia fuerte a las 10:00/);
  same(out.watch.baseline[2], base[2]);
});

test('a point missing from the baseline is seeded on a quiet check, then watched', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  base[1] = null;   // no forecast for that point when the watch was armed
  const calm = reading({ rain: 0, wind: 10, gust: 15 });
  const quiet = rules.evaluate(watchWith(base), calm, [], now);
  assert.equal(quiet.notification, null);
  same(quiet.watch.baseline[1], calm[1], 'the gap is filled from the reading that arrived');

  const stormy = reading({ rain: 0, wind: 10, gust: 15 });
  stormy[1] = { rain: 6, wind: 45, gust: 70 };
  const out = rules.evaluate(quiet.watch, stormy, [], now + 1);
  assert.ok(out.notification, 'the recovered point now speaks');
  assert.match(out.notification.body, /11:00/);
});

test('a quiet check never moves an established baseline', () => {
  const base = reading({ rain: 0.2, wind: 19, gust: 30 });
  const nudge = reading({ rain: 0.35, wind: 21, gust: 41 });
  const out = rules.evaluate(watchWith(base), nudge, [], now);
  assert.equal(out.notification, null);
  same(out.watch.baseline, base, 'creeping up must not hide a later worsening');
});

test('an official warning alone does not move the baseline', () => {
  const base = reading({ rain: 0, wind: 19, gust: 25 });
  const alerts = rules.readAlerts({ alerts: [{ sender_name: 'AEMET', event: 'Tormentas', start: t0, end: t0 + HOUR }] });
  const nudge = reading({ rain: 0.35, wind: 22, gust: 30 });
  const first = rules.evaluate(watchWith(base), nudge, alerts, now);
  assert.equal(first.notification.body, 'Aviso oficial: Tormentas · AEMET');
  same(first.watch.baseline, base, 'the warning says nothing about the forecast at each point');

  const worse = reading({ rain: 2.9, wind: 37, gust: 45 });
  const out = rules.evaluate(first.watch, worse, alerts, now + 1);
  assert.ok(out.notification, 'the rise from the original baseline is announced');
  assert.match(out.notification.body, /^Lluvia a las 10:00/m);
  assert.match(out.notification.body, /^Viento moderado/m);
});

test('easing at one point and rain at another does not re-announce the first point later', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  base[0] = { rain: 1.0, wind: 10, gust: 15 };
  const cur = reading({ rain: 0, wind: 10, gust: 15 });
  cur[0] = { rain: 0.1, wind: 10, gust: 15 };
  cur[1] = { rain: 1.0, wind: 10, gust: 15 };
  const first = rules.evaluate(watchWith(base), cur, [], now);
  assert.match(first.notification.body, /^Lluvia a las 11:00/m);
  assert.doesNotMatch(first.notification.body, /10:00/);
  assert.equal(first.watch.baseline[0].rain, 1.0, 'easing keeps the old baseline');

  const back = reading({ rain: 0, wind: 10, gust: 15 });
  back[0] = { rain: 1.0, wind: 10, gust: 15 };
  back[1] = { rain: 1.0, wind: 10, gust: 15 };
  assert.equal(rules.evaluate(first.watch, back, [], now + 1).notification, null, 'rain at 10:00 was forecast before');
});

test('a point with no forecast when armed that arrives severe is announced', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  base[0] = null;
  const cur = reading({ rain: 0, wind: 10, gust: 15 });
  cur[0] = { rain: 5, wind: 40, gust: 60 };
  const out = rules.evaluate(watchWith(base), cur, [], now);
  assert.ok(out.notification);
  assert.match(out.notification.body, /^Lluvia fuerte a las 10:00/m);
  assert.match(out.notification.body, /^Viento fuerte \(40 km\/h\) a las 10:00/m);
});

test('a missing rain value inside a point is filled when a reading brings it', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  base[0] = { rain: NaN, wind: 10, gust: 15 };
  const dry = reading({ rain: 0, wind: 10, gust: 15 });
  const quiet = rules.evaluate(watchWith(base), dry, [], now);
  assert.equal(quiet.notification, null);
  assert.equal(quiet.watch.baseline[0].rain, 0);

  const wet = reading({ rain: 0, wind: 10, gust: 15 });
  wet[0] = { rain: 5, wind: 10, gust: 15 };
  const out = rules.evaluate(quiet.watch, wet, [], now + 1);
  assert.match(out.notification.body, /^Lluvia fuerte a las 10:00/m);
});

test('gusts keep their baseline while the mean wind is missing', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  base[0] = { rain: 0, wind: NaN, gust: 30 };
  const nudge = reading({ rain: 0, wind: 10, gust: 15 });
  nudge[0] = { rain: 0, wind: NaN, gust: 41 };
  const quiet = rules.evaluate(watchWith(base), nudge, [], now);
  assert.equal(quiet.notification, null);
  assert.equal(quiet.watch.baseline[0].gust, 30, 'the gusts are a baseline even without the mean');

  const gusty = reading({ rain: 0, wind: 10, gust: 15 });
  gusty[0] = { rain: 0, wind: NaN, gust: 43.5 };
  assert.match(rules.evaluate(quiet.watch, gusty, [], now + 1).notification.body, /^Viento moderado/m);
});

test('a watch is over an hour after the ride ends', () => {
  const w = watchWith(null);
  assert.equal(rules.expired(w, w.end), false);
  assert.equal(rules.expired(w, w.end + 2 * HOUR * 1000), true);
  assert.equal(rules.expired(null, now), true);
});

test('the alert lookup asks at the start, middle and end', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ lat: i, lon: i, t: t0 + i }));
  const at = rules.alertPoints(many);
  same(at.map((p) => p.lat), [0, 15, 29]);
  assert.match(rules.alertsUrl(points[0], 'k e y'), /appid=k%20e%20y$/);
});

test('steps already ridden are not reported, official warnings only for what is left', () => {
  const base = reading({ rain: 0, wind: 10, gust: 15 });
  const cur = reading({ rain: 2, wind: 10, gust: 15 });
  const midRide = (t0 + HOUR + 20 * 60) * 1000;   // 11:20, past the 11:00 step
  const out = rules.evaluate(watchWith(base), cur, [], midRide);
  assert.match(out.notification.body, /^Lluvia a las 12:00 \(km 40\)/m, 'only the step ahead');
  const over = rules.readAlerts({ alerts: [{ sender_name: 'AEMET', event: 'Pasado', start: t0 - 5 * HOUR, end: t0 - 2 * HOUR }] });
  assert.equal(rules.evaluate(watchWith(base), base, over, midRide).notification, null, 'a warning that ended before now is history');
});

test('a percent sign in an official warning or a file name cannot become a format specifier', () => {
  const same = reading({ rain: 0, wind: 10, gust: 15 });
  const alerts = rules.readAlerts({ alerts: [{ sender_name: '100%', event: '80% chance of %@ hail', start: t0, end: t0 + HOUR }] });
  const out = rules.evaluate(watchWith(same, { name: '50%.gpx' }), same, alerts, now);
  assert.equal(out.notification.title.includes('%'), false);
  assert.equal(out.notification.body.includes('%'), false);
  assert.match(out.notification.body, /80\uFF05 chance/);
});

/* ---------- arming the same ride again ---------- */

// What the app built from a snapshot, and what the runner had stored from an earlier arm.
const record = (extra = {}) => ({
  name: 'route.gpx', fingerprint: '5120:1a2b3c4d', start: t0 * 1000,
  points: points.map((p) => ({ ...p })), baseline: null, notified: [], ...extra,
});
const storedRecord = (extra = {}) => record({
  notified: ['AEMET_Viento_1_2'],
  baseline: [{ rain: 1, wind: 20, gust: 30 }, { rain: 2, wind: 20, gust: 30 }, { rain: 3, wind: 20, gust: 30 }],
  ...extra,
});

test('reuse: the same ride over the same points keeps what was notified and the baseline', () => {
  const stored = storedRecord();
  const fresh = record();
  same(rules.reuse(stored, fresh), { ...fresh, notified: stored.notified, baseline: stored.baseline });
});

test('reuse: the same ride with a point elsewhere in time or space keeps what was notified, not the baseline', () => {
  const stored = storedRecord();
  const moved = record();
  moved.points[1].t += 15 * 60;
  same(rules.reuse(stored, moved), { ...moved, notified: stored.notified, baseline: null });
  // Fewer points (a faster speed) cannot line up by index either.
  const fewer = record({ points: points.slice(0, 2).map((p) => ({ ...p })) });
  same(rules.reuse(stored, fewer), { ...fewer, notified: stored.notified, baseline: null });
  const shifted = record();
  shifted.points[2].lon += 0.01;
  same(rules.reuse(stored, shifted), { ...shifted, notified: stored.notified, baseline: null });
});

test('reuse: another route, another start, nothing stored or no fingerprint keeps nothing', () => {
  const fresh = record();
  same(rules.reuse(storedRecord({ fingerprint: '5120:ffffffff' }), fresh), fresh, 'another route');
  same(rules.reuse(storedRecord({ start: fresh.start + 60000 }), fresh), fresh, 'another start');
  same(rules.reuse(null, fresh), fresh, 'nothing stored');
  same(rules.reuse(undefined, fresh), fresh, 'nothing stored');
  same(rules.reuse(storedRecord({ fingerprint: '' }), record({ fingerprint: '' })), record({ fingerprint: '' }), 'no fingerprint');
  same(rules.reuse(storedRecord({ fingerprint: undefined }), record({ fingerprint: undefined })),
    record({ fingerprint: undefined }), 'a record from before fingerprints');
});

test('reuse: a replay moved to another start keeps what was notified, and the baseline only over the same points', () => {
  const stored = storedRecord();
  const later = 45 * 60;
  const moved = record({ start: t0 * 1000 + later * 1000, points: points.map((p) => ({ ...p, t: p.t + later })) });
  same(rules.reuse(stored, moved, true), { ...moved, notified: stored.notified, baseline: null });
  // Put back at the same start, the points are the same and so is the baseline.
  same(rules.reuse(stored, record(), true), { ...record(), notified: stored.notified, baseline: stored.baseline });
  // Another route is another route, moved or not.
  same(rules.reuse(storedRecord({ fingerprint: '5120:ffffffff' }), moved, true), moved);
  // A computation for another start still starts afresh.
  same(rules.reuse(stored, moved), moved);
  same(rules.reuse(stored, moved, false), moved);
});

test('reuse changes neither record', () => {
  const stored = storedRecord();
  const fresh = record();
  const before = JSON.stringify([stored, fresh]);
  const out = rules.reuse(stored, fresh);
  assert.equal(JSON.stringify([stored, fresh]), before);
  assert.notEqual(out, fresh);
  out.notified.push('later');
  assert.deepEqual(JSON.parse(JSON.stringify(stored.notified)), ['AEMET_Viento_1_2'], 'the result shares its list with what was stored');
});
