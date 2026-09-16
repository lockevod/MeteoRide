// The start of a computation is never earlier than now, rounded up to the quarter hour
// (spec §4.8). Rounding by wall-clock minutes ignored the seconds, and at the end of summer time
// set the hour on a clock that had just gone back, an hour off. This file runs as a phone in Madrid.
process.env.TZ = 'Europe/Madrid';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const utils = await readFile(join(HERE, '../../public/scripts/utils.js'), 'utf8');
const from = utils.indexOf('  function roundToNextQuarterISO(');
const to = utils.indexOf('\n  function setupDateLimits(');
assert.ok(from !== -1 && to > from, 'utils.js no longer looks the way this test slices it');
const { iso, up } = vm.runInNewContext(
  `${utils.slice(from, to)}; ({ iso: roundToNextQuarterISO, up: roundUpToNextQuarterDate })`, {});

test('rounding up counts the seconds', () => {
  assert.equal(up(new Date('2026-09-20T06:15:30Z')).toISOString(), '2026-09-20T06:30:00.000Z');
  assert.equal(up(new Date('2026-09-20T06:15:00Z')).toISOString(), '2026-09-20T06:15:00.000Z');
  assert.equal(iso(new Date('2026-09-20T06:15:30Z')), '2026-09-20T08:30');
});

test('rounding up across the end of summer time lands on the next quarter, not an hour later', () => {
  // 02:50 summer time; ten minutes later the clocks go back from 03:00 to 02:00.
  assert.equal(up(new Date('2026-10-25T00:50:00Z')).toISOString(), '2026-10-25T01:00:00.000Z');
  assert.equal(iso(new Date('2026-10-25T00:50:00Z')), '2026-10-25T02:00');
});
