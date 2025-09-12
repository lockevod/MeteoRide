// ==UserScript==
// @name         MeteoRide Quick Export
// @namespace    https://app.meteoride.cc/
// @version      0.10
// @description  Add a button on Komoot and Bikemap to open the current route in MeteoRide (downloads GPX and sends via postMessage)
// @author       MeteoRide
// @license      MIT
// @homepageURL  https://app.meteoride.cc/
// @source       https://github.com/lockevod/meteoride
// @supportURL   https://github.com/lockevod/meteoride/issues
// @downloadURL  https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride.user.js
// @updateURL    https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride.user.js
// @icon         https://app.meteoride.cc/icon-192.png
// @run-at       document-end
// @include      https://www.komoot.*/*
// @include      https://komoot.*/*
// @include      https://*.komoot.com/*
// @include      https://*.komoot.de/*
// @include      https://*.bikemap.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      komoot.com
// @connect      komoot.de
// @connect      bikemap.net
// ==/UserScript==

(function() {
    'use strict';

    // URL of your MeteoRide app; change if testing locally
    // Local dev default (Caddyfile listens on 8080), adjust if needed
    const METEORIDE_URL = (location.hostname.includes('localhost') || location.hostname.includes('127.0.0.1')) ? 'http://localhost:8080/' : 'https://app.meteoride.cc/';

    // --- Debug helpers ---
    const DEBUG = true; // set false to silence
    function d(...args) { if (DEBUG) console.log('[MR-UX]', ...args); }
    d('Userscript init starting', { url: location.href });

        function postToMeteoRide(gpxText, name) {
        d('postToMeteoRide', name, 'gpxLength=', gpxText && gpxText.length);
                // Open MeteoRide in a new tab (add a hash so the app can optionally detect autopost intent)
                const targetUrl = METEORIDE_URL.replace(/[#?].*$/, '') + '#autopost';
                const w = window.open(targetUrl, '_blank');
        if (!w) return;
                // Listen for ack
                const ackListener = (ev) => {
                    const data = ev.data;
                    if (!data || data.action !== 'loadGPX:ack') return;
                    d('ACK from app', data);
                    window.removeEventListener('message', ackListener);
                };
                window.addEventListener('message', ackListener);
        // try to post after the new tab loads
        const tryPost = () => {
            try {
                w.postMessage({ action: 'loadGPX', gpx: gpxText, name: name }, new URL(METEORIDE_URL).origin);
                d('postMessage sent');
            } catch (e) {
                // retry a few times
            }
        };
        // wait a bit and then post (best-effort)
        setTimeout(tryPost, 1000);
        setTimeout(tryPost, 2000);
        setTimeout(tryPost, 4000);
    }

    function fetchAsText(url, cb) {
        d('fetchAsText', url);
        // Use GM_xmlhttpRequest if available for cross-origin
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({ method: 'GET', url: url, onload: function(res) { d('GM_xmlhttpRequest OK', url, 'status', res.status, 'len', res.responseText && res.responseText.length); cb(res.responseText); }, onerror: function(err){ d('GM_xmlhttpRequest ERR', url, err); cb(null); } });
            return;
        }
        fetch(url).then(r => { d('fetch status', url, r.status); return r.text(); }).then(t => { d('fetch OK', url, 'len', t && t.length); cb(t); }).catch(e => { d('fetch ERR', url, e); cb(null); });
    }

    function addButton(label, onclick) {
        // Prevent creating duplicate global buttons
        if (document.querySelector('.meteoride-export-btn.global')) return null;
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.position = 'fixed';
        btn.style.right = '10px';
        btn.style.bottom = '20px';
        btn.style.padding = '8px 12px';
        btn.style.background = '#0077cc';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
        btn.style.zIndex = 999999;
        btn.className = 'meteoride-export-btn global';
    btn.addEventListener('click', onclick);
        document.body.appendChild(btn);
    d('Button added', label);
        return btn;
    }

    // --- Komoot helpers ---
    function getKomootTourId(url) {
        const u = url || location.pathname;
        // Patterns: /tour/123456789, maybe with slug after id
    const m = u.match(/\/tour\/(\d+)/);
    const id = m ? m[1] : null;
    d('getKomootTourId', u, '=>', id);
    return id;
    }

    function buildGpxFromCoords(coords, name) {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    d('buildGpxFromCoords coordsLen', coords.length, 'name', name);
        let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
        gpx += '<gpx version="1.1" creator="MeteoRide Userscript" xmlns="http://www.topografix.com/GPX/1/1">\n';
        if (name) gpx += '  <metadata><name>' + (name.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) ) + '</name></metadata>\n';
        gpx += '  <trk><name>' + (name||'Komoot Tour') + '</name><trkseg>\n';
        for (const c of coords) {
            if (!Array.isArray(c) || c.length < 2) continue;
            const lon = c[0];
            const lat = c[1];
            const ele = c.length > 2 ? c[2] : null;
            gpx += '    <trkpt lat="' + lat + '" lon="' + lon + '">';
            if (ele != null && !isNaN(ele)) gpx += '<ele>' + ele + '</ele>';
            gpx += '</trkpt>\n';
        }
        gpx += '  </trkseg></trk>\n</gpx>';
        return gpx;
    }

    function extractCoordsFromKomootJson(json) {
        try {
            if (!json) return null;
            // Common structure: json.tour.route.geometry.coordinates (array of [lon,lat,ele?])
            const path1 = json && json.tour && json.tour.route && json.tour.route.geometry && json.tour.route.geometry.coordinates;
            if (Array.isArray(path1)) return path1;
            // Sometimes inside geojson: json.geojson.features[0].geometry.coordinates
            const features = json && json.geojson && json.geojson.features;
            if (Array.isArray(features) && features.length) {
                const g = features[0].geometry;
                if (g && Array.isArray(g.coordinates)) {
                    // LineString or MultiLineString
                    if (g.type === 'LineString') return g.coordinates;
                    if (g.type === 'MultiLineString' && g.coordinates.length) return g.coordinates[0];
                }
            }
        } catch (e) {
            console.warn('Komoot JSON parse coords error', e);
        }
        return null;
    }

    function fetchKomootGpx(tourId, cb) {
        if (!tourId) { d('fetchKomootGpx no tourId'); return cb(null); }
        const base = 'https://www.komoot.com/api/v007/tours/' + tourId;
        const candidates = [base + '.gpx?download=1', base + '.gpx'];
        let idx = 0;
        function tryNext() {
            if (idx >= candidates.length) { d('No direct GPX, fallback JSON'); return fallbackJson(); }
            const url = candidates[idx++];
            d('Attempt direct GPX', url);
            fetchAsText(url, txt => {
                if (txt && txt.trim().startsWith('<?xml')) { d('Direct GPX success', url); return cb(txt); }
                tryNext();
            });
        }
        function fallbackJson() {
            // attempt JSON then reconstruct GPX
            const jsonUrl = base + '.json';
            fetchAsText(jsonUrl, txt => {
                if (!txt) return cb(null);
                try {
                    const j = JSON.parse(txt);
                    const coords = extractCoordsFromKomootJson(j);
                    if (coords) {
                        const gpx = buildGpxFromCoords(coords, (j && j.tour && j.tour.name) || 'Komoot Tour ' + tourId);
                        d('Reconstructed GPX length', gpx && gpx.length);
                        return cb(gpx);
                    }
                } catch (e) { /* ignore */ }
                cb(null);
            });
        }
        tryNext();
    }

    function addKomootButton(tourId) {
        if (!tourId) return false;
        if (document.querySelector('.meteoride-export-btn.global.komoot')) return true;
        const btn = addButton('Open Komoot tour in MeteoRide', () => {
            d('Komoot button clicked', tourId);
            if (btn) { btn.disabled = true; btn.textContent = 'Loading Komoot tour...'; }
            fetchKomootGpx(tourId, gpx => {
                if (!gpx) { alert('Could not fetch Komoot GPX'); return; }
                postToMeteoRide(gpx, 'komoot-' + tourId + '.gpx');
                if (btn) { btn.disabled = false; btn.textContent = 'Open Komoot tour in MeteoRide'; }
            });
        });
        if (btn) btn.classList.add('komoot');
        return true;
    }

    function tryKomoot() {
        const id = getKomootTourId(location.pathname);
        if (id) return addKomootButton(id);
        return false;
    }

    // --- Bikemap helpers ---
    function getBikemapRouteId(url) {
        const u = url || location.pathname;
        const m = u.match(/\/r\/(\d+)/);
        const id = m ? m[1] : null;
        d('getBikemapRouteId', u, '=>', id);
        return id;
    }

    function fetchBikemapRouteMeta(routeId, cb) {
        if (!routeId) return cb(null);
        // Try several endpoint variants (some deployments differ with trailing slash or .json)
        const endpoints = [
            `https://www.bikemap.net/api/v5/routes/${routeId}/`,
            `https://www.bikemap.net/api/v5/routes/${routeId}`,
            `https://www.bikemap.net/api/v5/routes/${routeId}.json`
        ];
        let idx = 0;
        function tryNext() {
            if (idx >= endpoints.length) return cb(null);
            const apiUrl = endpoints[idx++];
            d('fetchBikemapRouteMeta try', apiUrl);
            const headers = { 'x-requested-with': 'XMLHttpRequest', 'accept': 'application/json' };
            const onSuccess = (status, text) => {
                d('Bikemap meta status', status, 'len', text && text.length);
                if (!text || status >= 400) return tryNext();
                try { const json = JSON.parse(text); return cb(json); } catch(e) { d('Bikemap meta parse error', e); tryNext(); }
            };
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({ method: 'GET', url: apiUrl, headers, onload: res => onSuccess(res.status, res.responseText), onerror: err => { d('Bikemap meta error', err); tryNext(); } });
            } else {
                fetch(apiUrl, { headers }).then(r => r.text().then(t => onSuccess(r.status, t))).catch(e => { d('Bikemap meta fetch err', e); tryNext(); });
            }
        }
        tryNext();
    }

    function findGpxUrlInObject(obj) {
        if (!obj || typeof obj !== 'object') return null;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (typeof v === 'string' && /\.gpx(\?|$)/i.test(v)) return v;
            if (v && typeof v === 'object') {
                const found = findGpxUrlInObject(v);
                if (found) return found;
            }
        }
        return null;
    }

    function findBikemapDomGpxLink() {
        // Look for explicit .gpx links or data attributes that hint at GPX
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const g1 = anchors.find(a => a.href.match(/\.gpx(\?|$)/i));
        if (g1) return g1.href;
        // Sometimes download buttons trigger JS; look for data-export or data-download attributes
        const exp = anchors.find(a => /gpx/i.test(a.getAttribute('data-export')||'') || /gpx/i.test(a.textContent||''));
        if (exp && exp.href) return exp.href;
        return null;
    }

    function fetchBikemapGpx(routeId, cb) {
        fetchBikemapRouteMeta(routeId, meta => {
            if (!meta) {
                d('No meta via API, trying NEXT_DATA + DOM fallbacks');
                const nd = extractBikemapFromNextData(routeId);
                if (nd) {
                    d('Extracted candidate from __NEXT_DATA__');
                    meta = nd; // continue as if meta
                } else {
                    const domUrl = findBikemapDomGpxLink();
                    if (domUrl) return fetchAsText(domUrl, t => { if (t && t.trim().startsWith('<?xml')) return cb(t, { title: 'Bikemap Route ' + routeId }); cb(null); });
                    // As a last resort attempt to parse inline scripts
                    const inline = extractBikemapFromInlineScripts(routeId);
                    if (inline) {
                        d('Recovered from inline script data');
                        meta = inline;
                    } else {
                        return cb(null);
                    }
                }
            }
            // Try direct meta.gpx or any nested GPX url
            let gpxUrl = meta.gpx || findGpxUrlInObject(meta);
            if (gpxUrl) {
                d('Bikemap found GPX url', gpxUrl);
                fetchAsText(gpxUrl, txt => {
                    if (txt && txt.trim().startsWith('<?xml')) return cb(txt, meta);
                    d('Primary GPX fetch failed or not XML, attempt GeoJSON fallback');
                    geoJsonFallback();
                });
            } else {
                d('No GPX url in meta, attempt GeoJSON fallback');
                geoJsonFallback();
            }

            function geoJsonFallback() {
                const gj = meta.geo_json || meta.geojson || meta.geometry || null;
                if (!gj) {
                    d('No GeoJSON in meta, final DOM link attempt');
                    const domUrl = findBikemapDomGpxLink();
                    if (domUrl) return fetchAsText(domUrl, t => { if (t && t.trim().startsWith('<?xml')) return cb(t, meta); cb(null); });
                    // Last-chance: attempt reconstruct from any coords arrays in meta
                    const coords = extractAnyCoordinates(meta);
                    if (coords && coords.length) {
                        const gpxText = buildGpxFromCoords(coords, meta.title || ('Bikemap Route ' + routeId));
                        if (gpxText) { d('Last-chance coord extraction success length', gpxText.length); return cb(gpxText, meta); }
                    }
                    return cb(null);
                }
                try {
                    let coords = null;
                    if (gj.type === 'FeatureCollection' && Array.isArray(gj.features) && gj.features.length) {
                        const feat = gj.features.find(f => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) || gj.features[0];
                        if (feat && feat.geometry) {
                            if (feat.geometry.type === 'LineString') coords = feat.geometry.coordinates;
                            else if (feat.geometry.type === 'MultiLineString' && feat.geometry.coordinates.length) coords = feat.geometry.coordinates[0];
                        }
                    } else if (gj.type === 'LineString') coords = gj.coordinates;
                    else if (gj.type === 'MultiLineString' && gj.coordinates && gj.coordinates.length) coords = gj.coordinates[0];
                    if (coords && coords.length) {
                        const gpxText = buildGpxFromCoords(coords, meta.title || ('Bikemap Route ' + routeId));
                        if (gpxText) {
                            d('GeoJSON fallback GPX length', gpxText.length);
                            return cb(gpxText, meta);
                        }
                    }
                } catch (e) { d('GeoJSON fallback error', e); }
                // Final attempt: DOM link
                const domUrl2 = findBikemapDomGpxLink();
                if (domUrl2) return fetchAsText(domUrl2, t => { if (t && t.trim().startsWith('<?xml')) return cb(t, meta); cb(null); });
                cb(null);
            }
        });
    }

    function extractAnyCoordinates(obj) {
        // Deep search for plausible coordinate arrays [[lon,lat],[lon,lat],...]
        const visited = new Set();
        function isCoordPair(p) { return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'; }
        function dfs(o) {
            if (!o || typeof o !== 'object' || visited.has(o)) return null;
            visited.add(o);
            if (Array.isArray(o)) {
                if (o.length > 1 && o.every(isCoordPair)) return o; // treat as coordinates
                for (const it of o) { const r = dfs(it); if (r) return r; }
            } else {
                for (const k of Object.keys(o)) {
                    const v = o[k];
                    const r = dfs(v); if (r) return r;
                }
            }
            return null;
        }
        return dfs(obj);
    }

    function extractBikemapFromNextData(routeId) {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        try {
            const json = JSON.parse(el.textContent || '{}');
            const targetId = parseInt(routeId, 10);
            const queue = [json];
            const seen = new Set();
            while (queue.length) {
                const cur = queue.shift();
                if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
                seen.add(cur);
                if (cur.id === targetId && (cur.gpx || cur.geo_json || cur.geojson || cur.geometry || extractAnyCoordinates(cur))) {
                    return cur;
                }
                for (const k of Object.keys(cur)) {
                    const v = cur[k];
                    if (v && typeof v === 'object') queue.push(v);
                }
            }
        } catch (e) { d('__NEXT_DATA__ parse error', e); }
        return null;
    }

    function extractBikemapFromInlineScripts(routeId) {
        const scripts = Array.from(document.querySelectorAll('script'));
        const targetId = parseInt(routeId, 10);
        for (const s of scripts) {
            const txt = s.textContent || '';
            if (!txt) continue;
            if (/gpx/i.test(txt) || /geo_json/i.test(txt) || /coordinates/.test(txt)) {
                // Try naive brace extraction around first occurrence of 'geo_' or 'coordinates'
                const idx = txt.search(/geo_json|geojson|coordinates|gpx/i);
                if (idx >= 0) {
                    // Walk backwards to first '{'
                    let start = idx;
                    while (start > 0 && txt[start] !== '{') start--;
                    // Walk forward counting braces
                    let depth = 0; let end = start; let started = false;
                    for (let i = start; i < txt.length; i++) {
                        const ch = txt[i];
                        if (ch === '{') { depth++; started = true; }
                        else if (ch === '}') { depth--; }
                        if (started && depth === 0) { end = i+1; break; }
                    }
                    const blob = txt.slice(start, end);
                    try {
                        const obj = JSON.parse(blob);
                        if (obj && typeof obj === 'object') {
                            const queue = [obj];
                            const seen = new Set();
                            while (queue.length) {
                                const cur = queue.shift();
                                if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
                                seen.add(cur);
                                if (cur.id === targetId && (cur.gpx || cur.geo_json || cur.geojson || cur.geometry || extractAnyCoordinates(cur))) {
                                    return cur;
                                }
                                for (const k of Object.keys(cur)) { const v = cur[k]; if (v && typeof v === 'object') queue.push(v); }
                            }
                        }
                    } catch(e) { /* ignore parse */ }
                }
            }
        }
        return null;
    }

    function addBikemapButton(routeId) {
        if (!routeId) return false;
        if (document.querySelector('.meteoride-export-btn.global.bikemap')) return true;
        const btn = addButton('Open Bikemap route in MeteoRide', () => {
            d('Bikemap button clicked', routeId);
            if (btn) { btn.disabled = true; btn.textContent = 'Loading Bikemap route...'; }
            fetchBikemapGpx(routeId, (gpx, meta) => {
                if (!gpx) { alert('Could not fetch Bikemap GPX (maybe login required)'); if (btn) { btn.disabled = false; btn.textContent='Open Bikemap route in MeteoRide'; } return; }
                const name = (meta && meta.title ? meta.title.replace(/\s+/g,'_') : 'bikemap-'+routeId) + '.gpx';
                postToMeteoRide(gpx, name);
                if (btn) { btn.disabled = false; btn.textContent = 'Open Bikemap route in MeteoRide'; }
            });
        });
        if (btn) btn.classList.add('bikemap');
        return true;
    }

    function tryBikemap() {
        const id = getBikemapRouteId(location.pathname);
        if (id) return addBikemapButton(id);
        return false;
    }

    function init() {
        // try site-specific helpers
        d('init start');
    tryKomoot();
    tryBikemap();
        // Generic global button that will attempt to find any GPX link on the page
        addButton('Open route in MeteoRide', () => {
            d('Generic button clicked');
            const any = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.endsWith('.gpx') || a.href.includes('/export/gpx')));
            if (!any) { alert('No GPX link found on this page'); return; }
            fetchAsText(any.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else alert('Could not fetch GPX'); });
        });

        // Watch for dynamic content that may inject GPX links (single global observer)
    const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (!m.addedNodes) continue;
                for (const node of m.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    // If new links are added, try to detect GPX links and add a page button if found
                    const found = node.querySelector && node.querySelector('a[href$=".gpx"], a[href*="/export/gpx"]');
                    if (found) {
            d('Mutation found potential GPX link');
                        // ensure there is a global button
                        if (!document.querySelector('.meteoride-export-btn.global')) {
                            addButton('Open route in MeteoRide', () => {
                                const any = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.endsWith('.gpx') || a.href.includes('/export/gpx')));
                                if (!any) { alert('No GPX link found on this page'); return; }
                                fetchAsText(any.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else alert('Could not fetch GPX'); });
                            });
                        }
                        return;
                    }
                }
            }
        });
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA route changes (Komoot uses client-side navigation)
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    function onNav() { d('SPA nav', location.pathname); setTimeout(() => { tryKomoot(); }, 400); }
    history.pushState = function() { pushState.apply(this, arguments); onNav(); };
    history.replaceState = function() { replaceState.apply(this, arguments); onNav(); };
    window.addEventListener('popstate', onNav);
    }

    // Run after DOM ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 500); else document.addEventListener('DOMContentLoaded', init);
})();
