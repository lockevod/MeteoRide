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
    providers: { meteoblue: {}, openweather: {}, openmeteo: {} },
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
  assert.equal(rules.decideNotice(outcome({ usableSteps: 0, transportFailures: 0 }), {}), null);
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

test('quiet mode: key, quota and HTTP errors are named only when they forced a fallback', () => {
  assert.deepEqual(decide({ missingKey: true, requestedProvider: 'openweather' }),
    { parts: [['provider_key_missing', { prov: 'OpenWeather' }], ['fallback_short', {}]], type: 'error' });
  assert.deepEqual(decide({ missingKey: true, requestedProvider: 'meteoblue' }).parts[0], ['provider_key_missing', { prov: 'MeteoBlue' }]);
  assert.deepEqual(decide({ usedFallbackError: true, providers: { openweather: { invalidKey: true } } }),
    { parts: [['provider_key_invalid', { prov: 'OpenWeather' }], ['fallback_short', {}]], type: 'error' });
  assert.deepEqual(decide({ usedFallbackError: true, providers: { meteoblue: { quota: true } } }).parts[0],
    ['provider_quota_exceeded', { prov: 'MeteoBlue' }]);
  assert.deepEqual(decide({ usedFallbackError: true, providers: { openweather: { httpError: true, httpStatus: 502 } } }).parts[0],
    ['provider_http_error', { prov: 'OpenWeather', status: '502' }]);
  assert.deepEqual(decide({ usedFallbackError: true, providers: { meteoblue: { httpError: true } } }).parts[0],
    ['provider_http_error', { prov: 'MeteoBlue', status: '…' }]);
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
  assert.deepEqual(decide({ providers: { meteoblue: { quota: true } } }, true).parts, [['provider_quota_exceeded', { prov: 'MeteoBlue' }]]);
  assert.deepEqual(decide({ providers: { openmeteo: { httpError: true, httpStatus: 500 } } }, true),
    { parts: [['provider_http_error', { prov: 'Open-Meteo', status: '500' }]], type: 'error' });
  // A missing key still outranks the error flags, as before.
  assert.equal(decide({ missingKey: true, providers: { openweather: { invalidKey: true } } }, true).parts[0][0], 'provider_key_missing');
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
    { provider: 'meteoblue', time, payload: { data_1h: {} } },              // not extracted: an answer counts
  ];
  assert.equal(rules.usableSteps(steps), 3);
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
