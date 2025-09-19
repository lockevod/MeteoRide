// Global variables
window.map = null;
window.trackLayer = null;
window.windMarkers = [];
window.weatherData = [];
window.rainMarkers = [];
// removed stepMarkers; wind markers handle selection
window.selectedOriginalIdx = null;
window.viewOriginalIndexMap = [];
window.colIndexByOriginal = {};
// Prevent ReferenceError on first reloads before a GPX is loaded
window.lastGPXFile = null;
window.lastAppliedSpeed = null;
window.apiSource = null; // Initialize as null, will be set later

// Initialize GPX sharing helper (if available)
try { if (typeof window.initGpxShare === 'function') window.initGpxShare(); } catch (e) { console.warn('[app] initGpxShare failed', e); }

// removed cacheTTL; now in utils.js

const weatherIconsMap = {
  // Base existentes
  clearsky:      { day: "wi-day-sunny",           night: "wi-night-clear" },
  partlycloudy:  { day: "wi-day-sunny-overcast",  night: "wi-night-alt-partly-cloudy" },
  cloudy:        { day: "wi-cloudy",              night: "wi-cloudy" },
  drizzle:       { day: "wi-sprinkle",            night: "wi-sprinkle" },
  rain:          { day: "wi-rain",                night: "wi-night-alt-rain" },
  thunderstorm:  { day: "wi-day-thunderstorm",    night: "wi-night-alt-thunderstorm" },
  snow:          { day: "wi-day-snow",            night: "wi-night-alt-snow" },
  fog:           { day: "wi-day-fog",             night: "wi-night-fog" },
  default:       { day: "wi-na",                  night: "wi-na" },

  // Nuevos más específicos (usados en OM/MB y coherentes entre sí)
  overcast:      { day: "wi-day-cloudy",          night: "wi-night-alt-cloudy" },

  rain_light:    { day: "wi-day-showers",         night: "wi-night-alt-showers" },
  rain_heavy:    { day: "wi-rain",                night: "wi-night-alt-rain" },
  showers:       { day: "wi-showers",             night: "wi-night-alt-showers" },

  freezing_drizzle: { day: "wi-sleet",            night: "wi-night-alt-sleet" },
  freezing_rain:    { day: "wi-rain-mix",         night: "wi-night-alt-rain-mix" },
  sleet:            { day: "wi-sleet",            night: "wi-night-alt-sleet" },
  hail:             { day: "wi-day-hail",         night: "wi-night-alt-hail" },

  snow_light:    { day: "wi-day-snow",            night: "wi-night-alt-snow" },
  snow_heavy:    { day: "wi-snow-wind",           night: "wi-night-alt-snow" },
  snow_showers:  { day: "wi-day-snow",            night: "wi-night-alt-snow" },

  thunder_hail:  { day: "wi-storm-showers",       night: "wi-night-alt-storm-showers" }
};

const PRECIP_MIN = 0.1;  // ignora trazas <0.1 mm/h
const PROB_MIN   = 20;   // muestra gota si prob >= 20%

// NEW: provider horizons and day-to-ms constant
const OPENMETEO_MAX_DAYS = 14;
const METEOBLUE_MAX_DAYS = 7;
const OPENWEATHER_MAX_DAYS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;          // NEW
const AROMEHD_MAX_HOURS = 48;                 // NEW

// NEW: AROME‑HD coverage check (coarse bbox: FR + nearby; excludes S. Spain)
function isAromeHdCovered(lat, lon) {
  const inLat = Number(lat) >= 39.0 && Number(lat) <= 52.5;
  const inLon = Number(lon) >= -10.5 && Number(lon) <= 16.5;
  return inLat && inLon;
}

// NEW: AROME‑HD payload validity check (detects out‑of‑domain/empty responses)
function aromeResponseLooksInvalid(j) {
  if (!j || !j.hourly) return true;
  const H = j.hourly;
  const t = H.time;
  const temp = H.temperature_2m;
  if (!Array.isArray(t) || t.length === 0) return true;
  if (!Array.isArray(temp) || temp.length === 0) return true;
  return !temp.some(v => v != null && !Number.isNaN(Number(v)));
}

// NEW: MeteoBlue hourly pictocode -> internal category
const MB_PICTO_TO_KEY = {
  1: 'clearsky',

  // Clear with some low/cirrus clouds -> partlycloudy
  2: 'partlycloudy', 3: 'partlycloudy', 4: 'partlycloudy',
  5: 'partlycloudy', 6: 'partlycloudy',

  // Partly cloudy (variants)
  7: 'partlycloudy', 8: 'partlycloudy', 9: 'partlycloudy',

  // Variable with possible storm clouds -> thunderstorm (identification purpose)
  10: 'thunderstorm', 11: 'thunderstorm', 12: 'thunderstorm',

  // Hazy/nebula -> fog
  13: 'fog', 14: 'fog', 15: 'fog',

  // Fog/low stratus (with/without cirrus)
  16: 'fog', 17: 'fog', 18: 'fog',

  // Mostly cloudy / overcast group
  19: 'overcast', 20: 'overcast', 21: 'overcast', 22: 'overcast',

  // Precip with cloudiness
  23: 'rain',          // cloudy with rain
  24: 'snow',          // cloudy with snow
  25: 'rain_heavy',    // cloudy with heavy rain
  26: 'snow_heavy',    // cloudy with heavy snow

  // Thunder-probable variants
  27: 'thunderstorm',          // rain, thunderstorms probable
  28: 'thunderstorm',          // light rain, thunderstorms probable
  29: 'thunderstorm',          // storm with heavy snow
  30: 'thunderstorm',          // heavy rain, thunderstorms probable

  // Mixed/transition types
  31: 'drizzle',       // mixed with drizzle
  32: 'snow',          // variable with snow
  33: 'rain_light',    // cloudy with light rain
  34: 'snow_light',    // cloudy with light snow
  35: 'sleet',         // mixed snow/rain

  // Not used
  36: 'default',
  37: 'default'
};


// NEW: restored helpers (translation, logs, settings, cache, dates, math, conversions)
function getWeatherCategoryForStep(step) {
  const prov = step?.provider || apiSource;
  const code = step?.weatherCode;
  if (code == null) return "default";
  if (prov === "meteoblue") return getDetailedCategoryMeteoBlue(Number(code));
  if (prov === "openweather") return getDetailedCategoryOpenWeather(Number(code));
  return getDetailedCategoryOpenMeteo(Number(code));
}

function computeLuminanceBase(step) {
  if (typeof SunCalc === "undefined" || !step?.time || step?.lat == null || step?.lon == null) return null;

  const t = step.time instanceof Date ? step.time : new Date(step.time);
  const pos = SunCalc.getPosition(t, step.lat, step.lon);
  const elevRad = pos.altitude;               // radians
  const elevDeg = elevRad * 180 / Math.PI;    // degrees
  step._elevDeg = elevDeg;                    // expose for the mixer

  // Night: below civil twilight
  if (elevDeg <= -6) return 0;

  // Civil twilight (-6..0): tiny residual luminance
  if (elevDeg <= 0) {
    // 0 at -6°, ~0.03 at 0°
    return ((elevDeg + 6) / 6) * 0.03;
  }

  // Daytime: clear-sky proxy using air mass attenuation + sine(elev) non-linearity
  const zenithDeg = 90 - elevDeg;
  const zenithRad = zenithDeg * Math.PI / 180;

  // Kasten & Young (1989) air mass; clamp to sane range
  let m = 1 / (Math.cos(zenithRad) + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
  m = Math.max(1, Math.min(10, m));

  // Simple turbidity approximation modulated by humidity (if available)
  const rh = Number(step?.humidity);
  const tau = 0.12 + 0.18 * (Number.isFinite(rh) ? rh / 100 : 0.5); // 0.12..0.30

  // Base clear‑sky factor: sine(elev) with slight gamma + mild air mass attenuation
  const sinEl = Math.sin(elevRad);
  const clear = Math.pow(sinEl, 1.15) * Math.exp(-tau * (m - 1) * 0.25);

  return clamp01(clear);
}

// REWRITE: final luminance (0–1) mixing clouds/precip/category and optional UV anchoring
function computeLuminance(step) {
  const base = computeLuminanceBase(step);
  if (base == null) return null;

  // Cloud Modification Factor (Kasten/CMF): 1 − 0.75*N^3, N in [0..1]
  const cc = Number(step?.cloudCover);
  const N = Number.isFinite(cc) ? Math.min(1, Math.max(0, cc / 100)) : null;
  const CMF = (N == null) ? 1 : (1 - 0.75 * Math.pow(N, 3));

  // Precip attenuation: up to -60% around ~6 mm/h; drizzle barely affects
  const precip = Number(step?.precipitation ?? 0);
  const rainFactor = 1 - Math.min(0.6, Math.max(0, precip) / 6);

  // Fog/snow category penalties (perceived light)
  const cat = getWeatherCategoryForStep(step);
  let catFactor = 1;
  if (cat === "fog") catFactor = 0.35;
  else if (cat === "snow_heavy") catFactor = 0.5;
  else if (cat === "snow" || cat === "snow_showers" || cat === "snow_light") catFactor = 0.65;
  else if (cat === "rain_heavy") catFactor = 0.65;

  // Combine physical factors
  const physical = clamp01(base * CMF * rainFactor * catFactor);

  // Optional UV anchoring (only by day and if available)
  const elevDeg = typeof step._elevDeg === "number" ? step._elevDeg : 0;
  const uv = Number(step?.uvindex);
  if (elevDeg > 0 && Number.isFinite(uv) && uv > 0) {
    // Normalize UV (index 0–11+), cap by cloud factor so UV can't exceed heavy overcast ceiling
    const uvFactor = clamp01(uv / 11);
    const uvMaxByClouds = (N == null) ? 1 : Math.max(0.05, CMF);
    const uvAnchor = Math.min(uvFactor, uvMaxByClouds);

    // Adaptive UV weight: lower near sunrise/sunset, higher at midday
    const sinEl = Math.sin((Math.PI / 180) * elevDeg);
    const wUV = Math.max(0.15, Math.min(0.4, 0.15 + 0.25 * Math.sqrt(Math.max(0, sinEl))));

    return +clamp01((1 - wUV) * physical + wUV * uvAnchor).toFixed(2);
  }

  return +physical.toFixed(2);
}

// Helper: classify common provider errors (reusable)
function classifyProviderError(prov, status, bodyText = "") {
  if (prov === "meteoblue") {
    // Treat 401 and most 403 as invalid key; keep quota/limit as quota
    if (status === 401) return "invalid_key";
    if (status === 403) return /quota|limit/i.test(bodyText) ? "quota" : "invalid_key";
    if (status === 429) return "quota";
  }
  if (prov === "openweather") {
    if (status === 401) return "invalid_key";
    if (status === 403) return "forbidden";
    if (status === 429) return "quota";
  }
  // generic fallbacks
  if (status === 401) return "invalid_key";
  if (status === 403) return "forbidden";
  if (status === 429) return "quota";
  return "http";
}

// Build URL per provider (add OpenWeather One Call 3.0)
function buildProviderUrl(prov, p, timeAt, apiKey, windUnit, tempUnit) {
  if (prov === "aromehd") {
    // Open‑Meteo with AROME‑HD model; same hourly variables as standard OM
    // Note: models=meteofrance_arome_hd is the AROME high‑resolution variant.
    return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      // CHANGED: ask for precipitation_probability too (model may not fill it, but try)
      `&hourly=temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,winddirection_10m,weathercode,uv_index,is_day,cloud_cover` +
      `&start=${timeAt.toISOString()}&timezone=auto&models=arome_france_hd`;
  }
  if (prov === "meteoblue") {
    return `https://my.meteoblue.com/packages/basic-1h,clouds-1h?lat=${p.lat}&lon=${p.lon}&apikey=${apiKey}&time=${timeAt.toISOString()}&tz=auto`;
  }
  if (prov === "openweather") {
    // Units: metric (°C, m/s), imperial (°F, mph). We normalize later.
    const units = (String(tempUnit || "").toLowerCase().startsWith("f")) ? "imperial" : "metric";
    // Hourly is limited (~48h). We include daily to allow fallback.
    return `https://api.openweathermap.org/data/3.0/onecall?lat=${p.lat}&lon=${p.lon}&appid=${apiKey}&units=${units}&exclude=minutely,alerts`;
  }
  // openmeteo
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,winddirection_10m,weathercode,uv_index,is_day,cloud_cover&start=${timeAt.toISOString()}&timezone=auto`;
}


// NEW: Helper to reconcile OpenMeteo weather code with AROME-HD basics (precipitation, probability, cloud cover)
// Adjusts the code if basics contradict (e.g., high precip but clear code -> rain code)
function reconcileAromeVsOmCode(omCode, precip, prob, cloud) {
  let code = Number(omCode) || 0; // Default to clear if invalid
  const p = Number(precip) || 0;
  const pr = Number(prob) || 0;
  const c = Number(cloud) || 0;

  // If precipitation is significant, override to rain codes
  if (p > 0.1) {
    if (pr > 70 || p > 2) {
      code = 65; // Heavy rain
    } else if (pr > 30 || p > 0.5) {
      code = 63; // Moderate rain
    } else {
      code = 61; // Light rain
    }
  }
  // If cloud cover is high but code is clear/partly, override to overcast
  else if (c > 80 && (code === 0 || code === 1 || code === 2)) {
    code = 3; // Overcast
  }
  // If low cloud but code suggests rain, downgrade to drizzle
  else if (c < 50 && (code === 61 || code === 63 || code === 65)) {
    code = 51; // Light drizzle
  }

  return code;
}


function segmentRouteByTime(geojson) {
  if (!geojson || !geojson.features.length) {
    logDebug(t("geojson_invalid"), true);
    return;
  }
  const coords = geojson.features[0].geometry.coordinates.map((c) => ({
    lat: c[1],
    lon: c[0],
  }));

  if (coords.length < 2) {
    logDebug(t("track_too_short"), true);
    return;
  }

  const speed = Number(getVal("cyclingSpeed")) || 12;
  const intervalMinutes = Number(getVal("intervalSelect")) || 15;
  const datetimeValue = getVal("datetimeRoute");
  if (!datetimeValue) {
    logDebug(t("route_date_empty"), true);
    return;
  }

  let startDateTime = getValidatedDateTime();

  if (isNaN(startDateTime.getTime())) {
    logDebug(t("route_date_invalid", { val: datetimeValue }), true);
    return;
  }

  // Validate date range (today to today + 14 days)
  const dateValidation = window.validateDateRange(datetimeValue, 'fecha de salida');
  if (!dateValidation.valid) {
    logDebug(dateValidation.error, true);
    if (window.setNotice) window.setNotice(dateValidation.error, 'error');
    return;
  }

  let totalDistance = 0;
  for (let i = 1; i < coords.length; i++) {
    totalDistance += haversine(coords[i - 1], coords[i]); // km
  }
  // mantén totalDistance en km; crea versión en metros (float)
  const totalDistanceM = totalDistance * 1000;
  const totalDurationMins = (totalDistance / speed) * 60;
  const stepsCount = Math.floor(totalDurationMins / intervalMinutes) + 1;

  let timeSteps = [];
  for (let i = 0; i < stepsCount; i++) {
    timeSteps.push(
      new Date(startDateTime.getTime() + i * intervalMinutes * 60000)
    );
  }

  let steps = [];
  let cumulativeDistance = 0;
  let currentSegment = 0;

  console.log("segmentRouteByTime: coords.length =", coords.length);
  console.log("stepsCount =", stepsCount);
  console.log("timeSteps.length =", timeSteps.length);

  for (let i = 0; i < stepsCount; i++) {
    const targetDistance = (speed * intervalMinutes * i) / 60; // km
    const targetDistanceM = targetDistance * 1000; // m

    while (
      currentSegment < coords.length - 1 &&
      cumulativeDistance +
        haversine(coords[currentSegment], coords[currentSegment + 1]) <
        targetDistance
    ) {
      cumulativeDistance += haversine(
        coords[currentSegment],
        coords[currentSegment + 1]
      );
      currentSegment++;
    }

    if (currentSegment >= coords.length - 1) {
      // Último punto: distancia total en metros
      steps.push({
        lat: coords[coords.length - 1].lat,
        lon: coords[coords.length - 1].lon,
        time: timeSteps[i],
        distanceM: totalDistanceM,
      });
      continue;
    }

    const segDist = haversine(
      coords[currentSegment],
      coords[currentSegment + 1]
    );
    const distInSegment = targetDistance - cumulativeDistance;
    const ratio = segDist ? distInSegment / segDist : 0;

    const lat =
      coords[currentSegment].lat +
      ratio * (coords[currentSegment + 1].lat - coords[currentSegment].lat);
    const lon =
      coords[currentSegment].lon +
      ratio * (coords[currentSegment + 1].lon - coords[currentSegment].lon);

    // Guardamos la distancia acumulada prevista en ese paso (metros)
    steps.push({ lat, lon, time: timeSteps[i], distanceM: Math.min(targetDistanceM, totalDistanceM) });
  }

  // Asegurar final con hora REAL (no redondeada) y arrays alineados
  if (steps.length) {
    const arrivalTime = new Date(startDateTime.getTime() + totalDurationMins * 60000);
    const lastStep = steps[steps.length - 1];
    if (!Number.isFinite(lastStep.distanceM) || Math.round(lastStep.distanceM) < Math.round(totalDistanceM)) {
      // añadir paso final con hora real
      timeSteps.push(arrivalTime);
      steps.push({
        lat: coords[coords.length - 1].lat,
        lon: coords[coords.length - 1].lon,
        time: arrivalTime,
        distanceM: totalDistanceM,
      });
    } else {
      // ya existe: actualizar su hora a la real
      steps[steps.length - 1].time = arrivalTime;
      if (timeSteps.length) timeSteps[timeSteps.length - 1] = arrivalTime;
    }
  }

  //const dateISO = startDateTime.toISOString().substring(0, 10);
  //console.log("steps ejemplo:", steps[0]);
  // console.log("weatherData ejemplo:", weatherData[0]);

  fetchWeatherForSteps(steps, timeSteps);
}

async function fetchWeatherForSteps(steps, timeSteps) {
  weatherData = [];
  clearNotice(); // reset UI notice at the start

  let apiKeyFinal = ""
  if (apiSource === "meteoblue") {
    apiKeyFinal = getVal("apiKey");
  } else if (apiSource === "openweather") {
    apiKeyFinal= getVal("apiKeyOW");
  } 
  const date = getVal("datetimeRoute").substring(0, 10);
  const tempUnit = getVal("tempUnits");
  const windUnit = getVal("windUnits");
  const now = new Date();

  showLoading();
  const showAllNotices = !!document.getElementById("noticeAll")?.checked;
  // Notice flags
  let warnedFallback = false;
  let warnedBeyondOM = false;
  let usedFallback = false;
  let usedFallbackHorizon = false; // NEW
  let usedFallbackError = false;   // NEW
  let beyondHorizon = false;
  let missingKeyFallback = false;
  let invalidKeyOnce = false;
  let quotaOnce = false;
  let httpErrOnce = false;
  // NEW: keep last MB HTTP status for the banner
  let lastHttpStatusMB = null;

  // NEW: provider fail-fast state
  let providerHardFailCode = null;      // "invalid_key" | "quota" | "http" | "forbidden"
  let providerFailCount = 0;
  const providerFailLimit = 3;
  let hardFailLogged = false;

  // NEW: flags for OpenWeather provider notices
  let invalidKeyOnceOWM = false;
  let quotaOnceOWM = false;
  let httpErrOnceOWM = false;
  let lastHttpStatusOWM = null;

  // NEW: fail-fast state for OpenWeather
  let providerHardFailCodeOWM = null;
  let providerFailCountOWM = 0;
  const providerFailLimitOWM = 3;

  // NEW: remember horizon days for notice
  let horizonDaysUsed = null;

  // If provider requires key but not provided (MB or OWM), fallback to Open‑Meteo
  const providerNeedsKey = (apiSource === "meteoblue" || apiSource === "openweather");
  const hasKey = (apiKeyFinal || "").trim().length >= 5;
  try {
    for (let i = 0; i < steps.length; i++) {
      const p = steps[i];
      const timeAt = timeSteps[i];

      const daysAhead = (timeAt - now) / MS_PER_DAY;
      const hoursAhead = (timeAt - now) / MS_PER_HOUR;   // NEW

      let prov = apiSource;

      // NEW: resolve chain provider (e.g. ow2_arome_openmeteo) per timestamp
      try {
        const chains = (window.cw && window.cw.utils && window.cw.utils.providerChains) || {};
        const isChain = !!chains[String(apiSource || '').toLowerCase()];
        if (isChain) {
          const resolver = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp;
          if (typeof resolver === 'function') {
            const eff = resolver(apiSource, timeAt, now, { lat: p.lat, lon: p.lon });
            if (eff) prov = eff;
          }
        }
      } catch(e){ console.warn('chain resolve error', e); }

      // Determine API key for this effective provider (chain-aware)
      const stepApiKey = (prov === 'meteoblue') ? (getVal('apiKey') || '') : (prov === 'openweather') ? (getVal('apiKeyOW') || '') : '';
      const hasKeyProv = stepApiKey.trim().length >= 5;

      // store provider on step so later processing knows real source (may still change if fallback)
      p.provider = prov;
      if (i === 0) logDebug(`chainMode=${apiSource} -> first provider=${prov}`);
      logDebug(`step ${i+1}/${steps.length} effectiveProv(pre)=${prov} t=${timeAt.toISOString()}`);

      // Hard-fail skip for MB
      if (prov === "meteoblue" && providerHardFailCode) {
        prov = "openmeteo";
        p.provider = prov;
        usedFallback = true;
        usedFallbackError = true;
        if (!hardFailLogged) {
          logDebug(t("provider_disabled_after_errors", { prov: "MeteoBlue" }), true);
          hardFailLogged = true;
        }
      }
      // Hard-fail skip for OWM
      if (prov === "openweather" && providerHardFailCodeOWM) {
        prov = "openmeteo";
        p.provider = prov;
        usedFallback = true;
        usedFallbackError = true;
        logDebug(t("provider_disabled_after_errors", { prov: "OpenWeather" }), true);
      }

      // Missing key fallback (chain-aware)
      if ((prov === "meteoblue" || prov === "openweather") && !hasKeyProv) {
        prov = "openmeteo";
        p.provider = prov;
        missingKeyFallback = true;
      }

      // NEW: AROME‑HD policy — within 48h AND within coverage; otherwise fallback to Open‑Meteo
      if (prov === "aromehd") {
        if (hoursAhead > AROMEHD_MAX_HOURS || !isAromeHdCovered(p.lat, p.lon)) {
          prov = "openmeteo";
          p.provider = prov;
        }
      }

      // Horizon checks
      if (prov === "meteoblue" && daysAhead > METEOBLUE_MAX_DAYS) {
        prov = "openmeteo";
        p.provider = prov;
        usedFallback = true;
        usedFallbackHorizon = true;
        horizonDaysUsed = METEOBLUE_MAX_DAYS;
        if (!warnedFallback) {
          logDebug(`MeteoBlue excede ${METEOBLUE_MAX_DAYS} días; usando Open‑Meteo como fallback.`);
          warnedFallback = true;
        }
      }
      if (prov === "openweather" && daysAhead > OPENWEATHER_MAX_DAYS) {
        prov = "openmeteo";
        p.provider = prov;
        usedFallback = true;
        usedFallbackHorizon = true;
        horizonDaysUsed = OPENWEATHER_MAX_DAYS;
        if (!warnedFallback) {
          logDebug(`OpenWeather excede ${OPENWEATHER_MAX_DAYS} días; usando Open‑Meteo como fallback.`);
          warnedFallback = true;
        }
      }

      // Even Open-Meteo horizon exceeded
      if (daysAhead > OPENMETEO_MAX_DAYS) {
        beyondHorizon = true;
        if (!warnedBeyondOM) {
          logDebug(`Fecha fuera de horizonte (${OPENMETEO_MAX_DAYS} días) para Open‑Meteo. Algunos pasos no tendrán datos.`, true);
          warnedBeyondOM = true;
        }
        weatherData.push({ ...p, provider: "openmeteo", weather: null });
        continue;
      }

      // After all fallbacks, update provider on step before cache/fetch
      p.provider = prov;

      const keyPrim = `cw_weather_${prov}_${date}_${tempUnit}_${windUnit}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
      const cachedPrim = getCache(keyPrim);
      if (cachedPrim) {
        weatherData.push({ ...p, provider: prov, weather: cachedPrim });
        logDebug(`Cache usado paso ${i + 1} (${prov})`);
        continue;
      }

      let res, json, ok = false;

      try {
        const urlPrim = buildProviderUrl(prov, p, timeAt, stepApiKey, windUnit, tempUnit);
        res = await fetch(urlPrim);
        if (res.ok) {
          json = await res.json();
          if (prov === "aromehd") {
            try {
              const urlStd = buildProviderUrl("openmeteo", p, timeAt, stepApiKey, windUnit, tempUnit);
              const resStd = await fetch(urlStd);
              if (resStd.ok) {
                const std = await resStd.json();
                const stdH = std?.hourly || {};
                const mergeKeys = ["precipitation_probability","weathercode","cloud_cover","uv_index","is_day"];
                json.hourly = json.hourly || {};
                mergeKeys.forEach(k => { if (Array.isArray(stdH[k])) json.hourly[k] = stdH[k]; });
                if (!Array.isArray(json.hourly.time) && Array.isArray(stdH.time)) json.hourly.time = stdH.time;
              }
            } catch (_) {}
            if (aromeResponseLooksInvalid(json)) {
              const prov2 = "openmeteo";
              const key2 = `cw_weather_${prov2}_${date}_${tempUnit}_${windUnit}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
              const cached2 = getCache(key2);
              if (cached2) { weatherData.push({ ...p, provider: prov2, weather: cached2 }); logDebug(`AROME invalido paso ${i+1}, cache OM`); continue; }
              const url2 = buildProviderUrl(prov2, p, timeAt, '', windUnit, tempUnit);
              const res2 = await fetch(url2);
              if (res2.ok) { const json2 = await res2.json(); weatherData.push({ ...p, provider: prov2, weather: json2 }); setCache(key2, json2); logDebug(`AROME invalido paso ${i+1}, fallback OM`); continue; }
              weatherData.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          }
          ok = true;
        } else {
          // existing error handling left unchanged
          const bodyText = await res.text().catch(() => "");
          const code = classifyProviderError(prov, res.status, bodyText);

          if (prov === "meteoblue") {
            // Count MB failures and consider hard-fail
            providerFailCount++;
            // NEW: remember status for final banner
            lastHttpStatusMB = res.status;

            if (code === "invalid_key" && !invalidKeyOnce) {
              invalidKeyOnce = true;
              logDebug(t("provider_key_invalid", { prov: "MeteoBlue" }), true);
            } else if (code === "quota" && !quotaOnce) {
              quotaOnce = true;
              logDebug(t("provider_quota_exceeded", { prov: "MeteoBlue" }), true);
            } else if (!httpErrOnce && code === "http") {
              httpErrOnce = true;
              logDebug(t("provider_http_error", { prov: "MeteoBlue", status: res.status }), true);
            }

            if (providerFailCount >= providerFailLimit) {
              providerHardFailCode = code;
            }

            // Fallback to OM for this step
            const prov2 = "openmeteo";
            const key2 = `cw_weather_${prov2}_${date}_${tempUnit}_${windUnit}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
            const cached2 = getCache(key2);
            usedFallback = true;
            usedFallbackError = true;

            if (cached2) {
              weatherData.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit);
            const res2 = await fetch(url2);
            if (res2.ok) {
              const json2 = await res2.json();
              weatherData.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              weatherData.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          } else if (prov === "openweather") {
            // Mirror MB error handling for OWM
            providerFailCountOWM++;
            lastHttpStatusOWM = res.status;

            if (code === "invalid_key" && !invalidKeyOnceOWM) {
              invalidKeyOnceOWM = true;
              logDebug(t("provider_key_invalid", { prov: "OpenWeather" }), true);
            } else if (code === "quota" && !quotaOnceOWM) {
              quotaOnceOWM = true;
              logDebug(t("provider_quota_exceeded", { prov: "OpenWeather" }), true);
            } else if (!httpErrOnceOWM && code === "http") {
              httpErrOnceOWM = true;
              logDebug(t("provider_http_error", { prov: "OpenWeather", status: res.status }), true);
            }

            if (providerFailCountOWM >= providerFailLimitOWM) {
              providerHardFailCodeOWM = code;
            }

            // Fallback to Open‑Meteo for this step
            const prov2 = "openmeteo";
            const key2 = `cw_weather_${prov2}_${date}_${tempUnit}_${windUnit}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
            const cached2 = getCache(key2);
            usedFallback = true;
            usedFallbackError = true;

            if (cached2) {
              weatherData.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit);
            const res2 = await fetch(url2);
            if (res2.ok) {
              const json2 = await res2.json();
              weatherData.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              weatherData.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          } else if (prov === "aromehd") {
            // NEW: On AROME error, try standard Open‑Meteo (no fallback flags/notices)
            const prov2 = "openmeteo";
            const key2 = `cw_weather_${prov2}_${date}_${tempUnit}_${windUnit}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
            const cached2 = getCache(key2);
            if (cached2) {
              weatherData.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit);
            const res2 = await fetch(url2);
            if (res2.ok) {
              const json2 = await res2.json();
              weatherData.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              weatherData.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          } else {
            // Non-recoverable or non-meteoblue error -> blank step but keep going
            if (!httpErrOnce) {
              httpErrOnce = true;
              logDebug(t("provider_http_error", { prov: "Open‑Meteo", status: res.status }), true);
            }
          }
        }
      } catch (err) {
        logDebug(t("error_api_step", { step: i + 1, msg: err.message }), true);
      }

      if (ok && json) {
        weatherData.push({ ...p, provider: prov, weather: json });
        setCache(keyPrim, json);
        logDebug(`Datos recibidos paso ${i + 1} (${prov})`);
        await new Promise(r => setTimeout(r, 70));
      } else {
        weatherData.push({ ...p, provider: prov, weather: null });
      }

      logDebug(`step ${i+1}/${steps.length} effectiveProv(final)=${prov}`);
    }


  if (!showAllNotices) {
     // Only show notices when fallback is due to key/provider errors (or missing key)
     if (missingKeyFallback && providerNeedsKey) {
       const provName = (apiSource === "openweather") ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_key_missing", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((invalidKeyOnce || invalidKeyOnceOWM) && usedFallbackError) {
       const provName = invalidKeyOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_key_invalid", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((quotaOnce || quotaOnceOWM) && usedFallbackError) {
       const provName = quotaOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_quota_exceeded", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((httpErrOnce || httpErrOnceOWM) && usedFallbackError) {
       const provName = httpErrOnceOWM ? "OpenWeather" : "MeteoBlue";
       const st = httpErrOnceOWM
         ? (lastHttpStatusOWM != null ? String(lastHttpStatusOWM) : "…")
         : (lastHttpStatusMB != null ? String(lastHttpStatusMB) : "…");
       setNotice(t("provider_http_error", { prov: provName, status: st }) + " " + t("fallback_short"), "error");
     } else if (usedFallbackError) {
       const provName = (apiSource === "openweather") ? "OpenWeather" : "MeteoBlue";
       setNotice(t("fallback_due_error", { prov: provName }), "warn");
     } else {
       clearNotice(); // suppress horizon/other non-critical notices
     }
   } else {
     // Original verbose notice policy
     if (beyondHorizon) {
       setNotice(t("horizon_exceeded", { days: OPENMETEO_MAX_DAYS }), "warn");
     } else if (usedFallbackHorizon) {
       setNotice(t("fallback_to_openmeteo", { days: horizonDaysUsed ?? METEOBLUE_MAX_DAYS }), "warn");
     } else if (missingKeyFallback && providerNeedsKey) {
       const provName = (apiSource === "openweather") ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_key_missing", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((invalidKeyOnce || invalidKeyOnceOWM) && usedFallbackError) {
       const provName = invalidKeyOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_key_invalid", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((quotaOnce || quotaOnceOWM) && usedFallbackError) {
       const provName = quotaOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_quota_exceeded", { prov: provName }) + " " + t("fallback_short"), "error");
     } else if ((httpErrOnce || httpErrOnceOWM) && usedFallbackError) {
       const provName = httpErrOnceOWM ? "OpenWeather" : "MeteoBlue";
       const st = httpErrOnceOWM
         ? (lastHttpStatusOWM != null ? String(lastHttpStatusOWM) : "…")
         : (lastHttpStatusMB != null ? String(lastHttpStatusMB) : "…");
       setNotice(t("provider_http_error", { prov: provName, status: st }) + " " + t("fallback_short"), "error");
     } else if (invalidKeyOnce || invalidKeyOnceOWM) {
       const provName = invalidKeyOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_key_invalid", { prov: provName }), "error");
     } else if (quotaOnce || quotaOnceOWM) {
       const provName = quotaOnceOWM ? "OpenWeather" : "MeteoBlue";
       setNotice(t("provider_quota_exceeded", { prov: provName }), "error");
     } else if (httpErrOnce || httpErrOnceOWM) {
       const provName = httpErrOnceOWM ? "OpenWeather" : "MeteoBlue";
       const st = httpErrOnceOWM
         ? (lastHttpStatusOWM != null ? String(lastHttpStatusOWM) : "…")
         : (lastHttpStatusMB != null ? String(lastHttpStatusMB) : "…");
       setNotice(t("provider_http_error", { prov: provName, status: st }), "error");
     } else if (usedFallbackError) {
       const provName = (apiSource === "openweather") ? "OpenWeather" : "MeteoBlue";
       setNotice(t("fallback_due_error", { prov: provName }), "warn");
     } else {
       clearNotice();
     }
  }
  // Always render after computing notices
  processWeatherData();
  } catch (err) {
    logDebug(t("error_api", { msg: err.message }), true);
    setNotice(t("error_api", { msg: err.message }), "error");
  } finally {
    hideLoading();
  }
}

function processWeatherData() {
  const tempUnit = getVal("tempUnits");
  const windUnit = getVal("windUnits");

  // Recorre pasos y calcula campos 
  weatherData.forEach((step) => {
    const prov = step.provider || apiSource; // CHANGED: provider-aware
    if (!step.weather) {
      step.temp =
        step.windSpeed =
        step.windDir =
        step.windGust =
        step.humidity =
        step.precipitation =
        step.precipProb =
          null;
      step.weatherCode = null;
      step.windCombined = "";
      step.rainCombined = "";
      return;
    }
    const w = step.weather;
    let idx = -1;
    if (prov === "openmeteo" || prov === "aromehd") {
      if (!w.hourly || !w.hourly.time) return;
      idx = findClosestIndex(w.hourly.time, step.time);
    }
    // NEW: OpenWeather extraction (prefer hourly, fallback to daily)
    if (prov === "openweather") {
      const timeMs = (step.time instanceof Date ? step.time : new Date(step.time)).getTime();

      // Helper: pick closest index in OWM arrays by dt (seconds)
      const closestByDt = (arr) => {
        if (!Array.isArray(arr) || !arr.length) return -1;
        let best = -1, bestDiff = Infinity;
        for (let i = 0; i < arr.length; i++) {
          const t = Number(arr[i]?.dt) * 1000;
          const df = Math.abs(t - timeMs);
          if (df < bestDiff) { bestDiff = df; best = i; }
        }
        return best;
      };

      let useHourly = Array.isArray(w.hourly) && w.hourly.length > 0;
      let hi = useHourly ? closestByDt(w.hourly) : -1;
      let di = (!useHourly || hi === -1) ? closestByDt(w.daily) : -1;

      const hourly = (useHourly && hi !== -1) ? w.hourly[hi] : null;
      const daily = (!hourly && Array.isArray(w.daily) && di !== -1) ? w.daily[di] : null;

      // isDaylight via SunCalc (robust for icons/luminance)
      try {
        const pos = SunCalc.getPosition(new Date(timeMs), step.lat, step.lon);
        step.isDaylight = pos.altitude > 0 ? 1 : 0;
      } catch { step.isDaylight = 1; }

      // Units normalization: derive km/h from API units
      const units = (String(tempUnit || "").toLowerCase().startsWith("f")) ? "imperial" : "metric";
      const toKmhFromOW = (ws) => {
        const v = Number(ws) || 0;
        if (units === "imperial") return v * 1.60934; // mph -> km/h
        return v * 3.6; // metric/standard m/s -> km/h
      };

      if (hourly) {
        step.temp = safeNum(hourly.temp);
        step.windSpeed = safeNum(windToUnits(toKmhFromOW(hourly.wind_speed), windUnit));
        step.windDir = Number(hourly.wind_deg || 0);
        step.windGust = safeNum(
          hourly.wind_gust != null
            ? windToUnits(toKmhFromOW(hourly.wind_gust), windUnit)
            : null
        );
        step.humidity = safeNum(hourly.humidity);
        const rainH = Number(hourly.rain?.["1h"] ?? 0);
        const snowH = Number(hourly.snow?.["1h"] ?? 0);
        step.precipitation = safeNum(rainH + snowH);
        step.precipProb = safeNum((Number(hourly.pop) || 0) * 100);
        step.weatherCode = Array.isArray(hourly.weather) && hourly.weather[0] ? hourly.weather[0].id : null;
        step.uvindex = safeNum(hourly.uvi ?? w.current?.uvi ?? null);
        step.cloudCover = safeNum(hourly.clouds);
        step.luminance = computeLuminance(step);
        step.timeLabel = formatTime(step.time);
      } else if (daily) {
        // Approximate from daily if beyond hourly range
        const dtemp = (daily.temp && (daily.temp.day ?? daily.temp.max ?? daily.temp.min)) || null;
        step.temp = safeNum(dtemp);
        step.windSpeed = safeNum(windToUnits(toKmhFromOW(daily.wind_speed), windUnit));
        step.windDir = Number(daily.wind_deg || 0);
        step.windGust = safeNum(
          daily.wind_gust != null
            ? windToUnits(toKmhFromOW(daily.wind_gust), windUnit)
            : null
        );
        step.humidity = safeNum(daily.humidity);
        const rainD = Number(daily.rain ?? 0);
        const snowD = Number(daily.snow ?? 0);
        step.precipitation = safeNum(rainD + snowD);
        step.precipProb = safeNum((Number(daily.pop) || 0) * 100);
        step.weatherCode = Array.isArray(daily.weather) && daily.weather[0] ? daily.weather[0].id : null;
        step.uvindex = safeNum(daily.uvi ?? w.current?.uvi ?? null);
        step.cloudCover = safeNum(daily.clouds);
        step.luminance = computeLuminance(step);
        step.timeLabel = formatTime(step.time);
      } else {
        // No data parsed
        step.temp =
          step.windSpeed =
          step.windDir =
          step.windGust =
          step.humidity =
          step.precipitation =
          step.precipProb =
            null;
        step.weatherCode = null;
        step.luminance = computeLuminance(step);
        step.timeLabel = "--:--";
      }

      // If no precip, hide probability
      if (step.precipitation != null && Number(step.precipitation) === 0) {
        step.precipProb = null;
      }

      step.windCombined = formatWindCell(step.windSpeed, step.windGust, step.windDir);
      step.rainCombined = formatRainCell(step.precipitation, step.precipProb);
      return; // handled OpenWeather branch
    }

    if (prov === "meteoblue") {
      step.temp = safeNum(w.temperature_2m);
      step.windSpeed = safeNum(w.wind_speed_10m);
      step.windDir = w.wind_direction_10m || 0;
      step.windGust = safeNum(w.wind_gust_10m);
      step.humidity = safeNum(w.relative_humidity_2m);
      step.precipitation = safeNum(w.precipitation);
      step.precipProb = safeNum(w.precipitation_probability);
      step.weatherCode = w.pictocode[idx];
      step.uvindex = safeNum((w.uvindex?.[idx] ?? w.uv_index?.[idx]));
      step.isDaylight = w.isdaylight;
      step.cloudCover = safeNum(w.total_cloud_cover?.[idx] ?? w.cloudcover?.[idx]);
      step.luminance = computeLuminance(step);

    } else if ((prov === "openmeteo" || prov === "aromehd") && idx !== -1) {
      step.temp = safeNum(w.hourly.temperature_2m[idx]);
      step.windSpeed = safeNum(windToUnits(w.hourly.wind_speed_10m[idx], windUnit));
      step.windDir = w.hourly.winddirection_10m[idx];
      step.windGust = safeNum(windToUnits(w.hourly.wind_gusts_10m[idx], windUnit));
      step.humidity = safeNum(w.hourly.relative_humidity_2m[idx]);
      step.precipitation = safeNum(w.hourly.precipitation[idx]);
     // AROME may lack precipitation_probability; merged earlier when available
      step.precipProb = safeNum(w.hourly.precipitation_probability && w.hourly.precipitation_probability[idx]);
      step.weatherCode = w.hourly.weathercode[idx];
      step.uvindex = (w.hourly.uv_index && w.hourly.uv_index.length > idx)
        ? safeNum(w.hourly.uv_index[idx])
        : null;
      step.isDaylight = w.hourly.is_day[idx];
      step.cloudCover = safeNum(w.hourly.cloud_cover?.[idx]); // 0–100
      step.luminance = computeLuminance(step);

      // NEW: AROME fallbacks and selective reconciliation
      if (prov === "aromehd") {
        if (step.isDaylight == null) {
          try {
            const pos = SunCalc.getPosition(new Date(step.time), step.lat, step.lon);
            step.isDaylight = pos.altitude > 0 ? 1 : 0;
          } catch { /* ignore */ }
        }
        // If still missing, synthesize; else reconcile OM code with AROME basics when contradictory
        if (step.weatherCode == null) {
          step.weatherCode = fallbackWmoFromBasics(step.precipitation, step.cloudCover);
        } else {
          step.weatherCode = reconcileAromeVsOmCode(
            step.weatherCode,
            step.precipitation,
            step.precipProb,
            step.cloudCover
          );
        }
      }
    }

    // Si no hay precipitación, no tiene sentido mostrar probabilidad
    if (step.precipitation != null && Number(step.precipitation) === 0) {
      step.precipProb = null;
    }

    step.windCombined = formatWindCell(step.windSpeed, step.windGust, step.windDir);
    // FIX: include both precipitation and probability (was only passing probability)
    step.rainCombined = formatRainCell(step.precipitation, step.precipProb);
  });

  renderWeatherTable();
  renderWindMarkers();
  // Improved route fitting: attempt several times to catch late layout/tile size changes
  function fitRouteOnce(padding = [10,10]) {
    if (!map || !trackLayer) return;
    try {
      const b = trackLayer.getBounds();
      if (b && b.isValid()) {
        map.fitBounds(b, { padding });
      }
    } catch(e) { /* ignore */ }
  }
  // Invalidate size first (in case container resized)
  if (map) map.invalidateSize();
  [120, 300, 700].forEach((delay, idx) => setTimeout(() => fitRouteOnce(idx === 0 ? [6,6] : [9,9]), delay));

}

function buildSunHeaderCell(lat, lon, dateLike) {
  if (typeof SunCalc === "undefined") return "";
  // Evita strings ambiguos: usa la Date de tu primer paso si existe
  const baseDate =
    dateLike instanceof Date
      ? dateLike
      : (typeof dateLike === "string" ? new Date(dateLike) : new Date());

  const times = SunCalc.getTimes(baseDate, lat, lon);

  const sr = fmtSafe(times.sunrise);
  const ss = fmtSafe(times.sunset);
  const cd = fmtSafe(times.dawn || times.civilDawn);
  const ck = fmtSafe(times.dusk || times.civilDusk);

  // In compare mode show only sunrise/sunset (compact)
  const isCompare =
    (document.getElementById("apiSource")?.value || "").toLowerCase() === "compare";
  if (isCompare) {
    return `
      <div class="sunHeaderBox">
        <div class="sunCol">
          <div class="sunRow"><i class="wi wi-sunrise"></i><span>${sr || "--:--"}</span></div>
          <div class="sunRow"><i class="wi wi-sunset"></i><span>${ss || "--:--"}</span></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="sunHeaderBox">
      <div class="sunCol">
        <div class="sunRow"><i class="wi wi-sunrise"></i><span>${sr || "--:--"}</span></div>
        <div class="sunRow"><i class="wi wi-sunset"></i><span>${ss || "--:--"}</span></div>
      </div>
      <div class="sunCol">
        <div class="sunRow"><span class="civil-chip">c↑</span><span>${cd || "--:--"}</span></div>
        <div class="sunRow"><span class="civil-chip">c↓</span><span>${ck || "--:--"}</span></div>
      </div>
    </div>
  `;
}
function getWeatherIconClassOpenMeteo(code, isDay) {
  // Mapeo WMO -> categorías más específicas
  let key = "";
  switch (Number(code)) {
    case 0: key = "clearsky"; break;
    case 1:
    case 2: key = "partlycloudy"; break;
    case 3: key = "overcast"; break;

    case 45:
    case 48: key = "fog"; break;

    // Drizzle
    case 51:
    case 53:
    case 55: key = "drizzle"; break;
    // Freezing drizzle
    case 56:
    case 57: key = "freezing_drizzle"; break;

    // Rain
    case 61: key = "rain_light"; break;
    case 63: key = "rain"; break;
    case 65: key = "rain_heavy"; break;

    // Freezing rain
    case 66:
    case 67: key = "freezing_rain"; break;

    // Snow
    case 71: key = "snow_light"; break;
    case 73: key = "snow"; break;
    case 75: key = "snow_heavy"; break;
    case 77: key = "snow_light"; break; // snow grains ~ ligero

    // Showers
    case 80: key = "showers"; break; // slight
    case 81: key = "showers"; break; // moderate
    case 82: key = "rain_heavy"; break; // violent showers ~ heavy

    // Snow showers
    case 85: key = "snow_showers"; break; // slight
    case 86: key = "snow_heavy"; break;   // heavy

    // Thunder
    case 95: key = "thunderstorm"; break;
    case 96:
    case 99: key = "thunder_hail"; break;

    default: key = "default";
  }
  const dayOrNight = isDay === 1 ? "day" : "night";
  return (weatherIconsMap[key] || weatherIconsMap.default)[dayOrNight];
}

function getWeatherIconClassMeteoBlue(pictocode, isdaylight) {
  const dayOrNight = isdaylight === 1 ? "day" : "night";
  const key = MB_PICTO_TO_KEY[Number(pictocode)] || "default";
  return (weatherIconsMap[key] || weatherIconsMap.default)[dayOrNight];
}

// --- OpenWeather mappers (appended, no other code modified) ---
function getDetailedCategoryOpenWeather(owmId) {
  const id = Number(owmId);

  // Thunderstorm 2xx
  if (id >= 200 && id <= 232) return "thunderstorm";

  // Drizzle 3xx
  if (id >= 300 && id <= 321) return "drizzle";

  // Rain 5xx
  if (id === 500) return "rain_light";
  if (id === 501) return "rain";
  if (id === 502 || id === 503 || id === 504) return "rain_heavy";
  if (id === 511) return "freezing_rain";     // freezing rain
  if (id === 520 || id === 521) return "showers";
  if (id === 522) return "rain_heavy";
  if (id === 531) return "showers";

  // Snow 6xx
  if (id === 600) return "snow_light";
  if (id === 601) return "snow";
  if (id === 602) return "snow_heavy";
  if (id >= 611 && id <= 613) return "sleet"; // sleet / rain+snow light
  if (id === 615 || id === 616) return "sleet";
  if (id === 620 || id === 621) return "snow_showers";
  if (id === 622) return "snow_heavy";

  // Atmosphere 7xx (mist, smoke, haze, dust, sand, fog, ash)
  if (id === 701 || id === 711 || id === 721 || id === 731 ||
      id === 741 || id === 751 || id === 761 || id === 762) return "fog";
  if (id === 771) return "showers";           // squalls
  if (id === 781) return "thunderstorm";      // tornado -> severe convective bucket

  // Clouds 80x
  if (id === 800) return "clearsky";
  if (id === 801 || id === 802) return "partlycloudy";
  if (id === 803 || id === 804) return "overcast";

  return "default";
}

function getWeatherIconClassOpenWeather(owmId, isDaylightFlag) {
  const key = getDetailedCategoryOpenWeather(owmId);
  const dayOrNight = isDaylightFlag === 1 ? "day" : "night";
  return (weatherIconsMap[key] || weatherIconsMap.default)[dayOrNight];
}
// --- end OpenWeather mappers ---

function makeWindSVGIcon(deg, speedKmh) {
  const intensity = beaufortIntensity(speedKmh);
  const sty = styleByIntensity(intensity);
  const s = sty.base;
  const rotation = getWindRotation(deg);
  const svg = `
    <svg class="wind-glyph" width="${s}" height="${s}" viewBox="0 0 24 24"
         xmlns="http://www.w3.org/2000/svg" style="display:block">
      <defs>
        <filter id="wds" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.6" stdDeviation="0.6" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
      </defs>

      <!-- Elliptical halo: rotate +90° and nudge up so the small end points to the arrow tip -->
      <ellipse class="wm-halo" cx="12" cy="12" rx="10.0" ry="7.2"
               transform="translate(0,-0.8) rotate(90 12 12)"
               fill="none" stroke="#f59e0b" stroke-width="1.4" opacity="0.9" />

      <g filter="url(#wds)">
        <!-- HALO shaft -->
        <path d="M12 22 L12 6" fill="none" stroke="rgba(255,255,255,0.95)"
              stroke-width="${(sty.stroke || 1.2) + 1.4}" stroke-linecap="round"/>
        <!-- Shaft -->
        <path d="M12 22 L12 6" fill="none" stroke="${sty.strokeColor}"
              stroke-width="${sty.stroke}" stroke-linecap="round"/>

        <!-- HALO head -->
        <path d="M12 2 L7 10 L17 10 Z" fill="${sty.fill}"
              stroke="rgba(255,255,255,0.95)" stroke-width="${(sty.stroke || 1.2) + 1.4}"/>
        <!-- Head -->
        <path d="M12 2 L7 10 L17 10 Z" fill="${sty.fill}"
              stroke="${sty.strokeColor}" stroke-width="${sty.stroke}"/>
      </g>
    </svg>
  `;
  return L.divIcon({
    html: `<div class="wind-svg-wrap" style="transform: rotate(${rotation}deg)">${svg}</div>`,
    className: 'wind-divicon wind-svg',
    iconSize: [s, s],
    iconAnchor: [s/2, s/2]
  });
}
function formatRainCell(precip, prob) {
  if (precip == null) return "-";
  const pNum = Number(precip);
  const probNum = prob == null ? null : Number(prob);
  const unit = getVal("precipUnits") || "mm";
  const converted = unit === "in" ? pNum * 0.0393701 : pNum; // NEW: mm to in
  const top = `<span class="combined-top">${converted.toFixed(1)}</span>`;
  const showProb = probNum != null && Number.isFinite(probNum) && pNum > 0 && probNum > 0;
  const bottom = showProb ? `<span class="combined-bottom">(${Math.round(probNum)}%)</span>` : "";
  return `<div class="weather-combined">${top}${bottom}</div>`;
}

// Formatea temperatura en una sola línea con el símbolo º (misma clase/style que viento/lluvia)
function formatTempCell(temp) {
  if (temp == null) return "-";
  const tNum = Number(temp);
  if (!Number.isFinite(tNum)) return "-";
  // Redondear al entero más cercano y mostrar el símbolo º (sin decimales)
  return `<div class="weather-combined"><span class="combined-top">${Math.round(tNum)}º</span></div>`;
}


// Helpers: categoría detallada (coherente con getWeatherIconClass*).
function getDetailedCategoryOpenMeteo(code) {
  switch (Number(code)) {
    case 0: return "clearsky";
    case 1:
    case 2: return "partlycloudy";
    case 3: return "overcast";
    case 45:
    case 48: return "fog";
    // Drizzle
    case 51:
    case 53:
    case 55: return "drizzle";
    // Freezing drizzle
    case 56:
    case 57: return "freezing_drizzle";
    // Rain
    case 61: return "rain_light";
    case 63: return "rain";
    case 65: return "rain_heavy";
    // Freezing rain
    case 66:
    case 67: return "freezing_rain";
    // Snow
    case 71: return "snow_light";
    case 73: return "snow";
    case 75: return "snow_heavy";
    case 77: return "snow_light";
    // Showers
    case 80: return "showers";
    case  81: return "showers";
    case 82: return "rain_heavy";
    // Snow showers
    case 85: return "snow_showers";
    case 86: return "snow_heavy";
    // Thunder
    case 95: return "thunderstorm";
    case 96:
    case 99: return "thunder_hail";
    default: return "default";
  }
}
function getDetailedCategoryMeteoBlue(pictocode) {
  return MB_PICTO_TO_KEY[Number(pictocode)] || "default";
}

// Helper: mediana de un array numérico
function median(arr = []) {
  const vals = arr
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const n = vals.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function computeRouteSummary() {
  if (!Array.isArray(weatherData) || weatherData.length === 0) {
    return null;
  }
  // Ranking detallado (mayor severidad = mayor número)
  const sevRank = {
    thunder_hail: 10,
    thunderstorm: 9,
    snow_heavy: 8,
    snow: 7,
    snow_showers: 6,
    snow_light: 5,
    freezing_rain: 5,
    hail: 5,
    sleet: 5,
    freezing_drizzle: 4,
    rain_heavy: 4,
    rain: 3,
    showers: 3,
    rain_light: 2,
    drizzle: 2,
    fog: 1,
    overcast: 0.8,
    cloudy: 0.7,
    partlycloudy: 0.5,
    clearsky: 0,
    default: -1
  };

  let temps = [], winds = [], gustMax = null, precipMax = null, probMax = null;
  let cloudSum = 0, cloudCnt = 0;

  let bestCat = "default", bestRank = -1;
  const isDay = (weatherData[0]?.isDaylight === 1) ? "day" : "night";

  for (const step of weatherData) {
    if (step?.temp != null && Number.isFinite(Number(step.temp))) temps.push(Number(step.temp));
    if (step?.windSpeed != null && Number.isFinite(Number(step.windSpeed))) winds.push(Number(step.windSpeed));
    if (step?.windGust != null && Number.isFinite(Number(step.windGust))) {
      gustMax = (gustMax == null) ? Number(step.windGust) : Math.max(gustMax, Number(step.windGust));
    }
    if (step?.precipitation != null && Number.isFinite(Number(step.precipitation))) {
      precipMax = (precipMax == null) ? Number(step.precipitation) : Math.max(precipMax, Number(step.precipitation));
    }
    if (step?.precipProb != null && Number.isFinite(Number(step.precipProb))) {
      probMax = (probMax == null) ? Number(step.precipProb) : Math.max(probMax, Number(step.precipProb));
    }
    if (step?.cloudCover != null && Number.isFinite(Number(step.cloudCover))) {
      cloudSum += Number(step.cloudCover); cloudCnt++;
    }

    // Categoría detallada por proveedor (CHANGED: provider-aware)
    const prov = step.provider || apiSource;
    let cat = "default";
    if (prov === "meteoblue") cat = getDetailedCategoryMeteoBlue(step.weatherCode);
    else if (prov === "openweather") cat = getDetailedCategoryOpenWeather(step.weatherCode);
    else cat = getDetailedCategoryOpenMeteo(step.weatherCode);

    // Ajuste por nubosidad alta
    const cc = Number(step?.cloudCover ?? 0);
    if ((cat === "partlycloudy" || cat === "clearsky") && cc >= 80) cat = "overcast";

    const rank = sevRank[cat] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      bestCat = cat;
    }
  }

  const tempAvg = median(temps);
  const windAvg = median(winds);
  const tempMin = temps.length ? Math.min(...temps) : null;
  const tempMax = temps.length ? Math.max(...temps) : null;

  const iconClass = (weatherIconsMap[bestCat] || weatherIconsMap.default)[isDay];

  return {
    iconClass,
    tempAvg,
    tempMin,
    tempMax,
    windAvg,
    gustMax,
    precipMax,
    probMax
  };
}

function buildRouteSummaryHTML(sum, tempUnitLabel, windUnitLabel, precipUnitLabel) {
  if (!sum) return "";
  const lang = (getVal("language") || "es").toLowerCase();
  const L = (es, en) => (lang.startsWith("es") ? es : en);

  // Unidades en minúsculas (solo viento/precip)
  const windUnitLc = (windUnitLabel || "").toString().toLowerCase();
  const precipUnitLc = (precipUnitLabel || "mm").toString().toLowerCase();
  const distanceUnit = getVal("distanceUnits") || "km";

  const hasRange = (sum.tempMin != null) && (sum.tempMax != null);
  const lo = hasRange ? Math.round(Math.min(sum.tempMin, sum.tempMax)) : null;
  const hi = hasRange ? Math.round(Math.max(sum.tempMin, sum.tempMax)) : null;
  const tempTxt = !hasRange ? "-" : `${lo}–${hi}${tempUnitLabel}`;

  // CHANGED: wrap units to force lowercase in header
  const windTxt = (sum.windAvg == null)
    ? "-"
    : `${Number(sum.windAvg).toFixed(1)} <span class="unit-lower">${windUnitLc}</span>`;
  const gustTxt = (sum.gustMax == null) ? "" : ` (${Number(sum.gustMax).toFixed(1)})`;
  const precipTxt = (sum.precipMax == null)
    ? "-"
    : `${Number(sum.precipMax).toFixed(1)} <span class="unit-lower">${precipUnitLc}</span>`;
  const probTxt = (sum.probMax == null || Number(sum.probMax) <= 0) ? "" : ` (${Math.round(Number(sum.probMax))}%)`;
 
  return `
    <div class="route-summary">
      <i class="wi ${sum.iconClass} rs-icon"></i>
      <div class="rs-lines">
        <div class="rs-line"><span class="rs-label">${L("Temp", "Temp")}:</span> ${tempTxt}</div>
        <div class="rs-line"><span class="rs-label">${L("Viento", "Wind")}:</span> ${windTxt}${gustTxt}</div>
        <div class="rs-line"><span class="rs-label">${L("Lluvia", "Rain")}:</span> ${precipTxt}${probTxt}</div>
      </div>
    </div>
  `;
}

// Combina Resumen de ruta + Caja solar en un solo bloque
function buildCombinedHeaderHTML(summaryHTML, sunHTML) {
  return `
    <div class="combined-header">
      ${summaryHTML || ""}
      <div class="combined-sep"></div>
      <div class="sun-wrap">${sunHTML || ""}</div>
    </div>
  `;
}

function renderWeatherTable() {
  // NEW: no-op when no route/data loaded (align with interval change behavior)
  // Do not build headers/rows if there is no track or weatherData yet.
  if (!Array.isArray(weatherData) || weatherData.length === 0 || !trackLayer) {
    const table = document.getElementById("weatherTable");
    if (table) table.innerHTML = "";
    // Optional: clear compact summary content if present
    const cs = document.getElementById("compactSummary");
    if (cs) cs.innerHTML = "";
    try { window._autoScrolledWeather = false; } catch {}
    return;
  }

  // If in compare mode, trigger compare render instead
  const sel = document.getElementById("apiSource");
  if (sel && sel.value === "compare") {
    if (window.cw?.runCompareMode) window.cw.runCompareMode();
    return;
  }

  // Leave compare mode: remove body flag so compact summary shows metrics again
  try { document.body.classList.remove("compare-active"); } catch {}

  const table = document.getElementById("weatherTable");
  table.innerHTML = "";
  
  // Clear compare mode classes from table and main element
  table.classList.remove('compare-mode', 'compare-dates-mode');
  const main = document.querySelector('main');
  if (main) main.classList.remove('compare-mode', 'compare-dates-mode');
  const thead = document.createElement("thead");
  let row;

  // Unidades seleccionadas (precipUnits opcional, por defecto 'mm')
  const tempUnit = getVal("tempUnits"); // 'C' o 'F'
  const windUnit = getVal("windUnits"); // ej. 'ms', 'kmh', 'mph'
  const precipUnit = (getVal("precipUnits") || "mm").toLowerCase();
  const distanceUnit = getVal("distanceUnits") || "km";

  // Normaliza etiquetas de unidad para mostrar junto al nombre
  const degSymbol = "º";
  const tempUnitLabel =
    typeof tempUnit === "string" && tempUnit.toLowerCase().startsWith("f")
      ? `${degSymbol}F`
      : `${degSymbol}C`; // por defecto °C
  const windUnitLabel =
    windUnit === "ms" ? "m/s" : windUnit && windUnit.toLowerCase().startsWith("mph") ? "mph" : "km/h";
  const precipUnitLabel = precipUnit; // "mm" por defecto, puede ser "in" si existe selector

  // CHANGED: vista filtrada (oculta penúltima si <5 minutos del último)
  let viewData = Array.isArray(weatherData) ? weatherData.slice() : [];
  if (viewData.length >= 2) {
    const last = viewData[viewData.length - 1];
    const prev = viewData[viewData.length - 2];
    const tLast = last?.time instanceof Date ? last.time : new Date(last?.time);
    const tPrev = prev?.time instanceof Date ? prev.time : new Date(prev?.time);
    if (isValidDate(tLast) && isValidDate(tPrev) && (tLast - tPrev) < 5 * 60 * 1000) {
      viewData.splice(viewData.length - 2, 1);
    }
  }

  // NEW: build mappings between visible columns and original indices
  viewOriginalIndexMap = viewData.map(v => weatherData.indexOf(v));
  colIndexByOriginal = {};
  viewOriginalIndexMap.forEach((orig, col) => { if (orig >= 0) colIndexByOriginal[orig] = col; });

  // Fila 1: celda combinada + celdas tiempo/distancia (usar viewData)
  row = document.createElement("tr");
  const firstCell = document.createElement("th");
  firstCell.style.verticalAlign = "middle";
  firstCell.style.paddingRight = "8px";
  firstCell.style.textAlign = "left";
  const lat = viewData[0]?.lat ?? 0;
  const lon = viewData[0]?.lon ?? 0;
  const rawTime = Array.isArray(viewData) ? viewData[0]?.time : viewData?.time;
  const isoStr = rawTime instanceof Date ? rawTime.toISOString() : rawTime;
  const date =
    typeof isoStr === "string"
      ? isoStr.substring(0, 10)
      : new Date().toISOString().substring(0, 10);

  const summaryHTML = buildRouteSummaryHTML(
    computeRouteSummary(),
    tempUnitLabel,
    windUnitLabel,
    precipUnitLabel
  );
  const sunHTML = buildSunHeaderCell(lat, lon, date);
  firstCell.innerHTML = buildCombinedHeaderHTML(summaryHTML, sunHTML);
  firstCell.setAttribute("rowspan", "2");
  row.appendChild(firstCell);

  // NEW: compact summary bar (only on small screens). Update/remove depending on viewport.
  (function upsertCompactSummary() {
    // Do not render the compact summary while in compare-dates mode.
    const tbl = document.getElementById('weatherTable');
    if (tbl && tbl.classList.contains('compare-dates-mode')) {
      const existing = document.getElementById('compactSummary');
      if (existing && existing.parentElement) try { existing.parentElement.removeChild(existing); } catch {}
      return;
    }
    // Otherwise, render/update the compact summary.
    let cs = document.getElementById("compactSummary");
    const panel = document.getElementById("controlsPanel");
    const wrap = document.querySelector(".wtc-wrap");
    const html = buildCombinedHeaderHTML(summaryHTML, sunHTML);
    if (!cs) {
      cs = document.createElement("div");
      cs.id = "compactSummary";
      cs.className = "compact-summary";
      cs.innerHTML = html;
      if (panel && wrap) panel.insertBefore(cs, wrap);
    } else {
      cs.innerHTML = html;
    }
  })();

  const maxM = viewData.length ? Math.max(...viewData.map(w => Number(w.distanceM || 0))) : 0;

  // NEW: detect runs of consecutive columns with same rounded km
  const dupFlags = new Array(viewData.length).fill(false);
  (function markDuplicateKmRuns() {
    // Collect rounded km for each column (null when distance invalid)
    const roundedKm = viewData.map(w => {
      const m = Number(w?.distanceM);
      return Number.isFinite(m) ? Math.round(m / 1000) : null;
    });
    let i = 0;
    while (i < roundedKm.length) {
      if (roundedKm[i] == null) { i++; continue; }
      let j = i + 1;
      while (j < roundedKm.length && roundedKm[j] === roundedKm[i]) j++;
      if (j - i >= 2) {
        for (let k = i; k < j; k++) dupFlags[k] = true;
      }
      i = j;
    }
  })();

  for (let i = 0; i < viewData.length; i++) {
    const th = document.createElement("th");
    const curr = viewData[i].time;
    // FIX: correct access to distanceM
    const m = viewData[i]?.distanceM;
    const isLast = (i === viewData.length - 1);
    const isDup = dupFlags[i];

    // units (forced lowercase in header)
    const unitKm = `<span class="unit-lower">${distanceUnit}</span>`;
    const unitM  = `<span class="unit-lower">${distanceUnit === "mi" ? "mi" : "m"}</span>`; // NEW: mi uses ft

    let distText = "";
    if (Number.isFinite(m)) {
      const convertedM = distanceUnit === "mi" ? m * 0.000621371 : m; // NEW: m to mi
      if (isDup) {
        // Duplicate rounded-km run: show real distance
        if (convertedM < 1000) distText = `${Math.round(convertedM)} ${unitM}`;            // meters, no decimals
        else          distText = `${(convertedM / 1000).toFixed(1)} ${unitKm}`;   // km with 1 decimal
      } else {
        // Original behavior
        if (Math.round(convertedM) === 0) {
          distText = `0 ${unitKm}`;
        } else if (isLast) {
          if (distanceUnit === "mi") {
            distText = `${convertedM.toFixed(1)} ${unitKm}`;
          } else {
            distText = `${(convertedM / 1000).toFixed(1)} ${unitKm}`;
          }
        } else if (convertedM < 1000) {
          distText = `${convertedM.toFixed(1)} ${unitM}`;            // keep as before
        } else {
           if (distanceUnit === "mi") {
            distText = `${convertedM.toFixed(1)} ${unitKm}`;
          } else {
            distText = `${(convertedM / 1000).toFixed(1)} ${unitKm}`;
          }
        }
      }
    }

    const startIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png";
    const endIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png";
    let iconHtml = "";
    if (Number.isFinite(m)) {
      if (Math.round(m) === 0) iconHtml = `<img src="${startIconUrl}" class="start-icon" alt="" />`;
      else if (Math.round(m) === Math.round(maxM)) iconHtml = `<img src="${endIconUrl}" class="end-icon" alt="" />`;
    }
    const hasIcon = !!iconHtml;

    th.innerHTML = `
      <div class="cell-row${iconHtml ? '' : ' no-icon'}">
        ${iconHtml ? `<div class="icon-col">${iconHtml}</div>` : ''}
        <div class="time-dist-col">
          <div class="time-cell">${formatTime(viewData[i].time)}</div>
          <div class="m-cell"><span class="m-text">${distText}</span></div>
        </div>
      </div>`;
    // NEW: tag header cells so clicks + scroll targeting work
    th.dataset.col = String(i);
    th.dataset.ori = String(viewOriginalIndexMap[i]);
    row.appendChild(th);
  }
  thead.appendChild(row);

  // Fila 2: iconos por paso (usar viewData)
  row = document.createElement("tr");
  row.classList.add("icon-row");
  viewData.forEach((w, i) => {
    const th = document.createElement("th");
    const prov = w.provider || apiSource;
    let iconClass =
      prov === "meteoblue"
        ? getWeatherIconClassMeteoBlue(w.weatherCode, w.isDaylight)
        : prov === "openweather"
        ? getWeatherIconClassOpenWeather(w.weatherCode, w.isDaylight)
        : getWeatherIconClassOpenMeteo(w.weatherCode, w.isDaylight);
  const icon = document.createElement("i");
  icon.classList.add("wi", iconClass);
  icon.style.fontSize = "28px";

  // Create luminance vertical block (to the right of the icon). Only render the vertical bar —
  // numeric percent is omitted per UX request.
  const lumDiv = document.createElement("div");
  lumDiv.classList.add("luminance-vert");
  const lumVal = Number.isFinite(w?.luminance) ? w.luminance : null;
  // Render only the vertical bar markup
  lumDiv.innerHTML = luminanceBarHTML(lumVal);
    // attach tooltip text for luminance
    const lumTip = (lumVal != null) ? `${Math.round(lumVal * 100)}%` : '-';
    lumDiv.setAttribute('data-tooltip', `Luminance: ${lumTip}`);

  const iconWrapper = document.createElement("div");
  iconWrapper.classList.add("icon-with-lum");
  iconWrapper.appendChild(icon);
  iconWrapper.appendChild(lumDiv);

  th.appendChild(iconWrapper);
  th.dataset.col = String(i);
  th.dataset.ori = String(viewOriginalIndexMap[i]);
  row.appendChild(th);
  });
  thead.appendChild(row);

  // Labels base (sin unidades) - reduced rows: combine Cloud + UV, move luminance into icon row
  const lang = getVal("language") || "es";
  const labels = {
    es: [
      "Temperatura",
      "Viento/Racha",
      "Lluvia/Probabilidad",
      "Humedad relativa",
      "Nubes / UV",
    ],
    en: [
      "Temperature",
      "Wind/Gust",
      "Rain/Probability",
      "Relative humidity",
      "Cloud / UV",
    ],
  };
  const keys = [
    "temp",
    "windCombined",
    "rainCombined",
    "humidity",
    "cloud_uv",
  ];

  // Small icon for each metric row
  const getRowIconHTML = (key) => {
    const cls = (() => {
      switch (key) {
        case "temp":        return "wi-thermometer";
        case "windCombined":return "wi-strong-wind";
        case "rainCombined":return "wi-raindrop";
        case "humidity":    return "wi-humidity";
        case "cloud_uv":    return "wi-cloud wi-uv-combo"; // handled specially below
        default:            return "wi-na";
      }
    })();
    // Return a single icon (for cloud_uv we'll add the second icon after the label text)
    return `<i class="wi ${cls} label-ico" aria-hidden="true"></i>`;
  };

  // Construye etiquetas con unidades para los keys interesados + icono + envoltorio de texto
  const labelsHTML = labels[lang].map((txt, i) => {
    const key = keys[i];
    let base = txt;
    if (key === "temp") {
      base = `${txt} (<span class="unit-temp">${tempUnitLabel}</span>)`;
    } else if (key === "windCombined") {
      base = `${txt} (<span class="unit-lower" style="text-transform:lowercase">${windUnitLabel}</span>)`;
    } else if (key === "rainCombined") {
      base = `${txt} (<span class="unit-lower" style="text-transform:lowercase">${precipUnitLabel || 'mm'}</span>)`;
    }
    return `${getRowIconHTML(key)} <span class="label-text">${base}</span>`;
  });

  // Post-process labelsHTML so cloud_uv shows icon + label + second icon (not adjacent)
  labelsHTML.forEach((html, idx) => {
    const key = keys[idx];
    if (key === 'cloud_uv') {
      // Place the UV icon to the left of the 'UV' token inside the label text
      const raw = labels[lang][idx];
      // If label contains 'UV' place icon before it, otherwise append at end
      if (raw.indexOf('UV') !== -1) {
        const parts = raw.split('UV');
        // Desktop: show full label with UV icon near the UV text
        // Compact-only: show a small separator '/' and the UV icon immediately next to the cloud icon
        labelsHTML[idx] = `${getRowIconHTML(key)} <span class="label-text desktop-only">${parts[0]}<i class="wi wi-hot label-ico-inline" aria-hidden="true" style="margin:0 6px 0 4px"></i>UV${parts[1] || ''}</span><span class="compact-only" aria-hidden="true"><span class="sep"> / </span><i class="wi wi-hot label-ico" aria-hidden="true" style="margin-left:4px"></i></span>`;
      } else {
        labelsHTML[idx] = `${getRowIconHTML(key)} <span class="label-text">${raw}</span>`;
      }
    }
  });

  // Ahora iterar por cada key (filas reducidas)
  keys.forEach((key, idx) => {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.innerHTML = labelsHTML[idx]; // include icon + wrapped text
    row.appendChild(th);
    viewData.forEach((w, i) => {
      const td = document.createElement("td");
      // Special rendering for combined cloud + UV row
      if (key === "cloud_uv") {
        const cc = Number(w?.cloudCover ?? -1);
  const uvRaw = (w?.uvindex ?? w?.uv);
  const uv = (uvRaw == null || uvRaw === '') ? null : Math.max(0, Math.round(Number(uvRaw)));
    // Data cells: show only numeric values (no icons) per UI decision
    const cloudPart = Number.isFinite(cc) && cc >= 0 ? `<span class="cloud-part"><span class="cloud-text">${Math.round(cc)}%</span></span>` : `<span class="cloud-part">-</span>`;
  const uvPart = uv != null ? `<span class="uv-part"><span class="uv-text">${uv}</span></span>` : `<span class="uv-part">-</span>`;
        const tooltipText = (lang === 'es')
          ? (uv != null ? `Nubosidad: ${Math.round(cc)}% — UV: ${uv}` : `Nubosidad: ${Math.round(cc)}%`)
          : (uv != null ? `Cloud cover: ${Math.round(cc)}% — UV: ${uv}` : `Cloud cover: ${Math.round(cc)}%`);
        td.innerHTML = `<div class="cloud-uv-cell">${cloudPart}<span class="sep"> / </span>${uvPart}</div>`;
        td.setAttribute('data-tooltip', tooltipText);
      } else {
        const val = w[key];
        if (key === "windCombined" || key === "rainCombined") {
          td.innerHTML = val || "-";
        } else if (key === "temp") {
          td.innerHTML = formatTempCell(val);
        } else if (key === "humidity") {
          td.textContent = (val == null) ? "-" : `${Math.round(val)}%`;
        } else {
          const decimalKeys = ["precipitation", "windSpeed", "windGust"];
          td.textContent =
            val !== null && val !== undefined
              ? (decimalKeys.includes(key) ? Number(val).toFixed(1) : Math.round(Number(val)))
              : "-";
        }
      }
      td.dataset.col = String(i);
      td.dataset.ori = String(viewOriginalIndexMap[i]);
      row.appendChild(td);
    });
    thead.appendChild(row);
  });

  table.appendChild(thead);

  // Clicks on any generated cell/header select that column
  wireTableInteractions();

  // Wire up tooltips for luminance and cloud/UV cells (desktop hover + mobile touch)
  wireTooltips();

  // Auto-scroll after each render if the full table is not yet visible and user hasn't scrolled past it
  (function autoScrollOnRender(){
    try {
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  if (vw < 421) { console.debug('[autoScroll] skip <421', vw); return; }
      const cont = document.getElementById('weatherTableContainer');
      if (!cont) { console.debug('[autoScroll] container missing'); return; }
      const headerRows = cont.querySelectorAll('#weatherTable thead tr').length;
      if (headerRows < 3) { console.debug('[autoScroll] insufficient header rows', headerRows); return; }
      const mapEl = document.getElementById('map');
      const tableRect = cont.getBoundingClientRect();
      const mapRect = mapEl ? mapEl.getBoundingClientRect() : null;
      // Contador de intentos para primer render de ruta
      if (typeof window._autoScrollAttempts !== 'number') window._autoScrollAttempts = 0;
      window._autoScrollAttempts++;
      const firstRenders = window._autoScrollAttempts <= 3; // forzar en los tres primeros passes
      const headerOffset = 56;
      const overlap = mapRect ? (mapRect.bottom - tableRect.top) : 0;
      // Criterios para desplazar:
      // 1) Primeras pasadas (primera carga) OR
      // 2) Hay solapamiento visual (mapa cubre parte superior de la tabla) OR
      // 3) Más del 40% de la tabla está por debajo del viewport inferior
      const viewportBottom = window.scrollY + window.innerHeight;
      const tableBottomAbs = window.scrollY + tableRect.bottom;
      const hiddenPortion = tableBottomAbs - viewportBottom;
      const bigHidden = hiddenPortion > tableRect.height * 0.4;
      const shouldScroll = firstRenders || overlap > 40 || bigHidden;
      console.debug('[autoScroll] metrics2', { firstRenders, overlap, hiddenPortion, bigHidden, shouldScroll, attempts: window._autoScrollAttempts, tableRect, scrollY: window.scrollY, vh: window.innerHeight });

      function forceScroll(targetTop, tag) {
        const before = window.scrollY;
        console.debug('[autoScroll] attempt', tag, { before, targetTop });
        try { window.scrollTo({ top: targetTop, behavior: 'smooth' }); } catch { window.scrollTo(0, targetTop); }
        // Fallback direct assignments (legacy iOS / some PWAs)
        document.documentElement.scrollTop = targetTop;
        document.body.scrollTop = targetTop;
        setTimeout(() => {
          const after = window.scrollY;
            console.debug('[autoScroll] post-check', tag, { after, moved: after !== before });
        }, 60);
      }

      function scrollToShow(tag){
        
        // Comportamiento original (>=701) o fallback si no hay título
        const idealTop = Math.max(0, window.scrollY + tableRect.top - headerOffset);
        const maxShift = headerOffset;
        const delta = Math.max(0, idealTop - window.scrollY);
        const limitedDelta = Math.min(delta, maxShift);
        let adjusted = Math.max(0, limitedDelta - 10); // se mantiene -10 para comportamiento previo
        if (vw < 701) adjusted = Math.max(0, limitedDelta + 70)
        const targetTop = window.scrollY + adjusted;
        forceScroll(targetTop, tag + '-limited-10');
      }
      if (shouldScroll) {
        requestAnimationFrame(() => scrollToShow('rAF-primary'));
        // Reintentos escalonados: 80ms, 160ms, 320ms (si sigue sin moverse mucho)
        ;[80,160,320].forEach((delay, idx) => {
          setTimeout(() => {
            try {
              const tr2 = cont.getBoundingClientRect();
              const currentTopDelta = tr2.top; // relativo viewport
              // Si todavía la parte superior de la tabla no está cerca del header ( > headerOffset + 10 ) reintenta
              if (currentTopDelta > headerOffset + 10) {
                console.debug('[autoScroll] retry condition met', { delay, currentTopDelta });
                scrollToShow('retry'+delay+'ms');
              }
            } catch(e) { console.debug('[autoScroll] retry error', e); }
          }, delay);
        });
      }
    } catch (e) {
      console.debug('[autoScroll] error', e);
    }
  })();

  (function ensureMinWidth() {
    const root = getComputedStyle(document.documentElement);
    const toPx = (v) => parseFloat(v) || 0;
    const firstCol = toPx(root.getPropertyValue('--cw-first-col')); // px
    const colMin  = toPx(root.getPropertyValue('--cw-col-min'));   // px
    const cols = Array.isArray(weatherData) ? weatherData.length : 0; // columns generated
    const minW = Math.max(600, Math.ceil(firstCol + Math.max(0, cols) * colMin));
    table.style.minWidth = `${minW}px`;
  })();
  
  // Tooltip helpers: small lightweight tooltip that works on hover and touch
  function ensureTooltipEl() {
    let el = document.getElementById('cw-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cw-tooltip';
      el.className = 'cw-tooltip';
      document.body.appendChild(el);
    }
    return el;
  }

  function showTooltipAt(target, text, clientX, clientY) {
    const el = ensureTooltipEl();
    el.textContent = text;
    el.style.display = 'block';
    // position above target when possible
    const rect = target.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    let left = rect.left + window.scrollX + (rect.width - elRect.width) / 2;
    let top = rect.top + window.scrollY - elRect.height - 8;
    // fallback to client coords if given
    if (typeof clientX === 'number') left = clientX - elRect.width / 2 + window.scrollX;
    if (typeof clientY === 'number') top = clientY - elRect.height - 12 + window.scrollY;
    // clamp
    left = Math.max(6 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - elRect.width - 6));
    if (top < window.scrollY + 6) top = rect.bottom + window.scrollY + 8; // place below if not enough space
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    const el = document.getElementById('cw-tooltip');
    if (el) el.style.display = 'none';
  }

  function wireTooltips() {
    const table = document.getElementById('weatherTable');
    if (!table) return;
    let touchTimer = null;
    table.addEventListener('mouseover', (ev) => {
      const t = ev.target.closest('[data-tooltip]');
      if (!t) return;
      showTooltipAt(t, t.getAttribute('data-tooltip'));
    });
    table.addEventListener('mouseout', (ev) => {
      const related = ev.relatedTarget;
      if (related && related.closest && related.closest('#cw-tooltip')) return;
      hideTooltip();
    });
    // touch support: show on touchstart and hide after 3s or on next touch
    table.addEventListener('touchstart', (ev) => {
      const t = ev.target.closest('[data-tooltip]');
      if (!t) return;
      if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      const touch = ev.touches && ev.touches[0];
      showTooltipAt(t, t.getAttribute('data-tooltip'), touch ? touch.clientX : undefined, touch ? touch.clientY : undefined);
      touchTimer = setTimeout(() => { hideTooltip(); touchTimer = null; }, 3000);
    }, { passive: true });
    // hide tooltip when tapping elsewhere
    document.addEventListener('touchstart', (ev) => {
      const t = ev.target.closest('[data-tooltip]');
      if (!t) hideTooltip();
    }, { passive: true });
  }
}
function luminanceBarHTML(val) {
    // Render a vertical bar (anchored to bottom). If no value, return an empty placeholder so layout stays stable.
    if (val == null) return `<div class="lum-vert-outer" aria-hidden="true"><div class="lum-vert-inner" style="height:0%"></div></div>`;
    const v = Math.max(0, Math.min(1, Number(val)));
    const h = Math.round(v * 100);
    // Height expressed as percentage for the inner fill; outer dimensions are set by CSS
    return `<div class="lum-vert-outer" aria-hidden="true"><div class="lum-vert-inner" style="height:${h}%"></div></div>`;
  }
  function styleByIntensity(intensity) {
  // Tamaño base (en px para el SVG), color de relleno y del trazo
  switch (intensity) {
    case 'suave':      return { base: 16, stroke: 1.2, fill: '#60a5fa', strokeColor: '#1d4ed8' }; // azul claro
    case 'media':      return { base: 20, stroke: 1.6, fill: '#2563eb', strokeColor: '#1e40af' }; // azul
    case 'fuerte':     return { base: 24, stroke: 2.0, fill: '#ef4444', strokeColor: '#991b1b' }; // rojo
    case 'muy_fuerte': return { base: 26, stroke: 2.2, fill: '#8b5cf6', strokeColor: '#6d28d9' }; // lila
    default:           return { base: 18, stroke: 1.4, fill: '#2563eb', strokeColor: '#1e40af' };
  }
  }

  function getWindRotation(degrees) {
    // Convierte dirección viento "de donde viene" a "hacia donde va"
    return (degrees + 180) % 360;
  }


  function formatWindCell(speed, gust, directionDegrees) {
    // Devuelve HTML: primera línea velocidad + flecha; segunda línea (racha)
    if (speed == null) return "-";

    // Flecha si hay dirección
    let arrowHTML = "";
    if (directionDegrees != null) {
      const rotation = (directionDegrees + 90) % 360;
      arrowHTML = `<span class="wind-arrow" style="display:inline-block; transform: rotate(${rotation}deg); margin-left:6px;">➜</span>`;
    }

    const top = `<span class="combined-top">${Number(speed).toFixed(1)}${arrowHTML}</span>`;

    const bottom = (gust == null)
      ? ""
      : `<span class="combined-bottom">(${Number(gust).toFixed(1)})</span>`;

    return `<div class="weather-combined">${top}${bottom}</div>`;
  }

// NEW: selection helpers
function wireTableInteractions() {
  const table = document.getElementById("weatherTable");
  if (!table) return;
  table.addEventListener("click", (ev) => {
    // Do not trigger column selection when compare modes are active
    const isCompareMode = table.classList.contains('compare-mode') || table.classList.contains('compare-dates-mode');
    if (isCompareMode) return;
    const cell = ev.target.closest("[data-col]");
    if (!cell) return;
    const col = Number(cell.dataset.col);
    if (!Number.isFinite(col)) return;
    // Only highlight/mark the point, do NOT recenter the map on click.
    // Use false so highlightMapStep won't pan the map.
    selectViewCol(col, false);
  });
}
function clearTableSelection() {
  const table = document.getElementById("weatherTable");
  if (!table) return;
  table.querySelectorAll(".selected").forEach(el => el.classList.remove("selected"));
}
function highlightColumn(col) {
  const table = document.getElementById("weatherTable");
  if (!table) return;
  clearTableSelection();
  table.querySelectorAll(`[data-col="${col}"]`).forEach(el => el.classList.add("selected"));

  // Robust horizontal centering into view
  const container = document.getElementById("weatherTableContainer");
  const headCell =
    table.querySelector(`thead tr:first-child th[data-col="${col}"]`) ||
    table.querySelector(`thead th[data-col="${col}"]`) ||
    table.querySelector(`[data-col="${col}"]`);
  if (container && headCell) {
    const cRect = container.getBoundingClientRect();
    const hRect = headCell.getBoundingClientRect();
    const targetLeft = container.scrollLeft + (hRect.left - cRect.left);
    const centeredLeft = targetLeft - (container.clientWidth - hRect.width) / 2;
    container.scrollTo({ left: Math.max(0, Math.round(centeredLeft)), behavior: "smooth" });
  }
}
function highlightMapStep(originalIdx, center = false) {
  // reset wind glyph highlight
  windMarkers.forEach(m => {
    const el = m && m.getElement && m.getElement();
    if (el) {
      el.classList.remove("is-selected");
    }
  });
  selectedOriginalIdx = originalIdx;

  const wm = windMarkers[originalIdx];
  if (wm) {
    const el = wm.getElement && wm.getElement();
    if (el) {
      el.classList.add("is-selected");
    }
    if (center && map && weatherData[originalIdx]) {
      const p = weatherData[originalIdx];
      map.panTo([p.lat, p.lon], { animate: true });
    }
  }
}

function selectViewCol(col, centerMap = false) {
  if (!Array.isArray(viewOriginalIndexMap) || col < 0 || col >= viewOriginalIndexMap.length) return;
  const originalIdx = viewOriginalIndexMap[col];
  highlightColumn(col);
  highlightMapStep(originalIdx, centerMap);
}
function selectByOriginalIdx(originalIdx, centerMap = false) {
  highlightMapStep(originalIdx, centerMap);
  const col = colIndexByOriginal[originalIdx];
  if (col !== undefined) highlightColumn(col);
}

function renderWindMarkers() {
  // Compare mode: when compare is active we must not clear or re-render
  // markers here because compare-specific markers are created elsewhere
  const sel = document.getElementById("apiSource");
  const table = document.getElementById("weatherTable");
  const isCompareActive = sel && (sel.value === "compare") || table?.classList.contains('compare-dates-mode');
  if (isCompareActive) {
    // If compare is active and a row is selected, markers are managed by compare handlers
    // If no row is selected, nothing should be shown. In both cases we skip clearing/rendering here.
    return;
  }

  // Clear previous (non-compare mode)
  windMarkers.forEach(m => map.removeLayer(m));
  windMarkers = [];
  rainMarkers.forEach(m => map.removeLayer(m));
  rainMarkers = [];

  if (!weatherData?.length) return;

  const PRECIP_MIN = 0.1;
  const PROB_MIN   = 20;

  const metersBetween = (a, b) =>
    haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) * 1000;

  for (let i = 0; i < weatherData.length; i++) {
    const data = weatherData[i];
    if (data?.lat == null || data?.lon == null) continue;

    const p0 = i > 0 ? { lat: weatherData[i-1].lat, lon: weatherData[i-1].lon } : { lat: data.lat, lon: data.lon };
    const p1 = i < weatherData.length-1 ? { lat: weatherData[i+1].lat, lon: weatherData[i+1].lon } : { lat: data.lat, lon: data.lon };

    // Unit normal and tangent (in degrees space)
    const dx = p1.lon - p0.lon, dy = p1.lat - p0.lat;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len; // tangent
    const { nx, ny } = normalUnit(p0, p1); // normal (perpendicular)

    // Wind direction and speed
    const dirFrom = Number(data.windDir ?? 0);
    const speedKmh = Number(data.windSpeed ?? 0);
    const gustKmh  = Number(data.windGust ?? 0);
    const speedForIcon = windIntensityValue(speedKmh, gustKmh);

    // Offsets (meters)
    const OFF_WIND = 14;
    const OFF_RAIN = 16;
    const SHIFT_T  = 10;
    const rainShiftMeters = (i % 2 === 0) ? SHIFT_T : -SHIFT_T;

    // Positions
    const wPos = offsetLatLng(data.lat, data.lon, nx, ny, OFF_WIND);
    const rPosShift = offsetLatLng(data.lat, data.lon, tx, ty, rainShiftMeters);
    let rPos = offsetLatLng(rPosShift[0], rPosShift[1], -nx, -ny, OFF_RAIN);
    if (metersBetween(wPos, rPos) < 22) {
      rPos = offsetLatLng(rPos[0], rPos[1], -nx, -ny, 8);
    }

    // Wind marker (interactive)
    const windIcon = makeWindSVGIcon(dirFrom, speedForIcon);
    const wMarker = L.marker([wPos[0], wPos[1]], { icon: windIcon, pane: 'windPane' })
      .addTo(map)
      .on('click', () => selectByOriginalIdx(i, true));
    wMarker.setZIndexOffset(1000);
    windMarkers.push(wMarker);

    // Optional rain drop
    const precip = Number(data.precipitation ?? 0);
    const prob   = Number(data.precipProb ?? 0);
    const showDrop = (precip >= PRECIP_MIN) && (prob >= PROB_MIN);
    if (showDrop) {
      const rainIcon = L.divIcon({
        html: `<span class="rain-glyph">💧</span>`,
        className: "rain-icon",
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      });
      const rMarker = L.marker([rPos[0], rPos[1]], { icon: rainIcon, pane: 'windPane' })
        .addTo(map);
      try { rMarker.setZIndexOffset(900); } catch(_) {}
      rainMarkers.push(rMarker);
    }
  }

  if (trackLayer?.bringToBack) trackLayer.bringToBack();
  windMarkers.forEach(m => m.setZIndexOffset(1000));

  if (selectedOriginalIdx != null) {
    highlightMapStep(selectedOriginalIdx, false);
  }
}

// NEW: Function to create markers for specific data (used in compare modes)
function createMarkersForData(dataArray, providerLabel = '') {
  if (!Array.isArray(dataArray) || !map) return;

  // Clear existing markers
  windMarkers.forEach(m => map.removeLayer(m));
  windMarkers = [];
  rainMarkers.forEach(m => map.removeLayer(m));
  rainMarkers = [];

  try {
    console.debug('[app] createMarkersForData called', { providerLabel, length: dataArray.length, sample: dataArray[0] || null });
  } catch(_) {}

  const PRECIP_MIN = 0.1;
  const PROB_MIN = 20;

  const metersBetween = (a, b) =>
    haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) * 1000;

  for (let i = 0; i < dataArray.length; i++) {
    const data = dataArray[i];
    if (!data || data.lat == null || data.lon == null) continue;

    // Calculate positions like in normal mode
    const p0 = i > 0 ? { lat: dataArray[i-1].lat, lon: dataArray[i-1].lon } : { lat: data.lat, lon: data.lon };
    const p1 = i < dataArray.length-1 ? { lat: dataArray[i+1].lat, lon: dataArray[i+1].lon } : { lat: data.lat, lon: data.lon };

    // Unit normal and tangent (in degrees space)
    const dx = p1.lon - p0.lon, dy = p1.lat - p0.lat;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len; // tangent
    const { nx, ny } = normalUnit(p0, p1); // normal (perpendicular)

    // Offsets (meters) - same as normal mode
    const OFF_WIND = 14;
    const OFF_RAIN = 16;
    const SHIFT_T  = 10;
    const rainShiftMeters = (i % 2 === 0) ? SHIFT_T : -SHIFT_T;

    // Positions
    const wPos = offsetLatLng(data.lat, data.lon, nx, ny, OFF_WIND);
    const rPosShift = offsetLatLng(data.lat, data.lon, tx, ty, rainShiftMeters);
    let rPos = offsetLatLng(rPosShift[0], rPosShift[1], -nx, -ny, OFF_RAIN);
    if (metersBetween(wPos, rPos) < 22) {
      rPos = offsetLatLng(rPos[0], rPos[1], -nx, -ny, 8);
    }

    // Wind marker (support both naming conventions: windDir or windDirection)
    const windDir = (data.windDir != null) ? data.windDir : (data.windDirection != null ? data.windDirection : null);
    const speedForIcon = (typeof windIntensityValue === 'function')
      ? windIntensityValue(Number(data.windSpeed ?? 0), Number(data.windGust ?? 0))
      : Number(data.windSpeed ?? 0);
    if (data.windSpeed != null && windDir != null) {
      const windIcon = makeWindSVGIcon(Number(windDir), speedForIcon);
      const wMarker = L.marker([wPos[0], wPos[1]], { icon: windIcon, pane: 'windPane' })
        .addTo(map);
      try { wMarker.setZIndexOffset(1000); } catch(_) {}
      windMarkers.push(wMarker);
    }

    // Rain marker (use safe numeric checks)
    const precipVal = Number(data.precipitation ?? 0);
    const probVal = Number(data.precipProb ?? 0);
    if (precipVal >= PRECIP_MIN && probVal >= PROB_MIN) {
      const rainIcon = L.divIcon({
        className: 'rain-marker',
        html: '💧',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      });
      const rMarker = L.marker([rPos[0], rPos[1]], { icon: rainIcon, pane: 'windPane' })
        .addTo(map)
        .setZIndexOffset(900);
      rainMarkers.push(rMarker);
    }
  }

  // Set z-index for wind markers
  windMarkers.forEach(m => m.setZIndexOffset(1000));

  // Bring track to back if it exists
  if (trackLayer?.bringToBack) trackLayer.bringToBack();
}

function initMap() {
  // Fractional zoom: prefer 0.2 steps (more coarse than 0.05 but still smoother than whole integers)
  // zoomDelta: base increment for zoomIn/Out; wheelPxPerZoomLevel kept moderately high for smoother wheel control
  map = L.map("map", { zoomSnap: 0, zoomDelta: 0.2, wheelPxPerZoomLevel: 100 }).setView([41.3874, 2.1686], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | App by <a href="https://github.com/lockevod" target="_blank" rel="noopener noreferrer">Lockevod</a>',
  }).addTo(map);

  // Enable clicks on wind markers
  const windPane = map.createPane('windPane');
  windPane.style.zIndex = 650;
  windPane.style.pointerEvents = 'auto';

  // Prevent map from taking focus/zoom by default; enable only on interaction
  map.scrollWheelZoom.disable();
  map.keyboard.disable();
  map.touchZoom.disable();
  const mapC = map.getContainer();
  if (mapC) mapC.tabIndex = -1; // not focusable by default

  let wheelEnabled = false;
  const enableWheelZoom = () => { if (!wheelEnabled) { map.scrollWheelZoom.enable(); wheelEnabled = true; } };
  const disableWheelZoom = () => { if (wheelEnabled) { map.scrollWheelZoom.disable(); wheelEnabled = false; } };

  if (mapC) {
    mapC.addEventListener('mousedown', () => {
      enableWheelZoom(); // user explicitly interacts with the map
    }, { passive: true });
    mapC.addEventListener('mouseleave', () => {
      disableWheelZoom(); // stop zooming when pointer leaves the map
    }, { passive: true });

  // Ultra‑fine zoom: hold Alt while using wheel for ~0.05 steps (non-animated for precision)
    mapC.addEventListener('wheel', (e) => {
      if (!wheelEnabled) return; // only if user already interacted
      if (!e.altKey) return;      // Alt modifier for ultra fine control
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1; // invert to match Leaflet default (scroll up = zoom in)
  const step = 0.05 * direction;
      const target = map.getZoom() + step;
      map.setZoom(target, { animate: false });
    }, { passive: false });

    // Touch: enable pinch-zoom on interaction, auto-disable shortly after
    let touchTimer = null;
    mapC.addEventListener('touchstart', () => {
      try { map.touchZoom.enable(); } catch {}
      if (touchTimer) clearTimeout(touchTimer);
    }, { passive: true });
    const endTouch = () => {
      touchTimer = setTimeout(() => {
        try { map.touchZoom.disable(); } catch {}
      }, 800);
    };
    mapC.addEventListener('touchend', endTouch, { passive: true });
    mapC.addEventListener('touchcancel', endTouch, { passive: true });
  }

  // Ajusta la curva a tu rango de zoom; ej: z=6 -> 14px y +2px por nivel
  const setWindScale = (z) => {
    const px = Math.round(14 + (z - 6) * 2);
    document.documentElement.style.setProperty('--wind-font', `${px}px`);
  }
  map.on('zoomend', () => setWindScale(map.getZoom()));
  setWindScale(map.getZoom()); // inicializa tamaño al entrar
  var compass = new L.Control.Compass({
    autoActive: true,
    showDigit: false,
    position: 'topright'
  });
  compass.addTo(map);
  
}
let resizeDebTimer = null; // for debounced resize

function scheduleMapResizeRecenter() {
  if (resizeDebTimer) clearTimeout(resizeDebTimer);
  resizeDebTimer = setTimeout(() => {
    if (!map) return;
    map.invalidateSize();
    ensureTrackVisible();
  }, 180);
}

function ensureTrackVisible() {
  if (!map || !trackLayer || typeof trackLayer.getBounds !== "function") return;

  let trackBounds;
  try {
    trackBounds = trackLayer.getBounds();
  } catch (_) {
    // bounds not ready yet
    return;
  }

  // Bounds may be undefined or not valid until the GPX "loaded" event fires
  if (!trackBounds || typeof trackBounds.isValid !== "function" || !trackBounds.isValid()) {
    console.debug("[cw] ensureTrackVisible: track bounds not ready/invalid");
    return;
  }

  const mapBounds = (map && typeof map.getBounds === "function") ? map.getBounds() : null;

  // If map bounds exist and contain track fully, nothing to do
  if (mapBounds && typeof mapBounds.contains === "function") {
    try {
      if (mapBounds.contains(trackBounds)) return;
    } catch (e) {
      console.debug("[cw] ensureTrackVisible: contains() failed:", e?.message);
    }
  }

  try {
  map.fitBounds(trackBounds, { padding: [8, 8] });
  } catch (e) {
    console.debug("[cw] ensureTrackVisible: fitBounds failed:", e?.message);
  }
}

function init() {
  initMap();
  bindUIEvents();
  loadSettings();
  applyTranslations();
  updateProviderOptions();
  setupDateLimits();

  // Ajuste del selector de hora: pasos 15 min y valor inicial redondeado hacia arriba
  const dt = document.getElementById("datetimeRoute");
  if (dt) {
    dt.step = 900; // 15 minutos
    const rounded = roundToNextQuarterISO(new Date());
    dt.value = rounded;
  }

  // Observe map container size changes and window resizes to keep track centered
  const mapEl = document.getElementById("map");
  if (mapEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleMapResizeRecenter());
    ro.observe(mapEl);
  }
  window.addEventListener("resize", scheduleMapResizeRecenter, { passive: true });
  window.addEventListener("orientationchange", scheduleMapResizeRecenter, { passive: true });

  hideLoading();
  logDebug(t("app_started"));
}

// --- GPX public loader: logging + error handling ---
// Helper: comprobar si hay algo parseable (track/route/waypoint)
function hasParsableGpxText(txt) {
  if (typeof txt !== "string") return false;
  const s = txt.slice(0, 200000); // evita regex sobre ficheros enormes (no usamos el resto)
  return /<trkpt\b/i.test(s) || /<rtept\b/i.test(s) || /<wpt\b/i.test(s) || /<trk\b/i.test(s) || /<rte\b/i.test(s);
}

// Nota: si ya existía, se sobrescribe con más logging y validación.
window.cwLoadGPXFromString = async function loadGPXFromString(gpxText, nameHint = "route.gpx") {
  try {
    const head = (typeof gpxText === "string") ? gpxText.slice(0, 120) : String(gpxText);
    logDebug(`cwLoadGPXFromString: called, len=${(gpxText && gpxText.length) || 0}, name=${nameHint}`);
    console.debug("[cw] loader input head:", head);

    if (!gpxText || typeof gpxText !== "string") {
      logDebug("cwLoadGPXFromString: invalid gpxText", true);
      return;
    }
    // Validación rápida: si no hay trk/rte/wpt, avisar y abortar
    if (!hasParsableGpxText(gpxText)) {
      const bytes = gpxText.length;
      const hint = "El GPX recibido no contiene tracks/rutas/puntos o está truncado.";
      console.warn("[cw] GPX pre-parse failed (no trk/rte/wpt). size:", bytes);
      logDebug(`${hint} Tamaño=${bytes}B. Prueba con gpx_url o revisa el Atajo (debe codificar el archivo completo a Base64).`, true);
      alert(`${hint}\n\nTamaño=${bytes}B.\n\nSugerencias:\n• Usa la variante gpx_url (enlace directo al .gpx).\n• En el Atajo, asegúrate de que “Codificar (Base64)” se aplique al archivo completo (no al nombre) y que el resultado se usa en la URL.`);
      return;
    }
    if (typeof L === "undefined" || !L.GPX) {
      console.error("[cw] Leaflet/leaflet-gpx not ready");
      logDebug("Leaflet/leaflet-gpx no está listo", true);
      return;
    }
    if (!map) {
      console.warn("[cw] map not initialized yet");
    }

    // Ensure reloadFull() (which reads window.lastGPXFile) works when GPX is injected
    // programmatically (POST/service-worker flow). Create a File-like object so
    // the existing file-based reload path can reparse the same GPX on parameter
    // changes triggered by the UI.
    try {
      // File constructor is available in browsers; fallback to a simple object if not.
      window.lastGPXFile = typeof File === 'function'
        ? new File([gpxText], nameHint || 'route.gpx', { type: 'application/gpx+xml' })
        : { name: nameHint || 'route.gpx', _text: gpxText };
    } catch (e) {
      // Do not block loading if File creation fails; just log.
      console.warn('[cw] could not create File for lastGPXFile fallback', e);
      window.lastGPXFile = { name: nameHint || 'route.gpx', _text: gpxText };
    }

    if (trackLayer) {
      try {
        map.removeLayer(trackLayer);
        logDebug("cwLoadGPXFromString: removed previous track layer");
      } catch (_) {}
    }

    let loadedFired = false;
    let errorFired = false;

    let gpxLayer;
    try {
      gpxLayer = new L.GPX(gpxText, {
        async: true,
        polyline_options: { color: 'blue' },
        marker_options: {
          startIconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
          endIconUrl:   "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl:    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          wptIconUrl: null
        }
      });
    } catch (e) {
      console.error("[cw] L.GPX constructor error:", e);
      logDebug("Error creando L.GPX: " + e.message, true);
      return;
    }

    trackLayer = gpxLayer;

    gpxLayer.on("loaded", async (evt) => {
      loadedFired = true;
      try {
        console.debug("[cw] GPX loaded event; bounds:", evt.target.getBounds());
        map.fitBounds(evt.target.getBounds());
        await segmentRouteByTime(evt.target.toGeoJSON());

        const baseName = (nameHint || "route").replace(/\.[^/.]+$/,"");
        const metaName = (evt.target.get_name && evt.target.get_name()) || baseName;
        const rutaEl = document.getElementById("rutaName");
        if (rutaEl) rutaEl.textContent =  (metaName || baseName);

        map.fitBounds(evt.target.getBounds(), { padding: [20, 20], maxZoom: 15 });
        logDebug("GPX cargado desde ingest ✓");
      } catch (e) {
        console.error("[cw] on loaded processing error:", e);
        logDebug("Error procesando GPX: " + e.message, true);
      }
    });

    gpxLayer.on("error", (e) => {
      errorFired = true;
      const detail = (e && (e.err || e.error || e.message)) || "unknown";
      console.error("[cw] GPX error event:", detail, e);
      logDebug("Evento error al cargar GPX: " + detail, true);
      console.debug("[cw] GPX head snippet:", head);
      // Mensaje más claro para el caso típico de “No parseable layers…”
      if (String(detail).includes("No parseable layers")) {
        alert("El GPX no contiene ningún track/ruta/punto parseable.\n\nRevisa que el archivo no esté vacío o truncado.\nSugerencia: usa gpx_url en el atajo o verifica que la codificación Base64 incluya todo el archivo.");
      }
    });

    gpxLayer.on("add", () => {
      console.debug("[cw] GPX layer added to map");
    });

    gpxLayer.addTo(map);
    console.debug("[cw] GPX layer addTo(map) called");

    // Watchdog: si no dispara loaded ni error en 5s, informar
    setTimeout(() => {
      if (!loadedFired && !errorFired) {
        console.warn("[cw] GPX neither loaded nor error after 5s");
        logDebug("GPX no terminó de cargar en 5s (ni loaded ni error). Revisa el GPX o la consola.", true);
      }
    }, 5000);
  } catch (err) {
    console.error("[cw] loader outer error:", err);
    logDebug("Error cargando GPX: " + err.message, true);
    alert(t("error_reading_gpx", { msg: err.message }));
  }
};
// --- end GPX public loader ---

// NEW: expose minimal hooks for compare.js (no behavior changes)
try {
  window.cw = window.cw || {};
  // Steps baseline (lat, lon, time, distanceM) – derived from current weatherData
  window.cw.getSteps = () => (Array.isArray(weatherData)
    ? weatherData.map(s => ({ lat: s.lat, lon: s.lon, time: new Date(s.time), distanceM: s.distanceM }))
    : []);
  // Units and horizons
  window.cw.getUnits = () => ({
    temp: document.getElementById("tempUnits")?.value,
    wind: document.getElementById("windUnits")?.value,
    precip: document.getElementById("precipUnits")?.value,
    distance: document.getElementById("distanceUnits")?.value,
  });
  window.cw.horizons = {
    OPENMETEO_MAX_DAYS,
    METEOBLUE_MAX_DAYS,
    OPENWEATHER_MAX_DAYS,
    AROMEHD_MAX_HOURS,
    MS_PER_DAY,
    MS_PER_HOUR,
  };
  // Cache and URL helpers
  window.cw.getCache = getCache;
  window.cw.setCache = setCache;
  window.cw.buildProviderUrl = buildProviderUrl;
  window.cw.findClosestIndex = findClosestIndex;
  window.cw.windToUnits = windToUnits;
  window.cw.safeNum = safeNum;
  window.cw.computeLuminance = computeLuminance;
  // Icons per provider
  window.cw.icons = {
    om: getWeatherIconClassOpenMeteo,
    mb: getWeatherIconClassMeteoBlue,
    ow: getWeatherIconClassOpenWeather,
  };
  // Summary/header builders and time formatter
  window.cw.summary = {
    computeRouteSummary,
    buildRouteSummaryHTML,
    buildCombinedHeaderHTML,
    buildSunHeaderCell,
  };
  window.cw.getDetailedCategoryOpenMeteo = getDetailedCategoryOpenMeteo;
  window.cw.getDetailedCategoryOpenWeather = getDetailedCategoryOpenWeather;
  window.cw.getDetailedCategoryMeteoBlue = getDetailedCategoryMeteoBlue;
  window.cw.formatTime = formatTime;
  // Allow compare.js to set a baseline and re-render markers
  window.cw.setWeatherData = (arr) => { weatherData = Array.isArray(arr) ? arr.slice() : []; };
  window.cw.renderWindMarkers = renderWindMarkers;
  // Allow compare mode to force-clear markers once when entering
  window.cw.clearMarkers = () => {
    try { windMarkers.forEach(m => map && map.removeLayer(m)); } catch(_) {}
    windMarkers = [];
    try { rainMarkers.forEach(m => map && map.removeLayer(m)); } catch(_) {}
    rainMarkers = [];
    // Do NOT modify window.cw._compareMarkersCleared here; compare mode logic manages that flag
  };
  // NEW: expose function to create markers for specific data
  window.cw.createMarkersForData = createMarkersForData;
  // NEW: expose selection helpers for compare clicks
  window.cw.highlightColumn = (col) => highlightColumn(col);
  window.cw.highlightMapStep = (idx, center = false) => highlightMapStep(idx, center);
} catch (_) {
  // ignore: hooks are optional
}
document.addEventListener("DOMContentLoaded", () => {
  // Init code only
  initMap();
  bindUIEvents();
  loadSettings();
  applyTranslations();
  updateProviderOptions();
  setupDateLimits();

  // Ajuste del selector de hora: pasos 15 min y valor inicial redondeado hacia arriba
  const dt = document.getElementById("datetimeRoute");
  if (dt) {
    dt.step = 900; // 15 minutos
    const rounded = roundToNextQuarterISO(new Date());
    dt.value = rounded;
  }

  // Observe map container size changes and window resizes to keep track centered
  const mapEl = document.getElementById("map");
  if (mapEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleMapResizeRecenter());
    ro.observe(mapEl);
  }
  window.addEventListener("resize", scheduleMapResizeRecenter, { passive: true });
  window.addEventListener("orientationchange", scheduleMapResizeRecenter, { passive: true });

  hideLoading();
  logDebug(t("app_started"));
});