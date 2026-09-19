#!/usr/bin/env node
/**
 * Builds mobile/www from the web app in public/.
 *
 * The website loads Leaflet, SunCalc, pako, togeojson and the weather-icons font
 * from public CDNs. A native app must not: App Store review objects to executable
 * code fetched at runtime, and the app would be dead weight without connectivity.
 *
 * So this script copies public/ to www/, drops a local copy of every CDN library
 * (pinned in package.json, taken from node_modules) into www/vendor/, and rewrites
 * index.html to point at those copies.
 */
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, '..');
const REPO = resolve(MOBILE, '..');
const SRC = join(REPO, 'public');
const OUT = join(MOBILE, 'www');
const MODULES = join(MOBILE, 'node_modules');

/**
 * Each entry replaces one CDN reference in public/index.html.
 *   url    remote URL as written in the HTML
 *   from   path inside node_modules
 *   to     path inside www/ (relative layout matters: the stylesheets reach their
 *          fonts and marker images through ../font/ and ../images/)
 *   also   extra files/folders the asset needs at runtime
 */
const VENDOR = [
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/weather-icons/2.0.12/css/weather-icons.min.css',
    from: 'weathericons/css/weather-icons.min.css',
    to: 'vendor/weathericons/css/weather-icons.min.css',
    also: [['weathericons/font', 'vendor/weathericons/font']],
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/weather-icons/2.0.12/css/weather-icons-wind.min.css',
    from: 'weathericons/css/weather-icons-wind.min.css',
    to: 'vendor/weathericons/css/weather-icons-wind.min.css',
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    from: 'leaflet/dist/leaflet.css',
    to: 'vendor/leaflet/leaflet.css',
    also: [['leaflet/dist/images', 'vendor/leaflet/images']],
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/leaflet-compass@1.5.6/dist/leaflet-compass.min.css',
    from: 'leaflet-compass/dist/leaflet-compass.min.css',
    to: 'vendor/leaflet-compass/dist/leaflet-compass.min.css',
    also: [['leaflet-compass/images', 'vendor/leaflet-compass/images']],
  },
  {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    from: 'leaflet/dist/leaflet.js',
    to: 'vendor/leaflet/leaflet.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet-gpx/2.1.2/gpx.min.js',
    from: 'leaflet-gpx/gpx.js',
    to: 'vendor/leaflet-gpx/gpx.js',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/leaflet-compass@1.5.6/dist/leaflet-compass.min.js',
    from: 'leaflet-compass/dist/leaflet-compass.min.js',
    to: 'vendor/leaflet-compass/dist/leaflet-compass.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js',
    from: 'suncalc/suncalc.js',
    to: 'vendor/suncalc/suncalc.js',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
    from: 'pako/dist/pako.min.js',
    to: 'vendor/pako/pako.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/togeojson/0.16.0/togeojson.min.js',
    from: 'togeojson/togeojson.js',
    to: 'vendor/togeojson/togeojson.js',
  },
];

/** Paths that only make sense on the public website. The two localised landing pages
 *  exist for search engines and are only reachable through the alternate link tags
 *  that patchIndexHtml strips, so nothing in the app can navigate to them. */
const WEB_ONLY = ['sitemap.xml', 'robots.txt', '_headers', 'en', 'es'];

/* `cp` copies public/ wholesale, so anything a local tool leaves in there ends up inside
 * the shipped app. That is not hypothetical: two code-analysis databases
 * (`scripts/.neuralmind/synapses.db`, `scripts/graphify-out/**`) were riding into the IPA
 * and to every user, ~160 KB of them, until an App Store review pass noticed. They are
 * untracked, so `git status` never showed them either. Filter by shape rather than by
 * name: a dot-directory in public/ is never part of the website, and a build output
 * directory belongs to whatever produced it. */
const isBuildDebris = (name) => name.startsWith('.') || name === 'graphify-out' || name === 'node_modules';

/** The background runner: the shared rules first, then the wiring. See the header of
 *  mobile/runners/watch.js for why it is one file and not a module. */
const RUNNER = {
  parts: [join(SRC, 'scripts', 'watch-rules.js'), join(MOBILE, 'runners', 'watch.js')],
  to: 'runners/watch.js',
};

const log = (...a) => console.log('[build-www]', ...a);

/**
 * public/scripts/version.js is committed, not just built: the website serves public/
 * directly and never runs this script. Regenerating it here from package.json on every
 * build keeps that committed copy from drifting — run `npm run build` after bumping the
 * version and the file updates itself.
 */
async function writeVersionFile() {
  const { version } = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  const dest = join(SRC, 'scripts', 'version.js');
  const banner = '// Generated by mobile/scripts/build-www.mjs from mobile/package.json\'s "version". Committed\n' +
    '// because the website serves public/ directly, without ever running that build. Do not edit\n' +
    '// by hand — the next `npm run build` in mobile/ overwrites it.\n';
  await writeFile(dest, `${banner}window.CW_VERSION = "${version}";\n`);
  log(`wrote scripts/version.js (${version})`);
}

/* Capacitor generates `App.xcodeproj` and hardcodes that name, but the project CAN be
 * renamed in Xcode, and this one was for a while. A hardcoded path here then matched
 * nothing and the version sync below silently became a no-op that nobody would notice
 * until a build shipped with the wrong MARKETING_VERSION. Found by review, not by a
 * failure. The project has been renamed back — Capacitor stops writing Package.swift
 * otherwise — so this lookup is belt and braces, and the belt is docs/IOS.md saying
 * not to rename it. */
function findIosPbxproj() {
  const app = join(MOBILE, 'ios/App');
  if (!existsSync(app)) return null;
  const project = readdirSync(app).find((d) => d.endsWith('.xcodeproj'));
  return project ? join(app, project, 'project.pbxproj') : null;
}

/**
 * mobile/ios/ is fully gitignored — Capacitor regenerates it with `cap add ios` and
 * rewrites it on every `cap sync` — so MARKETING_VERSION cannot be kept aligned with
 * package.json by hand the way version.js is (there is nothing to commit that edit
 * to). Derived here instead, the same way version.js is, on every build. A no-op
 * before `cap add ios` has ever run, and idempotent once it has.
 */
async function writeIosMarketingVersion() {
  const IOS_PBXPROJ = findIosPbxproj();
  if (!IOS_PBXPROJ || !existsSync(IOS_PBXPROJ)) return;
  const { version } = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  const src = await readFile(IOS_PBXPROJ, 'utf8');
  const out = src.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  if (out !== src) {
    await writeFile(IOS_PBXPROJ, out);
    log(`aligned MARKETING_VERSION in project.pbxproj (${version})`);
  }
}

async function copyVendor() {
  if (!existsSync(MODULES)) {
    throw new Error('node_modules is missing — run `npm install` inside mobile/ first');
  }
  for (const entry of VENDOR) {
    for (const [from, to] of [[entry.from, entry.to], ...(entry.also || [])]) {
      const src = join(MODULES, from);
      if (!existsSync(src)) throw new Error(`missing vendor file: node_modules/${from}`);
      const dest = join(OUT, to);
      await mkdir(dirname(dest), { recursive: true });
      await cp(src, dest, { recursive: true });
    }
  }
  await copyVendorLicences();
  await writeNotices();
  log(`vendored ${VENDOR.length} libraries into www/vendor`);
}

// Every third-party component travels with its licence: MIT, BSD, Zlib, Apache and the OFL
// of the icon font all ask for the notice to accompany the copies. A package's licence is
// its own file in node_modules or, when it ships none, mobile/licenses/<package>.txt
// (Weather Icons); any mobile/licenses/<package>+*.txt is appended (pako's zlib notice).
// A package with neither stops the build rather than shipping without its terms.
const LICENCES = join(MOBILE, 'licenses');
const licenceName = (pkg) => pkg.replace('/', '-');

async function licenceText(pkg) {
  const own = (await readdir(join(MODULES, pkg))).find((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
  const base = own ? join(MODULES, pkg, own) : join(LICENCES, `${licenceName(pkg)}.txt`);
  if (!existsSync(base)) throw new Error(`no licence for ${pkg}: add mobile/licenses/${licenceName(pkg)}.txt`);
  const extras = (await readdir(LICENCES)).filter((n) => n.startsWith(`${licenceName(pkg)}+`)).sort();
  const parts = [await readFile(base, 'utf8')];
  for (const n of extras) parts.push(await readFile(join(LICENCES, n), 'utf8'));
  return parts.join('\n\n');
}

async function copyVendorLicences() {
  const dirs = new Map();
  for (const entry of VENDOR) dirs.set(entry.from.split('/')[0], entry.to.split('/')[1]);
  for (const [pkg, dir] of dirs) {
    await writeFile(join(OUT, 'vendor', dir, 'LICENSE.txt'), await licenceText(pkg));
  }
}

/**
 * www/THIRD-PARTY-NOTICES.txt: one file with the licence of everything third-party the app
 * ships, web and native. That is every runtime dependency in package.json, plus
 * @capacitor/ios and @capacitor/android, which are devDependencies only because the CLI
 * installs them, but whose code is compiled into the app. Every other file in
 * mobile/licenses is a component that has no package here (Cordova's Apache code inside
 * Capacitor, the ion libraries, QuickJS, the Gradle classpath) and is added as is. The
 * marker icons' licence lives next to them in public/icons, because the website serves it
 * too; it is read from there rather than through a symlink, which a checkout without
 * symlinks (Windows) turns into a one-line file holding the path.
 */
const MARKERS_LICENCE = join(SRC, 'icons', 'LICENSE-markers.txt');

async function writeNotices() {
  const pkgJson = JSON.parse(await readFile(join(MOBILE, 'package.json'), 'utf8'));
  const pkgs = [...Object.keys(pkgJson.dependencies), '@capacitor/ios', '@capacitor/android'].sort();
  const used = new Set();
  const sections = [];
  for (const pkg of pkgs) {
    const { version } = JSON.parse(await readFile(join(MODULES, pkg, 'package.json'), 'utf8'));
    for (const n of await readdir(LICENCES)) {
      if (n === `${licenceName(pkg)}.txt` || n.startsWith(`${licenceName(pkg)}+`)) used.add(n);
    }
    sections.push(`== ${pkg} ${version} ==\n\n${await licenceText(pkg)}`);
  }
  for (const n of (await readdir(LICENCES)).sort()) {
    if (!used.has(n)) sections.push(`== ${basename(n, '.txt')} ==\n\n${await readFile(join(LICENCES, n), 'utf8')}`);
  }
  sections.push(`== leaflet-color-markers ==\n\n${await readFile(MARKERS_LICENCE, 'utf8')}`);
  const head = 'MeteoRide includes the third-party components below, each under its own licence.';
  await writeFile(join(OUT, 'THIRD-PARTY-NOTICES.txt'), [head, ...sections].join('\n\n\n'));
}

/**
 * The website gets its Content-Security-Policy from `public/_headers`, which is a
 * Cloudflare Pages file: it is stripped from the bundle and would mean nothing to a
 * web view anyway. So the app carries its own policy in a meta tag, and it matters
 * more here — script running in the app reaches `window.Capacitor.Plugins`.
 *
 * Placement is deliberate. Capacitor's Android bridge is injected as an inline
 * <script> immediately after `<head>`, which pushes this meta below it, and a meta
 * policy does not govern script parsed before it — so the bridge still runs while
 * everything after, including anything injected at runtime, is covered. On iOS the
 * bridge arrives as a WKUserScript, which bypasses CSP entirely. Verified in Chromium,
 * the engine Android's web view uses.
 *
 * No CDN hosts: the bundle carries every library. `connect-src` names the three
 * forecast APIs and nothing else — unlike the website, the app has no way to reach
 * ?gpx_url=, because nothing ever navigates the web view to a URL carrying a query
 * string. That makes the list closed, so script that somehow ran here could not post
 * the stored API key anywhere. Wiring a deep link that opens a route by URL would mean
 * widening this again, deliberately. `frame-ancestors` is omitted because a meta policy
 * ignores it.
 */
const FORECAST_APIS = [
  'https://api.open-meteo.com',
  'https://api.openweathermap.org',
  // meteoblue is gone: `utils.js` migrates the setting away and no code builds a URL
  // for it. Leaving the host here made the app's "closed list" one host wider than the
  // list the privacy policies show the user, which is a promise the build was breaking.
];

const NATIVE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  // The tile host is here as well as in img-src because the caching tile layer reads
  // tiles with fetch in order to store them.
  `connect-src 'self' ${FORECAST_APIS.join(' ')} https://*.tile.openstreetmap.org`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Applied to every page in the bundle.
 *
 * An <img> pointing at another site cannot load in an offline app and leaves a broken
 * box behind, so it becomes the text it was described by. Social preview images are
 * fetched from the website and mean nothing inside an app.
 */
function patchBundledHtml(html) {
  if (!html.includes('<head>')) throw new Error('a bundled page has no <head>; the CSP would not be applied');
  html = html.replace(
    '<head>',
    `<head>\n<meta http-equiv="Content-Security-Policy" content="${NATIVE_CSP}">`
  );
  html = html.replace(/\s*<meta (?:property|name)="(?:og|twitter):image"[^>]*>/g, '');
  // Safe-area insets are only reported to a page whose viewport covers the screen,
  // and `contentInset: "never"` puts the web view under the Dynamic Island. Without
  // this the help page's env(safe-area-inset-top) is zero and its back button sits
  // in the notch. The website has no notch to dodge, so this goes on the bundle
  // alone; unlike index.html, a page of text keeps its pinch-zoom.
  html = html.replace(
    /(<meta name="viewport" content=")([^"]*)(")/,
    (tag, open, content, close) =>
      content.includes('viewport-fit') ? tag : `${open}${content}, viewport-fit=cover${close}`
  );
  html = stripDonation(html);
  return html.replace(/<img\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt="([^"]*)"/i);
    return alt ? alt[1] : '';
  });
}

/**
 * The help pages end with a "support the project" section linking to buymeacoffee.
 * Fine on the website; inside the app it is a link to a payment outside the store,
 * which App Store guideline 3.1.1 rejects outright (donations are allowed only to
 * approved non-profits, 3.2.1) and Google Play tolerates but does not promise to.
 * The whole section goes: heading and the paragraphs that follow it, up to the next
 * tag that is not a paragraph. `ensureNoDonationLink` then proves nothing survived.
 */
const DONATION_SECTION = /\s*<h3>[^<]*(?:Apoya el Proyecto|Support the Project)[^<]*<\/h3>(?:\s*<p>[\s\S]*?<\/p>)*/g;
const DONATION_HOST = /buymeacoffee\.com/i;

function stripDonation(html) {
  return html.replace(DONATION_SECTION, '');
}

async function ensureNoDonationLink() {
  for (const page of await readdir(OUT)) {
    if (!page.endsWith('.html')) continue;
    if (DONATION_HOST.test(await readFile(join(OUT, page), 'utf8'))) {
      throw new Error(`${page} still links to buymeacoffee; the section moved and stripDonation no longer finds it`);
    }
  }
}

/** Rewrites index.html for the native shell. */
function patchIndexHtml(html) {
  for (const { url, to } of VENDOR) {
    if (!html.includes(url)) throw new Error(`index.html no longer references ${url}`);
    html = html.split(url).join('/' + to);
  }

  // One more addition to the viewport, app-only: user-scalable=no. iOS zooms the page
  // in when a field smaller than 16px takes focus, and never zooms back out. Forcing
  // 16px on the text inputs fixed that but left them a different size from the selects
  // beside them. Turning off page zoom is the usual answer in a native shell, where the
  // map does its own pinch-zoom and there is no browser chrome; the website keeps
  // pinch-zoom, since this only patches the bundle.
  // viewport-fit=cover is already there: patchBundledHtml adds it to every page,
  // index.html included, before this function ever runs.
  html = html.replace(
    /(<meta name="viewport" content=")([^"]*)(")/,
    (m, a, content, b) => {
      let out = content;
      if (!out.includes('user-scalable')) out += ', maximum-scale=1, user-scalable=no';

      return `${a}${out}${b}`;
    }
  );

  // SEO payload is dead weight inside an app bundle, and the canonical/alternate
  // tags point the app at the website.
  html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  html = html.replace(/\s*<link rel="(?:canonical|alternate)"[^>]*>/g, '');

  if (!html.includes('/scripts/native.js')) {
    throw new Error('public/index.html no longer loads scripts/native.js; the native bridge would be missing');
  }
  return html;
}

/**
 * Remote files the app would have to download to look right: images, fonts, styles,
 * scripts. Tile URLs are excluded by the `{` in their template — map tiles genuinely
 * come from the network, unlike a marker icon that belongs in the bundle.
 *
 * Exported so the smoke suite can assert the same thing over the shipped bundle.
 */
const REMOTE_ASSET = /https?:\/\/[^"'`\s)]+\.(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|css|js)\b/gi;

export async function findRemoteAssets(dir, base = dir) {
  const hits = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Third-party libraries carry source-map comments and the like; they are
      // already local, and their internals are not ours to police.
      if (entry.name === 'vendor') continue;
      hits.push(...(await findRemoteAssets(path, base)));
      continue;
    }
    if (!/\.(html|js|css)$/i.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    for (const [url] of text.matchAll(REMOTE_ASSET)) {
      if (url.includes('{')) continue;
      hits.push(`${relative(base, path)} -> ${url}`);
    }
  }
  return hits;
}

/**
 * Assembles www/runners/watch.js. capacitor.config.json names that path and the
 * plugin loads it from the app bundle, so the file has to exist after every build
 * and has to be self-contained: the runner has no module loader.
 */
async function buildRunner() {
  const config = JSON.parse(await readFile(join(MOBILE, 'capacitor.config.json'), 'utf8'));
  const declared = config.plugins && config.plugins.BackgroundRunner && config.plugins.BackgroundRunner.src;
  if (declared !== RUNNER.to) {
    throw new Error(`capacitor.config.json points the BackgroundRunner at ${declared}, the build writes ${RUNNER.to}`);
  }
  const chunks = [];
  for (const part of RUNNER.parts) {
    const text = await readFile(part, 'utf8');
    if (/^\s*(import|export)\b/m.test(text)) {
      throw new Error(`${relative(REPO, part)} uses modules; the background runner cannot load them`);
    }
    chunks.push(`// ---- ${relative(REPO, part)} ----\n${text}`);
  }
  const dest = join(OUT, RUNNER.to);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, chunks.join('\n'));
  log(`assembled ${RUNNER.to}`);
}

async function ensureNoRemoteRefs() {
  const hits = await findRemoteAssets(OUT);
  if (hits.length) {
    throw new Error(
      `the bundle would fetch these at runtime, which breaks offline use and App Store review:\n  ${hits.join('\n  ')}`
    );
  }
}

async function dirSize(dir) {
  let bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    bytes += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return bytes;
}

async function main() {
  await writeVersionFile();
  await writeIosMarketingVersion();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true, filter: (src) => !isBuildDebris(basename(src)) });
  for (const f of WEB_ONLY) await rm(join(OUT, f), { force: true, recursive: true });
  log('copied public/ -> www/');

  await copyVendor();

  for (const page of await readdir(OUT)) {
    if (!page.endsWith('.html')) continue;
    const path = join(OUT, page);
    let html = patchBundledHtml(await readFile(path, 'utf8'));
    if (page === 'index.html') html = patchIndexHtml(html);
    await writeFile(path, html);
  }
  await buildRunner();
  await ensureNoRemoteRefs();
  await ensureNoDonationLink();
  log('patched the bundled pages');

  log(`done: ${relative(REPO, OUT)} (${((await dirSize(OUT)) / 1024 / 1024).toFixed(1)} MB)`);
}

// Only build when run as a script; the smoke suite imports findRemoteAssets.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[build-www] failed:', err.message);
    process.exit(1);
  });
}
