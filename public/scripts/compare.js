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
    // NOTE: Do NOT auto-run when the table is in compare-dates-mode. That mode
    // relies on an explicit "run" button and should not auto-refresh on control
    // changes.
    const runIfCompare = () => {
      try {
        const tableEl = document.getElementById("weatherTable");
        // If user explicitly selected compare but the table is currently in
        // compare-dates-mode, don't auto-refresh (preserve explicit button behavior)
        if (tableEl && tableEl.classList.contains('compare-dates-mode')) return;
      } catch (_) {}
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
        // Allow clicks in both compare and compare-dates mode
        const table = document.getElementById("weatherTable");
        const isCompareDates = table && table.classList.contains('compare-dates-mode');
        const isCompareMode = table && table.classList.contains('compare-mode');
        if (!isCompareMode && !isCompareDates) return;

        // For compare modes, handle row selection instead of column selection
        // First check if we clicked on a row with data-row attribute
        let row = ev.target.closest("tr[data-row]");
        if (!row) {
          // If not found directly, check if we clicked in a cell that belongs to a row with data-row
          const cell = ev.target.closest("td, th");
          if (cell) {
            const parentRow = cell.closest("tr");
            if (parentRow && parentRow.dataset.row) {
              row = parentRow;
            }
          }
        }

        if (row) {
          const rawIndex = Number(row.dataset.row);
          if (!Number.isFinite(rawIndex)) return;

          // Determine which row should be selected in compare-dates mode.
          // Requirement: clicks map to the summary row:
          // 0 -> 1, 1 -> 1, 2 -> 3, 3 -> 3
          let targetIndex = rawIndex;
          if (isCompareDates) {
            // map even interval rows to the following summary row
            if (rawIndex % 2 === 0) targetIndex = rawIndex + 1;
            else targetIndex = rawIndex; // odd already a summary
          }

          // Resolve the actual row element to select (fallback to clicked row)
          const targetRow = table.querySelector(`tr[data-row="${targetIndex}"]`) || row;

          // Clear previous row selection
          table.querySelectorAll("tr.selected-row").forEach(r => r.classList.remove("selected-row"));

          // Select target row (summary for compare-dates)
          targetRow.classList.add("selected-row");

          // Show markers for the logical row on map
          if (window.cw && window.cw.showCompareRowMarkers) {
            window.cw.showCompareRowMarkers(targetIndex, isCompareDates);
          }
          return;
        }

        // Fallback to column selection for non-compare modes
        // If we are in any compare mode, do not perform column selection here.
        if (isCompareMode || isCompareDates) return;
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

    // Auto-refresh compare mode when controls change
    ['intervalSelect', 'tempUnits', 'windUnits', 'precipUnits', 'distanceUnits', 'apiKey', 'apiKeyOW', 'datetimeRoute'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const ev = (id === 'apiKey' || id === 'apiKeyOW') ? 'input' : 'change';
      el.addEventListener(ev, () => {
        const tableEl = document.getElementById('weatherTable');
        if (sel.value === 'compare' && tableEl?.classList.contains('compare-mode') && !compareRendering) {
          setTimeout(() => window.reloadFull?.(), 150);
        }
      });
    });
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

    // Ensure no wind/rain markers are shown in compare mode: always clear on entering/refresh
    if (window.cw?.clearMarkers) {
      try { window.cw.clearMarkers(); } catch(_) {}
      try { window.cw._compareMarkersCleared = true; } catch(_) {}
    }

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

    // Show loading overlay (use global overlay for consistency)
    try {
      if (window.cw && window.cw.ui && typeof window.cw.ui.showLoading === 'function') window.cw.ui.showLoading();
      else if (typeof window.showLoading === 'function') window.showLoading();
    } catch(_) {}

    try {
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
  const mk = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
  const key = mk(effProv, dateStr, units.temp, units.wind, p.lat, p.lon, timeAt);
  const cached = window.cw.getCache && window.cw.getCache(key);
        if (cached) {
          const s = extractStepMetrics(effProv, cached, p, units.wind);
          // Preserve which provider actually supplied the data (effective provider)
          // and keep the originally requested provider as _reqProv for row labeling.
          s._effProv = effProv;
          s._reqProv = prov;
          // Store actual provider in step.provider so consumers see the real data source
          s.provider = effProv;
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
                  try {
                    const aromeTimes = Array.isArray(json.hourly.time) ? json.hourly.time : null;
                    const stdTimes = Array.isArray(stdH.time) ? stdH.time : null;
                    let stdIndexByTime = null;
                    if (aromeTimes && stdTimes) {
                      stdIndexByTime = Object.create(null);
                      for (let si = 0; si < stdTimes.length; si++) stdIndexByTime[String(stdTimes[si])] = si;
                    }
                    mergeKeys.forEach(k => {
                      const aVal = json.hourly[k];
                      // Determine std value and accept common variants (uv_index vs uvindex vs uvi)
                      let sVal = stdH[k];
                      if (!Array.isArray(sVal)) {
                        if (k === 'uv_index') {
                          sVal = stdH['uv_index'] || stdH['uvindex'] || stdH['uvi'] || stdH['uv'] || null;
                          // If still not an array but we have a scalar current.uvi, broadcast it across hourly times
                          if (!Array.isArray(sVal) && Array.isArray(stdH.time) && std && typeof std.current === 'object' && (std.current.uvi != null)) {
                            try {
                              const v = Number(std.current.uvi);
                              if (!Number.isNaN(v)) sVal = Array(stdH.time.length).fill(v);
                            } catch (_) { /* ignore */ }
                          }
                        } else if (k === 'cloud_cover') {
                          sVal = stdH['cloud_cover'] || stdH['cloudcover'] || null;
                        } else if (k === 'precipitation_probability') {
                          sVal = stdH['precipitation_probability'] || stdH['pop'] || null;
                        }
                      }
                      if (!Array.isArray(aVal) && Array.isArray(sVal)) {
                        json.hourly[k] = sVal.slice();
                      } else if (Array.isArray(aVal) && Array.isArray(sVal)) {
                        const merged = aVal.slice();
                        if (stdIndexByTime) {
                          for (let i = 0; i < aromeTimes.length; i++) {
                            if (merged[i] == null) {
                              const t = String(aromeTimes[i]);
                              const si = stdIndexByTime[t];
                              if (si != null && sVal[si] != null) merged[i] = sVal[si];
                            }
                          }
                        } else {
                          for (let mi = 0; mi < sVal.length; mi++) {
                            if (merged[mi] == null && sVal[mi] != null) merged[mi] = sVal[mi];
                          }
                        }
                        json.hourly[k] = merged;
                      }
                    });
                    // Debug: log uv_index merge activity when debugging enabled
                    try {
                      if (window.cw && window.cw.DEBUG_MERGE) {
                        const beforeKeys = Object.keys(stdH || {});
                        console.debug('[merge][compare] aromeTimes=', Array.isArray(aromeTimes) ? aromeTimes.length : null, 'stdTimes=', Array.isArray(stdTimes) ? stdTimes.length : null, 'stdKeys=', beforeKeys);
                        if (Array.isArray(json.hourly.uv_index)) console.debug('[merge][compare] json.hourly.uv_index sample=', json.hourly.uv_index.slice(0,5));
                        else console.debug('[merge][compare] json.hourly.uv_index missing after merge');
                      }
                    } catch(_) {}
                    // Special handling: ensure precipitation_probability is normalized
                    try {
                      if (!Array.isArray(json.hourly.precipitation_probability)) {
                        const candNames = ['precipitation_probability','precipitationProbability','precip_prob','pop','probability_of_precipitation'];
                        for (const n of candNames) {
                          if (Array.isArray(stdH[n])) {
                            // Normalize: if values are 0..1 assume fraction and convert to percent
                            const arr = stdH[n].slice();
                            const nums = arr.filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
                            const max = nums.length ? Math.max(...nums) : null;
                            const normalized = (max != null && max <= 1) ? arr.map(v => v == null ? null : Number(v) * 100) : arr;
                            json.hourly.precipitation_probability = normalized;
                            break;
                          }
                        }
                      }
                    } catch (_) {}
                    if (!Array.isArray(json.hourly.time) && Array.isArray(stdH.time)) json.hourly.time = stdH.time;
                    if ((!json.minutely_15 || Object.keys(json.minutely_15 || {}).length === 0) && std && std.minutely_15 && typeof std.minutely_15 === 'object') {
                      json.minutely_15 = std.minutely_15;
                    }
                  } catch (mergeErr) {
                    mergeKeys.forEach(k => { if (Array.isArray(stdH[k])) json.hourly[k] = stdH[k]; });
                    if (!Array.isArray(json.hourly.time) && Array.isArray(stdH.time)) json.hourly.time = stdH.time;
                  }
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
            // Preserve effective provider and original requested provider separately.
            s._effProv = effProv;
            s._reqProv = prov;
            // Store actual provider in step.provider so consumers (markers, summaries)
            // operate on the real data source rather than the logical row label.
            s.provider = effProv;
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
            // src already uses provider=effProv; clone but mark requested provider as chainId
            const clone = { ...src, provider: src._effProv || src.provider, _reqProv: chainId, _effProv: effProv };
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
    const order = ["aromehd","openweather","openmeteo","ow2_arome_openmeteo","meteoblue"];
    const filtered = {};
    order.forEach(k => { if (compareData[k] && (hasAny[k] || k === 'ow2_arome_openmeteo')) filtered[k] = compareData[k]; });

    // Baseline for summary (prefer OM). Markers are disabled in compare mode.
    const baseline = filtered.openmeteo || filtered.aromehd || filtered.meteoblue || filtered.openweather || [];
    if (window.cw.setWeatherData) window.cw.setWeatherData(baseline);

    // Store provider data for row selection
    window.cw.compareProviderData = filtered;

    // Build table
    renderCompareTable(filtered, baseline, units);

    // Compare mode: ensure no markers remain (only once)
    if (window.cw?.clearMarkers && !window.cw._compareMarkersCleared) {
      window.cw.clearMarkers();
      try { window.cw._compareMarkersCleared = true; } catch(_) {}
    }

    // Hide global loading overlay
    try {
      if (window.cw && window.cw.ui && typeof window.cw.ui.hideLoading === 'function') window.cw.ui.hideLoading();
      else if (typeof window.hideLoading === 'function') window.hideLoading();
    } catch(_) {}

    // Store key and reconnect observer after rendering
    lastCompareKey = newKey;
    try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
    compareRendering = false;
    } finally {
      // Ensure global loading is hidden even if there's an error
      try {
        if (window.cw && window.cw.ui && typeof window.cw.ui.hideLoading === 'function') window.cw.ui.hideLoading();
        else if (typeof window.hideLoading === 'function') window.hideLoading();
      } catch(_) {}
    }
  }

  async function runCompareDatesMode() {
    if (!isReady()) return;

    // Validate that a route is loaded before proceeding
    const routeValidation = window.validateRouteLoaded();
    if (!routeValidation.valid) {
      if (window.setNotice) window.setNotice(routeValidation.error, 'error');
      return;
    }

    // Prevent re-entrancy
    if (compareRendering) return;
    compareRendering = true;
    try { compareMO && compareMO.disconnect(); } catch(_) {}

    // Clear any existing markers since we can't show two dates at once (only once per session)
    if (window.cw?.clearMarkers && !window.cw._compareMarkersCleared) {
      window.cw.clearMarkers();
      try { window.cw._compareMarkersCleared = true; } catch(_) {}
    }

    // Helper: parse "YYYY-MM-DDTHH:mm" (or with space) as local time reliably
    function parseLocalDateTime(val) {
      try {
        if (!val || typeof val !== 'string') return null;
        // Accept both "YYYY-MM-DDTHH:mm" and "YYYY-MM-DD HH:mm"
        const m = val.trim().replace(' ', 'T').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!m) return null;
        const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]), hh = Number(m[4]), mm = Number(m[5]);
        const dt = new Date(y, mo, d, hh, mm, 0, 0); // local tz
        return isNaN(dt.getTime()) ? null : dt;
      } catch (_) { return null; }
    }

    const steps = (window.cw.getSteps && window.cw.getSteps()) || [];
    if (!steps.length) { compareRendering = false; return; }

    const units = (window.cw.getUnits && window.cw.getUnits()) || { temp: "C", wind: "kmh", precip: "mm", distance: "km" };
  // Use the currently selected provider in the main select; coerce invalid 'compare' to openmeteo
  let provider = (document.getElementById('apiSource')?.value) || 'openmeteo';
  if (provider === 'compare') provider = 'openmeteo';

  // Read both datetimes (full YYYY-MM-DDTHH:mm) and parse locally
  const dtA = document.getElementById("datetimeRoute")?.value || "";
  const dtB = document.getElementById("datetimeRoute2")?.value || "";

  // Validate date ranges for both dates
  const validationA = validateDateRange(dtA, 'fecha A');
  const validationB = validateDateRange(dtB, 'fecha B');

  if (!validationA.valid) {
    const table = document.getElementById("weatherTable");
    if (table) {
      table.innerHTML = `<tbody><tr><td><span style="color: red;">${validationA.error}</span></td></tr></tbody>`;
    }
    try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
    compareRendering = false;
    return;
  }

  if (!validationB.valid) {
    const table = document.getElementById("weatherTable");
    if (table) {
      table.innerHTML = `<tbody><tr><td><span style="color: red;">${validationB.error}</span></td></tr></tbody>`;
    }
    try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
    compareRendering = false;
    return;
  }

  const baseA = parseLocalDateTime(dtA);
  const baseB = parseLocalDateTime(dtB);
  if (!baseA || !baseB) {
      // nothing to do yet; render notice
      const table = document.getElementById("weatherTable");
      if (table) {
        const msg = (window.t ? window.t('choose_compare_both_dates') : 'Please pick both dates to compare.');
        table.innerHTML = `<tbody><tr><td><span data-i18n="choose_compare_both_dates">${msg}</span></td></tr></tbody>`;
      }
      try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
      compareRendering = false;
      return;
    }

    // Build per-step offsets from the first step without using "now" as fallback.
    // Prefer actual step times; if missing, derive from configured interval minutes.
    const t0 = (() => {
      const s0 = steps[0];
      if (!s0) return null;
      const d = (s0.time instanceof Date) ? s0.time : new Date(s0.time);
      return isNaN(d) ? null : d;
    })();
    const intervalMin = Number((window.getVal && window.getVal('intervalSelect')) || 15) || 15;
    const intervalMs = intervalMin * 60000;
    const offsets = steps.map((s, i) => {
      const d = (s.time instanceof Date) ? s.time : new Date(s.time);
      if (t0 && d && !isNaN(d)) return d.getTime() - t0.getTime();
      return i * intervalMs;
    });

    // Prepare provider resolver (uses utils when available)
    const resolverExternal = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp || null;
    const resolveEff = (provId, ts, coords) => {
      try {
        const nowRef = new Date();
        if (resolverExternal) return resolverExternal(provId, ts, nowRef, coords) || 'openmeteo';
        // Minimal local policy: respect basic AROME limits and use OpenMeteo otherwise
        const pid = String(provId || '').toLowerCase();
        if (pid === 'aromehd') {
          // basic 48h horizon + bbox
          const h = (new Date(ts) - new Date()) / (1000*60*60);
          const covered = (coords && coords.lat != null && coords.lon != null && coords.lat >= 39 && coords.lat <= 52.5 && coords.lon >= -10.5 && coords.lon <= 16.5);
          if (h <= 48 && covered) return 'aromehd';
          return 'openmeteo';
        }
        if (pid === 'openweather') {
          // OneCall hourly ~48h; beyond that we prefer OpenMeteo
          const h = (new Date(ts) - new Date()) / (1000*60*60);
          return (h <= 48) ? 'openweather' : 'openmeteo';
        }
        if (pid === 'meteoblue') {
          const hasMB = ((document.getElementById('apiKey')?.value || '').trim().length >= 5);
          return hasMB ? 'meteoblue' : 'openmeteo';
        }
        return 'openmeteo';
      } catch (_) { return 'openmeteo'; }
    };

    // For each base datetime, build an array of step-metrics by fetching with timeAt = base + offset
    async function fetchDataForBase(baseDate) {
      const arr = [];
      for (let i = 0; i < steps.length; i++) {
        const p = steps[i];
        const offMs = offsets[i] || 0;
        const timeAt = new Date(baseDate.getTime() + offMs);
        // Base step copy with aligned time for indexing and display
        const baseForIndex = { ...p, time: timeAt };
        // Decide effective provider for this timestamp/location
        let effProv = resolveEff(provider, timeAt, { lat: p.lat, lon: p.lon }) || provider;
        // Ensure keys exist when required; fallback to OpenMeteo if missing
        if (effProv === 'meteoblue' && !(document.getElementById('apiKey')?.value || '').trim()) effProv = 'openmeteo';
        if (effProv === 'openweather' && !(document.getElementById('apiKeyOW')?.value || '').trim()) effProv = 'openmeteo';
        // Build cache key and try cache
        // Include provider, units, coords and exact timeAt in key (date uniqueness comes from timeAt)
  const mk2 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
  const dateStr2 = (function () { const dt = document.getElementById('datetimeRoute')?.value || ''; return dt ? dt.substring(0,10) : new Date().toISOString().substring(0,10); })();
  const key = mk2(effProv, dateStr2, units.temp, units.wind, p.lat, p.lon, timeAt);
  const cached = window.cw.getCache && window.cw.getCache(key);
        if (cached) {
          const s = extractStepMetrics(effProv, cached, baseForIndex, units.wind);
          s.provider = effProv;
          arr.push(s);
          continue;
        }
        try {
          const apiKeyMB  = document.getElementById("apiKey")?.value || "";
          const apiKeyOWM = document.getElementById("apiKeyOW")?.value || "";
          const apiKey = (effProv === 'meteoblue') ? apiKeyMB : (effProv === 'openweather' ? apiKeyOWM : '');
          const url = window.cw.buildProviderUrl(effProv, p, timeAt, apiKey, units.wind, units.temp);
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json();
            window.cw.setCache && window.cw.setCache(key, json);
            const s = extractStepMetrics(effProv, json, baseForIndex, units.wind);
            s.provider = effProv;
            arr.push(s);
          } else {
            arr.push(blankStep(effProv, baseForIndex));
          }
        } catch (e) {
          arr.push(blankStep(effProv, baseForIndex));
        }
        await sleep(30);
      }
      return arr;
    }

    try {
      // Show global loading overlay for consistency
      try {
        if (window.cw && window.cw.ui && typeof window.cw.ui.showLoading === 'function') window.cw.ui.showLoading();
        else if (typeof window.showLoading === 'function') window.showLoading();
      } catch(_) {}

      const dataA = await fetchDataForBase(baseA);
      const dataB = await fetchDataForBase(baseB);

      // Hide global loading overlay
      try {
        if (window.cw && window.cw.ui && typeof window.cw.ui.hideLoading === 'function') window.cw.ui.hideLoading();
        else if (typeof window.hideLoading === 'function') window.hideLoading();
      } catch(_) {}

      // Render combined table: header (times) then block A (label row + data rows), block B
      const labelA = formatDateOnly(baseA);
      const labelB = formatDateOnly(baseB);
      renderDateCompareTable(labelA, dataA, labelB, dataB, units);

      // Store data for row selection
      window.cw.weatherDataA = dataA;
      window.cw.weatherDataB = dataB;

      lastCompareKey = `${provider}|${steps.length}|${baseA.toISOString()}|${baseB.toISOString()}`;
    } finally {
      // Ensure global loading is hidden even if there's an error
      try {
        if (window.cw && window.cw.ui && typeof window.cw.ui.hideLoading === 'function') window.cw.ui.hideLoading();
        else if (typeof window.hideLoading === 'function') window.hideLoading();
      } catch(_) {}

      try { compareMO && compareMO.observe(document.getElementById("weatherTable"), { childList: true, subtree: true }); } catch(_) {}
      compareRendering = false;
    }
  }

  // Expose date-compare runner so UI button can call it
  try { window.cw = window.cw || {}; window.cw.runCompareDatesMode = runCompareDatesMode; } catch(_) {}

  function renderDateCompareTable(dateA, dataA, dateB, dataB, units) {
    const table = document.getElementById("weatherTable");
    if (!table) return;
    table.innerHTML = "";
    table.classList.remove('compare-mode');
    table.classList.add('compare-dates-mode');
    
    // Also add class to main element for viewport height adjustments on small screens
    const main = document.querySelector('main');
    if (main) {
      main.classList.remove('compare-mode');
      main.classList.add('compare-dates-mode');
    }

    // In compare-dates mode, remove any previously injected compact summary bar
    // to avoid duplicating info above the table and mixing contexts.
    try {
      const cs = document.getElementById('compactSummary');
      if (cs && cs.parentElement) cs.parentElement.removeChild(cs);
    } catch {}

    const formatTime = window.cw.formatTime || ((d)=>new Date(d).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    const rawMaxCols = Math.max((dataA && dataA.length) || 0, (dataB && dataB.length) || 0);
    // Show ALL columns in compare-dates mode, just like normal mode - no artificial limits
    const maxCols = rawMaxCols;
    const distanceUnit = (document.getElementById("distanceUnits")?.value || (units && units.distance) || "km");
    const toDisplayDist = (m) => {
      if (!Number.isFinite(m)) return "";
      // m is meters in data; convert to km or mi
      if (distanceUnit === 'mi') {
        const miles = m * 0.000621371;
        return miles >= 1 ? `${miles.toFixed(1)} <span class="unit-lower">mi</span>` : `${miles.toFixed(2)} <span class="unit-lower">mi</span>`;
      } else {
        // km
        return m >= 1000 ? `${(m/1000).toFixed(1)} <span class="unit-lower">km</span>` : `${m.toFixed(0)} <span class="unit-lower">m</span>`;
      }
    };
    const startIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png";
    const endIconUrl = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png";

  const tbody = document.createElement('tbody');
  // Build compact summary (route summary + sun) HTML for each base date using first available step
    const latA = (dataA && dataA[0] && dataA[0].lat) != null ? dataA[0].lat : ((window.cw.getSteps && window.cw.getSteps()[0]?.lat) || 0);
    const lonA = (dataA && dataA[0] && dataA[0].lon) != null ? dataA[0].lon : ((window.cw.getSteps && window.cw.getSteps()[0]?.lon) || 0);
    const dateLikeA = (dataA && dataA[0] && dataA[0].time) || null;
    const sunA = buildSunHeaderFull(latA, lonA, dateLikeA);
    const latB = (dataB && dataB[0] && dataB[0].lat) != null ? dataB[0].lat : ((window.cw.getSteps && window.cw.getSteps()[0]?.lat) || 0);
    const lonB = (dataB && dataB[0] && dataB[0].lon) != null ? dataB[0].lon : ((window.cw.getSteps && window.cw.getSteps()[0]?.lon) || 0);
    const dateLikeB = (dataB && dataB[0] && dataB[0].time) || null;
  const sunB = buildSunHeaderFull(latB, lonB, dateLikeB);
  // Local summary from provided arrays (do not mutate global state)
    function computeRouteSummaryFrom(arr) {
      // Delegate to shared implementation when available to ensure consistency
      if (window.cw && window.cw.summary && typeof window.cw.summary.computeRouteSummaryFromArray === 'function') {
        return window.cw.summary.computeRouteSummaryFromArray(arr);
      }
      // Fallback to previous local behavior (shouldn't normally be used)
      return null;
    }
    const tempUnit = (document.getElementById("tempUnits")?.value || "C").toString();
    const windUnit = (document.getElementById("windUnits")?.value || "kmh").toString();
    const precipUnit = (document.getElementById("precipUnits")?.value || "mm").toString().toLowerCase();
    const degSymbol = "º";
    const tempUnitLabel = tempUnit.toLowerCase().startsWith("f") ? `${degSymbol}F` : `${degSymbol}C`;
    const windUnitLabel = windUnit === "ms" ? "m/s" : (windUnit.toLowerCase().startsWith("mph") ? "mph" : "km/h");
    const precipUnitLabel = precipUnit;
    const sumA = computeRouteSummaryFrom(dataA || []);
    const sumB = computeRouteSummaryFrom(dataB || []);
    // Build a compact numeric-only summary (no labels) for compare-dates mode
    function buildNumericSummaryHTML(summary, tUnit, wUnit, pUnit) {
      if (!summary) return "";
      let tempPart = "";
      if (summary.tempMin != null && summary.tempMax != null) tempPart = `${Math.round(summary.tempMin)}-${Math.round(summary.tempMax)}${tUnit}`;
      else if (summary.tempAvg != null) tempPart = `${Math.round(summary.tempAvg)}${tUnit}`;
      let windPart = "";
      if (summary.windMin != null && summary.windMax != null) windPart = `${Math.round(summary.windMin)}-${Math.round(summary.windMax)}${wUnit}`;
      else if (summary.windAvg != null) windPart = `${Math.round(summary.windAvg)}${wUnit}`;
      if (summary.gustMax != null) windPart += ` <span class="rs-paren">(${Math.round(summary.gustMax)})</span>`;
      let precipPart = "";
      if (summary.precipMin != null && summary.precipMax != null) {
        const precipMinVal = Number(summary.precipMin);
        const precipMaxVal = Number(summary.precipMax);
        if (precipMinVal < 0.5 && precipMaxVal < 0.5) precipPart = `0${pUnit}`;
        else {
          const minDisp = Math.round(precipMinVal);
          const maxDisp = Math.round(precipMaxVal);
          precipPart = (minDisp === maxDisp) ? `${minDisp}${pUnit}` : `${minDisp}-${maxDisp}${pUnit}`;
        }
      } else if (summary.precipMax != null) {
        precipPart = `${Math.round(Number(summary.precipMax))}${pUnit}`;
      }
      if (summary.probMax != null) precipPart += ` <span class="rs-paren">(${Math.round(summary.probMax)}%)</span>`;

      // Build inline HTML without labels
      const parts = [];
      if (tempPart) parts.push(`<span class="combined-top">${tempPart}</span>`);
      if (windPart) parts.push(`<span class="combined-bottom">${windPart}</span>`);
      if (precipPart) parts.push(`<span class="combined-bottom">${precipPart}</span>`);
      if (!parts.length) return "";
      return `<div style="display:flex;flex-direction:column;align-items:flex-start">${parts.join('')}</div>`;
    }

    const summaryHTML_A = buildNumericSummaryHTML(sumA, tempUnitLabel, windUnitLabel, precipUnitLabel);
    const summaryHTML_B = buildNumericSummaryHTML(sumB, tempUnitLabel, windUnitLabel, precipUnitLabel);
    const combinedHeader = (summaryHTML, sunHTML) => {
      return (window.cw.summary && window.cw.summary.buildCombinedHeaderHTML)
        ? window.cw.summary.buildCombinedHeaderHTML(summaryHTML, sunHTML)
        : ((summaryHTML || "") + (sunHTML || ""));
    };

  // Row 1: intervals fecha A (first column = day/month)
    const intervalsA = document.createElement('tr');
    intervalsA.classList.add('interval-row');
    intervalsA.dataset.row = '0'; // Row for date A intervals
  const firstA = document.createElement('th'); firstA.scope = 'row'; firstA.classList.add('provider-cell'); firstA.style.textAlign = 'left';
  firstA.innerHTML = `<div class="date-label" style="margin-bottom: 4px; font-weight:600; color:#203050;">${String(dateA)}</div>`;
  intervalsA.appendChild(firstA);
    // No rowspan: the summary row has its own first cell (compact summary)
    {
      const arr = dataA || [];
      const maxM = arr.length ? Math.max(...arr.map(w => Number(w?.distanceM || 0))) : 0;
      for (let i = 0; i < maxCols; i++) {
        const td = document.createElement('td');
        td.dataset.col = String(i);
        td.dataset.ori = String(i);
        const step = arr[i] || null;
        if (step && step.time != null) {
          const m = Number(step.distanceM || 0);
          let iconHtml = "";
          if (Number.isFinite(m)) {
            if (Math.round(m) === 0) iconHtml = `<img src="${startIconUrl}" class="start-icon" alt="" />`;
            else if (Math.round(m) === Math.round(maxM)) iconHtml = `<img src="${endIconUrl}" class="end-icon" alt="" />`;
          }
          td.innerHTML = `
            <div class="cell-row${iconHtml ? '' : ' no-icon'}">
              ${iconHtml ? `<div class="icon-col">${iconHtml}</div>` : ''}
              <div class="time-dist-col">
                <div class="time-cell">${formatTime(step.time)}</div>
                <div class="m-cell"><span class="m-text">${toDisplayDist(m)}</span></div>
              </div>
            </div>`;
        } else {
          td.innerHTML = `<div class="time-cell">-</div>`;
        }
        intervalsA.appendChild(td);
      }
    }
    tbody.appendChild(intervalsA);

  // Row 2: summary fecha A (using buildCompareCell)
  const summaryA = document.createElement('tr');
  summaryA.classList.add('summary-row');
  summaryA.dataset.row = '1'; // Row for date A summary
    // First cell: compact summary for Date A (no date label)
    { const th = document.createElement('th'); th.scope = 'row'; th.classList.add('provider-cell'); th.style.textAlign = 'left'; th.innerHTML = summaryHTML_A || ''; summaryA.appendChild(th); }
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement('td'); td.dataset.col = String(i); td.dataset.ori = String(i);
      const step = (dataA && dataA[i]) ? dataA[i] : null; td.innerHTML = buildCompareCell(step); summaryA.appendChild(td);
    }
    tbody.appendChild(summaryA);

  // Row 3: intervals fecha B
    const intervalsB = document.createElement('tr');
    intervalsB.classList.add('interval-row');
    intervalsB.dataset.row = '2'; // Row for date B intervals
  const firstB = document.createElement('th'); firstB.scope = 'row'; firstB.classList.add('provider-cell'); firstB.style.textAlign = 'left';
  firstB.innerHTML = `<div class="date-label" style="margin-bottom: 4px; font-weight:600; color:#203050;">${String(dateB)}</div>`;
  intervalsB.appendChild(firstB);
    // No rowspan: the summary row has its own first cell (compact summary)
    {
      const arr = dataB || [];
      const maxM = arr.length ? Math.max(...arr.map(w => Number(w?.distanceM || 0))) : 0;
      for (let i = 0; i < maxCols; i++) {
        const td = document.createElement('td');
        td.dataset.col = String(i);
        td.dataset.ori = String(i);
        const step = arr[i] || null;
        if (step && step.time != null) {
          const m = Number(step.distanceM || 0);
          let iconHtml = "";
          if (Number.isFinite(m)) {
            if (Math.round(m) === 0) iconHtml = `<img src="${startIconUrl}" class="start-icon" alt="" />`;
            else if (Math.round(m) === Math.round(maxM)) iconHtml = `<img src="${endIconUrl}" class="end-icon" alt="" />`;
          }
          td.innerHTML = `
            <div class="cell-row${iconHtml ? '' : ' no-icon'}">
              ${iconHtml ? `<div class="icon-col">${iconHtml}</div>` : ''}
              <div class="time-dist-col">
                <div class="time-cell">${formatTime(step.time)}</div>
                <div class="m-cell"><span class="m-text">${toDisplayDist(m)}</span></div>
              </div>
            </div>`;
        } else {
          td.innerHTML = `<div class="time-cell">-</div>`;
        }
        intervalsB.appendChild(td);
      }
    }
    tbody.appendChild(intervalsB);

  // Row 4: summary fecha B
    const summaryB = document.createElement('tr');
    summaryB.classList.add('summary-row');
    summaryB.dataset.row = '3'; // Row for date B summary
    // First cell: compact summary for Date B (no date label)
    { const th = document.createElement('th'); th.scope = 'row'; th.classList.add('provider-cell'); th.style.textAlign = 'left'; th.innerHTML = summaryHTML_B || ''; summaryB.appendChild(th); }
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement('td'); td.dataset.col = String(i); td.dataset.ori = String(i);
      const step = (dataB && dataB[i]) ? dataB[i] : null; td.innerHTML = buildCompareCell(step); summaryB.appendChild(td);
    }
    tbody.appendChild(summaryB);

    table.appendChild(tbody);

    // Ensure min-width similar to compare-mode so columns don't squish,
    // but derive first column width from actual content (date label) to avoid oversized sticky.
    (function ensureMinWidthDates() {
      const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
      const root = getComputedStyle(document.documentElement);
      const toPx = (v) => parseFloat(v) || 0;
      const colMin  = toPx(root.getPropertyValue('--cw-col-min')) || 64;
      const cols = maxCols;
      const firstColW = (vw < 701) ? 140 : 170; // Increased first column width for units and larger numbers
      // On small screens, don't enforce a large minWidth to allow proper scrolling
      const minW = (vw < 701) ? Math.max(400, Math.ceil(firstColW + Math.max(0, cols) * 45)) : Math.max(600, Math.ceil(firstColW + Math.max(0, cols) * colMin));
      table.style.minWidth = `${minW}px`;
    })();
  }

  function formatDateOnly(d) {
    try {
      const dt = (d instanceof Date) ? d : new Date(d);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}`;
    } catch (_) { return String(d); }
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
          // Debug: log uv_index array and selected index when debugging enabled
          try {
            if (window.cw && window.cw.DEBUG_MERGE) {
              console.debug('[extract][compare] idx=', idx, 'has_uv_array=', Array.isArray(H.uv_index), 'uv_sample=', Array.isArray(H.uv_index) ? H.uv_index.slice(0,5) : null);
            }
          } catch(_) {}
          // If uv array exists but idx is out of bounds, try to find closest index by time
          let uvVal = null;
          if (Array.isArray(H.uv_index)) {
            if (H.uv_index.length > idx) uvVal = H.uv_index[idx];
            else {
              try {
                const finder = (window.cw && window.cw.findClosestIndex) || window.findClosestIndex;
                if (typeof finder === 'function' && Array.isArray(H.time)) {
                  const alt = finder(H.time, step.time);
                  if (alt != null && alt >= 0 && H.uv_index.length > alt) uvVal = H.uv_index[alt];
                }
              } catch (_) {}
            }
          }
          step.uvindex = safeNum(uvVal);
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

      if (step.precipitation != null && Number(step.precipitation) === 0) {
        // Keep precipProb when it's meaningful: show it if >= 20%
        if (step.precipProb == null || Number(step.precipProb) < 20) {
          step.precipProb = null;
        }
      }
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
    // Title shows requested vs effective provider when they differ to aid debugging
    const req = step._reqProv || '';
    const title = (req && req !== eff) ? `requested=${req} effective=${eff}` : '';
    return `
      <div title="${title}" style="display:flex;align-items:center;gap:4px;justify-content:center;min-width:0">
        <i class="wi ${iconClass}" style="font-size:18px;line-height:1;color:#29519b;flex-shrink:0"></i>
        <div class="weather-combined" style="min-width:0;align-items:flex-start;flex-shrink:1">
          <span class="combined-top">${tempTxt}</span>
          <span class="combined-bottom" style="font-size:10px">${windTxt}</span>
          <span class="combined-bottom" style="font-size:10px">${rainWithProb}</span>
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
    
    // Also add class to main element for viewport height adjustments on small screens
    const main = document.querySelector('main');
    if (main) {
      main.classList.remove('compare-dates-mode');
      main.classList.add('compare-mode');
    }

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
    // Insert an empty placeholder header cell so the times header aligns
    // with the new compact summary column added to provider rows.
    const placeholderHeader = document.createElement('th');
    placeholderHeader.classList.add('summary-header');
    // Match default column sizing using --cw-col-min when available
    try {
      const root = getComputedStyle(document.documentElement);
      const colMin = parseFloat(root.getPropertyValue('--cw-col-min')) || 64;
      placeholderHeader.style.minWidth = `${Math.ceil(colMin * 1.75)}px`;
    } catch(_) {}
    row.appendChild(placeholderHeader);

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
  // Small helper: unit labels for summary builder
  const tempUnitLabel = (units && units.temp && String(units.temp).toLowerCase().startsWith('f')) ? 'ºF' : 'ºC';
  const windUnitLabel = (units && units.wind === 'ms') ? 'm/s' : ((units && String(units.wind).toLowerCase().startsWith('mph')) ? 'mph' : 'km/h');
  const precipUnitLabel = (units && units.precip) ? String(units.precip) : 'mm';

  // Compute a small route summary from a provider's array (keeps same shape as other summary helpers)
  function computeProviderSummary(arr) {
    if (window.cw && window.cw.summary && typeof window.cw.summary.computeRouteSummaryFromArray === 'function') {
      return window.cw.summary.computeRouteSummaryFromArray(arr);
    }
    return null;
  }

    // Keep only those present in compareData; append any others (unexpected) at end
    const desiredOrder = ["aromehd","openweather","openmeteo","ow2_arome_openmeteo","meteoblue"]; // FIXED ORDER
    let provOrder = desiredOrder.filter(p => compareData[p]).concat(Object.keys(compareData).filter(p => !desiredOrder.includes(p)));

    provOrder.forEach((prov, rowIndex) => {
      const r = document.createElement("tr");
      r.dataset.row = String(rowIndex);
      // store provider id for reliable lookups when a row is clicked
      r.dataset.prov = prov;
      const th = document.createElement("th");
      // Provider name only (no icon as requested)
      th.innerHTML = `<span class="label-text">${labelForProvider(prov)}</span><span class="label-abbrev">${getProviderAbbrev(prov)}</span>`;
      th.classList.add("provider-cell");
      th.scope = "row";
      r.appendChild(th);
      // Insert compact summary column immediately after provider name
      const arr = compareData[prov] || [];
      const summary = computeProviderSummary(arr);
      const summaryTd = document.createElement('td');
      summaryTd.classList.add('summary-cell');
      // Set provider column to 75% of normal width and expand summary column
      try {
        const firstColW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw-first-col')) || 224;
        const colMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw-col-min')) || 64;
        const providerWidth = Math.round(firstColW * 0.75) + 'px';
        // Set provider name column to 75% of --cw-first-col
        th.style.width = providerWidth;
        th.style.maxWidth = providerWidth;
        th.style.minWidth = providerWidth;
        th.style.overflow = 'hidden';
        th.style.textOverflow = 'ellipsis';
        th.style.whiteSpace = 'nowrap';
        // Expand summary column
        summaryTd.style.minWidth = Math.ceil(colMin * 1.75) + 'px';
        summaryTd.style.maxWidth = Math.ceil(colMin * 2.25) + 'px';
      } catch(_) {}
      try {
        // Build a compact, label-free summary: icon + numeric-only values
    const ic = summary?.iconClass || (window.categoryToIconClass ? window.categoryToIconClass('default', 1) : 'wi-cloud');
  // Fixed-size icon container so the following summary text is consistently aligned
  const iconHtml = `<div style="width:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:8px"><i class="wi ${ic}" style="font-size:22px;line-height:1;color:#29519b"></i></div>`;
        // Build stacked values like other rows (combined-top / combined-bottom)
        let tempPart = '';
        if (summary && (summary.tempMin != null && summary.tempMax != null)) {
          tempPart = `${Math.round(summary.tempMin)}-${Math.round(summary.tempMax)}${tempUnitLabel}`;
        } else if (summary && summary.tempAvg != null) {
          tempPart = `${Math.round(summary.tempAvg)}${tempUnitLabel}`;
        }
        let windPart = '';
        // Prefer showing min-max interval for wind when available, otherwise average
        if (summary && (summary.windMin != null && summary.windMax != null)) {
          windPart = `${Math.round(summary.windMin)}-${Math.round(summary.windMax)}${windUnitLabel}`;
        } else if (summary && summary.windAvg != null) {
          windPart = `${Math.round(summary.windAvg)}${windUnitLabel}`;
        }
  if (summary && summary.gustMax != null) windPart += ` <span class="rs-paren">(${Math.round(summary.gustMax)})</span>`;

        let precipPart = '';
        // Show precipitation interval min-max when available; probability remains as max
        if (summary && (summary.precipMin != null && summary.precipMax != null)) {
          const precipMinVal = Number(summary.precipMin);
          const precipMaxVal = Number(summary.precipMax);
          // Special case: if both values are < 0.5, show single "0" instead of "0-0"
          if (precipMinVal < 0.5 && precipMaxVal < 0.5) {
            precipPart = `0${precipUnitLabel}`;
          } else {
            const minDisp = Math.round(precipMinVal);
            const maxDisp = Math.round(precipMaxVal);
            if (minDisp === maxDisp) {
              precipPart = `${minDisp}${precipUnitLabel}`;
            } else {
              precipPart = `${minDisp}-${maxDisp}${precipUnitLabel}`;
            }
          }
        } else if (summary && summary.precipMax != null) {
          precipPart = `${Math.round(Number(summary.precipMax))}${precipUnitLabel}`;
        }
  if (summary && summary.probMax != null) precipPart += ` <span class="rs-paren">(${Math.round(summary.probMax)}%)</span>`;
        const compactHtml = `
          <div style="display:flex;align-items:center;gap:6px;min-width:0">
            ${iconHtml}
            <div style="min-width:0;align-items:flex-start;flex-shrink:1">
              ${tempPart ? `<span class="combined-top">${tempPart}</span>` : ''}
              ${windPart ? `<span class="combined-bottom">${windPart}</span>` : ''}
              ${precipPart ? `<span class="combined-bottom">${precipPart}</span>` : ''}
            </div>
          </div>`;
        summaryTd.innerHTML = `<div class="compact-summary-cell">${compactHtml}</div>`;
      } catch(e) { summaryTd.textContent = ''; }
      r.appendChild(summaryTd);
      // reuse 'arr' declared earlier for the provider's data
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
      let firstCol = toPx(root.getPropertyValue('--cw-first-col'));
      const colMin  = toPx(root.getPropertyValue('--cw-col-min'));
      const cols = baseline.length;
      // In compare-mode, prefer a smaller first column since provider names are compact now
      if (table.classList.contains('compare-mode')) {
        try { firstCol = Math.round(firstCol * 0.45); } catch(_) { firstCol = Math.max(80, firstCol/2); }
      }
      const minW = Math.max(600, Math.ceil(firstCol + Math.max(0, cols) * colMin));
      table.style.minWidth = `${minW}px`;
    })();
  }

  function labelForProvider(p) {
    if (p === "openmeteo") return "OpenMeteo";
    if (p === "aromehd")   return "AromeHD";
    if (p === "ow2_arome_openmeteo") return "OPW-AromeHD"; 
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

  // NEW: Function to show markers for a selected row in compare modes
  function showCompareRowMarkers(rowIndex, isCompareDates) {
    // NOTE: do not clear markers here - createMarkersForData will manage markers

    const table = document.getElementById("weatherTable");
    if (!table) return;

    let rowData = [];
    let provider = '';

    if (isCompareDates) {
      // Compare dates mode: row 0,1 = date A, row 2,3 = date B
      if (rowIndex === 0 || rowIndex === 1) {
        rowData = window.cw.weatherDataA || [];
        provider = 'Date A';
      } else if (rowIndex === 2 || rowIndex === 3) {
        rowData = window.cw.weatherDataB || [];
        provider = 'Date B';
      }
    } else {
      // Compare providers mode: get data for the selected provider
      const rows = table.querySelectorAll('tbody tr[data-row]');
      if (rowIndex < rows.length) {
        const row = rows[rowIndex];
        // prefer the stored provider id on the row
        const provId = row.dataset.prov || '';
        if (provId) {
          provider = provId;
        } else {
          const providerCell = row.querySelector('.provider-cell .label-text');
          if (providerCell) provider = providerCell.textContent.trim();
        }

        // Get the specific provider data from stored compare data using provider id
        if (window.cw.compareProviderData && window.cw.compareProviderData[provider]) {
          rowData = window.cw.compareProviderData[provider];
        } else {
          // Fallback to baseline data if provider data not found
          rowData = window.cw.weatherData || [];
        }
      }
    }

    // Create markers for each data point in the row
    if (rowData.length > 0 && window.cw?.createMarkersForData) {
        try {
          console.debug('[compare] showCompareRowMarkers', { rowIndex, isCompareDates, provider, rowDataLength: (rowData || []).length, sample: (rowData && rowData[0]) || null });
        } catch(_) {}
        window.cw.createMarkersForData(rowData, provider);
    }
  }

  // Expose compare runner so app.js can trigger it when needed (first load, GPX load, etc.)
  try {
    window.cw = window.cw || {};
    window.cw.runCompareMode = runCompareMode;
    window.cw.showCompareRowMarkers = showCompareRowMarkers;
  } catch (_) {}

})();
