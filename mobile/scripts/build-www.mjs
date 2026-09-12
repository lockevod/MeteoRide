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
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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

/** Files that only make sense on the public website. */
const WEB_ONLY = ['sitemap.xml', 'robots.txt', '_headers'];

const log = (...a) => console.log('[build-www]', ...a);

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
  log(`vendored ${VENDOR.length} libraries into www/vendor`);
}

/** Rewrites index.html for the native shell. */
function patchIndexHtml(html) {
  for (const { url, to } of VENDOR) {
    if (!html.includes(url)) throw new Error(`index.html no longer references ${url}`);
    html = html.split(url).join('/' + to);
  }

  // Safe-area insets are only reported when the viewport covers the whole screen.
  html = html.replace(
    /(<meta name="viewport" content=")([^"]*)(")/,
    (m, a, content, b) => (content.includes('viewport-fit') ? m : `${a}${content}, viewport-fit=cover${b}`)
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

async function ensureNoRemoteRefs() {
  const html = await readFile(join(OUT, 'index.html'), 'utf8');
  const loaders = /<(?:script[^>]*\ssrc|link[^>]*\srel="stylesheet"[^>]*\shref|img[^>]*\ssrc)="(https?:\/\/[^"]+)"/g;
  const leftovers = [...html.matchAll(loaders)].map((m) => m[1]);
  if (leftovers.length) {
    throw new Error(`index.html still loads remote resources:\n  ${leftovers.join('\n  ')}`);
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
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });
  for (const f of WEB_ONLY) await rm(join(OUT, f), { force: true });
  log('copied public/ -> www/');

  await copyVendor();

  const indexPath = join(OUT, 'index.html');
  await writeFile(indexPath, patchIndexHtml(await readFile(indexPath, 'utf8')));
  await ensureNoRemoteRefs();
  log('patched index.html');

  log(`done: ${relative(REPO, OUT)} (${((await dirSize(OUT)) / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error('[build-www] failed:', err.message);
  process.exit(1);
});
