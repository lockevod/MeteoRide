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
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      el.textContent = t(key);
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
    if (bc) bc.textContent = t("toggle_config");
    const bd = document.getElementById("toggleDebug");
    if (bd) bd.textContent = t("toggle_debug");
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
          try { window.setNotice && window.setNotice(t('api_provider_changed', { prov: firstValid.text }), 'info'); } catch(_){}
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
  function reloadFull() {
    if (!window.lastGPXFile) {
      // No mostrar mensaje cuando no hay fichero seleccionado (comportamiento silencioso)
      return;
    }
    const reader = new FileReader();
    
    reader.onload = async function (e) {
      try {
        if (window.trackLayer) window.map.removeLayer(window.trackLayer);
        window.trackLayer = new L.GPX(e.target.result, {
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
            window.logDebug(window.t("api_provider_changed", { prov: window.apiSource }));

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
        try { apiSource = sel.value; saveSettings(); window.setNotice(t('api_provider_changed', { prov: sel.options[sel.selectedIndex].text }), 'info'); }
        catch(e){ console.warn(e); }
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
})();
