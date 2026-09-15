// The rules a route request leans on: what counts as the same route text, whether a
// snapshot may still reach the screen, and which name an imported route is stored under.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(HERE, '../../public/scripts/forecast-rules.js'), 'utf8');
const rules = vm.runInNewContext(`${src}; cwForecastRules`, {});
const plain = (x) => JSON.parse(JSON.stringify(x));

test('fingerprint is the length and a 32-bit FNV-1a of the exact text', () => {
  assert.equal(rules.fingerprint('abc'), '3:1a47e90b');
  assert.equal(rules.fingerprint(''), '0:811c9dc5');
  // A hash with the top bit set: kept as a signed 32-bit number it would print negative.
  assert.equal(rules.fingerprint('a'), '1:e40c292c');
  const gpx = '<gpx><trk><trkpt lat="41.1" lon="2.1"/></trk></gpx>';
  assert.equal(rules.fingerprint(gpx), rules.fingerprint(gpx));
  assert.match(rules.fingerprint(gpx), /^\d+:[0-9a-f]{8}$/);
  assert.notEqual(rules.fingerprint(gpx), rules.fingerprint(gpx.replace('41.1', '41.2')));
  // Same length, different text: the hash tells them apart, not the length.
  assert.notEqual(rules.fingerprint('ab'), rules.fingerprint('ba'));
  // A hash that grew past 32 bits would print more than eight digits.
  assert.match(rules.fingerprint('x'.repeat(5000)), /^5000:[0-9a-f]{8}$/);
});

test('shouldPublish: only the latest computation of the confirmed route', () => {
  const state = { confirmedRequestId: 3, lastComputationId: 7 };
  assert.equal(rules.shouldPublish({ requestId: 3, computationId: 7 }, state), true);
  assert.equal(rules.shouldPublish({ requestId: 3, computationId: 6 }, state), false, 'replaced by another computation');
  assert.equal(rules.shouldPublish({ requestId: 2, computationId: 7 }, state), false, 'replaced by another confirmation');
  assert.equal(rules.shouldPublish({ computationId: 7 }, state), false, 'no requestId');
  assert.equal(rules.shouldPublish({ requestId: 3 }, state), false, 'no computationId');
  assert.equal(rules.shouldPublish({ requestId: '3', computationId: '7' }, state), false, 'identities are integers');
  assert.equal(rules.shouldPublish(null, state), false);
  // A request still in flight has not confirmed anything, so the state it would change
  // is untouched and the computation on screen still publishes.
  assert.equal(rules.shouldPublish({ requestId: 3, computationId: 7 }, { ...state }), true);
});

test('shouldPublishComparison: only the latest comparison of the latest computation, published, of the confirmed route', () => {
  const state = { confirmedRequestId: 3, lastComputationId: 7, publishedComputationId: 7, lastComparisonId: 2 };
  const run = { requestId: 3, computationId: 7, comparisonId: 2 };
  assert.equal(rules.shouldPublishComparison(run, state), true);
  assert.equal(rules.shouldPublishComparison({ ...run, comparisonId: 1 }, state), false, 'another comparison launched since');
  assert.equal(rules.shouldPublishComparison(run, { ...state, lastComputationId: 8 }), false, 'another computation launched');
  assert.equal(rules.shouldPublishComparison(run, { ...state, publishedComputationId: 6 }), false, 'the snapshot on screen is of another computation');
  assert.equal(rules.shouldPublishComparison(run, { ...state, confirmedRequestId: 4 }), false, 'another route confirmed');
  for (const field of ['requestId', 'computationId', 'comparisonId']) {
    const partial = { ...run };
    delete partial[field];
    assert.equal(rules.shouldPublishComparison(partial, state), false, `no ${field}`);
  }
  assert.equal(rules.shouldPublishComparison({ requestId: '3', computationId: '7', comparisonId: '2' }, state), false, 'identities are integers');
  assert.equal(rules.shouldPublishComparison(null, state), false);
  assert.equal(rules.shouldPublishComparison(run, null), false);
});

const rec = (id, name, fingerprint, size) => ({ id, name, fingerprint, size });
const unique = (records, name, fingerprint = 'fp-new', bytes = 100) =>
  plain(rules.uniqueRouteName(records, { name, fingerprint, bytes }));

test('uniqueRouteName keeps a free name and replaces the same content', () => {
  assert.deepEqual(unique([], 'Ruta.gpx'), { name: 'Ruta.gpx', replaceId: null });
  assert.deepEqual(unique([rec(1, 'Otra.gpx', 'x')], 'Ruta.gpx'), { name: 'Ruta.gpx', replaceId: null });
  assert.deepEqual(unique([rec(4, 'Ruta.gpx', 'fp-new')], 'Ruta.gpx'), { name: 'Ruta.gpx', replaceId: 4 });
});

test('uniqueRouteName adds the first free suffix for different content', () => {
  assert.deepEqual(unique([rec(1, 'Ruta.gpx', 'a')], 'Ruta.gpx'), { name: 'Ruta (2).gpx', replaceId: null });
  assert.deepEqual(unique([rec(1, 'Ruta.gpx', 'a'), rec(2, 'Ruta (2).gpx', 'b')], 'Ruta.gpx'),
    { name: 'Ruta (3).gpx', replaceId: null });
  assert.deepEqual(unique([rec(1, 'Ruta.gpx', 'a'), rec(2, 'Ruta (2).gpx', 'fp-new')], 'Ruta.gpx'),
    { name: 'Ruta (2).gpx', replaceId: 2 });
});

test('uniqueRouteName does not read a suffix the name already carries', () => {
  assert.deepEqual(unique([rec(1, 'Ruta (2).gpx', 'a')], 'Ruta (2).gpx'), { name: 'Ruta (2) (2).gpx', replaceId: null });
});

test('uniqueRouteName never replaces an old record without a fingerprint', () => {
  // Nothing says what it holds: the same name and size can be a route one digit away.
  assert.deepEqual(unique([rec(9, 'Ruta.gpx', undefined, 100)], 'Ruta.gpx', 'fp-new', 100), { name: 'Ruta (2).gpx', replaceId: null });
  assert.deepEqual(unique([rec(9, 'Ruta.gpx', undefined, 99)], 'Ruta.gpx', 'fp-new', 100), { name: 'Ruta (2).gpx', replaceId: null });
  assert.deepEqual(unique([rec(9, 'Ruta.gpx', undefined, 100), rec(10, 'Ruta (2).gpx', undefined, 100)], 'Ruta.gpx', 'fp-new', 100),
    { name: 'Ruta (3).gpx', replaceId: null });
  // A record that has a fingerprint is never matched by size alone.
  assert.deepEqual(unique([rec(9, 'Ruta.gpx', 'other', 100)], 'Ruta.gpx', 'fp-new', 100), { name: 'Ruta (2).gpx', replaceId: null });
});

test('uniqueRouteName keeps the extension as written, or none', () => {
  assert.deepEqual(unique([rec(1, 'Costa.KML', 'a')], 'Costa.KML'), { name: 'Costa (2).KML', replaceId: null });
  assert.deepEqual(unique([rec(1, 'Shared route', 'a')], 'Shared route'), { name: 'Shared route (2)', replaceId: null });
});
