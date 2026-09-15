// Fallback: derive a simple WMO weathercode from basic precipitation and cloud cover
// Conservative mapping:
// - if precipitation > PRECIP_MIN -> return 80 (rain/showers cluster)
// - else use cloudCover thresholds to return clear(0), partly(1), cloudy(3)
function fallbackWmoFromBasics(precip, cloudCover) {
  const p = Number(precip) || 0;
  const c = Number(cloudCover);
  if (p > PRECIP_MIN) return 80; // use 80-group for precipitation
  if (!Number.isFinite(c)) return 0;
  if (c < 20) return 0; // clear
  if (c < 60) return 1; // partly
  return 3; // cloudy/overcast
}
// Presentation helper: map a rainy WMO code to a non-precip equivalent using cloudCover
function mapWmoToNonPrecip(code, cloudCover) {
  const c = Number(cloudCover);
  // If no valid code, use the fallback derivation (presentation-only)
  if (code == null || code === "" || Number.isNaN(Number(code))) {
    return fallbackWmoFromBasics(0, c);
  }
  const kc = Number(code);

  // Keep clear/partly/overcast/fog as-is
  if (kc === 0 || kc === 1 || kc === 2 || kc === 3 || kc === 45 || kc === 48) return kc;

  // Thunder-related codes: preserve thunder as the non-precip characteristic
  if (kc >= 95 && kc <= 99) {
    // map to a generic thunder code (95) to keep thunder visual but avoid rain detail
    return 95;
  }

  // Groups of precipitation codes that we want to strip to a cloud-based visual
  const precipLike = new Set([
    // Drizzle / light precip
    51, 53, 55,
    // Freezing drizzle
    56, 57,
    // Rain
    61, 63, 65,
    // Freezing rain
    66, 67,
    // Snow
    71, 73, 75, 77, 85, 86,
    // Showers
    80, 81, 82
  ]);

  if (precipLike.has(kc)) {
    // Use cloudCover to choose between clear/partly/overcast fallback
    if (!Number.isFinite(c)) return fallbackWmoFromBasics(0, c);
    if (c < 10) return 0;      // mostly clear despite precip code
    if (c < 60) return 1;      // partlycloudy
    return 3;                  // overcast
  }

  // For any other unknown codes, return original as a safe default
  return kc;
}
// Additional context lines can be added here if necessary
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
const OPENWEATHER_MAX_DAYS = 4;
// Match providerChains (ow2_arome_openmeteo uses OpenWeather for 0..1 hour)
const OPENWEATHER_MAX_HOURS = 1; 
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
function buildProviderUrl(prov, p, timeAt, apiKey, windUnit, tempUnit, alerts) {
  if (prov === "aromehd") {
    // Open‑Meteo with AROME‑HD model; same hourly variables as standard OM
    // Note: models=meteofrance_arome_hd is the AROME high‑resolution variant.
    // Decide whether to request higher-resolution minutely_15 for near-term (first 6 hours)
    // NOTE: minutely_15 on Open-Meteo expects a comma-separated list of variables
    // (works like `hourly=`). We'll request precipitation and its probability by default.
    const nowMs = Date.now();
    const tMs = (timeAt && timeAt.getTime) ? timeAt.getTime() : new Date(timeAt).getTime();
    const hoursFromNow = (tMs - nowMs) / (1000 * 60 * 60);
  const wantMinutely = (typeof hoursFromNow === 'number' && hoursFromNow >= - (1/60) && hoursFromNow <= 5);
    const hourlyVars = 'temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,winddirection_10m,weathercode,uv_index,is_day,cloud_cover';
    const minutelyVars = hourlyVars; // request same variables in minutely_15 as in hourly
    // Open-Meteo ignores `start=`; ask for the day range around the step instead
    // (one day each side, to cover any timezone offset at the location).
    const day = (n) => new Date(tMs + n * 86400000).toISOString().slice(0, 10);
    return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      // CHANGED: ask for a full hourly variable set (model may not fill everything)
      `&hourly=${hourlyVars}` +
      `${wantMinutely ? `&minutely_15=${minutelyVars}` : ''}` +
      `&start_date=${day(-1)}&end_date=${day(1)}&timezone=auto&models=arome_france_hd`;
  }
  if (prov === "meteoblue") {
    return `https://my.meteoblue.com/packages/basic-1h,clouds-1h?lat=${p.lat}&lon=${p.lon}&apikey=${apiKey}&time=${timeAt.toISOString()}&tz=auto`;
  }
  if (prov === "openweather") {
    // Units: metric (°C, m/s), imperial (°F, mph). We normalize later.
    const units = (String(tempUnit || "").toLowerCase().startsWith("f")) ? "imperial" : "metric";
    // The computation passes the checkbox it read. A caller that says nothing (compare.js)
    // asks for alerts, as it always has.
    const showAlerts = alerts !== false;
    const excludeParts = showAlerts ? "minutely" : "minutely,alerts";
    // Hourly is limited (~48h). We include daily to allow fallback.
    return `https://api.openweathermap.org/data/3.0/onecall?lat=${p.lat}&lon=${p.lon}&appid=${apiKey}&units=${units}&exclude=${excludeParts}`;
  }
  // openmeteo
  // For Open-Meteo, enable minutely_15 in near-term to get denser data for the first ~6 hours
  // NOTE: minutely_15 expects a list of variables like hourly; request precipitation + probability
  const nowMs = Date.now();
  const tMs = (timeAt && timeAt.getTime) ? timeAt.getTime() : new Date(timeAt).getTime();
  const hoursFromNow = (tMs - nowMs) / (1000 * 60 * 60);
  const wantMinutely = (typeof hoursFromNow === 'number' && hoursFromNow >= - (1/60) && hoursFromNow <= 5);
  const hourlyVars = 'temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,winddirection_10m,weathercode,uv_index,is_day,cloud_cover';
  const minutelyVars = hourlyVars;
  // Open-Meteo ignores `start=`; ask for the day range around the step instead
  // (one day each side, to cover any timezone offset at the location).
  const day = (n) => new Date(tMs + n * 86400000).toISOString().slice(0, 10);
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=${hourlyVars}` +
    `${wantMinutely ? `&minutely_15=${minutelyVars}` : ''}` +
    `&start_date=${day(-1)}&end_date=${day(1)}&timezone=auto`;
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


// The steps of a route at the speed, interval and start in the form now, or null when it
// cannot be segmented (logged, and a start out of range also says so).
function segmentRouteByTime(geojson) {
  if (!geojson || !Array.isArray(geojson.features) || !geojson.features.length) {
    logDebug(t("geojson_invalid"), true);
    return null;
  }
  // The same line the route's validation will use: never a marker, never a stray point.
  const coords = cwForecastRules.routeLine(geojson);
  if (!coords) {
    logDebug(t("track_too_short"), true);
    return null;
  }

  const speed = Number(getVal("cyclingSpeed")) || 12;
  const intervalMinutes = Number(getVal("intervalSelect")) || 15;
  const datetimeValue = getVal("datetimeRoute");
  if (!datetimeValue) {
    logDebug(t("route_date_empty"), true);
    if (window.setNotice) window.setNotice(t("route_date_empty"), 'error');
    return null;
  }

  let startDateTime = getValidatedDateTime();

  if (isNaN(startDateTime.getTime())) {
    logDebug(t("route_date_invalid", { val: datetimeValue }), true);
    if (window.setNotice) window.setNotice(t("route_date_invalid", { val: datetimeValue }), 'error');
    return null;
  }

  // Validate date range (today to today + 14 days)
  const dateValidation = window.validateDateRange(datetimeValue, 'fecha de salida');
  if (!dateValidation.valid) {
    logDebug(dateValidation.error, true);
    if (window.setNotice) window.setNotice(dateValidation.error, 'error');
    return null;
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

  return { steps, timeSteps };
}

// Identities (spec §4.2). The confirmed route is the one the last request to confirm put
// on screen, with that request's number; every computation takes the next number when it
// is launched. Only a snapshot carrying both, and matching both, may publish, so neither a
// computation replaced by another nor one of a route no longer on screen reaches the
// screen. Nothing here is stored.
let confirmedRoute = null;        // { requestId, name, fingerprint, geojson, text }
let lastComputationId = 0;
let runningComputationId = null;
let publishedSnapshot = null;
// The latest computation when a route last failed to open and said so. That computation
// publishing with nothing to say leaves the failure up instead of clearing it.
let routeFailureComputationId = null;

window.cwNotifyRouteFailure = function (message) {
  routeFailureComputationId = lastComputationId;
  setNotice(message, "error");
};

function publishState() {
  return { confirmedRequestId: confirmedRoute ? confirmedRoute.requestId : null, lastComputationId };
}

// Launches a computation of the confirmed route. The number is taken, and the previous
// computation's claim on the indicator dropped, before anything is read: the computation
// it replaces cannot publish over it, even when this one stops at once on its start date.
// One that stops or throws before it fetches lets go here, or it would stay current forever.
window.cwLaunchComputation = function () {
  if (!confirmedRoute) return null;
  const cid = ++lastComputationId;
  window.cw.releaseLoadingPrefix("forecast:");
  // A comparison of the snapshot this computation replaces will not paint, so it lets go too.
  window.cw.releaseLoadingPrefix("compare:");
  window.cw.claimLoading("forecast:" + cid);
  runningComputationId = cid;
  let failure = null;
  try {
    const segmented = segmentRouteByTime(confirmedRoute.geojson);
    if (segmented) {
      fetchWeatherForSteps(segmented.steps, segmented.timeSteps, readForecastSettings(),
        { requestId: confirmedRoute.requestId, computationId: cid });
      return cid;
    }
  } catch (err) {
    failure = err;
  }
  // Let go before saying anything, so a notice that throws cannot keep the indicator on.
  window.cw.releaseLoading("forecast:" + cid);
  runningComputationId = null;
  if (failure) {
    logDebug(t("error_api", { msg: failure.message }), true);
    setNotice(t("error_api", { msg: failure.message }), "error");
  }
  return cid;
};

window.cwHasConfirmedRoute = () => !!confirmedRoute;

// Comparisons (compare.js) compare the snapshot on screen and take their own number when
// launched. One paints only while that snapshot is still the published one, of the confirmed
// route and of the latest computation, and no comparison was launched after it. Launching one
// launches no computation: reconciling and preparing still see the normal snapshot.
let lastComparisonId = 0;

window.cwLaunchComparison = function (kind) {
  const snapshot = window.cw.currentSnapshot();
  // A computation still running replaces that snapshot; its publish launches the comparison.
  if (!snapshot || snapshot.computationId !== lastComputationId) return null;
  const comparisonId = ++lastComparisonId;
  window.cw.releaseLoadingPrefix("compare:");
  window.cw.claimLoading("compare:" + comparisonId);
  return { kind, requestId: snapshot.requestId, computationId: snapshot.computationId, comparisonId, snapshot };
};

window.cwIsComparisonCurrent = (run) => cwForecastRules.shouldPublishComparison(run, {
  confirmedRequestId: confirmedRoute ? confirmedRoute.requestId : null,
  lastComputationId,
  publishedComputationId: publishedSnapshot ? publishedSnapshot.computationId : null,
  lastComparisonId,
});

// Leaving compare mode: no comparison still running paints, and none keeps the indicator on.
window.cwCancelComparisons = function () {
  ++lastComparisonId;
  window.cw.releaseLoadingPrefix("compare:");
};

// The confirmed route has a forecast of its latest computation on screen, or that
// computation is still running. A request ending recomputes a route without either.
window.cwHasCurrentForecast = () => !!confirmedRoute && (
  (!!publishedSnapshot && publishedSnapshot.computationId === lastComputationId
    && publishedSnapshot.requestId === confirmedRoute.requestId)
  || runningComputationId === lastComputationId);
// Everything a computation depends on, read once when it starts. A setting changed while
// it is still fetching belongs to the next computation, never to the rest of this one.
function readForecastSettings() {
  const keys = { meteoblue: getVal("apiKey") || "", openweather: getVal("apiKeyOW") || "" };
  const alerts = !!document.getElementById("showWeatherAlerts")?.checked;
  return {
    provider: apiSource,
    units: { temp: getVal("tempUnits"), wind: getVal("windUnits") },
    keys,
    noticeAll: !!document.getElementById("noticeAll")?.checked,
    alerts,
    interval: Number(getVal("intervalSelect")) || 15,
    lang: getVal("language") === "es" ? "es" : "en",
    // What the ride watch needs to look up official warnings in the background, and only
    // when the user shows them. Kept in memory with the snapshot, never stored.
    alertsKey: alerts ? keys.openweather : "",
  };
}

// The published snapshot while it still belongs to the confirmed route, or null. What the
// ride watch and the comparison work from: a route still being read changes nothing here.
window.cw.currentSnapshot = () =>
  (publishedSnapshot && confirmedRoute && publishedSnapshot.requestId === confirmedRoute.requestId
    ? publishedSnapshot : null);

async function fetchWeatherForSteps(steps, timeSteps, settings, ids) {
  // Still the latest computation launched, of the route last confirmed. Checked after
  // every wait: a computation that is not stops without writing or asking for anything.
  const isCurrent = () => cwForecastRules.shouldPublish(ids, publishState());
  // Anything thrown from here on ends in the catch below, which lets go of the claim.
  try {
  const route = confirmedRoute
    ? { name: confirmedRoute.name, fingerprint: confirmedRoute.fingerprint }
    : { name: "", fingerprint: "" };
  const results = [];
  // What this computation's requests and cache reads saw; the notice is decided from it.
  const recorder = window.cw.utils.createRecorder();
  // Official warnings found along the way. They belong to this computation and are shown
  // only if it is published.
  const alertsSeen = [];

  // A body that cannot be read is a failed answer, not a success with no data.
  const readJson = (response) => response.json().catch((err) => {
    recorder.failed++;
    recorder.lastFailStatus = 'body';
    if (window.cw.utils.isOffline()) recorder.offline = true;
    throw err;
  });

  let apiKeyFinal = "";
  if (settings.provider === "meteoblue") {
    apiKeyFinal = settings.keys.meteoblue;
  } else if (settings.provider === "openweather") {
    apiKeyFinal = settings.keys.openweather;
  }
  const tempUnit = settings.units.temp;
  const windUnit = settings.units.wind;
  const now = new Date();

  const showAllNotices = settings.noticeAll;
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
  let httpErrOnceOM = false;
  let lastHttpStatusOM = null;

  // NEW: fail-fast state for OpenWeather
  let providerHardFailCodeOWM = null;
  let providerFailCountOWM = 0;
  const providerFailLimitOWM = 3;

  // NEW: remember horizon days for notice
  let horizonDaysUsed = null;

  // If provider requires key but not provided (MB or OWM), fallback to Open‑Meteo
  const providerNeedsKey = (settings.provider === "meteoblue" || settings.provider === "openweather");
  const hasKey = (apiKeyFinal || "").trim().length >= 5;
    for (let i = 0; i < steps.length; i++) {
      if (!isCurrent()) return;
      const p = steps[i];
      const timeAt = timeSteps[i];

      const daysAhead = (timeAt - now) / MS_PER_DAY;
      const hoursAhead = (timeAt - now) / MS_PER_HOUR;   // NEW

      let prov = settings.provider;

      // NEW: resolve chain provider (e.g. ow2_arome_openmeteo) per timestamp
      let isChain = false;
      try {
        const chains = (window.cw && window.cw.utils && window.cw.utils.providerChains) || {};
        isChain = !!chains[String(settings.provider || '').toLowerCase()];
        if (isChain) {
          const resolver = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp;
          if (typeof resolver === 'function') {
            const eff = resolver(settings.provider, timeAt, now, { lat: p.lat, lon: p.lon });
            if (eff) prov = eff;
          }
        }
      } catch(e){ console.warn('chain resolve error', e); }

      // Determine API key for this effective provider (chain-aware)
      const stepApiKey = (prov === 'meteoblue') ? settings.keys.meteoblue : (prov === 'openweather') ? settings.keys.openweather : '';
      const hasKeyProv = stepApiKey.trim().length >= 5;

      // store provider on step so later processing knows real source (may still change if fallback)
      p.provider = prov;
      if (i === 0) logDebug(`chainMode=${settings.provider} -> first provider=${prov}`);
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
      if (prov === "openweather" && ((isChain && hoursAhead > OPENWEATHER_MAX_HOURS) || (!isChain && daysAhead > OPENWEATHER_MAX_DAYS))) {
        prov = "openmeteo";
        p.provider = prov;
        usedFallback = true;
        usedFallbackHorizon = true;
        horizonDaysUsed = isChain ? OPENWEATHER_MAX_HOURS / 24 : OPENWEATHER_MAX_DAYS;
        if (!warnedFallback) {
          const limit = isChain ? `${OPENWEATHER_MAX_HOURS} horas` : `${OPENWEATHER_MAX_DAYS} días`;
          logDebug(`OpenWeather excede ${limit}; usando Open‑Meteo como fallback.`);
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
        results.push({ ...p, provider: "openmeteo", weather: null });
        continue;
      }

      // After all fallbacks, update provider on step before cache/fetch
      p.provider = prov;

  const mkPrim = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
  const keyPrim = mkPrim(prov, timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
  try { window.logDebug && window.logDebug(`cache lookup key=${keyPrim} provider=${prov}`); } catch(e){}
  const cachedPrim = getCache(keyPrim, recorder);
      if (cachedPrim) {
        results.push({ ...p, provider: prov, weather: cachedPrim });
        logDebug(`Cache usado paso ${i + 1} (${prov})`);
        continue;
      }

      let res, json, ok = false;

      try {
        const urlPrim = buildProviderUrl(prov, p, timeAt, stepApiKey, windUnit, tempUnit, settings.alerts);
        res = await fetch(urlPrim, { cwRecorder: recorder });
        // Diagnostic logging for OpenWeather: record status and masked URL (hide appid)
        if (prov === "openweather") {
          try {
            const masked = String(urlPrim).replace(/([&?]appid)=([^&]+)/, "$1=***");
            logDebug(`OpenWeather fetch step=${i+1} status=${res.status} url=${masked}`);
          } catch (e) { /* ignore logging errors */ }
        }
        if (res.ok) {
          json = await readJson(res);
          if (!isCurrent()) return;
          // Sanity-check / normalize payload shape for OpenWeather
          if (prov === "openweather") {
            try {
              // Common variants: { hourly: { data: [...] } } or { hourly: { list: [...] } }
              let normalized = false;
              if (json && json.hourly && !Array.isArray(json.hourly)) {
                if (Array.isArray(json.hourly.data)) {
                  json.hourly = json.hourly.data;
                  normalized = true;
                } else if (Array.isArray(json.hourly.list)) {
                  json.hourly = json.hourly.list;
                  normalized = true;
                } else {
                  // If hourly is an object keyed by dt indexes, attempt to convert values to array
                  const vals = Object.values(json.hourly).filter(v => v != null);
                  if (vals.length && Array.isArray(vals[0])) {
                    json.hourly = vals[0];
                    normalized = true;
                  }
                }
              }
              if (json && json.daily && !Array.isArray(json.daily)) {
                if (Array.isArray(json.daily.data)) { json.daily = json.daily.data; normalized = true; }
                else if (Array.isArray(json.daily.list)) { json.daily = json.daily.list; normalized = true; }
              }
              const keys = Object.keys(json || {});
              const hasHourly = Array.isArray(json.hourly) && json.hourly.length > 0;
              const hasDaily = Array.isArray(json.daily) && json.daily.length > 0;
              if (normalized) logDebug(`OpenWeather: normalized payload shape; keys=${keys.join(',')}`);
              if (!hasHourly && !hasDaily) {
                logDebug(`OpenWeather: unexpected payload keys=${keys.join(',')}`);
              } else {
                logDebug(`OpenWeather: payload ok (hourly=${hasHourly?json.hourly.length:0}, daily=${hasDaily?json.daily.length:0})`);
              }
            } catch (e) { logDebug('OpenWeather: normalization error'); }
          }
          if (prov === "aromehd") {
            try {
              const urlStd = buildProviderUrl("openmeteo", p, timeAt, stepApiKey, windUnit, tempUnit, settings.alerts);
              if (!isCurrent()) return;
              const resStd = await fetch(urlStd, { cwRecorder: recorder });
              if (!isCurrent()) return;
              if (resStd.ok) {
                const std = await readJson(resStd);
                if (!isCurrent()) return;
                try {
                  // Cache the standard Open‑Meteo response so future Open‑Meteo-only requests
                  // for the same step/time/coords can reuse it instead of re-fetching.
                  const mkStd = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
                  const keyStd = mkStd('openmeteo', timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
                  try { setCache(keyStd, std); } catch (e) { /* ignore cache set errors */ }
                } catch (e) { /* ignore cache instrumentation errors */ }
                cwForecastRules.mergeAromeWithStandard(json, std);
              }
            } catch (_) {}
            if (aromeResponseLooksInvalid(json)) {
              const prov2 = "openmeteo";
              const mk2 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
              const key2 = mk2(prov2, timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
              const cached2 = getCache(key2, recorder);
              if (cached2) { results.push({ ...p, provider: prov2, weather: cached2 }); logDebug(`AROME invalido paso ${i+1}, cache OM`); continue; }
              const url2 = buildProviderUrl(prov2, p, timeAt, '', windUnit, tempUnit, settings.alerts);
              if (!isCurrent()) return;
              const res2 = await fetch(url2, { cwRecorder: recorder });
              if (res2.ok) { const json2 = await readJson(res2);
                if (!isCurrent()) return;
                results.push({ ...p, provider: prov2, weather: json2 });
                setCache(key2, json2);
                continue;
              } else {
                results.push({ ...p, provider: prov2, weather: null });
                continue;
              }
            }
          }
          ok = true;
        } else {
          // existing error handling left unchanged
          const bodyText = await res.text().catch(() => "");
          // Additional diagnostic for OpenWeather: include small snippet of body when error
          if (prov === "openweather") {
            try {
              const snippet = (bodyText || "").slice(0, 400).replace(/\n/g, ' ');
              logDebug(`OpenWeather error body snippet: ${snippet}`);
            } catch (e) {}
          }
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
            const mk3 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
            const key2 = mk3(prov2, timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
            const cached2 = getCache(key2, recorder);
            usedFallback = true;
            usedFallbackError = true;

            if (cached2) {
              results.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit, settings.alerts);
            if (!isCurrent()) return;
            const res2 = await fetch(url2, { cwRecorder: recorder });
            if (res2.ok) {
              const json2 = await readJson(res2);
              if (!isCurrent()) return;
              results.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              results.push({ ...p, provider: prov2, weather: null });
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
            const mk4 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
            const key2 = mk4(prov2, timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
            const cached2 = getCache(key2, recorder);
            usedFallback = true;
            usedFallbackError = true;

            if (cached2) {
              results.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit, settings.alerts);
            if (!isCurrent()) return;
            const res2 = await fetch(url2, { cwRecorder: recorder });
            if (res2.ok) {
              const json2 = await readJson(res2);
              if (!isCurrent()) return;
              results.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              results.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          } else if (prov === "aromehd") {
            // NEW: On AROME error, try standard Open‑Meteo (no fallback flags/notices)
            const prov2 = "openmeteo";
            const mk5 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
            const key2 = mk5(prov2, timeAt.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, timeAt);
            const cached2 = getCache(key2, recorder);
            if (cached2) {
              results.push({ ...p, provider: prov2, weather: cached2 });
              continue;
            }
            const url2 = buildProviderUrl(prov2, p, timeAt, apiKeyFinal, windUnit, tempUnit, settings.alerts);
            if (!isCurrent()) return;
            const res2 = await fetch(url2, { cwRecorder: recorder });
            if (res2.ok) {
              const json2 = await readJson(res2);
              if (!isCurrent()) return;
              results.push({ ...p, provider: prov2, weather: json2 });
              setCache(key2, json2);
              continue;
            } else {
              results.push({ ...p, provider: prov2, weather: null });
              continue;
            }
          } else {
            // Non-recoverable or non-meteoblue error -> blank step but keep going
            lastHttpStatusOM = res.status;
            if (!httpErrOnceOM) {
              httpErrOnceOM = true;
              logDebug(t("provider_http_error", { prov: "Open‑Meteo", status: res.status }), true);
            }
          }
        }
      } catch (err) {
        logDebug(t("error_api_step", { step: i + 1, msg: err.message }), true);
      }

      if (!isCurrent()) return;
      if (ok && json) {
        // Check for weather alerts if using OpenWeather and alerts are enabled
        if (prov === "openweather" && Array.isArray(json.alerts) && settings.alerts) {
          alertsSeen.push(...json.alerts);
        }
        
        // For OpenWeather: the response contains an array of hourly entries. Cache
        // the entire payload under the primary key, but also cache per-hour payload
        // entries so later lookups for a different step/time find a cached value.
        if (prov === 'openweather' && Array.isArray(json.hourly) && json.hourly.length) {
          try {
            const mk = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
            // Cache the full payload under the original primary key too
            setCache(keyPrim, json);
            window.logDebug && window.logDebug(`setCache key=${keyPrim} provider=${prov}`);
            // Iterate hourly list and store each hour under its own canonical key
            for (let hi = 0; hi < json.hourly.length; hi++) {
              const h = json.hourly[hi];
              // openweather hourly entries may use 'dt' (seconds) or 'time' (ISO)
              let ht = null;
              if (h && h.dt) ht = new Date(Number(h.dt) * 1000);
              else if (h && h.time) ht = new Date(h.time);
              if (!ht || isNaN(ht.getTime())) continue;
              const keyH = mk('openweather', ht.toISOString().substring(0,10), tempUnit, windUnit, p.lat, p.lon, ht);
              try { setCache(keyH, json); window.logDebug && window.logDebug(`setCache key=${keyH} provider=openweather (hourly)`); } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore per-hour cache failures */ }
        } else {
          try { setCache(keyPrim, json); window.logDebug && window.logDebug(`setCache key=${keyPrim} provider=${prov}`); } catch(e) {}
        }
        results.push({ ...p, provider: prov, weather: json });
        logDebug(`Datos recibidos paso ${i + 1} (${prov})`);
        await new Promise(r => setTimeout(r, 70));
      } else {
        results.push({ ...p, provider: prov, weather: null });
      }

      logDebug(`step ${i+1}/${steps.length} effectiveProv(final)=${prov}`);
    }

  // Check for weather alerts independently if we have OpenWeather API key
  if (!isCurrent()) return;
  await checkWeatherAlertsIndependent(steps, timeSteps, alertsSeen, settings, isCurrent);
  if (!isCurrent()) return;

  const owUnits = String(tempUnit || "").toLowerCase().startsWith("f") ? "imperial" : "metric";
  const snapshotSteps = results.map((r) => ({
    lat: r.lat, lon: r.lon, time: r.time, distanceM: r.distanceM, provider: r.provider,
    payloadUnits: r.provider === "openweather" ? owUnits : null,
    payload: r.weather,
  }));
  publish({
    version: 1,
    requestId: ids.requestId,
    computationId: ids.computationId,
    route,
    settings: {
      provider: settings.provider, units: settings.units, noticeAll: settings.noticeAll, alerts: settings.alerts,
      interval: settings.interval, lang: settings.lang, alertsKey: settings.alertsKey,
      keys: settings.keys,   // what a comparison of this snapshot asks with; memory only
    },
    steps: snapshotSteps,
    // Providers only report warnings active when asked; keep those near the ride.
    alerts: timeSteps.length
      ? cwForecastRules.alertsInWindow(alertsSeen,
          timeSteps[0].getTime() / 1000 - 4 * 3600,
          timeSteps[timeSteps.length - 1].getTime() / 1000 + 4 * 3600)
      : [],
    outcome: {
      requestedProvider: settings.provider,
      usableSteps: cwForecastRules.usableSteps(snapshotSteps),
      transportFailures: recorder.failed,
      lastFailStatus: recorder.lastFailStatus,
      offline: recorder.offline,
      staleAgeMs: recorder.staleAgeMs,
      beyondHorizon,
      openMeteoMaxDays: OPENMETEO_MAX_DAYS,
      usedFallback,
      usedFallbackError,
      usedFallbackHorizon,
      horizonDays: horizonDaysUsed ?? METEOBLUE_MAX_DAYS,
      missingKey: missingKeyFallback && providerNeedsKey,
      providers: {
        meteoblue: { invalidKey: invalidKeyOnce, quota: quotaOnce, httpError: httpErrOnce, httpStatus: lastHttpStatusMB },
        openweather: { invalidKey: invalidKeyOnceOWM, quota: quotaOnceOWM, httpError: httpErrOnceOWM, httpStatus: lastHttpStatusOWM },
        openmeteo: { httpError: httpErrOnceOM, httpStatus: lastHttpStatusOM },
      },
    },
    origin: "live",
    createdAt: Date.now(),
  });
  } catch (err) {
    // Let go first, so a notice that throws cannot keep the indicator on.
    const current = isCurrent();
    if (current) window.cw.releaseLoading("forecast:" + ids.computationId);
    logDebug(t("error_api", { msg: err.message }), true);
    if (current) setNotice(t("error_api", { msg: err.message }), "error");
  } finally {
    if (runningComputationId === ids.computationId) runningComputationId = null;
  }
}

/**
 * The published computation's official warnings that still matter, from now or the
 * start of the ride, whichever is later, to its end. Replaces whatever was shown.
 */
function showOfficialAlerts(snapshot) {
  const steps = snapshot.steps || [];
  const startSec = steps.length ? new Date(steps[0].time).getTime() / 1000 : 0;
  const endSec = steps.length ? new Date(steps[steps.length - 1].time).getTime() / 1000 : 0;
  const shown = cwForecastRules.alertsInWindow(snapshot.alerts, Math.max(Date.now() / 1000, startSec), endSec);
  window.activeWeatherAlerts = shown.map((a) => ({
    id: cwForecastRules.alertId(a),
    senderName: a.sender_name,
    event: a.event,
    start: a.start,
    end: a.end,
    description: a.description,
    tags: a.tags || [],
    processed: false,
  }));
  const container = document.getElementById("weather-alerts-container");
  if (container) {
    container.style.display = "none";
    container.querySelectorAll(".weather-alert").forEach((el) => el.remove());
  }
  hideAndCleanupAlertIndicator();
  if (window.activeWeatherAlerts.length) showWeatherAlerts();
}

/**
 * Puts a finished computation on screen, and nothing else may. Every effect happens
 * here in one go, with no wait between checking that the computation is still the
 * latest and the last effect: the table, the notice, `cw:forecast` and the indicator.
 */
function publish(snapshot) {
  if (!cwForecastRules.shouldPublish(snapshot, publishState())) return false;
  publishedSnapshot = snapshot;
  weatherData = mirrorSteps(snapshot);
  processWeatherData();
  showOfficialAlerts(snapshot);
  showNotice(snapshot.outcome, snapshot.settings.noticeAll, routeFailureComputationId === snapshot.computationId);
  try {
    document.dispatchEvent(new CustomEvent("cw:forecast", { detail: { snapshot, steps: weatherData } }));
  } catch (e) { /* ignore */ }
  window.cw.releaseLoading("forecast:" + snapshot.computationId);
  // With compare chosen, the providers comparison of this snapshot starts here.
  if (snapshot.origin === "live" && document.getElementById("apiSource")?.value === "compare") {
    window.cw.runCompareMode?.();
  }
  return true;
}

// The steps of a snapshot in the shape the table and the markers read (window.weatherData).
// tempUnit is the temperature unit the snapshot was computed in; the table labels the
// temperature with it, not with the selector, which may have changed since.
function mirrorSteps(snapshot) {
  return snapshot.steps.map((s) => ({
    lat: s.lat, lon: s.lon, time: s.time, distanceM: s.distanceM,
    provider: s.provider, payloadUnits: s.payloadUnits, weather: s.payload,
    tempUnit: snapshot.settings.units.temp,
  }));
}

// keepFailure: a route failed to open while this computation ran and said so. With nothing
// of its own to say, the computation leaves that notice up; a notice of its own replaces it.
// Once replaced or cleared, the failure is forgotten: a later comparison of the same
// computation with nothing to say clears whatever notice is up then.
function showNotice(outcome, noticeAll, keepFailure = false) {
  const notice = cwForecastRules.decideNotice(outcome, { noticeAll });
  if (notice) setNotice(notice.parts.map(([key, params]) => t(key, params)).join(" "), notice.type);
  else if (keepFailure) return;
  else clearNotice();
  routeFailureComputationId = null;
}
// A comparison (compare.js) decides and shows its notice the same way, and leaves up the notice
// of a route that failed to open while the computation it compares was the latest.
window.cwShowForecastNotice = (outcome, noticeAll, run) =>
  showNotice(outcome, noticeAll, routeFailureComputationId === run.computationId);

// Paints the published snapshot again for a setting that only changes how it looks
// (language, detailed notices): the table from the answers it holds, and its notice
// decided with the checkbox as it is now. Nothing is fetched, cw:forecast is not sent
// and the indicator is left alone.
window.cwRepaintPublished = function () {
  if (!publishedSnapshot) return false;
  weatherData = mirrorSteps(publishedSnapshot);
  processWeatherData();
  // A failure still recorded was said over this snapshot, or over the computation that is
  // replacing it (every publish after it forgets it), so the repaint leaves it up too.
  showNotice(publishedSnapshot.outcome, !!document.getElementById("noticeAll")?.checked,
    routeFailureComputationId !== null);
  return true;
};

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
    let idx = -1;              // only the MeteoBlue branch still reads it
    let extracted = null;
    if (prov === "openmeteo" || prov === "aromehd") {
      // Ensure we have at least hourly data shape to work with
      if (!w.hourly || !w.hourly.time) return;
      extracted = cwForecastRules.extractStep(w, { provider: prov, time: step.time });
      step.__useMinutely = !!(extracted && extracted.useMinutely);
      if (step.__useMinutely) step.__minutelyIndex = extracted.minutelyIndex;
    }
    // NEW: OpenWeather extraction (prefer hourly, fallback to daily)
    if (prov === "openweather") {
      // isDaylight via SunCalc (robust for icons/luminance)
      try {
        const pos = SunCalc.getPosition(new Date(step.time), step.lat, step.lon);
        step.isDaylight = pos.altitude > 0 ? 1 : 0;
      } catch { step.isDaylight = 1; }

      // The units the answer was requested in travel with the step; the current setting
      // is only a guess for a step that does not carry them.
      const payloadUnits = step.payloadUnits || ((String(tempUnit || "").toLowerCase().startsWith("f")) ? "imperial" : "metric");
      const r = cwForecastRules.extractStep(w, { provider: prov, time: step.time, payloadUnits });
      if (r) {
        step.temp = safeNum(r.temp);
        step.windSpeed = safeNum(windToUnits(r.wind, windUnit));
        step.windDir = r.windDir;
        step.windGust = safeNum(r.gust != null ? windToUnits(r.gust, windUnit) : null);
        step.humidity = safeNum(r.humidity);
        step.precipitation = safeNum(r.precipitation);
        step.precipProb = safeNum(r.precipProb);
        step.weatherCode = r.weatherCode;
        step.uvindex = safeNum(r.uvIndex);
        step.cloudCover = safeNum(r.cloudCover);
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
        // Allow showing probability when it's meaningful (>=10%). This avoids hiding
        // isolated/light precipitation chances reported as a percent. Presentation
        // of icons and summary remains governed elsewhere (AROME policy + mapWmoToNonPrecip).
        if (step.precipProb == null || Number(step.precipProb) < 10) {
          step.precipProb = null;
        }
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

    } else if ((prov === "openmeteo" || prov === "aromehd") && extracted) {
      const r = extracted;
      step.temp = safeNum(r.temp);
      step.windSpeed = safeNum(windToUnits(r.wind, windUnit));
      step.windDir = r.windDir || 0;
      step.windGust = safeNum(r.gust != null ? windToUnits(r.gust, windUnit) : null);
      step.humidity = safeNum(r.humidity);
      step.precipitation = safeNum(r.precipitation);
      // AROME may lack precipitation_probability; merged earlier when available
      step.precipProb = safeNum(r.precipProb);
      step.weatherCode = r.weatherCode;
      step.uvindex = (r.uvIndex != null) ? safeNum(r.uvIndex) : null;
      step.isDaylight = r.isDay;
      step.cloudCover = safeNum(r.cloudCover); // 0–100
      step.luminance = computeLuminance(step);

      // NEW: AROME fallbacks and selective reconciliation
      if (prov === "aromehd") {
        if (step.isDaylight == null) {
          try {
            const pos = SunCalc.getPosition(new Date(step.time), step.lat, step.lon);
            step.isDaylight = pos.altitude > 0 ? 1 : 0;
          } catch { /* ignore */ }
        }
        // If still missing, synthesize
        if (step.weatherCode == null) {
          step.weatherCode = fallbackWmoFromBasics(step.precipitation, step.cloudCover);
        } else {
          // Reconcile AROME vs Open-Meteo: prefer forward index values; then adjust
          step.weatherCode = reconcileAromeVsOmCode(
            step.weatherCode,
            step.precipitation,
            step.precipProb,
            step.cloudCover
          );
        }

        // Policy: prefer AROME precipitation as authoritative for icon decisions.
        // If AROME reports precipitation == 0 for this (future-aligned) step, don't show probability
        // and avoid displaying a rain icon even if the reconciled weatherCode suggests rain.
        if (Number(step.precipitation) === 0) {
          // If AROME reports 0 precipitation, prefer not to show small probabilities.
          // Keep precipProb when it's meaningful (>=10%) so users see isolated/spotty chances.
          if (step.precipProb == null || Number(step.precipProb) < 10) {
            step.precipProb = null;
          }
        }
      }
    }

    // Si no hay precipitación, no tiene sentido mostrar probabilidad
    if (step.precipitation != null && Number(step.precipitation) === 0) {
      // Allow showing probability when it's meaningful (>=10%). This avoids hiding
      // isolated/light precipitation chances reported as a percent. Presentation
      // of icons and summary remains governed elsewhere (AROME policy + mapWmoToNonPrecip).
      if (step.precipProb == null || Number(step.precipProb) < 10) {
        step.precipProb = null;
      }
    }

    step.windCombined = formatWindCell(step.windSpeed, step.windGust, step.windDir);
    // FIX: include both precipitation and probability (was only passing probability)
    step.rainCombined = formatRainCell(step.precipitation, step.precipProb);
  });

  renderWeatherTable();
  // Ensure wind/rain markers are rendered in normal mode (do not run in compare mode)
  try {
    const isCompareMode = (document.getElementById('apiSource')?.value || '').toLowerCase() === 'compare';
    if (!isCompareMode && window.cw && typeof window.cw.renderWindMarkers === 'function') {
      window.cw.renderWindMarkers();
    }
  } catch (e) { /* tolerate any DOM errors */ }

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
  // Show probability if:
  // 1. There is precipitation (pNum > 0), OR
  // 2. No precipitation but probability >= 10%
  const showProb = probNum != null && Number.isFinite(probNum) && probNum > 0 && (pNum > 0 || probNum >= 10);
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

function computeRouteSummaryFromArray(srcArr) {
  const dataArr = Array.isArray(srcArr) ? srcArr : [];
  if (!Array.isArray(dataArr) || dataArr.length === 0) return null;
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

  let temps = [], winds = [], gustMax = null, precipMin = null, precipMax = null, probMax = null;
  let cloudSum = 0, cloudCnt = 0;

  let bestCat = "default", bestRank = -1;
  const isDay = (weatherData[0]?.isDaylight === 1) ? "day" : "night";

  for (const step of dataArr) {
    if (step?.temp != null && Number.isFinite(Number(step.temp))) temps.push(Number(step.temp));
    if (step?.windSpeed != null && Number.isFinite(Number(step.windSpeed))) winds.push(Number(step.windSpeed));
    if (step?.windGust != null && Number.isFinite(Number(step.windGust))) {
      gustMax = (gustMax == null) ? Number(step.windGust) : Math.max(gustMax, Number(step.windGust));
    }
    if (step?.precipitation != null && Number.isFinite(Number(step.precipitation))) {
      const p = Number(step.precipitation);
      precipMin = (precipMin == null) ? p : Math.min(precipMin, p);
      precipMax = (precipMax == null) ? p : Math.max(precipMax, p);
    }
    if (step?.precipProb != null && Number.isFinite(Number(step.precipProb))) {
      probMax = (probMax == null) ? Number(step.precipProb) : Math.max(probMax, Number(step.precipProb));
    }
    if (step?.cloudCover != null && Number.isFinite(Number(step.cloudCover))) {
      cloudSum += Number(step.cloudCover);
      cloudCnt++;
    }

    // Categoría detallada por proveedor (CHANGED: provider-aware)
    const prov = step.provider || apiSource;
    // Presentation-only code: if AROME claims 0 precipitation, strip rain for summary decisions
    let presentationCode = step.weatherCode;
    try {
      if (prov === 'aromehd' && Number(step?.precipitation) === 0) {
        presentationCode = mapWmoToNonPrecip(step.weatherCode, step.cloudCover ?? step.cloud_cover ?? 0);
      }
    } catch (e) {
      presentationCode = step.weatherCode;
    }

    let cat = "default";
    if (prov === "meteoblue") cat = getDetailedCategoryMeteoBlue(presentationCode);
    else if (prov === "openweather") cat = getDetailedCategoryOpenWeather(presentationCode);
    else cat = getDetailedCategoryOpenMeteo(presentationCode);

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
  const windMin = winds.length ? Math.min(...winds) : null;
  const windMax = winds.length ? Math.max(...winds) : null;

  const iconClass = (weatherIconsMap[bestCat] || weatherIconsMap.default)[isDay];

  return {
    iconClass,
    tempAvg,
    tempMin,
    tempMax,
    windAvg,
    windMin,
    windMax,
    gustMax,
    precipMin,
    precipMax,
    probMax
  };
}

function computeRouteSummary() {
  // backward-compatible wrapper using the global weatherData
  return computeRouteSummaryFromArray(weatherData);
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
  // If min and max are the same, show single value instead of "2-2"
  const tempTxt = !hasRange ? "-" : (lo === hi ? `${lo}${tempUnitLabel}` : `${lo}–${hi}${tempUnitLabel}`);

  // CHANGED: wrap units to force lowercase in header
  // Wind: show interval if min/max available, keep gust as max
  const windHasRange = (sum.windMin != null) && (sum.windMax != null);
  const windLo = windHasRange ? Math.round(Number(sum.windMin)) : null;
  const windHi = windHasRange ? Math.round(Number(sum.windMax)) : null;
  // If min and max are the same, show single value instead of "2-2"
  const windTxt = (!windHasRange && sum.windAvg == null)
    ? "-"
    : (windHasRange 
        ? (windLo === windHi 
            ? `${windLo} <span class="unit-lower">${windUnitLc}</span>` 
            : `${windLo}–${windHi} <span class="unit-lower">${windUnitLc}</span>`)
        : `${Math.round(Number(sum.windAvg))} <span class="unit-lower">${windUnitLc}</span>`);
  const gustTxt = (sum.gustMax == null) ? "" : ` <span class="rs-paren">(${Math.round(Number(sum.gustMax))})</span>`;
  // Precipitation: show min–max interval when available, and probability as max in parens
  const precipHasRange = (sum.precipMin != null) && (sum.precipMax != null);
  // display rounding: use integers for compactness; if both round to same value, show single value
  const precipLoRaw = precipHasRange ? Number(sum.precipMin) : null;
  const precipHiRaw = precipHasRange ? Number(sum.precipMax) : null;
  const precipLoDisp = precipHasRange ? Math.round(precipLoRaw) : null;
  const precipHiDisp = precipHasRange ? Math.round(precipHiRaw) : null;
  let precipTxt = "-";
  if (!precipHasRange && sum.precipMax != null) {
    precipTxt = `${Math.round(Number(sum.precipMax))} <span class="unit-lower">${precipUnitLc}</span>`;
  } else if (precipHasRange) {
    // Special case: if both raw values are < 0.5 (round to 0), show single "0" instead of "0–0"
    if (precipLoRaw < 0.5 && precipHiRaw < 0.5) {
      precipTxt = `0 <span class="unit-lower">${precipUnitLc}</span>`;
    } else if (precipLoDisp === precipHiDisp) {
      precipTxt = `${precipLoDisp} <span class="unit-lower">${precipUnitLc}</span>`;
    } else {
      precipTxt = `${precipLoDisp}–${precipHiDisp} <span class="unit-lower">${precipUnitLc}</span>`;
    }
  }
  const probTxt = (sum.probMax == null || Number(sum.probMax) <= 0) ? "" : ` <span class="rs-paren">(${Math.round(Number(sum.probMax))}%)</span>`;
 
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

  // In compare mode the comparison table stays until the next comparison paints over it.
  const sel = document.getElementById("apiSource");
  if (sel && sel.value === "compare") return;

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
  // A published forecast's temperature is labelled with the units it was computed in, which a
  // repaint or a units change still waiting can differ from. Steps without them (a comparison)
  // follow the selector.
  const tempUnit = weatherData.find((s) => s && s.tempUnit)?.tempUnit || getVal("tempUnits"); // 'C' o 'F'
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

    const startIconUrl = "/icons/marker-icon-green.png";
    const endIconUrl = "/icons/marker-icon-red.png";
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

  // Provider abbreviations for change indicators
  const providerAbbreviations = {
    'openmeteo': 'OPM',
    'aromehd': 'ARM', 
    'meteoblue': 'MB',
    'openweather': 'OPW'
  };

  // Fila 2: iconos por paso (usar viewData)
  row = document.createElement("tr");
  row.classList.add("icon-row");
  viewData.forEach((w, i) => {
    const th = document.createElement("th");
    const prov = w.provider || apiSource;
    
    // Add provider change indicator when the provider changes from the previous cell
    let providerIndicator = '';
    if (window.apiSource && window.apiSource !== 'compare') {
      const cellProvider = w?.provider;
      const prevProvider = (i > 0) ? viewData[i-1]?.provider : null;
      
      // For chains, check if first cell matches expected first provider of the chain
      let isExpectedFirstProvider = false;
      if (i === 0 && window.apiSource === 'ow2_arome_openmeteo' && cellProvider === 'openweather') {
        // First cell of OPW→ARM→OPM chain should be OPW, so don't show indicator
        isExpectedFirstProvider = true;
      }
      
      // Show indicator if:
      // 1. First cell and provider differs from apiSource (but NOT if it's the expected first provider in a chain), OR
      // 2. Provider differs from previous cell (detects all changes in chains)
      const showIndicator = (i === 0 && cellProvider && cellProvider !== window.apiSource && !isExpectedFirstProvider) || 
                            (i > 0 && cellProvider && cellProvider !== prevProvider);
      
      if (showIndicator) {
        const abbr = providerAbbreviations[cellProvider] || cellProvider.toUpperCase();
        providerIndicator = `<div class="provider-indicator">${abbr}</div>`;
      }
    }
    
    // Set relative positioning for the cell to allow absolute positioning of indicator
    th.style.position = 'relative';
    
    // Presentation-only weather code: if AROME reported 0 precipitation, strip the precipitation
    // component for the icon while keeping the canonical w.weatherCode unchanged.
    let presentationCode = w.weatherCode;
    try {
      if (prov === 'aromehd' && Number(w?.precipitation) === 0) {
        presentationCode = mapWmoToNonPrecip(w.weatherCode, w.cloudCover ?? w.cloud_cover ?? 0);
      }
    } catch (e) {
      // fallback to original code on any unexpected error
      presentationCode = w.weatherCode;
    }

    let iconClass =
      prov === "meteoblue"
        ? getWeatherIconClassMeteoBlue(presentationCode, w.isDaylight)
        : prov === "openweather"
        ? getWeatherIconClassOpenWeather(presentationCode, w.isDaylight)
        : getWeatherIconClassOpenMeteo(presentationCode, w.isDaylight);
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

  // Add provider indicator above the icon wrapper if present
  if (providerIndicator) {
    th.innerHTML = providerIndicator;
  }
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
  const getRowIconHTML = (key, title) => {
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
    const safeTitle = (title || '').toString().replace(/"/g, '&quot;');
    return `<i class="wi ${cls} label-ico" aria-hidden="true" data-tooltip="${safeTitle}"></i>`;
  };

  // Provide tooltip titles for icons (only used in compact mode via CSS/JS)
  const titleMap = {
    temp: (lang === 'es') ? 'Temperatura' : 'Temperature',
    windCombined: (lang === 'es') ? 'Viento y racha' : 'Wind and gusts',
    rainCombined: (lang === 'es') ? 'Lluvia y probabilidad' : 'Rain and probability',
    humidity: (lang === 'es') ? 'Humedad relativa' : 'Relative humidity',
    cloud_uv: (lang === 'es') ? 'Nubes y UV' : 'Clouds and UV'
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
    return `${getRowIconHTML(key, titleMap[key])} <span class="label-text">${base}</span>`;
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
        // Compact-only: show a small separator '/' and the UV icon immediately next to the cloud icon
  labelsHTML[idx] = `${getRowIconHTML(key, titleMap[key])} <span class="label-text desktop-only">${parts[0]}<i class="wi wi-hot label-ico-inline" aria-hidden="true" style="margin:0 6px 0 4px"></i>UV${parts[1] || ''}</span>`;
      } else {
        labelsHTML[idx] = `${getRowIconHTML(key, titleMap[key])} <span class="label-text">${raw}</span>`;
      }
    }
  });

  // Ahora iterar por cada key (filas reducidas)
  keys.forEach((key, idx) => {
    const row = document.createElement("tr");
    // Mark metric rows so CSS can target them reliably across browsers
    row.classList.add('metrics-row');
    const th = document.createElement("th");
    
    th.innerHTML = labelsHTML[idx]; // no provider change in magnitude column
    row.appendChild(th);
    
    viewData.forEach((w, i) => {
      const td = document.createElement("td");
      
      // Special rendering for combined cloud + UV row
      if (key === "cloud_uv") {
        const cc = Number(w?.cloudCover ?? -1);
  const uvRaw = (w?.uvindex ?? w?.uv);
  const uv = (uvRaw == null || uvRaw === '') ? null : Math.max(0, Math.round(Number(uvRaw)));
    // Data cells: show only numeric values (no icons) per UI decision
    const cloudPart = (Number.isFinite(cc) && cc >= 0)
      ? `<span class="cloud-part"><span class="cloud-text">${Math.round(cc)}%</span></span>`
      : `<span class="cloud-part"><span class="cloud-text">-</span></span>`;
  const uvPart = (uv != null)
      ? `<span class="uv-part"><span class="uv-text">${uv}</span></span>`
      : `<span class="uv-part"><span class="uv-text">-</span></span>`;
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
    // Always attach listeners; decide per-element whether to show tooltip.
    const mm = window.matchMedia('(max-width: 700px)');

    function onMouseOver(ev) {
      const t = ev.target.closest('[data-tooltip]');
      if (!t) return;
      const isIcon = Boolean(t.closest && t.closest('.label-ico')) || (t.classList && t.classList.contains && t.classList.contains('label-ico'));
      const isCloudUv = Boolean(t.closest && (t.closest('.cloud-uv-cell') || (t.tagName === 'TD' && t.querySelector && t.querySelector('.cloud-uv-cell'))));
      const isLuminance = Boolean(t.closest && t.closest('.luminance-vert')) || (t.classList && t.classList.contains && t.classList.contains('luminance-vert'));
      // Show cloud-uv and luminance tooltips in all viewports; show icon tooltips only in compact mode
      if (isCloudUv || isLuminance || (isIcon && mm.matches)) {
        showTooltipAt(t, t.getAttribute('data-tooltip'));
      }
    }
    function onMouseOut(ev) {
      const related = ev.relatedTarget;
      if (related && related.closest && related.closest('#cw-tooltip')) return;
      hideTooltip();
    }
    function onTouchStart(ev) {
      const t = ev.target.closest('[data-tooltip]');
      if (!t) return;
      const isIcon = Boolean(t.closest && t.closest('.label-ico')) || (t.classList && t.classList.contains && t.classList.contains('label-ico'));
      const isCloudUv = Boolean(t.closest && (t.closest('.cloud-uv-cell') || (t.tagName === 'TD' && t.querySelector && t.querySelector('.cloud-uv-cell'))));
      const isLuminance = Boolean(t.closest && t.closest('.luminance-vert')) || (t.classList && t.classList.contains && t.classList.contains('luminance-vert'));
      if (!(isCloudUv || isLuminance || (isIcon && mm.matches))) return;
      if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      const touch = ev.touches && ev.touches[0];
      showTooltipAt(t, t.getAttribute('data-tooltip'), touch ? touch.clientX : undefined, touch ? touch.clientY : undefined);
      touchTimer = setTimeout(() => { hideTooltip(); touchTimer = null; }, 3000);
    }

    // Attach handlers once; handlers will decide whether to show tooltips based on element and viewport
    table.addEventListener('mouseover', onMouseOver);
    table.addEventListener('mouseout', onMouseOut);
    table.addEventListener('touchstart', onTouchStart, { passive: true });
    // hide tooltip when tapping elsewhere
    document.addEventListener('touchstart', (ev) => {
      const t = ev.target.closest('[data-tooltip]');
      // If tapping outside any tooltip-enabled element, hide
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
  // Optional debug: dump raw precipitation fields for the selected step
  try {
    if (window.METEORIDE_DEBUG_RAIN_INSPECT) {
      const step = window.weatherData && window.weatherData[originalIdx];
      if (step) {
        console.groupCollapsed(`[MeteoRide] Inspect step ${originalIdx} @ ${step.time}`);
        console.log('provider/apiSource:', step.provider || window.apiSource || 'unknown');
        console.log('precipitation (mm):', step.precipitation);
        console.log('precipProb (%):', step.precipProb, step.precipitation_probability, step.pop);
        console.log('weatherCode / owm id:', step.weatherCode, step.owmId, step.weather && step.weather[0]);
        console.log('raw step object:', step);
        console.groupEnd();
      }
    }
  } catch (e) {
    console.warn('[MeteoRide] debug inspect failed', e);
  }
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
  map = L.map("map", { 
    zoomSnap: 0, 
    zoomDelta: 0.2, 
    wheelPxPerZoomLevel: 100,
    attributionControl: true  // Ensure attribution control is enabled
  }).setView([41.3874, 2.1686], 14);

  const tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileOptions = {
    attribution: '<span class="map-provider">| © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</span>',
  };
  // In the app, tiles are kept as they are viewed so the map still has a background
  // after losing coverage. On the website nothing changes: the plain layer is used,
  // because the caching one reads tiles with fetch and that depends on the tile
  // server allowing cross-origin reads, which has not been verified in production.
  const tileLayer = (window.CW_NATIVE && window.cwCreateTileLayer
    && window.cwCreateTileLayer(tileUrl, tileOptions)) || L.tileLayer(tileUrl, tileOptions);
  tileLayer.addTo(map);
  // Exposed so the shell can tell a map with no background from one that simply
  // came out of the cache.
  window.cwTileLayer = tileLayer;

  // Move the built-in attribution control to the bottom-right
  if (map.attributionControl && typeof map.attributionControl.setPosition === 'function') {
    try {
      map.attributionControl.setPosition('bottomright');
    } catch (e) {
      // ignore if setPosition isn't supported in this Leaflet build
    }
  } else {
    // Fallback: create our own attribution control if the built-in one isn't available
    const attributionControl = L.control.attribution({
      position: 'bottomright'
    });
    attributionControl.addTo(map);
  }

  // Clean up only excessive separators, keep Leaflet's natural separator
  setTimeout(() => {
    try {
      const attrEl = document.querySelector('.leaflet-control-attribution');
      if (attrEl) {
        // Only clean up text nodes that have multiple separators or are after our app element
        const walker = document.createTreeWalker(
          attrEl,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        
        const textNodesToClean = [];
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent || '';
          // Only remove nodes that contain multiple pipes or excessive separators
          if (/\|\s*\|/.test(text) || /^\s*[|,]\s*$/.test(text)) {
            textNodesToClean.push(node);
          }
        }
        
        // Remove only the problematic separator text nodes
        textNodesToClean.forEach(textNode => {
          textNode.remove();
        });
      }
    } catch (e) {
      // Silently ignore any DOM manipulation errors
    }
  }, 100);

  // Simplified, robust attribution that works on all screen sizes
  setTimeout(() => {
    try {
      const mapContainer = document.querySelector('#map');
      if (!mapContainer) return;
      
      // Remove any existing attribution elements to start fresh
      const existingAttrs = mapContainer.querySelectorAll('.leaflet-control-attribution, #simple-attribution');
      existingAttrs.forEach(el => el.remove());
      
      // Create a simple, always-visible attribution element with structured HTML
      const attribution = document.createElement('div');
      attribution.id = 'simple-attribution';
      
      // Crear estructura HTML con clases específicas para el CSS
      attribution.innerHTML = `
        <span class="lockevod-credit">© <a href="https://github.com/lockevod" target="_blank" rel="noopener noreferrer">Lockevod</a></span><span class="separator"> | </span><span class="osm-credit">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</span>
      `;
      
      // Add to map container
      mapContainer.appendChild(attribution);
      
      console.log('Simple attribution created for screen width:', window.innerWidth);
      
      // Handle window resize if needed (CSS handles most of it now)
      const handleResize = () => {
        console.log('Window resized to:', window.innerWidth);
      };
      
      window.addEventListener('resize', handleResize);
      
    } catch (e) {
      console.error('Attribution setup error:', e);
    }
  }, 100);

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
  // Recenter control: a small button next to the compass to refit the route bounds
  (function addRecenterControl(){
    const RecenterControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function(map){
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-recenter');
        const btn = L.DomUtil.create('a', 'leaflet-control-recenter-button', container);
        btn.href = '#';
        try {
          btn.title = (typeof t === 'function') ? t('recenter_route') : 'Recentrar ruta';
        } catch (e) {
          btn.title = 'Recentrar ruta';
        }
  // Use an inline SVG for a nicer icon (target/reticle style). Keep color via currentColor.
  btn.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"></circle><path d="M12 6v-2M12 20v-2M6 12H4M20 12h-2"/></g></svg>';
  btn.className = 'leaflet-control-recenter-button icon-btn primary';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', btn.title);
        btn.tabIndex = 0;

        // Prevent map interactions when clicking this control
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const activate = () => {
          try { ensureTrackVisible(); } catch (e) { console.debug('Recenter failed:', e?.message); }
        };

        L.DomEvent.on(btn, 'click', L.DomEvent.stop)
                 .on(btn, 'click', L.DomEvent.preventDefault)
                 .on(btn, 'click', activate);

        // Keyboard support (Enter/Space)
        L.DomEvent.on(btn, 'keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            L.DomEvent.preventDefault(ev);
            activate();
          }
        });

        return container;
      }
    });
    try {
      // Add the control after default zoom control so it appears grouped with +/-
      const rc = new RecenterControl();
      map.addControl(rc);
      // If Leaflet zoom control exists, attempt to move the recenter button directly
      // into the zoom control container for tighter grouping (best-effort).
      try {
        const zoomContainer = document.querySelector('.leaflet-control-zoom');
        const recenterEl = document.querySelector('.leaflet-control-recenter');
        if (zoomContainer && recenterEl && zoomContainer.parentNode) {
          // Insert recenter element just after zoomContainer to keep stacking
          zoomContainer.parentNode.insertBefore(recenterEl, zoomContainer.nextSibling);
        }
      } catch (_) {}
    } catch (e) {
      console.debug('Could not add recenter control:', e?.message);
    }
  })();
  
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
  if (typeof window.initUI === 'function') {
    window.initUI();
  }
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
  // Defensive fallback: if some other script cleared the value, set it after a short delay
  // so the input always contains a sensible rounded default on page load.
  setTimeout(() => {
    try {
      const _dt = document.getElementById('datetimeRoute');
      if (_dt && (!_dt.value || String(_dt.value).trim() === '')) {
        _dt.value = roundToNextQuarterISO(new Date());
        try { logDebug && logDebug('datetimeRoute: fallback auto-set'); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
  }, 150);

  // Observe map container size changes and window resizes to keep track centered
  const mapEl = document.getElementById("map");
  if (mapEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleMapResizeRecenter());
    ro.observe(mapEl);
  }
  window.addEventListener("resize", scheduleMapResizeRecenter, { passive: true });
  window.addEventListener("orientationchange", scheduleMapResizeRecenter, { passive: true });

  logDebug(t("app_started"));
}

// --- Routes: read off the map, confirm, and the loader for routes from outside ---

// Reads a route without touching the screen: a KML is converted, the file sanitised and
// leaflet-gpx asked for a layer that is not drawn (it keeps its tracks, routes and markers
// in its own group). Resolves null when the file holds no line to follow.
// A route is a KML when its name ends in .kml or a <kml element starts within its first 4096
// characters. Keeping a route and opening it decide this the same way, or a route could be kept
// that then fails to open, and becomes the recent route the next start-up fails to restore.
const isKmlRoute = (text, name) => /\.kml$/i.test(name || "") || /<kml[\s>]/i.test(text.slice(0, 4096));

window.cwParseRoute = async function ({ text, name }) {
  if (typeof text !== "string") return null;
  let gpxText = text;
  let fileName = name || "route.gpx";
  if (isKmlRoute(text, fileName)) {
    const converted = window.cwKmlToGpxText ? window.cwKmlToGpxText(text) : null;
    // A KML with no Placemark still converts into a valid, empty GPX wrapper.
    if (converted && /<trkpt\b|<rtept\b|<wpt\b|<trk\b|<rte\b/i.test(converted)) gpxText = converted;
    fileName = fileName.replace(/\.kml$/i, ".gpx");
  }
  const source = (window.cwSanitizeGPXText ? window.cwSanitizeGPXText(gpxText) : gpxText).replace(/^[﻿\s]+/, "");
  // leaflet-gpx takes anything that does not start with "<" for a URL, and fetches it.
  if (!source.startsWith("<")) return null;

  const layer = await new Promise((resolve) => {
    let gpx;
    try {
      gpx = new L.GPX(source, {
        async: true,
        polyline_options: { color: "blue" },
        marker_options: {
          startIconUrl: "/icons/marker-icon-green.png",
          endIconUrl: "/icons/marker-icon-red.png",
          shadowUrl: "/icons/marker-shadow.png",
          wptIconUrl: null,
        },
      });
    } catch (e) {
      logDebug("Error creando L.GPX: " + e.message, true);
      return resolve(null);
    }
    gpx.on("loaded", () => resolve(gpx));
    gpx.on("error", (e) => {
      logDebug("Evento error al cargar GPX: " + ((e && e.err) || "unknown"), true);
      resolve(null);
    });
    // leaflet-gpx parses in a zero-delay timer it has just scheduled, so this one runs
    // after it: by then it has fired loaded or error, or it threw and never will.
    setTimeout(() => resolve(null), 0);
  });
  if (!layer) return null;

  const geojson = layer.toGeoJSON();
  if (!cwForecastRules.routeLine(geojson)) return null;
  return {
    layer, geojson, text, gpxText, name: fileName,
    displayName: (layer.get_name && layer.get_name()) || fileName.replace(/\.[^/.]+$/, ""),
    fingerprint: cwForecastRules.fingerprint(text),
  };
};

// Puts a parsed route on screen with no wait anywhere: it becomes the confirmed route, takes
// the name on screen and the file sharing sends, what belonged to the route before goes, and
// the whole layer is drawn and framed. Confirming and naming come first, so a drawing step
// that throws midway never leaves the old route confirmed, named or exported under the new
// layer. The coordinator launches its computation straight after.
window.cwCommitRoute = function (parsed, requestId) {
  const file = new File([parsed.gpxText], parsed.name, { type: "application/gpx+xml" });
  confirmedRoute = {
    requestId, name: parsed.name, fingerprint: parsed.fingerprint, geojson: parsed.geojson, text: parsed.text,
  };
  // The ride watch of another route is disarmed now, through its queue, with no wait here.
  try { window.cwDisarmWatchFor?.(parsed.fingerprint); } catch (_) { /* never stops a confirmation */ }
  window.lastGPXFile = file;
  const rutaEl = document.getElementById("rutaName");
  if (rutaEl) {
    rutaEl.textContent = parsed.displayName;
    rutaEl.style.color = "";
    rutaEl.style.fontStyle = "";
  }
  publishedSnapshot = null;
  weatherData = [];
  window.activeWeatherAlerts = [];
  const alertContainer = document.getElementById("weather-alerts-container");
  if (alertContainer) {
    alertContainer.style.display = "none";
    alertContainer.querySelectorAll(".weather-alert").forEach((el) => el.remove());
  }
  hideAndCleanupAlertIndicator();
  windMarkers.forEach((m) => map.removeLayer(m));
  windMarkers = [];
  rainMarkers.forEach((m) => map.removeLayer(m));
  rainMarkers = [];
  selectedOriginalIdx = null;
  viewOriginalIndexMap = [];
  colIndexByOriginal = {};
  lastAppliedSpeed = null;

  if (trackLayer) map.removeLayer(trackLayer);
  trackLayer = parsed.layer;
  trackLayer.addTo(map);
  window.replaceGPXMarkers(trackLayer);
  map.fitBounds(trackLayer.getBounds(), { padding: [20, 20], maxZoom: 15 });
  renderWeatherTable();
};

// Keeps a route from outside the page among the recent routes, as it arrived, when it holds
// one. Text with no sign of a track, a route or waypoints is not kept: a truncated share or a
// web page would become the newest recent route, and the one the next start-up tries, and
// fails, to restore. It decides like cwParseRoute: a KML is read through its conversion, but
// one with no Placemark still converts into an empty GPX, and then the text as it arrived is
// read instead (a real GPX named .kml). So either of the two holding a route is enough.
// Returns whether it was queued for import.
window.cwImportIfRoute = function (text, name) {
  const hasRoute = (s) => typeof s === "string" && /<trkpt\b|<rtept\b|<wpt\b|<trk\b|<rte\b/i.test(s);
  let importable = hasRoute(text);
  if (!importable && typeof text === "string" && isKmlRoute(text, name)) {
    try { importable = !!window.cwKmlToGpxText && hasRoute(window.cwKmlToGpxText(text)); } catch (_) { importable = false; }
  }
  if (importable) window.cw.importRoute({ text, name });
  return importable;
};

// A route handed over by other code, a postMessage by default (gpx-share.js receives it).
window.cwLoadGPXFromString = (gpxText, nameHint = "route.gpx", source = "message") =>
  window.cwReceiveRoute({ source, name: nameHint, text: gpxText });
// --- end routes ---

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
    computeRouteSummaryFromArray,
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
  if (typeof window.initUI === 'function') {
    window.initUI();
  }
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

  logDebug(t("app_started"));
});

// Global variable to store active weather alerts
window.activeWeatherAlerts = [];

// Test function for weather alerts (for development)
window.testWeatherAlerts = function() {
  const testAlerts = [
    {
      sender_name: "National Weather Service",
      event: "Severe Thunderstorm Warning", 
      start: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      end: Math.floor(Date.now() / 1000) + 7200,   // 2 hours from now
      description: "A severe thunderstorm warning has been issued. Heavy rain, strong winds up to 60 mph, and hail are possible. Avoid outdoor activities and seek shelter immediately.",
      tags: ["Thunderstorm", "Wind", "Hail"]
    },
    {
      sender_name: "Met Office",
      event: "Wind Advisory", 
      start: Math.floor(Date.now() / 1000) - 1800, // 30 minutes ago
      end: Math.floor(Date.now() / 1000) + 3600,   // 1 hour from now
      description: "Strong winds expected with gusts up to 45 mph. Be prepared for possible travel disruptions.",
      tags: ["Wind"]
    }
  ];
  
  const testPoint = { lat: 40.7128, lng: -74.0060 }; // New York coordinates
  const testTime = new Date();
  
  processWeatherAlerts(testAlerts, testPoint, testTime);
  
  console.log('Test weather alerts triggered. Total active alerts:', window.activeWeatherAlerts.length);
};

// Test function to show alert indicator directly (for debugging)
window.testAlertIndicator = function() {
  console.log('Testing alert indicator directly...');
  
  // Create a fake alert to force showing the indicator
  window.activeWeatherAlerts = [{
    id: 'test-alert-1',
    event: 'Test Weather Alert',
    description: 'This is a test alert for debugging',
    start: new Date(),
    end: new Date(Date.now() + 3600000),
    processed: false
  }];
  
  // Force show the indicator
  showAlertIndicator();
};

// Force create visible indicator (bypass all logic)
window.forceCreateIcon = function() {
  console.log('FORCE: Creating visible alert icon...');
  
  // Remove any existing indicator
  const existing = document.getElementById('weather-alert-indicator');
  if (existing) {
    existing.remove();
    console.log('FORCE: Removed existing indicator');
  }
  
  // Create new indicator
  const indicator = document.createElement('div');
  indicator.id = 'weather-alert-indicator';
  indicator.innerHTML = '⚠️';
  indicator.title = 'FORCED Weather Alert Icon';
  
  // Apply very explicit styles
  indicator.style.position = 'fixed';
  indicator.style.top = '100px';
  indicator.style.right = '100px';
  indicator.style.zIndex = '99999';
  indicator.style.background = '#ff0000';
  indicator.style.color = '#ffffff';
  indicator.style.width = '60px';
  indicator.style.height = '60px';
  indicator.style.borderRadius = '50%';
  indicator.style.display = 'flex';
  indicator.style.alignItems = 'center';
  indicator.style.justifyContent = 'center';
  indicator.style.fontSize = '24px';
  indicator.style.cursor = 'pointer';
  indicator.style.boxShadow = '0 0 20px rgba(255,0,0,0.5)';
  indicator.style.border = '3px solid #ffffff';
  
  document.body.appendChild(indicator);
  console.log('FORCE: Icon created and added to body');
  
  // Click handler
  indicator.addEventListener('click', () => {
    alert('Forced alert icon clicked!');
  });
  
  return indicator;
};

// Test positioning relative to route name
window.testRouteNamePosition = function() {
  console.log('Testing route name positioning...');
  
  // First, add some text to rutaName if it's empty
  const rutaName = document.getElementById('rutaName');
  if (rutaName) {
    if (!rutaName.textContent.trim()) {
      rutaName.textContent = 'Ruta de Prueba - Cycling Route';
      rutaName.style.padding = '10px';
      rutaName.style.backgroundColor = '#f0f0f0';
      rutaName.style.margin = '10px 0';
      rutaName.style.display = 'inline-block';
      console.log('Added test content to rutaName');
    }
    
    // Create fake alerts and show indicator
    window.activeWeatherAlerts = [{
      id: 'test-position',
      event: 'Test Alert for Positioning',
      description: 'Testing icon position next to route name',
      start: new Date(),
      end: new Date(Date.now() + 3600000),
      processed: false
    }];
    
    console.log('Created test alerts, calling showAlertIndicator...');
    showAlertIndicator();
    
    return rutaName;
  } else {
    console.log('rutaName element not found!');
    return null;
  }
};

// Debug function to check current state
window.debugAlertPosition = function() {
  const rutaName = document.getElementById('rutaName');
  const indicator = document.getElementById('weather-alert-indicator');
  
  console.log('=== DEBUG ALERT POSITION ===');
  console.log('rutaName element:', rutaName);
  console.log('rutaName content:', rutaName ? rutaName.textContent : 'null');
  console.log('rutaName parent:', rutaName ? rutaName.parentElement : 'null');
  console.log('indicator element:', indicator);
  console.log('indicator parent:', indicator ? indicator.parentElement : 'null');
  
  if (indicator) {
    console.log('indicator styles:', {
      position: indicator.style.position,
      top: indicator.style.top,
      left: indicator.style.left,
      right: indicator.style.right,
      marginLeft: indicator.style.marginLeft
    });
  }
  
  if (rutaName) {
    console.log('rutaName styles:', {
      display: rutaName.style.display,
      alignItems: rutaName.style.alignItems
    });
    console.log('rutaName contains indicator:', rutaName.contains(indicator));
  }
};

// Check for weather alerts independently of main provider
// Only a computation looks them up: the warnings found go into its `sink`, with the
// settings it read, and are shown only if it publishes. Nothing here touches the page.
async function checkWeatherAlertsIndependent(steps, timeSteps, sink, settings, isCurrent) {
  // Only check if alerts are enabled and we have OpenWeather API key
  if (!settings.alerts) return;

  const apiKeyOW = settings.keys.openweather;
  if (!apiKeyOW || apiKeyOW.trim().length < 5) return;
  
  console.log('Checking weather alerts independently...');
  
  try {
    // Sample points along the route for alert checking - 2/3 of intervals with minimum of 3
    const sampleIndices = [];
    const totalSteps = steps.length;
    const sampleCount = Math.max(3, Math.floor(totalSteps * 0.67));
    
    if (totalSteps <= sampleCount) {
      // For short routes, check all points
      for (let i = 0; i < totalSteps; i++) sampleIndices.push(i);
    } else {
      // For longer routes, distribute samples evenly across the route
      for (let i = 0; i < sampleCount; i++) {
        const index = Math.floor((i * (totalSteps - 1)) / (sampleCount - 1));
        sampleIndices.push(index);
      }
    }
    
    console.log(`Weather alerts sampling: ${sampleCount}/${totalSteps} points (~67%, indices: ${sampleIndices.join(', ')})`)
    
    for (const i of sampleIndices) {
      if (isCurrent && !isCurrent()) return;
      const p = steps[i];
      const timeAt = timeSteps[i];
      
      const tempUnit = settings.units.temp;
      const units = (String(tempUnit || "").toLowerCase().startsWith("f")) ? "imperial" : "metric";
      
      // Build OpenWeather URL specifically for alerts (exclude everything else to save bandwidth)
      const alertsUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${p.lat}&lon=${p.lon}&appid=${apiKeyOW}&units=${units}&exclude=minutely,current,hourly,daily`;
      
      const cacheKey = `alerts_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.getDate()}`;
      const cached = getCache(cacheKey);
      
      if (cached && cached.alerts) {
        sink.push(...cached.alerts);
        continue;
      }
      
      try {
        const response = await fetch(alertsUrl);
        if (isCurrent && !isCurrent()) return;
        if (response.ok) {
          const data = await response.json();
          if (isCurrent && !isCurrent()) return;
          if (data.alerts && Array.isArray(data.alerts)) {
            sink.push(...data.alerts);
            setCache(cacheKey, { alerts: data.alerts }, 3600); // Cache for 1 hour
          }
        }
      } catch (err) {
        console.warn('Failed to fetch weather alerts:', err.message);
      }
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) {
    console.warn('Error checking weather alerts:', err.message);
  }
}

// Process weather alerts from OpenWeather API
function processWeatherAlerts(alerts, routePoint, routeTime) {
  if (!alerts || !Array.isArray(alerts)) return;
  
  const currentTime = Date.now() / 1000; // Unix timestamp
  const routeTimeUnix = routeTime.getTime() / 1000;
  const oneHour = 3600; // 1 hour in seconds
  
  // Filter alerts that are active during the route time (±1 hour)
  const relevantAlerts = alerts.filter(alert => {
    const alertStart = alert.start || 0;
    const alertEnd = alert.end || Number.MAX_SAFE_INTEGER;
    const routeStartCheck = routeTimeUnix - oneHour;
    const routeEndCheck = routeTimeUnix + oneHour;
    
    // Alert is relevant if it overlaps with our route time window
    return (alertStart <= routeEndCheck && alertEnd >= routeStartCheck);
  });
  
  // Add new alerts to global list, avoiding duplicates
  relevantAlerts.forEach(alert => {
    const alertId = `${alert.sender_name}_${alert.event}_${alert.start}_${alert.end}`;
    const existingAlert = window.activeWeatherAlerts.find(a => a.id === alertId);
    
    if (!existingAlert) {
      window.activeWeatherAlerts.push({
        id: alertId,
        senderName: alert.sender_name,
        event: alert.event,
        start: alert.start,
        end: alert.end,
        description: alert.description,
        tags: alert.tags || [],
        routePoint: {
          lat: routePoint.lat,
          lng: routePoint.lng
        },
        routeTime: routeTimeUnix,
        processed: false
      });
      
      console.log('New weather alert detected:', alert.event, 'from', alert.sender_name);
    }
  });
  
  // Show alerts if there are unprocessed ones
  if (window.activeWeatherAlerts.some(a => !a.processed)) {
    showWeatherAlerts();
  }
  
  // Always show indicator if there are active alerts
  if (window.activeWeatherAlerts.length > 0) {
    showAlertIndicator();
  }
}

// Display weather alerts in a non-invasive way
function showWeatherAlerts() {
  // Check if container already exists and is visible
  const existingContainer = document.getElementById('weather-alerts-container');
  if (existingContainer && existingContainer.style.display !== 'none') {
    // Container is visible, hide it
    existingContainer.style.display = 'none';
    return;
  }
  
  const alertsToShow = window.activeWeatherAlerts.filter(a => !a.processed);
  
  // If called from indicator and no unprocessed alerts, show all active alerts
  if (alertsToShow.length === 0 && window.activeWeatherAlerts.length > 0) {
    resetAlertProcessedFlags();
    return showWeatherAlerts(); // Recursive call with reset flags
  }
  
  if (alertsToShow.length === 0) return;
  
  // Mark alerts as processed
  alertsToShow.forEach(alert => alert.processed = true);
  
  // Create alert notification or reuse existing one
  const alertsContainer = existingContainer || createAlertsContainer();
  
  // Clear existing alerts to prevent duplication
  if (existingContainer) {
    // Remove all existing alert elements
    const existingAlerts = alertsContainer.querySelectorAll('.weather-alert');
    existingAlerts.forEach(alert => alert.remove());
  }
  
  alertsToShow.forEach(alert => {
    const alertElement = createAlertElement(alert);
    alertsContainer.appendChild(alertElement);
    
    // Auto-hide after 15 seconds
    setTimeout(() => {
      if (alertElement.parentNode) {
        alertElement.remove();
      }
    }, 15000);
  });
  
  alertsContainer.style.display = 'block';
  
  // Show persistent alert indicator
  showAlertIndicator();
}

// Create the alerts container if it doesn't exist
function createAlertsContainer() {
  const container = document.createElement('div');
  container.id = 'weather-alerts-container';
  container.className = 'weather-alerts-container';
  
  // Add CSS styles
  container.style.cssText = `
    position: fixed;
    top: 70px;
    right: 20px;
    max-width: min(400px, 90vw);
    z-index: 1100;
    font-family: Arial, sans-serif;
    display: none;
    pointer-events: auto;
  `;
  
  // Add media query for mobile
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 480px) {
      #weather-alerts-container {
        top: 60px !important;
        right: 10px !important;
        left: 10px !important;
        max-width: none !important;
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(container);
  return container;
}

// Create individual alert element.
// Every string here comes from a weather provider relaying a national met service,
// so it is built with textContent: the alert text is data, never markup.
function createAlertElement(alert) {
  const alertDiv = document.createElement('div');
  alertDiv.className = 'weather-alert';

  // Determine alert severity class
  const severityClass = getSeverityClass(alert.event);
  const severityColor = getSeverityColor(severityClass);

  alertDiv.style.cssText = `
    position: relative;
    background: #fff;
    border-left: 4px solid ${severityColor};
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    margin-bottom: 10px;
    padding: 12px 16px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.4;
    max-height: 120px;
    overflow-y: auto;
  `;

  const line = (text, css) => {
    const el = document.createElement('div');
    el.style.cssText = css;
    el.textContent = text;
    alertDiv.appendChild(el);
  };

  const description = String(alert.description || '');
  const startDate = new Date(alert.start * 1000).toLocaleString();
  const endDate = new Date(alert.end * 1000).toLocaleString();

  line(`⚠️ ${alert.event || ''}`, `font-weight: bold; color: ${severityColor}; margin-bottom: 4px;`);
  line(String(alert.senderName || ''), 'font-size: 12px; color: #666; margin-bottom: 8px;');
  line(description.length > 200 ? description.substring(0, 200) + '...' : description, 'color: #333; margin-bottom: 6px;');
  line(`${startDate} - ${endDate}`, 'font-size: 11px; color: #888;');

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #999;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  close.addEventListener('click', () => alertDiv.remove());
  alertDiv.appendChild(close);

  return alertDiv;
}

// Determine severity class based on alert event
function getSeverityClass(event) {
  const eventLower = event.toLowerCase();
  
  if (eventLower.includes('warning') || eventLower.includes('severe')) {
    return 'severe';
  } else if (eventLower.includes('watch') || eventLower.includes('advisory')) {
    return 'moderate';
  } else {
    return 'minor';
  }
}

// Get color for severity level
function getSeverityColor(severityClass) {
  switch (severityClass) {
    case 'severe': return '#d32f2f';
    case 'moderate': return '#f57c00';
    case 'minor': return '#1976d2';
    default: return '#666';
  }
}

// Show persistent alert indicator
function showAlertIndicator() {
  console.log('showAlertIndicator called, active alerts:', window.activeWeatherAlerts.length);
  
  let indicator = document.getElementById('weather-alert-indicator');
  
  if (!indicator) {
    console.log('Creating new alert indicator');
    indicator = document.createElement('div');
    indicator.id = 'weather-alert-indicator';
    indicator.innerHTML = '⚠️';
    indicator.title = 'Weather alerts available - click to toggle';
    
    // Simple inline positioning: insert directly next to route name for all screen sizes
    const updatePosition = () => {
      const isSmallScreen = window.innerWidth < 701;
      console.log('Updating position, isSmallScreen:', isSmallScreen, 'window width:', window.innerWidth);
      
      // Use rutaName for positioning on all screen sizes (both small and large)
      const rutaName = document.getElementById('rutaName');
      console.log('Looking for rutaName element:', rutaName);
      
      if (rutaName) {
        // If rutaName exists but is empty, add placeholder content
        if (!rutaName.textContent.trim()) {
          rutaName.textContent = 'Cargando ruta...';
          rutaName.style.color = '#666';
          rutaName.style.fontStyle = 'italic';
          console.log('Added placeholder content to empty rutaName');
        }
        
        // Make rutaName a flex container if it isn't already
        if (!rutaName.style.display || rutaName.style.display === 'block') {
          rutaName.style.display = 'inline-flex';
          rutaName.style.alignItems = 'center';
          rutaName.style.gap = isSmallScreen ? '6px' : '8px';
        }
        
        // Set indicator for inline display
        indicator.style.position = 'static !important';
        indicator.style.top = 'auto !important';
        indicator.style.left = 'auto !important';
        indicator.style.right = 'auto !important';
        indicator.style.zIndex = '1 !important';
        indicator.style.margin = '0 !important';
        indicator.style.flexShrink = '0';
        
        // Adjust size based on screen size
        if (isSmallScreen) {
          indicator.style.width = '22px !important';
          indicator.style.height = '22px !important';
          indicator.style.fontSize = '11px !important';
        } else {
          indicator.style.width = '22px !important';
          indicator.style.height = '22px !important';
          indicator.style.fontSize = '11px !important';
        }
        
        // Move indicator inside rutaName if not already there
        if (indicator.parentNode !== rutaName) {
          rutaName.appendChild(indicator);
        }
        
        console.log('Positioned inline within rutaName element');
      } else {
        // Fallback to fixed position if rutaName not found
        if (indicator.parentNode !== document.body) {
          document.body.appendChild(indicator);
        }
        indicator.style.position = 'fixed !important';
        indicator.style.top = isSmallScreen ? '20px !important' : '100px !important';
        indicator.style.right = isSmallScreen ? '20px !important' : '50px !important';
        indicator.style.left = 'auto !important';
        indicator.style.zIndex = '9999 !important';
        
        // Adjust size for fallback position too
        if (isSmallScreen) {
          indicator.style.width = '22px !important';
          indicator.style.height = '22px !important';
          indicator.style.fontSize = '11px !important';
        } else {
          indicator.style.width = '22px !important';
          indicator.style.height = '22px !important';
          indicator.style.fontSize = '11px !important';
        }
        
        console.log('Fallback: rutaName not found, using fixed position');
      }
    };
    
    indicator.style.cssText = `
      background: #ff6b35 !important;
      color: white !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 11px !important;
      cursor: pointer !important;
      z-index: 9999 !important;
      box-shadow: 0 2px 8px rgba(255,0,0,0.2) !important;
      font-family: Arial, sans-serif !important;
      flex-shrink: 0 !important;
    `;
    
    // Add responsive styles
    if (!document.getElementById('alert-indicator-style')) {
      const style = document.createElement('style');
      style.id = 'alert-indicator-style';
      style.textContent = `
        @media (max-width: 700px) {
          #weather-alert-indicator {
            width: 20px !important;
            height: 20px !important;
            font-size: 10px !important;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Click handler to toggle alerts (store for later cleanup)
    indicator._clickHandler = function () {
      console.log('Alert indicator clicked');
      showWeatherAlerts();
    };
    indicator.addEventListener('click', indicator._clickHandler);
    
    // Update position on resize and scroll (store handler on element for cleanup)
    indicator._updatePosition = updatePosition;
    window.addEventListener('resize', indicator._updatePosition);
    window.addEventListener('scroll', indicator._updatePosition);
    
    // Initially add to body, updatePosition will move it if needed
    document.body.appendChild(indicator);
    console.log('Alert indicator initially added to body');
    
    // Update position immediately and on events
    updatePosition();
    setTimeout(updatePosition, 500); // Delayed update in case elements load later
  } else {
    console.log('Alert indicator already exists');
  }
  
  indicator.style.display = 'flex';
  console.log('Alert indicator display set to flex');
}

// Remove alert indicator and associated listeners/styles
function hideAndCleanupAlertIndicator() {
  try {
    const indicator = document.getElementById('weather-alert-indicator');
    if (!indicator) return;
    // Remove attached listeners if present
    if (indicator._updatePosition) {
      window.removeEventListener('resize', indicator._updatePosition);
      window.removeEventListener('scroll', indicator._updatePosition);
      delete indicator._updatePosition;
    }
    if (indicator._clickHandler) {
      indicator.removeEventListener('click', indicator._clickHandler);
      delete indicator._clickHandler;
    }
    // Remove from DOM
    if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
    // Hide alerts container too
    const container = document.getElementById('weather-alerts-container');
    if (container) container.style.display = 'none';
    console.log('Alert indicator and container cleaned up');
  } catch (e) {
    console.warn('hideAndCleanupAlertIndicator error', e);
  }
}

// Update processWeatherAlerts to reset processed flag when showing indicator
function resetAlertProcessedFlags() {
  window.activeWeatherAlerts.forEach(alert => {
    alert.processed = false;
  });
}
