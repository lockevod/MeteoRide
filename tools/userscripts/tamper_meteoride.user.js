// ==UserScript==
// @name         MeteoRide Import from Komoot, Bikemap and Hammerhead
// @namespace    github.com/lockevod
// @version      0.24
// @description  Add a button on Komoot, Bikemap and Hammerhead to open the current route in MeteoRide (downloads GPX and sends via postMessage)
// @author       Lockevod
// @license      MIT
// @homepageURL  https://app.meteoride.cc/
// @source       https://github.com/lockevod/meteoride
// @supportURL   https://github.com/lockevod/meteoride/issues
// @downloadURL  https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js
// @updateURL    https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js
// @icon         https://app.meteoride.cc/icons/icon-192.png
// @run-at       document-end
// @include      https://www.komoot.*/*
// @include      https://komoot.*/*
// @include      https://*.komoot.com/*
// @include      https://*.komoot.de/*
// @include      https://*.bikemap.net/*
// @include      https://dashboard.hammerhead.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      komoot.com
// @connect      komoot.de
// @connect      bikemap.net
// @connect      hammerhead.io
// ==/UserScript==

// Install (one-click - raw): https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js

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

    function addButton(label, onclick, extraClass) {
        // Prevent creating duplicate button with same text
        if (Array.from(document.querySelectorAll('.meteoride-export-btn.global')).some(b => b.getAttribute('data-label') === label)) return null;
        const btn = document.createElement('button');
        // Use a small MeteoRide icon instead of text for a compact UI
        btn.setAttribute('data-label', label);
        btn.title = label;
        btn.setAttribute('aria-label', label);
    btn.style.position = 'fixed';
    btn.style.right = '10px';
    btn.style.bottom = '20px';
    // reduced vertical padding to avoid large blue area underneath
    btn.style.padding = '2px 2px';
    btn.style.background = '#0077cc';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '4px';
    btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    btn.style.zIndex = 999999;
    // Use flex layout to vertically center icon and label and avoid extra height
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '2px';
    btn.className = 'meteoride-export-btn global' + (extraClass ? ' ' + extraClass : '');
    // create icon img
    // create icon img and a stable label span (we will toggle the span instead of replacing button text)
    const labelSpan = document.createElement('span');
    labelSpan.className = 'mr-label';
    labelSpan.style.display = 'inline-block';
    labelSpan.style.verticalAlign = 'middle';
    labelSpan.style.marginLeft = '0';
    labelSpan.style.fontSize = '13px';
    labelSpan.style.fontFamily = 'sans-serif';
    labelSpan.textContent = '';
    try {
        const img = new Image();
        img.src = (METEORIDE_URL.replace(/[#?].*$/, '').replace(/\/$/, '')) + '/icons/icon-120.png';
        img.alt = label;
        img.style.width = '38px';
        img.style.height = '38px';
        img.style.display = 'block';
        img.style.opacity = '0.85';
        img.style.filter = 'grayscale(100%) brightness(1.15)';
        img.style.pointerEvents = 'none';
        img.style.margin = '0';
        btn.appendChild(img);
        btn.appendChild(labelSpan);
    } catch (e) {
        // If image creation fails, keep a visible label
        labelSpan.textContent = label;
        btn.appendChild(labelSpan);
    }
    btn.addEventListener('click', onclick);
        document.body.appendChild(btn);
    d('Button added', label);
        return btn;
    }

    // Helper: set button loading state without replacing the icon (hide icon, show text)
    function setButtonLoading(btn, loading, text) {
        if (!btn) return;
        const img = btn.querySelector('img');
        const labelSpan = btn.querySelector('.mr-label');
        if (loading) {
            if (!btn.dataset.orig) btn.dataset.orig = btn.getAttribute('data-label') || '';
            if (img) img.style.display = 'none';
            if (labelSpan) labelSpan.textContent = text || 'Loading...';
            btn.setAttribute('aria-busy', 'true');
            btn.disabled = true;
        } else {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            const orig = btn.dataset.orig || btn.getAttribute('data-label') || '';
            if (labelSpan) labelSpan.textContent = '';
            if (img) img.style.display = 'block';
            btn.title = orig;
            btn.setAttribute('aria-label', orig);
        }
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

    // Helper: find first /tour/<id> anchor on the page
    function findFirstTourAnchorId() {
        const anchors = Array.from(document.querySelectorAll('a[href*="/tour/"]'));
        const ids = anchors
            .map(a => (a.getAttribute('href')||'').match(/\/tour\/(\d+)/))
            .filter(Boolean)
            .map(m => m[1]);
        if (ids.length) { d('found tour anchor id', ids[0]); return ids[0]; }
        return null;
    }

    // Helper: parse __NEXT_DATA__ and return first numeric id found with at least minDigits
    function extractFirstNumericIdFromNextData(minDigits = 5) {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        try {
            const json = JSON.parse(el.textContent||'{}');
            const stack = [json];
            const seen = new Set();
            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
                seen.add(cur);
                if (typeof cur.id === 'number' && String(cur.id).length >= minDigits) {
                    d('NEXT_DATA id candidate', String(cur.id));
                    return String(cur.id);
                }
                for (const k of Object.keys(cur)) {
                    const v = cur[k];
                    if (v && typeof v === 'object') stack.push(v);
                }
            }
        } catch(e) { d('NEXT_DATA parse err', e); }
        return null;
    }

    function getKomootDiscoverFocusedTourId() {
        if (!/\/discover\//.test(location.pathname)) return null;
        const params = new URLSearchParams(location.search);
        let ft = params.get('focusedTour');
        if (ft) {
            // Remove non-digits (focusedTour sometimes like e123456789)
            const digits = ft.replace(/\D+/g, '');
            if (digits.length >= 5) { d('focusedTour param ->', digits); return digits; }
        }
    const anchor = findFirstTourAnchorId();
    if (anchor) return anchor;
    const nextId = extractFirstNumericIdFromNextData();
    if (nextId) return nextId;
    return null;
    }

    function getKomootSmartTourId() {
        if (!/\/smarttour\//.test(location.pathname)) return null;
        // Pattern: /smarttour/<alphanumeric>/...
        const m = location.pathname.match(/\/smarttour\/([^/]+)/);
        if (!m) return null;
        const raw = m[1];
        const digits = raw.replace(/\D+/g,'');
        if (digits.length >= 5) { d('smarttour param ->', raw, 'digits', digits); return digits; }
    const anchor = findFirstTourAnchorId();
    if (anchor) return anchor;
    const nextId = extractFirstNumericIdFromNextData();
    if (nextId) return nextId;
    return null;
    }


    function fetchKomootGpx(tourId, cb) {
        if (!tourId) { d('fetchKomootGpx no tourId'); return cb(null); }
        const base = 'https://www.komoot.com/api/v007/tours/' + tourId;
        const candidates = [base + '.gpx?download=1', base + '.gpx'];
        let idx = 0;
        function tryNext() {
            if (idx >= candidates.length) { d('No direct GPX endpoints available'); return cb(null); }
            const url = candidates[idx++];
            d('Attempt direct GPX', url);
            fetchAsText(url, txt => {
                if (txt && txt.trim().startsWith('<?xml')) { d('Direct GPX success', url); return cb(txt); }
                tryNext();
            });
        }
        tryNext();
    }

    function addKomootButton(tourId) {
        if (!tourId) return false;
        if (document.querySelector('.meteoride-export-btn.global.komoot')) return true;
        const btn = addButton('Open Komoot tour in MeteoRide', () => {
            d('Komoot button clicked', tourId);
            setButtonLoading(btn, true, 'Loading Komoot tour...');
            fetchKomootGpx(tourId, gpx => {
                if (!gpx) {
                    d('Komoot GPX not available. Are you a Premium user?');
                    setButtonLoading(btn, false);
                    return;
                }
                postToMeteoRide(gpx, 'komoot-' + tourId + '.gpx');
                setButtonLoading(btn, false);
            });
        }, 'komoot');
        return true;
    }

    function tryKomoot() {
        const id = getKomootTourId(location.pathname);
        if (id) return addKomootButton(id);
        const did = getKomootDiscoverFocusedTourId();
        if (did) return addKomootButton(did);
    const sid = getKomootSmartTourId();
    if (sid) return addKomootButton(sid);
        return false;
    }

    // --- Hammerhead helpers ---
    function getHammerheadRouteId(url) {
        const u = url || location.pathname;
        // Patterns: /routes/123456.route.uuid or /routes/123456
        const m = u.match(/\/routes?\/(\d+)/);
        const id = m ? m[1] : null;
        d('getHammerheadRouteId', u, '=>', id);
        return id;
    }

    function getHammerheadRouteUUID(url) {
        const u = url || location.pathname;
        // Pattern: /routes/65206.route.37d6d731-9269-464d-9646-6e38218ffd8b
        const m = u.match(/\/routes?\/\d+\.route\.([a-f0-9-]+)/);
        const uuid = m ? m[1] : null;
        d('getHammerheadRouteUUID', u, '=>', uuid);
        return uuid;
    }

    // Helper: Extract JWT token from Hammerhead page
    function getHammerheadAuthToken() {
        // Try to find JWT in localStorage
        try {
            const keys = Object.keys(localStorage);
            for (const key of keys) {
                const val = localStorage.getItem(key);
                if (val && (val.includes('eyJ') || key.toLowerCase().includes('token') || key.toLowerCase().includes('auth'))) {
                    d('Found potential token in localStorage:', key);
                    // Try to parse if it's JSON
                    try {
                        const parsed = JSON.parse(val);
                        if (parsed.token || parsed.accessToken || parsed.access_token) {
                            return parsed.token || parsed.accessToken || parsed.access_token;
                        }
                    } catch(e) {
                        // Not JSON, might be the token itself
                        if (val.startsWith('eyJ')) return val;
                    }
                }
            }
        } catch(e) { d('Error reading localStorage:', e); }

        // Try sessionStorage
        try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
                const val = sessionStorage.getItem(key);
                if (val && (val.includes('eyJ') || key.toLowerCase().includes('token') || key.toLowerCase().includes('auth'))) {
                    d('Found potential token in sessionStorage:', key);
                    try {
                        const parsed = JSON.parse(val);
                        if (parsed.token || parsed.accessToken || parsed.access_token) {
                            return parsed.token || parsed.accessToken || parsed.access_token;
                        }
                    } catch(e) {
                        if (val.startsWith('eyJ')) return val;
                    }
                }
            }
        } catch(e) { d('Error reading sessionStorage:', e); }

        // Try to find in script tags or __NEXT_DATA__
        try {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                const content = script.textContent || '';
                const match = content.match(/["\']?(eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)["\']?/);
                if (match) {
                    d('Found JWT in script tag');
                    return match[1];
                }
            }
        } catch(e) { d('Error searching scripts:', e); }

        return null;
    }

    // Helper: Extract route UUID and userId from page
    function getHammerheadRouteData(routeId) {
        // Try __NEXT_DATA__ or similar
        try {
            const nextData = document.getElementById('__NEXT_DATA__');
            if (nextData) {
                const data = JSON.parse(nextData.textContent);
                d('__NEXT_DATA__ found');
                // Search for route data recursively
                function findRouteData(obj, depth = 0) {
                    if (depth > 10 || !obj || typeof obj !== 'object') return null;

                    // Look for route object with our routeId
                    if (obj.id === routeId || obj.routeId === routeId || String(obj.id) === String(routeId)) {
                        return obj;
                    }

                    // Recursively search
                    for (const key of Object.keys(obj)) {
                        const val = obj[key];
                        if (val && typeof val === 'object') {
                            const found = findRouteData(val, depth + 1);
                            if (found) return found;
                        }
                    }
                    return null;
                }

                const routeData = findRouteData(data);
                if (routeData) {
                    d('Found route data:', routeData);
                    return routeData;
                }
            }
        } catch(e) { d('Error parsing __NEXT_DATA__:', e); }

        // Try to find in window object
        try {
            if (window.__INITIAL_STATE__ || window.__PRELOADED_STATE__) {
                const state = window.__INITIAL_STATE__ || window.__PRELOADED_STATE__;
                d('Found initial state');
                // Similar recursive search
                const str = JSON.stringify(state);
                const match = str.match(new RegExp(`"${routeId}"[^}]*"uuid"[^"]*"([^"]+)"`, 'i'));
                if (match) {
                    d('Found UUID in state:', match[1]);
                    return { uuid: match[1] };
                }
            }
        } catch(e) { d('Error searching window state:', e); }

        return null;
    }

    function fetchHammerheadGpx(routeId, cb) {
        if (!routeId) { d('fetchHammerheadGpx no routeId'); return cb(null); }
        d('fetchHammerheadGpx starting for routeId:', routeId);

        // Get authentication token
        const token = getHammerheadAuthToken();
        if (!token) {
            d('No JWT token found. Cannot authenticate.');
            alert('Could not find authentication token for Hammerhead.\n\nPlease make sure you are logged in and try again.');
            return cb(null);
        }
        d('Found auth token:', token.substring(0, 50) + '...');

        // Try to get UUID from URL first (most reliable)
        let uuid = getHammerheadRouteUUID(location.pathname);

        // Fallback: Get route data from page (UUID, userId)
        if (!uuid) {
            const routeData = getHammerheadRouteData(routeId);
            d('Route data from page:', routeData);
            uuid = routeData?.uuid;
        } else {
            d('UUID from URL:', uuid);
        }

        // Extract userId from token
        let userId = routeId; // fallback
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userId = payload.sub || payload.userId || payload.context?.userId || routeId;
            d('Extracted userId from token:', userId);
        } catch(e) { d('Could not parse token payload:', e); }

        // Build export URLs to try
        const candidates = [];

        if (uuid) {
            // Exact format from curl - this should work!
            candidates.push(`https://dashboard.hammerhead.io/v1/users/${userId}/routes/${routeId}.route.${uuid}/export?format=gpx`);
        }

        // Try various other patterns as fallback
        candidates.push(
            `https://dashboard.hammerhead.io/v1/users/${userId}/routes/${routeId}/export?format=gpx`,
            `https://dashboard.hammerhead.io/api/v1/routes/${routeId}/export?format=gpx`,
            `https://dashboard.hammerhead.io/v1/routes/${routeId}/export?format=gpx`
        );

        d('Will try URLs:', candidates);

        let idx = 0;
        function tryNext() {
            if (idx >= candidates.length) {
                d('All endpoints failed');
                alert('Could not download GPX from Hammerhead.\n\nThe route might be private or the API structure has changed.');
                return cb(null);
            }

            const url = candidates[idx++];
            d('Attempting:', url);

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                d('Using GM_xmlhttpRequest with Authorization header');
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Accept': '*/*',
                        'Referer': 'https://dashboard.hammerhead.io/routes'
                    },
                    onload: function(res) {
                        d('Response status:', res.status, 'len:', res.responseText?.length);
                        d('Response headers:', res.responseHeaders);
                        const txt = res.responseText;

                        // Check if it's actually an error response
                        if (txt && txt.includes('unauthorized')) {
                            d('ERROR: Unauthorized response:', txt);
                            tryNext();
                            return;
                        }

                        if (res.status === 200 && txt && (txt.trim().startsWith('<?xml') || txt.includes('<gpx'))) {
                            d('SUCCESS! Got GPX from:', url);
                            return cb(txt);
                        }
                        d('Failed. Response preview:', txt ? txt.substring(0, 200) : 'null');
                        tryNext();
                    },
                    onerror: function(err) {
                        d('Request error:', err);
                        tryNext();
                    }
                });
            } else {
                fetch(url, {
                    credentials: 'include',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Accept': '*/*'
                    }
                })
                .then(r => {
                    if (r.status === 200) {
                        return r.text().then(txt => {
                            if (txt && (txt.trim().startsWith('<?xml') || txt.includes('<gpx'))) {
                                d('SUCCESS! Got GPX from:', url);
                                return cb(txt);
                            }
                            tryNext();
                        });
                    }
                    tryNext();
                })
                .catch(e => {
                    d('Fetch error:', e);
                    tryNext();
                });
            }
        }

        tryNext();
    }

    function addHammerheadButton(routeId) {
        if (!routeId) return false;
        if (document.querySelector('.meteoride-export-btn.global.hammerhead')) return true;
        const btn = addButton('Open Hammerhead route in MeteoRide', () => {
            d('Hammerhead button clicked', routeId);
            setButtonLoading(btn, true, 'Loading Hammerhead route...');
            fetchHammerheadGpx(routeId, gpx => {
                if (!gpx) {
                    d('Hammerhead GPX not available');
                    setButtonLoading(btn, false);
                    return;
                }
                postToMeteoRide(gpx, 'hammerhead-' + routeId + '.gpx');
                setButtonLoading(btn, false);
            });
        }, 'hammerhead');
        return true;
    }

    function tryHammerhead() {
        const id = getHammerheadRouteId(location.pathname);
        if (id) return addHammerheadButton(id);
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
                d('No meta via API, trying DOM direct link');
                const domUrl = findBikemapDomGpxLink();
                if (domUrl) return fetchAsText(domUrl, t => { if (t && t.trim().startsWith('<?xml')) return cb(t, { title: 'Bikemap Route ' + routeId }); cb(null); });
                return cb(null);
            }
            // Try direct meta.gpx or any nested GPX url
            let gpxUrl = meta.gpx || findGpxUrlInObject(meta);
            if (gpxUrl) {
                d('Bikemap found GPX url', gpxUrl);
                return fetchAsText(gpxUrl, txt => { if (txt && txt.trim().startsWith('<?xml')) return cb(txt, meta); d('GPX fetch not XML'); return cb(null); });
            }
            // Fallback to DOM link only
            const domUrl2 = findBikemapDomGpxLink();
            if (domUrl2) return fetchAsText(domUrl2, t => { if (t && t.trim().startsWith('<?xml')) return cb(t, meta); cb(null); });
            return cb(null);
        });
    }

    // Deep extraction helpers removed to keep userscript small. We only use direct API GPX or DOM .gpx links.

    function addBikemapButton(routeId) {
        if (!routeId) return false;
        if (document.querySelector('.meteoride-export-btn.global.bikemap')) return true;
        const btn = addButton('Open Bikemap route in MeteoRide', () => {
            d('Bikemap button clicked', routeId);
            setButtonLoading(btn, true, 'Loading Bikemap route...');
            fetchBikemapGpx(routeId, (gpx, meta) => {
                if (!gpx) {
                    d('Bikemap GPX not available (maybe login required)');
                    setButtonLoading(btn, false);
                    return;
                }
                const name = (meta && meta.title ? meta.title.replace(/\s+/g,'_') : 'bikemap-'+routeId) + '.gpx';
                postToMeteoRide(gpx, name);
                setButtonLoading(btn, false);
            });
        }, 'bikemap');
        return true;
    }

    function tryBikemap() {
        const id = getBikemapRouteId(location.pathname);
        if (id) return addBikemapButton(id);
        return false;
    }

    function hasAnyDirectGpxLink() {
        return !!Array.from(document.querySelectorAll('a[href]')).find(a => a.href && (a.href.match(/\.gpx(\?|$)/i) || a.href.includes('/export/gpx')));
    }

    function addGenericButtonIfPossible() {
        if (document.querySelector('.meteoride-export-btn.global.generic')) return;
        if (document.querySelector('.meteoride-export-btn.global.komoot') || document.querySelector('.meteoride-export-btn.global.bikemap')) return; // site-specific already
        if (!hasAnyDirectGpxLink()) return;
        addButton('Open route in MeteoRide', () => {
            d('Generic button clicked');
            const any = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.match(/\.gpx(\?|$)/i) || a.href.includes('/export/gpx')));
            if (!any) { alert('No GPX link found on this page'); removeGenericIfInvalid(); return; }
            fetchAsText(any.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else { alert('Could not fetch GPX'); removeGenericIfInvalid(); } });
        }, 'generic');
    }

    function removeGenericIfInvalid() {
        const btn = document.querySelector('.meteoride-export-btn.global.generic');
        if (btn && !hasAnyDirectGpxLink()) btn.remove();
    }

    function refreshButtons() {
        // Remove all existing buttons first to handle page changes
        document.querySelectorAll('.meteoride-export-btn.global').forEach(btn => btn.remove());

        const hadKomoot = tryKomoot();
        const hadBikemap = tryBikemap();
        const hadHammerhead = tryHammerhead();
        if (!hadKomoot && !hadBikemap && !hadHammerhead) {
            addGenericButtonIfPossible();
        }
    }

    function init() {
        d('init start');
        refreshButtons();

        // Watch for dynamic content that may inject GPX links (single global observer)
    const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (!m.addedNodes) continue;
                for (const node of m.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.querySelector && node.querySelector('a[href$=".gpx"], a[href*="/export/gpx"]')) {
                        d('Mutation found potential GPX link');
                        addGenericButtonIfPossible();
                    }
                }
            }
            removeGenericIfInvalid();
        });
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA route changes (Komoot uses client-side navigation)
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    function onNav() { d('SPA nav', location.pathname); setTimeout(() => { refreshButtons(); }, 400); }
    history.pushState = function() { pushState.apply(this, arguments); onNav(); };
    history.replaceState = function() { replaceState.apply(this, arguments); onNav(); };
    window.addEventListener('popstate', onNav);
    }

    // Run after DOM ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 500); else document.addEventListener('DOMContentLoaded', init);
})();
