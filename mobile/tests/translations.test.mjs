// `t()` returns the key itself when it is missing, so a typo or a forgotten entry
// reaches the user as a raw identifier like `no_route_for_export` instead of a
// sentence — which is exactly what shipped. Nothing else notices: no error, no
// failing assertion, and the English dictionary quietly covers for Spanish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public');

/** The two dictionaries in utils.js, by key. */
async function dictionaries() {
  const src = await readFile(join(PUBLIC, 'scripts/utils.js'), 'utf8');
  const es = src.indexOf('    es: {');
  const en = src.indexOf('    en: {');
  const end = src.indexOf('\n  };', en);
  assert.ok(es > 0 && en > es && end > en, 'the i18n block in utils.js no longer looks the way this test reads it');
  const keys = (text) => new Set([...text.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]));
  const strip = (set) => { set.delete('es'); set.delete('en'); return set; };
  return { es: strip(keys(src.slice(es, en))), en: strip(keys(src.slice(en, end))) };
}

/** Every key the app asks for: t('x') in the scripts, data-i18n in the pages. */
async function usedKeys() {
  const used = new Map();   // key -> where it came from
  const note = (key, where) => { if (!used.has(key)) used.set(key, where); };

  for (const file of await readdir(join(PUBLIC, 'scripts'))) {
    if (!file.endsWith('.js')) continue;
    const src = await readFile(join(PUBLIC, 'scripts', file), 'utf8');
    for (const [, key] of src.matchAll(/\bt\(\s*['"](\w+)['"]/g)) note(key, `scripts/${file}`);
  }
  for (const file of await readdir(PUBLIC)) {
    if (!file.endsWith('.html')) continue;
    const src = await readFile(join(PUBLIC, file), 'utf8');
    for (const [, key] of src.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) note(key, file);
  }
  return used;
}

test('the two dictionaries hold the same keys', async () => {
  const { es, en } = await dictionaries();
  assert.ok(es.size > 50, `only ${es.size} Spanish keys found; the parser is probably broken`);
  const onlyEs = [...es].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !es.has(k));
  assert.deepEqual(onlyEs, [], 'these exist only in Spanish');
  assert.deepEqual(onlyEn, [], 'these exist only in English, so Spanish readers get English');
});

test('every key the app asks for is translated', async () => {
  const { es, en } = await dictionaries();
  const used = await usedKeys();
  assert.ok(used.size > 40, `only ${used.size} keys found in use; the scan is probably broken`);
  const missing = [...used].filter(([k]) => !es.has(k) || !en.has(k));
  assert.deepEqual(
    missing.map(([k, where]) => `${k} (used in ${where})`),
    [],
    't() returns the key itself when it is missing, so these reach the user as raw identifiers'
  );
});
