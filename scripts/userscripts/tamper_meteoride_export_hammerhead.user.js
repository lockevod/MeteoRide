// ==UserScript==
// @name         MeteoRide ➜ Hammerhead Export (GPX Import)
// @namespace    https://app.meteoride.cc/
// @version      0.10
// @description  Export current GPX desde MeteoRide a Hammerhead usando siempre /v1/users/{userId}/routes/import/url (userId detectado automáticamente).
// @author       lockevod
// @license       MIT
// @homepageURL  https://app.meteoride.cc/
// @source       https://github.com/lockevod/meteoride
// @supportURL   https://github.com/lockevod/meteoride/issues
// @downloadURL  https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js
// @updateURL    https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js
// @installURL   https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js
// @icon         https://app.meteoride.cc/icon-192.png
// @match        https://app.meteoride.cc/*
// @match        https://dashboard.hammerhead.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

// Install (one-click - raw): https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js

/*
 MODO ÚNICO SOPORTADO
  * meteoride_share_server: Se genera una URL temporal mediante tu share-server y Hammerhead la ingiere con el endpoint fijo import/url.
  * userId siempre se detecta (JWT) – no se configura manualmente.

 SECURITY / PRIVACY
 - GPX is publicly readable at your share-server URL until first GET (if using provided share-server which deletes after serving) or until TTL expires (depending on your config). Protect or rotate if sensitive.
 - Token & userId never abandon the Hammerhead tab.

 CONFIGURACIÓN
   const CONFIG = {
     ENABLE_UI_BUTTON: true,
     BUTTON_TEXT: 'HH',
     BUTTON_TITLE: 'Export to Hammerhead',
     INJECT_BUTTON_SELECTOR: '#top-buttons, body',
     UPLOAD: {
   STRATEGY: 'meteoride_share_server', // 'meteoride_share_server' | 'custom'
       SHARE_SERVER_BASE: 'https://gpx.yourdomain.tld',
       CUSTOM: async (file) => { throw new Error('Implementa tu uploader y devuelve URL https'); }
     }
   };

 REQUIREMENTS
 - MeteoRide page must have window.lastGPXFile (File or Blob) present.
 - At least one Hammerhead dashboard tab (https://dashboard.hammerhead.io/) must be open (same browser profile) for automatic token discovery.
 - If no HH tab is open, you can open one and click export again.
*/

(function() {
  'use strict';

  const CONFIG = {
    ENABLE_UI_BUTTON: true,
    BUTTON_TEXT: 'HH',
    BUTTON_TITLE: 'Export to Hammerhead',
    INJECT_BUTTON_SELECTOR: '#top-buttons, body',
  // Poll interval (ms) used to wait for a route to appear/disappear. Default 10000
    POLL_INTERVAL_MS: 10000,
  // How long to wait (ms) before attempting to open/focus a Hammerhead tab (shorter = faster UX)
  HH_OPEN_DELAY_MS: 300,
  // Name for the Hammerhead window so window.open reuses/focuses the same tab instead of creating new ones
  HH_WINDOW_NAME: 'meteoride_hh_import',
  // When a Hammerhead tab receives an import request but the user is not logged in,
  // the script will poll for auth for up to this time before giving up.
  // Increased default to 2 minutes to give users more time to complete interactive login.
  AUTH_WAIT_MS: 120000,
  // Poll interval (ms) while waiting for auth in Hammerhead tab
  AUTH_POLL_INTERVAL_MS: 1000,
    UPLOAD: {
      STRATEGY: 'meteoride_share_server',
      // Default to the local share-server port used in this repo (change to your public host in prod)
      //SHARE_SERVER_BASE: 'http://127.0.0.1:8081',
      // If true, the share-server will delete the file after the first successful serve
      // by appending ?once=1 to the shared URL before sending it to Hammerhead.
      DELETE_AFTER_IMPORT: true,
      SHARE_SERVER_BASE: 'https://app.meteoride.cc',
      // If true, the userscript will append ?once=1 to the shared URL so the server
      // can remove the entry after that single GET. Configure at the top of the script.
      USE_ONCE_PARAM: false,
      CUSTOM: async (file) => { throw new Error('Uploader custom no implementado'); }
    },
    DEBUG: false,
    POSTMESSAGE_NAMESPACE: 'mr:hh',
    EXPORT_TIMEOUT_MS: 30000
  ,PAUSE_BEFORE_IMPORT: true
  // New: explicit toggle + message for the pre-import confirmation shown to the user.
  // Set to false to skip the "wait/confirm" dialog before requesting Hammerhead import.
  ,PRE_IMPORT_PROMPT_ENABLED: false
  ,PRE_IMPORT_PROMPT_MESSAGE: 'GPX generated locally. Press OK to continue and request Hammerhead import, or Cancel to stop.'
  };

  const HAMMERHEAD_ORIGIN = 'https://dashboard.hammerhead.io';

  const MRHH = {
    log: (...a)=>{ if(CONFIG.DEBUG) console.log('[MR→HH]', ...a); },
    err: (...a)=>{ console.warn('[MR→HH]', ...a); },
    info: (...a)=>{ console.info('[MR→HH]', ...a); },
    dbg: (...a)=>{ console.debug('[MR→HH]', ...a); }
  };

  // Small in-page notice helpers shown in Hammerhead tab while polling for login
  function createNoticeEl(){
    try{
      const id = 'mrhh-notice';
      let el = document.getElementById(id);
      if(el) return el;
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, { position:'fixed', right:'12px', top:'12px', zIndex: 2147483647, background:'#111', color:'#fff', padding:'8px 12px', borderRadius:'6px', fontSize:'13px', opacity:'0.95', boxShadow:'0 2px 8px rgba(0,0,0,0.3)' });
      document.body.appendChild(el);
      return el;
    }catch(e){ return null; }
  }
  function showNotice(msg){ try{ const el = createNoticeEl(); if(el) el.textContent = msg; }catch(_){} }
  function updateNotice(msg){ try{ const el = document.getElementById('mrhh-notice'); if(el) el.textContent = msg; }catch(_){} }
  function removeNotice(){ try{ const el = document.getElementById('mrhh-notice'); if(el) el.remove(); }catch(_){} }

  // Compare origins but treat 127.0.0.1 and localhost (and ::1) as equivalent for local testing
  function sameOriginLoose(aUrl, bUrl){
    try{
      const a = new URL(aUrl);
      const b = new URL(bUrl);
      const normalize = (u)=>{
        let host = u.hostname;
        if(host === '127.0.0.1' || host === '::1') host = 'localhost';
        return `${host}:${u.port||('http'===u.protocol.replace(':','')? '80':'')}`;
      };
      return normalize(a) === normalize(b) && a.protocol === b.protocol;
    } catch(e){ return false; }
  }

  // Sanitize large or sensitive claim values for logging
  function sanitizeClaims(claims){
    if(!claims || typeof claims !== 'object') return claims;
    const out = {};
    for(const k of Object.keys(claims)){
      try{
        const v = claims[k];
        if(v == null) { out[k] = v; continue; }
        const s = String(v);
        if(s.length > 60) out[k] = s.slice(0,20) + '…' + s.slice(-20);
        else out[k] = s;
      } catch(_){ out[k] = '[unserializable]'; }
    }
    return out;
  }

  // Escape XML special chars for safe insertion into GPX
  function escapeXml(s){
    if(s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  // -------------------------------------------------------------
  // Environment Detection (MeteoRide vs Hammerhead)
  // -------------------------------------------------------------
  function isHammerhead(){ return location.origin === HAMMERHEAD_ORIGIN; }
  function isMeteoRide(){
    // Heuristic: presence of window.lastGPXFile OR meteoride branding
    return !!window.lastGPXFile || document.title.toLowerCase().includes('meteoride');
  }

  // -------------------------------------------------------------
  // Public Upload Implementations
  // -------------------------------------------------------------
  // Robust upload to share-server: try multipart POST, fall back to raw GPX POST,
  // and try multiple heuristics to resolve the shared URL from JSON, Location,
  // HTML body or by constructing /shared/<filename>.
  async function uploadViaShareServer(file){
    const shareServerUrl = (CONFIG.UPLOAD && CONFIG.UPLOAD.SHARE_SERVER_BASE) || 'http://127.0.0.1:8081';
    MRHH.info('uploadViaShareServer: subiendo a share-server en', shareServerUrl);

    // Obtain GPX text and filename
    let gpxText = '';
    let filename = 'route.gpx';
    if(file instanceof File || file instanceof Blob){
      gpxText = await file.text();
      if(file.name) filename = file.name;
      // Ensure GPX contains a <name> element with the route name if available in the UI
      try{
        const rnEl = document.getElementById('rutaName');
        const routeName = rnEl && rnEl.textContent ? rnEl.textContent.trim() : '';
        if(routeName && /<gpx[\s\S]*?>/i.test(gpxText)){
          // Insert/update both <metadata><name> and the first <trk><name> when possible.
          // 1) metadata.name: replace if exists, else insert metadata block with name.
          if(/<metadata[\s\S]*?<name[\s\S]*?>[\s\S]*?<\/name>/i.test(gpxText)){
            gpxText = gpxText.replace(/(<metadata[\s\S]*?<name[\s\S]*?>)[\s\S]*?(<\/name>)/i, `$1${escapeXml(routeName)}$2`);
          } else if(/<metadata[\s\S]*?>/i.test(gpxText)){
            gpxText = gpxText.replace(/(<metadata[\s\S]*?>)/i, `$1\n  <name>${escapeXml(routeName)}<\/name>`);
          } else if(/<gpx[\s\S]*?>/i.test(gpxText)){
            // insert minimal metadata block after opening <gpx>
            gpxText = gpxText.replace(/(<gpx[\s\S]*?>)/i, `$1\n  <metadata>\n    <name>${escapeXml(routeName)}<\/name>\n  <\/metadata>`);
          }

          // 2) trk.name: replace the first occurrence if present, else insert inside first <trk> element
          if(/<trk[\s\S]*?<name[\s\S]*?>[\s\S]*?<\/name>/i.test(gpxText)){
            gpxText = gpxText.replace(/(<trk[\s\S]*?<name[\s\S]*?>)[\s\S]*?(<\/name>)/i, `$1${escapeXml(routeName)}$2`);
          } else if(/<trk[\s\S]*?>/i.test(gpxText)){
            // insert <name> immediately after opening <trk>
            gpxText = gpxText.replace(/(<trk[\s\S]*?>)/i, `$1\n    <name>${escapeXml(routeName)}<\/name>`);
          }

          // 3) rte.name: if GPX uses routes (<rte>), prefer to set the route name there as well
          if(/<rte[\s\S]*?<name[\s\S]*?>[\s\S]*?<\/name>/i.test(gpxText)){
            gpxText = gpxText.replace(/(<rte[\s\S]*?<name[\s\S]*?>)[\s\S]*?(<\/name>)/i, `$1${escapeXml(routeName)}$2`);
          } else if(/<rte[\s\S]*?>/i.test(gpxText)){
            // insert <name> immediately after opening <rte>
            gpxText = gpxText.replace(/(<rte[\s\S]*?>)/i, `$1\n    <name>${escapeXml(routeName)}<\/name>`);
          }
        }
      }catch(_){ /* ignore injection errors */ }
    } else if(file && file._text){
      gpxText = file._text;
      if(file.name) filename = file.name;
    } else if(typeof file === 'string'){
      gpxText = file;
    } else {
      throw new Error('Formato de archivo no soportado');
    }
    if(!gpxText || !gpxText.includes('<gpx')) throw new Error('El contenido no parece ser un GPX válido');

    // Prefer UI-derived name if present
    try{
      const rnEl = document.getElementById('rutaName');
      let routeName = rnEl && rnEl.textContent ? rnEl.textContent.trim() : '';
      if(routeName){ routeName = routeName.replace(/[^A-Za-z0-9._-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''); if(!/\.gpx$/i.test(routeName)) routeName += '.gpx'; filename = routeName; }
    }catch(_){ }

    MRHH.info('uploadViaShareServer: subiendo archivo', filename, 'tamaño:', gpxText.length);

    const buildFallbackUrl = (name) => `${shareServerUrl.replace(/\/$/,'')}/shared/${encodeURIComponent(name)}`;

    async function parseResponse(resp){
      // Try Location header first (redirects)
      const loc = resp.headers && resp.headers.get && resp.headers.get('Location') || resp.headers && resp.headers.get && resp.headers.get('location');
      if(loc){
        try{ const u = new URL(loc, shareServerUrl); return u.href; } catch(_){ return (shareServerUrl.replace(/\/$/,'') + '/' + loc.replace(/^\//,'')); }
      }
      const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
      const txt = await resp.text().catch(()=> '');
      // If JSON, parse and prefer absolute url fields
      try{ const j = JSON.parse(txt); if(j){ if(j.url) return j.url; if(j.sharedUrl) return shareServerUrl.replace(/\/$/,'') + j.sharedUrl; if(j.path) return shareServerUrl.replace(/\/$/,'') + j.path; } } catch(_){ }
      // If body contains explicit absolute shared href or /shared/ fragment, pick it
      const m = txt.match(/https?:\/\/[^"'<>\s]*\/shared\/[A-Za-z0-9_\-\.]+(?:\.gpx)?/i);
      if(m && m[0]) return m[0];
      const m2 = txt.match(/\/shared\/[A-Za-z0-9_\-\.]+(?:\.gpx)?/i);
      if(m2 && m2[0]) return shareServerUrl.replace(/\/$/,'') + m2[0];
      // If page contains redirect string pointing to /shared/..., try to extract
      const m3 = txt.match(/Location:\s*(\/shared\/[A-Za-z0-9_\-\.]+(?:\.gpx)?)/i) || txt.match(/Redirecting to (\/shared\/[A-Za-z0-9_\-\.]+(?:\.gpx)?)/i);
      if(m3 && m3[1]) return shareServerUrl.replace(/\/$/,'') + m3[1];
      // Last resort: construct by filename
      return buildFallbackUrl(filename);
    }

    // Try raw GPX POST first (preferred): send GPX text as body and pass X-File-Name.
    // This avoids multipart/form-data envelopes that sometimes get stored verbatim.
    try{
      const rawUrlNoFollow = shareServerUrl.replace(/\/$/,'') + '/share';
      MRHH.dbg('uploadViaShareServer: attempting RAW POST (no follow) to', rawUrlNoFollow);
      const respRaw = await fetch(rawUrlNoFollow, { method:'POST', body: gpxText, mode:'cors', credentials:'omit', headers: { 'Content-Type':'application/gpx+xml', 'X-File-Name': filename } });
      if(!respRaw) throw new Error('No response');
      MRHH.dbg('uploadViaShareServer: raw POST status', respRaw.status, 'ct=', respRaw.headers && respRaw.headers.get && respRaw.headers.get('content-type'));
      if(respRaw.status === 201){
        const txt = await respRaw.text().catch(()=> '');
        try{ const j = JSON.parse(txt); if(j && (j.url || j.sharedUrl || j.path)){ const final = j.url || (shareServerUrl.replace(/\/$/,'') + (j.sharedUrl || j.path)); MRHH.info('uploadViaShareServer: raw returned JSON 201, final URL:', final); return final; } } catch(e){ MRHH.dbg('uploadViaShareServer: 201 but JSON parse failed', e); }
      }
      try{ const resolved = await parseResponse(respRaw); if(resolved) { MRHH.info('uploadViaShareServer: resolved URL (raw/no-follow):', resolved); return resolved; } } catch(err){ MRHH.dbg('raw parse failed', err); }
      MRHH.dbg('uploadViaShareServer: raw no-follow did not yield usable URL, falling back to multipart');
    } catch(e){ MRHH.dbg('raw upload (no-follow) failed, will retry multipart/follow', e && e.message ? e.message : e); }

    // Fallback: POST raw GPX body (some proxies/servers prefer raw)
    try{
      // Raw POST fallback also requests follow=1 so fetch will land on final resource
      const rawUrl = shareServerUrl.replace(/\/$/,'') + '/share?follow=1';
      const resp2 = await fetch(rawUrl, { method:'POST', body: gpxText, mode:'cors', credentials:'omit', headers: { 'Content-Type': 'application/gpx+xml', 'X-Follow-Redirect': '1' } });
      if(resp2 && resp2.url && /\/shared\//.test(resp2.url)){
        MRHH.info('uploadViaShareServer: response.url indicates shared resource (raw->follow):', resp2.url);
        return resp2.url;
      }
      const resolved2 = await parseResponse(resp2);
      MRHH.info('uploadViaShareServer: resolved URL (raw):', resolved2);
      return resolved2;
    } catch(err2){
      MRHH.err('uploadViaShareServer: all upload attempts failed', err2 && err2.message ? err2.message : err2);
      throw new Error('Error subiendo a share-server: ' + (err2 && err2.message ? err2.message : String(err2)));
    }
  }
   
  // Try to resolve an index-like URL to a direct GPX/shared URL.
  async function resolveToGpx(url, base){
    try{
      if(/\.gpx(\?|$)/i.test(url)) return url;
      // HEAD to inspect content-type
  const h = await fetch(url, { method:'HEAD', mode:'cors', credentials:'omit', referrer: base, referrerPolicy: 'origin' });
      const ct = (h && h.headers && h.headers.get('content-type')) || '';
      if(/gpx/i.test(ct)) return url;
      // If HTML, GET and try to find shared id or /shared/ path
  const txt = await fetch(url, { method:'GET', mode:'cors', credentials:'omit', referrer: base, referrerPolicy: 'origin' }).then(r=>r.text()).catch(()=> '');
      // Look for explicit /shared/{name} occurrences in HTML (prefer ones that include .gpx)
      let m = txt.match(/\/shared\/([A-Za-z0-9\-_.]+(?:\.gpx)?)/i);
      if(m && m[1]){
        const name = m[1];
        if(/\.gpx$/i.test(name)) return base.replace(/\/$/,'') + '/shared/' + name;
        return base.replace(/\/$/,'') + '/shared/' + name + '.gpx';
      }
      // Look for anchors that may point to the shared file (absolute or relative)
      let ma = txt.match(/<a[^>]+href=["']([^"']*\/shared\/[^"']+)["']/i);
      if(ma && ma[1]){
        try{
          const link = ma[1];
          if(/^https?:\/\//i.test(link)) return link;
          // relative -> join with origin of the fetched page (use url's origin)
          const origin = (new URL(url)).origin;
          return origin.replace(/\/$/,'') + (link.startsWith('/') ? link : '/' + link);
        }catch(_){ /* ignore and continue */ }
      }
      // Look for meta refresh or JS redirect patterns that include a /shared/ target
      let mm = txt.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?[^"']*url=([^"'>\s]+)/i);
      if(mm && mm[1]){
        const candidate = mm[1];
        if(/^https?:\/\//i.test(candidate)) return candidate;
        try{ const origin = (new URL(url)).origin; return origin.replace(/\/$/,'') + (candidate.startsWith('/') ? candidate : '/' + candidate); }catch(_){ }
      }
      let mloc = txt.match(/window\.location(?:\.href)?\s*=\s*["']([^"']*\/shared\/[^"']+)["']/i);
      if(mloc && mloc[1]){
        const candidate = mloc[1];
        if(/^https?:\/\//i.test(candidate)) return candidate;
        try{ const origin = (new URL(url)).origin; return origin.replace(/\/$/,'') + (candidate.startsWith('/') ? candidate : '/' + candidate); }catch(_){ }
      }
      // Do not infer shared URLs from query parameters like ?shared=1 — these are ambiguous and often indicate a redirect to an index page.
  // Removed inference from generic query params (?shared=1) to avoid creating bogus /shared/<id>.gpx.
  // If a future explicit param is needed (e.g. shared_id), introduce a strict pattern here.
    } catch(e){ /* ignore */ }
    return url;
  }

  async function uploadPublic(file){
    if(CONFIG.UPLOAD.STRATEGY === 'meteoride_share_server') return uploadViaShareServer(file);
    if(CONFIG.UPLOAD.STRATEGY === 'custom') return CONFIG.UPLOAD.CUSTOM(file);
    throw new Error('Estrategia de subida desconocida');
  }

  // Validate that a public URL points to a GPX resource and normalize to .gpx URL when possible
  async function validateGpxUrl(url){
    try{
      // quick check
      if(/\.gpx(\?|$)/i.test(url)) return { ok:true, url };
      // HEAD
      const h = await fetch(url, { method:'HEAD', mode:'cors', credentials:'same-origin' });
      const ct = h && h.headers && h.headers.get && h.headers.get('content-type') || '';
      if(/gpx/i.test(ct)) return { ok:true, url };
      // If server reports HTML or text, fetch body and inspect for real GPX content and not multipart boundaries
      if(/html|text/i.test(ct) || !ct){
        const txt = await fetch(url, { method:'GET', mode:'cors', credentials:'same-origin' }).then(r=>r.text()).catch(()=> '');
        // If body contains multipart markers, it's likely the server returned the upload envelope, reject.
        if(/WebKitFormBoundary|Content-Disposition: form-data|multipart\//i.test(txt)){
          MRHH.err('validateGpxUrl: detected multipart-like response body, rejecting');
          return { ok:false };
        }
        // basic GPX detection
        if(/<gpx[\s>]/i.test(txt) || /<\?xml[\s\S]{0,200}<gpx/i.test(txt)) return { ok:true, url };
      }
      // GET and try to resolve via resolveToGpx as a last resort
      const resolved = await resolveToGpx(url, (new URL(url)).origin);
  if(resolved && /\.gpx(\?|$)/i.test(resolved)) return { ok:true, url: resolved };
      return { ok:false };
    } catch(e){ return { ok:false }; }
  }

  // -------------------------------------------------------------
  // MeteoRide Side: Button + Send Request
  // -------------------------------------------------------------
  function injectButton(){
    if(!CONFIG.ENABLE_UI_BUTTON) return;
    if(!isMeteoRide()) return;
    if(document.getElementById('mr-hh-export-btn')) return;

    // Helper: detect if we have a route available
    function hasRoute(){
      try{
        if(window.lastGPXFile) return true;
        if(window.trackLayer && typeof window.trackLayer.toGeoJSON === 'function'){
          const gj = window.trackLayer.toGeoJSON(); if(gj && gj.features && gj.features.length) return true;
        }
        if(window.cw && typeof window.cw.getSteps === 'function'){
          const s = window.cw.getSteps() || []; if(s.length >= 2) return true;
        }
      }catch(e){}
      return false;
    }

    // Create and insert the button (keeps previous insertion logic), and return the created element
    function createAndInsertButton(){
      // Try multiple selectors then fallback to floating button
      const candidates = (CONFIG.INJECT_BUTTON_SELECTOR || '').split(',').map(s=>s.trim()).concat([
        '#top-buttons', '.top-buttons', '#buttons', '.header-actions', '#appHeader', '#appTitle', '.app-logo', 'header', 'body'
      ]);
      let container = null;
      for(const sel of candidates){ try { const found = document.querySelector(sel); if(found){ container = found; break; } } catch(e){}
      }

      const btn = document.createElement('button');
      btn.id = 'mr-hh-export-btn';
      btn.textContent = CONFIG.BUTTON_TEXT;
      btn.title = CONFIG.BUTTON_TITLE;
      Object.assign(btn.style, { cursor:'pointer', padding:'4px 8px', margin:'4px', fontSize:'13px', lineHeight:'16px'});
      btn.addEventListener('click', onExportClick);
      if(container && container !== document.body){
        try { container.appendChild(btn); MRHH.info('Inserted HH export button into', container.tagName || container.className || container.id); }
          catch(e){ MRHH.dbg('append failed', e); addFloatingButton(btn); }
      } else {
        addFloatingButton(btn);
      }

      // Monitor the route; if it disappears remove the button and start waiting again
  const monitorInterval = setInterval(()=>{
        try{
          if(!hasRoute()){
            const existing = document.getElementById('mr-hh-export-btn');
            if(existing){ existing.remove(); MRHH.info('Route gone — HH button hidden'); }
            clearInterval(monitorInterval);
            // restart waiting loop to re-insert when route returns
            startWaiting();
          }
        }catch(e){ clearInterval(monitorInterval); }
  }, CONFIG.POLL_INTERVAL_MS);

      return btn;
    }

    // Waiting loop: poll for route and insert button when found
    function startWaiting(){
      if(document.getElementById('mr-hh-export-btn')) return;
      if(hasRoute()){ createAndInsertButton(); return; }
      MRHH.info('HH export button deferred until a route is available (waiting indefinitely)');
  const t = setInterval(()=>{
        try{
          if(document.getElementById('mr-hh-export-btn')){ clearInterval(t); return; }
          if(hasRoute()){
            clearInterval(t); createAndInsertButton(); return;
          }
        }catch(e){ clearInterval(t); }
  }, CONFIG.POLL_INTERVAL_MS);
    }

    // Start the initial waiting
    startWaiting();
  }

  function addFloatingButton(btn){
    try{
      Object.assign(btn.style, { position:'fixed', right:'12px', bottom:'12px', zIndex: 999999, borderRadius:'6px', boxShadow:'0 2px 6px rgba(0,0,0,0.25)'});
  document.body.appendChild(btn);
  MRHH.info('Inserted floating HH export button');
  } catch(e){ MRHH.err('Could not insert floating button', e); }
  }

  // Delegate GPX generation to the page's API when available
  function buildFreshGpxFile(){
    if (window.cw && typeof window.cw.exportRouteToGpx === 'function'){
      const g = window.cw.exportRouteToGpx('route.gpx', true);
      if (g) {
        MRHH.info('GPX generado via window.cw.exportRouteToGpx, assigned to window.lastGPXFile (length=', (g && g.length) || 0, ')');
        return window.lastGPXFile;
      }
      MRHH.info('window.cw.exportRouteToGpx returned no data');
      return null;
    }
    throw new Error('API no disponible: window.cw.exportRouteToGpx');
  }

  async function onExportClick(){
    try {
      const btn = this;
      btn.disabled = true; 
      const orig = btn.textContent; 
      btn.textContent = '…';
      MRHH.info('Export button clicked');
      
      // Generar GPX exactamente como hace el botón "Generar GPX" - SIN UPLOAD
      let file;
      try {
        file = buildFreshGpxFile();
      } catch(e){ 
        throw new Error('No se pudo generar GPX: '+e.message); 
      }
      if(!file) throw new Error('GPX generation failed');
      MRHH.info('GPX generado localmente, size=', file.size || (file._text && file._text.length) || 'unknown');
      
      // Primero guardamos el GPX en el share-server para que esté disponible
      MRHH.log('Guardando GPX en share-server para que esté accesible...');
      const shareResponse = await uploadPublic(file);
      MRHH.info('GPX guardado en share-server:', shareResponse);
      
      // Construir URL directamente basada en el nombre del archivo generado
      let filename = 'route.gpx';
      if(file && file.name) {
        filename = file.name;
      } else {
        // Derivar nombre del UI si está disponible
        try {
          const rnEl = document.getElementById('rutaName');
          let routeName = rnEl && rnEl.textContent ? rnEl.textContent.trim() : '';
          if(routeName){
            routeName = routeName.replace(/[^A-Za-z0-9._-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
            if(!/\.gpx$/i.test(routeName)) routeName += '.gpx';
            filename = routeName;
          }
        } catch(_){ }
      }
      
      // Usar la URL del share-server o construir URL basada en shared_id
      let publicUrl;
      if(shareResponse && shareResponse.includes('/shared/')){
        // Si el share-server nos devolvió una URL directa, usarla
        publicUrl = shareResponse;
      } else {
        // Construir URL usando el share-server base si está configurado (apunta a /shared/<filename>),
        // sino usar el origen actual, y como último recurso fallback a localhost para compatibilidad local.
        // Must use configured share server base; do not guess localhost. Fail fast if not configured.
        const shareBase = (CONFIG.UPLOAD && CONFIG.UPLOAD.SHARE_SERVER_BASE);
        if(!shareBase){
          throw new Error('CONFIG.UPLOAD.SHARE_SERVER_BASE no configurado — no puedo construir publicUrl');
        }
        publicUrl = shareBase.replace(/\/$/, '') + '/shared/' + encodeURIComponent(filename);
      }
      
      MRHH.info('GPX URL para Hammerhead:', publicUrl);

      // If configured, append ?once=1 so the share-server will delete after first GET
      if(CONFIG.UPLOAD && CONFIG.UPLOAD.USE_ONCE_PARAM){
        try{
          const u = new URL(publicUrl);
          u.searchParams.set('once','1');
          publicUrl = u.href;
          MRHH.info('Using once=1 param, publicUrl now:', publicUrl);
        }catch(_){ publicUrl = publicUrl + (publicUrl.includes('?') ? '&' : '?') + 'once=1'; }
      }
      
      // Optional pause: let user inspect/cancel before we call Hammerhead
      if(CONFIG.PAUSE_BEFORE_IMPORT && CONFIG.PRE_IMPORT_PROMPT_ENABLED){
        try{
          const ok = confirm(CONFIG.PRE_IMPORT_PROMPT_MESSAGE + '\n\nURL: ' + publicUrl);
          if(!ok){ 
            MRHH.info('User cancelled before Hammerhead import'); 
            alert('Export cancelled by user');
            return;
          }
        } catch(_){ }
      }

      MRHH.log('Requesting Hammerhead import for URL');
      const outcome = await requestImportInHammerhead(publicUrl);
      MRHH.info('Hammerhead import result', outcome);
      // User-friendly messages: show success/failure in plain English.
      try{
        if(outcome && outcome.ok){
          alert('Hammerhead import succeeded. The route should appear in your Hammerhead dashboard shortly.');
        } else {
          const reason = outcome && outcome.message ? (String(outcome.message).slice(0,300)) : (outcome && outcome.statusText ? outcome.statusText : 'Unknown error');
          alert('Hammerhead import failed: ' + reason);
        }
      } catch(e){
        alert('Hammerhead import completed. Check the console for details.');
      }
      
    } catch(e){
      alert('Error export HH: '+e.message);
      MRHH.err(e.message || e);
    } finally {
      const btn = document.getElementById('mr-hh-export-btn');
      if(btn){ btn.disabled = false; btn.textContent = CONFIG.BUTTON_TEXT; }
    }
  }

  function requestImportInHammerhead(publicUrl){
    return new Promise((resolve, reject)=>{
      const channel = CONFIG.POSTMESSAGE_NAMESPACE;
      const reqId = 'exp_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      let finished = false;
      function cleanup(){ window.removeEventListener('message', onMessage); finished = true; }
      function onMessage(ev){
        if(ev.origin !== HAMMERHEAD_ORIGIN) return;
        const d = ev.data;
        if(!d || d.channel !== channel || d.type !== 'hh-import-result' || d.reqId !== reqId) return;
        cleanup();
        resolve(d.payload);
      }
      window.addEventListener('message', onMessage);
      // Initial broadcast (Hammerhead tab(s) will answer)
  MRHH.info('Broadcasting import request to Hammerhead tabs (postMessage)');
  window.postMessage({ channel, type:'hh-import-request', reqId, publicUrl }, '*');

      // Validate the publicUrl actually points to a GPX file before proceeding
      (async ()=>{
        try{
          MRHH.info('Validating public URL before Hammerhead import', publicUrl);
          const good = await validateGpxUrl(publicUrl);
          if(!good || !good.url){
            cleanup();
            reject(new Error('Public URL does not point to a valid GPX: '+publicUrl));
          } else {
            // overwrite publicUrl with resolved/normalized URL
            publicUrl = good.url;
            MRHH.info('Validated public GPX URL =', publicUrl);
          }
        } catch(err){ cleanup(); reject(err); }
      })();

      const totalTimeout = CONFIG.EXPORT_TIMEOUT_MS || 30000;
      const firstPhase = Math.max(2000, Math.floor(totalTimeout/3));
      const secondPhase = totalTimeout - firstPhase;

      // Phase 1: wait a short while for an existing HH tab to answer
      const t1 = setTimeout(()=>{
        if(finished) return;
        MRHH.info('No response from existing Hammerhead tabs; attempting to open/focus a Hammerhead tab to complete the import');
        try{
          // user gesture already present (click) so window.open should be allowed
          // Use a fixed window name so subsequent opens reuse/focus the same tab instead of creating new ones
          const params = new URLSearchParams({ mr_hh_import: publicUrl, mr_reqId: reqId });
          const url = HAMMERHEAD_ORIGIN + '/?' + params.toString();
          // Use configured window name and a minimal delay before open to speed up UX
          const win = window.open(url, CONFIG.HH_WINDOW_NAME || '_blank');
          if(win) {
            MRHH.info('Opened or focused Hammerhead window (name=', CONFIG.HH_WINDOW_NAME || '(default)', ')');
            try{
              // If we obtained a window reference, postMessage directly to that window (works cross-origin)
              if(typeof win.postMessage === 'function'){
                win.postMessage({ channel, type:'hh-import-request', reqId, publicUrl }, HAMMERHEAD_ORIGIN);
                MRHH.info('Posted import request directly to opened Hammerhead window via win.postMessage');
              }
            }catch(e){ MRHH.dbg('win.postMessage failed', e); }
          } else MRHH.info('Could not open Hammerhead tab automatically');
        } catch(e){ MRHH.dbg('window.open failed', e); }
        // If we couldn't post directly to the opened window, fall back to broadcasting on this origin
        try{ window.postMessage({ channel, type:'hh-import-request', reqId, publicUrl }, '*'); } catch(_){ }
        // Phase 2: final wait
        const t2 = setTimeout(()=>{
          if(finished) return;
          cleanup();
          reject(new Error('Timeout waiting Hammerhead tab'));
        }, secondPhase);
      }, Math.max(100, CONFIG.HH_OPEN_DELAY_MS || 300));

    });
  }


  // -------------------------------------------------------------
  // Hammerhead Side: Listen, obtain token+userId, call API
  // -------------------------------------------------------------
  async function handleHammerheadImportRequest(ev){
    const { data } = ev;
    if(!data || data.channel !== CONFIG.POSTMESSAGE_NAMESPACE || data.type !== 'hh-import-request') return;
    const { reqId, publicUrl } = data;
    MRHH.info('HH tab received import request for URL', publicUrl);
    try {
  const { token, userId } = await discoverAuth();
  try{ const claims = decodeJwt(token); MRHH.dbg('handleHammerheadImportRequest: token claims', sanitizeClaims(claims)); } catch(_){}
    try{ const masked = (token && token.length>10) ? (token.slice(0,8)+'…'+token.slice(-8)) : token; MRHH.dbg('handleHammerheadImportRequest: tokenMasked', masked); } catch(_){}
      if(!token) throw new Error('Bearer token not found');
      if(!userId) throw new Error('userId not resolved');
  MRHH.info('Detected userId=', userId, 'tokenPresent=', !!token);
      const endpoint = `${HAMMERHEAD_ORIGIN}/v1/users/${encodeURIComponent(userId)}/routes/import/url`;
      const body = JSON.stringify({ url: publicUrl });
  MRHH.dbg('POST', endpoint, body.slice(0,120));
      // Build headers similar to a real browser request (some headers are controlled by browser)
      const hhHeaders = {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Authorization': 'Bearer ' + token,
        'DNT': '1',
        'Accept-Language': (navigator.language || 'es')
      };
      try{
        // Add client hint if available (best-effort)
        if(navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)){
          hhHeaders['sec-ch-ua'] = navigator.userAgentData.brands.map(b=>`"${b.brand}";v="${b.version}"`).join(', ');
          hhHeaders['sec-ch-ua-mobile'] = navigator.userAgentData.mobile ? '?1' : '?0';
          hhHeaders['sec-ch-ua-platform'] = navigator.platform || 'macOS';
        }
      } catch(_){ }
  if(CONFIG.DEBUG){ try{ const tokenMasked = token && token.length>10 ? token.slice(0,8)+'…'+token.slice(-8) : token; const hhLog = Object.assign({}, hhHeaders); hhLog.Authorization = 'Bearer '+(tokenMasked||'(none)'); MRHH.dbg('hhHeaders (debug)', hhLog); } catch(_){}}
      // Debug: log request payload and masked headers to help troubleshooting
      try{
        const tokenMasked = (token && token.length>20) ? token.slice(0,8) + '…' + token.slice(-8) : token;
        MRHH.info('Hammerhead POST', endpoint);
        MRHH.info('Hammerhead headers (masked):', Object.assign({}, hhHeaders, { Authorization: 'Bearer '+tokenMasked }));
        MRHH.info('Hammerhead body preview:', (body && body.slice) ? body.slice(0,400) : body);
      } catch(_){ }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: hhHeaders,
        body,
        credentials: 'same-origin',
        referrer: HAMMERHEAD_ORIGIN + '/routes',
        referrerPolicy: 'origin',
        mode: 'cors'
      });
      let message = '';
      try { message = await res.text(); } catch(_){ }
      // Collect response headers into an object for easier inspection
      try{
        const rh = {};
        if(res && res.headers && typeof res.headers.forEach === 'function'){
          res.headers.forEach((v,k)=>{ rh[k]=v; });
        }
        MRHH.info('Hammerhead API status', res.status, 'ok=', res.ok);
        MRHH.info('Hammerhead response headers:', rh);
        MRHH.info('Hammerhead response (first 2000 chars):', (message||'').slice(0,2000));
        postResult(reqId, { status: res.status, ok: res.ok, message: message.slice(0,2000), headers: rh, statusText: res.statusText });
      } catch(_){
        MRHH.info('Hammerhead API status', res.status, 'ok=', res.ok);
        MRHH.info('Hammerhead response (first 2000 chars):', (message||'').slice(0,2000));
        postResult(reqId, { status: res.status, ok: res.ok, message: message.slice(0,2000), statusText: res.statusText });
      }
      // If import succeeded and user requested delete-after-import, perform DELETE on the shared URL
      try{
        if(res.ok && CONFIG.UPLOAD && CONFIG.UPLOAD.DELETE_AFTER_IMPORT){
          try{
            const su = new URL(publicUrl);
            // send DELETE to /shared/<filename>
            const parts = su.pathname.split('/');
            const filename = decodeURIComponent(parts[parts.length-1] || '');
            const delUrl = su.origin + '/shared/' + encodeURIComponent(filename);
            MRHH.info('Requesting share-server to DELETE after import:', delUrl);
            await fetch(delUrl, { method:'DELETE', mode:'cors', credentials:'omit' });
            MRHH.info('Delete request sent');
          }catch(_){ MRHH.err('Delete after import failed', _); }
        }
      }catch(_){ MRHH.err('Post-import cleanup error', _); }
    } catch(e){
  postResult(reqId, { status: 'error', message: e.message });
  MRHH.err('HH import error', e.message || e);
    }
  }

  function postResult(reqId, payload){
    window.postMessage({ channel: CONFIG.POSTMESSAGE_NAMESPACE, type:'hh-import-result', reqId, payload }, '*');
  }


  async function discoverAuth(){
    // Heuristics: Look in localStorage / sessionStorage for JWT (two dots) containing 'userId' or 'sub' matching digits.
    const tokenCandidates = [];
    try {
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i); const v = localStorage.getItem(k);
        if(v && /\.[A-Za-z0-9_-]+\./.test(v) && v.length < 3000) tokenCandidates.push(v);
        if(v && /Bearer /.test(v)) tokenCandidates.push(v.replace(/^Bearer\s+/i,''));
      }
    } catch(_){ }
    try {
      for(let i=0;i<sessionStorage.length;i++){
        const k = sessionStorage.key(i); const v = sessionStorage.getItem(k);
        if(v && /\.[A-Za-z0-9_-]+\./.test(v) && v.length < 3000) tokenCandidates.push(v);
      }
    } catch(_){ }
  MRHH.info('discoverAuth: candidates scanned', tokenCandidates.length);
    // Deduplicate
    const seen = new Set();
    const unique = tokenCandidates.filter(t=>{ if(seen.has(t)) return false; seen.add(t); return true; });
    let best = null, userId = null;
    for(const tok of unique){
      const info = decodeJwt(tok);
      if(info){ try{ MRHH.dbg('discoverAuth: candidate claims', sanitizeClaims(info)); }catch(_){}}
      if(info && (info.sub || (info.context && info.context.userId))){
    best = tok; userId = (info.context && info.context.userId) || info.sub; 
    MRHH.info('discoverAuth: selected userId=', userId);
    try{ MRHH.dbg('discoverAuth: selected claims', sanitizeClaims(info)); }catch(_){ }
    break;
      }
    }
    // As fallback, separate search for userId in decoded bodies
    if(!userId){
      for(const tok of unique){
        const info = decodeJwt(tok);
        if(info){
          const guess = Object.values(info).find(v=>typeof v==='string' && /^\d{3,}$/.test(v));
          if(guess){ best = tok; userId = guess; break; }
        }
      }
    }
  return { token: best, userId };
  }

  function decodeJwt(token){
    try {
      const parts = token.split('.'); if(parts.length<2) return null;
      const payloadB64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      const json = atob(padB64(payloadB64));
      return JSON.parse(json);
    } catch(_){ return null; }
  }
  function padB64(s){ return s + '==='.slice((s.length+3)%4); }

  // -------------------------------------------------------------
  // Init per environment
  // -------------------------------------------------------------
  function init(){
    if(isMeteoRide()) injectButton();
    if(isHammerhead()){
      // Ensure the Hammerhead tab has a stable window.name so window.open can reuse/focus it
      try{
        if(CONFIG.HH_WINDOW_NAME && !window.name){
          MRHH.info('Setting window.name to', CONFIG.HH_WINDOW_NAME, 'so opener can reuse this tab');
          window.name = CONFIG.HH_WINDOW_NAME;
        }
      }catch(e){ MRHH.dbg('set window.name failed', e); }
      window.addEventListener('message', handleHammerheadImportRequest, false);
      // Automatic import via query param (fallback when opened by the MeteoRide script)
      try{
        const qs = new URLSearchParams(location.search);
        const autoUrl = qs.get('mr_hh_import');
        const autoReq = qs.get('mr_reqId') || ('exp_'+Date.now());
        if(autoUrl){
          MRHH.info('Auto import param found in HH tab, attempting import for', autoUrl);
            (async ()=>{ try{
              // Wait a short moment for page scripts / storage to settle
              await new Promise(r=>setTimeout(r, 3000));
              let { token, userId } = await discoverAuth();
              try{ const claims = decodeJwt(token); MRHH.dbg('auto-import: token claims', sanitizeClaims(claims)); } catch(_){}
              try{ const masked = (token && token.length>10) ? (token.slice(0,8)+'…'+token.slice(-8)) : token; MRHH.dbg('auto-import: tokenMasked', masked); } catch(_){}
              // If no token/userId found, poll for up to AUTH_WAIT_MS so the user can log in interactively
              if(!token || !userId){
                MRHH.info('Auto import: token/userId not found, will poll for user login for up to', CONFIG.AUTH_WAIT_MS, 'ms');
                const deadline = Date.now() + (CONFIG.AUTH_WAIT_MS || 60000);
                let polledToken = token, polledUserId = userId;
                while(Date.now() < deadline){
                  await new Promise(r=>setTimeout(r, CONFIG.AUTH_POLL_INTERVAL_MS || 1000));
                  const found = await discoverAuth();
                  if(found && found.token && found.userId){ polledToken = found.token; polledUserId = found.userId; break; }
                }
                if(!polledToken || !polledUserId){
                  const payload = { status:'error', message:'token/userId not found in hammerhead tab after wait' };
                  MRHH.info('Auto import: auth not present after wait, will notify opener if possible');
                  try{ if(window.opener && window.opener.postMessage){ window.opener.postMessage({ channel: CONFIG.POSTMESSAGE_NAMESPACE, type:'hh-import-result', reqId: autoReq, payload }, '*'); MRHH.info('Notified opener about missing auth (postMessage *).'); } else { MRHH.info('No opener present to notify.'); } } catch(errPost){ MRHH.dbg('postMessage to opener failed', errPost); }
                  return;
                }
                // use polled values
                token = polledToken; userId = polledUserId;
              }
              const endpoint = `${HAMMERHEAD_ORIGIN}/v1/users/${encodeURIComponent(userId)}/routes/import/url`;
              const body = JSON.stringify({ url: autoUrl });
              // Build headers and fetch options similarly to the working curl
              const hhHeaders2 = {
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Authorization': 'Bearer ' + token,
                'DNT': '1',
                'Accept-Language': (navigator.language || 'es')
              };
              try{ if(navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)){
                hhHeaders2['sec-ch-ua'] = navigator.userAgentData.brands.map(b=>`"${b.brand}";v="${b.version}"`).join(', ');
                hhHeaders2['sec-ch-ua-mobile'] = navigator.userAgentData.mobile ? '?1' : '?0';
                hhHeaders2['sec-ch-ua-platform'] = navigator.platform || 'macOS';
              } } catch(_){ }
                if(CONFIG.DEBUG){ try{ const tokenMasked2 = token && token.length>10 ? token.slice(0,8)+'…'+token.slice(-8) : token; const hhLog2 = Object.assign({}, hhHeaders2); hhLog2.Authorization = 'Bearer '+(tokenMasked2||'(none)'); MRHH.dbg('hhHeaders2 (debug)', hhLog2); } catch(_){ } }
              const res = await fetch(endpoint, { method:'POST', headers: hhHeaders2, body, credentials: 'same-origin', referrer: HAMMERHEAD_ORIGIN + '/routes', referrerPolicy: 'origin', mode: 'cors' });
              const text = await res.text().catch(()=> '');
              // include response headers and a larger message preview for debugging
              const headersObj = {};
              try{ if(res && res.headers && typeof res.headers.forEach === 'function'){ res.headers.forEach((v,k)=>{ headersObj[k]=v; }); } } catch(_){ }
              const payload = { status: res.status, ok: res.ok, message: (text||'').slice(0,2000), headers: headersObj, statusText: res.statusText };
              MRHH.info('Auto import performed, will post result to opener (if present)');
              try{
                if(window.opener && window.opener.postMessage){
                  window.opener.postMessage({ channel: CONFIG.POSTMESSAGE_NAMESPACE, type:'hh-import-result', reqId: autoReq, payload }, '*');
                  MRHH.info('Posted result to opener via postMessage *');
                } else {
                  MRHH.info('No opener window to post result to');
                }
              } catch(postErr){ MRHH.dbg('postMessage to opener failed', postErr); }
            } catch(e){ MRHH.dbg('Auto import failed', e); }
          })();
        }
      } catch(e){ MRHH.dbg('auto import check failed', e); }
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
