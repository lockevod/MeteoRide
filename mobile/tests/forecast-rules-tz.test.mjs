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

// A real Open-Meteo answer (historical-forecast API, fetched 2026-09-15, trimmed) across the
// Madrid change of 2025-10-26, when 03:00 CEST became 02:00 CET. Open-Meteo does not label local
// time: every label is the UTC instant plus the one utc_offset_seconds of the answer, the offset in
// force when it was requested (+2 here), so the labels run on without a repeated or missing hour.
// `unixtime` is the same request with timeformat=unixtime: the instant of each entry. Reading the
// labels with the answer's offset must land on the entry of that instant on both sides of the
// change; reading them in the real local offset of their date, or as UTC, must not.
const dst = JSON.parse(await readFile(join(HERE, 'fixtures/open-meteo-madrid-dst.json'), 'utf8'));

test('across a daylight-saving change each step reads the entry of its own UTC instant', () => {
  const { answer, unixtime } = dst;
  const entry = (series, iso) => {
    const i = unixtime[series].findIndex((s) => s * 1000 === Date.parse(iso));
    assert.notEqual(i, -1, `${iso} is not in the fixture's ${series}`);
    return i;
  };
  const value = (series, name, iso) => answer[series][name][entry(series, iso)];
  const read = (iso) => rules.extractStep(answer, { provider: 'openmeteo', time: at(iso) });

  // 01:10 CEST, before the change and before the quarters: the hourly entry of 23:00Z (15.4 °C)
  // and the rain of (23:00Z, 00:00Z], the entry of 00:00Z.
  const before = read('2025-10-25T23:10:00Z');
  assert.equal(before.source, 'hourly');
  assert.equal(before.temp, value('hourly', 'temperature_2m', '2025-10-25T23:00:00Z'));
  assert.equal(before.precipitation, value('hourly', 'precipitation', '2025-10-26T00:00:00Z'));

  // 02:45 local twice: CEST at 00:45Z, CET at 01:45Z. Each reads its own quarter (14.4 and 13.7 °C)
  // and the sum of the four quarters of its own UTC hour.
  const quarterRain = (hourIso) => [1, 2, 3, 4].reduce((sum, q) =>
    sum + answer.minutely_15.precipitation[entry('minutely_15', new Date(Date.parse(hourIso) + q * 900000).toISOString())], 0);
  for (const [iso, hour] of [['2025-10-26T00:45:00Z', '2025-10-26T00:00:00Z'], ['2025-10-26T01:45:00Z', '2025-10-26T01:00:00Z']]) {
    const r = read(iso);
    assert.equal(r.source, 'minutely_15', iso);
    assert.equal(r.temp, value('minutely_15', 'temperature_2m', iso), iso);
    assert.equal(r.precipitation, quarterRain(hour), iso);
  }
  assert.notEqual(read('2025-10-26T00:45:00Z').temp, read('2025-10-26T01:45:00Z').temp);

  // 04:10 CET, after the change and past the quarters: the hourly entry of 03:00Z (12.3 °C) and the
  // rain of (03:00Z, 04:00Z], the entry of 04:00Z (1.3 mm).
  const after = read('2025-10-26T03:10:00Z');
  assert.equal(after.source, 'hourly');
  assert.equal(after.temp, value('hourly', 'temperature_2m', '2025-10-26T03:00:00Z'));
  assert.equal(after.precipitation, value('hourly', 'precipitation', '2025-10-26T04:00:00Z'));
  assert.equal(after.precipitation, 1.3);
});

test('without utc_offset_seconds the old reading in the device zone stays', () => {
  const w = openMeteo();
  delete w.utc_offset_seconds;
  const r = rules.extractStep(w, { provider: 'openmeteo', time: at('2026-09-20T09:30:00Z') });
  assert.equal(r.source, 'hourly');        // 05:30 in New York is outside 08:00–13:45
  assert.equal(r.temp, 15);                // tie between 05:00 and 06:00 → 05:00 → slot 5
});
