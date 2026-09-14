// Open-Meteo ignores `start=`: it returns 7 days from today regardless. This slices the
// real buildProviderUrl out of app.js and checks the openmeteo/aromehd branches ask for
// the day range around the step instead (verified live 14 Sept 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../public/scripts');
const src = await readFile(join(SCRIPTS, 'app.js'), 'utf8');
const start = src.indexOf('function buildProviderUrl(');
const end = src.indexOf('\n// NEW: Helper to reconcile OpenMeteo weather code', start);
assert.ok(start !== -1 && end > start, 'app.js no longer looks the way this test expects');
const code = src.slice(start, end);

function harness() {
  const s = { getVal: () => 'on' };
  vm.runInNewContext(code, s);
  return s;
}

const p = { lat: 41.4, lon: 2.2 };

for (const prov of ['openmeteo', 'aromehd']) {
  test(`${prov}: asks Open-Meteo for the day range around the step, not start=`, () => {
    const s = harness();
    const url = s.buildProviderUrl(prov, p, new Date('2026-09-24T08:00:00Z'), '', 'kmh', 'C');
    assert.ok(!url.includes('start='), `URL should not carry start=: ${url}`);
    assert.ok(url.includes('start_date=2026-09-23'), url);
    assert.ok(url.includes('end_date=2026-09-25'), url);
  });

  test(`${prov}: the day range straddles midnight UTC too`, () => {
    const s = harness();
    const url = s.buildProviderUrl(prov, p, new Date('2026-09-24T23:30:00Z'), '', 'kmh', 'C');
    assert.ok(url.includes('start_date=2026-09-23'), url);
    assert.ok(url.includes('end_date=2026-09-25'), url);
  });
}

// The checkbox used to be read with getVal, which answers "on" whether it is ticked or
// not; the computation now passes the value it read.
test('openweather: unticked alerts are left out of the request', () => {
  const s = harness();
  const url = s.buildProviderUrl('openweather', p, new Date('2026-09-24T08:00:00Z'), 'key', 'kmh', 'C', false);
  assert.ok(url.includes('exclude=minutely,alerts'), url);
});

test('openweather: ticked alerts are asked for, and so are they when a caller says nothing', () => {
  for (const alerts of [true, undefined]) {
    const s = harness();
    const url = s.buildProviderUrl('openweather', p, new Date('2026-09-24T08:00:00Z'), 'key', 'kmh', 'C', alerts);
    assert.ok(/exclude=minutely(&|$)/.test(url), `${alerts}: ${url}`);
  }
});
