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

/** Paths that only make sense on the public website. The two localised landing pages
 *  exist for search engines and are only reachable through the alternate link tags
 *  that patchIndexHtml strips, so nothing in the app can navigate to them. */
const WEB_ONLY = ['sitemap.xml', 'robots.txt', '_headers', 'en', 'es'];

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
 * No CDN hosts: the bundle carries every library. `connect-src` stays open to https:
 * because ?gpx_url= fetches a route from wherever the user hosts it, and the forecast
 * providers are chosen at runtime. `frame-ancestors` is omitted because a meta policy
 * ignores it.
 */
const NATIVE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self' https:",
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
  return html.replace(/<img\b[^>]*\bsrc="https?:\/\/[^"]*"[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt="([^"]*)"/i);
    return alt ? alt[1] : '';
  });
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
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });
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
  await ensureNoRemoteRefs();
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
