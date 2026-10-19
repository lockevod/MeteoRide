// The product site (meteoride.cc): site/build.mjs turns one template and one strings file
// per language into site/dist/. These check what the build promises: escaped strings, the
// same keys everywhere, links in the page's language, and pages that ask no other origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LANGS, links, renderPage, build } from '../../site/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = join(ROOT, 'site');

// CW_SITE_LANG=<code> limits the run to that language plus en, so a translator can work on
// one file while the others do not exist yet.
const ONLY = process.env.CW_SITE_LANG;
if (ONLY && !existsSync(join(SITE, 'i18n', `${ONLY}.json`))) throw new Error(`CW_SITE_LANG=${ONLY}: no site/i18n/${ONLY}.json`);
async function strings() {
  const files = (await readdir(join(SITE, 'i18n'))).filter((f) => f.endsWith('.json'))
    .filter((f) => !ONLY || f === 'en.json' || f === `${ONLY}.json`);
  return Object.fromEntries(await Promise.all(files.map(async (f) =>
    [f.slice(0, -5), JSON.parse(await readFile(join(SITE, 'i18n', f), 'utf8'))])));
}

test('the strings files have identical keys and no empty value', async () => {
  const all = await strings();
  if (!ONLY) assert.deepEqual(Object.keys(all).sort(), [...LANGS].sort(), 'every language in LANGS needs a site/i18n file');
  const keys = Object.keys(all.en).sort();
  assert.ok(keys.length > 50, 'en.json looks truncated');
  for (const [code, s] of Object.entries(all)) {
    assert.deepEqual(Object.keys(s).sort(), keys, `${code}.json keys differ from en.json`);
    for (const [k, v] of Object.entries(s)) assert.ok(typeof v === 'string' && v.trim() !== '', `${code}.${k} is empty`);
  }
  // A key the template never uses is copy nobody sees, translated nine times for nothing.
  const template = await readFile(join(SITE, 'template.html'), 'utf8');
  const used = new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  for (const k of ['lang', 'canonical', 'hreflang', 'languages']) used.delete(k);
  used.add('notif_event'); // read by build.mjs for the notification card
  assert.deepEqual([...used].sort(), keys, 'the template and en.json disagree on the keys');
});

test('titles and descriptions fit search results', async () => {
  for (const [code, s] of Object.entries(await strings())) {
    assert.ok([...s.meta_title].length <= 60, `${code}.meta_title is ${[...s.meta_title].length} code points, over 60`);
    assert.ok([...s.meta_description].length <= 160, `${code}.meta_description is ${[...s.meta_description].length} code points, over 160`);
  }
});

test('renderPage escapes text and refuses a missing key', () => {
  const out = renderPage('<p title="{{a}}">{{a}}</p>', { a: 'A & "B" <c>' }, 'en');
  assert.equal(out.split('A &amp; &quot;B&quot; &lt;c&gt;').length - 1, 2, out);
  assert.ok(!out.includes('<c>'), out);
  assert.throws(() => renderPage('{{b}}', {}, 'en'), /missing key: b/);
  assert.throws(() => renderPage('{{ b }}', {}, 'en'), /unfilled placeholder/);
});

test('links follow the page language', () => {
  assert.equal(links('fr').help, 'https://app.meteoride.cc/help_fr.html');
  assert.equal(links('es').help, 'https://app.meteoride.cc/help.html');
  assert.equal(links('en').privacy, 'https://app.meteoride.cc/privacy-web.html');
  assert.equal(links('es').privacy, 'https://app.meteoride.cc/privacy-web.html');
  assert.equal(links('de').privacy, 'https://app.meteoride.cc/privacy-web-de.html');
  assert.equal(links('en').appStore, 'https://apps.apple.com/us/app/meteoride/id6813109920');
  assert.ok(links('gl').appStore.includes('/es/app/'), links('gl').appStore);
  assert.ok(links('pt').guide.endsWith('docs/GUIDE_pt.md'), links('pt').guide);
  assert.ok(links('es').guide.endsWith('docs/GUIA.md'), links('es').guide);
  assert.ok(links('en').guide.endsWith('docs/GUIDE.md'), links('en').guide);
  assert.equal(links('it').exampleRoute, 'https://app.meteoride.cc/?gpx_url=https://app.meteoride.cc/assets/example-route.gpx');
});

// Built once; the two tests below read the same output.
const built = (async () => {
  const codes = Object.keys(await strings());
  await build({ only: codes });
  return Promise.all(codes.map(async (code) =>
    [code, await readFile(join(SITE, 'dist', code, 'index.html'), 'utf8')]));
})();

test('each built page is indexable and self-contained', async () => {
  for (const [code, html] of await built) {
    assert.ok(html.includes(`<html lang="${code}">`), `${code}: lang`);
    assert.ok(html.includes(`<link rel="canonical" href="https://meteoride.cc/${code}/">`), `${code}: canonical`);
    for (const l of LANGS) assert.ok(html.includes(`<link rel="alternate" hreflang="${l}" href="https://meteoride.cc/${l}/">`), `${code}: hreflang ${l}`);
    assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://meteoride.cc/en/">'), `${code}: x-default`);
    assert.match(html, /<title>[^<]+<\/title>/, `${code}: title`);
    assert.match(html, /<meta name="description" content="[^"]+">/, `${code}: description`);
    assert.ok(!html.includes('{{'), `${code}: leftover placeholder`);
    assert.doesNotMatch(html, /\ssrc="(https?:)?\/\//, `${code}: loads something from another origin`);
    assert.doesNotMatch(html, /<link[^>]*rel="(stylesheet|icon|preload|modulepreload)"[^>]*href="(https?:)?\/\//, `${code}: a stylesheet or icon from another origin`);
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(imgs.length >= 8, `${code}: only ${imgs.length} images`);
    for (const img of imgs) {
      assert.match(img, /\salt="[^"\s][^"]*"/, `${code}: ${img} has no alt`);
      const src = img.match(/\ssrc="\/([^"]+)"/);
      assert.ok(src, `${code}: ${img} has no local src`);
      await access(join(SITE, src[1]));
    }
  }
});

test('every link target exists', async () => {
  for (const [code, html] of await built) {
    const l = links(code);
    for (const k of ['help', 'privacy', 'guide', 'appStore', 'apk', 'installSteps', 'webApp', 'exampleRoute']) {
      assert.ok(html.includes(`href="${l[k]}"`), `${code}: no link to ${k}`);
    }
    await access(join(ROOT, 'public', new URL(l.help).pathname));
    await access(join(ROOT, 'public', new URL(l.privacy).pathname));
    await access(join(ROOT, 'docs', l.guide.split('/docs/')[1]));
  }
});

// Honest out-of-signal copy says the map "needs a connection" and keeps words like
// "offline"/"sin conexión" out of the 60-character window of a map word.
// The app has no offline map, no coordinates-only mode and no price to quote: the pages
// must not promise any of them, in any of the nine languages.
test('no page claims what the app does not do', async () => {
  const mapWord = 'map|mapa|carte|Karte|mappa';
  const offline = 'hors ligne|hors-ligne|off-?line|sans connexion|sans réseau|ohne (Netz|Internet|Verbindung|Empfang)|senza (rete|internet|connessione)|sem (ligação|internet|conexão|rede|cobertura)|sense (xarxa|internet|connexió|cobertura)|sen (internet|conexión|cobertura)|sin (internet|red|conexión|cobertura)|lineaz kanpo|internetik gabe|konexiorik gabe';
  const forbidden = [
    /teselas[^<]*sin conexión|tiles[^<]*offline|y teselas siguen|and tiles are still|mapa[^<.]*(funciona|sirve)[^<.]*sin conexión|map[^<.]*works[^<.]*offline/i,
    new RegExp(`(${mapWord})[^.]{0,60}(${offline})|(${offline})[^.]{0,60}(${mapWord})`, 'i'),
    /only (the )?coordinates|solo las coordenadas|seules les coordonnées|nur die Koordinaten|solo le coordinate|só as coordenadas/i,
    /what it costs|lo que cuesta|pricing|precio|subscri|suscrip|\bpreus?\b|\bprezos?\b|prezio|kostu|harpidetz|\bprix\b|tarif|abonnement|\bpreis|kosten|\babo\b|prezzo|abbonament|\bpreço|assinatura/i,
  ];
  for (const [code, html] of await built) {
    const bare = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ');
    // Visible text, then the markup too: meta descriptions, alt and aria-label values.
    const text = bare.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') + ' ' + bare;
    assert.ok(text.length > 500, `${code}: no visible text`);
    for (const re of forbidden) assert.doesNotMatch(text, re, `${code}: claims what the app does not do`);
  }
});

// Width and height from a JPEG's start-of-frame segment; throws if it is not a JPEG.
function jpegSize(b) {
  assert.ok(b[0] === 0xff && b[1] === 0xd8, 'not a JPEG');
  for (let i = 2; i + 9 < b.length; i += 2 + b.readUInt16BE(i + 2)) {
    assert.equal(b[i], 0xff, 'broken JPEG segment');
    if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
  }
  throw new Error('no JPEG frame');
}

// site/shots.mjs writes <code>-<scene>-<device>.jpg from the real app in each language; a page
// showing another language's app (or a placeholder) would contradict the copy around it.
test("every page shows its own language's screenshots", async () => {
  for (const [code, html] of await built) {
    const shown = [...html.matchAll(/img\/shots\/([a-z]+)-([a-z]+)-([a-z]+)\.jpg/g)];
    for (const [ref, lang] of shown) assert.equal(lang, code, `${code}: shows ${ref}`);
    const names = new Set(shown.map((m) => `${m[2]}-${m[3]}`));
    for (const scene of ['table', 'map', 'compare', 'warning']) {
      for (const device of ['phone', 'desktop']) {
        assert.ok(names.has(`${scene}-${device}`), `${code}: no ${scene}-${device} shot`);
        const name = `${code}-${scene}-${device}.jpg`;
        const jpg = await readFile(join(SITE, 'img/shots', name));
        assert.ok(jpg.length <= 300 * 1024, `${name} is ${jpg.length} bytes, over 300 KB`);
        assert.deepEqual(jpegSize(jpg), device === 'phone' ? [780, 1688] : [1440, 900], `${name}: size`);
      }
    }
    assert.ok(html.includes(`<meta property="og:image" content="https://meteoride.cc/img/shots/${code}-table-desktop.jpg">`), `${code}: og:image`);
    assert.ok(!html.includes('placeholder.svg'), `${code}: a placeholder is still shown`);
  }
  // The same shot in two languages must be two pictures: the app really was in each language.
  if (!ONLY) {
    const [es, de] = await Promise.all(['es', 'de'].map((c) => readFile(join(SITE, 'img/shots', `${c}-table-phone.jpg`))));
    assert.ok(!es.equals(de), 'es-table-phone.jpg and de-table-phone.jpg are the same picture');
  }
});
