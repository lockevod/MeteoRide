/* The seven languages added after Spanish and English: Catalan, Galician, Basque, French,
 * German, Italian and Portuguese.
 *
 * Each one is a set of files written by translating the English ones, and each fails the
 * way the two help pages fail against each other: something lands in English and not in
 * the translation, a placeholder gets translated, a link gets lost. So every translated
 * file is held to the shape of its English source, not to its wording.
 *
 * CW_LANG=fr limits the run to one language.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'public');
const read = (name) => readFile(join(PUBLIC, name), 'utf8');

/** The landing page of each language, the way its readers would search for it. */
export const LANDING = {
  ca: 'ca/temps-a-la-teva-ruta',
  gl: 'gl/tempo-na-tua-ruta',
  eu: 'eu/eguraldia-zure-ibilbidean',
  fr: 'fr/meteo-sur-votre-parcours',
  de: 'de/wetter-auf-deiner-route',
  it: 'it/meteo-sul-tuo-percorso',
  pt: 'pt/tempo-no-seu-percurso',
};
const ALL = Object.keys(LANDING);
const LANGS = process.env.CW_LANG ? [process.env.CW_LANG] : ALL;

const count = (html, re) => (html.match(re) || []).length;
const sectionClasses = (html) => [...html.matchAll(/<details class="([^"]*)"[^>]*>/g)].map((m) => m[1].trim());
const visibleWords = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  .split(/\s+/).filter(Boolean).length;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...String(s).matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()).sort();
const STRUCTURE = [['h2', /<h2\b/g], ['h3', /<h3\b/g], ['li', /<li\b/g], ['p', /<p\b/g], ['summary', /<summary\b/g], ['tr', /<tr>/g]];

async function englishDictionary() {
  const src = await read('scripts/utils.js');
  const ctx = { window: {}, document: {}, navigator: {}, localStorage: {}, console };
  // Only the dictionary literal: the rest of utils.js needs a page.
  const start = src.indexOf('const i18n = {');
  const end = src.indexOf('\n  };', start) + 4;
  return vm.runInNewContext(`(${src.slice(start + 'const i18n = '.length, end)})`, ctx).en;
}

async function dictionary(code) {
  const ctx = { window: {} };
  vm.runInNewContext(await read(`scripts/lang-${code}.js`), ctx);
  return ctx.window.cwLang && ctx.window.cwLang[code];
}

for (const code of LANGS) {
  test(`${code}: the dictionary has exactly the English keys, placeholders and markup`, async () => {
    const en = await englishDictionary();
    const dict = await dictionary(code);
    assert.ok(dict, `scripts/lang-${code}.js does not define window.cwLang.${code}`);
    assert.deepEqual(Object.keys(dict).filter((k) => !(k in en)), [], 'keys English does not have');
    assert.deepEqual(Object.keys(en).filter((k) => !(k in dict)), [], 'keys missing, shown in English');
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${k} is not a string`);
      assert.ok(v.trim() || !en[k].trim(), `${k} is empty`);
      assert.deepEqual(placeholders(v), placeholders(en[k]), `${k}: a {placeholder} was translated or lost`);
      assert.deepEqual(tags(v), tags(en[k]), `${k}: the HTML inside it differs from English`);
    }
  });

  test(`${code}: the help page has the English page's shape and links`, async () => {
    const en = await read('help_en.html');
    const html = await read(`help_${code}.html`);
    assert.match(html, new RegExp(`<html lang="${code}"`));
    assert.deepEqual(sectionClasses(html), sectionClasses(en), 'sections differ from help_en.html');
    for (const [what, re] of STRUCTURE) assert.equal(count(html, re), count(en, re), `${what}: drifted from help_en.html`);
    for (const [tag, attrs] of html.matchAll(/<details class="section[^"]*"([^>]*)>/g)) assert.ok(attrs.includes('open'), `closed: ${tag}`);
    assert.equal(html.split('https://github.com/lockevod/MeteoRide/blob/main/docs/GUIDE.md').length - 1, 5, 'the guide links');
    assert.match(html, new RegExp(`<a href="privacy-web-${code}\\.html" id="privacyLink"`), 'the switchable privacy link');
    for (const href of ['https://open-meteo.com/', 'https://creativecommons.org/licenses/by/4.0/', 'https://openweathermap.org/']) {
      assert.ok(html.includes(`href="${href}"`), `does not link ${href}`);
    }
    assert.match(html, /mailto:support@meteoride\.cc/);
    assert.match(html, /openweathermap\.org\/api/);
    assert.match(html, /<script src="\/scripts\/help\.js"><\/script>/);
    assert.match(html, /data-page="help"/);
    assert.doesNotMatch(html, /meteoblue/i);
    // help.js hides these by platform; one lost in translation shows Android to an iPhone.
    const markers = (h) => [...h.matchAll(/class="([^"]*-only[^"]*)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(markers(html), markers(en), 'the web-only / app-only / platform-only markers differ');
    // Translations run longer than English, German most of all; a lost section is far bigger.
    const drift = (visibleWords(html) - visibleWords(en)) / visibleWords(en);
    assert.ok(drift > -0.15 && drift < 0.3, `${visibleWords(html)} words against English ${visibleWords(en)}`);
  });

  for (const platform of ['ios', 'android', 'web']) {
    test(`${code}: the ${platform} privacy policy is the English half, translated`, async () => {
      const source = await read(`privacy-${platform}.html`);
      const enHalf = source.slice(source.indexOf('id="en"'));
      const html = await read(`privacy-${platform}-${code}.html`);
      assert.match(html, new RegExp(`<html lang="${code}"`));
      const sections = [...html.matchAll(/<details class="section"[^>]*\bid="(\w+)"/g)].map((m) => m[1]);
      assert.deepEqual(sections, [code], 'one section, in its language');
      for (const [what, re] of [['h3', /<h3\b/g], ['li', /<li\b/g], ['tr', /<tr>/g]]) {
        assert.equal(count(html, re), count(enHalf, re), `${what}: drifted from the English half`);
      }
      assert.equal(html.split('mailto:privacy@meteoride.cc').length - 1, 1, 'the privacy contact');
      for (const p of [/open-meteo/i, /openweather/i, /openstreetmap/i, /\b90\b/]) assert.match(html, p);
      assert.match(html, /<script src="\/scripts\/help\.js"><\/script>/);
      const markers = (h) => [...h.matchAll(/class="([^"]*-only[^"]*)"/g)].map((m) => m[1]).sort();
      assert.deepEqual(markers(html), markers(enHalf), 'the platform-only markers differ from the English half');
      if (platform === 'web') {
        for (const third of [/jsdelivr/i, /cdnjs/i, /unpkg/i, /buy me a coffee/i, /gpx_url/i, /cloudflare/i]) assert.match(html, third);
      } else {
        assert.match(html, platform === 'ios' ? /UserDefaults/ : /SharedPreferences/);
        assert.doesNotMatch(html, platform === 'ios' ? /SharedPreferences/ : /UserDefaults/);
        for (const websiteOnly of [/jsdelivr/i, /cdnjs/i, /unpkg/i, /buy me a coffee/i, /gpx_url/i]) assert.doesNotMatch(html, websiteOnly);
        assert.doesNotMatch(html, /<a href="privacy-/, 'an app policy points at another policy');
        assert.doesNotMatch(html, /github\.com\/lockevod\/MeteoRide\/issues/i);
        assert.equal(html.split(`https://app.meteoride.cc/support.html`).length - 1, 1, 'the support link');
      }
    });
  }

  test(`${code}: the landing page, the iOS purpose strings`, async () => {
    const html = await read(`${LANDING[code]}/index.html`);
    assert.match(html, new RegExp(`<html lang="${code}"`));
    assert.ok(html.includes(`<link rel="canonical" href="https://app.meteoride.cc/${LANDING[code]}">`), 'canonical');
    for (const [c, slug] of [['en', 'en/route-weather'], ['es', 'es/tiempo-en-tu-ruta'], ...Object.entries(LANDING)]) {
      assert.ok(html.includes(`hreflang="${c}" href="https://app.meteoride.cc/${slug}"`), `hreflang ${c}`);
    }
    const strings = await readFile(join(ROOT, `mobile/native/ios/${code}.lproj/InfoPlist.strings`), 'utf8');
    for (const key of ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']) {
      assert.match(strings, new RegExp(`^"${key}" = ".+";$`, 'm'), key);
    }
  });
}

// What only lands once the seven are merged into the shared files.
test('merge: every language is offered, loaded, notified and supported', async () => {
  const index = await read('index.html');
  const rules = vm.runInNewContext(`${await read('scripts/watch-rules.js')}; cwWatchRules`, {});
  const support = await read('support.html');
  for (const code of ALL) {
    assert.ok(index.includes(`<option value="${code}">`), `index.html does not offer ${code}`);
    assert.ok(index.includes(`<script src="/scripts/lang-${code}.js"></script>`), `index.html does not load ${code}`);
    assert.ok(index.indexOf(`lang-${code}.js`) < index.indexOf('/scripts/utils.js'), `lang-${code}.js loads after utils.js`);
    assert.ok(support.includes(`<section id="${code}" lang="${code}">`), `support.html has no ${code} section`);
    await access(join(PUBLIC, `help_${code}.html`));
    // Every kind and level of change plus a warning, so a missing or misshapen entry shows up
    // as "undefined", a thrown error (the runner would send nothing) or English.
    const changes = [1, 2].flatMap((to) => ['rain', 'wind'].map((kind) => ({ kind, i: 0, from: 0, to, value: 30 })));
    for (const c of changes) {
      const out = rules.compose([c], [{ event: 'X', sender: 'Y' }], { lang: code, name: 'R', points: [{ label: '10:00', km: 5 }] });
      assert.ok(out.title.startsWith('⚠️ '), `${code}: the warning title is ${out.title}`);
      assert.doesNotMatch(out.title + out.body, /undefined|Official warning|Strong wind|Heavy rain/, `${code}: ${out.body}`);
      assert.match(out.body, /10:00/, `${code}: the time is lost`);
    }
    const plain = rules.compose([changes[0]], [], { lang: code, name: 'R', points: [{ label: '10:00', km: 5 }] });
    assert.doesNotMatch(plain.title, /undefined|changed/, `${code}: ${plain.title}`);
  }
  assert.equal(support.split('mailto:support@meteoride.cc').length - 1, 2 + ALL.length, 'one contact per language');
  const plist = await readFile(join(ROOT, 'mobile/native/ios/Info.plist.additions.xml'), 'utf8');
  for (const code of ALL) assert.ok(plist.includes(`<string>${code}</string>`), `CFBundleLocalizations lacks ${code}`);
});
