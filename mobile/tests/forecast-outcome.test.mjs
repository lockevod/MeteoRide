// What a computation produced and what the page says about it: decideNotice,
// usableSteps and the official-warning window, as plain rules in a bare context.
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
const plain = (x) => JSON.parse(JSON.stringify(x));

/** A clean outcome with the given fields replaced; `providers` merges per provider. */
function outcome(over = {}) {
  const base = {
    requestedProvider: 'openmeteo', usableSteps: 5, transportFailures: 0, lastFailStatus: '',
    offline: false, staleAgeMs: 0, beyondHorizon: false, openMeteoMaxDays: 14,
    usedFallback: false, usedFallbackError: false, usedFallbackHorizon: false, horizonDays: 7,
    missingKey: false,
    providers: { openweather: {}, openmeteo: {} },
  };
  const { providers = {}, ...rest } = over;
  const out = { ...base, ...rest, providers: { ...base.providers } };
  for (const [k, v] of Object.entries(providers)) out.providers[k] = { ...out.providers[k], ...v };
  return out;
}
const decide = (over, noticeAll) => plain(rules.decideNotice(outcome(over), { noticeAll }));

test('a clean computation says nothing, quiet or detailed', () => {
  assert.equal(rules.decideNotice(outcome(), { noticeAll: false }), null);
  assert.equal(rules.decideNotice(outcome(), { noticeAll: true }), null);
});

test('an empty table whose requests failed says why: offline, rejected, or not responding', () => {
  const empty = { usableSteps: 0, transportFailures: 3 };
  assert.deepEqual(decide({ ...empty, offline: true, lastFailStatus: 'network' }),
    { parts: [['offline_no_data', {}]], type: 'warn' });
  assert.deepEqual(decide({ ...empty, lastFailStatus: '401' }), { parts: [['provider_rejected', {}]], type: 'warn' });
  assert.deepEqual(decide({ ...empty, lastFailStatus: '403' }), { parts: [['provider_rejected', {}]], type: 'warn' });
  assert.deepEqual(decide({ ...empty, lastFailStatus: '500' }), { parts: [['provider_unreachable', {}]], type: 'warn' });
  assert.deepEqual(decide({ ...empty, lastFailStatus: 'network' }, true), { parts: [['provider_unreachable', {}]], type: 'warn' });
});

test('failed requests on a table that still has data are not an empty-table notice', () => {
  assert.equal(rules.decideNotice(outcome({ usableSteps: 4, transportFailures: 1, lastFailStatus: 'network' }), {}), null);
});

/* This line used to assert `null`: no readings, nothing failed, nothing to say. That was
   defensible while the page drew a table of dashes — the empty columns were the message.
   They are not drawn any more (`renderWeatherTable`, app.js), so silence here is a route
   on a map and no explanation anywhere. Every way of ending with no readings now speaks. */
test('a computation that ends with no readings says so even though nothing failed', () => {
  assert.deepEqual(plain(rules.decideNotice(outcome({ usableSteps: 0, transportFailures: 0 }), {})),
    { parts: [['no_forecast_data', {}]], type: 'warn' });

  // The horizon is the common way in, and it is said whether or not every notice is
  // wanted: behind `noticeAll` it is a footnote about a few missing columns, and here it
  // is the only thing on screen that knows why there is no forecast at all.
  for (const noticeAll of [false, true]) {
    assert.deepEqual(plain(rules.decideNotice(outcome({ usableSteps: 0, beyondHorizon: true, openMeteoMaxDays: 14 }), { noticeAll })),
      { parts: [['horizon_exceeded', { days: 14 }]], type: 'warn' });
  }

  // A table with something in it is none of this function's business here.
  assert.equal(rules.decideNotice(outcome({ usableSteps: 1, transportFailures: 0 }), {}), null);
});

test('data read from the cache without connection says how old it is', () => {
  assert.deepEqual(decide({ staleAgeMs: 100 * 60000 }), { parts: [['offline_stale_forecast', { age: '1 h 40 min' }]], type: 'warn' });
  assert.deepEqual(decide({ staleAgeMs: 45 * 60000 }), { parts: [['offline_stale_forecast', { age: '45 min' }]], type: 'warn' });
});

test('an empty table outranks stale data, and stale data outranks the provider policy', () => {
  assert.equal(decide({ usableSteps: 0, transportFailures: 1, offline: true, staleAgeMs: 60000 }).parts[0][0], 'offline_no_data');
  assert.equal(decide({ staleAgeMs: 60000, usedFallbackError: true, providers: { openweather: { invalidKey: true } } }).parts[0][0],
    'offline_stale_forecast');
});

test('a comparison names each provider that failed: its key, its quota, its HTTP status, or that it is not responding', () => {
  const compare = { requestedProvider: 'compare', usableSteps: 4, transportFailures: 3, lastFailStatus: 'network' };
  assert.deepEqual(decide({ ...compare, failedProviders: { aromehd: { status: '500', code: null }, openmeteo: { status: 'network', code: null } } }), {
    parts: [['provider_http_error', { prov: 'AROME-HD', status: '500' }], ['provider_not_responding', { prov: 'Open-Meteo' }]],
    type: 'error',
  });
  // OpenWeather's errors as the table classifies them: 401 the key, 429 the quota, 403 an HTTP error.
  const ow = (status, code) => decide({ ...compare, failedProviders: { openweather: { status, code } } }).parts;
  assert.deepEqual(ow('401', 'invalid_key'), [['provider_key_invalid', { prov: 'OpenWeather' }]]);
  assert.deepEqual(ow('429', 'quota'), [['provider_quota_exceeded', { prov: 'OpenWeather' }]]);
  assert.deepEqual(ow('403', 'forbidden'), [['provider_http_error', { prov: 'OpenWeather', status: '403' }]]);
  // The missing key goes first: a date comparison asked Open-Meteo instead, as the table does.
  assert.deepEqual(decide({ ...compare, missingKey: true, failedProviders: { openmeteo: { status: 'body', code: null } } }).parts,
    [['provider_key_missing', { prov: 'OpenWeather' }], ['fallback_short', {}], ['provider_not_responding', { prov: 'Open-Meteo' }]]);
  // Without connection the failure is not the provider's, and a comparison where none failed says nothing.
  assert.equal(decide({ ...compare, offline: true, failedProviders: { openmeteo: { status: 'network', code: null } } }), null);
  assert.equal(decide({ ...compare, failedProviders: {} }), null);
});

test('quiet mode: key, quota and HTTP errors are named only when they forced a fallback', () => {
  assert.deepEqual(decide({ missingKey: true, requestedProvider: 'openweather' }),
    { parts: [['provider_key_missing', { prov: 'OpenWeather' }], ['fallback_short', {}]], type: 'error' });
  assert.deepEqual(decide({ usedFallbackError: true, providers: { openweather: { invalidKey: true } } }),
    { parts: [['provider_key_invalid', { prov: 'OpenWeather' }], ['fallback_short', {}]], type: 'error' });
  assert.deepEqual(decide({ usedFallbackError: true, providers: { openweather: { httpError: true, httpStatus: 502 } } }).parts[0],
    ['provider_http_error', { prov: 'OpenWeather', status: '502' }]);
  assert.deepEqual(decide({ usedFallbackError: true, requestedProvider: 'openweather' }),
    { parts: [['fallback_due_error', { prov: 'OpenWeather' }]], type: 'warn' });
  // Without a fallback, quiet mode keeps these to itself.
  assert.equal(rules.decideNotice(outcome({ providers: { openweather: { invalidKey: true } } }), { noticeAll: false }), null);
  assert.equal(rules.decideNotice(outcome({ usedFallbackHorizon: true, beyondHorizon: true }), { noticeAll: false }), null);
});

test('quiet mode keeps the old precedence: a missing key before an invalid one', () => {
  assert.equal(decide({ missingKey: true, usedFallbackError: true, providers: { openweather: { invalidKey: true } } }).parts[0][0],
    'provider_key_missing');
});

test('detailed mode adds the horizon notices and the errors that did not force a fallback', () => {
  assert.deepEqual(decide({ beyondHorizon: true, usedFallbackHorizon: true }, true),
    { parts: [['horizon_exceeded', { days: 14 }]], type: 'warn' });
  assert.deepEqual(decide({ usedFallbackHorizon: true, horizonDays: 4 }, true),
    { parts: [['fallback_to_openmeteo', { days: 4 }]], type: 'warn' });
  assert.deepEqual(decide({ providers: { openweather: { invalidKey: true } } }, true),
    { parts: [['provider_key_invalid', { prov: 'OpenWeather' }]], type: 'error' });
  assert.deepEqual(decide({ providers: { openweather: { quota: true } } }, true).parts, [['provider_quota_exceeded', { prov: 'OpenWeather' }]]);
  assert.deepEqual(decide({ providers: { openmeteo: { httpError: true, httpStatus: 500 } } }, true),
    { parts: [['provider_http_error', { prov: 'Open-Meteo', status: '500' }]], type: 'error' });
  // A missing key still outranks the error flags, as before.
  assert.equal(decide({ missingKey: true, providers: { openweather: { invalidKey: true } } }, true).parts[0][0], 'provider_key_missing');
});

test('hasReading is asked directly, in both the shapes it is handed', () => {
  // Everything else here goes through `usableSteps` -> `extractStep`, so only the RAW
  // shape (`wind`) is ever exercised. Dropping `windSpeed` — which would empty the main
  // table and every comparison for a provider with no temperature — passed the whole node
  // suite. These ask the predicate itself, in both shapes.
  const has = rules.hasReading;
  assert.equal(has({ temp: 12 }), true, 'a temperature');
  assert.equal(has({ temp: 0 }), true, 'zero degrees is a reading');
  assert.equal(has({ wind: 5 }), true, 'the raw shape calls it wind');
  assert.equal(has({ windSpeed: 5 }), true, 'the processed shape calls it windSpeed');
  assert.equal(has({ windSpeed: 0 }), true, 'no wind is a reading; a missing one is not');
  assert.equal(has({ precipitation: 2 }), true, 'rain');

  assert.equal(has({ precipitation: 0 }), false,
    'zero millimetres is the absence of rain, not a forecast: counting it stopped a prepared snapshot being replayed');
  assert.equal(has({ precipProb: 80 }), false,
    'a probability with no amount is what `formatRainCell` draws as "-": counting it drew a row of dashes');
  assert.equal(has({ humidity: 60, cloudCover: 40, weatherCode: 3 }), false, 'not on their own');
  assert.equal(has({ temp: null, windSpeed: null }), false);
  assert.equal(has(null), false);
  assert.equal(has({}), false);

  // The coercions that make the obvious one-liner accept junk: Number() turns all three
  // of these into 0.
  for (const junk of [false, [], '  ', 'abc', NaN, undefined]) {
    assert.equal(has({ temp: junk }), false, `${JSON.stringify(junk)} is not a temperature`);
  }
  assert.equal(has({ temp: '12' }), true, 'a number as a string still is one');
});

test('usableSteps counts rain on its own, but never humidity on its own', () => {
  // Temperature, wind or rain are what a ride is planned around; humidity and cloud cover
  // ride along with them. The case this exists for: `mergeAromeWithStandard` fills
  // `precipitation_probability`, `weathercode` and `cloud_cover` from the standard
  // Open-Meteo answer onto AROME's hours, so an AROME run that misses those hours can
  // leave a step with a rain probability and nothing else. Counted as no forecast, that
  // step used to cost the whole table — and, since nothing failed, without a notice.
  const time = new Date('2026-09-20T09:00:00Z');
  const step = (drop) => [{ provider: 'openmeteo', time, payload: openMeteo({ minutely: false, drop }) }];

  // The fixture's precipitation series is `i % 5 === 0 ? 0 : i / 10`, so pick an hour with
  // rain in it rather than one of the zeroes: at 09:00 UTC this is a real amount, and it
  // is the only thing left once temperature and wind are dropped.
  assert.equal(rules.usableSteps(step(['temperature_2m', 'wind_speed_10m'])), 1, 'rain alone is a forecast');
  assert.equal(rules.usableSteps(step(['temperature_2m', 'precipitation', 'precipitation_probability'])), 1,
    'wind alone is a forecast');
  assert.equal(rules.usableSteps(step(['wind_speed_10m', 'precipitation', 'precipitation_probability'])), 1,
    'a temperature alone is a forecast');
  assert.equal(
    rules.usableSteps(step(['temperature_2m', 'wind_speed_10m', 'precipitation', 'precipitation_probability'])), 0,
    'humidity, cloud cover and a weather code on their own are not a forecast');
});

test('usableSteps counts steps with a temperature or wind at their time, cached or not', () => {
  const time = new Date('2026-09-20T09:00:00Z');
  const steps = [
    { provider: 'openmeteo', time, payload: openMeteo() },
    { provider: 'openweather', time, payloadUnits: 'metric', payload: openWeather('metric') },
    { provider: 'openmeteo', time, payload: { hourly: { time: [] } } },      // HTTP 200, nothing in it
    { provider: 'openmeteo', time, payload: { hourly: { time: ['2026-09-20T11:00'] } } },  // hours, no values
    { provider: 'openweather', time, payloadUnits: 'metric', payload: { hourly: [], daily: [] } },
    { provider: 'openmeteo', time, payload: null },                         // the request failed
    { provider: 'unknown', time, payload: { data_1h: {} } },                // an unhandled provider is never extracted
  ];
  assert.equal(rules.usableSteps(steps), 2);
  assert.equal(rules.usableSteps([]), 0);
});

test('alertsInWindow keeps the warnings that overlap the window, once each', () => {
  const a = (event, start, end) => ({ sender_name: 'AEMET', event, start, end });
  const alerts = [
    a('before', 100, 199),
    a('edge-start', 100, 200),
    a('inside', 250, 260),
    a('edge-end', 300, 400),
    a('after', 301, 400),
    a('open-ended', 150, 0),                  // OpenWeather sends 0 for no end
    a('inside', 250, 260),                    // the same warning seen from another step
  ];
  assert.deepEqual(plain(rules.alertsInWindow(alerts, 200, 300).map((x) => x.event)),
    ['edge-start', 'inside', 'edge-end', 'open-ended']);
  assert.equal(rules.alertId(a('Wind', 1, 2)), 'AEMET_Wind_1_2');
});

test('a replayed prepared snapshot says how old its data is and for what start it was prepared', () => {
  const now = Date.parse('2026-09-20T10:00:00Z');
  const prepared = { origin: 'prepared', preparedAt: now - 100 * 60000, preparedFor: Date.parse('2026-09-20T08:00:00Z'), now };
  assert.deepEqual(plain(rules.decideNotice(outcome(), prepared)),
    { parts: [['prepared_replayed', { age: '1 h 40 min', at: '10:00' }]], type: 'warn' });
  // Before stale data and the provider policy.
  assert.equal(plain(rules.decideNotice(outcome({ staleAgeMs: 60000, usedFallbackError: true }), prepared)).parts[0][0],
    'prepared_replayed');
  // An empty table whose requests failed still says why first.
  assert.equal(plain(rules.decideNotice(outcome({ usableSteps: 0, transportFailures: 1, offline: true }), prepared)).parts[0][0],
    'offline_no_data');
  // A live snapshot says nothing of the kind.
  assert.equal(rules.decideNotice(outcome(), { ...prepared, origin: 'live' }), null);
});

test('an age is told in whole minutes, never as sixty of them, and never as NaN', () => {
  const age = (o, opts) => plain(rules.decideNotice(outcome(o), opts)).parts[0][1].age;
  const now = Date.parse('2026-09-20T10:00:00Z');
  const replayed = (ms) => ({ origin: 'prepared', preparedAt: now - ms, preparedFor: now, now });
  assert.equal(age({}, replayed(2 * 3600000 - 20000)), '1 h 59 min');
  assert.equal(age({}, replayed(45 * 60000 - 20000)), '44 min');
  assert.equal(age({}, replayed(60 * 60000)), '1 h 0 min');
  assert.equal(age({ staleAgeMs: 3600000 - 20000 }, {}), '59 min');
  // Without a clock there is no age to tell.
  assert.doesNotMatch(age({}, { origin: 'prepared', preparedAt: now, preparedFor: now }), /NaN/);
});
