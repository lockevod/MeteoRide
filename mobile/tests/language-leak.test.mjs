/* One language leaking into the other.
 *
 * `validateDateRange` interpolates a field name into a sentence that is itself translated,
 * and its callers passed Spanish literals: an English device read "The fecha de salida
 * cannot be later than 14 days from today." Three taps away — set a date more than two
 * weeks out — and exactly the kind of thing an App Store reviewer is paid to find. It had
 * been there for months, because no test looked at what goes INTO a template, only at the
 * templates themselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = join(dirname(fileURLToPath(import.meta.url)), '../www/scripts');

/** Words that are unambiguously Spanish and would be glaring inside English copy. */
const SPANISH = /\b(fecha|ruta|hora|velocidad|cargando|subiendo|guardando|error de|no puede|ninguna?|desde|hasta|días?)\b/i;

test('nothing passes a Spanish literal into a translated template', async () => {
  const leaks = [];
  for (const name of await readdir(WWW)) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(join(WWW, name), 'utf8');
    // Every literal handed to t() as an interpolation value, or as a field argument to a
    // validator that will translate around it.
    for (const [, literal] of src.matchAll(/\b(?:validateDateRange|validateField)\s*\([^,)]+,\s*['"]([^'"]+)['"]/g)) {
      if (SPANISH.test(literal)) leaks.push(`${name}: validator field "${literal}"`);
    }
    for (const [, literal] of src.matchAll(/\bt\([^)]*\{\s*\w+:\s*['"]([^'"]+)['"]/g)) {
      if (SPANISH.test(literal)) leaks.push(`${name}: t() interpolation "${literal}"`);
    }
  }
  assert.deepEqual(leaks, [],
    'a Spanish literal is interpolated into a sentence that gets translated, so an ' +
    'English device shows half a sentence in Spanish; pass a translation key instead');
});

test('both dictionaries define the field names the validators ask for', async () => {
  const utils = await readFile(join(WWW, 'utils.js'), 'utf8');
  const asked = new Set();
  for (const name of await readdir(WWW)) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(join(WWW, name), 'utf8');
    for (const [, key] of src.matchAll(/validateDateRange\s*\([^,)]+,\s*['"](field_[a-z_]+)['"]/g)) asked.add(key);
  }
  assert.ok(asked.size > 0, 'no validator field keys found: the pattern has drifted');
  // Each key has to exist twice over — once per dictionary — or one language falls back
  // to printing the raw key at the user.
  for (const key of asked) {
    const defined = [...utils.matchAll(new RegExp(`\\b${key}\\s*:`, 'g'))].length;
    assert.equal(defined, 2, `${key} is defined ${defined} time(s); both es and en need it`);
  }
});
