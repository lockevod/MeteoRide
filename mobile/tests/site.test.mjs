// The product site (meteoride.cc): site/build.mjs turns one template and one strings file
// per language into site/dist/. These check what the build promises: escaped strings, the
// same keys everywhere, links in the page's language, and pages that ask no other origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, links, renderPage, build } from '../../site/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = join(ROOT, 'site');

async function strings() {
  const files = (await readdir(join(SITE, 'i18n'))).filter((f) => f.endsWith('.json'));
  return Object.fromEntries(await Promise.all(files.map(async (f) =>
    [f.slice(0, -5), JSON.parse(await readFile(join(SITE, 'i18n', f), 'utf8'))])));
}

test('the strings files have identical keys and no empty value', async () => {
  const all = await strings();
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
