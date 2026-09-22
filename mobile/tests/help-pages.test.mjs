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

/* The privacy policies: one per platform, because that is what each store's form links
 * to and a reviewer should not have to skip past the other two to reach the one that
 * applies. The cost of that split is drift — the same cost the two help pages pay, and
 * the reason this file exists — so the two app policies are compared the same way. */
const POLICIES = ['privacy-ios.html', 'privacy-android.html', 'privacy-web.html'];

test('the help links to a policy that exists, and the app swaps it per platform', async () => {
  for (const page of ['help.html', 'help_en.html']) {
    const html = await read(page);
    assert.match(
      html, /<a href="privacy-web\.html" id="privacyLink"/,
      `${page} no longer carries the switchable privacy link`
    );
  }
  for (const policy of POLICIES) await access(join(PUBLIC, policy));

  /* help.js rewrites that href inside the app. Without `?return=true` the page's own
   * back button stays hidden and a native reader is stranded on it. */
  const helpJs = await readFile(join(PUBLIC, 'scripts/help.js'), 'utf8');
  assert.match(helpJs, /privacy-\$\{platform\}\.html\?return=true/, 'the in-app policy link lost its platform or its return');
});

test('each policy states what MeteoRide does not collect and what the providers receive', async () => {
  for (const policy of POLICIES) {
    const html = await read(policy);
    for (const claim of [/no recopila tus datos/i, /does not collect your data/i]) {
      assert.match(html, claim, `${policy} no longer states that MeteoRide collects nothing`);
    }
    for (const provider of [/open-meteo/i, /openweather/i, /openstreetmap/i]) {
      assert.match(html, provider, `${policy} no longer names a provider that receives route data`);
    }
    // Open-Meteo's own number, not ours: when this fails, re-read their terms at
    // https://open-meteo.com/en/terms rather than just updating the test.
    for (const retention of [/90 d[ií]as/i, /90 days/i]) {
      assert.match(html, retention, `${policy} no longer says how long Open-Meteo keeps the logs`);
    }
    // Both stores want a way to reach someone. Two: the page carries both languages.
    assert.equal(html.split('mailto:').length - 1, 2, `${policy} lost its privacy contact in one language`);
  }
});

/* The split only helps if each document stays in its lane. An app policy that starts
 * describing the website is how a reviewer ends up crediting the website's CDNs to the
 * app — which is the whole reason these are separate files. */
test('the app policies claim nothing the website does, and the website policy owns it', async () => {
  const web = await read('privacy-web.html');
  for (const third of [/jsdelivr/i, /cdnjs/i, /unpkg/i, /buy me a coffee/i, /gpx_url/i, /cloudflare/i]) {
    assert.match(web, third, 'the website policy stopped disclosing what the website loads from third parties');
  }
  for (const policy of ['privacy-ios.html', 'privacy-android.html']) {
    const html = await read(policy);
    for (const websiteOnly of [/jsdelivr/i, /cdnjs/i, /unpkg/i, /buy me a coffee/i, /gpx_url/i]) {
      assert.doesNotMatch(html, websiteOnly, `${policy} describes website behaviour; a reviewer will credit it to the app`);
    }
    // Nor send the reader to the other policies: this one is the whole story for the app.
    assert.doesNotMatch(html, /<a href="privacy-(web|ios|android)\.html/, `${policy} points at another platform's policy`);
  }
});

/* The two app policies are one document written twice — about 90% shared — so they fail
 * the way the help pages do: an edit lands in one and not the other. Same shape check. */
test('the iOS and Android policies do not drift apart', async () => {
  const ios = await read('privacy-ios.html');
  const android = await read('privacy-android.html');

  assert.deepEqual(sectionClasses(ios), sectionClasses(android), 'the two app policies have different sections');
  for (const [what, re] of [['h2', /<h2\b/g], ['h3', /<h3\b/g], ['li', /<li\b/g], ['p', /<p\b/g], ['tr', /<tr>/g]]) {
    assert.equal(count(ios, re), count(android, re), `${what}: the two app policies have drifted apart`);
  }

  const iosWords = visibleWords(ios);
  const androidWords = visibleWords(android);
  const drift = Math.abs(iosWords - androidWords) / Math.max(iosWords, androidWords);
  assert.ok(drift <= 0.1, `iOS has ${iosWords} words, Android ${androidWords} (${(drift * 100).toFixed(1)}% apart)`);

  // And each one names its own platform where the other names the other.
  assert.match(ios, /UserDefaults/, 'the iOS policy stopped naming where iOS keeps the settings');
  assert.match(android, /SharedPreferences/, 'the Android policy stopped naming where Android keeps the settings');
  assert.doesNotMatch(ios, /SharedPreferences/, 'the iOS policy describes Android storage');
  assert.doesNotMatch(android, /UserDefaults/, 'the Android policy describes iOS storage');
});

/* Claims that were in an earlier draft and were false. Each one is cheap to reintroduce
 * by "simplifying" the wording, and each one is the kind a reviewer can check. */
test('the policies do not repeat the claims the code contradicted', async () => {
  for (const policy of POLICIES) {
    const html = await read(policy);
    // The ride watch downloads a fresh forecast in the background; it does not merely
    // read one already on the device. (mobile/runners/watch.js)
    if (/privacy-(ios|android)/.test(policy)) {
      assert.match(html, /descarga una previsi[óo]n nueva|downloads a fresh forecast/i,
        `${policy} stopped saying the background watch downloads a forecast`);
    }
    // Official warnings call OpenWeather whichever provider is selected. (app.js)
    assert.match(html, /sea cual sea el proveedor|whichever provider is selected/i,
      `${policy} stopped saying OpenWeather is called for warnings regardless of provider`);
    // Tiles are network-first; the cache is the fallback, not a way to avoid OSM.
    assert.match(html, /a la red primero|network is asked first/i,
      `${policy} stopped saying the map goes to the network first`);
  }
});

/* OpenStreetMap's tile policy forbids offline use of its tiles. The cache keeps a viewed
 * tile only until the server's expiry (tile-cache.js), so the help must not sell the
 * map as something that works without a connection. Both pages used to. */
test('neither page promises the map background without a connection', async () => {
  for (const [name, html] of [['help.html', await read('help.html')], ['help_en.html', await read('help_en.html')]]) {
    assert.doesNotMatch(html, /teselas[^<]*sin conexión|tiles[^<]*offline|y teselas siguen|and tiles are still|mapa[^<.]*(funciona|sirve)[^<.]*sin conexión|map[^<.]*works[^<.]*offline/i, `${name} promises offline map tiles`);
  }
});

/* Open-Meteo's data are CC BY 4.0: credit, a link to the licence and a note of what was
 * changed. The map carries the "Open-Meteo" link; the rest lives here, in both languages,
 * so the main screen does not give up height to a credit line. */
test('each help page credits the weather data with its licence', async () => {
  for (const name of ['help.html', 'help_en.html']) {
    const html = await read(name);
    for (const href of ['https://open-meteo.com/', 'https://creativecommons.org/licenses/by/4.0/', 'https://openweathermap.org/']) {
      assert.ok(html.includes(`href="${href}"`), `${name} does not link ${href}`);
    }
  }
});

/* App Review (21/09, guideline 1.5) rejected GitHub Issues as the Support URL: it needs
 * an account and is not a support page. support.html is the Support URL; the help and
 * the app policies reach it too, so no path leaves GitHub as the only way to ask. */
test('support has a direct contact, and the app never offers GitHub as the only way to ask', async () => {
  const support = await read('support.html');
  assert.equal(support.split('mailto:support@meteoride.cc').length - 1, 2, 'support.html lost its contact in one language');
  assert.match(support, /id="en"/);
  assert.match(support, /id="es"/);
  // It is the Support URL: no payment link (AGENTS.md) and nothing the CSP would block.
  assert.doesNotMatch(support, /<script|buymeacoffee|donat/i, 'support.html carries a script or a payment link');
  // It is the page the iOS reviewer opens: another platform named there is a 2.3.10 flag.
  assert.doesNotMatch(support, /android/i, 'the Support URL mentions another platform');
  for (const name of ['help.html', 'help_en.html']) {
    assert.match(await read(name), /mailto:support@meteoride\.cc/, `${name} lost the support contact`);
  }
  for (const name of ['privacy-ios.html', 'privacy-android.html']) {
    const html = await read(name);
    assert.doesNotMatch(html, /github\.com\/lockevod\/MeteoRide\/issues/i, `${name} still sends bugs to GitHub`);
    assert.equal(html.split('https://app.meteoride.cc/support.html').length - 1, 2, `${name} lost the support link in one language`);
  }
});
