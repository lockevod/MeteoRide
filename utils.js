(function() {
  const cacheTTL = 1000 * 60 * 30; 

  // Nuevo: traducciones minimalistas para UI y logs
  const i18n = {
    es: {
      config_saved: "Configuración guardada",
      config_loaded: "Configuración cargada",
      enter_meteoblue_key: "Introduzca API key MeteoBlue",
      missing_meteoblue_key: "Error: falta API Key MeteoBlue",
      error_http_step: "Error API paso {step}: HTTP {status}",
      error_api_step: "Error API paso {step}: {msg}",
      error_api: "Error API: {msg}",
      geojson_invalid: "Geojson inválido o vacío",
      track_too_short: "Pista demasiado corta",
      route_date_empty: "Fecha y hora ruta vacías o inválidas",
      route_date_invalid: "Fecha y hora ruta no válida: {val}",
      route_date_past: "Fecha/hora seleccionada anterior a la actual, usando fecha y hora actual",
      select_gpx: "Primero selecciona un archivo GPX.",
      error_reading_gpx: "Error leyendo GPX: {msg}",
      app_started: "App iniciada",
      route_prefix: " ",
      upload_label: "Cargar fichero",
      // añadimos emoji para mantener los iconos del header
      toggle_config: "Configuración ⚙️",
      toggle_debug: "🐞",
      toggle_help: "Ayuda ❓",
      close: "Cerrar",
      title: "🚴‍♂️ MeteoRide",
      settings_title: "Ajustes",
      api_provider_changed: "Proveedor API cambiado a {prov}",
      // nuevas claves para labels/placeholders
      provider_label: "Proveedor:",
      api_key_init: "API Key",
      api_key_label: "MeteoBlue:",
      api_key_label_ow: "OpenWeather:",
      language_label: "Idioma:",
      wind_units_label: "Viento:",
      temp_units_label: "Temperatura:",
      units_label: "Unidades/i18n",
      precip_units_label: "Lluvia:",
      distance_units_label: "Distancia:",
      route_datetime_label: "Fecha:",
      cycling_speed_label: "Velocidad:",
      interval_label: "Intervalo:",
      loading_text: "Cargando...",
      // NEW
      horizon_exceeded: "Fecha fuera de horizonte ({days} días). Algunos pasos no tendrán datos.",
      fallback_to_openmeteo: "La previsión supera {days} días; se usa Open‑Meteo como fallback.",
      // NEW: generic provider errors
      provider_key_missing: "{prov} requiere API Key.",
      provider_key_invalid: "API Key inválida para {prov}.",
      provider_quota_exceeded: "Cuota agotada o límite alcanzado en {prov}.",
      provider_http_error: "Error del proveedor {prov}: HTTP {status}.",
      // NEW
      fallback_due_error: "Error con {prov}; usando Open‑Meteo como fallback.",
      provider_disabled_after_errors: "{prov} deshabilitado tras errores repetidos.",
      // NEW: short fallback suffix to compose error+fallback messages
      fallback_short: "Fallback a Open‑Meteo.",
      // NEW: API key tester strings
      check_key: "Check",
      key_test_missing: "Introduzca primero la API Key.",
      key_testing: "Probando...",
      key_valid: "API Key válida.",
      key_invalid: "API Key inválida o prohibida.",
      key_quota: "Cuota agotada o límite alcanzado.",
      key_http_error: "Error HTTP {status}.",
      key_network_error: "Error de red: {msg}",
     notices_noncritical_label: "Mostrar avisos no críticos",
    },
    en: {
      config_saved: "Settings saved",
      config_loaded: "Settings loaded",
      enter_meteoblue_key: "Enter MeteoBlue API key",
      missing_meteoblue_key: "Error: missing MeteoBlue API key",
      error_http_step: "API error step {step}: HTTP {status}",
      error_api_step: "API error step {step}: {msg}",
      error_api: "API error: {msg}",
      geojson_invalid: "Invalid or empty GeoJSON",
      track_too_short: "Track too short",
      route_date_empty: "Route date/time empty or invalid",
      route_date_invalid: "Invalid route date/time: {val}",
      route_date_past: "Selected date/time is earlier than now, using current date/time",
      select_gpx: "Please select a GPX file first.",
      error_reading_gpx: "Error reading GPX: {msg}",
      app_started: "App started",
      route_prefix: "",
      upload_label: "Upload file",
      // añadimos emoji también para la versión en inglés
      toggle_config: "Config ⚙️",
      toggle_debug: "🐞",
      toggle_help: "Help ❓",
      close: "Close",
      title: "🚴‍♂️ MeteoRide",
      settings_title: "Settings",
      api_provider_changed: "API provider changed to {prov}",
      // new keys
      provider_label: "Provider:",
      api_key_init: "API Key",
      api_key_label: "MeteoBlue:",
      api_key_label_ow: "OpenWeather:",
      language_label: "Language:",
      wind_units_label: "Wind:",
      temp_units_label: "Temperature:",
      distance_units_label: "Distance:",
      precip_units_label: "Rain:",
      units_label: "Units/i18n",
      route_datetime_label: "Time:",
      cycling_speed_label: "Speed:",
      interval_label: "Interval:",
      loading_text: "Loading...",
      // NEW
      horizon_exceeded: "Date beyond forecast horizon ({days} days). Some steps will have no data.",
      fallback_to_openmeteo: "Forecast exceeds {days} days; using Open‑Meteo as fallback.",
      // NEW: generic provider errors
      provider_key_missing: "{prov} requires an API Key.",
      provider_key_invalid: "Invalid API Key for {prov}.",
      provider_quota_exceeded: "Quota exceeded or rate limit reached on {prov}.",
      provider_http_error: "{prov} provider error: HTTP {status}.",
      // NEW
      fallback_due_error: "Error with {prov}; using Open‑Meteo as fallback.",
      provider_disabled_after_errors: "{prov} disabled after repeated errors.",
      // NEW: short fallback suffix to compose error+fallback messages
      fallback_short: "Fallback to Open‑Meteo.",
      // NEW: API key tester strings
      check_key: "Check",
      key_test_missing: "Enter the API Key first.",
      key_testing: "Testing...",
      key_valid: "API Key valid.",
      key_invalid: "Invalid or forbidden API Key.",
      key_quota: "Quota exceeded or rate limit reached.",
      key_http_error: "HTTP error {status}.",
      key_network_error: "Network error: {msg}",
      notices_noncritical_label: "Show non‑critical notices",
    },
  };

  // NEW: restored helpers (translation, logs, settings, cache, dates, math, conversions)
  function t(key, vars = {}) {
    const lang = (getVal("language") || "es").toLowerCase();
    const dict = i18n[lang] || i18n["en"];
    let s = dict[key] || i18n["en"][key] || key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ""));
  }
  function logDebug(msg, isError = false) {
    const d = document.getElementById("debugConsole");
    if (!d) return;
    const p = document.createElement("p");
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    p.className = isError ? "error" : "info";
    d.appendChild(p);
    d.scrollTop = d.scrollHeight;
    if (isError) console.error(msg); else console.log(msg);
  }
  function saveSettings() {
    const settings = {
      language: getVal("language"),
      windUnits: getVal("windUnits"),
      tempUnits: getVal("tempUnits"),
      distanceUnits: getVal("distanceUnits"), // NEW
      precipUnits: getVal("precipUnits"),     // NEW
      cyclingSpeed: Number(getVal("cyclingSpeed")),
      apiKey: getVal("apiKey"),
      apiKeyOW: getVal("apiKeyOW"),
      apiSource: getVal("apiSource"),
      datetimeRoute: getVal("datetimeRoute"),
      intervalSelect: getVal("intervalSelect"),
     noticeAll: !!document.getElementById("noticeAll")?.checked,
    };
    localStorage.setItem("cwSettings", JSON.stringify(settings));
    logDebug(t("config_saved"));
  }
  function loadSettings() {
    const s = JSON.parse(localStorage.getItem("cwSettings") || "{}");
    [
      "language","windUnits","tempUnits","distanceUnits","precipUnits", // NEW
      "cyclingSpeed","apiKey","apiKeyOW","apiSource","datetimeRoute","intervalSelect",
    ].forEach((id) => {
      const el = document.getElementById(id);

    if (!el) return;
     if (el.type === "checkbox") el.checked = !!s[id];
     else if (s[id] != null) el.value = s[id];
    });
    if (s.apiSource) apiSource = s.apiSource;
    logDebug(t("config_loaded"));
    const csNum = Number(s.cyclingSpeed ?? document.getElementById("cyclingSpeed")?.value);
    lastAppliedSpeed = Number.isFinite(csNum) ? csNum : null;
 // Ensure noticeAll default to true when missing
  const na = document.getElementById("noticeAll");
  if (na) na.checked = (s.noticeAll !== false);
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : null;
  }
  function getCache(key) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;
      const obj = JSON.parse(item);
      if (!obj.timestamp) return null;
      if (Date.now() - obj.timestamp > cacheTTL) return null;
      return obj.data;
    } catch { return null; }
  }
  function setCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() })); } catch {}
  }
  function getValidatedDateTime() {
    const datetimeValue = getVal("datetimeRoute");
    const now = new Date();
    if (!datetimeValue) return roundUpToNextQuarterDate(now);
    const selected = new Date(datetimeValue);
    if (isNaN(selected.getTime())) return roundUpToNextQuarterDate(now);
    if (selected < now) return roundUpToNextQuarterDate(now);
    return selected;
  }
  function roundToNextQuarterISO(date = new Date()) {
    const d = new Date(date);
    const q = Math.ceil(d.getMinutes() / 15);
    const mm = (q * 15) % 60;
    let hh = d.getHours() + (q === 4 ? 1 : 0);
    if (hh >= 24) { hh = 0; d.setDate(d.getDate() + 1); }
    d.setHours(hh, mm, 0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  function roundUpToNextQuarterDate(date = new Date()) {
    const d = new Date(date.getTime());
    const q = Math.ceil(d.getMinutes() / 15);
    const mm = (q * 15) % 60;
    let hh = d.getHours() + (q === 4 ? 1 : 0);
    if (hh >= 24) { hh = 0; d.setDate(d.getDate() + 1); }
    d.setSeconds(0, 0);
    d.setMinutes(mm);
    d.setHours(hh);
    return d;
  }
  function setupDateLimits() {
    const dt = document.getElementById("datetimeRoute");
    if (!dt) return;
    dt.step = 900;
    const rounded = roundToNextQuarterISO(new Date());
    dt.min = rounded;
    if (!dt.value || new Date(dt.value) < new Date(dt.min)) dt.value = dt.min;
  }
  function haversine(p1, p2) {
    const R = 6371, toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lon - p1.lon);
    const lat1 = toRad(p1.lat), lat2 = toRad(p2.lat);
    const a = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function formatTime(d) {
    return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function isValidDate(d) { return d instanceof Date && !isNaN(d.getTime()); }
  function fmtSafe(d) { return isValidDate(d) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; }
  function updateUnits() { processWeatherData(); }
  function safeNum(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number" && !isNaN(v)) return v;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  }
  function normalUnit(p0, p1) {
    const dx = p1.lon - p0.lon, dy = p1.lat - p0.lat;
    const len = Math.hypot(dx, dy) || 1;
    return { nx: -dy / len, ny: dx / len };
  }
    // Helper: clamp value to [0,1]
  function clamp01(x) {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  // Find the closest time index in an array of ISO strings/dates
  function findClosestIndex(arr, target) {
    let minDiff = Infinity, idx = -1;
    const tgt = target instanceof Date ? target : new Date(target);
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] instanceof Date ? arr[i] : new Date(arr[i]);
      const diff = Math.abs(d - tgt);
      if (diff < minDiff) { minDiff = diff; idx = i; }
    }
    return idx;
  }
  function offsetLatLng(lat, lon, nx, ny, meters = 12) {
    const dLat = (meters / 111320) * ny;
    const dLon = (meters / (40075000 * Math.cos(lat * Math.PI/180) / 360)) * nx;
    return [lat + dLat, lon + dLon];
  }
  function beaufortIntensity(speedKmh) {
    if (speedKmh == null) return "suave";
    if (speedKmh < 12) return "suave";
    if (speedKmh < 30) return "media";
    if (speedKmh < 50) return "fuerte";
    return "muy_fuerte"; // NEW: elevated winds (purple)
  }
  function windToUnits(val, unit) { 
    if (unit === "ms") return val / 3.6; 
    if (unit === "mph") return val * 0.621371; // NEW: kmh to mph
    return val; // kmh
  }

  // NEW: pick which wind value drives the marker intensity (auto policy)
  function windIntensityValue(speedKmh, gustKmh) {
    const s = Number(speedKmh) || 0;
    const g = Number(gustKmh) || 0;
    // Use gust if clearly elevated vs sustained (>=45 or +30%)
    if (g && g >= Math.max(45, s * 1.3)) return g;
    return s;
  }

  // Provider chain utilities: choose provider based on time distance from NOW (not route start)
  // Chain spec example: { id: 'ow2_arome_openmeteo', steps: [ { provider:'openweather', fromNowHours:0, toNowHours:2 }, { provider:'aromehd', fromNowHours:2, toNowHours:36 }, { provider:'openmeteo', fromNowHours:36, toNowHours: Infinity } ] }
  const providerChains = {
    // OpenWeatherMap for first 0-2h, Arome-HD for 2-36h, OpenMeteo afterwards
    ow2_arome_openmeteo: {
      id: 'ow2_arome_openmeteo',
      label: 'OWM 0–2h → Arome 2–36h → OpenMeteo',
      steps: [
        { provider: 'openweather', fromNowHours: 0, toNowHours: 2 },
        { provider: 'aromehd', fromNowHours: 2, toNowHours: 36 },
        { provider: 'openmeteo', fromNowHours: 36, toNowHours: Infinity }
      ]
    },
    // Arome-HD -> OpenMeteo chain (Arome near-term, OpenMeteo beyond)
    arome_openmeteo: {
      id: 'arome_openmeteo',
      label: 'Arome 0–36h → OpenMeteo 36h+',
      steps: [
        { provider: 'aromehd', fromNowHours: 0, toNowHours: 36 },
        { provider: 'openmeteo', fromNowHours: 36, toNowHours: Infinity }
      ]
    }
  };

  // Map an array of timestamps to providers for the given chainId (measured from nowDate)
  function pickProvidersForRoute(chainId, timestamps, nowDate) {
    if (!Array.isArray(timestamps)) return [];
    return timestamps.map(ts => getProviderForTimestamp(chainId, ts, nowDate));
  }

  // Summarize consecutive provider assignments into segments [{provider, fromIndex, toIndex, fromTime, toTime}]
  function summarizeProviderSegments(providerList, timestamps) {
    const segs = [];
    if (!Array.isArray(providerList) || providerList.length === 0) return segs;
    let curProv = providerList[0];
    let startIdx = 0;
    for (let i = 1; i < providerList.length; i++) {
      if (providerList[i] !== curProv) {
        segs.push({ provider: curProv, fromIndex: startIdx, toIndex: i - 1, fromTime: timestamps[startIdx], toTime: timestamps[i - 1] });
        curProv = providerList[i];
        startIdx = i;
      }
    }
    // final
    segs.push({ provider: curProv, fromIndex: startIdx, toIndex: providerList.length - 1, fromTime: timestamps[startIdx], toTime: timestamps[providerList.length - 1] });
    return segs;
  }

  // Resolve provider for a given chainId or plain provider id. Returns a provider id string.
  function resolveProviderForTimestamp(chainOrProvider, timestamp, nowDate, coords) {
    if (!chainOrProvider) return null;
    const s = String(chainOrProvider).toLowerCase();

    // If it's a known chain, pick the provider for this timestamp (steps use canonical provider ids)
    if (providerChains[s]) {
      const candidate = getProviderForTimestamp(s, timestamp, nowDate);
      // If candidate is operational at coords, return it.
      if (isProviderOperational(candidate, coords?.lat, coords?.lon, timestamp)) return candidate;
      // Otherwise try other steps in the chain for availability
      const chain = providerChains[s];
      for (const step of chain.steps) {
        const prov = step.provider;
        if (isProviderOperational(prov, coords?.lat, coords?.lon, timestamp)) return prov;
      }
      // fallback
      return 'openmeteo';
    }

    // Plain provider id: special-case OpenWeather without key -> force fallback to Arome/OpenMeteo
    if (s === 'openweather' && !getVal('apiKeyOW')) {
      if (isProviderOperational('aromehd', coords?.lat, coords?.lon, timestamp)) return 'aromehd';
      return 'openmeteo';
    }

    if (isProviderOperational(s, coords?.lat, coords?.lon, timestamp)) return s;
    return 'openmeteo';
  }

  // Ensure requestWeatherByChain passes coords when resolving providers
  async function requestWeatherByChain(chainIdOrProvider, lat, lon, timestamps, options = {}, fetcherRegistry = {}) {
    const now = options.nowDate || new Date();
    const coords = { lat, lon };
    // Determine provider for each timestamp (pass coords so availability checks work)
    const providers = (Array.isArray(timestamps) ? timestamps : []).map(ts => resolveProviderForTimestamp(chainIdOrProvider, ts, now, coords));

    // Group indices by provider
    const groups = {};
    providers.forEach((prov, idx) => {
      if (!groups[prov]) groups[prov] = { indices: [], times: [] };
      groups[prov].indices.push(idx);
      groups[prov].times.push(timestamps[idx]);
    });

    const results = {};
    for (const prov of Object.keys(groups)) {
      const g = groups[prov];
      const fetcher = fetcherRegistry[prov];
      if (typeof fetcher === 'function') {
        try {
          results[prov] = await fetcher({ lat, lon, timestamps: g.times, indices: g.indices, options });
        } catch (err) {
          results[prov] = { error: String(err && err.message ? err.message : err) };
        }
      } else {
        results[prov] = { meta: g };
      }
    }
    return { groups, results };
  }

  // Expose globally for compatibility
  window.t = t;
  window.logDebug = logDebug;
  window.saveSettings = saveSettings;
  window.loadSettings = loadSettings;
  window.getVal = getVal;
  window.getCache = getCache;
  window.setCache = setCache;
  window.getValidatedDateTime = getValidatedDateTime;
  window.roundToNextQuarterISO = roundToNextQuarterISO;
  window.roundUpToNextQuarterDate = roundUpToNextQuarterDate;
  window.setupDateLimits = setupDateLimits;
  window.haversine = haversine;
  window.formatTime = formatTime;
  window.isValidDate = isValidDate;
  window.fmtSafe = fmtSafe;
  window.updateUnits = updateUnits;
  window.safeNum = safeNum;
  window.normalUnit = normalUnit;
  window.clamp01 = clamp01;
  window.findClosestIndex = findClosestIndex;
  window.offsetLatLng = offsetLatLng;
  window.beaufortIntensity = beaufortIntensity;
  window.windToUnits = windToUnits;
  window.windIntensityValue = windIntensityValue;

  // Also via window.cw for modularity
  window.cw = window.cw || {};
  window.cw.utils = {
     cacheTTL,
     i18n,
     t,
     logDebug,
     saveSettings,
     loadSettings,
     getVal,
     getCache,
     setCache,
     getValidatedDateTime,
     roundToNextQuarterISO,
     roundUpToNextQuarterDate,
     setupDateLimits,
     haversine,
     formatTime,
     isValidDate,
     fmtSafe,
     updateUnits,
     safeNum,
     normalUnit,
     clamp01,
     findClosestIndex,
     offsetLatLng,
     beaufortIntensity,
     windToUnits,
     windIntensityValue,
     providerChains,
     getProviderForTimestamp,
     assignProvidersToTimestamps,
     pickProvidersForRoute,
     summarizeProviderSegments,
     resolveProviderForTimestamp,
     requestWeatherByChain
   };
 })();
