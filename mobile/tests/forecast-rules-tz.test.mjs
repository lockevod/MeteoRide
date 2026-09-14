// Open-Meteo sends local times without an offset and says which offset they are in
// (utc_offset_seconds). The device's own zone must not decide which hour a step reads:
// this whole file runs as a phone in New York looking at a route in Spain.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { openMeteo } from './fixtures/providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(HERE, '../../public/scripts/forecast-rules.js'), 'utf8');
const rules = vm.runInNewContext(`${src}; cwForecastRules`, {});
const at = (iso) => new Date(iso);

test('a local provider time is read in the offset the answer gives, not the device zone', () => {
  assert.equal(rules.parseProviderTime('2026-09-20T08:00', 7200), Date.parse('2026-09-20T06:00:00Z'));
  assert.equal(rules.parseProviderTime('2026-09-20T08:00:30', -3600), Date.parse('2026-09-20T09:00:30Z'));
  // A time that carries its own zone is never shifted again.
  assert.equal(rules.parseProviderTime('2026-09-20T08:00:00Z', 7200), Date.parse('2026-09-20T08:00:00Z'));
});

test('Open-Meteo steps read the hour of the route, wherever the phone is', () => {
  const inside = rules.extractStep(openMeteo(), { provider: 'openmeteo', time: at('2026-09-20T09:30:00Z') });
  assert.equal(inside.source, 'minutely_15');
  assert.equal(inside.temp, 114);          // 11:30 in Spain → quarter 14
  const outside = rules.extractStep(openMeteo(), { provider: 'aromehd', time: at('2026-09-20T14:10:00Z') });
  assert.equal(outside.source, 'hourly');
  assert.equal(outside.temp, 26);          // 16:10 in Spain → 16:00 → slot 16
});

test('without utc_offset_seconds the old reading in the device zone stays', () => {
  const w = openMeteo();
  delete w.utc_offset_seconds;
  const r = rules.extractStep(w, { provider: 'openmeteo', time: at('2026-09-20T09:30:00Z') });
  assert.equal(r.source, 'hourly');        // 05:30 in New York is outside 08:00–13:45
  assert.equal(r.temp, 15);                // tie between 05:00 and 06:00 → 05:00 → slot 5
});
