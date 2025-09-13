// ==UserScript==
// @name         MeteoRide ➜ Hammerhead Export (URL Import)
// @namespace    https://app.meteoride.cc/
// @version      0.8.1
// @description  Export current GPX desde MeteoRide a Hammerhead usando siempre /v1/users/{userId}/routes/import/url (userId detectado automáticamente).
// @author       lockevod
// @license       MIT
// @homepageURL  https://app.meteoride.cc/
// @source       https://github.com/lockevod/meteoride
// @supportURL   https://github.com/lockevod/meteoride/issues
// @downloadURL  https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js
// @updateURL    https://raw.githubusercontent.com/lockevod/meteoride/main/scripts/userscripts/tamper_meteoride_export_hammerhead.user.js
// @icon         https://app.meteoride.cc/icon-192.png
// @match        https://app.meteoride.cc/*
// @match        https://dashboard.hammerhead.io/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

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
    UPLOAD: {
      STRATEGY: 'meteoride_share_server',
      SHARE_SERVER_BASE: 'https://app.meteoride.cc',
      CUSTOM: async (file) => { throw new Error('Uploader custom no implementado'); }
    },
    DEBUG: true,
    POSTMESSAGE_NAMESPACE: 'mr:hh',
    EXPORT_TIMEOUT_MS: 30000
  ,PAUSE_BEFORE_IMPORT: true
  };

  const HAMMERHEAD_ORIGIN = 'https://dashboard.hammerhead.io';

  const MRHH = {
    log: (...a)=>{ if(CONFIG.DEBUG) console.log('[MR→HH]', ...a); },
    err: (...a)=>{ console.warn('[MR→HH]', ...a); },
    info: (...a)=>{ console.info('[MR→HH]', ...a); },
    dbg: (...a)=>{ console.debug('[MR→HH]', ...a); }
  };

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
  async function uploadViaShareServer(file){
    const base = CONFIG.UPLOAD.SHARE_SERVER_BASE;
    if(!base || !/^https:\/\//.test(base)) throw new Error('Configura CONFIG.UPLOAD.SHARE_SERVER_BASE (https://...)');
    // POST raw body or multipart. Our share-server accepts raw text (any content-type). We need the GPX text.
    let text;
    if(file.text) text = await file.text(); else text = await new Response(file).text();
    const headers = { 'Content-Type':'application/gpx+xml' };
    try{ if(file && file.name) headers['X-File-Name'] = file.name; }catch(_){ }
    const res = await fetch(base.replace(/\/$/,'') + '/share', {
      method:'POST',
      headers,
      body: text
    });
    // If server redirected us to a final URL (eg 303 -> /shared/...), accept that
    try {
      if(res.redirected && res.url && /^https?:\/\//i.test(res.url)){
        return await resolveToGpx(res.url, base);
      }
      const loc = res.headers.get && res.headers.get('location');
      if(loc){
        const l = loc.trim();
        if(/^https?:\/\//i.test(l)) return await resolveToGpx(l, base);
        // relative path -> join with base
        if(l.startsWith('/')) return await resolveToGpx(base.replace(/\/$/,'') + l, base);
      }
    } catch(_){}
    // Read body (try JSON then fallback to text) and provide richer errors for debugging
    let bodyText = '';
    try { bodyText = await res.clone().text(); } catch(_) { bodyText = ''; }
    if(!res.ok){
      const msg = `share-server fallo ${res.status} ${res.statusText} - ${bodyText.slice(0,200)}`;
      throw new Error(msg);
    }
    let json = null;
    try { json = JSON.parse(bodyText); } catch(_){ json = null; }
    // Accept several shapes: { sharedUrl: '/shared/..' }, { url: 'https://...' }, { shared_url: '/shared/..' }, or plain text URL
    if(json && (json.sharedUrl || json.url || json.shared_url || json.path || json.id)){
      if(json.url) return await resolveToGpx(json.url, base);
      if(json.sharedUrl) return await resolveToGpx(base.replace(/\/$/,'') + json.sharedUrl, base);
      if(json.shared_url) return await resolveToGpx(base.replace(/\/$/,'') + json.shared_url, base);
      if(json.path) return await resolveToGpx(base.replace(/\/$/,'') + json.path, base);
      if(json.id) return await resolveToGpx(base.replace(/\/$/,'') + '/shared/' + json.id, base);
    }
    // Fallback: if bodyText looks like a URL, return it
    const urlLike = (bodyText || '').trim();
  if(/^https?:\/\//i.test(urlLike)) return await resolveToGpx(urlLike, base);
    // Nothing matched: throw informative error including body
    const snippet = (bodyText||'').slice(0,500);
    throw new Error('Respuesta share-server inesperada: ' + snippet);
  }

  // Try to resolve an index-like URL to a direct GPX/shared URL.
  async function resolveToGpx(url, base){
    try{
      if(/\.gpx(\?|$)/i.test(url)) return url;
      // HEAD to inspect content-type
      const h = await fetch(url, { method:'HEAD', mode:'cors', credentials:'same-origin', referrer: base, referrerPolicy: 'origin' });
      const ct = (h && h.headers && h.headers.get('content-type')) || '';
      if(/gpx/i.test(ct)) return url;
      // If HTML, GET and try to find shared id or /shared/ path
      const txt = await fetch(url, { method:'GET', mode:'cors', credentials:'same-origin', referrer: base, referrerPolicy: 'origin' }).then(r=>r.text()).catch(()=> '');
      // Look for /shared/{id}
      let m = txt.match(/\/shared\/([A-Za-z0-9\-_.]+)/);
  if(m && m[1]) return base.replace(/\/$/,'') + '/shared/' + m[1] + '.gpx';
      // Look for query param shared_id or shared
      m = txt.match(/shared_id=([A-Za-z0-9\-_.]+)/) || txt.match(/shared=([A-Za-z0-9\-_.]+)/);
  if(m && m[1]) return base.replace(/\/$/,'') + '/shared/' + m[1] + '.gpx';
      // As last resort, if url contains a query param with an id-like token, try to use it
      const q = (new URL(url)).searchParams;
      const candidate = q.get('shared_id') || q.get('id') || q.get('shared');
  if(candidate) return base.replace(/\/$/,'') + '/shared/' + candidate + '.gpx';
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
      // GET and try to resolve via resolveToGpx
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
  }

  function addFloatingButton(btn){
    try{
      Object.assign(btn.style, { position:'fixed', right:'12px', bottom:'12px', zIndex: 999999, borderRadius:'6px', boxShadow:'0 2px 6px rgba(0,0,0,0.25)'});
  document.body.appendChild(btn);
  MRHH.info('Inserted floating HH export button');
  } catch(e){ MRHH.err('Could not insert floating button', e); }
  }

  async function onExportClick(){
    try {
  const btn = this;
  btn.disabled = true; const orig = btn.textContent; btn.textContent = '…';
  MRHH.info('Export button clicked');
  if(!window.lastGPXFile){ throw new Error('No GPX loaded (window.lastGPXFile missing)'); }
  const file = window.lastGPXFile;
  MRHH.info('Found window.lastGPXFile size=', file.size || 'unknown');
  MRHH.log('Uploading GPX to share-server');
  const publicUrl = await uploadPublic(file);
  MRHH.info('Share server returned URL=', publicUrl);
  // Optional pause: let user inspect/cancel before we call Hammerhead
  if(CONFIG.PAUSE_BEFORE_IMPORT){
    try{
      const ok = confirm('GPX uploaded to: "' + publicUrl + '"\n\nPress OK to continue and request Hammerhead import, or Cancel to stop.');
      if(!ok){ MRHH.info('User cancelled before Hammerhead import'); alert('Export cancelled by user');
        const btn2 = document.getElementById('mr-hh-export-btn'); if(btn2){ btn2.disabled = false; btn2.textContent = CONFIG.BUTTON_TEXT; }
        return;
      }
    } catch(_){ }
  }
  MRHH.log('Requesting Hammerhead import for URL');
  const outcome = await requestImportInHammerhead(publicUrl);
  MRHH.info('Hammerhead import result', outcome);
  alert('Import Hammerhead: '+outcome.status+' '+(outcome.message||''));
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

      // Phase 1: wait a short while for an existing HH tab
      const t1 = setTimeout(()=>{
        if(finished) return;
  MRHH.info('No response from existing Hammerhead tabs; attempting to open a Hammerhead tab to complete the import');
        try{
          // user gesture already present (click) so window.open should be allowed
          // Open Hammerhead with query params so the userscript there can auto-run the import
          const params = new URLSearchParams({ mr_hh_import: publicUrl, mr_reqId: reqId });
          const url = HAMMERHEAD_ORIGIN + '/?' + params.toString();
          const win = window.open(url, '_blank');
          if(win) MRHH.info('Opened Hammerhead tab (or focused existing)'); else MRHH.info('Could not open Hammerhead tab automatically');
  } catch(e){ MRHH.dbg('window.open failed', e); }
        // Re-broadcast to newly opened tab(s)
        try{ window.postMessage({ channel, type:'hh-import-request', reqId, publicUrl }, '*'); } catch(_){ }
        // Phase 2: final wait
        const t2 = setTimeout(()=>{
          if(finished) return;
          cleanup();
          reject(new Error('Timeout waiting Hammerhead tab'));
        }, secondPhase);
      }, firstPhase);

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
  MRHH.info('Hammerhead API status', res.status, 'ok=', res.ok);
      postResult(reqId, { status: res.status, ok: res.ok, message: message.slice(0,400) });
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
      window.addEventListener('message', handleHammerheadImportRequest, false);
      // Automatic import via query param (fallback when opened by the MeteoRide script)
      try{
        const qs = new URLSearchParams(location.search);
        const autoUrl = qs.get('mr_hh_import');
        const autoReq = qs.get('mr_reqId') || ('exp_'+Date.now());
        if(autoUrl){
          MRHH.info('Auto import param found in HH tab, attempting import for', autoUrl);
          (async ()=>{
            try{
              // Wait a short moment for page scripts / storage to settle
              await new Promise(r=>setTimeout(r, 3000));
              const { token, userId } = await discoverAuth();
              try{ const claims = decodeJwt(token); MRHH.dbg('auto-import: token claims', sanitizeClaims(claims)); } catch(_){}
              try{ const masked = (token && token.length>10) ? (token.slice(0,8)+'…'+token.slice(-8)) : token; MRHH.dbg('auto-import: tokenMasked', masked); } catch(_){}
              if(!token || !userId){
                const payload = { status:'error', message:'token/userId not found in hammerhead tab' };
                MRHH.info('Auto import: token/userId not found, will notify opener if possible');
                try{
                  if(window.opener && window.opener.postMessage){
                    window.opener.postMessage({ channel: CONFIG.POSTMESSAGE_NAMESPACE, type:'hh-import-result', reqId: autoReq, payload }, '*');
                    MRHH.info('Notified opener about missing auth (postMessage *).');
                  } else {
                    MRHH.info('No opener present to notify.');
                  }
                } catch(errPost){ MRHH.dbg('postMessage to opener failed', errPost); }
                return;
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
              const payload = { status: res.status, ok: res.ok, message: (text||'').slice(0,400) };
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
