/* best-window.js
   Find the best upcoming time window for a loaded route based on weather.
   Conservative sampling strategy: sample every sampleStep-th step and cap total API calls.
   Uses Open-Meteo for bulk sampling (no API key). Exposes window.findBestWindow()
*/
(function(){
  const MAX_API_CALLS = 40; // cap to avoid excessive requests
  const SAMPLE_STEP = 1;    // sample every step (we'll rely on grouping to limit calls)

  function isoDateNoMs(d) { return (d instanceof Date ? d : new Date(d)).toISOString(); }

  // Build a lightweight Open-Meteo URL for a given point/time
  function buildOpenMeteoUrl(p, timeAt) {
    const t = isoDateNoMs(timeAt);
    return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      `&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weathercode,cloud_cover,uv_index` +
      `&start=${t}&timezone=auto`;
  }

  // Score a single step (lower is worse). We'll compose a simple score: prefer low precipitation prob/amount, moderate wind, high luminance
  function scoreStep(step) {
    // step: { precipitation, precipitation_probability, wind_gusts_10m, cloud_cover, uv_index }
    const precip = Number(step.precipitation ?? 0);
    const prob = Number(step.precipitation_probability ?? 0);
    const wind = Number(step.wind_gusts_10m ?? step.wind_speed_10m ?? 0);
    const cloud = Number(step.cloud_cover ?? 0);
    const uv = Number(step.uv_index ?? 0);

  // Normalize components (tighter on precip & wind to penalize them heavier)
  // Precipitation: always penalize if any rain; medium rain (1-3 mm/h) => strong penalty
  const precipAmtNorm = Math.min(1, precip / 3); // 3 mm/h ~ heavy
  const precipProbNorm = Math.min(1, prob / 100);
  // heavier weight on amount, but ensure tiny amounts still create a base penalty
  let precipScore = Math.min(1, 0.75 * Math.min(1, precip / 2) + 0.25 * precipProbNorm);
  if (precip > 0 && precipScore < 0.12) precipScore = 0.12; // tiny rain => small but non-zero penalty
  // medium rain should penalize noticeably: boost in 0.5..0.9 range
  if (precip >= 1 && precip < 3) precipScore = Math.max(precipScore, 0.6);

  // Wind: include gusts explicitly and keep normalization similar (penalize from ~15 m/s)
  const gust = Number(step.wind_gusts_10m ?? 0);
  const wspeed = Number(step.wind_speed_10m ?? 0);
  const windCombined = Math.max(gust, wspeed);
  const windScore = Math.min(1, (0.6 * gust + 0.4 * wspeed) / 15);

    // Clouds small penalty (less important than precip/wind)
    const cloudScore = Math.min(1, cloud / 120);

    // UV: daylight preference (higher better)
    const uvScore = 1 - Math.min(1, uv / 11);

    // Weighted sum: heavy on precipitation and wind
    const combined = 0.65 * precipScore + 0.25 * windScore + 0.05 * cloudScore + 0.05 * uvScore;
    // return a normalized goodness 0..1 (1 best)
    return 1 - clamp01(combined);
  }

  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  // samples: array of { lat, lon, time }
  // chainOrProvider: the selected provider or chain (e.g. 'ow2_arome_openmeteo'). If the chain resolves to AromeHD for the timestamps,
  // we will request Open‑Meteo with the AROME model variant. Otherwise we use standard Open‑Meteo as fallback.
  async function fetchOpenMeteoForTimes(samples, chainOrProvider = 'openmeteo') {
    // samples: array of { lat, lon, time }
    // We'll group by (lat,lon) rounded to ~4 decimals to reuse requests per location where possible
    const groups = new Map();
    for (const s of samples) {
      const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

  // preferredProvider: if 'aromehd' we'll request AROME model variant; other providers currently fall back to Open‑Meteo
  const results = new Map(); // key -> map timeISO -> hourly object
    let calls = 0;
    const now = new Date();
    for (const [key, arr] of groups.entries()) {
      if (calls >= MAX_API_CALLS) break;
      const p = { lat: arr[0].lat, lon: arr[0].lon };
      // Build a time window covering all requested times for this location to reduce calls
      const times = arr.map(s => new Date(s.time));
      // Resolve provider per timestamp using utils if available; this lets chains like ow2_arome_openmeteo pick AromeHD near-term
      let providersForTimes = [];
      try {
        const picker = (window.cw && window.cw.utils && window.cw.utils.pickProvidersForRoute) ? window.cw.utils.pickProvidersForRoute : null;
        if (picker) {
          providersForTimes = picker(chainOrProvider, times, now);
        } else {
          providersForTimes = times.map(() => chainOrProvider);
        }
      } catch (e) { providersForTimes = times.map(() => chainOrProvider); }
      const allArome = providersForTimes.length && providersForTimes.every(pr => String(pr).toLowerCase() === 'aromehd');
      // If chain is 'compare', prefer openmeteo
      const preferArome = allArome;
      const start = new Date(Math.min(...times.map(t => t.getTime())));
      const end = new Date(Math.max(...times.map(t => t.getTime())));
      // Expand by 2 hours margin
      start.setHours(start.getHours() - 2);
      end.setHours(end.getHours() + 2);
      // Build Open-Meteo URL; use AROME model variant when the chain resolves to AromeHD for these times
      const modelsParam = preferArome ? '&models=arome_france_hd' : '';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
        `&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,weathercode,cloud_cover,uv_index` +
        `&start=${start.toISOString()}&end=${end.toISOString()}&timezone=auto${modelsParam}`;
      try {
        calls++;
        const res = await fetch(url);
        if (!res.ok) continue;
        const j = await res.json();
        // map hourly arrays by ISO time
        const H = j.hourly || {};
        const timesArr = H.time || [];
        const mapByTime = new Map();
        for (let i = 0; i < timesArr.length; i++) {
          mapByTime.set(timesArr[i], {
            temperature: (H.temperature_2m || [])[i],
            precipitation: (H.precipitation || [])[i],
            precipitation_probability: (H.precipitation_probability || [])[i],
            wind_speed_10m: (H.wind_speed_10m || [])[i],
            wind_gusts_10m: (H.wind_gusts_10m || [])[i],
            weathercode: (H.weathercode || [])[i],
            cloud_cover: (H.cloud_cover || [])[i],
            uv_index: (H.uv_index || [])[i],
          });
        }
        results.set(key, mapByTime);
      } catch (e) {
        console.warn('best-window: open-meteo fetch error', e);
      }
    }
    return results;
  }

  // Main exported function
  // Accept optional params: daysAhead (number) and timeChoice (string). If omitted, read from DOM.
  window.findBestWindow = async function(daysAheadParam, timeChoiceParam) {
    try {
    // Default to 1 day (tomorrow) when nothing is provided; prefer explicit param
    const daysAhead = Number((daysAheadParam !== undefined) ? daysAheadParam : 1);
    const timeChoice = (timeChoiceParam !== undefined) ? timeChoiceParam : (Array.from(document.getElementsByName('bestTime')).find(r => r.checked)?.value || 'morning');
      if (!window.lastStepped || !Array.isArray(window.lastStepped) || window.lastStepped.length === 0) {
        window.setNotice && window.setNotice(window.t ? window.t('select_gpx') : 'Select a GPX first', 'error');
        return;
      }

      // Candidate start times: for each day in [0..daysAhead] produce candidates spaced every 30 minutes through the chosen time span
      const now = new Date();
      const candidates = [];
      // compute route duration from segmented steps so candidate window length matches route duration
      const steps = window.lastStepped || [];
      const timeSteps = window.lastTimeSteps || steps.map(s=>s.time);
      const routeDurationMs = (timeSteps.length>0) ? (new Date(timeSteps[timeSteps.length-1]).getTime() - new Date(timeSteps[0]).getTime()) : (2*60*60*1000);
      // candidate spacing: 30 minutes
      const candidateSpacingMs = 30 * 60 * 1000;
      for (let d = 0; d <= daysAhead; d++) {
        // dayBase is the midnight of the day 'd' days from now
        const dayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 0, 0, 0, 0);
        let startHour=8, endHour=20;
        if (timeChoice === 'morning') { startHour=6; endHour=12; }
        else if (timeChoice === 'midday') { startHour=10; endHour=14; }
        else if (timeChoice === 'afternoon') { startHour=14; endHour=20; }
        else if (timeChoice === 'day') { startHour=6; endHour=20; }
        let windowStart = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), startHour, 0, 0);
        const windowEnd = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), endHour, 0, 0);
        // For day 0 (today) don't include times earlier than now
        if (d === 0 && windowStart.getTime() < now.getTime()) {
          // align start to the next candidateSpacingMs step from now
          const aligned = Math.ceil(now.getTime() / candidateSpacingMs) * candidateSpacingMs;
          windowStart = new Date(Math.max(windowStart.getTime(), aligned));
        }
        // push candidates spaced by candidateSpacingMs, but ensure at least one candidate per day
        let pushed = 0;
        for (let t = windowStart.getTime(); t + routeDurationMs <= windowEnd.getTime(); t += candidateSpacingMs) {
          candidates.push(new Date(t));
          pushed++;
        }
        if (pushed === 0) {
          // if no candidate fits (route longer than span), add windowStart as fallback
          candidates.push(new Date(windowStart.getTime()));
        }
      }

  // Limit total candidates to reasonable count (keep top 50 before scoring)
  const MAX_CANDIDATES = 50;
  const trimmedCandidates = candidates.slice(0, MAX_CANDIDATES);

  // Build sample set: for each candidate, sample every step (intervals defined by segmentation) and compute absolute times
      const samples = [];
      const stepsLocal = window.lastStepped || [];
      const timesLocal = window.lastTimeSteps || stepsLocal.map(s => s.time);
  if (!stepsLocal.length) { window.setNotice && window.setNotice(window.t ? window.t('best_no_data') : 'No route steps', 'error'); return; }
      for (let ci = 0; ci < trimmedCandidates.length; ci++) {
        const start = new Date(trimmedCandidates[ci]);
        const origStart = new Date(timesLocal[0]);
        const delta = start.getTime() - origStart.getTime();
        for (let si = 0; si < stepsLocal.length; si += SAMPLE_STEP) {
          const s = stepsLocal[si];
          const sampleTime = new Date(new Date(timesLocal[si]).getTime() + delta);
          samples.push({ lat: s.lat, lon: s.lon, time: sampleTime, candidateIndex: ci, stepIndex: si });
        }
      }

  // Determine selected provider (use UI setting apiSource when present). If compare mode is selected, use openmeteo as fallback.
  const selProv = (document.getElementById('apiSource')?.value || window.apiSource || 'openmeteo');
  const providerToUse = (String(selProv).toLowerCase() === 'compare') ? 'openmeteo' : selProv;

  // Cap total API calls: we'll group by rounded lat/lon and call one request per group
  const grouped = await fetchOpenMeteoForTimes(samples, providerToUse);

      // Score each candidate by averaging sampled step scores and collect summary metrics
      const candidateScores = new Array(trimmedCandidates.length).fill(0).map(() => ({ sum:0, count:0, precipSum:0, precipCount:0, probSum:0, tempSum:0, tempCount:0, maxGust:0 }));
      for (const s of samples) {
        const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
        const mapByTime = grouped.get(key);
        if (!mapByTime) continue;
        const rec = mapByTime[s.time.toISOString()];
        if (!rec) continue;
        const sc = scoreStep(rec);
        const cs = candidateScores[s.candidateIndex];
        cs.sum += sc;
        cs.count += 1;
        // aggregates
        const p = Number(rec.precipitation ?? 0);
        if (!Number.isNaN(p)) { cs.precipSum += p; cs.precipCount += 1; }
        const prob = Number(rec.precipitation_probability ?? 0);
        if (!Number.isNaN(prob)) { cs.probSum += prob; }
        const t = Number(rec.temperature ?? rec.temperature_2m ?? 0);
        if (!Number.isNaN(t)) { cs.tempSum += t; cs.tempCount += 1; }
        const g = Number(rec.wind_gusts_10m ?? rec.wind_speed_10m ?? 0);
        if (!Number.isNaN(g)) cs.maxGust = Math.max(cs.maxGust || 0, g);
      }

  const finalScores = candidateScores.map((c, idx) => ({
    idx,
    score: c.count ? c.sum / c.count : 0,
    avgPrecip: c.precipCount ? (c.precipSum / c.precipCount) : 0,
    avgProb: c.count ? (c.probSum / c.count) : 0,
    avgTemp: c.tempCount ? (c.tempSum / c.tempCount) : null,
    maxGust: c.maxGust || 0
  }));
  finalScores.sort((a,b) => b.score - a.score);
  // Keep up to top 12 candidates (we'll present up to 4 per row horizontally, max 3 rows)
  const topN = finalScores.slice(0,12);
  const best = topN[0];
      if (!best) {
        window.setNotice && window.setNotice(window.t ? window.t('best_no_data') : 'No data available for sampling', 'error');
        return;
      }

      const bestStart = trimmedCandidates[best.idx];
      const msg = (window.t ? window.t('best_result_message', { dt: bestStart.toLocaleString(), score: Math.round(best.score*100) }) : `Best window: ${bestStart.toLocaleString()} (score ${(best.score*100).toFixed(0)}%)`);
      window.setNotice && window.setNotice(msg, 'ok');

      // Show modal with top 3 choices if available
      const choices = topN.map(f => ({ start: trimmedCandidates[f.idx], score: f.score, avgPrecip: f.avgPrecip, avgProb: f.avgProb, avgTemp: f.avgTemp, maxGust: f.maxGust }));
      if (choices && choices.length) {
        try { window.showBestWindowChoices && window.showBestWindowChoices(choices, routeDurationMs); } catch(e){}
      }

      // Offer to set the route start to this datetime (kept for direct fallback)
      try {
        const dtEl = document.getElementById('datetimeRoute');
        if (dtEl) {
          const iso = bestStart.toISOString().substring(0,16);
          dtEl.value = iso;
          // Trigger reload
          if (typeof window.reloadFull === 'function') window.reloadFull();
        }
      } catch (e) { /* ignore */ }

      return { bestStart, score: best.score };
    } catch (e) {
      console.error('findBestWindow error', e);
      const errMsg = (window.t ? window.t('best_search_error') : 'Error searching windows') + (e && e.message ? (': ' + e.message) : '');
      window.setNotice && window.setNotice(errMsg, 'error');
      return null;
    }
  };
})();

// Modal helper placed outside closure so UI can call it if needed
window.showBestWindowChoices = function(choices, durationMs) {
  // remove existing modal
  const old = document.getElementById('bestWindowModal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'bestWindowModal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0,0,0,0.5)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = 30000;

  const box = document.createElement('div');
  box.style.background = '#fff';
  box.style.padding = '16px';
  box.style.borderRadius = '8px';
  box.style.minWidth = '280px';
  box.style.maxWidth = '90%';

  const title = document.createElement('h3');
  title.innerText = (window.t ? window.t('best_modal_title') : 'Mejores opciones');
  box.appendChild(title);

  const list = document.createElement('div');
  list.className = 'bw-list';

  choices.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'bw-row';
    const left = document.createElement('div');
    left.className = 'bw-left';
    const dt = new Date(c.start);
    const mins = Math.round(durationMs/60000);
    const durText = (window.t ? window.t('best_choice_duration', { mins }) : `Duraci\u00f3n aprox: ${mins} min`);
    // Determine a simple icon heuristic and return inline SVG markup (avoid emojis)
    function pickIconForChoice(ch) {
      const precip = Number(ch.avgPrecip || 0);
      const prob = Number(ch.avgProb || 0);
      const gust = Number(ch.maxGust || 0);
      const temp = ch.avgTemp != null ? Number(ch.avgTemp) : null;
      // Simple, small SVG icons (monochrome, adopt currentColor)
      const icons = {
        rain: {
          svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 18a3 3 0 0 1 0-6h.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13a4 4 0 0 1 4-4h1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 20l1.2-2M12 20l1.2-2M16 20l1.2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          label: (window.t ? window.t('weather_rain') : 'Rain')
        },
        wind: {
          svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-2.83-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12h9a2 2 0 1 1 0 4H4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          label: (window.t ? window.t('weather_wind') : 'Wind')
        },
        sunny: {
          svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          label: (window.t ? window.t('weather_sunny') : 'Sunny')
        },
        cold: {
          svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2v20M2 12h20" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.2"/></svg>`,
          label: (window.t ? window.t('weather_cold') : 'Cold')
        },
        partial: {
          svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 14a6 6 0 0 0 12 0 6 6 0 0 0-12 0z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 4v2M15 4v2" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          label: (window.t ? window.t('weather_partial') : 'Partial sun')
        }
      };
      if (precip >= 1 || prob >= 60) return icons.rain;
      if (gust >= 15) return icons.wind;
      if (temp != null && temp >= 25) return icons.sunny;
      if (temp != null && temp < 8) return icons.cold;
      return icons.partial;
    }
    const iconInfo = pickIconForChoice(c);
    const iconEl = document.createElement('div');
    iconEl.className = 'bw-icon';
    iconEl.setAttribute('role','img');
    iconEl.setAttribute('aria-label', iconInfo.label || 'weather');
    // Insert inline SVG (monochrome, inherits currentColor). Use innerHTML intentionally.
    iconEl.innerHTML = iconInfo.svg || '';
    left.innerHTML = `<div class="bw-dt"><strong>${dt.toLocaleString()}</strong></div><div class="bw-sub">${durText}</div>`;
    left.prepend(iconEl);

    const mid = document.createElement('div');
    mid.className = 'bw-mid';
    mid.innerHTML = `
      <div class="bw-metric">${window.t ? window.t('best_summary_avg_precip', { val: (c.avgPrecip||0).toFixed(1) }) : 'Precip: ' + (c.avgPrecip||0).toFixed(1)}</div>
      <div class="bw-metric">${window.t ? window.t('best_summary_avg_prob', { val: Math.round(c.avgProb||0) }) : 'Prob: ' + Math.round(c.avgProb||0) + '%'}</div>
      <div class="bw-metric">${window.t ? window.t('best_summary_max_gust', { val: (c.maxGust||0).toFixed(0) }) : 'Gust: ' + (c.maxGust||0).toFixed(0)}</div>
      <div class="bw-metric">${window.t ? window.t('best_summary_temp', { val: c.avgTemp != null ? (c.avgTemp.toFixed(1)) : '—' }) : 'Temp: ' + (c.avgTemp != null ? c.avgTemp.toFixed(1) : '—')}</div>
    `;

    const right = document.createElement('div');
    right.className = 'bw-right';
    const score = document.createElement('div');
    score.className = 'bw-score';
    score.innerText = `${Math.round(c.score*100)}%`;

    const btn = document.createElement('button');
    btn.className = 'bw-select';
    btn.title = (window.t ? window.t('best_choice_select') : 'Seleccionar');
    btn.innerText = '✓';
    btn.onclick = () => {
      const dtEl = document.getElementById('datetimeRoute');
      if (dtEl) dtEl.value = dt.toISOString().substring(0,16);
      if (typeof window.reloadFull === 'function') window.reloadFull();
      modal.remove();
    };

    right.appendChild(score);
    right.appendChild(btn);
    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(right);
    list.appendChild(row);
  });
  box.appendChild(list);

  const cancel = document.createElement('div');
  cancel.style.textAlign = 'right';
  cancel.style.marginTop = '8px';
  const cbtn = document.createElement('button');
  cbtn.innerText = (window.t ? window.t('best_choice_close') : 'Cerrar');
  cbtn.onclick = () => modal.remove();
  cancel.appendChild(cbtn);
  box.appendChild(cancel);

  modal.appendChild(box);
  document.body.appendChild(modal);
  return modal;
};

// Show a small configuration modal (choose days and time window), then execute search when user clicks Buscar
window.showBestWindowConfigModal = function() {
  // remove existing modal
  const old = document.getElementById('bestWindowConfigModal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'bestWindowConfigModal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = 30001;

  const box = document.createElement('div');
  box.style.background = '#fff';
  box.style.padding = '12px';
  box.style.borderRadius = '8px';
  box.style.minWidth = '260px';
  box.style.maxWidth = '92%';

  const title = document.createElement('h4');
  title.setAttribute('data-i18n', 'best_modal_title');
  title.innerText = (window.t ? window.t('best_modal_title') : 'Best options');
  box.appendChild(title);

  // Note: days selection is intentionally omitted from this modal. The search defaults to 1 day ahead (tomorrow).

  // Days select (0 = today, 1 = tomorrow, up to 7)
  const rowDays = document.createElement('div');
  rowDays.style.margin = '8px 0';
  const lblDays = document.createElement('label');
  lblDays.setAttribute('data-i18n', 'best_days_label');
  lblDays.innerText = (window.t ? window.t('best_days_label') : 'Days:');
  rowDays.appendChild(lblDays);
  const sel = document.createElement('select');
  sel.id = 'bw_cfg_days';
  for (let i = 0; i <= 7; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.setAttribute('data-i18n', i === 0 ? 'best_day_0' : (i === 1 ? 'best_day_1' : (i === 7 ? 'best_day_7' : 'best_day_' + i)));
    // fallback label
    o.text = (window.t ? window.t(o.getAttribute('data-i18n')) : (i === 0 ? 'Hoy' : (i === 1 ? 'Mañana' : String(i))));
    if (i === 1) o.selected = true;
    sel.appendChild(o);
  }
  rowDays.appendChild(sel);
  box.appendChild(rowDays);

  // Time radios
  const rowTime = document.createElement('div');
  rowTime.style.margin = '8px 0';
  const times = [ ['morning','best_morning'], ['midday','best_midday'], ['afternoon','best_afternoon'], ['day','best_full'] ];
  times.forEach(([val,key],i) => {
    const lab = document.createElement('label'); lab.style.marginRight='8px';
    const r = document.createElement('input'); r.type='radio'; r.name='bw_cfg_time'; r.value=val; if(i===0) r.checked=true;
    lab.appendChild(r);
    // text node should be translatable via data-i18n
    const span = document.createElement('span');
    span.setAttribute('data-i18n', key);
    span.innerText = (window.t ? window.t(key) : (key === 'best_morning' ? 'Morning' : (key === 'best_midday' ? 'Midday' : (key === 'best_afternoon' ? 'Afternoon' : 'Full day'))));
    lab.appendChild(document.createTextNode(' '));
    lab.appendChild(span);
    rowTime.appendChild(lab);
  });
  box.appendChild(rowTime);

  // Buttons
  const footer = document.createElement('div'); footer.style.display='flex'; footer.style.justifyContent='flex-end'; footer.style.gap='8px'; footer.style.marginTop='8px';
  const cancel = document.createElement('button'); cancel.setAttribute('data-i18n','best_choice_close'); cancel.innerText = (window.t?window.t('best_choice_close'):'Cancel'); cancel.onclick = ()=>modal.remove();
  const go = document.createElement('button'); go.setAttribute('data-i18n','best_find_button'); go.innerText = (window.t?window.t('best_find_button'):'Buscar'); go.style.background='#0b6297'; go.style.color='#fff'; go.style.border='none'; go.style.padding='8px 12px'; go.style.borderRadius='6px';
  go.onclick = async () => {
    // read values and call findBestWindow
    const days = Number(document.getElementById('bw_cfg_days').value || 0);
    const timeChoice = Array.from(document.getElementsByName('bw_cfg_time')).find(r=>r.checked)?.value || 'morning';
    // show searching notice
    window.setNotice && window.setNotice(window.t ? window.t('best_searching') : 'Searching...', 'warn');
    try {
      await window.findBestWindow(days, timeChoice);
    } catch(e) { console.error(e); }
    modal.remove();
  };
  footer.appendChild(cancel); footer.appendChild(go);
  box.appendChild(footer);

  modal.appendChild(box);
  document.body.appendChild(modal);
  return modal;
};
