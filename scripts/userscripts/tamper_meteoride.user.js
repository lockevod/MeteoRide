// ==UserScript==
// @name         MeteoRide Quick Export
// @namespace    https://meteoride.local/
// @version      0.1
// @description  Add a button on Komoot and Bikemap to open the current route in MeteoRide (downloads GPX and sends via postMessage)
// @author       MeteoRide
// @match        *://*.komoot.*/*
// @match        *://*.bikemap.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function() {
    'use strict';

    // URL of your MeteoRide app; change if testing locally
    const METEORIDE_URL = (location.hostname.includes('localhost') || location.hostname.includes('127.0.0.1')) ? 'http://localhost:8000/' : 'https://app.meteoride.cc/';

    function postToMeteoRide(gpxText, name) {
        // Open MeteoRide in a new tab and post message once loaded
        const w = window.open(METEORIDE_URL, '_blank');
        if (!w) return;
        // try to post after the new tab loads
        const tryPost = () => {
            try {
                w.postMessage({ action: 'loadGPX', gpx: gpxText, name: name }, new URL(METEORIDE_URL).origin);
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
        // Use GM_xmlhttpRequest if available for cross-origin
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({ method: 'GET', url: url, onload: function(res) { cb(res.responseText); }, onerror: function(){ cb(null); } });
            return;
        }
        fetch(url).then(r => r.text()).then(t => cb(t)).catch(() => cb(null));
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
        return btn;
    }

    function tryKomoot() {
        // Komoot has a share button that may provide GPX URL in the DOM or via API
        // Look for links with ".gpx" in href
        const link = Array.from(document.querySelectorAll('a')).find(a => a.href && a.href.endsWith('.gpx'));
        if (link) {
            addButton('Open in MeteoRide', () => {
                fetchAsText(link.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else alert('Could not fetch GPX'); });
            });
            return true;
        }
        // Fallback: check for share dialog data attributes
        return false;
    }

    function tryBikemap() {
        // Bikemap often has a download link with "export/gpx" in href
        const link = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.includes('/export/gpx') || a.href.endsWith('.gpx')));
        if (link) {
            addButton('Open in MeteoRide', () => {
                fetchAsText(link.href, (txt) => { if (txt) postToMeteoRide(txt, 'route.gpx'); else alert('Could not fetch GPX'); });
            });
            return true;
        }
        return false;
    }

    function init() {
        // try site-specific helpers
        tryKomoot();
        tryBikemap();
        // Generic global button that will attempt to find any GPX link on the page
        addButton('Open route in MeteoRide', () => {
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
    }

    // Run after DOM ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 500); else document.addEventListener('DOMContentLoaded', init);
})();
