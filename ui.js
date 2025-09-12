(function() {
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

  // Loading overlay
  function showLoading() {
    const el = document.getElementById("loadingOverlay");
    if (!el) return;
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
        opt2.text = 'OPW + AromeHD';
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

  function reloadFull() {
    if (!window.lastGPXFile) {
      // No mostrar mensaje cuando no hay fichero seleccionado (comportamiento silencioso)
      return;
    }
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
            document.getElementById("rutaName").textContent =
              routeName;
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
        alert(window.t("error_reading_gpx", { msg: err.message }));
        window.logDebug(window.t("error_reading_gpx", { msg: err.message }), true);
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

  // Bind UI events
  function bindUIEvents() {
    const toggleConfigEl = document.getElementById("toggleConfig");
    if (toggleConfigEl) toggleConfigEl.addEventListener("click", toggleConfig);
    
    const toggleDebugEl = document.getElementById("toggleDebug");
    if (toggleDebugEl) toggleDebugEl.addEventListener("click", toggleDebug);

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
        window.reloadFull();
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

          window.saveSettings();
          if (id === "language") window.applyTranslations();
          if (["windUnits", "tempUnits"].includes(id) && window.weatherData.length) {
            window.updateUnits();
          }
          window.reloadFull();
        });
      }
    });

    // Separate for apiSource
    const apiSourceEl = document.getElementById("apiSource");
    if (apiSourceEl) {
      apiSourceEl.addEventListener("change", () => {
        const prov = apiSourceEl.value;
        if (prov === "compare") {
          if (window.cw?.runCompareMode) window.cw.runCompareMode();
          return;
        }
        window.renderWeatherTable();
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
        window.reloadFull();
      });
    }

    // Manual speed input
    const cyclingInput = document.getElementById("cyclingSpeed");
    if (cyclingInput) {
      cyclingInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          window.lastAppliedSpeed = Number(cyclingInput.value);
          window.saveSettings();
          window.reloadFull();
        }
      });
      cyclingInput.addEventListener("blur", () => {
        const v = Number(cyclingInput.value);
        if (!Number.isFinite(v)) return;
        if (window.lastAppliedSpeed === null || Number(v) !== Number(window.lastAppliedSpeed)) {
          window.lastAppliedSpeed = Number(v);
          window.saveSettings();
          window.reloadFull();
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
  }

  // Expose globally
  window.setNotice = setNotice;
  window.clearNotice = clearNotice;
  window.showLoading = showLoading;
  window.hideLoading = hideLoading;
  window.toggleConfig = toggleConfig;
  window.toggleDebug = toggleDebug;
  window.applyTranslations = applyTranslations;
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
  };

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
          'bikemap.net','www.bikemap.net','localhost','127.0.0.1'
        ];
        if (allowHosts.includes(host)) return true;
        // Subdomains of komoot.* allowed
        if (/\.komoot\.(com|de)$/i.test(host)) return true;
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
})();
