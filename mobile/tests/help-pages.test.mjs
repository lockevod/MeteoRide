/* The two help pages, against each other.
 *
 * They are one document written twice, and the failure mode is always the same: an
 * edit lands in one language and not the other. A review caught the English page
 * having quietly dropped content the Spanish one had, so the shapes are compared
 * here — same sections in the same order, and the same number of headings and
 * bullets inside them. Prose is not compared; a missing paragraph is.
 */
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'public');
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
    ['p', /<p\b/g],
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

/* What a reader actually sees: the tags, the script and the stylesheet do not count. */
const visibleWords = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

/* The help was 3300 words and unreadable on a phone; it was cut to about 1600 and the
 * long explanations moved to docs/GUIA.md and docs/GUIDE.md. Nothing stops it growing
 * back one paragraph at a time, so here is the ceiling. Room to breathe above 1600,
 * not room for another section: what does not fit belongs in the guide. */
const WORD_CEILING = 1800;

test('the help stays short enough to read on a phone', async () => {
  for (const name of ['help.html', 'help_en.html']) {
    const words = visibleWords(await read(name));
    assert.ok(
      words <= WORD_CEILING,
      `${name} is back to ${words} visible words (ceiling ${WORD_CEILING}); the detail goes in the guide`
    );
  }
});

/* The ceiling above checks each page on its own, so a paragraph dropped from only one
 * language passes it (the short page just has more room to spare). Word counts across
 * a translation are never identical, but a real drift is much bigger than phrasing. */
const LENGTH_DRIFT_MAX = 0.15;

test('the two languages stay within 15% of each other in length', async () => {
  const [es, en] = await pages();
  const esWords = visibleWords(es);
  const enWords = visibleWords(en);
  const drift = Math.abs(esWords - enWords) / Math.max(esWords, enWords);
  assert.ok(
    drift <= LENGTH_DRIFT_MAX,
    `es has ${esWords} visible words, en has ${enWords} (${(drift * 100).toFixed(1)}% apart); one language likely lost content`
  );
});

/* Both halves of that split: the help must hand the reader the guide, and the guide
 * must exist where the link says. A link to the repository is what a phone can open.
 * Five sections link out; counting the occurrences (not just checking one survived)
 * catches an edit that mangles four of the five and leaves one intact. */
test('each help page links to its guide from every section, and the guide is there', async () => {
  for (const [page, guide] of [['help.html', 'GUIA.md'], ['help_en.html', 'GUIDE.md']]) {
    const link = `https://github.com/lockevod/MeteoRide/blob/main/docs/${guide}`;
    const html = await read(page);
    const occurrences = html.split(link).length - 1;
    assert.equal(occurrences, 5, `${page} links to ${guide} ${occurrences} time(s), expected 5`);
    await access(join(ROOT, 'docs', guide));
  }
});
