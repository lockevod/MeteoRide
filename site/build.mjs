// Builds the product site (meteoride.cc) into site/dist/: one page per language from
// template.html and i18n/<code>.json, plus the language chooser at /. Every string is
// HTML-escaped — strings are data, never markup — and a missing key or a placeholder left
// unfilled stops the build. Run: node site/build.mjs
import { readFileSync, existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const DIST = join(SITE_DIR, 'dist');
const ORIGIN = 'https://meteoride.cc';
const APP = 'https://app.meteoride.cc';
const REPO = 'https://github.com/lockevod/MeteoRide';

export const LANGS = ['es', 'en', 'ca', 'gl', 'eu', 'fr', 'de', 'it', 'pt'];
const NAMES = { es: 'Español', en: 'English', ca: 'Català', gl: 'Galego', eu: 'Euskara', fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português' };
// The App Store has no country-less URL (it 404s); site.js swaps in the browser's region.
const STORE_CC = { es: 'es', en: 'us', ca: 'es', gl: 'es', eu: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt' };
// The notification card shows the app's own wording, composed by the app's own code.
const RULES = vm.runInNewContext(`${readFileSync(join(SITE_DIR, '../public/scripts/watch-rules.js'), 'utf8')}; cwWatchRules`, {});
const EXAMPLE_ROUTE = 'Mont-roig – Castillo';

export function links(code) {
  return {
    help: `${APP}/${code === 'es' ? 'help.html' : `help_${code}.html`}`,
    privacy: `${APP}/${code === 'es' || code === 'en' ? 'privacy-web.html' : `privacy-web-${code}.html`}`,
    appStore: `https://apps.apple.com/${STORE_CC[code]}/app/meteoride/id6813109920`,
    apk: `${REPO}/releases/latest/download/MeteoRide-android.apk`,
    installSteps: `${REPO}/releases/latest`,
    webApp: `${APP}/`,
    guide: `${REPO}/blob/main/docs/${code === 'es' ? 'GUIA.md' : code === 'en' ? 'GUIDE.md' : `GUIDE_${code}.md`}`,
    exampleRoute: `${APP}/?gpx_url=${APP}/assets/example-route.gpx`,
    support: `${APP}/support.html#${code}`,
    github: REPO,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const hreflang = () => [...LANGS.map((l) => [l, l]), ['x-default', 'en']]
  .map(([h, l]) => `<link rel="alternate" hreflang="${h}" href="${ORIGIN}/${l}/">`).join('\n  ');

const languages = (code) => LANGS
  .map((l) => `<li><a href="/${l}/" hreflang="${l}" lang="${l}"${l === code ? ' aria-current="page"' : ''}>${NAMES[l]}</a></li>`).join('');

export function renderPage(template, strings, code) {
  const notif = () => RULES.compose([], [{ event: strings.notif_event }], { lang: code, name: EXAMPLE_ROUTE, points: [] });
  const raw = { hreflang, languages: () => languages(code) };
  const text = {
    lang: () => code,
    canonical: () => `${ORIGIN}/${code}/`,
    'notif.title': () => notif().title,
    'notif.body': () => notif().body,
  };
  const out = template.replace(/\{\{([\w.]+)\}\}/g, (_, k) => {
    if (raw[k]) return raw[k]();
    if (text[k]) return esc(text[k]());
    const v = k.startsWith('link.') ? links(code)[k.slice(5)] : strings[k];
    if (v == null) throw new Error(`missing key: ${k}`);
    return esc(v);
  });
  const left = out.match(/\{\{(.*?)\}\}/);
  if (left) throw new Error(`unfilled placeholder: ${left[1]}`);
  return out;
}

// Without site.js this is a plain list of the nine pages; with it, site.js picks one.
function chooser() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeteoRide</title>
  ${hreflang()}
  <link rel="stylesheet" href="/styles.css">
  <script src="/site.js" defer></script>
</head>
<body class="chooser">
  <main>
    <h1>MeteoRide</h1>
    <ul class="lang-list">${languages(null)}</ul>
  </main>
</body>
</html>
`;
}

export async function build({ only, out = DIST } = {}) {
  const present = (await readdir(join(SITE_DIR, 'i18n'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const codes = only || present;
  const template = await readFile(join(SITE_DIR, 'template.html'), 'utf8');
  await rm(out, { recursive: true, force: true });
  const written = [];
  for (const code of codes) {
    if (!LANGS.includes(code)) throw new Error(`unknown language: ${code}`);
    const strings = JSON.parse(await readFile(join(SITE_DIR, 'i18n', `${code}.json`), 'utf8'));
    const file = join(out, code, 'index.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderPage(template, strings, code));
    written.push(file);
  }
  await writeFile(join(out, 'index.html'), chooser());
  written.push(join(out, 'index.html'));
  for (const f of ['styles.css', 'site.js', 'img']) {
    if (existsSync(join(SITE_DIR, f))) await cp(join(SITE_DIR, f), join(out, f), { recursive: true });
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().then((w) => console.log(`site: ${w.length} pages`), (e) => { console.error(e.message); process.exit(1); });
}
