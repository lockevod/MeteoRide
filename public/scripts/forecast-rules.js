/* Pure rules behind the forecast table: which values a provider answer holds for a step.

   A plain script on purpose, like watch-rules.js: the page loads it with a script tag
   and Node tests run it in a bare vm context. No DOM, no network, no clock; everything
   arrives as arguments. Values come back as the provider sent them, except OpenWeather
   wind, which is turned into km/h from the units the request asked for. Presentation
   conversions and daylight stay in processWeatherData.
*/
var cwForecastRules = (function () {
  'use strict';

  // "2026-09-20T08:00" or "2026-09-20T08:00:30": a wall-clock time with no zone.
  const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

  /**
   * A provider time as epoch ms. Open-Meteo (timezone=auto) sends wall-clock times with
   * no zone and says which offset they are in; with that offset the device's zone plays
   * no part. Anything else, or no offset, is parsed as before.
   */
  function parseProviderTime(value, offsetSeconds) {
    if (typeof value === 'string' && Number.isFinite(offsetSeconds)) {
      const m = LOCAL_TIME.exec(value);
      if (m) {
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - offsetSeconds * 1000;
      }
    }
    return (value instanceof Date ? value : new Date(value)).getTime();
  }

  /** Index of the entry closest to `targetMs`; ties keep the earlier one; -1 if none.
   *  `offsetSeconds` is passed on to parseProviderTime. */
  function nearestIndex(times, targetMs, offsetSeconds) {
    let best = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(parseProviderTime(times[i], offsetSeconds) - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  // uv_index and precipitation_probability are often null in minutely_15 while hourly
  // has them (AROME merges them in from Open-Meteo), so those two fall back to hourly.
  const HOURLY_FALLBACK = { uv_index: true, precipitation_probability: true };

  function extractOpenMeteo(w, timeMs) {
    const hourly = w.hourly;
    const offset = w.utc_offset_seconds;
    const idx = nearestIndex(hourly.time, timeMs, offset);

    let useMinutely = false;
    let minutelyIndex;
    const m = w.minutely_15;
    if (m && Array.isArray(m.time)) {
      const mi = nearestIndex(m.time, timeMs, offset);
      const first = parseProviderTime(m.time[0], offset);
      const last = parseProviderTime(m.time[m.time.length - 1], offset);
      if (timeMs >= first && timeMs <= last && mi !== -1) {
        useMinutely = true;
        minutelyIndex = mi;
      }
    }
    if (idx === -1 && !useMinutely) return null;

    const mIdx = useMinutely ? minutelyIndex : -1;

    const fromHourly = (name) => {
      const arr = hourly[name];
      return Array.isArray(arr) && arr.length > idx ? arr[idx] : null;
    };
    const get = (name) => {
      const arr = useMinutely ? m[name] : null;
      if (arr && Array.isArray(arr) && arr.length > mIdx
          && (!HOURLY_FALLBACK[name] || arr[mIdx] != null)) {
        return arr[mIdx];
      }
      return fromHourly(name);
    };

    return {
      source: useMinutely ? 'minutely_15' : 'hourly',
      useMinutely,
      minutelyIndex,
      temp: get('temperature_2m'),
      wind: get('wind_speed_10m'),            // km/h, as Open-Meteo sends it
      gust: get('wind_gusts_10m'),
      windDir: get('winddirection_10m'),
      humidity: get('relative_humidity_2m'),
      precipitation: get('precipitation'),
      precipProb: get('precipitation_probability'),
      weatherCode: get('weathercode'),
      uvIndex: get('uv_index'),
      isDay: get('is_day'),
      cloudCover: Array.isArray(hourly.cloud_cover) ? hourly.cloud_cover[idx] : undefined,
    };
  }

  function extractOpenWeather(w, timeMs, payloadUnits) {
    const closestByDt = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return -1;
      let best = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const diff = Math.abs(Number(arr[i] && arr[i].dt) * 1000 - timeMs);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      return best;
    };
    const useHourly = Array.isArray(w.hourly) && w.hourly.length > 0;
    const hi = useHourly ? closestByDt(w.hourly) : -1;
    const di = (!useHourly || hi === -1) ? closestByDt(w.daily) : -1;
    const hourly = (useHourly && hi !== -1) ? w.hourly[hi] : null;
    const daily = (!hourly && Array.isArray(w.daily) && di !== -1) ? w.daily[di] : null;

    const factor = payloadUnits === 'imperial' ? 1.60934 : 3.6;   // mph or m/s → km/h
    const toKmh = (v) => (Number(v) || 0) * factor;
    const code = (e) => (Array.isArray(e.weather) && e.weather[0] ? e.weather[0].id : null);
    const currentUv = w.current ? w.current.uvi : undefined;

    if (hourly) {
      return {
        source: 'hourly',
        temp: hourly.temp,
        wind: toKmh(hourly.wind_speed),
        gust: hourly.wind_gust != null ? toKmh(hourly.wind_gust) : null,
        windDir: Number(hourly.wind_deg || 0),
        humidity: hourly.humidity,
        precipitation: Number((hourly.rain && hourly.rain['1h']) ?? 0) + Number((hourly.snow && hourly.snow['1h']) ?? 0),
        precipProb: (Number(hourly.pop) || 0) * 100,
        weatherCode: code(hourly),
        uvIndex: hourly.uvi ?? currentUv ?? null,
        cloudCover: hourly.clouds ?? hourly.cloud_cover ?? null,
      };
    }
    if (daily) {
      return {
        source: 'daily',
        temp: (daily.temp && (daily.temp.day ?? daily.temp.max ?? daily.temp.min)) || null,
        wind: toKmh(daily.wind_speed),
        gust: daily.wind_gust != null ? toKmh(daily.wind_gust) : null,
        windDir: Number(daily.wind_deg || 0),
        humidity: daily.humidity,
        precipitation: Number(daily.rain ?? 0) + Number(daily.snow ?? 0),
        precipProb: (Number(daily.pop) || 0) * 100,
        weatherCode: code(daily),
        uvIndex: daily.uvi ?? currentUv ?? null,
        cloudCover: daily.clouds,
      };
    }
    return null;
  }

  /**
   * The values a provider answer holds for one step, or null when it holds none.
   * `payloadUnits` is the unit system the request asked for ('metric' | 'imperial');
   * only OpenWeather needs it.
   */
  function extractStep(payload, { provider, time, payloadUnits } = {}) {
    if (!payload) return null;
    const timeMs = parseProviderTime(time);
    if (provider === 'openmeteo' || provider === 'aromehd') {
      if (!payload.hourly || !payload.hourly.time) return null;
      return extractOpenMeteo(payload, timeMs);
    }
    if (provider === 'openweather') return extractOpenWeather(payload, timeMs, payloadUnits);
    return null;
  }

  /**
   * The line a route's forecast follows: the first LineString with at least two valid
   * points, or the first MultiLineString flattened in order. Null when there is none.
   * GeoJSON pairs are [lon, lat(, ele)]; the result is [{ lat, lon }].
   */
  function routeLine(geojson) {
    const features = geojson && Array.isArray(geojson.features) ? geojson.features : [];
    const valid = (c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
    for (const feature of features) {
      const g = feature && feature.geometry;
      if (!g || !Array.isArray(g.coordinates)) continue;
      let pairs = null;
      if (g.type === 'LineString') pairs = g.coordinates;
      else if (g.type === 'MultiLineString') pairs = [].concat(...g.coordinates);
      if (!pairs) continue;
      const points = pairs.filter(valid).map((c) => ({ lat: Number(c[1]), lon: Number(c[0]) }));
      if (points.length >= 2) return points;
    }
    return null;
  }

  /**
   * AROME HD answers lack some variables the standard Open-Meteo model has. This fills
   * them in, in place, from the standard answer for the same place and returns the AROME
   * answer. Every standard series is laid on AROME's own hours: a value is only taken for
   * an hour both answers have.
   */
  function mergeAromeWithStandard(json, std) {
    const stdH = (std && std.hourly) || {};
    const mergeKeys = ['precipitation_probability', 'weathercode', 'cloud_cover', 'uv_index', 'is_day'];
    json.hourly = json.hourly || {};

    const aromeTimes = Array.isArray(json.hourly.time) ? json.hourly.time : null;
    const stdTimes = Array.isArray(stdH.time) ? stdH.time : null;
    let stdIndexByTime = null;
    if (aromeTimes && stdTimes) {
      stdIndexByTime = Object.create(null);
      for (let si = 0; si < stdTimes.length; si++) stdIndexByTime[String(stdTimes[si])] = si;
    }
    // A standard series on AROME's hours. With no AROME time axis, AROME takes the
    // standard one below, so the series is kept as it is. With no standard time axis
    // there is nothing to match on, and the series is left out rather than copied by
    // position onto hours it does not belong to.
    const onAromeHours = (series) => {
      if (!aromeTimes) return series.slice();
      if (!stdIndexByTime) return null;
      return aromeTimes.map((t) => {
        const si = stdIndexByTime[String(t)];
        return si != null && series[si] != null ? series[si] : null;
      });
    };

    mergeKeys.forEach((k) => {
      const aVal = json.hourly[k];
      // Accept common variants in the standard payload
      let sVal = stdH[k];
      if (!Array.isArray(sVal)) {
        if (k === 'uv_index') {
          sVal = stdH.uv_index || stdH.uvindex || stdH.uvi || stdH.uv || null;
          if (!Array.isArray(sVal) && Array.isArray(stdH.time) && std && typeof std.current === 'object'
              && std.current.uvi != null) {
            const v = Number(std.current.uvi);
            if (!Number.isNaN(v)) sVal = Array(stdH.time.length).fill(v);
          }
        } else if (k === 'cloud_cover') {
          sVal = stdH.cloud_cover || stdH.cloudcover || null;
        } else if (k === 'precipitation_probability') {
          sVal = stdH.precipitation_probability || stdH.pop || null;
        }
      }
      if (!Array.isArray(aVal) && Array.isArray(sVal)) {
        // AROME lacks the array: take the standard one on AROME's hours
        const aligned = onAromeHours(sVal);
        if (aligned) json.hourly[k] = aligned;
      } else if (Array.isArray(aVal) && Array.isArray(sVal)) {
        const merged = aVal.slice();
        if (stdIndexByTime) {
          for (let i = 0; i < aromeTimes.length; i++) {
            if (merged[i] == null) {
              const si = stdIndexByTime[String(aromeTimes[i])];
              if (si != null && sVal[si] != null) merged[i] = sVal[si];
            }
          }
        } else if (!aromeTimes) {
          // AROME has no hours of its own and takes the standard ones below
          for (let mi = 0; mi < sVal.length; mi++) {
            if (merged[mi] == null && sVal[mi] != null) merged[mi] = sVal[mi];
          }
        }
        json.hourly[k] = merged;
      }
    });
    if (!Array.isArray(json.hourly.time) && Array.isArray(stdH.time)) json.hourly.time = stdH.time;
    // minutely_15 carries its own time axis, so it is taken whole
    if ((!json.minutely_15 || Object.keys(json.minutely_15 || {}).length === 0)
        && std && std.minutely_15 && typeof std.minutely_15 === 'object') {
      json.minutely_15 = std.minutely_15;
    }
    // Probability of precipitation under other names, as a fraction or a percentage
    if (!Array.isArray(json.hourly.precipitation_probability)) {
      const candNames = ['precipitation_probability', 'precipitationProbability', 'precip_prob', 'pop', 'probability_of_precipitation'];
      for (const n of candNames) {
        if (Array.isArray(stdH[n])) {
          const arr = stdH[n].slice();
          const nums = arr.filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
          const max = nums.length ? Math.max(...nums) : null;
          const normalized = (max != null && max <= 1)
            ? arr.map((v) => (v == null ? null : Number(v) * 100))
            : arr;
          const aligned = onAromeHours(normalized);
          if (aligned) json.hourly.precipitation_probability = aligned;
          break;
        }
      }
    }
    return json;
  }

  /* ---------- what a computation produced, and what to say about it ---------- */

  /**
   * Steps the table can show: the answer holds a temperature or a wind for the step's
   * time. A step served from cache counts; an HTTP 200 with nothing in it does not.
   * MeteoBlue answers are not extracted here (spec §2), so any MeteoBlue answer counts.
   */
  function usableSteps(steps) {
    let n = 0;
    for (const s of steps || []) {
      if (!s || s.payload == null) continue;
      if (s.provider === 'meteoblue') { n++; continue; }
      const r = extractStep(s.payload, { provider: s.provider, time: s.time, payloadUnits: s.payloadUnits });
      if (r && (Number.isFinite(r.temp) || Number.isFinite(r.wind))) n++;
    }
    return n;
  }

  function formatAge(ms) {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.round((ms % 3600000) / 60000);
    return hours ? `${hours} h ${mins} min` : `${mins} min`;
  }

  /**
   * The notice a published computation deserves, or null for none. Returns
   * `{ parts: [[i18nKey, params], ...], type }`; the page joins the translated parts.
   *
   * Order: an empty table whose requests failed says why; otherwise data read from the
   * cache without connection says how old it is; otherwise the provider policy that
   * used to live at the end of fetchWeatherForSteps, quiet or detailed (`noticeAll`).
   */
  function decideNotice(outcome, { noticeAll } = {}) {
    const o = outcome || {};
    const pv = o.providers || {};
    const mb = pv.meteoblue || {};
    const ow = pv.openweather || {};
    const om = pv.openmeteo || {};
    const say = (type, ...parts) => ({ parts, type });

    if (!o.usableSteps && o.transportFailures > 0) {
      if (o.offline) return say('warn', ['offline_no_data', {}]);
      if (o.lastFailStatus === '401' || o.lastFailStatus === '403') return say('warn', ['provider_rejected', {}]);
      return say('warn', ['provider_unreachable', {}]);
    }
    if (o.staleAgeMs > 0) return say('warn', ['offline_stale_forecast', { age: formatAge(o.staleAgeMs) }]);

    const keyed = o.requestedProvider === 'openweather' ? 'OpenWeather' : 'MeteoBlue';
    const named = (flag) => (ow[flag] ? 'OpenWeather' : mb[flag] ? 'MeteoBlue' : null);
    const httpFrom = ow.httpError ? ow : mb.httpError ? mb : om.httpError ? om : null;
    const httpName = ow.httpError ? 'OpenWeather' : mb.httpError ? 'MeteoBlue' : 'Open-Meteo';
    const httpParams = () => ({ prov: httpName, status: httpFrom.httpStatus != null ? String(httpFrom.httpStatus) : '…' });
    const short = ['fallback_short', {}];
    const fallbackError = !!o.usedFallbackError;

    if (noticeAll) {
      if (o.beyondHorizon) return say('warn', ['horizon_exceeded', { days: o.openMeteoMaxDays }]);
      if (o.usedFallbackHorizon) return say('warn', ['fallback_to_openmeteo', { days: o.horizonDays }]);
    }
    if (o.missingKey) return say('error', ['provider_key_missing', { prov: keyed }], short);
    if (named('invalidKey') && fallbackError) return say('error', ['provider_key_invalid', { prov: named('invalidKey') }], short);
    if (named('quota') && fallbackError) return say('error', ['provider_quota_exceeded', { prov: named('quota') }], short);
    if (httpFrom && fallbackError) return say('error', ['provider_http_error', httpParams()], short);
    if (noticeAll) {
      if (named('invalidKey')) return say('error', ['provider_key_invalid', { prov: named('invalidKey') }]);
      if (named('quota')) return say('error', ['provider_quota_exceeded', { prov: named('quota') }]);
      if (httpFrom) return say('error', ['provider_http_error', httpParams()]);
    }
    if (fallbackError) return say('warn', ['fallback_due_error', { prov: keyed }]);
    return null;
  }

  function alertId(a) {
    return `${a.sender_name}_${a.event}_${a.start}_${a.end}`;
  }

  /**
   * Official warnings that overlap [fromSec, toSec], each once. OpenWeather sends unix
   * seconds; a missing start counts as always, a missing end as never ending.
   */
  function alertsInWindow(alerts, fromSec, toSec) {
    const seen = new Set();
    const out = [];
    for (const a of alerts || []) {
      if (!a) continue;
      const start = Number(a.start) || 0;
      const end = Number(a.end) || Infinity;
      if (start > toSec || end < fromSec) continue;
      const id = alertId(a);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(a);
    }
    return out;
  }

  return {
    parseProviderTime, nearestIndex, extractStep, routeLine, mergeAromeWithStandard,
    usableSteps, decideNotice, alertId, alertsInWindow,
  };
})();
