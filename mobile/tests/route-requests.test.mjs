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
const plain = (x) => JSON.parse(JSON.stringify(x));

/** A coordinator whose dependencies record what they were asked to do. */
function harness({ confirmed = false, current = false, readTimeoutMs = 30000, writeRecent, touchRecent, now } = {}) {
  const calls = { parse: [], commit: [], launch: 0, notify: 0, readFailed: 0, notSaved: 0, paint: [], warn: 0 };
  // commitThrows, launchThrows and paintThrows make that dependency throw; onLaunch runs
  // inside each launch.
  const state = { confirmed, current, parseResult: null };
  // `now` makes the clock answer the same time on every reading.
  const s = {
    console: { ...console, warn: () => { calls.warn++; } },
    Promise, setTimeout, clearTimeout, Date: now == null ? Date : { now: () => now },
  };
  vm.runInNewContext(`${rulesSrc}\n${src}`, s);
  const c = s.cwCreateRouteCoordinator({
    parse: (input) => { calls.parse.push(input); return state.parseResult ? state.parseResult(input) : { name: input.name }; },
    commit: (parsed, requestId) => {
      calls.commit.push([parsed.name, requestId]);
      state.confirmed = true;
      if (state.commitThrows) throw new Error('commit');
    },
    launch: () => {
      calls.launch++;
      if (state.launchThrows) throw new Error('launch');
      state.current = true;
      if (state.onLaunch) state.onLaunch();
    },
    hasConfirmedRoute: () => state.confirmed,
    hasCurrentForecast: () => state.current,
    paintLoading: (visible) => {
      calls.paint.push(visible);
      if (state.paintThrows) throw new Error('paint');
    },
    notifyFailed: () => { calls.notify++; },
    notifyReadFailed: () => { calls.readFailed++; },
    writeRecent: writeRecent || (async (input) => ({ ok: true, name: input.name })),
    touchRecent: touchRecent || (async () => true),
    notifyNotSaved: () => { calls.notSaved++; },
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
  assert.deepEqual([calls.notify, calls.readFailed], [1, 0]);
  assert.deepEqual(calls.commit, []);
  assert.equal(calls.launch, 0);
});

test('a parse that throws counts as a failure too', async () => {
  const { c, calls, state } = harness();
  state.parseResult = () => { throw new Error('boom'); };
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'x', name: 'x.gpx' }) }), 'failed');
  assert.deepEqual([calls.notify, calls.readFailed], [1, 0]);
});

test('a read that never answers fails at its deadline and lets go of the indicator', async () => {
  const { c, calls } = harness({ readTimeoutMs: 20 });
  const status = await c.requestRoute({ source: 'recent', read: () => new Promise(() => {}) });
  assert.equal(status, 'failed');
  assert.deepEqual([calls.readFailed, calls.notify], [1, 0], 'a read that timed out is not a file without a route');
  assert.deepEqual(calls.paint, [true, false]);
});

test('a read that rejects fails with the notice that it could not be read', async () => {
  const { c, calls } = harness();
  assert.equal(await c.requestRoute({ source: 'file', read: async () => { throw new Error('unreadable'); } }), 'failed');
  assert.deepEqual([calls.readFailed, calls.notify], [1, 0], 'a read that failed is not a file without a route');
});

test('a read that fails after a later request was made is superseded, and says nothing', async () => {
  const { c, calls } = harness();
  const a = gate();
  const b = gate();
  const ra = c.requestRoute({ source: 'file', read: () => a.promise });
  await flush();
  const rb = c.requestRoute({ source: 'file', read: () => b.promise });
  a.fail(new Error('unreadable'));
  assert.equal(await ra, 'superseded');
  assert.deepEqual([calls.readFailed, calls.notify], [0, 0]);
  b.open({ text: 'B', name: 'b.gpx' });
  assert.equal(await rb, 'committed');
});

test('a request replaced in the same tick never reads', async () => {
  const { c, calls } = harness();
  let readsA = 0;
  const ra = c.requestRoute({ source: 'file', read: async () => { readsA++; return { text: 'A', name: 'a.gpx' }; } });
  const rb = c.requestRoute({ source: 'file', read: async () => ({ text: 'B', name: 'b.gpx' }) });
  assert.equal(await ra, 'superseded');
  assert.equal(await rb, 'committed');
  assert.equal(readsA, 0);
  assert.deepEqual(calls.commit, [['b.gpx', 2]]);
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

test('settings changed while a confirmed route launches its computation are not lost', async () => {
  const { c, calls, state } = harness();
  state.onLaunch = () => { if (calls.launch === 1) c.settingsChanged(); };
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) }), 'committed');
  assert.equal(calls.launch, 2);
});

test('a confirmed route whose computation stops at once is not launched again', async () => {
  const { c, calls, state } = harness();
  state.onLaunch = () => { state.current = false; };
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) }), 'committed');
  assert.equal(calls.launch, 1);
});

test('a commit that throws still counts as confirmed: one launch, and the request resolves and lets go', async () => {
  // Committing clears the forecast on screen before it throws, as the page's does.
  const { c, calls, state } = harness({ confirmed: true, current: false });
  state.commitThrows = true;
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) }), 'committed');
  assert.equal(calls.launch, 1);
  assert.deepEqual(calls.paint, [true, false]);
  assert.equal(calls.warn, 1, 'the error is logged');
});

test('a launch that throws is attempted once, and the request resolves and lets go', async () => {
  const { c, calls, state } = harness();
  state.launchThrows = true;
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) }), 'committed');
  assert.equal(calls.launch, 1);
  assert.deepEqual(calls.paint, [true, false]);
  assert.equal(calls.warn, 1, 'the error is logged');
  c.settingsChanged();
  assert.equal(calls.launch, 2, 'a setting changed later launches again, and does not throw either');
});

test('an indicator that cannot be painted does not stop the request', async () => {
  const { c, calls, state } = harness();
  state.paintThrows = true;
  assert.equal(await c.requestRoute({ source: 'file', read: async () => ({ text: 'A', name: 'a.gpx' }) }), 'committed');
  assert.equal(calls.launch, 1);
  assert.deepEqual(calls.paint, [true, false]);
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
  const rb = h.c.requestRoute({ source: 'file', read: () => b.promise });
  h.c.releaseLoading('request:2');
  assert.deepEqual(h.calls.paint, [true, false], 'request 1 had already let go');
  a.open({ text: 'A', name: 'a.gpx' });
  assert.equal(await ra, 'superseded');
  assert.deepEqual(h.calls.paint, [true, false]);
  // No read left waiting on its deadline once the test ends.
  b.open(null);
  assert.equal(await rb, 'failed');
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

test('imports run in the order they arrived, even when the first write is the slowest', async () => {
  const log = [];
  const first = gate();
  const { c } = harness({ writeRecent: async (input) => {
    log.push(`start ${input.name}`);
    if (input.name === 'a.gpx') await first.promise;
    log.push(`end ${input.name}`);
    return { ok: true, name: input.name };
  } });
  const a = c.importRoute({ text: 'A', name: 'a.gpx' });
  const b = c.importRoute({ text: 'B', name: 'b.gpx' });
  await flush();
  assert.deepEqual(log, ['start a.gpx'], 'B started before A finished');
  first.open();
  assert.deepEqual(plain(await a), { ok: true, name: 'a.gpx' });
  assert.deepEqual(plain(await b), { ok: true, name: 'b.gpx' });
  assert.deepEqual(log, ['start a.gpx', 'end a.gpx', 'start b.gpx', 'end b.gpx']);
});

test('moving a recent route to the top waits for the imports before it, and a later clock reading', async () => {
  const log = [];
  const first = gate();
  const { c } = harness({
    now: 1000,
    writeRecent: async (input) => {
      log.push(`import ${input.arrivedAt}`);
      await first.promise;
      log.push('imported');
      return { ok: true, name: input.name };
    },
    touchRecent: async (id, at) => {
      log.push(`touch ${id} ${at}`);
      if (id === 'gone') throw new Error('transaction failed');
      return true;
    },
  });
  const a = c.importRoute({ text: 'A', name: 'a.gpx' });
  const moved = c.touchRecent(7);
  const failed = c.touchRecent('gone');
  const b = c.importRoute({ text: 'B', name: 'b.gpx' });
  await flush();
  assert.deepEqual(log, ['import 1000'], 'the move ran before the import in front of it finished');
  first.open();
  await Promise.all([a, b]);
  assert.equal(await moved, true);
  assert.equal(await failed, false, 'a move that throws resolves false');
  assert.deepEqual(log, ['import 1000', 'imported', 'touch 7 1001', 'touch gone 1002', 'import 1003', 'imported']);
});

test('arrivedAt grows strictly on the same clock reading, and each write carries its fingerprint', async () => {
  const seen = [];
  const { c } = harness({ now: 1000, writeRecent: async (input) => {
    seen.push([input.name, input.arrivedAt, input.fingerprint]);
    return { ok: true, name: input.name };
  } });
  await Promise.all(['x', 'y', 'z'].map((n) => c.importRoute({ text: 'abc', name: `${n}.gpx` })));
  assert.deepEqual(seen, [['x.gpx', 1000, '3:1a47e90b'], ['y.gpx', 1001, '3:1a47e90b'], ['z.gpx', 1002, '3:1a47e90b']]);
});

test('a failed import says so and does not hold up the ones after it', async () => {
  const { c, calls } = harness({ writeRecent: async (input) => {
    if (input.name === 'throws.gpx') throw new Error('QuotaExceededError');
    if (input.name === 'refused.gpx') return { ok: false };
    return { ok: true, name: input.name };
  } });
  const results = await Promise.all([
    c.importRoute({ text: '1', name: 'throws.gpx' }),
    c.importRoute({ text: '2', name: 'refused.gpx' }),
    c.importRoute({ text: '3', name: 'fine.gpx' }),
  ]);
  assert.deepEqual(plain(results), [{ ok: false, name: 'throws.gpx' }, { ok: false, name: 'refused.gpx' }, { ok: true, name: 'fine.gpx' }]);
  assert.equal(calls.notSaved, 2);
});
