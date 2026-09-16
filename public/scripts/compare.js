(function () {
  // Provider abbreviations for change indicators
  const providerAbbreviations = {
    'openmeteo': 'OPM',
    'aromehd': 'ARM',
    'openweather': 'OPW',
    'ow2_arome_openmeteo': 'CHAIN'
  };

  // Guard on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("apiSource");
    if (!sel) return;

    // Nothing here launches a comparison: publish (app.js) does, for the snapshot it puts on
    // screen, and so does choosing compare (ui.js). A table observer and a listener of our own
    // used to launch it too, several times per route and with whatever weatherData held.

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
          // Row 0 (intervalsA) -> Row 1 (summaryA), Row 1 (summaryA) -> Row 1 (summaryA)
          // Row 2 (intervalsB) -> Row 3 (summaryB), Row 3 (summaryB) -> Row 3 (summaryB)
          let targetIndex = rawIndex;
          if (isCompareDates) {
            if (rawIndex === 0) targetIndex = 1; // intervalsA -> summaryA
            else if (rawIndex === 1) targetIndex = 1; // summaryA -> summaryA
            else if (rawIndex === 2) targetIndex = 3; // intervalsB -> summaryB
            else if (rawIndex === 3) targetIndex = 3; // summaryB -> summaryB
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

  // A provider's answer for one step, got as the table gets it: AROME filled in from standard
  // Open-Meteo (cwForecastRules.mergeAromeWithStandard) and replaced by Open-Meteo when unusable.
  // Null when the provider does not answer 200, or AROME is unusable and Open-Meteo does not either;
  // `effProv` is the provider the answer comes from, the one to file it under.
  async function fetchAnswer(effProv, p, timeAt, apiKey, units, recorder, init = {}) {
    const ask = (prov, key, rec = recorder) =>
      fetch(window.cw.buildProviderUrl(prov, p, timeAt, key, units.wind, units.temp), { ...init, cwRecorder: rec });
    const res = await ask(effProv, apiKey);
    if (!res.ok) return null;
    let json = await window.cw.utils.readJson(res, recorder);
    if (effProv === "aromehd") {
      try {
        // Best-effort, as in the table: this only completes AROME from the standard model and its
        // failure is swallowed right here, so it gives up no host — AROME is served by that same
        // host and has just answered this step. Its own recorder carries the deadline and the abort.
        const bestEffort = window.cw.utils.bestEffortRecorder(recorder);
        const std = await ask("openmeteo", "", bestEffort);
        if (std.ok) cwForecastRules.mergeAromeWithStandard(json, await window.cw.utils.readJson(std, bestEffort));
      } catch {}
      // The Open-Meteo answer that stands in for an unusable AROME one is this step's real answer,
      // not a completion: it keeps the comparison's recorder, and its failure is the row's to name.
      if (aromeResponseLooksInvalid(json)) {
        const r3 = await ask("openmeteo", "");
        if (!r3.ok) return null;
        json = await window.cw.utils.readJson(r3, recorder);
        effProv = "openmeteo";
      }
    }
    return { json, effProv };
  }

  // fetchAnswer that never throws and, when a failed request left the step with nothing, notes under
  // `row` (the provider whose row shows the gap) the recorder's failure status ('500', 'network',
  // 'body'…) and, for OpenWeather, the table's reading of it (classifyProviderError: 401 the key, 429
  // the quota). That is what the notice names. The run's requests go one after another, so the count
  // is its own.
  async function fetchAnswerNoting(failed, row, effProv, p, timeAt, apiKey, units, recorder, init) {
    const before = recorder.failed;
    const answer = await fetchAnswer(effProv, p, timeAt, apiKey, units, recorder, init).catch(() => null);
    if (!answer && recorder.failed > before) {
      const status = recorder.lastFailStatus;
      const code = effProv === 'openweather' && /^\d+$/.test(status) ? window.classifyProviderError(effProv, Number(status)) : null;
      failed[row] = { status, code };
    }
    return answer;
  }

  // A comparison's steps: the published snapshot's, in the shape the table and markers read.
  function snapshotSteps(snapshot) {
    return (snapshot.steps || []).map((s) => ({ lat: s.lat, lon: s.lon, time: new Date(s.time), distanceM: s.distanceM }));
  }

  // A comparison on screen says what its own requests saw (spec §4.10): a table whose requests
  // failed and that came out empty says why, data read from the cache without connection says how
  // old it is, and otherwise every provider that failed is named (`failedProviders`), after the
  // missing OpenWeather key when a date comparison asked Open-Meteo for lack of it. A step counts
  // when any painted row has a temperature or a wind for it.
  function showComparisonNotice(recorder, rows, run, { failedProviders = {}, missingKey = false } = {}) {
    const length = Math.max(0, ...rows.map((r) => (r ? r.length : 0)));
    let usableSteps = 0;
    for (let i = 0; i < length; i++) {
      if (rows.some((r) => r && r[i] && (r[i].temp != null || r[i].windSpeed != null))) usableSteps++;
    }
    if (!window.cwShowForecastNotice) return;
    window.cwShowForecastNotice({
      requestedProvider: 'compare',
      usableSteps,
      transportFailures: recorder.failed,
      lastFailStatus: recorder.lastFailStatus,
      offline: recorder.offline,
      staleAgeMs: recorder.staleAgeMs,
      failedProviders,
      missingKey,
    }, !!run.snapshot.settings.noticeAll, run);
  }

  async function runCompareMode() {
    if (!isReady()) return;
    const apiSel = document.getElementById("apiSource");
    if (!apiSel || apiSel.value !== "compare") return;
    // Compares the snapshot on screen, or nothing. Every effect below waits for a check that
    // this is still the comparison of that snapshot.
    const run = window.cwLaunchComparison && window.cwLaunchComparison("providers");
    if (!run) return;
    const current = () => window.cwIsComparisonCurrent(run);
    // What this comparison's requests and cache reads saw; its notice is decided from it.
    const recorder = window.cw.utils.createRecorder(run.signal);
    // Providers whose request left a step with nothing, named in the notice.
    const failedProviders = {};

    try {
    const snapshot = run.snapshot;
    const steps = snapshotSteps(snapshot);
    if (!steps.length) return;

    // Temperature and wind as the snapshot was computed; rain and distance only change how it looks.
    const units = {
      temp: snapshot.settings.units.temp,
      wind: snapshot.settings.units.wind,
      precip: document.getElementById("precipUnits")?.value || "mm",
      distance: document.getElementById("distanceUnits")?.value || "km",
    };
    const keys = snapshot.settings.keys || {};
    const horizons = window.cw.horizons || {};
    const MS_PER_DAY = horizons.MS_PER_DAY || (24*60*60*1000);
    const MS_PER_HOUR = horizons.MS_PER_HOUR || (60*60*1000);
    const now = new Date();

    const provs = getCompareProviders(keys);
    const baseProvs = provs.filter(p => p !== 'ow2_arome_openmeteo'); // NEW: exclude chain from direct fetch

    const compareData = {};
    const hasAny = {};
    for (const p of provs) compareData[p] = [];

    for (let i = 0; i < steps.length; i++) {
      if (!current()) return;
      const p = steps[i];
      const timeAt = new Date(p.time);
      const daysAhead = (timeAt - now) / MS_PER_DAY;
      const hoursAhead = (timeAt - now) / MS_PER_HOUR;

      for (const prov of baseProvs) { // CHANGED: use baseProvs
        // Respect horizons
        // The numbers are window.cw.horizons (app.js). The literals that used to stand in for them
        // here had gone stale — OpenWeather's said two days where the table keeps four — so there is
        // no second copy of them any more: with no horizons there is simply no guard.
        if ((prov === "openweather" && daysAhead > horizons.OPENWEATHER_MAX_DAYS) ||
            (prov === "aromehd"     && hoursAhead > horizons.AROMEHD_MAX_HOURS) ||
            (daysAhead > horizons.OPENMETEO_MAX_DAYS)) {
          compareData[prov].push(blankStep(prov, p));
          continue;
        }

        // Decide effective provider
        let effProv = prov;
        
        // For aromehd: use chain resolver to respect 36-hour limit (same as normal mode)
        if (prov === "aromehd") {
          const resolverExternal = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp || null;
          const resolver = resolverExternal;
          const chainsExternal = (window.cw && window.cw.utils && window.cw.utils.providerChains) || {};
          const chainEnabled = chainsExternal[prov] || prov === 'aromehd';
          if (resolver && chainEnabled) {
            // Resolve using chain logic (0-36h aromehd, 36h+ openmeteo)
            const resolved = resolver(prov, timeAt, now, { lat: p.lat, lon: p.lon });
            if (resolved) effProv = resolved;
          } else {
            // Fallback: use horizon check (48 hours) and domain check
            if (hoursAhead > (horizons.AROMEHD_MAX_HOURS || 48) || !isAromeHdCovered(p.lat, p.lon)) {
              effProv = "openmeteo";
            }
          }
        }

        // Keys presence
        const apiKeyOWM = keys.openweather || "";
        const needsKey  = (effProv === "openweather");
        if (needsKey && apiKeyOWM.trim().length < 5) {
          compareData[prov].push(blankStep(prov, p));
          continue;
        }

        // Cache key (use effective provider for data source)
  const mk = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
  // Filed as the table files its answers: under each step's UTC date.
  const key = mk(effProv, timeAt.toISOString().substring(0,10), units.temp, units.wind, p.lat, p.lon, timeAt);
  const cached = window.cw.getCache && window.cw.getCache(key, recorder);
        if (cached) {
          const s = extractStepMetrics(effProv, cached, p, units);
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
          const apiKey = (effProv === "openweather") ? apiKeyOWM : "";
          const answer = await fetchAnswerNoting(failedProviders, prov, effProv, p, timeAt, apiKey, units, recorder);
          if (answer) {
            const json = answer.json;
            effProv = answer.effProv;
            if (!current()) return;
            // Filed under the provider the answer comes from, as the table files a fallback.
            window.cw.setCache && window.cw.setCache(mk(effProv, timeAt.toISOString().substring(0,10), units.temp, units.wind, p.lat, p.lon, timeAt), json);
            const s = extractStepMetrics(effProv, json, p, units);
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

    // NEW: Build chain row (ow2_arome_openmeteo) AFTER base providers fetched (always attempt if present in provs)
    const chainId = 'ow2_arome_openmeteo';
    if (provs.includes(chainId)) {
      const resolverExternal = (window.cw && window.cw.utils && window.cw.utils.resolveProviderForTimestamp) || window.resolveProviderForTimestamp || null;
      const resolver = resolverExternal;
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
    const order = ["aromehd","openweather","openmeteo","ow2_arome_openmeteo"];
    const filtered = {};
    order.forEach(k => { if (compareData[k] && (hasAny[k] || k === 'ow2_arome_openmeteo')) filtered[k] = compareData[k]; });

    // Baseline for summary (prefer OM). Markers are disabled in compare mode.
    const baseline = filtered.openmeteo || filtered.aromehd || filtered.openweather || [];

    // Replaced by another comparison, another computation or another route: nothing reaches the page.
    if (!current()) return;

    // Mark body as compare-active (used for small-screen behavior)
    try { document.body.classList.add("compare-active"); } catch {}
    // No wind or rain markers in compare mode
    if (window.cw?.clearMarkers) {
      try { window.cw.clearMarkers(); } catch(_) {}
      try { window.cw._compareMarkersCleared = true; } catch(_) {}
    }
    if (window.cw.setWeatherData) window.cw.setWeatherData(baseline);

    // Store provider data for row selection
    window.cw.compareProviderData = filtered;

    // Build table
    renderCompareTable(filtered, baseline, units);
    // Without an OpenWeather key its row is left out (getCompareProviders) on purpose, and nothing is said.
    showComparisonNotice(recorder, Object.values(compareData), run, { failedProviders });
    } finally {
      // Only this comparison's claim: a newer one, or a computation, holds its own.
      window.cw.releaseLoading("compare:" + run.comparisonId);
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

    // Compares the snapshot on screen at two dates, or nothing. A newer comparison, another
    // computation or another route replaces this one, which then paints and stores nothing.
    const run = window.cwLaunchComparison && window.cwLaunchComparison("dates");
    if (!run) return;
    const current = () => window.cwIsComparisonCurrent(run);
    // What this comparison's requests and cache reads saw; its notice is decided from it.
    const recorder = window.cw.utils.createRecorder(run.signal);
    // Providers whose request left a step with nothing, named in the notice.
    const failedProviders = {};

    try {
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

    const snapshot = run.snapshot;
    const steps = snapshotSteps(snapshot);
    if (!steps.length) return;

    // Temperature and wind as the snapshot was computed; rain and distance only change how it looks.
    const units = {
      temp: snapshot.settings.units.temp,
      wind: snapshot.settings.units.wind,
      precip: document.getElementById("precipUnits")?.value || "mm",
      distance: document.getElementById("distanceUnits")?.value || "km",
    };
    const keys = snapshot.settings.keys || {};
    const horizons = window.cw.horizons || {};
    const MS_PER_DAY = horizons.MS_PER_DAY || (24 * 60 * 60 * 1000);
  // The provider the snapshot was computed with; 'compare' compares dates with Open-Meteo
  let provider = snapshot.settings.provider || 'openmeteo';
  if (provider === 'compare') provider = 'openmeteo';
  // As the table: OpenWeather chosen with no key of five characters is asked of Open-Meteo, and says so.
  const missingKey = provider === 'openweather' && (keys.openweather || '').trim().length < 5;

  // The two dates are what this comparison is asked for (full YYYY-MM-DDTHH:mm, parsed locally)
  const dtA = document.getElementById("datetimeRoute")?.value || "";
  const dtB = document.getElementById("datetimeRoute2")?.value || "";

  // Validate date ranges for both dates
  const validationA = validateDateRange(dtA, 'fecha A');
  const validationB = validateDateRange(dtB, 'fecha B');

  if (!validationA.valid) {
    const table = document.getElementById("weatherTable");
    if (table && current()) {
      table.innerHTML = `<tbody><tr><td><span style="color: red;">${validationA.error}</span></td></tr></tbody>`;
    }
    return;
  }

  if (!validationB.valid) {
    const table = document.getElementById("weatherTable");
    if (table && current()) {
      table.innerHTML = `<tbody><tr><td><span style="color: red;">${validationB.error}</span></td></tr></tbody>`;
    }
    return;
  }

  const baseA = parseLocalDateTime(dtA);
  const baseB = parseLocalDateTime(dtB);
  if (!baseA || !baseB) {
      // nothing to do yet; render notice
      const table = document.getElementById("weatherTable");
      if (table && current()) {
        const msg = (window.t ? window.t('choose_compare_both_dates') : 'Please pick both dates to compare.');
        table.innerHTML = `<tbody><tr><td><span data-i18n="choose_compare_both_dates">${msg}</span></td></tr></tbody>`;
      }
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
    const intervalMin = Number(snapshot.settings.interval) || 15;
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
        return 'openmeteo';
      } catch (_) { return 'openmeteo'; }
    };

    // For each base datetime, build an array of step-metrics by fetching with timeAt = base + offset.
    // Null once this comparison has been replaced: it stops asking.
    async function fetchDataForBase(baseDate) {
      const arr = [];
      for (let i = 0; i < steps.length; i++) {
        if (!current()) return null;
        const p = steps[i];
        const offMs = offsets[i] || 0;
        const timeAt = new Date(baseDate.getTime() + offMs);
        // Base step copy with aligned time for indexing and display
        const baseForIndex = { ...p, time: timeAt };
        // Decide effective provider for this timestamp/location
        // Without the key that is Open-Meteo, decided before the resolver: it reads the page's key field
        // and would pick AROME-HD, or OpenWeather with a short key.
        let effProv = missingKey ? 'openmeteo' : (resolveEff(provider, timeAt, { lat: p.lat, lon: p.lon }) || provider);
        // A chain that reaches OpenWeather without a usable key asks Open-Meteo too, as the table does.
        if (effProv === 'openweather' && (keys.openweather || '').trim().length < 5) effProv = 'openmeteo';
        // The horizons the table (app.js) and compare-providers both keep, which this mode had
        // none of: the date field accepts fourteen days, OpenWeather is trusted for four and its
        // answer only holds 48 hours, so beyond that the step asks Open-Meteo, and beyond
        // Open-Meteo's own horizon it has no data. The numbers come from window.cw.horizons; with
        // none there is no guard, as before, rather than a second copy of them here.
        const daysAhead = (timeAt.getTime() - Date.now()) / MS_PER_DAY;
        if (effProv === 'openweather' && daysAhead > horizons.OPENWEATHER_MAX_DAYS) effProv = 'openmeteo';
        if (daysAhead > horizons.OPENMETEO_MAX_DAYS) {
          arr.push(blankStep(effProv, baseForIndex));
          continue;
        }
        // Build cache key and try cache
        // Include provider, units, coords and exact timeAt in key (date uniqueness comes from timeAt)
  const mk2 = (window.cw && window.cw.utils && window.cw.utils.makeCacheKey) || makeCacheKey;
  const key = mk2(effProv, timeAt.toISOString().substring(0,10), units.temp, units.wind, p.lat, p.lon, timeAt);
  const cached = window.cw.getCache && window.cw.getCache(key, recorder);
        if (cached) {
          const s = extractStepMetrics(effProv, cached, baseForIndex, units);
          s.provider = effProv;
          arr.push(s);
          continue;
        }
        try {
          const apiKeyOWM = keys.openweather || "";
          const apiKey = (effProv === 'openweather') ? apiKeyOWM : '';
          const answer = await fetchAnswerNoting(failedProviders, effProv, effProv, p, timeAt, apiKey, units, recorder, { cache: 'no-store' });
          if (answer) {
            const json = answer.json;
            effProv = answer.effProv;
            if (!current()) return null;
            // Filed under the provider the answer comes from, as the table files a fallback.
            window.cw.setCache && window.cw.setCache(mk2(effProv, timeAt.toISOString().substring(0,10), units.temp, units.wind, p.lat, p.lon, timeAt), json);
            const s = extractStepMetrics(effProv, json, baseForIndex, units);
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

      const dataA = await fetchDataForBase(baseA);
      if (!dataA) return;
      const dataB = await fetchDataForBase(baseB);
      // Replaced by another comparison, another computation or another route: nothing reaches the page.
      if (!dataB || !current()) return;

      // Clear any existing markers since we can't show two dates at once (only once per session)
      if (window.cw?.clearMarkers && !window.cw._compareMarkersCleared) {
        window.cw.clearMarkers();
        try { window.cw._compareMarkersCleared = true; } catch(_) {}
      }

      // Render combined table: header (times) then block A (label row + data rows), block B
      const labelA = formatDateOnly(baseA);
      const labelB = formatDateOnly(baseB);
      renderDateCompareTable(labelA, dataA, labelB, dataB, units, provider);

      // Store data for row selection
      window.cw.weatherDataA = dataA;
      window.cw.weatherDataB = dataB;
      showComparisonNotice(recorder, [dataA, dataB], run, { failedProviders, missingKey });
    } finally {
      // Only this comparison's claim: a newer one, or a computation, holds its own.
      window.cw.releaseLoading("compare:" + run.comparisonId);
    }
  }

  // Expose date-compare runner so UI button can call it
  try { window.cw = window.cw || {}; window.cw.runCompareDatesMode = runCompareDatesMode; } catch(_) {}

  function renderDateCompareTable(dateA, dataA, dateB, dataB, units, expectedProvider) {
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
    const startIconUrl = "/icons/marker-icon-green.png";
    const endIconUrl = "/icons/marker-icon-red.png";

  const tbody = document.createElement('tbody');
  // Build compact summary (route summary + sun) HTML for each base date using first available step
    // Every row copies its step from the snapshot, position included.
    const { lat: latA, lon: lonA } = dataA[0];
    const dateLikeA = (dataA && dataA[0] && dataA[0].time) || null;
    const sunA = buildSunHeaderFull(latA, lonA, dateLikeA);
    const { lat: latB, lon: lonB } = dataB[0];
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
    // Temperature and wind in the units the rows were asked and read in, not the ones selected now.
    const tempUnit = String(units.temp || "C");
    const windUnit = String(units.wind || "kmh");
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
      if (summary.tempMin != null && summary.tempMax != null) {
        const tempMin = Math.round(summary.tempMin);
        const tempMax = Math.round(summary.tempMax);
        // If min and max are the same, show single value instead of "2-2"
        tempPart = (tempMin === tempMax) ? `${tempMin}${tUnit}` : `${tempMin}-${tempMax}${tUnit}`;
      } else if (summary.tempAvg != null) {
        tempPart = `${Math.round(summary.tempAvg)}${tUnit}`;
      }
      let windPart = "";
      if (summary.windMin != null && summary.windMax != null) {
        const windMin = Math.round(summary.windMin);
        const windMax = Math.round(summary.windMax);
        // If min and max are the same, show single value instead of "2-2"
        windPart = (windMin === windMax) ? `${windMin}${wUnit}` : `${windMin}-${windMax}${wUnit}`;
      } else if (summary.windAvg != null) {
        windPart = `${Math.round(summary.windAvg)}${wUnit}`;
      }
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

  // Row 0: intervals fecha A (first column = day/month)
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

  // Row 1: summary fecha A (using buildCompareCell)
  const summaryA = document.createElement('tr');
  summaryA.classList.add('summary-row');
  summaryA.dataset.row = '1'; // Row for date A summary
    // First cell: icon + compact summary for Date A
    {
      const th = document.createElement('th');
      th.scope = 'row';
      th.classList.add('provider-cell');
      th.style.textAlign = 'left';
      const iconClassA = sumA?.iconClass || '';
      th.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          ${iconClassA ? `<i class="wi ${iconClassA}" style="font-size: 24px; color: #29519b; flex-shrink: 0;"></i>` : ''}
          <div style="flex: 1;">${summaryHTML_A || ''}</div>
        </div>`;
      summaryA.appendChild(th);
    }
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement('td');
      td.style.position = 'relative'; // For absolute positioning of indicators
      td.dataset.col = String(i);
      td.dataset.ori = String(i);
      
      const step = (dataA && dataA[i]) ? dataA[i] : null;
      
      // Add provider change indicator when the provider changes from the previous cell
      let providerIndicator = '';
      const cellProvider = step?.provider;
      const prevProvider = (i > 0 && dataA && dataA[i-1]) ? dataA[i-1].provider : null;
      
      // Show indicator if:
      // 1. First cell and provider differs from expectedProvider, OR
      // 2. Provider differs from previous cell (detects all changes in chains)
      const showIndicator = (i === 0 && cellProvider && expectedProvider && cellProvider !== expectedProvider) ||
                            (i > 0 && cellProvider && cellProvider !== prevProvider);
      
      if (showIndicator) {
        const abbr = providerAbbreviations[cellProvider] || cellProvider.substring(0, 3).toUpperCase();
        providerIndicator = `<div class="provider-indicator">${abbr}</div>`;
      }
      
      td.innerHTML = providerIndicator + buildCompareCell(step);
      summaryA.appendChild(td);
    }
    tbody.appendChild(summaryA);

  // Row 2: intervals fecha B
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

  // Row 3: summary fecha B
    const summaryB = document.createElement('tr');
    summaryB.classList.add('summary-row');
    summaryB.dataset.row = '3'; // Row for date B summary
    // First cell: icon + compact summary for Date B
    {
      const th = document.createElement('th');
      th.scope = 'row';
      th.classList.add('provider-cell');
      th.style.textAlign = 'left';
      const iconClassB = sumB?.iconClass || '';
      th.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          ${iconClassB ? `<i class="wi ${iconClassB}" style="font-size: 24px; color: #29519b; flex-shrink: 0;"></i>` : ''}
          <div style="flex: 1;">${summaryHTML_B || ''}</div>
        </div>`;
      summaryB.appendChild(th);
    }
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement('td');
      td.style.position = 'relative'; // For absolute positioning of indicators
      td.dataset.col = String(i);
      td.dataset.ori = String(i);
      
      const step = (dataB && dataB[i]) ? dataB[i] : null;
      
      // Add provider change indicator when the provider changes from the previous cell
      let providerIndicator = '';
      const cellProvider = step?.provider;
      const prevProvider = (i > 0 && dataB && dataB[i-1]) ? dataB[i-1].provider : null;
      
      // Show indicator if:
      // 1. First cell and provider differs from expectedProvider, OR
      // 2. Provider differs from previous cell (detects all changes in chains)
      const showIndicator = (i === 0 && cellProvider && expectedProvider && cellProvider !== expectedProvider) ||
                            (i > 0 && cellProvider && cellProvider !== prevProvider);
      
      if (showIndicator) {
        const abbr = providerAbbreviations[cellProvider] || cellProvider.substring(0, 3).toUpperCase();
        providerIndicator = `<div class="provider-indicator">${abbr}</div>`;
      }
      
      td.innerHTML = providerIndicator + buildCompareCell(step);
      summaryB.appendChild(td);
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

  function getCompareProviders(keys) {
    const provs = ["openmeteo", "aromehd"];
    const hasOWM = ((keys.openweather || "").trim().length >= 5);
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

  // `units` are the comparison's own (its snapshot's): the request was made in them.
  function extractStepMetrics(prov, raw, baseStep, units) {
    const windUnit = units.wind;
    const step = { ...baseStep, provider: prov, weather: raw };
    const safeNum = window.cw.safeNum || ((v)=>Number.isFinite(Number(v))?Number(v):null);
    const windToUnits = window.cw.windToUnits || ((v)=>v);
    // What extractStep read, in the units the rows are drawn in. Its wind is km/h whatever the
    // answer was asked in, so every provider goes through windToUnits the same way.
    const apply = (r) => {
      if (!r) return;
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
    };
    try {
      if (!raw) return blankStep(prov, baseStep);

      if (prov === "openmeteo" || prov === "aromehd") {
        // The table's own reading: the hour by the answer's utc_offset_seconds, and the quarter of
        // minutely_15 whenever the answer has one for the step, with uv, probability and weather code
        // from hourly when the quarter has none. Precipitation is the hour being ridden, (H, H+60 min].
        const r = cwForecastRules.extractStep(raw, { provider: prov, time: step.time });
        if (r) {
          apply(r);
          step.isDaylight = r.isDay;
          if (prov === "aromehd") window.cw.aromeCodeAndDay(step);
        }
      } else if (prov === "openweather") {
        // The table's own reading here too (extractStep): an hourly entry only within an hour of the
        // step, otherwise the daily entry of the step's own local date — not the nearest in raw `dt`,
        // which past the 48 hours One Call sends showed the last hour of the answer, a different day.
        // Daylight stays SunCalc's, as the table's does: OpenWeather sends no is_day.
        const timeMs = (step.time instanceof Date ? step.time : new Date(step.time)).getTime();
        try {
          const pos = SunCalc.getPosition(new Date(timeMs), step.lat, step.lon);
          step.isDaylight = pos.altitude > 0 ? 1 : 0;
        } catch { step.isDaylight = 1; }
        // OpenWeather answers in the system buildProviderUrl asked for from the same temperature unit.
        const owUnits = String(units.temp || "").toLowerCase().startsWith("f") ? "imperial" : "metric";
        apply(cwForecastRules.extractStep(raw, { provider: prov, time: step.time, payloadUnits: owUnits }));
      }

      if (step.precipitation != null && Number(step.precipitation) === 0) {
        // Keep precipProb when it's meaningful: show it if >= 10%
        if (step.precipProb == null || Number(step.precipProb) < 10) {
          step.precipProb = null;
        }
      }
      step.luminance = window.cw.computeLuminance ? window.cw.computeLuminance(step) : null;
      return step;
    } catch {
      return step;
    }
  }

  function buildCompareCell(step) {
    if (!step || step.temp == null) return "-";
    // Support chain: underlying effective provider stored in _effProv
    const prov = step.provider;
    const eff = step._effProv || prov;
    let iconClass = "";
    if (eff === "openweather") iconClass = (window.cw.icons?.ow ? window.cw.icons.ow(step.weatherCode, step.isDaylight) : "");
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
  // Show probability if:
  // 1. There is precipitation (pr > 0), OR
  // 2. No precipitation but probability >= 10%
  const rainWithProb = (pp != null && (Number(pr) > 0 || pp >= 10)) ? `${rainTxt} (${pp}%)` : rainTxt;
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
    // A date comparison painted before leaves its mode on the table; row clicks read it first.
    table.classList.remove("compare-dates-mode");
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
      const startIconUrl = "/icons/marker-icon-green.png";
      const endIconUrl = "/icons/marker-icon-red.png";
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
    const desiredOrder = ["aromehd","openweather","openmeteo","ow2_arome_openmeteo"]; // FIXED ORDER
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
    const ic = summary?.iconClass || 'wi-cloud';
  // Fixed-size icon container so the following summary text is consistently aligned
  const iconHtml = `<div style="width:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:8px"><i class="wi ${ic}" style="font-size:22px;line-height:1;color:#29519b"></i></div>`;
        // Build stacked values like other rows (combined-top / combined-bottom)
        let tempPart = '';
        if (summary && (summary.tempMin != null && summary.tempMax != null)) {
          const tempMin = Math.round(summary.tempMin);
          const tempMax = Math.round(summary.tempMax);
          // If min and max are the same, show single value instead of "2-2"
          tempPart = (tempMin === tempMax) ? `${tempMin}${tempUnitLabel}` : `${tempMin}-${tempMax}${tempUnitLabel}`;
        } else if (summary && summary.tempAvg != null) {
          tempPart = `${Math.round(summary.tempAvg)}${tempUnitLabel}`;
        }
        let windPart = '';
        // Prefer showing min-max interval for wind when available, otherwise average
        if (summary && (summary.windMin != null && summary.windMax != null)) {
          const windMin = Math.round(summary.windMin);
          const windMax = Math.round(summary.windMax);
          // If min and max are the same, show single value instead of "2-2"
          windPart = (windMin === windMax) ? `${windMin}${windUnitLabel}` : `${windMin}-${windMax}${windUnitLabel}`;
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
         td.style.position = 'relative'; // For absolute positioning of indicators
         
         // Add provider change indicator when the provider changes from the previous cell
         let providerIndicator = '';
         const cellProvider = arr[i]?.provider;
         const prevProvider = (i > 0) ? arr[i-1]?.provider : null;
         
         // Show indicator if:
         // 1. First cell and provider differs from row provider, OR
         // 2. Provider differs from previous cell (detects all changes in chains)
         const showIndicator = (i === 0 && cellProvider && cellProvider !== prov) || 
                               (i > 0 && cellProvider && cellProvider !== prevProvider);
         
         if (showIndicator) {
           const abbr = providerAbbreviations[cellProvider] || cellProvider.substring(0, 3).toUpperCase();
           providerIndicator = `<div class="provider-indicator">${abbr}</div>`;
         }
         
         td.innerHTML = providerIndicator + buildCompareCell(arr[i]);
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
    if (p === "openweather") return "OpenWeather";
    return String(p || "");
  }

  function getProviderAbbrev(p) {
    if (p === "openmeteo") return "OMT";
    if (p === "aromehd")   return "ARM";
    if (p === "ow2_arome_openmeteo") return "OARM"; // NEW chain abbrev
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
