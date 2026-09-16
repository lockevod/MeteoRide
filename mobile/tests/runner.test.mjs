// The assembled runner (www/runners/watch.js) driven the way the plugin drives it:
// a bare context with addEventListener, CapacitorKV, CapacitorNotifications and
// fetch provided by the host. `npm run build` first; `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, '../www/runners/watch.js');
if (!existsSync(RUNNER)) throw new Error('www/runners/watch.js missing: run `npm run build` first');
const src = await readFile(RUNNER, 'utf8');

const HOUR = 3600;
// Read from the rules the build concatenated in, so a bumped version does not quietly turn every
// fixture below into a watch stored by an older reading.
const BASELINE_VERSION = Number(/BASELINE_VERSION = (\d+)/.exec(src)[1]);

/** A fresh runner context, like the plugin makes for every event. */
function host({ kv = {}, forecast, alerts, fail = false } = {}) {
  const handlers = {};
  const scheduled = [];
  const requests = [];
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, Set, Array, Object, String, Error,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    CapacitorKV: {
      get: (k) => (k in kv ? { value: kv[k] } : null),
      set: (k, v) => { kv[k] = v; },
      remove: (k) => { delete kv[k]; },
    },
    CapacitorNotifications: { schedule: (list) => scheduled.push(...list) },
    fetch: async (url) => {
      requests.push(url);
      if (fail) throw new Error('offline');
      const body = url.includes('open-meteo') ? forecast : alerts;
      return { ok: true, status: 200, json: async () => body };
    },
  };
  vm.runInNewContext(src, sandbox);
  const dispatch = (event, args) => new Promise((resolve, reject) => handlers[event](resolve, reject, args));
  return { dispatch, kv, scheduled, requests };
}

const now = Date.now();
const t0 = Math.round(now / 1000) + 2 * HOUR;
const points = [
  { lat: 41.48, lon: 2.31, t: t0, label: '10:00', km: 0 },
  { lat: 41.55, lon: 2.40, t: t0 + HOUR, label: '11:00', km: 20 },
];

// Hourly entries on UTC hours, as Open-Meteo sends them with timeformat=unixtime&timezone=UTC:
// rain is read from the entry an hour after the hour the rider is in, which must exist.
function openMeteo(v) {
  const time = Array.from({ length: 48 }, (_, i) => Math.floor(t0 / HOUR) * HOUR - 3 * HOUR + i * HOUR);
  const fill = (x) => time.map(() => x);
  return points.map(() => ({ hourly: { time, precipitation: fill(v.rain), wind_speed_10m: fill(v.wind), wind_gusts_10m: fill(v.gust) } }));
}
const dry = { rain: 0, wind: 8, gust: 12 };
const wet = { rain: 2, wind: 8, gust: 12 };

function watch(extra = {}) {
  return {
    name: 'test.gpx', lang: 'es', start: t0 * 1000, end: (t0 + HOUR) * 1000, horizonMs: 24 * HOUR * 1000,
    points, baseline: null, notified: [], owKey: '', channelId: '',
    baselineVersion: BASELINE_VERSION, ...extra,
  };
}

test('saveWatch stores, loadWatch reads back, saveWatch null clears', async () => {
  const h = host();
  await h.dispatch('saveWatch', { watch: watch() });
  assert.ok(h.kv.cw_watch);
  assert.equal((await h.dispatch('loadWatch')).name, 'test.gpx');
  await h.dispatch('saveWatch', { watch: null });
  assert.equal(h.kv.cw_watch, undefined);
  assert.equal(await h.dispatch('loadWatch'), null);
});

test('checkWatch with nothing stored does nothing and asks for nothing', async () => {
  const h = host({ forecast: openMeteo(dry) });
  await h.dispatch('checkWatch');
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.scheduled, []);
});

test('a worsening forecast becomes one notification and moves the baseline', async () => {
  const h = host({ forecast: openMeteo(wet) });
  const baseline = points.map(() => ({ rain: 0, wind: 8, gust: 12 }));
  h.kv.cw_watch = JSON.stringify(watch({ baseline }));
  await h.dispatch('checkWatch');

  assert.equal(h.requests.length, 1, 'one request for every point');
  assert.match(h.requests[0], /latitude=41\.4800,41\.5500/);
  assert.equal(h.scheduled.length, 1);
  const n = h.scheduled[0];
  assert.equal(n.title, 'test.gpx · Cambia el tiempo en tu ruta');
  assert.match(n.body, /Lluvia a las 10:00/);
  assert.equal(n.interruptionLevel, 'timeSensitive');
  assert.equal('channelId' in n, false, 'no channel unless the app confirmed one');
  assert.ok(n.scheduleAt instanceof Date && n.scheduleAt.getTime() > Date.now() + 1000, 'never "now"');
  assert.ok(Number.isInteger(n.id) && n.id > 0 && n.id < 2147483647, 'an Android-sized id');
  const stored = JSON.parse(h.kv.cw_watch);
  assert.equal(stored.baseline[0].rain, 2, 'the baseline moved on');

  // The same forecast again is silent.
  const again = host({ kv: h.kv, forecast: openMeteo(wet) });
  await again.dispatch('checkWatch');
  assert.equal(again.scheduled.length, 0);
});

test('with no baseline the first check only seeds one', async () => {
  const h = host({ forecast: openMeteo(wet) });
  h.kv.cw_watch = JSON.stringify(watch());
  await h.dispatch('checkWatch');
  assert.equal(h.scheduled.length, 0);
  assert.equal(JSON.parse(h.kv.cw_watch).baseline[1].rain, 2);
});

// A watch armed before the app was updated carries a baseline whose rain was read from another hour.
// The runner is the one place it can still turn up, since nothing re-arms a watch in the background.
test('a watch stored before the rain hour changed is reseeded instead of waking anyone', async () => {
  const h = host({ forecast: openMeteo(wet) });
  const baseline = points.map(() => ({ rain: 0, wind: 8, gust: 12 }));
  h.kv.cw_watch = JSON.stringify(watch({ baseline, notified: ['AEMET_Lluvia_1_2'], baselineVersion: undefined }));
  await h.dispatch('checkWatch');

  assert.equal(h.scheduled.length, 0, 'the update itself woke the phone');
  const stored = JSON.parse(h.kv.cw_watch);
  assert.equal(stored.baseline[0].rain, 2, 'the rain was not reseeded with the new reading');
  assert.deepEqual(stored.notified, ['AEMET_Lluvia_1_2'], 'what was already notified is kept');
  assert.equal(typeof stored.baselineVersion, 'number', 'the reading it was stored by is not recorded');
});

test('an official warning needs the key, is asked at up to three points, and is reported once', async () => {
  const alerts = { alerts: [{ sender_name: 'AEMET', event: 'Aviso amarillo por lluvias', start: t0 - HOUR, end: t0 + 3 * HOUR }] };
  const baseline = points.map(() => ({ rain: 0, wind: 8, gust: 12 }));
  const h = host({ forecast: openMeteo(dry), alerts });
  h.kv.cw_watch = JSON.stringify(watch({ baseline, owKey: 'key12' }));
  await h.dispatch('checkWatch');
  assert.equal(h.requests.filter((u) => u.includes('openweathermap')).length, 2, 'two points, two lookups');
  assert.ok(h.requests.some((u) => u.includes('appid=key12')));
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].body, 'Aviso oficial: Aviso amarillo por lluvias · AEMET');

  const again = host({ kv: h.kv, forecast: openMeteo(dry), alerts });
  await again.dispatch('checkWatch');
  assert.equal(again.scheduled.length, 0);

  const noKey = host({ forecast: openMeteo(dry), alerts });
  noKey.kv.cw_watch = JSON.stringify(watch({ baseline }));
  await noKey.dispatch('checkWatch');
  assert.equal(noKey.requests.some((u) => u.includes('openweathermap')), false);

  // A key too short to be real (e.g. trimmed down by hand) is truthy but must not
  // trigger a doomed request, same as the foreground guard treats it as no key.
  const shortKey = host({ forecast: openMeteo(dry), alerts });
  shortKey.kv.cw_watch = JSON.stringify(watch({ baseline, owKey: 'abcd' }));
  await shortKey.dispatch('checkWatch');
  assert.equal(shortKey.requests.some((u) => u.includes('openweathermap')), false, 'a 4-character key is not a key');
});

test('the channel id travels with the watch when the app confirmed it', async () => {
  const h = host({ forecast: openMeteo(wet) });
  h.kv.cw_watch = JSON.stringify(watch({ baseline: points.map(() => ({ rain: 0, wind: 8, gust: 12 })), channelId: 'cw_alerts' }));
  await h.dispatch('checkWatch');
  assert.equal(h.scheduled[0].channelId, 'cw_alerts');
});

test('a ride more than a day away is not checked yet', async () => {
  const h = host({ forecast: openMeteo(wet) });
  const far = watch({ start: now + 3 * 24 * HOUR * 1000, end: now + 3 * 24 * HOUR * 1000 + HOUR * 1000, baseline: null });
  h.kv.cw_watch = JSON.stringify(far);
  await h.dispatch('checkWatch');
  assert.deepEqual(h.requests, []);
  assert.ok(h.kv.cw_watch, 'still stored');
});

test('a ride that ended is cleared without a request', async () => {
  const h = host({ forecast: openMeteo(wet) });
  h.kv.cw_watch = JSON.stringify(watch({ start: now - 5 * HOUR * 1000, end: now - 3 * HOUR * 1000 }));
  await h.dispatch('checkWatch');
  assert.deepEqual(h.requests, []);
  assert.equal(h.kv.cw_watch, undefined);
});

test('a failed request rejects and leaves the watch untouched for the next run', async () => {
  const h = host({ fail: true });
  const before = JSON.stringify(watch({ baseline: points.map(() => ({ rain: 0, wind: 8, gust: 12 })) }));
  h.kv.cw_watch = before;
  await assert.rejects(h.dispatch('checkWatch'), /offline/);
  assert.equal(h.kv.cw_watch, before);
  assert.equal(h.scheduled.length, 0);
});
