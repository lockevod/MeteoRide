/* The two help pages, against each other.
 *
 * They are one document written twice, and the failure mode is always the same: an
 * edit lands in one language and not the other. A review caught the English page
 * having quietly dropped content the Spanish one had, so the shapes are compared
 * here — same sections in the same order, and the same number of headings and
 * bullets inside them. Prose is not compared; a missing paragraph is.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public');
const read = (name) => readFile(join(PUBLIC, name), 'utf8');

const count = (html, re) => (html.match(re) || []).length;
/** The class of every section, in page order: the table of contents, structurally. */
const sectionClasses = (html) =>
  [...html.matchAll(/<details class="([^"]*)"[^>]*>/g)].map((m) => m[1].trim());

const pages = async () => [await read('help.html'), await read('help_en.html')];

test('both pages carry the same sections in the same order', async () => {
  const [es, en] = await pages();
  assert.deepEqual(sectionClasses(es), sectionClasses(en));
  assert.ok(sectionClasses(es).length >= 10, 'the sections are no longer <details>');
});

test('neither page silently loses a heading or a bullet in one language', async () => {
  const [es, en] = await pages();
  for (const [what, re] of [
    ['h2', /<h2\b/g],
    ['h3', /<h3\b/g],
    ['li', /<li\b/g],
    ['summary', /<summary\b/g],
  ]) {
    assert.equal(count(es, re), count(en, re), `${what}: the two pages have drifted apart`);
  }
});

test('the website gets every section open; closing them is the app\'s doing', async () => {
  for (const html of await pages()) {
    const sections = [...html.matchAll(/<details class="section[^"]*"([^>]*)>/g)];
    assert.ok(sections.length > 0, 'no sections found');
    for (const [tag, attrs] of sections) {
      assert.ok(attrs.includes('open'), `a section is closed in the source: ${tag}`);
    }
  }
});

test('each page hides the install recipes in the app and the app notes on the web', async () => {
  for (const html of await pages()) {
    assert.equal(count(html, /class="section web-only"/g), 1);
    assert.equal(count(html, /class="section app-only"/g), 1);
  }
});

test('no page still mentions a provider that was removed', async () => {
  for (const html of await pages()) {
    assert.doesNotMatch(html, /meteoblue/i);
  }
});
