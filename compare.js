(function () {
  // Re-render guard and simple dedupe key to avoid self-trigger loops
  let compareMO = null;
  let compareRendering = false;
  let lastCompareKey = "";

  // Guard on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("apiSource");
    if (!sel) return;

    // Run compare when selected or when table mutates after route load
    const runIfCompare = () => {
      if (sel.value === "compare" && !compareRendering) {
        // Force a fresh render even if key matches previous (user explicitly switched)
        lastCompareKey = "";
        // Slight delay to allow baseline render/markers
        setTimeout(runCompareMode, 0);
      }
    };
    sel.addEventListener("change", runIfCompare);

    // Also monitor table changes (GPX reloads/interval changes)
    const table = document.getElementById("weatherTable");
    if (table) {
      compareMO = new MutationObserver(() => runIfCompare());
      compareMO.observe(table, { childList: true, subtree: true });
    }

    // Add our own click handler (selection) with higher priority in compare mode
    const container = document.getElementById("weatherTableContainer");
    if (container) {
      container.addEventListener("click", (ev) => {
        if (sel.value !== "compare") return;
        const cell = ev.target.closest("[data-col]");
        if (!cell) return;
        const col = Number(cell.dataset.col);
        if (!Number.isFinite(col)) return;
        // Use exported helpers: highlight column and map marker (idx=col)
        if (window.cw) {
          window.cw.highlightColumn(col);
          window.cw.highlightMapStep(col, true);
        }
      });
    }

    // Check initial value and trigger if compare
    if (sel.value === "compare") {
      runIfCompare();
    }
  });

  function isReady() {
    return typeof window.cw === "object" &&
           document.getElementById("weatherTable") &&
           document.getElementById("apiSource");
  }

  // NEW: AROME‑HD coverage and validity helpers (coarse bbox + payload check)
  function isAromeHdCovered(lat, lon) {
    const inLat = lat >= 39.0 && lat <= 52.5;
    const inLon = lon >= -10.5 && lon <= 16.5;
    return inLat && inLon;
  }
  function aromeResponseLooksInvalid(j) {
    if (!j || !j.hourly) return true;
    const H = j.hourly;
    const t = H.time, temp = H.temperature_2m;
    if (!Array.isArray(t) || t.length === 0) return true;
    if (!Array.isArray(temp) || temp.length === 0) return true;
    return !temp.some(v => v != null && !Number.isNaN(Number(v)));
  }

  async function runCompareMode() {
    if (!isReady()) return;
    const apiSel = document.getElementById("apiSource");
    if (!apiSel || apiSel.value !== "compare") return;

    // Prevent re-entrancy and stop observer while we render
    compareRendering = true;
    try { compareMO && compareMO.disconnect(); } catch(_) {}

    // Mark body as compare-active (used for small-screen behavior)
    try { document.body.classList.add("compare-active"); } catch {}

    // Ensure no wind/rain markers are shown in compare mode
    if (window.cw?.clearMarkers) window.cw.clearMarkers();

    const steps = (window.cw.getSteps && window.cw.getSteps()) || [];
    if (!steps.length) { compareRendering = false; return; } // no baseline yet

    const units = (window.cw.getUnits && window.cw.getUnits()) || { temp: "C", wind: "kmh", precip: "mm", distance: "km" };
    const horizons = window.cw.horizons || {};
    const MS_PER_DAY = horizons.MS_PER_DAY || (24*60*60*1000);
    const MS_PER_HOUR = horizons.MS_PER_HOUR || (60*60*1000);
    const now = new Date();
    const dateStr = (function () {
      const dt = document.getElementById("datetimeRoute")?.value || "";
      return dt ? dt.substring(0, 10) : new Date().toISOString().substring(0, 10);
    })();

    const provs = getCompareProviders();
    const baseProvs = provs.filter(p => p !== 'ow2_arome_openmeteo'); // NEW: exclude chain from direct fetch
    // Simple key to avoid redundant work triggered by our own DOM changes
    const k0 = steps[0]?.time ? new Date(steps[0].time).toISOString() : "";
    const k1 = steps[steps.length - 1]?.time ? new Date(steps[steps.length - 1].time).toISOString() : "";
    const newKey = `${provs.join(",")}|${steps.length}|${k0}|${k1}|${units.temp}|${units.wind}|${units.precip}`;
    if (lastCompareKey === newKey) {
      // Reconnect observer and bail out
      try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
      compareRendering = false;
      return;
    }

    const compareData = {};
    const hasAny = {};
    for (const p of provs) compareData[p] = [];

    for (let i = 0; i < steps.length; i++) {
      const p = steps[i];
      const timeAt = new Date(p.time);
      const daysAhead = (timeAt - now) / MS_PER_DAY;
      const hoursAhead = (timeAt - now) / MS_PER_HOUR;

      for (const prov of baseProvs) { // CHANGED: use baseProvs
        // Respect horizons
        if ((prov === "meteoblue"   && daysAhead > (horizons.METEOBLUE_MAX_DAYS   || 7))  ||
            (prov === "openweather" && daysAhead > (horizons.OPENWEATHER_MAX_DAYS || 2))  ||
            (prov === "aromehd"     && hoursAhead > (horizons.AROMEHD_MAX_HOURS   || 48)) ||
            (daysAhead > (horizons.OPENMETEO_MAX_DAYS || 14))) {
          compareData[prov].push(blankStep(prov, p));
          continue;
        }

        // Decide effective provider (fallback to OM when AROME‑HD is outside domain/horizon)
        let effProv = prov;
        if (prov === "aromehd") {
          if (hoursAhead > (horizons.AROMEHD_MAX_HOURS || 48) || !isAromeHdCovered(p.lat, p.lon)) {
            effProv = "openmeteo";
          }
        }

        // Keys presence
        const apiKeyMB  = document.getElementById("apiKey")?.value || "";
        const apiKeyOWM = document.getElementById("apiKeyOW")?.value || "";
        const needsKey  = (effProv === "meteoblue" || effProv === "openweather");
        if (needsKey && ((effProv === "meteoblue" && apiKeyMB.trim().length < 5) || (effProv === "openweather" && apiKeyOWM.trim().length < 5))) {
          compareData[prov].push(blankStep(prov, p));
          continue;
        }

        // Cache key (use effective provider for data source)
        const key = `cw_weather_${effProv}_${dateStr}_${units.temp}_${units.wind}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${timeAt.toISOString()}`;
        const cached = window.cw.getCache && window.cw.getCache(key);
        if (cached) {
          const s = extractStepMetrics(effProv, cached, p, units.wind);
          // Keep row label as original provider while using effProv data
          s.provider = prov;
          compareData[prov].push(s);
          if (s && s.temp != null) hasAny[prov] = true;
          continue;
        }

        try {
          const apiKey = (effProv === "meteoblue") ? apiKeyMB : (effProv === "openweather") ? apiKeyOWM : "";
          const url = window.cw.buildProviderUrl(effProv, p, timeAt, apiKey, units.wind, units.temp);
          const res = await fetch(url);
          if (res.ok) {
            let json = await res.json();
            if (effProv === "aromehd") {
              // Backfill + validate coverage
              try {
                const urlStd = window.cw.buildProviderUrl("openmeteo", p, timeAt, "", units.wind, units.temp);
                const r2 = await fetch(urlStd);
                if (r2.ok) {
                  const std = await r2.json();
                  const stdH = std?.hourly || {};
                  const mergeKeys = ["precipitation_probability","weathercode","cloud_cover","uv_index","is_day"];
                  json.hourly = json.hourly || {};
                  mergeKeys.forEach(k => { if (Array.isArray(stdH[k])) json.hourly[k] = stdH[k]; });
                  if (!Array.isArray(json.hourly.time) && Array.isArray(stdH.time)) json.hourly.time = stdH.time;
                }
              } catch {}
              // If AROME payload invalid, refetch with Open‑Meteo
              if (aromeResponseLooksInvalid(json)) {
                const url2 = window.cw.buildProviderUrl("openmeteo", p, timeAt, "", units.wind, units.temp);
                const r3 = await fetch(url2);
                if (r3.ok) json = await r3.json();
                effProv = "openmeteo";
              }
            }
            window.cw.setCache && window.cw.setCache(key, json);
            const s = extractStepMetrics(effProv, json, p, units.wind);
            s.provider = prov; // keep row label
            compareData[prov].push(s);
            if (s && s.temp != null) hasAny[prov] = true;
          } else {
            compareData[prov].push(blankStep(prov, p));
          }
        } catch {
          compareData[prov].push(blankStep(prov, p));
        }
        await sleep(35);
      }
    }

    // NEW: local fallback resolver if app-level one missing
    function localChainResolve(chainId, ts, nowRef, loc) {
      if (chainId !== 'ow2_arome_openmeteo') return null;
      const diffH = (new Date(ts) - nowRef) / MS_PER_HOUR;
      if (diffH <= 2) return 'openweather';
      if (diffH <= 36 && isAromeHdCovered(loc.lat, loc.lon)) return 'aromehd';
      return 'openmeteo';
    }

    // NEW: Build chain row (ow2_arome_openmeteo) AFTER base providers fetched (always attempt if present in provs)
    const chainId = 'ow2_arome_openmeteo';
    if (provs.includes(chainId)) {
      const resolverExternal = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp || null;
      const resolver = resolverExternal || localChainResolve;
      const chainsExternal = (window.cw && window.cw.utils && window.cw.utils.providerChains) || {};
      const chainEnabled = chainsExternal[chainId] || chainId === 'ow2_arome_openmeteo';
      if (resolver && chainEnabled) {
        const arr = [];
        for (let i=0;i<steps.length;i++) {
          const base = steps[i];
          let effProv = resolver(chainId, base.time, now, { lat: base.lat, lon: base.lon }) || 'openmeteo';
          if (!compareData[effProv] || !compareData[effProv][i]) effProv = 'openmeteo';
          const src = (compareData[effProv] && compareData[effProv][i]) ? compareData[effProv][i] : null;
          if (src && src.temp != null) {
            const clone = { ...src, provider: chainId, _effProv: effProv };
            arr.push(clone);
            hasAny[chainId] = true;
          } else {
            arr.push(blankStep(chainId, base));
          }
        }
        compareData[chainId] = arr;
      }
    }

    // Filter providers without any usable data
    const order = ["openmeteo","aromehd","ow2_arome_openmeteo","meteoblue","openweather"];
    const filtered = {};
    order.forEach(k => { if (compareData[k] && (hasAny[k] || k === 'ow2_arome_openmeteo')) filtered[k] = compareData[k]; });

    // Baseline for summary (prefer OM). Markers are disabled in compare mode.
    const baseline = filtered.openmeteo || filtered.aromehd || filtered.meteoblue || filtered.openweather || [];
    if (window.cw.setWeatherData) window.cw.setWeatherData(baseline);

    // Build table
    renderCompareTable(filtered, baseline, units);

    // Compare mode: ensure no markers remain
    if (window.cw?.clearMarkers) window.cw.clearMarkers();

    // Store key and reconnect observer after rendering
    lastCompareKey = newKey;
    try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
    compareRendering = false;
  }

  function getCompareProviders() {
    const provs = ["openmeteo", "aromehd"];
    const hasMB  = ((document.getElementById("apiKey")?.value || "").trim().length >= 5);
    const hasOWM = ((document.getElementById("apiKeyOW")?.value || "").trim().length >= 5);
    if (hasMB)  provs.push("meteoblue");
    if (hasOWM) {
      provs.push("openweather");
      // NEW: include chain id when OpenWeather key present
      provs.push("ow2_arome_openmeteo");
    }
    return provs;
  }

  function blankStep(prov, base) {
    return {
      ...base,
      provider: prov,
      weather: null,
      temp: null, windSpeed: null, windDir: null, windGust: null,
      precipitation: null, precipProb: null, weatherCode: null,
      isDaylight: 1, luminance: null, uvindex: null, cloudCover: null
    };
  }

  function extractStepMetrics(prov, raw, baseStep, windUnit) {
    const step = { ...baseStep, provider: prov, weather: raw };
    const safeNum = window.cw.safeNum || ((v)=>Number.isFinite(Number(v))?Number(v):null);
    const windToUnits = window.cw.windToUnits || ((v)=>v);
    const findClosestIndex = window.cw.findClosestIndex || (()=>-1);
    try {
      if (!raw) return blankStep(prov, baseStep);

      if (prov === "openmeteo" || prov === "aromehd") {
        const H = raw.hourly || {};
        const idx = Array.isArray(H.time) ? findClosestIndex(H.time, step.time) : -1;
        if (idx >= 0) {
          step.temp = safeNum(H.temperature_2m?.[idx]);
          step.windSpeed = safeNum(windToUnits(H.wind_speed_10m?.[idx], windUnit));
          step.windDir = H.winddirection_10m?.[idx];
          step.windGust = safeNum(windToUnits(H.wind_gusts_10m?.[idx], windUnit));
          step.humidity = safeNum(H.relative_humidity_2m?.[idx]);
          step.precipitation = safeNum(H.precipitation?.[idx]);
          // Use precipitation probability when available (0..100)
          step.precipProb = safeNum(H.precipitation_probability?.[idx]);
          step.weatherCode = H.weathercode?.[idx];
          step.uvindex = safeNum(H.uv_index?.[idx]);
          step.isDaylight = H.is_day?.[idx];
          step.cloudCover = safeNum(H.cloud_cover?.[idx]);
        }
        // Derive category for models without robust weathercode (e.g., AROME‑HD)
        step._derivedCat = deriveCategoryFromParams(step);
      } else if (prov === "openweather") {
        const timeMs = (step.time instanceof Date ? step.time : new Date(step.time)).getTime();
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
        const useHourly = Array.isArray(raw.hourly) && raw.hourly.length > 0;
        const hi = useHourly ? closestByDt(raw.hourly) : -1;
        const di = (!useHourly || hi === -1) ? closestByDt(raw.daily) : -1;
        const src = (useHourly && hi !== -1) ? raw.hourly[hi] : ((Array.isArray(raw.daily) && di !== -1) ? raw.daily[di] : null);
        try {
          const pos = SunCalc.getPosition(new Date(timeMs), step.lat, step.lon);
          step.isDaylight = pos.altitude > 0 ? 1 : 0;
        } catch { step.isDaylight = 1; }
        const tempUnits = (document.getElementById("tempUnits")?.value || "C");
        const units = String(tempUnits).toLowerCase().startsWith("f") ? "imperial" : "metric";
        const toKmhFromOW = (ws) => {
          const v = Number(ws) || 0;
          if (units === "imperial") return v * 1.60934;
          return v * 3.6;
        };
        if (src) {
          step.temp = safeNum(useHourly ? src.temp : (src.temp?.day ?? src.temp?.max ?? src.temp?.min));
          step.windSpeed = safeNum(windToUnits(toKmhFromOW(src.wind_speed), windUnit));
          step.windDir = Number(src.wind_deg || 0);
          step.windGust = safeNum(src.wind_gust != null ? windToUnits(toKmhFromOW(src.wind_gust), windUnit) : null);
          step.humidity = safeNum(src.humidity);
          const rain = Number(useHourly ? (src.rain?.["1h"] ?? 0) : (src.rain ?? 0));
          const snow = Number(useHourly ? (src.snow?.["1h"] ?? 0) : (src.snow ?? 0));
          step.precipitation = safeNum(rain + snow);
          // OpenWeather 'pop' is 0..1 -> convert to percent
          if (useHourly && src && (src.pop != null)) {
            step.precipProb = safeNum(Number(src.pop) * 100);
          } else if (src && src.pop != null) {
            step.precipProb = safeNum(Number(src.pop) * 100);
          } else {
            step.precipProb = null;
          }
          step.weatherCode = Array.isArray(src.weather) && src.weather[0] ? src.weather[0].id : null;
          step.uvindex = safeNum(src.uvi ?? raw.current?.uvi ?? null);
          step.cloudCover = safeNum(src.clouds);
        }
      } else if (prov === "meteoblue") {
        step.temp = safeNum(raw.temperature_2m);
        step.windSpeed = safeNum(raw.wind_speed_10m);
        step.windDir = raw.wind_direction_10m || 0;
        step.windGust = safeNum(raw.wind_gust_10m);
        step.humidity = safeNum(raw.relative_humidity_2m);
        step.precipitation = safeNum(raw.precipitation);
        // MeteoBlue may provide precipitation_probability per timestep; attempt to pick closest
        try {
          const Ht = raw.time || raw.valid_time || null;
          const idx = Array.isArray(Ht) ? (window.cw.findClosestIndex ? window.cw.findClosestIndex(Ht, step.time) : -1) : -1;
          step.precipProb = idx >= 0 ? safeNum(raw.precipitation_probability?.[idx]) : null;
        } catch (_) { step.precipProb = null; }
        let pic = null;
        try {
          const Ht = raw.time || raw.valid_time || null;
          const idx = Array.isArray(Ht) ? (window.cw.findClosestIndex ? window.cw.findClosestIndex(Ht, step.time) : -1) : -1;
          pic = Array.isArray(raw.pictocode) && idx >= 0 ? raw.pictocode[idx] : null;
        } catch {}
        step.weatherCode = pic;
        step.uvindex = safeNum((raw.uvindex?.[0] ?? raw.uv_index?.[0]));
        step.isDaylight = raw.isdaylight ?? 1;
        step.cloudCover = safeNum(raw.total_cloud_cover?.[0] ?? raw.cloudcover?.[0]);
      }

      if (step.precipitation != null && Number(step.precipitation) === 0) step.precipProb = null;
      step.luminance = window.cw.computeLuminance ? window.cw.computeLuminance(step) : null;
      return step;
    } catch {
      return step;
    }
  }

  // Decide a category when weathercode is missing/misleading (AROME‑HD)
  function deriveCategoryFromParams(step) {
    const t = Number(step?.temp);
    const p = Number(step?.precipitation || 0);     // mm/h
    const cc = Number(step?.cloudCover);            // 0..100
    const day = step?.isDaylight === 1;
    const hasSnow = Number.isFinite(t) && t <= 0 && p > 0;
    // Strong buckets first
    if (hasSnow) {
      if (p >= 2.5) return "snow_heavy";
      if (p >= 0.5) return "snow";
      return "snow_light";
    }
    if (p > 0) {
      if (p >= 5) return "rain_heavy";
      if (p >= 0.7) return "rain";
      // light precip or showery
      return (cc >= 50) ? "showers" : "rain_light";
    }
    // No precip: decide on cloud cover
    if (Number.isFinite(cc)) {
      if (cc >= 90) return "overcast";
      if (cc >= 40) return "partlycloudy";
      return "clearsky";
    }
    return "default";
  }

  // Minimal mapper from category -> weather-icons class (day/night aware)
  function categoryToIconClass(cat, isDay) {
    const dn = isDay === 1 ? "day" : "night";
    const M = {
      clearsky:      { day: "wi-day-sunny",           night: "wi-night-clear" },
      partlycloudy:  { day: "wi-day-sunny-overcast",  night: "wi-night-alt-partly-cloudy" },
      overcast:      { day: "wi-day-cloudy",          night: "wi-night-alt-cloudy" },
      drizzle:       { day: "wi-sprinkle",            night: "wi-sprinkle" },
      rain_light:    { day: "wi-day-showers",         night: "wi-night-alt-showers" },
      rain:          { day: "wi-rain",                night: "wi-night-alt-rain" },
      rain_heavy:    { day: "wi-rain",                night: "wi-night-alt-rain" },
      showers:       { day: "wi-showers",             night: "wi-night-alt-showers" },
      freezing_drizzle:{day:"wi-sleet",               night: "wi-night-alt-sleet" },
      freezing_rain: { day: "wi-rain-mix",            night: "wi-night-alt-rain-mix" },
      sleet:         { day: "wi-sleet",               night: "wi-night-alt-sleet" },
      hail:          { day: "wi-day-hail",            night: "wi-night-alt-hail" },
      snow_light:    { day: "wi-day-snow",            night: "wi-night-alt-snow" },
      snow:          { day: "wi-day-snow",            night: "wi-night-alt-snow" },
      snow_heavy:    { day: "wi-snow-wind",           night: "wi-night-alt-snow" },
      snow_showers:  { day: "wi-day-snow",            night: "wi-night-alt-snow" },
      fog:           { day: "wi-day-fog",             night: "wi-night-fog" },
      thunderstorm:  { day: "wi-day-thunderstorm",    night: "wi-night-alt-thunderstorm" },
      thunder_hail:  { day: "wi-storm-showers",       night: "wi-night-alt-storm-showers" },
      default:       { day: "wi-na",                  night: "wi-na" }
    };
    return (M[cat] || M.default)[dn];
  }

  function buildCompareCell(step) {
    if (!step || step.temp == null) return "-";
    // Support chain: underlying effective provider stored in _effProv
    const prov = step.provider;
    const eff = step._effProv || prov;
    let iconClass = "";
    if (eff === "meteoblue") iconClass = (window.cw.icons?.mb ? window.cw.icons.mb(step.weatherCode, step.isDaylight) : "");
    else if (eff === "openweather") iconClass = (window.cw.icons?.ow ? window.cw.icons.ow(step.weatherCode, step.isDaylight) : "");
    else iconClass = (window.cw.icons?.om ? window.cw.icons.om(step.weatherCode, step.isDaylight) : "");

    const tempTxt = (step.temp != null && Number.isFinite(Number(step.temp))) ? `${Math.round(Number(step.temp))}º` : "-";
    const ws = (step.windSpeed != null) ? Number(step.windSpeed).toFixed(1) : "-";
    const wg = (step.windGust != null) ? Number(step.windGust).toFixed(1) : null;
    const windTxt = (wg != null) ? `${ws} (${wg})` : `${ws}`;
  const unit = (document.getElementById("precipUnits")?.value || "mm").toLowerCase();
  const pr = Number(step.precipitation ?? 0);
  const rainVal = unit === "in" ? pr * 0.0393701 : pr;
  const rainTxt = `${rainVal.toFixed(1)}`;
  const pp = (step.precipProb != null && Number.isFinite(Number(step.precipProb))) ? Math.round(Number(step.precipProb)) : null;
  // Show probability only when precipitation amount is > 0
  const rainWithProb = (pp != null && Number(pr) > 0) ? `${rainTxt} (${pp}%)` : rainTxt;
    return `
      <div style="display:flex;align-items:center;gap:6px;justify-content:center">
        <i class="wi ${iconClass}" style="font-size:22px;line-height:1;color:#29519b"></i>
        <div class="weather-combined" style="min-width:auto;align-items:flex-start">
          <span class="combined-top">${tempTxt}</span>
          <span class="combined-bottom">${windTxt}</span>
          <span class="combined-bottom">${rainWithProb}</span>
        </div>
      </div>`;
  }

  // Build full sun header (sunrise/sunset + civil dawn/dusk), independent of app.js behavior
  function buildSunHeaderFull(lat, lon, dateLike) {
    try {
      const baseDate =
        dateLike instanceof Date ? dateLike : (typeof dateLike === "string" ? new Date(dateLike) : new Date());
      const times = SunCalc.getTimes(baseDate, lat, lon);
      const fmt = (d) => (d instanceof Date && !isNaN(d)) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
      const sr = fmt(times.sunrise);
      const ss = fmt(times.sunset);
      const cd = fmt(times.dawn || times.civilDawn);
      const ck = fmt(times.dusk || times.civilDusk);
      return `
        <div class="sunHeaderBox">
          <div class="sunCol">
            <div class="sunRow"><i class="wi wi-sunrise"></i><span>${sr}</span></div>
            <div class="sunRow"><i class="wi wi-sunset"></i><span>${ss}</span></div>
          </div>
          <div class="sunCol">
            <div class="sunRow"><span class="civil-chip">c↑</span><span>${cd}</span></div>
            <div class="sunRow"><span class="civil-chip">c↓</span><span>${ck}</span></div>
          </div>
        </div>
      `;
    } catch (_) {
      return "";
    }
  }

  function renderCompareTable(compareData, baseline, units) {
    const table = document.getElementById("weatherTable");
    if (!table) return;
    table.innerHTML = "";
    table.classList.add("compare-mode");

    const thead = document.createElement("thead");

    // Header: first sticky combined cell + per-step time/dist cells
    const row = document.createElement("tr");
    const firstCell = document.createElement("th");
    firstCell.style.verticalAlign = "middle";
    firstCell.style.paddingRight = "8px";
    firstCell.style.textAlign = "left";

    const lat = baseline[0]?.lat ?? 0;
    const lon = baseline[0]?.lon ?? 0;
    const rawTime = baseline[0]?.time;
    const dateStr = (rawTime instanceof Date ? rawTime : new Date(rawTime || Date.now())).toISOString().substring(0,10);
    const summaryHTML = "";
    const sunHTML = buildSunHeaderFull(lat, lon, dateStr);
    firstCell.innerHTML = window.cw.summary && window.cw.summary.buildCombinedHeaderHTML
      ? window.cw.summary.buildCombinedHeaderHTML(summaryHTML, sunHTML)
      : (summaryHTML + sunHTML);
    row.appendChild(firstCell);

    (function upsertCompactSummarySunOnly() {
      try {
        const panel = document.getElementById("controlsPanel");
        const wrap = document.querySelector(".wtc-wrap");
        if (!panel || !wrap) return;
        const html = `<div class="combined-header"><div class="sun-wrap">${sunHTML}</div></div>`;
        let cs = document.getElementById("compactSummary");
        if (!cs) {
          cs = document.createElement("div");
          cs.id = "compactSummary";
            cs.className = "compact-summary";
          cs.innerHTML = html;
          panel.insertBefore(cs, wrap);
        } else {
          cs.innerHTML = html;
        }
      } catch (_) {}
    })();

    const formatTime = window.cw.formatTime || ((d)=>new Date(d).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
    const distanceUnit = (document.getElementById("distanceUnits")?.value || "km");
    const maxM = baseline.length ? Math.max(...baseline.map(w => Number(w.distanceM || 0))) : 0;

    for (let i = 0; i < baseline.length; i++) {
      const th = document.createElement("th");
      const m = baseline[i]?.distanceM;
      const unitKm = `<span class="unit-lower">${distanceUnit}</span>`;
      const unitM  = `<span class="unit-lower">${distanceUnit === "mi" ? "mi" : "m"}</span>`;
      let distText = "";
      if (Number.isFinite(m)) {
        const convertedM = distanceUnit === "mi" ? m * 0.000621371 : m;
        if (Math.round(m) === 0) distText = `0 ${unitKm}`; else if (i === baseline.length - 1) {
          distText = distanceUnit === "mi" ? `${convertedM.toFixed(1)} ${unitKm}` : `${(convertedM/1000).toFixed(1)} ${unitKm}`;
        } else if (convertedM < 1000) distText = `${convertedM.toFixed(1)} ${unitM}`; else distText = distanceUnit === "mi" ? `${convertedM.toFixed(1)} ${unitKm}` : `${(convertedM/1000).toFixed(1)} ${unitKm}`;
      }
      const startIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png";
      const endIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png";
      let iconHtml = "";
      if (Number.isFinite(m)) {
        if (Math.round(m) === 0) iconHtml = `<img src="${startIconUrl}" class="start-icon" alt="" />`; else if (Math.round(m) === Math.round(maxM)) iconHtml = `<img src="${endIconUrl}" class="end-icon" alt="" />`;
      }
      th.innerHTML = `
        <div class="cell-row${iconHtml ? '' : ' no-icon'}">
          ${iconHtml ? `<div class="icon-col">${iconHtml}</div>` : ''}
          <div class="time-dist-col">
            <div class="time-cell">${formatTime(baseline[i].time)}</div>
            <div class="m-cell"><span class="m-text">${distText}</span></div>
          </div>
        </div>`;
      th.dataset.col = String(i);
      th.dataset.ori = String(i);
      row.appendChild(th);
    }
    thead.appendChild(row);

    const tbody = document.createElement("tbody");
    // Compute provider display order: prefer a sensible default but try to avoid
    // showing similar providers (OpenWeather, OPW chain, AROME) consecutively.
    const defaultOrder = ["openmeteo","aromehd","ow2_arome_openmeteo","meteoblue","openweather"];
    let provOrder = defaultOrder.filter(p => compareData[p]).concat(Object.keys(compareData).filter(p => !defaultOrder.includes(p)));

    // Group similar providers to discourage adjacency
    const simGroup = new Set(["openweather","ow2_arome_openmeteo","aromehd"]);
    function groupOf(p) { return simGroup.has(p) ? 'sim' : 'other'; }

    // Greedy reorder to avoid same-group adjacency when possible
    (function tryInterleave() {
      const src = provOrder.slice();
      const out = [];
      let prevGroup = null;
      while (src.length) {
        let idx = src.findIndex(x => prevGroup == null || groupOf(x) !== prevGroup);
        if (idx === -1) idx = 0; // forced
        const pick = src.splice(idx, 1)[0];
        out.push(pick);
        prevGroup = groupOf(pick);
      }
      provOrder = out;
    })();

    provOrder.forEach((prov) => {
      const r = document.createElement("tr");
      const th = document.createElement("th");
      th.innerHTML = `<i class="wi wi-cloud label-ico" aria-hidden="true"></i> <span class="label-text">${labelForProvider(prov)}</span><span class="label-abbrev">${getProviderAbbrev(prov)}</span>`;
      th.classList.add("provider-cell");
      th.scope = "row";
      r.appendChild(th);
      const arr = compareData[prov] || [];
      for (let i = 0; i < baseline.length; i++) {
        const td = document.createElement("td");
        td.innerHTML = buildCompareCell(arr[i]);
        td.dataset.col = String(i);
        td.dataset.ori = String(i);
        r.appendChild(td);
      }
      tbody.appendChild(r);
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    (function ensureMinWidth() {
      const root = getComputedStyle(document.documentElement);
      const toPx = (v) => parseFloat(v) || 0;
      const firstCol = toPx(root.getPropertyValue('--cw-first-col'));
      const colMin  = toPx(root.getPropertyValue('--cw-col-min'));
      const cols = baseline.length;
      const minW = Math.max(600, Math.ceil(firstCol + Math.max(0, cols) * colMin));
      table.style.minWidth = `${minW}px`;
    })();
  }

  function labelForProvider(p) {
    if (p === "openmeteo") return "Open‑Meteo";
    if (p === "aromehd")   return "AROME‑HD";
    if (p === "ow2_arome_openmeteo") return "OPW→AROME"; // NEW chain label
    if (p === "meteoblue") return "MeteoBlue";
    if (p === "openweather") return "OpenWeather";
    return String(p || "");
  }

  function getProviderAbbrev(p) {
    if (p === "openmeteo") return "OMT";
    if (p === "aromehd")   return "ARM";
    if (p === "ow2_arome_openmeteo") return "OARM"; // NEW chain abbrev
    if (p === "meteoblue") return "MTB";
    if (p === "openweather") return "OWM";
    return String(p || "").substring(0, 3).toUpperCase();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Expose compare runner so app.js can trigger it when needed (first load, GPX load, etc.)
  try {
    window.cw = window.cw || {};
    window.cw.runCompareMode = runCompareMode;
  } catch (_) {}

})();
