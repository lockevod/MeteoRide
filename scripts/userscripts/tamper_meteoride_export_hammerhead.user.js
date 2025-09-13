// ==UserScript==
// @name         MeteoRide ➜ Hammerhead Export (URL Import)
// @namespace    https://meteoride.local/
// @version      0.5.0
// @description  Export current GPX desde MeteoRide a Hammerhead usando siempre /v1/users/{userId}/routes/import/url (userId detectado automáticamente).
// @author       you
// @match        *://*/*
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
      SHARE_SERVER_BASE: 'https://gpx.yourdomain.tld',
      CUSTOM: async (file) => { throw new Error('Uploader custom no implementado'); }
    },
    DEBUG: false,
    POSTMESSAGE_NAMESPACE: 'mr:hh',
    EXPORT_TIMEOUT_MS: 30000
  };

  const HAMMERHEAD_ORIGIN = 'https://dashboard.hammerhead.io';

  function log(...a){ if(CONFIG.DEBUG) console.log('[MR→HH]', ...a);} 
  function err(...a){ console.warn('[MR→HH]', ...a);} 

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
    const res = await fetch(base.replace(/\/$/,'') + '/share', {
      method:'POST',
      headers: { 'Content-Type':'application/gpx+xml' },
      body: text
    });
    if(!res.ok) throw new Error('share-server fallo '+res.status);
    const json = await res.json().catch(()=>null);
    if(!json || !json.sharedUrl) throw new Error('Respuesta share-server inesperada');
    const fullUrl = base.replace(/\/$/,'') + json.sharedUrl; // json.sharedUrl comienza con /shared/<id>
    return fullUrl;
  }

  async function uploadPublic(file){
    if(CONFIG.UPLOAD.STRATEGY === 'meteoride_share_server') return uploadViaShareServer(file);
    if(CONFIG.UPLOAD.STRATEGY === 'custom') return CONFIG.UPLOAD.CUSTOM(file);
    throw new Error('Estrategia de subida desconocida');
  }

  // -------------------------------------------------------------
  // MeteoRide Side: Button + Send Request
  // -------------------------------------------------------------
  function injectButton(){
    if(!CONFIG.ENABLE_UI_BUTTON) return;
    if(!isMeteoRide()) return;
    if(document.getElementById('mr-hh-export-btn')) return;
    const container = document.querySelector(CONFIG.INJECT_BUTTON_SELECTOR.split(',').find(sel=>document.querySelector(sel))); 
    if(!container) return;
    const btn = document.createElement('button');
    btn.id = 'mr-hh-export-btn';
    btn.textContent = CONFIG.BUTTON_TEXT;
    btn.title = CONFIG.BUTTON_TITLE;
    Object.assign(btn.style, { cursor:'pointer', padding:'4px 8px', margin:'4px', fontSize:'13px', lineHeight:'16px'});
    btn.addEventListener('click', onExportClick);
    container.appendChild(btn);
  }

  async function onExportClick(){
    try {
      const btn = this;
      btn.disabled = true; const orig = btn.textContent; btn.textContent = '…';
      if(!window.lastGPXFile){ throw new Error('No GPX loaded (window.lastGPXFile missing)'); }
      const file = window.lastGPXFile;
  log('Subiendo GPX a share-server');
  const publicUrl = await uploadPublic(file);
  log('URL pública', publicUrl);
  const outcome = await requestImportInHammerhead(publicUrl);
  alert('Import Hammerhead: '+outcome.status+' '+(outcome.message||''));
    } catch(e){
  alert('Error export HH: '+e.message);
      err(e);
    } finally {
      const btn = document.getElementById('mr-hh-export-btn');
      if(btn){ btn.disabled = false; btn.textContent = CONFIG.BUTTON_TEXT; }
    }
  }

  function requestImportInHammerhead(publicUrl){
    return new Promise((resolve, reject)=>{
      const channel = CONFIG.POSTMESSAGE_NAMESPACE;
      const reqId = 'exp_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      function onMessage(ev){
        if(ev.origin !== HAMMERHEAD_ORIGIN) return;
        const d = ev.data;
        if(!d || d.channel !== channel || d.type !== 'hh-import-result' || d.reqId !== reqId) return;
        window.removeEventListener('message', onMessage);
        resolve(d.payload);
      }
      window.addEventListener('message', onMessage);
      // Broadcast (Hammerhead tab(s) will answer)
      window.postMessage({ channel, type:'hh-import-request', reqId, publicUrl }, '*');
      setTimeout(()=>{
        window.removeEventListener('message', onMessage);
        reject(new Error('Timeout waiting Hammerhead tab'));
      }, CONFIG.EXPORT_TIMEOUT_MS);
    });
  }


  // -------------------------------------------------------------
  // Hammerhead Side: Listen, obtain token+userId, call API
  // -------------------------------------------------------------
  async function handleHammerheadImportRequest(ev){
    const { data } = ev;
    if(!data || data.channel !== CONFIG.POSTMESSAGE_NAMESPACE || data.type !== 'hh-import-request') return;
    const { reqId, publicUrl } = data;
    log('HH tab import URL', publicUrl);
    try {
      const { token, userId } = await discoverAuth();
      if(!token) throw new Error('Bearer token not found');
      if(!userId) throw new Error('userId not resolved');
      const endpoint = `${HAMMERHEAD_ORIGIN}/v1/users/${encodeURIComponent(userId)}/routes/import/url`;
      const body = JSON.stringify({ url: publicUrl });
      const res = await fetch(endpoint, {
        method:'POST',
        headers: {
          'Content-Type':'application/json',
          'Accept':'*/*',
          'Authorization': 'Bearer '+token
        },
        body
      });
      let message = '';
      try { message = await res.text(); } catch(_){ }
      postResult(reqId, { status: res.status, ok: res.ok, message: message.slice(0,400) });
    } catch(e){
      postResult(reqId, { status: 'error', message: e.message });
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
    // Deduplicate
    const seen = new Set();
    const unique = tokenCandidates.filter(t=>{ if(seen.has(t)) return false; seen.add(t); return true; });
    let best = null, userId = null;
    for(const tok of unique){
      const info = decodeJwt(tok);
      if(info && (info.sub || (info.context && info.context.userId))){
        best = tok; userId = (info.context && info.context.userId) || info.sub; break;
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
    if(isHammerhead()) window.addEventListener('message', handleHammerheadImportRequest, false);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
