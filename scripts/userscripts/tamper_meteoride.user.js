// ==UserScript==
// @name         MeteoRide Quick Export
// @namespace    https://meteoride.local/
// @version      0.5
// @description  Add a button on Komoot and Bikemap to open the current route in MeteoRide (downloads GPX and sends via postMessage)
// @author       MeteoRide
// @license      MIT
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

    function tryBikemap() {
        // Bikemap often has a download link with "export/gpx" in href
    const link = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.includes('/export/gpx') || a.href.endsWith('.gpx')));
    d('tryBikemap linkFound', !!link);
        if (link) {
            addButton('Open in MeteoRide', () => {
        d('Bikemap button clicked');
                fetchAsText(link.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else alert('Could not fetch GPX'); });
            });
            return true;
        }
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
