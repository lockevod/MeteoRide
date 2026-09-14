// The route coordinator with fake dependencies: which request may confirm, when a
// computation is launched, and who keeps the loading indicator on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts');
const rulesSrc = await readFile(join(SCRIPTS, 'forecast-rules.js'), 'utf8');
const src = await readFile(join(SCRIPTS, 'route-requests.js'), 'utf8');

/** A promise the test resolves or rejects when it wants. */
function gate() {
  let open, fail;
  const promise = new Promise((resolve, reject) => { open = resolve; fail = reject; });
  return { promise, open, fail };
}
const flush = () => new Promise((r) => setImmediate(r));

/** A coordinator whose dependencies record what they were asked to do. */
function harness({ confirmed = false, current = false, readTimeoutMs = 30000 } = {}) {
  const calls = { parse: [], commit: [], launch: 0, notify: 0, paint: [] };
  const state = { confirmed, current, parseResult: null };
  const s = { console, Promise, setTimeout, clearTimeout, Date };
  vm.runInNewContext(`${rulesSrc}\n${src}`, s);
  const c = s.cwCreateRouteCoordinator({
    parse: (input) => { calls.parse.push(input); return state.parseResult ? state.parseResult(input) : { name: input.name }; },
    commit: (parsed, requestId) => { calls.commit.push([parsed.name, requestId]); state.confirmed = true; },
    launch: () => { calls.launch++; state.current = true; },
    hasConfirmedRoute: () => state.confirmed,
    hasCurrentForecast: () => state.current,
    paintLoading: (visible) => calls.paint.push(visible),
    notifyFailed: () => { calls.notify++; },
    readTimeoutMs,
  });
  return { c, calls, state };
}

test('a request replaced before its read resolves neither parses nor confirms', async () => {
  const { c, calls } = harness();
  const a = gate();
  const b = gate();
  const ra = c.requestRoute({ source: 'file', read: () => a.promise });
  const rb = c.requestRoute({ source: 'file', read: () => b.promise });
  b.open({ text: 'B', name: 'b.gpx' });
  assert.equal(await rb, 'committed');
  a.open({ text: 'A', name: 'a.gpx' });
  assert.equal(await ra, 'superseded');
  assert.deepEqual(calls.parse.map((p) => p.name), ['b.gpx']);
  assert.deepEqual(calls.commit, [['b.gpx', 2]]);
  assert.equal(calls.launch, 1);
});

test('a request replaced while it parses does not confirm', async () => {
  const { c, calls, state } = harness();
  const parseA = gate();
  state.parseResult = (input) => (input.name === 'a.gpx' ? parseA.promise : { name: input.name });
  const ra = c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) });
  await flush();
  assert.deepEqual(calls.parse.map((p) => p.name), ['a.gpx'], 'A is parsing');
  const rb = c.requestRoute({ source: 'file', read: async () => ({ text: 'B', name: 'b.gpx' }) });
  assert.equal(await rb, 'committed');
  parseA.open({ name: 'a.gpx' });
  assert.equal(await ra, 'superseded');
  assert.deepEqual(calls.commit, [['b.gpx', 2]]);
});

test('a route that fails to parse leaves the confirmed one and its computation alone', async () => {
  const { c, calls, state } = harness({ confirmed: true, current: true });
  state.parseResult = () => null;
  const status = await c.requestRoute({ source: 'file', read: async () => ({ text: 'junk', name: 'x.gpx' }) });
  assert.equal(status, 'failed');
  assert.equal(calls.notify, 1);
  assert.deepEqual(calls.commit, []);
  assert.equal(calls.launch, 0);
});

test('a parse that throws counts as a failure too', async () => {
  const { c, calls, state } = harness();
  state.parseResult = () => { throw new Error('boom'); };
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'x', name: 'x.gpx' }) }), 'failed');
  assert.equal(calls.notify, 1);
});

test('a read that never answers fails at its deadline and lets go of the indicator', async () => {
  const { c, calls } = harness({ readTimeoutMs: 20 });
  const status = await c.requestRoute({ source: 'recent', read: () => new Promise(() => {}) });
  assert.equal(status, 'failed');
  assert.equal(calls.notify, 1);
  assert.deepEqual(calls.paint, [true, false]);
});

test('a read that rejects fails with a notice', async () => {
  const { c, calls } = harness();
  assert.equal(await c.requestRoute({ source: 'file', read: async () => { throw new Error('unreadable'); } }), 'failed');
  assert.equal(calls.notify, 1);
});

test('a read with nothing to open fails quietly', async () => {
  const { c, calls } = harness();
  assert.equal(await c.requestRoute({ source: 'recent', read: async () => null }), 'failed');
  assert.equal(calls.notify, 0);
  assert.deepEqual(calls.parse, []);
});

test('settings changed while a route is acquired are used by its one computation', async () => {
  const { c, calls } = harness({ confirmed: true, current: true });
  const b = gate();
  const rb = c.requestRoute({ source: 'file', read: () => b.promise });
  c.settingsChanged();
  assert.equal(calls.launch, 0, 'nothing launched while the request is acquiring');
  b.open({ text: 'B', name: 'b.gpx' });
  assert.equal(await rb, 'committed');
  assert.equal(calls.launch, 1);
  // The mark was consumed by that launch: finishing another request does not relaunch.
  assert.equal(await c.requestRoute({ source: 'recent', read: async () => null }), 'failed');
  assert.equal(calls.launch, 1);
});

test('settings changed while a new route is acquired and then fails recompute the confirmed one once', async () => {
  const { c, calls, state } = harness({ confirmed: true, current: true });
  state.parseResult = () => null;
  const b = gate();
  const rb = c.requestRoute({ source: 'file', read: () => b.promise });
  c.settingsChanged();
  c.settingsChanged();
  assert.equal(calls.launch, 0);
  b.open({ text: 'junk', name: 'b.gpx' });
  assert.equal(await rb, 'failed');
  assert.equal(calls.launch, 1);
});

test('settings changed with no request in flight launch at once, and only with a route', () => {
  const withRoute = harness({ confirmed: true, current: true });
  withRoute.c.settingsChanged();
  assert.equal(withRoute.calls.launch, 1);

  const noRoute = harness();
  noRoute.c.settingsChanged();
  assert.equal(noRoute.calls.launch, 0);
});

test('a confirmed route left without a forecast is recomputed when a request ends', async () => {
  const { c, calls } = harness({ confirmed: true, current: false });
  assert.equal(await c.requestRoute({ source: 'file', read: async () => { throw new Error('x'); } }), 'failed');
  assert.equal(calls.launch, 1);
});

test('the indicator: each request claims it and every ending lets go', async () => {
  // Confirmed.
  let h = harness();
  await h.c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) });
  assert.deepEqual(h.calls.paint, [true, false]);
  // Failed.
  h = harness();
  h.state.parseResult = () => null;
  await h.c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) });
  assert.deepEqual(h.calls.paint, [true, false]);

  // Replaced: the old request's claim goes as soon as the new one exists, and the new
  // request keeps the indicator on until it ends.
  h = harness();
  const a = gate();
  const b = gate();
  const ra = h.c.requestRoute({ source: 'file', read: () => a.promise });
  h.c.requestRoute({ source: 'file', read: () => b.promise });
  h.c.releaseLoading('request:2');
  assert.deepEqual(h.calls.paint, [true, false], 'request 1 had already let go');
  a.open({ text: 'A', name: 'a.gpx' });
  assert.equal(await ra, 'superseded');
  assert.deepEqual(h.calls.paint, [true, false]);
});

test('the indicator stays on while another owner still holds it', () => {
  const { c, calls } = harness();
  c.claimLoading('forecast:1');
  c.claimLoading('legacy');
  c.releaseLoading('legacy');
  assert.deepEqual(calls.paint, [true]);
  c.releaseLoadingPrefix('forecast:');
  assert.deepEqual(calls.paint, [true, false]);
});
