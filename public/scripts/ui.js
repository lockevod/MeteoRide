(function() {
  // Toggle: show the floating "Generar y Guardar GPX" button when true.
  // Set window.SHOW_GENERATE_AND_SAVE_BUTTON = false in the console before reload to hide the button.
  const SHOW_GENERATE_AND_SAVE_BUTTON = false;
  try { window.SHOW_GENERATE_AND_SAVE_BUTTON = SHOW_GENERATE_AND_SAVE_BUTTON; } catch (e) { /* ignore */ }
  // UI notice helpers (shared for warnings and errors)
  function setNotice(msg, type = "warn") {
    const el = document.getElementById("horizonNotice");
    if (!el) return;
    el.classList.add("notice");
    el.classList.remove("warn", "error");
    el.classList.add(type === "error" ? "error" : "warn");
    if (msg && String(msg).trim()) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }
  function clearNotice() { setNotice("", "warn"); }

  // Helper function to create discrete loading indicators
  function createDiscreteLoadingIndicator(container, id = 'loading-overlay') {
    // Instead of creating a per-container overlay, reuse the global centered overlay
    // so all loading indicators look identical (same text, size and position).
    try {
      // Ensure global overlay exists and is translated
      showLoading();
      const el = document.getElementById('loadingOverlay');
      if (el) return el;
    } catch (e) {
      // Fallback: create a minimal inline indicator in container
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      const loadingDiv = document.createElement('div');
      loadingDiv.id = id;
      loadingDiv.innerHTML = `<span style="font-size: 0.9em; color: #666; font-style: italic; opacity: 0.8;">${(window.t ? window.t('loading_text') : 'Loading...')}</span>`;
      loadingDiv.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.95);padding:8px 16px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.15);z-index:1000;font-size:0.9em;border:1px solid rgba(0,0,0,0.1);`;
      try { container.style.position = 'relative'; container.appendChild(loadingDiv); } catch (_) {}
      return loadingDiv;
    }
  }

  // Loading overlay
  function showLoading() {
    let el = document.getElementById("loadingOverlay");
    if (!el) {
      // Create the overlay if it doesn't exist
      el = document.createElement('div');
      el.id = 'loadingOverlay';
      el.innerHTML = `<span style="font-size: 0.9em; color: #666; font-style: italic; opacity: 0.8;">${(window.t ? window.t('loading_text') : 'Loading...')}</span>`;
      el.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.95);
        padding: 8px 16px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 20000;
        font-size: 0.9em;
        border: 1px solid rgba(0,0,0,0.1);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      `;
      document.body.appendChild(el);
    }
    // Do not overwrite the content if the element already existed (keeps data-i18n translation)
    el.style.visibility = "visible";
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
  }
  function hideLoading() {
    const el = document.getElementById("loadingOverlay");
    if (!el) return;
    el.style.opacity = "0";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
  }

  // Toggle functions
  function toggleConfig() {
    const menu = document.getElementById("configMenu");
    menu.style.display =
      menu.style.display === "none" || menu.style.display === ""
        ? "block"
        : "none";
  }
  function toggleDebug() {
    const dbg = document.getElementById("debugSection");
    dbg.style.display =
      dbg.style.display === "none" || dbg.style.display === ""
        ? "block"
        : "none";
    // Tie viewport badge visibility to Debug
    const vp = document.getElementById("vpBadge");
    if (vp) vp.style.display = (dbg.style.display === "block") ? "block" : "none";
  }

  // Translations
  function applyTranslations() {
    // Elements with data-i18n -> text
    // Preserve child elements (icons/images) when present, only replace text nodes.
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const translated = t(key);
      try {
        // If the element contains an image or other inline control (like the header img),
        // remove only TEXT nodes and append a single text node with the translation.
        if (el.querySelector && (el.querySelector('.app-logo') || el.querySelector('.icon') || el.querySelector('img'))) {
          // remove existing text nodes
          for (const n of Array.from(el.childNodes)) {
            if (n.nodeType === Node.TEXT_NODE) n.remove();
          }
          el.appendChild(document.createTextNode(translated));
        } else {
          el.textContent = translated;
        }
      } catch (e) {
        // Fallback to simple assignment on error
        el.textContent = translated;
      }
    });

    // Placeholder / title attributes
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (!key) return;
      el.placeholder = t(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.dataset.i18nTitle;
      if (!key) return;
      el.title = t(key);
    });

    // Known buttons/controls
    const bc = document.getElementById("toggleConfig");
    if (bc) {
      const span = bc.querySelector('.config-text');
      if (span) span.textContent = t("toggle_config"); else bc.textContent = t("toggle_config");
    }
    const bd = document.getElementById("toggleDebug");
    if (bd) {
      const span = bd.querySelector('.debug-text');
      if (span) span.textContent = t("toggle_debug"); else bd.textContent = t("toggle_debug");
    }
    const bclose = document.getElementById("closeConfig");
    if (bclose) bclose.setAttribute("aria-label", t("close"));

    // Document title
    if (typeof document !== "undefined") document.title = t("title");
  }

  // Localize header and keep logic with UI-related code
  function localizeHeader() {
    try {
      const h = document.getElementById('appTitle');
      const img = h && h.querySelector('.app-logo');
      if (window.t && h) {
        const nameEl = h.querySelector('.app-name');
        const subEl = h.querySelector('.subtitle');
        const subLong = h.querySelector('.sr-only');
        if (nameEl) nameEl.textContent = window.t('app_name');
        if (subEl) subEl.textContent = window.t('subtitle');
        if (subLong) subLong.textContent = window.t('subtitle_long');
        if (!nameEl && !subEl) {
          for (const n of Array.from(h.childNodes)) {
            if (n.nodeType === Node.TEXT_NODE) n.remove();
          }
          const txt = document.createTextNode(window.t('app_name') + (window.t('subtitle') ? ' ' + window.t('subtitle') : ''));
          h.appendChild(txt);
        }
      }
      if (img && window.t) img.alt = window.t('title');
    } catch (e) { console.warn('[ui] header localize failed', e); }
  }

  // Provider options update
  function updateProviderOptions() {
    try {
      const sel = document.getElementById('apiSource');
      if (!sel) return;
      // Ensure new chain option exists
      const hasAromeOpt = !!Array.from(sel.options).find(o => o.value === 'aromehd');
      if (!hasAromeOpt) {
        const opt = document.createElement('option');
        opt.value = 'aromehd';
        opt.text = 'AromeHD';
        sel.add(opt);
      }
      const hasOwArome = !!Array.from(sel.options).find(o => o.value === 'ow2_arome_openmeteo');
      if (!hasOwArome) {
        const opt2 = document.createElement('option');
        opt2.value = 'ow2_arome_openmeteo';
        opt2.text = 'OPW - AromeHD';
        sel.add(opt2);
      }

      // Disable options that require API keys when keys missing
      const hasOW = !!getVal('apiKeyOW');
      const hasMB = !!getVal('apiKey');
      // Helper to set disabled state
      function setDisabled(val, disabled) {
        const opt = Array.from(sel.options).find(o => o.value === val);
        if (opt) opt.disabled = !!disabled;
      }
      // OpenWeather-dependent options
      setDisabled('openweather', !hasOW);
      setDisabled('ow2_arome_openmeteo', !hasOW);
      // MeteoBlue option (if exists)
      setDisabled('meteoblue', !hasMB);

      // If the currently selected option is disabled, pick first non-disabled option
      const curOpt = sel.options[sel.selectedIndex];
      if (curOpt && curOpt.disabled) {
        const firstValid = Array.from(sel.options).find(o => !o.disabled);
        if (firstValid) {
          sel.value = firstValid.value;
          apiSource = firstValid.value;
          saveSettings();
          // Removed provider change notice
        }
      }
    } catch (e) { console.warn('updateProviderOptions error', e); }
  }

  // Inline status helper for API key check
  function setKeyStatus(msg, cls = "") {
    const el = document.getElementById("apiKeyStatus");
    if (!el) return;
    el.className = "key-status" + (cls ? " " + cls : "");
    el.textContent = msg || "";
  }

  // Test MeteoBlue API key
  async function testMeteoBlueKey() {
    const btn = document.getElementById("checkApiKey");
    const apiKey = window.getVal("apiKey");
    if (!apiKey) {
      window.setKeyStatus(window.t("key_test_missing"), "warn");
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.classList.add("testing"); }
      window.setKeyStatus(window.t("key_testing"), "testing");

      const center = (typeof window.map !== "undefined" && window.map?.getCenter) ? window.map.getCenter() : { lat: 41.3874, lng: 2.1686 };
      const p = { lat: center.lat, lon: center.lng };
      const timeAt = new Date();

      const url = window.buildProviderUrl("meteoblue", p, timeAt, apiKey, window.getVal("windUnits"), window.getVal("tempUnits"));
      const res = await fetch(url);
      if (res.ok) {
        window.setKeyStatus(window.t("key_valid"), "ok");
        return;
      }
      const bodyText = await res.text().catch(() => "");
      const code = window.classifyProviderError("meteoblue", res.status, bodyText);
      if (code === "quota") {
        window.setKeyStatus(window.t("key_quota"), "warn");
      } else if (code === "invalid_key" || code === "forbidden") {
        window.setKeyStatus(window.t("key_invalid"), "error");
      } else {
        window.setKeyStatus(window.t("key_http_error", { status: res.status }), "error");
      }
    } catch (err) {
      window.setKeyStatus(window.t("key_network_error", { msg: err.message }), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("testing"); }
    }
  }

  // Test OpenWeather API key
  async function testOpenWeatherKey() {
    const btn = document.getElementById("checkApiKeyOW");
    const apiKey = window.getVal("apiKeyOW");
    if (!apiKey) {
      window.setKeyStatus(window.t("key_test_missing"), "warn");
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.classList.add("testing"); }
      window.setKeyStatus(window.t("key_testing"), "testing");

      const center = (typeof window.map !== "undefined" && window.map?.getCenter) ? window.map.getCenter() : { lat: 41.3874, lng: 2.1686 };
      const p = { lat: center.lat, lon: center.lng };
      const timeAt = new Date();

      const url = window.buildProviderUrl("openweather", p, timeAt, apiKey, window.getVal("windUnits"), window.getVal("tempUnits"));
      const res = await fetch(url);
      if (res.ok) {
        window.setKeyStatus(window.t("key_valid"), "ok");
        return;
      }
      const bodyText = await res.text().catch(() => "");
      const code = window.classifyProviderError("openweather", res.status, bodyText);
      if (code === "quota") {
        window.setKeyStatus(window.t("key_quota"), "warn");
      } else if (code === "invalid_key" || code === "forbidden") {
        window.setKeyStatus(window.t("key_invalid"), "error");
      } else {
        window.setKeyStatus(window.t("key_http_error", { status: res.status }), "error");
      }
    } catch (err) {
      window.setKeyStatus(window.t("key_network_error", { msg: err.message }), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("testing"); }
    }
  }

  // GPX reloading function
  // Helper: convert simple KML (Placemarks with Point/LineString) to GPX text
  // Prefer using the external togeojson library when available (toGeoJSON.kml / togeojson.kml)
  function kmlToGpxText(kmlText) {
    try {
      const parser = new DOMParser();
      const kmlDoc = parser.parseFromString(kmlText, 'application/xml');

      // Try known global names for the togeojson lib
      let geojson = null;
      try {
        if (window.toGeoJSON && typeof window.toGeoJSON.kml === 'function') {
          geojson = window.toGeoJSON.kml(kmlDoc);
        } else if (window.togeojson && typeof window.togeojson.kml === 'function') {
          geojson = window.togeojson.kml(kmlDoc);
        } else if (window.togeojson && typeof window.togeojson === 'function') {
          // Some builds expose a function directly
          geojson = window.togeojson(kmlDoc);
        }
      } catch (e) {
        geojson = null;
      }

      if (geojson) {
        return geojsonToGpx(geojson);
      }

      // Fallback: minimal DOM-based KML->GPX conversion (keeps previous behavior)
      const placemarks = Array.from(kmlDoc.getElementsByTagName('Placemark'));
      let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="meteoride">\n`;
      for (const pm of placemarks) {
        const nameEl = pm.getElementsByTagName('name')[0];
        const name = nameEl ? nameEl.textContent.trim() : '';
        // Point
        const point = pm.getElementsByTagName('Point')[0];
        if (point) {
          const coords = (point.getElementsByTagName('coordinates')[0] || {}).textContent || '';
          const [lon, lat] = coords.trim().split(/,\s*/);
          if (lat && lon) {
            gpx += `<wpt lat="${lat}" lon="${lon}"><name>${escapeXml(name)}</name></wpt>\n`;
            continue;
          }
        }
        // LineString
        const ls = pm.getElementsByTagName('LineString')[0];
        if (ls) {
          const coords = (ls.getElementsByTagName('coordinates')[0] || {}).textContent || '';
          const pts = coords.trim().split(/\s+/).map(s => s.split(',')).filter(a => a.length >= 2);
          if (pts.length) {
            gpx += `<trk><name>${escapeXml(name)}</name><trkseg>`;
            for (const p of pts) {
              const lon = p[0]; const lat = p[1];
              gpx += `<trkpt lat="${lat}" lon="${lon}"></trkpt>`;
            }
            gpx += `</trkseg></trk>\n`;
            continue;
          }
        }
        // Route (same as LineString fallback)
        const rte = pm.getElementsByTagName('LineString')[0];
        if (rte) {
          const coords = (rte.getElementsByTagName('coordinates')[0] || {}).textContent || '';
          const pts = coords.trim().split(/\s+/).map(s => s.split(',')).filter(a => a.length >= 2);
          if (pts.length) {
            gpx += `<rte><name>${escapeXml(name)}</name>`;
            for (const p of pts) { gpx += `<rtept lat="${p[1]}" lon="${p[0]}"></rtept>`; }
            gpx += `</rte>\n`;
          }
        }
      }
      gpx += '</gpx>';
      return gpx;
    } catch (e) {
      return null;
    }
  }

  // Convert simple GeoJSON (FeatureCollection / Feature) to GPX text.
  function geojsonToGpx(geojson) {
    try {
      const fc = (geojson.type === 'FeatureCollection') ? geojson : { type: 'FeatureCollection', features: geojson.type === 'Feature' ? [geojson] : [] };
      let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="meteoride">\n`;
      for (const feat of (fc.features || [])) {
        const props = feat.properties || {};
        const name = props.name || props.title || '';
        const geom = feat.geometry;
        if (!geom) continue;
        const type = geom.type;
        if (type === 'Point') {
          const [lon, lat] = geom.coordinates;
          gpx += `<wpt lat="${lat}" lon="${lon}"><name>${escapeXml(name)}</name></wpt>\n`;
        } else if (type === 'LineString') {
          gpx += `<trk><name>${escapeXml(name)}</name><trkseg>`;
          for (const c of geom.coordinates) {
            const lon = c[0]; const lat = c[1];
            gpx += `<trkpt lat="${lat}" lon="${lon}"></trkpt>`;
          }
          gpx += `</trkseg></trk>\n`;
        } else if (type === 'MultiLineString') {
          gpx += `<trk><name>${escapeXml(name)}</name>`;
          for (const line of geom.coordinates) {
            gpx += `<trkseg>`;
            for (const c of line) { gpx += `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`; }
            gpx += `</trkseg>`;
          }
          gpx += `</trk>\n`;
        } else if (type === 'Polygon') {
          // Use outer ring as a track
          const outer = geom.coordinates && geom.coordinates[0];
          if (outer && outer.length) {
            gpx += `<trk><name>${escapeXml(name)}</name><trkseg>`;
            for (const c of outer) { gpx += `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`; }
            gpx += `</trkseg></trk>\n`;
          }
        }
      }
      gpx += '</gpx>';
      return gpx;
    } catch (e) {
      return null;
    }
  }

  function escapeXml(s) { return String(s || '').replace(/[<>&'"]/g, function(c){ return ({'<' : '&lt;','>' : '&gt;','&' : '&amp;',"'":'&apos;', '"':'&quot;'})[c]; }); }

  // Programmatic export: build GPX from existing map layer or cw steps and set window.lastGPXFile
  // Exposed as window.cw.exportRouteToGpx(nameHint, noReload)
  // If noReload is true the function will NOT call reloadFull() (avoids reloading map/route/clima)
  function exportRouteToGpx(nameHint = 'route.gpx', noReload = false) {
    try {
      // Prefer an existing GPX/track layer
      let gpxText = null;
      try {
        if (window.trackLayer && typeof window.trackLayer.toGeoJSON === 'function') {
          const gj = window.trackLayer.toGeoJSON();
          gpxText = geojsonToGpx(gj);
        }
      } catch (e) { /* ignore and try other source */ }

      // Fallback: build from cw.getSteps() if available
      if (!gpxText && window.cw && typeof window.cw.getSteps === 'function') {
        const steps = window.cw.getSteps() || [];
        if (steps.length >= 2) {
          const coords = steps.map(s => [s.lon, s.lat]);
          const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: nameHint }, geometry: { type: 'LineString', coordinates: coords } }] };
          gpxText = geojsonToGpx(geojson);
        }
      }

      if (!gpxText) {
        console.warn('[MeteoRide] exportRouteToGpx: no route data available to build GPX');
        return null;
      }

      // Create a File-like object for compatibility with reloadFull()
      try {
        window.lastGPXFile = (typeof File === 'function')
          ? new File([gpxText], nameHint || 'route.gpx', { type: 'application/gpx+xml' })
          : { name: nameHint || 'route.gpx', _text: gpxText };
      } catch (e) {
        window.lastGPXFile = { name: nameHint || 'route.gpx', _text: gpxText };
      }

      // Trigger the normal reload path so UI updates unless caller requested noReload
      if (!noReload && typeof window.reloadFull === 'function') {
        try { window.reloadFull(); } catch (e) { /* ignore */ }
      }
      console.info('[MeteoRide] exportRouteToGpx: GPX generated and assigned to window.lastGPXFile');
      return gpxText;
    } catch (err) {
      console.error('[MeteoRide] exportRouteToGpx error', err);
      return null;
    }
  }

  // Upload lastGPXFile to a share-server instance (defaults to same-origin path `/share` so Caddy can proxy to the internal server)
  async function uploadGPXToShareServer(options = {}) {
    // If caller provides an absolute server base URL, use it; otherwise default to the same-origin path
    // so Caddy can proxy /share -> backend. options.server may be absolute (http(s)://host:port) or falsy.
    let endpoint;
    let serverBase = options.server || '';
    if (serverBase && /^https?:\/\//i.test(String(serverBase))) {
      // absolute base provided
      endpoint = new URL('/share', serverBase).toString();
      console.log('[MODHH] uploadGPXToShareServer using absolute endpoint=', endpoint, 'serverBase=', serverBase);
      // Quick health check to confirm the share-server is reachable from the page context
      try {
        const hurl = new URL('/health', serverBase).toString();
        const hr = await fetch(hurl, { method: 'GET' });
        const htxt = await hr.text().catch(() => '');
        console.log('[MODHH] share-server health GET', hurl, 'status=', hr.status, 'text=', htxt, 'headers=', Array.from(hr.headers.entries()));
        if (!hr.ok) {
          console.warn('[MODHH] share-server health check failed; request may be intercepted by proxy or not reachable');
          window.setNotice && window.setNotice('[MODHH] share-server no reachable desde la página (health ' + hr.status + ')', 'warn');
        }
      } catch (e) {
        console.error('[MODHH] share-server health fetch error', e);
        window.setNotice && window.setNotice('[MODHH] Error comprobando share-server: ' + e.message, 'warn');
      }
    } else {
      // Default: use same-origin path so Caddy (on port 8080) can proxy to internal node server
      endpoint = '/share';
      console.log('[MODHH] uploadGPXToShareServer using same-origin endpoint=', endpoint);
    }
    // Ensure we have a GPX file in window.lastGPXFile; generate one if not present
    if (!window.lastGPXFile) {
      // Try to generate from current route without reloading UI/map
      exportRouteToGpx(undefined, true);
    }
    if (!window.lastGPXFile) {
      window.setNotice && window.setNotice(window.t ? window.t('no_route_for_export') || 'No route to export' : 'No route to export', 'warn');
      return null;
    }

    // Build payload
    let rawText = null;
    let filename = (window.lastGPXFile && window.lastGPXFile.name) ? window.lastGPXFile.name : 'route.gpx';
    try {
      const f = window.lastGPXFile;
      if (typeof File !== 'undefined' && f instanceof File && typeof f.text === 'function') {
        rawText = await f.text();
      } else if (f && f._text) {
        rawText = String(f._text);
      } else if (typeof f === 'string') {
        rawText = f;
      }
      if (!rawText) {
        window.setNotice && window.setNotice('GPX payload not available', 'error');
        return null;
      }
    } catch (e) {
      window.setNotice && window.setNotice('Error preparing GPX upload: ' + e.message, 'error');
      return null;
    }

    try {
      window.showLoading && window.showLoading();
      window.setKeyStatus && window.setKeyStatus('Subiendo GPX...', 'testing');
      // Preferred: send raw GPX body with application/gpx+xml
      let res = null;
      try {
        res = await fetch(endpoint, {
        method: 'POST',
        body: rawText,
        headers: { 'Content-Type': 'application/gpx+xml', 'X-File-Name': filename, 'X-Bypass-Service-Worker': '1' }
        });
      } catch (netErr) {
        console.error('[MODHH] network error when POSTing to share-server', netErr);
        window.setNotice && window.setNotice('[MODHH] Error de red al subir GPX: ' + netErr.message, 'error');
        return null;
      }

      // If server rejected raw body (e.g., 400) try multipart fallback for compatibility
      if (!res.ok && res.status >= 400 && res.status < 500) {
        try {
          const form = new FormData();
          const blob = new Blob([rawText], { type: 'application/gpx+xml' });
          form.append('file', blob, filename);
          res = await fetch(endpoint, { method: 'POST', body: form, headers: { 'X-File-Name': filename, 'X-Bypass-Service-Worker': '1' } });
        } catch (e) {
          // keep original res if fallback fails
        }
      }
      const text = await res.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch (e) { payload = null; }
      // Detect cases where the server returned the app index (likely Caddy proxying /share to 8080)
      if (text && typeof text === 'string' && /<!doctype html/i.test(text)) {
        console.warn('[MODHH] Received HTML (index) when uploading GPX — request probably hit the webserver (Caddy) not the share-server:', endpoint);
        console.log('[MODHH] response head:', text.slice(0, 300));
        window.setNotice && window.setNotice('[MODHH] Error: la petición fue servida por el servidor web (index) en vez del share-server. Revisa la URL del share-server o la configuración de Caddy/proxy.', 'error');
        return null;
      }
      if (!res.ok) {
        const msg = payload && payload.message ? payload.message : (text || res.statusText || 'Upload failed');
        window.setNotice && window.setNotice('Upload failed: ' + msg, 'error');
        return null;
      }

      // Success: servers in this repo return JSON with url or sharedUrl
      console.log('[MeteoRide] share response status=', res.status, 'text=', text, 'parsed=', payload);
      const sharedUrl = (payload && (payload.url || payload.sharedUrl)) || (res.headers.get('Location')) || null;
      window.setKeyStatus && window.setKeyStatus('GPX guardado', 'ok');
      if (sharedUrl) {
        const abs = (typeof sharedUrl === 'string' && sharedUrl.startsWith('http')) ? sharedUrl : (new URL(sharedUrl, serverBase)).toString();
        // Try HEAD to check availability
        let available = false;
        try {
          const h = await fetch(abs, { method: 'HEAD' });
          available = h.ok;
        } catch (e) { available = false; }

        // Extract saved filename/message if present
        let savedName = null;
        if (payload && payload.message) {
          const m = String(payload.message).match(/Stored as\s+(.+)$/i);
          if (m) savedName = m[1]; else savedName = payload.message;
        }

        const noticeMsg = (savedName ? `${savedName} -> ` : '') + abs + (available ? ' (available)' : ' (may be pending)');
        window.setNotice && window.setNotice(noticeMsg, 'ok');
        console.log('[MeteoRide] shared URL:', abs, 'available=', available, 'payload=', payload);
        try { await navigator.clipboard?.writeText(abs); } catch (e) { /* ignore clipboard errors */ }
        return { url: abs, available, payload };
      }
      window.setNotice && window.setNotice('GPX guardado', 'ok');
      return payload;
    } catch (err) {
      window.setNotice && window.setNotice('Error subiendo GPX: ' + err.message, 'error');
      console.error('uploadGPXToShareServer error', err);
      return null;
    } finally {
      window.hideLoading && window.hideLoading();
    }
  }

  // Export geojsonToGpx helper so other scripts/userscripts can reuse it
  // Attach to window.cw namespace (created later in the file); create temporary holder now
  window._internal_geojsonToGpx = geojsonToGpx;

  function reloadFull() {
    if (!window.lastGPXFile) {
      // No mostrar mensaje cuando no hay fichero seleccionado (comportamiento silencioso)
      return;
    }
    // Reset transient application state to avoid duplication when reloading a GPX
    (function resetAppStateForNewRoute() {
      try {
        // Clear computed weather/state
        if (window.weatherData && Array.isArray(window.weatherData)) window.weatherData.length = 0;
        // Clear active weather alerts
        if (Array.isArray(window.activeWeatherAlerts)) window.activeWeatherAlerts.length = 0; else window.activeWeatherAlerts = [];
        // Hide and clear alerts UI
        const alertContainer = document.getElementById('weather-alerts-container');
        if (alertContainer) {
          alertContainer.style.display = 'none';
          // remove child alert elements
          const children = Array.from(alertContainer.querySelectorAll('.weather-alert'));
          children.forEach(c => c.remove());
        }
        try {
          if (typeof hideAndCleanupAlertIndicator === 'function') hideAndCleanupAlertIndicator();
          else {
            const indicator = document.getElementById('weather-alert-indicator');
            if (indicator) indicator.style.display = 'none';
          }
        } catch (e) { /* ignore */ }

        // Remove wind and rain markers from map
        try {
          if (Array.isArray(window.windMarkers)) {
            window.windMarkers.forEach(m => { try { if (m && window.map && typeof m.remove === 'function') m.remove(); } catch(e){} });
            window.windMarkers.length = 0;
          }
          if (Array.isArray(window.rainMarkers)) {
            window.rainMarkers.forEach(m => { try { if (m && window.map && typeof m.remove === 'function') m.remove(); } catch(e){} });
            window.rainMarkers.length = 0;
          }
        } catch (e) { /* ignore marker cleanup errors */ }

        // Reset selection/index state
        window.selectedOriginalIdx = null;
        window.viewOriginalIndexMap = [];
        window.colIndexByOriginal = {};
        window.lastAppliedSpeed = null;
      } catch (e) {
        console.warn('resetAppStateForNewRoute error', e);
      }
    })();
    const reader = new FileReader();
    
    reader.onload = async function (e) {
      try {
        // Detect file type by extension and convert if necessary
        const name = (window.lastGPXFile && window.lastGPXFile.name) ? String(window.lastGPXFile.name).toLowerCase() : '';
        let content = e.target.result;
        if (name.endsWith('.kml')) {
          const g = kmlToGpxText(content);
          if (!g) throw new Error('KML to GPX conversion failed');
          content = g;
        }
  // FIT files are not accepted by the file input; only .gpx and .kml are handled here.
        if (window.trackLayer) window.map.removeLayer(window.trackLayer);
        window.trackLayer = new L.GPX(content, {
          async: true,
          polyline_options: { color: 'blue' },
          marker_options: {
            startIconUrl:
              "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
            endIconUrl:
              "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
            shadowUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
            // opcionales:
            wptIconUrl: null
          }
        });

        window.trackLayer.on("loaded", async (evt) => {
          window.map.fitBounds(evt.target.getBounds());
          await window.segmentRouteByTime(evt.target.toGeoJSON());
          let routeName = evt.target.get_name ? evt.target.get_name() : null;
          if (!routeName && evt.target.get_metadata) {
            let meta = evt.target.get_metadata();
            routeName = meta && meta.name ? meta.name : null;
          }
          if (routeName) {
            const rutaNameEl = document.getElementById("rutaName");
            rutaNameEl.textContent = routeName;
            // Clear placeholder styling when real route name is loaded
            rutaNameEl.style.color = '';
            rutaNameEl.style.fontStyle = '';
          }

          const layer = evt.target;

          // Reemplazo robusto de iconos (usa tanto layer como fallback sobre el mapa)
          window.replaceGPXMarkers(layer);

          // Si aún quieres mantener la lógica previa de markers[] puedes dejarla como backup,
          // pero la función anterior ya cubre la mayoría de situaciones.

          window.map.fitBounds(evt.target.getBounds(), {
            padding: [20, 20], // Puedes ajustar el padding si quieres más/menos borde
            maxZoom: 15        // Opcional: así no se acerca demasiado
          });
        });

        window.trackLayer.addTo(window.map);
      } catch (err) {
        console.error(window.t ? window.t("error_reading_gpx", { msg: err.message }) : ('Error reading GPX: ' + err.message));
        window.logDebug && window.logDebug(window.t ? window.t("error_reading_gpx", { msg: err.message }) : ('Error reading GPX: ' + err.message), true);
      }
    };
    reader.readAsText(window.lastGPXFile);
  }

  // GPX marker replacement function
  function replaceGPXMarkers(layer) {
    const markers = [];
    // Recolecta marcadores de forma recursiva (layer puede ser FeatureGroup/LayerGroup)
    function collect(l) {
      if (!l) return;
      if (l instanceof L.Marker) {
        markers.push(l);
      } else if (typeof l.eachLayer === "function") {
        l.eachLayer((sub) => collect(sub));
      }
    }
    collect(layer);

    // Fallback: si no encontró ninguno en el layer, buscar en el mapa dentro de los bounds del layer
    if (markers.length === 0 && layer && typeof layer.getBounds === "function") {
      const bounds = layer.getBounds();
      window.map.eachLayer((l) => {
        if (l instanceof L.Marker) {
          try {
            if (bounds.contains(l.getLatLng())) markers.push(l);
          } catch (e) { /* ignore */ }
        }
      });
    }

    window.logDebug(`replaceGPXMarkers: encontrados ${markers.length} marcadores GPX`);

    if (markers.length === 0) return;

    const startIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [16, 30],      // reducido
      iconAnchor: [9, 30],
      shadowSize: [30, 30],
      shadowAnchor: [9, 30],
      className: 'gpx-marker-start'
    });

    const endIcon = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [16, 30],      // reducido
      iconAnchor: [9, 30],
      shadowSize: [30, 30],
      shadowAnchor: [9, 30],
      className: 'gpx-marker-end'
    });

    try {
      markers[0].setIcon(startIcon);
      markers[markers.length - 1].setIcon(endIcon);
      window.logDebug("replaceGPXMarkers: iconos start/end aplicados");
    } catch (err) {
      window.logDebug("replaceGPXMarkers: error al aplicar iconos - " + err.message, true);
    }
  }

  // Explicit compare-by-dates mode flag: when true and compare UI is visible,
  // date changes do NOT auto-recalculate; user must click the "Run compare" button.
  let explicitCompareActive = false;

  // Bind UI events
  function bindUIEvents() {
    const toggleConfigEl = document.getElementById("toggleConfig");
    if (toggleConfigEl) toggleConfigEl.addEventListener("click", toggleConfig);
    
    const toggleDebugEl = document.getElementById("toggleDebug");
    if (toggleDebugEl) toggleDebugEl.addEventListener("click", toggleDebug);

    // Test alerts button (temporary)
    const testAlertsEl = document.getElementById("testAlerts");
    if (testAlertsEl) testAlertsEl.addEventListener("click", () => {
      if (window.testWeatherAlerts) {
        window.testWeatherAlerts();
      }
    });

    // Help button
    const toggleHelpEl = document.getElementById("toggleHelp");
    if (toggleHelpEl) {
      toggleHelpEl.addEventListener("click", () => {
        // Detect mobile/PWA
        const isMobile = window.innerWidth <= 700 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        
        // Get current language and select appropriate help file
        const lang = window.getVal("language") || "es";
        const helpFile = lang.startsWith("en") ? "help_en.html" : "help.html";
        
        if (isMobile || isPWA) {
          window.location.href = `${helpFile}?return=true`;
        } else {
          window.open(helpFile, "_blank", "width=800,height=600,scrollbars=yes,resizable=yes");
        }
      });
    }

    const closeConfigEl = document.getElementById("closeConfig");
    if (closeConfigEl) closeConfigEl.addEventListener("click", () => {
      const menu = document.getElementById("configMenu");
      if (menu) menu.style.display = "none";
    });

    // Close config on outside click
    document.addEventListener("pointerdown", (ev) => {
      const menu = document.getElementById("configMenu");
      const btn  = document.getElementById("toggleConfig");
      if (!menu) return;
      if (menu.style.display !== "block") return;
      const t = ev.target;
      if (menu.contains(t)) return;
      if (btn && (t === btn || btn.contains(t))) return;
      menu.style.display = "none";
    }, { capture: true });

    // File input
    const gpxFileEl = document.getElementById("gpxFile");
    if (gpxFileEl) {
      gpxFileEl.addEventListener("change", function () {
        if (!this.files.length) {
          window.lastGPXFile = null;
          return;
        }
        window.lastGPXFile = this.files[0];
        const val = (this.files[0].name) || (this.value.split("\\").pop() || this.value.split("/").pop() || "");
        const rutaBase = val.replace(/\.[^/.]+$/, "");
        const rutaEl = document.getElementById("rutaName");
        if (rutaEl) rutaEl.textContent = rutaBase ? rutaBase : "";
        window.reloadFull();
      });
    }

    const dtEl = document.getElementById("datetimeRoute");
    if (dtEl) {
      dtEl.addEventListener("change", () => {
        if (!dtEl.value) return;
        const [Y, M, D, H, Min] = dtEl.value.split(/[-:T]/).map(Number);
        const localDate = new Date(Y, M - 1, D, H, Min, 0, 0);
        const rounded = window.roundToNextQuarterISO(localDate);

        if (dtEl.min && new Date(rounded) < new Date(dtEl.min)) {
          dtEl.value = dtEl.min;
        } else {
          dtEl.value = rounded;
        }
          // If compare-by-dates is active, refresh compare instead of full reload
        const row2 = document.getElementById('datetimeRoute2Row');
        const compareActive = row2 && row2.style.display !== 'none';
        if (compareActive) {
          if (!explicitCompareActive && window.cw?.runCompareDatesMode) {
            window.cw.runCompareDatesMode();
          }
          // In explicit mode, do nothing until user clicks Run Compare
        } else if (window.apiSource === "compare" && window.cw?.runCompareMode) {
          window.cw.runCompareMode();
        } else {
          window.reloadFull();
        }
        // Re-validate weather alerts when date changes
        if (window.revalidateWeatherAlerts) {
          window.revalidateWeatherAlerts();
        }
      });
    }

    // Date B: when the second date is visible, changing it should immediately re-run compare-dates mode
    const dtEl2 = document.getElementById("datetimeRoute2");
    if (dtEl2) {
      dtEl2.addEventListener("change", () => {
        if (!dtEl2.value) return;
        const row2 = document.getElementById('datetimeRoute2Row');
        const visible = row2 && getComputedStyle(row2).display !== 'none';
        // Round to next quarter like A
        const [Y, M, D, H, Min] = dtEl2.value.split(/[-:T]/).map(Number);
        const localDate = new Date(Y, M - 1, D, H, Min, 0, 0);
        const rounded = window.roundToNextQuarterISO(localDate);
        dtEl2.value = rounded;
        if (visible && window.cw?.runCompareDatesMode) {
          if (!explicitCompareActive) {
            window.cw.runCompareDatesMode();
          }
        }
      });
      // Also react on input (useful on some UIs) when value is complete
      dtEl2.addEventListener("input", () => {
        const row2 = document.getElementById('datetimeRoute2Row');
        const visible = row2 && getComputedStyle(row2).display !== 'none';
        if (!visible || explicitCompareActive) return;
        const v = dtEl2.value || "";
        if (v.length >= 16 && window.cw?.runCompareDatesMode) {
          window.cw.runCompareDatesMode();
        }
      });
    }

    // Reactive controls
    [
      "language",
      "windUnits",
      "tempUnits",
      "distanceUnits",
      "precipUnits",
      "apiKey",
      "apiKeyOW",
      "apiSource",
      "intervalSelect",
      "noticeAll",
      "showWeatherAlerts",
      "showDebugButton",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", () => {
          if (id === "apiSource") {
            window.apiSource = el.value;

            if ((window.apiSource === "meteoblue" || window.apiSource === "openweather") && !window.getVal("apiKey") && !window.getVal("apiKeyOW")) {
              const provName = window.apiSource === "openweather" ? "OpenWeather" : "MeteoBlue";
              window.setNotice(window.t("provider_key_missing", { prov: provName }), "warn");
            } else {
              window.clearNotice();
            }
            // If compare-by-dates is active, refresh compare instead of full reload
            const row2 = document.getElementById('datetimeRoute2Row');
            const compareActive = row2 && row2.style.display !== 'none';
            if (compareActive && window.cw?.runCompareDatesMode) {
              window.saveSettings();
              if (!explicitCompareActive) {
                window.cw.runCompareDatesMode();
                return; // avoid falling through to reloadFull
              }
              // In explicit mode, do not auto-run; just save settings
              return;
            }
          }
          if (id === "apiKey" || id === "apiKeyOW") {
            updateProviderOptions();
            const hasMB  = ((window.getVal("apiKey")  || "").trim().length >= 5);
            const hasOWM = ((window.getVal("apiKeyOW") || "").trim().length >= 5);
            const sel = document.getElementById("apiSource");
            if (sel) {
              if (sel.value === "meteoblue" && !hasMB)  { sel.value = "openmeteo"; window.apiSource = "openmeteo"; }
              if (sel.value === "openweather" && !hasOWM){ sel.value = "openmeteo"; window.apiSource = "openmeteo"; }
            }
          }
          
          if (id === "showDebugButton") {
            // Toggle debug button visibility in real time
            const debugButton = document.getElementById("toggleDebug");
            if (debugButton) {
              const isVisible = el.checked;
              console.log(`Debug button toggle: ${isVisible}`, debugButton);
              console.log(`Before - classes:`, debugButton.className, `display:`, debugButton.style.display);
              
              if (isVisible) {
                debugButton.classList.remove('debug-hidden');
                debugButton.style.display = ''; // Reset inline style
              } else {
                debugButton.classList.add('debug-hidden');
                debugButton.style.display = 'none'; // Force hide with inline style too
              }
              
              console.log(`After - classes:`, debugButton.className, `display:`, debugButton.style.display);
            } else {
              console.log('Debug button not found!');
            }
          }

          window.saveSettings();
          if (id === "language") window.applyTranslations();
          if (["windUnits", "tempUnits"].includes(id) && window.weatherData.length) {
            // Validate that a route is loaded before updating units
            const routeValidation = window.validateRouteLoaded();
            if (!routeValidation.valid) {
              if (window.setNotice) window.setNotice(routeValidation.error, 'error');
              return;
            }
            window.updateUnits();
          }
          // If compare-by-dates UI is visible, refresh the compare view instead of full reload
          const row2 = document.getElementById('datetimeRoute2Row');
          const compareActive = row2 && row2.style.display !== 'none';
          if (compareActive && window.cw?.runCompareDatesMode) {
            if (!explicitCompareActive) {
              window.cw.runCompareDatesMode();
              return;
            }
            return;
          } else if (window.apiSource === "compare" && window.cw?.runCompareMode) {
            window.cw.runCompareMode();
            return;
          }
          window.reloadFull();
          
          // Re-validate weather alerts when parameters change
          if (["intervalSelect", "cyclingSpeed", "datetimeRoute"].includes(id) && window.revalidateWeatherAlerts) {
            window.revalidateWeatherAlerts();
          }
        });
      }
    });

    // Separate for apiSource
    const apiSourceEl = document.getElementById("apiSource");
    if (apiSourceEl) {
      apiSourceEl.addEventListener("change", () => {
        const prov = apiSourceEl.value;
        // Validate that a route is loaded before proceeding
        const routeValidation = window.validateRouteLoaded();
        if (!routeValidation.valid) {
          if (window.setNotice) window.setNotice(routeValidation.error, 'error');
          return;
        }
        // If date-compare is active and a normal provider is selected, re-run date compare with the new provider
        const row2 = document.getElementById('datetimeRoute2Row');
        const compareActive = row2 && row2.style.display !== 'none';
        if (compareActive && prov !== 'compare') {
          if (window.cw?.runCompareDatesMode && !explicitCompareActive) window.cw.runCompareDatesMode();
          return;
        }
        if (prov === "compare") {
          if (window.cw?.runCompareMode) window.cw.runCompareMode();
          return;
        }
        window.renderWeatherTable();
      });
    }

    // Toggle button for Compare Dates mode (next to date A)
    const toggleCompBtn = document.getElementById('toggleCompareDates');
    const compareNowBtn = document.getElementById('compareDatesNow');
    if (toggleCompBtn) {
      toggleCompBtn.addEventListener('click', (ev) => {
        const row = document.getElementById('datetimeRoute2Row');
        if (!row) return;
        const isHidden = getComputedStyle(row).display === 'none';
        // Toggle: if currently hidden -> show and focus, else hide
        if (isHidden) {
          row.style.display = '';
          // Focus date B for immediate edit
          const dt2 = document.getElementById('datetimeRoute2');
          if (dt2) {
            // Prefill B with A if empty
            if (!dt2.value) {
              const a = document.getElementById('datetimeRoute')?.value;
              if (a) dt2.value = a;
            }
            dt2.focus();
          }
          // Enter explicit compare mode by default; user can click the run button to compute
          explicitCompareActive = true;
          if (compareNowBtn) {
            compareNowBtn.style.display = '';
            // Ensure i18n title
            if (window.t) compareNowBtn.title = window.t('compare_now_btn_title');
          }
          // Visual active state and i18n label/title
          toggleCompBtn.setAttribute('aria-pressed', 'true');
          if (window.t) {
            // Icon-only button: keep content minimal; update title only
            toggleCompBtn.title = window.t('compare_dates_btn_title_on');
          }
        } else {
          row.style.display = 'none';
          // Re-render default table
          window.renderWeatherTable();
          // Clear compare mode class on table if present
          const wt = document.getElementById('weatherTable');
          if (wt) wt.classList.remove('compare-dates-mode');
          // Also remove class from main element
          const main = document.querySelector('main');
          if (main) main.classList.remove('compare-dates-mode');
          // Reset button visual state and label/title
          toggleCompBtn.setAttribute('aria-pressed', 'false');
          if (window.t) {
            // Icon-only button: keep content minimal; update title only
            toggleCompBtn.title = window.t('compare_dates_btn_title');
          }
          if (compareNowBtn) compareNowBtn.style.display = 'none';
          explicitCompareActive = false;
          // Recalculate normal weather data when exiting compare-dates mode
          window.reloadFull();
        }
      });
    }

    // Run comparison explicitly on demand
    if (compareNowBtn) {
      // Initialize visibility
      const row = document.getElementById('datetimeRoute2Row');
      const visible = row && getComputedStyle(row).display !== 'none';
      compareNowBtn.style.display = visible ? '' : 'none';
      if (window.t) compareNowBtn.title = window.t('compare_now_btn_title');
      compareNowBtn.addEventListener('click', () => {
        const row2 = document.getElementById('datetimeRoute2Row');
        const compareActive = row2 && row2.style.display !== 'none';
        if (!compareActive) return;

        // Validate that a route is loaded before proceeding
        const routeValidation = window.validateRouteLoaded();
        if (!routeValidation.valid) {
          if (window.setNotice) window.setNotice(routeValidation.error, 'error');
          return;
        }

        const a = document.getElementById('datetimeRoute')?.value || '';
        const b = document.getElementById('datetimeRoute2')?.value || '';
        if (a.length < 16 || b.length < 16) {
          console.debug('[compare] Please select both Date A and Date B before running compare');
          return;
        }
        if (window.cw?.runCompareDatesMode) {
          // explicitCompareActive doesn't block the user clicking Run; here this is the Run button handler
          window.cw.runCompareDatesMode();
        }
      });
    }

    // Presets
    const speedPresetsEl = document.getElementById("speedPresets");
    if (speedPresetsEl) {
      speedPresetsEl.addEventListener("change", () => {
        const v = speedPresetsEl.value;
        if (!v) return;
        const cs = document.getElementById("cyclingSpeed");
        if (cs) cs.value = v;
        window.lastAppliedSpeed = Number(v);
        window.saveSettings();
        // Check mode: if we're in compare-dates (row2 visible) do NOT auto-refresh here.
        // Just save the speed and let the user trigger the compare explicitly with the Run button.
        const row2 = document.getElementById('datetimeRoute2Row');
        const compareActive = row2 && row2.style.display !== 'none';
        if (compareActive) {
          return;
        }
        // Otherwise behave as before for compare-mode (provider compare) or normal reload
        if (window.apiSource === "compare" && window.cw?.runCompareMode) {
          window.cw.runCompareMode();
        } else {
          window.reloadFull();
        }
        // Re-validate weather alerts when speed changes
        if (window.revalidateWeatherAlerts) {
          window.revalidateWeatherAlerts();
        }
      });
    }

    // Manual speed input
    const cyclingInput = document.getElementById("cyclingSpeed");
    if (cyclingInput) {
      cyclingInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          window.lastAppliedSpeed = Number(cyclingInput.value);
          window.saveSettings();
          // If in compare-dates mode, do NOT auto-refresh on Enter; user should press Run
          const row2 = document.getElementById('datetimeRoute2Row');
          const compareActive = row2 && row2.style.display !== 'none';
          if (compareActive) return;
          if (window.apiSource === "compare" && window.cw?.runCompareMode) {
            window.cw.runCompareMode();
          } else {
            window.reloadFull();
          }
        }
        // Re-validate weather alerts when speed changes
        if (window.revalidateWeatherAlerts) {
          window.revalidateWeatherAlerts();
        }
      });
      cyclingInput.addEventListener("blur", () => {
        const v = Number(cyclingInput.value);
        if (!Number.isFinite(v)) return;
        if (window.lastAppliedSpeed === null || Number(v) !== Number(window.lastAppliedSpeed)) {
          window.lastAppliedSpeed = Number(v);
          window.saveSettings();
          // If in compare-dates mode, do NOT auto-refresh on blur; user should press Run
          const row2 = document.getElementById('datetimeRoute2Row');
          const compareActive = row2 && row2.style.display !== 'none';
          if (compareActive) return;
          if (window.apiSource === "compare" && window.cw?.runCompareMode) {
            window.cw.runCompareMode();
          } else {
            window.reloadFull();
          }
        }
        // Re-validate weather alerts when speed changes
        if (window.revalidateWeatherAlerts) {
          window.revalidateWeatherAlerts();
        }
      });
      cyclingInput.addEventListener("input", () => {
        const presets = document.getElementById("speedPresets");
        if (!presets) return;
        const val = cyclingInput.value;
        const opt = Array.from(presets.options).find(o => o.value === val);
        presets.value = opt ? opt.value : "";
      });
    }

    // API key test buttons
    const chk = document.getElementById("checkApiKey");
    if (chk) chk.addEventListener("click", testMeteoBlueKey);

    const chkOW = document.getElementById("checkApiKeyOW");
    if (chkOW) chkOW.addEventListener("click", testOpenWeatherKey);

    const sel = document.getElementById('apiSource');
    if (sel) {
      sel.addEventListener('change', function(ev){
        try {
          apiSource = sel.value;
          saveSettings();
          // Provider change notice suppressed intentionally
        } catch(e){ console.warn(e); }
      });
    }

    // Update options when API keys change so options can be enabled/disabled live
    const apiKeyEl = document.getElementById('apiKey');
    const apiKeyOWEl = document.getElementById('apiKeyOW');
    if (apiKeyEl) apiKeyEl.addEventListener('input', () => { updateProviderOptions(); });
    if (apiKeyOWEl) apiKeyOWEl.addEventListener('input', () => { updateProviderOptions(); });

    // Call update once to inject new options
    updateProviderOptions();

    // Floating quick-export-and-save GPX button (single control)
    try {
      if (window.SHOW_GENERATE_AND_SAVE_BUTTON && !document.getElementById('mr_save_gpx_btn')) {
        const btn = document.createElement('button');
        btn.id = 'mr_save_gpx_btn';
        btn.textContent = 'Generar y Guardar GPX';
        btn.style.position = 'fixed';
        btn.style.right = '12px';
        btn.style.bottom = '100px';
        btn.style.zIndex = 99999;
        btn.style.padding = '6px 4px'; // narrower padding
        btn.style.background = '#f3f4f6';
        btn.style.border = '1px solid #d1d5db';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.font = 'inherit';
        btn.style.color = '#374151';
        btn.style.marginLeft = '-2px'; // closer to file input
        btn.title = 'Generar desde la ruta actual y guardar en el share-server local';
        // The recent routes button should only toggle the menu; do not attach upload behavior here.
        // (Previously this handler exported the current route and POSTed it to /share — removed.)
        
        // Hover like file button
        btn.addEventListener('mouseenter', () => {
          btn.style.background = '#1d4ed8';
          btn.style.color = '#fff';
          btn.style.borderColor = '#1d4ed8';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = '#f3f4f6';
          btn.style.color = '#374151';
          btn.style.borderColor = '#d1d5db';
        });
        document.body.appendChild(btn);
      }
    } catch (e) { /* ignore */ }
  }

  // Expose globally
  window.setNotice = setNotice;
  window.clearNotice = clearNotice;
  window.showLoading = showLoading;
  window.hideLoading = hideLoading;
  window.toggleConfig = toggleConfig;
  window.toggleDebug = toggleDebug;
  window.applyTranslations = applyTranslations;
  window.localizeHeader = localizeHeader;
  window.updateProviderOptions = updateProviderOptions;
  window.setKeyStatus = setKeyStatus;
  window.testMeteoBlueKey = testMeteoBlueKey;
  window.testOpenWeatherKey = testOpenWeatherKey;
  window.bindUIEvents = bindUIEvents;
  window.reloadFull = reloadFull;
  window.replaceGPXMarkers = replaceGPXMarkers;

  // Via window.cw
  window.cw = window.cw || {};
  window.cw.ui = {
    setNotice,
    clearNotice,
    showLoading,
    hideLoading,
    createDiscreteLoadingIndicator,
    toggleConfig,
    toggleDebug,
    applyTranslations,
    updateProviderOptions,
    setKeyStatus,
    testMeteoBlueKey,
    testOpenWeatherKey,
    bindUIEvents,
    reloadFull,
    replaceGPXMarkers,
  uploadGPXToShareServer,
  };

  // Attach export helper and geojsonToGpx to public cw API
  try {
    window.cw.exportRouteToGpx = exportRouteToGpx;
    window.cw.geojsonToGpx = window._internal_geojsonToGpx;
  } catch (e) { /* ignore */ }

  // Accept GPX payloads via window.postMessage from external pages (e.g., userscript/extension)
  // Message format: { action: 'loadGPX', gpx: '<gpx xml string>', name: 'route.gpx' }
  (function() {
    // Allowed origin patterns for incoming postMessage (hosts you trust to send GPX)
    const allowedOriginPatterns = [
      /\.(?:komoot)\.[a-z.]+$/i, // komoot.*
      /(?:^|\.)bikemap\.net$/i,  // bikemap.net
      /^https?:\/\/localhost(?::\d+)?$/i,
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i
    ];

    function isAllowedOrigin(origin) {
      try {
        if (!origin) return true; // userscript / extension contexts may present "" origin
        let host;
        try { host = new URL(origin).hostname; } catch { host = origin.replace(/^https?:\/\//,''); }
        // Direct hostname checks for reliability
        const allowHosts = [
          'komoot.com','www.komoot.com','account.komoot.com','komoot.de','www.komoot.de','account.komoot.de',
          'bikemap.net','www.bikemap.net','web.bikemap.net','localhost','127.0.0.1'
        ];
        if (allowHosts.includes(host)) return true;
  // Subdomains of komoot.* allowed
  if (/\.komoot\.(com|de)$/i.test(host)) return true;
  // Subdomains of bikemap.net allowed
  if (/\.bikemap\.net$/i.test(host)) return true;
        return false;
      } catch (e) { return false; }
    }

    function simpleHash(str) {
      let h = 0, i = 0, len = str.length;
      while (i < len) { h = (h * 31 + str.charCodeAt(i++)) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8);
    }

    window.addEventListener('message', function (ev) {
      try {
        const msg = ev && ev.data;
        if (!msg || msg.action !== 'loadGPX' || !msg.gpx) return;
        // Validate origin
        const allowed = isAllowedOrigin(ev.origin);
        if (!allowed) {
          console.warn('[MeteoRide] Rejected loadGPX postMessage from origin', ev.origin);
          try { ev.source && ev.source.postMessage({ action: 'loadGPX:ack', ok: false, reason: 'forbidden_origin' }, ev.origin || '*'); } catch(_) {}
          return;
        }
        const name = msg.name || 'route.gpx';
        const size = msg.gpx.length;
        const hs = simpleHash(msg.gpx);
        console.log('[MeteoRide] Accepted loadGPX postMessage origin=' + ev.origin + ' name=' + name + ' size=' + size + ' hash=' + hs);
        window.logDebug && window.logDebug('Received GPX via postMessage from ' + ev.origin + ' name=' + name + ' size=' + size + ' hash=' + hs);
        // Create a Blob/File-like object so reloadFull and other flows can reuse it
        const blob = new Blob([msg.gpx], { type: 'application/gpx+xml' });
        // Try to set a name property for compatibility
        try { blob.name = name; } catch (e) { /* ignore */ }
        window.lastGPXFile = blob;
        // Save to recent routes (same as when loading from file input)
        if (typeof window.saveRecentRoute === 'function') {
          window.saveRecentRoute(blob);
        }
        // If the app exposes the programmatic loader, use it; otherwise fall back to reloadFull
        if (typeof window.cwLoadGPXFromString === 'function') {
          try { window.cwLoadGPXFromString(msg.gpx, name); } catch (e) {
            // Fallback: let reloadFull read window.lastGPXFile
            window.reloadFull();
          }
        } else {
          window.reloadFull();
        }
        try { ev.source && ev.source.postMessage({ action: 'loadGPX:ack', ok: true, name, size }, ev.origin || '*'); } catch(_) {}
      } catch (e) {
        console.warn('postMessage loadGPX error', e);
        try { ev.source && ev.source.postMessage({ action: 'loadGPX:ack', ok: false, reason: 'exception' }, ev.origin || '*'); } catch(_) {}
      }
    }, false);
  })();

  // Defensive: ensure translations and header localization run when DOM is ready
  try {
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => {
        try { if (typeof applyTranslations === 'function') applyTranslations(); } catch (e) { /* ignore */ }
        try { if (typeof localizeHeader === 'function') localizeHeader(); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }

  // GPX Recent Routes Storage Functions (IndexedDB-backed with in-memory cache)
  const RECENT_ROUTES_KEY = 'meteoride_recent_routes'; // kept for backward compatibility
  const MAX_RECENT_ROUTES = 3;
  // Maximum size (in bytes) allowed for storing a recent route in the UI cache.
  // Increased from the original 50KB to 750KB to support longer routes (~250k-750k text length).
  const MAX_RECENT_ROUTE_SIZE = 750000;

  const IDB_DB_NAME = 'meteoride_recent_routes_db';
  const IDB_STORE = 'routes';
  const IDB_VERSION = 1;

  let recentRoutesCache = [];
  let recentRoutesDisabled = false;

  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));
      const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;
        try {
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            const store = db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('ts', 'timestamp', { unique: false });
          }
        } catch (e) { /* ignore */ }
      };
      req.onsuccess = function (ev) { resolve(ev.target.result); };
      req.onerror = function (ev) { reject(ev.target.error || new Error('IDB open failed')); };
      req.onblocked = function () { console.warn('[MeteoRide] openIDB: blocked'); };
    });
  }

  // Return metadata for the most recent routes (no blob content) limited to MAX_RECENT_ROUTES.
  async function idbGetAllRoutes() {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const index = store.index ? store.index('ts') : null;
        const results = [];
        // Iterate newest first using the timestamp index (descending)
        const source = index || store;
        const req = (index ? index.openCursor(null, 'prev') : store.openCursor(null, 'prev'));
        req.onsuccess = function (ev) {
          const cursor = ev.target.result;
          if (!cursor) return resolve(results.slice(0, MAX_RECENT_ROUTES));
          const v = cursor.value || {};
          // push metadata only (do not expose blob/content)
          results.push({ id: v.id || cursor.primaryKey || null, name: v.name, size: v.size, lastModified: v.lastModified, timestamp: v.timestamp });
          if (results.length >= MAX_RECENT_ROUTES) return resolve(results.slice(0, MAX_RECENT_ROUTES));
          cursor.continue();
        };
        req.onerror = function () { reject(req.error || new Error('cursor failed')); };
      });
    } catch (e) {
      console.warn('[MeteoRide] idbGetAllRoutes failed, falling back to localStorage', e);
      // Fallback: try read from localStorage (legacy) — these entries have `content` string
      try {
        const stored = localStorage.getItem(RECENT_ROUTES_KEY);
        const routes = stored ? JSON.parse(stored) : [];
        const filtered = routes.filter(r => r.content && r.content.length > 0).slice(0, MAX_RECENT_ROUTES);
        // Convert to metadata shape
        return filtered.map(r => ({ id: null, name: r.name, size: r.size, lastModified: r.lastModified, timestamp: r.timestamp }));
      } catch (err) {
        return [];
      }
    }
  }

  // Read a full route record (including blob) by id
  async function idbGetRouteById(id) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('get failed'));
      });
    } catch (e) {
      console.warn('[MeteoRide] idbGetRouteById failed', e);
      return null;
    }
  }

  // Add a single route record (with blob) and trim store to MAX_RECENT_ROUTES.
  async function idbAddRoute(route) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const addReq = store.add(route);
        addReq.onsuccess = async function (ev) {
          try {







            // Trim oldest if necessary
            const keysReq = store.getAllKeys();
            keysReq.onsuccess = function () {
              const keys = keysReq.result || [];
              // keys are in insertion order; to be safe, read all records sorted by timestamp
              const listReq = store.getAll();
              listReq.onsuccess = function () {
                const all = listReq.result || [];
                all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const toDelete = all.slice(MAX_RECENT_ROUTES).map(x => x.id || null).filter(x => x != null);
                if (!toDelete.length) return resolve(addReq.result);
                let i = 0;
                function delNext() {
                  if (i >= toDelete.length) return resolve(addReq.result);
                  const dreq = store.delete(toDelete[i++]);
                  dreq.onsuccess = () => delNext();
                  dreq.onerror = () => reject(dreq.error || new Error('delete failed'));
                }
                delNext();
              };
              listReq.onerror = () => resolve(addReq.result);
            };
            keysReq.onerror = () => resolve(addReq.result);
          } catch (e) {
            resolve(addReq.result);
          }
        };
        addReq.onerror = () => reject(addReq.error || new Error('add failed'));
      });
    } catch (e) {
      console.warn('[MeteoRide] idbAddRoute failed', e);
      throw e;
    }
  }

  // Find a route record by name (returns full record or null)
  async function idbFindRouteByName(name) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.openCursor();
        req.onsuccess = function (ev) {
          const cursor = ev.target.result;
          if (!cursor) return resolve(null);
          const v = cursor.value || {};
          if (v.name === name) return resolve(Object.assign({ id: cursor.primaryKey }, v));
          cursor.continue();
        };
        req.onerror = function () { reject(req.error || new Error('cursor failed')); };
      });
    } catch (e) {
      console.warn('[MeteoRide] idbFindRouteByName failed', e);
      return null;
    }
  }

  // Put (insert or replace) a route record; returns the record id/key
  async function idbPutRoute(route) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        // If route includes id, ensure we set it on the object so put replaces
        const obj = { name: route.name, size: route.size, lastModified: route.lastModified, timestamp: route.timestamp };
        if (route.blob) obj.blob = route.blob;
        if (route.id != null) obj.id = route.id;
        const req = store.put(obj);
        req.onsuccess = function (ev) { resolve(ev.target.result); };
        req.onerror = function () { reject(req.error || new Error('put failed')); };
      });
    } catch (e) {
      console.warn('[MeteoRide] idbPutRoute failed', e);
      throw e;
    }
  }

  // Delete a route record by id
  async function idbDeleteRoute(id) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.delete(id);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error || new Error('delete failed')); };
      });
    } catch (e) {
      console.warn('[MeteoRide] idbDeleteRoute failed', e);
      throw e;
    }
  }

  async function idbSaveAll(routes) {
    // Keep for compatibility but delegate to adding individual routes with blob support.
    try {
      // Clear and re-add: convert routes to objects that may include blob
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const clearReq = store.clear();
        clearReq.onsuccess = async function () {
          try {
            for (let i = 0; i < routes.length; i++) {
              // route may contain 'blob' or 'content' (fallback)
              const r = routes[i];
              const obj = { name: r.name, size: r.size, lastModified: r.lastModified, timestamp: r.timestamp };
              if (r.blob) obj.blob = r.blob; else if (r.content) obj.blob = new Blob([r.content], { type: 'application/gpx+xml' });
              // eslint-disable-next-line no-await-in-loop
              await new Promise((res, rej) => {
                const areq = store.add(obj);
                areq.onsuccess = () => res(true);
                areq.onerror = () => rej(areq.error || new Error('add failed'));
              });
            }
            resolve(true);
          } catch (e) { reject(e); }
        };
        clearReq.onerror = () => reject(clearReq.error || new Error('clear failed'));
      });
    } catch (e) {
      console.warn('[MeteoRide] idbSaveAll failed', e);
      throw e;
    }
  }

  async function migrateFromLocalStorage() {
    try {
      const stored = localStorage.getItem(RECENT_ROUTES_KEY);
      if (!stored) return;
      let routes = JSON.parse(stored || '[]');
      routes = routes.filter(r => r && r.content && r.content.length > 0);
      if (!routes.length) {
        localStorage.removeItem(RECENT_ROUTES_KEY);
        return;
      }
      // Convert to limited array, newest first
      routes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      routes = routes.slice(0, MAX_RECENT_ROUTES);
      // Convert each legacy string entry into a blob record and add
      for (const r of routes) {
        const blob = new Blob([r.content], { type: 'application/gpx+xml' });
        const obj = { name: r.name, size: r.size || (r.content ? r.content.length : 0), lastModified: r.lastModified || Date.now(), timestamp: r.timestamp || Date.now(), blob };
        try { await idbAddRoute(obj); } catch (e) { /* ignore individual errors */ }
      }
      localStorage.removeItem(RECENT_ROUTES_KEY);
      console.log('[MeteoRide] migrateFromLocalStorage: migrated', routes.length, 'routes to IndexedDB');
    } catch (e) {
      console.warn('[MeteoRide] migrateFromLocalStorage: failed', e);
    }
  }

  // Clean duplicates from IndexedDB and cache
  async function cleanDuplicateRoutes() {
    try {
      console.log('[MeteoRide] cleanDuplicateRoutes: Starting cleanup...');
      const allRoutes = await idbGetAllRoutes();
      
      // Group by name and find duplicates
      const nameGroups = {};
      allRoutes.forEach(route => {
        if (!nameGroups[route.name]) {
          nameGroups[route.name] = [];
        }
        nameGroups[route.name].push(route);
      });

      let duplicatesRemoved = 0;
      
      // For each group with duplicates, keep only the most recent one
      for (const [name, routes] of Object.entries(nameGroups)) {
        if (routes.length > 1) {
          // Sort by timestamp (most recent first)
          routes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          
          // Keep the first (most recent), delete the rest
          for (let i = 1; i < routes.length; i++) {
            try {
              await idbDeleteRoute(routes[i].id);
              duplicatesRemoved++;
              console.log('[MeteoRide] cleanDuplicateRoutes: Removed duplicate', routes[i].name, 'id=', routes[i].id);
            } catch (e) {
              console.warn('[MeteoRide] cleanDuplicateRoutes: Failed to delete duplicate id=', routes[i].id, e);
            }
          }
        }
      }

      // Reload cache from cleaned DB
      if (duplicatesRemoved > 0) {
        recentRoutesCache = await idbGetAllRoutes();
        updateRecentRoutesUI();
        console.log('[MeteoRide] cleanDuplicateRoutes: Removed', duplicatesRemoved, 'duplicates, cache updated');
      } else {
        console.log('[MeteoRide] cleanDuplicateRoutes: No duplicates found');
      }
    } catch (e) {
      console.error('[MeteoRide] cleanDuplicateRoutes: Exception:', e);
    }
  }

  // Synchronous accessor (returns in-memory cache)
  function getRecentRoutes() {
    try {
      console.log('[MeteoRide] getRecentRoutes: returning cache length', recentRoutesCache.length);
      return recentRoutesCache.slice();
    } catch (e) {
      console.error('[MeteoRide] getRecentRoutes: Exception:', e);
      return [];
    }
  }

  function updateRecentRoutesUI() {
    console.log('[MeteoRide] updateRecentRoutesUI: Starting');
    const routes = getRecentRoutes();
    console.log('[MeteoRide] updateRecentRoutesUI: Found routes:', routes.length);
    
    const container = document.getElementById('recentRoutesContainer');
    console.log('[MeteoRide] updateRecentRoutesUI: Container found?', !!container);

    if (!container) {
      console.error('[MeteoRide] updateRecentRoutesUI: Container not found!');
      return;
    }

    // Option: make the UI button-only (hide native select and badge).
    // Set to true if you want the same visual on desktop and mobile.
    const BUTTON_ONLY_UI = true;

    if (routes.length === 0) {
      // Keep container hidden when no recent routes exist
      container.style.display = 'none';
      console.log('[MeteoRide] updateRecentRoutesUI: No routes, hiding container');
      return;
    }

    // Show a compact dropdown (select) to save space. The select loads the route on change (lazy blob retrieval).
    container.innerHTML = '';
    container.style.display = 'inline-block';
    console.log('[MeteoRide] updateRecentRoutesUI: Showing container with', routes.length, 'routes (dropdown)');

    // Helper: localized placeholder text for recent routes (fallback) --- we will also try the project's i18n
    function recentRoutesPlaceholderTextFallback(count) {
      try {
        const docLang = (document && document.documentElement && document.documentElement.lang) ? document.documentElement.lang.split('-')[0] : (navigator.language || 'en').split('-')[0];
        if (docLang && docLang.toLowerCase().startsWith('es')) {
          return count === 1 ? `${count} ruta reciente` : `${count} rutas recientes`;
        }
      } catch (_e) { /* ignore */ }
      return count === 1 ? `${count} recent route` : `${count} recent routes`;
    }

    // Attempt to use project's translation key 'recent_routes_count' with a count param.
    let pText = recentRoutesPlaceholderTextFallback(routes.length);
    if (typeof window.t === 'function') {
      const maybe = window.t('recent_routes_count', { n: routes.length });
      if (maybe && typeof maybe === 'string' && maybe !== 'recent_routes_count') {
        pText = maybe.replace('{{n}}', routes.length).replace('{n}', routes.length);
      }
    }

    // Button-only UI: no select or badge created

    // Create an icon button + popup menu for small screens to avoid layout issues
    const btn = document.createElement('button');
    btn.id = 'recentRoutesButton';
    btn.className = 'recent-routes-button';
  btn.type = 'button';
  // Accessible label / tooltip text
  btn.title = pText;
  btn.setAttribute('aria-label', pText);
  btn.setAttribute('aria-haspopup', 'true');
  // nicer SVG icon (hamburger) and data-tooltip for custom tooltip styling
  btn.setAttribute('data-tooltip', pText);
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\n      <path d="M3 6h18"></path>\n      <path d="M3 12h18"></path>\n      <path d="M3 18h18"></path>\n    </svg>';
    // Style like the file upload button
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.style.padding = '6px 4px'; // narrower padding
    btn.style.background = '#f3f4f6';
    btn.style.border = '1px solid #d1d5db';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.font = 'inherit';
    btn.style.color = '#374151';
    btn.style.marginLeft = '-2px'; // closer to file input
    // Hover like file button
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#1d4ed8';
      btn.style.color = '#fff';
      btn.style.borderColor = '#1d4ed8';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '#f3f4f6';
      btn.style.color = '#374151';
      btn.style.borderColor = '#d1d5db';
    });
    container.appendChild(btn);

    const menu = document.createElement('div');
    menu.id = 'recentRoutesMenu';
    menu.className = 'recent-routes-menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = 1200;
    menu.style.minWidth = '180px';
    menu.style.background = '#fff';
    menu.style.border = '1px solid #ccc';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
    menu.style.borderRadius = '6px';
    menu.style.padding = '6px 6px';
    menu.style.maxHeight = '60vh';
    menu.style.overflow = 'auto';
    menu.style.display = 'none';
    container.appendChild(menu);

    // Build menu items
    function rebuildMenuItems() {
      menu.innerHTML = '';
      routes.forEach((route, idx) => {
        const it = document.createElement('div');
        it.className = 'recent-routes-menu-item';
        it.style.padding = '6px 8px';
        it.style.cursor = 'pointer';
        it.style.borderRadius = '4px';
        it.style.fontSize = '14px';
        it.style.fontFamily = 'Arial, sans-serif';
        it.textContent = (route.name || '').replace(/\.[^/.]+$/, "");
        it.addEventListener('click', async function () {
          try {
            // behave like selecting the option
            const route = routes[idx];
            let full = null;
            if (route.id != null) full = await idbGetRouteById(route.id);
            if (!full) {
              try {
                const stored = localStorage.getItem(RECENT_ROUTES_KEY);
                const arr = stored ? JSON.parse(stored) : [];
                const found = arr.find(r => r.name === route.name && r.timestamp === route.timestamp);
                if (found) full = { name: found.name, size: found.size, lastModified: found.lastModified, timestamp: found.timestamp, blob: new Blob([found.content], { type: 'application/gpx+xml' }) };
              } catch (_) { /* ignore */ }
            }
            if (!full) {
              console.warn('[MeteoRide] recentRoutesMenu: Could not retrieve route content for', route.name);
              return;
            }
            await loadRecentRoute(full);
          } catch (e) { console.error(e); }
          hideMenu();
        });
        menu.appendChild(it);
      });
    }

    function showMenu() {
      rebuildMenuItems();
      const rect = btn.getBoundingClientRect();
      const margin = 8;

      // Make visible but hidden to measure dimensions
      menu.style.display = 'block';
      menu.style.visibility = 'hidden';

      // Allow browser to compute sizes
      const mw = menu.offsetWidth || parseInt(getComputedStyle(menu).minWidth) || 180;
      const mh = menu.offsetHeight || menu.scrollHeight || Math.min(window.innerHeight * 0.6, 300);

      // Compute left so menu fits in viewport
      let left = rect.left;
      if (left + mw + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - mw - margin);
      }
      if (left < margin) left = margin;

      // Compute top: prefer below button, but open above if not enough space
      let top = rect.bottom + 6;
      if (top + mh + margin > window.innerHeight) {
        const altTop = rect.top - mh - 6;
        if (altTop >= margin) top = altTop; else top = Math.max(margin, window.innerHeight - mh - margin);
      }

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = 'visible';
      document.addEventListener('click', outsideClickHandler);
    }

    function hideMenu() {
      menu.style.display = 'none';
      document.removeEventListener('click', outsideClickHandler);
    }

    function outsideClickHandler(ev) {
      if (!menu.contains(ev.target) && ev.target !== btn) hideMenu();
    }

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (menu.style.display === 'block') hideMenu(); else showMenu();
    });

    // Responsiveness: show button / hide select on small screens
    function adaptForScreen() {
      const isSmall = window.innerWidth <= 420;
      if (BUTTON_ONLY_UI) {
        // Force button-only UI regardless of screen size
        try { select.style.display = 'none'; } catch(_){}
        try { badge.style.display = 'none'; } catch(_){}
        try { btn.style.display = 'inline-flex'; } catch(_){}
      } else {
        if (isSmall) { select.style.display = 'none'; badge.style.display = 'none'; btn.style.display = 'inline-block'; } else { select.style.display = ''; badge.style.display = (badge.textContent? 'inline-block':'none'); btn.style.display = 'none'; hideMenu(); }
      }
    }
    window.addEventListener('resize', adaptForScreen);
    adaptForScreen();
    // Apply translations for the rest of the UI, then set the placeholder with the correct count
    try { if (typeof applyTranslations === 'function') applyTranslations(); } catch (_e) {}
    try {
      if (typeof window.t === 'function') {
        // Explicitly set placeholder using t with the count so {n} is replaced
        const localized = window.t('recent_routes_count', { n: routes.length });
        const opt0 = select.options && select.options[0];
        if (opt0) opt0.textContent = localized;
      }
    } catch (_e) { /* ignore */ }
    
    console.log('[MeteoRide] updateRecentRoutesUI: Completed');
  }

  async function saveRecentRoute(file) {
    try {
      if (recentRoutesDisabled) {
        console.log('[MeteoRide] saveRecentRoute: recent routes disabled, skipping');
        return;
      }
      console.log('[MeteoRide] saveRecentRoute: Starting to save route', file.name, 'size:', file.size);

      // Skip files that are too large (configurable) to avoid huge storage usage in the UI
      if (file.size > MAX_RECENT_ROUTE_SIZE) {
        console.log('[MeteoRide] saveRecentRoute: File too large (', file.size, 'bytes), skipping save; limit=', MAX_RECENT_ROUTE_SIZE);
        return;
      }

      // We store the original file as a Blob in IndexedDB and only keep metadata in memory.
      try {
        const blob = file instanceof Blob ? file : new Blob([file], { type: 'application/gpx+xml' });
        const routeRecord = { name: file.name, size: file.size, lastModified: file.lastModified, timestamp: Date.now(), blob };

        // Always overwrite if a route with same name exists
        try {
          const existing = await idbFindRouteByName(file.name);
          if (existing && existing.id != null) {
            // Overwrite existing record
            routeRecord.id = existing.id;
            const id = await idbPutRoute(routeRecord);
            console.log('[MeteoRide] saveRecentRoute: overwrote existing IndexedDB id=', id);
            // Update in-memory metadata cache
            const meta = { id: id, name: file.name, size: file.size, lastModified: file.lastModified, timestamp: routeRecord.timestamp };
            const existingIndex = recentRoutesCache.findIndex(r => r.name === meta.name);
            if (existingIndex !== -1) recentRoutesCache.splice(existingIndex, 1);
            recentRoutesCache.unshift(meta);
            if (recentRoutesCache.length > MAX_RECENT_ROUTES) recentRoutesCache.splice(MAX_RECENT_ROUTES);
            updateRecentRoutesUI();
            return;
          }
          // Otherwise add new
          const id = await idbAddRoute(routeRecord);
          // Update in-memory metadata cache
          const meta = { id: id, name: file.name, size: file.size, lastModified: file.lastModified, timestamp: routeRecord.timestamp };
          const existingIndex = recentRoutesCache.findIndex(r => r.name === meta.name);
          if (existingIndex !== -1) recentRoutesCache.splice(existingIndex, 1);
          recentRoutesCache.unshift(meta);
          if (recentRoutesCache.length > MAX_RECENT_ROUTES) recentRoutesCache.splice(MAX_RECENT_ROUTES);

          console.log('[MeteoRide] saveRecentRoute: persisted blob to IndexedDB id=', id);
          updateRecentRoutesUI();
          return;
        } catch (idbErr) {
          console.warn('[MeteoRide] saveRecentRoute: IndexedDB add failed, attempting fallback to localStorage', idbErr);
          // Fallback: try to read as text and save a single newest route to localStorage
          try {
            const txt = await file.text();
            const compressedContent = txt.replace(/\s+/g, ' ').trim();
            // Overwrite by name in localStorage fallback
            try {
              const stored = localStorage.getItem(RECENT_ROUTES_KEY);
              let arr = stored ? JSON.parse(stored) : [];
              // Remove any existing with same name
              arr = arr.filter(r => r.name !== file.name);
              arr.unshift({ name: file.name, size: file.size, lastModified: file.lastModified, timestamp: Date.now(), content: compressedContent });
              arr = arr.slice(0, MAX_RECENT_ROUTES);
              localStorage.setItem(RECENT_ROUTES_KEY, JSON.stringify(arr));
            } catch (_){ /* ignore localStorage write errors */ }
            // Remove any existing with same name from cache before adding
            const existingIndex = recentRoutesCache.findIndex(r => r.name === file.name);
            if (existingIndex !== -1) recentRoutesCache.splice(existingIndex, 1);
            recentRoutesCache.unshift({ id: null, name: file.name, size: file.size, lastModified: file.lastModified, timestamp: Date.now() });
            if (recentRoutesCache.length > MAX_RECENT_ROUTES) recentRoutesCache.splice(MAX_RECENT_ROUTES);
            updateRecentRoutesUI();
            return;
          } catch (txtErr) {
            console.error('[MeteoRide] saveRecentRoute: Fallback localStorage failed, disabling recent routes', txtErr);
            recentRoutesDisabled = true;
            try { localStorage.removeItem(RECENT_ROUTES_KEY); } catch(_){ }
            updateRecentRoutesUI();
            return;
          }
        }
      } catch (e) {
        console.error('[MeteoRide] saveRecentRoute: Exception while storing blob:', e);
      }
    } catch (e) {
      console.error('[MeteoRide] saveRecentRoute: Exception:', e);
    }
  }

  async function loadRecentRoute(routeData) {
    try {
      console.log('[MeteoRide] loadRecentRoute: Starting to load route', routeData.name || routeData.name);

      // routeData may be a full record (with blob) or metadata (with id). If metadata, fetch full record.
      let full = routeData;
      if (!routeData.blob && routeData.id != null) {
        full = await idbGetRouteById(routeData.id);
      }
      // Fallback: if we still don't have a blob but have 'content', create a blob
      if (!full) {
        console.warn('[MeteoRide] loadRecentRoute: Full record not found for', routeData.name);
        return;
      }
      if (!full.blob && full.content) {
        full.blob = new Blob([full.content], { type: 'application/gpx+xml' });
      }

      // If still no blob, try to find any string field that looks like GPX content
      if (!full.blob) {
        const keys = Object.keys(full || {});
        let found = null;
        for (const k of keys) {
          try {
            const v = full[k];
            if (typeof v === 'string' && v.length > 20 && /<gpx|<trk|<trkseg|<wpt/i.test(v)) {
              found = { key: k, value: v };
              break;
            }
          } catch (_e) { /* ignore */ }
        }
        if (found) {
          console.log('[MeteoRide] loadRecentRoute: Recovered GPX text from field', found.key);
          full.blob = new Blob([found.value], { type: 'application/gpx+xml' });
        }
      }

      if (!full.blob) {
        console.warn('[MeteoRide] loadRecentRoute: No blob/content available for', full.name, 'record=', full);
        return;
      }

      // Create a File object from the stored blob so existing flows that rely on File work unchanged
      const file = new File([full.blob], full.name || routeData.name, { type: 'application/gpx+xml', lastModified: full.lastModified || Date.now() });
      console.log('[MeteoRide] loadRecentRoute: Created File object, size:', file.size);

      window.lastGPXFile = file;
      console.log('[MeteoRide] loadRecentRoute: Set window.lastGPXFile');

      const rutaBase = routeData.name.replace(/\.[^/.]+$/, "");
      const rutaEl = document.getElementById("rutaName");
      if (rutaEl) {
        rutaEl.textContent = rutaBase ? rutaBase : "";
        console.log('[MeteoRide] loadRecentRoute: Updated rutaName to', rutaBase);
      }

      if (typeof window.reloadFull === 'function') {
        console.log('[MeteoRide] loadRecentRoute: Calling window.reloadFull()');
        window.reloadFull();
      } else {
        console.error('[MeteoRide] loadRecentRoute: window.reloadFull not available');
      }

      // Move this route to the top of the in-memory cache and persist
      try {
        const idx = recentRoutesCache.findIndex(r => r.name === routeData.name && r.size === routeData.size);
        if (idx > 0) {
          const [r] = recentRoutesCache.splice(idx, 1);
          recentRoutesCache.unshift(r);
          await idbSaveAll(recentRoutesCache);
          updateRecentRoutesUI();
          console.log('[MeteoRide] loadRecentRoute: Moved route to top');
        }
      } catch (e) {
        console.warn('[MeteoRide] loadRecentRoute: failed to reorder/persist recent routes', e);
      }

      console.log('[MeteoRide] loadRecentRoute: Completed successfully');
    } catch (e) {
      console.error('[MeteoRide] loadRecentRoute: Exception:', e);
    }
  }

  // Initialize UI event listeners and recent routes
  function initUI() {
    console.log('[MeteoRide] initUI: Starting initialization');
    // Migrate any legacy localStorage entries into IndexedDB and populate cache
    (async function() {
      try {
        await migrateFromLocalStorage();
        recentRoutesCache = await idbGetAllRoutes();
        console.log('[MeteoRide] initUI: loaded recentRoutesCache length=', recentRoutesCache.length);
        
        // Clean any duplicate routes
        await cleanDuplicateRoutes();
      } catch (e) {
        console.warn('[MeteoRide] initUI: failed to load recent routes from IDB, will use fallback', e);
        try {
          const stored = localStorage.getItem(RECENT_ROUTES_KEY);
          recentRoutesCache = stored ? JSON.parse(stored) : [];
        } catch (_) { recentRoutesCache = []; }
      }
      updateRecentRoutesUI();
    })();




    const gpxFileEl = document.getElementById("gpxFile");
    console.log('[MeteoRide] initUI: gpxFileEl found?', !!gpxFileEl);
    
    if (gpxFileEl) {
      gpxFileEl.addEventListener("change", function () {
        console.log('[MeteoRide] initUI: File input changed, files:', this.files.length);
        if (!this.files.length) {
          window.lastGPXFile = null;
          console.log('[MeteoRide] initUI: No files selected');
          return;
        }
        const file = this.files[0];
        console.log('[MeteoRide] initUI: Processing file', file.name, 'size:', file.size);
        window.lastGPXFile = file;

        // Save to recent routes
        saveRecentRoute(file);

        // Update UI
        const val = (file.name) || (this.value.split("\\").pop() || this.value.split("/").pop() || "");
        const rutaBase = val.replace(/\.[^/.]+$/, "");
        const rutaEl = document.getElementById("rutaName");
        if (rutaEl) {
          rutaEl.textContent = rutaBase ? rutaBase : "";
          console.log('[MeteoRide] initUI: Updated rutaName to', rutaBase);
        }

        // Trigger reload
        if (typeof window.reloadFull === 'function') {
          console.log('[MeteoRide] initUI: Calling window.reloadFull()');
          window.reloadFull();
        } else {
          console.error('[MeteoRide] initUI: window.reloadFull not available');
        }
      });
      console.log('[MeteoRide] initUI: File input event listener added');
    }

    // Initialize recent routes UI
    console.log('[MeteoRide] initUI: Initializing recent routes UI');
    updateRecentRoutesUI();
    
    console.log('[MeteoRide] initUI: Initialization completed');
  }



  // Expose init function to window
  window.initUI = initUI;
  // Expose saveRecentRoute for programmatic GPX loading (e.g., from userscript)
  window.saveRecentRoute = saveRecentRoute;

  // Call initUI on script load
  initUI();

})();
