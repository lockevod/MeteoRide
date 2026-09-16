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

  // uv_index, precipitation_probability and weathercode are often null in minutely_15 while
  // hourly has them (AROME HD sends all three null there and merges them in from Open-Meteo),
  // so those fall back to hourly.
  const HOURLY_FALLBACK = { uv_index: true, precipitation_probability: true, weathercode: true };

  const QUARTER_MS = 15 * 60000;

  // `maxGapMs` (replay): the nearest hourly entry must be at most that far, and a quarter is
  // read only within fifteen minutes; otherwise there is no data. Without it, as live.
  function extractOpenMeteo(w, timeMs, maxGapMs) {
    const hourly = w.hourly;
    const offset = w.utc_offset_seconds;
    const idx = nearestIndex(hourly.time, timeMs, offset);
    const gap = (times, i) => Math.abs(parseProviderTime(times[i], offset) - timeMs);
    if (maxGapMs != null && (idx === -1 || gap(hourly.time, idx) > maxGapMs)) return null;

    let useMinutely = false;
    let minutelyIndex;
    const m = w.minutely_15;
    if (m && Array.isArray(m.time)) {
      const mi = nearestIndex(m.time, timeMs, offset);
      const first = parseProviderTime(m.time[0], offset);
      const last = parseProviderTime(m.time[m.time.length - 1], offset);
      const inRange = maxGapMs != null ? mi !== -1 && gap(m.time, mi) <= QUARTER_MS : timeMs >= first && timeMs <= last;
      if (inRange && mi !== -1) {
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
    // Precipitation is the hour being ridden, (H, H+60 min], H the step's time floored to the hour on
    // the answer's own wall clock. From minutely_15, the quarters labelled H+15 … H+60 (each the 15
    // minutes before its label); with any of them missing or null, or beyond the quarters, the hourly
    // entry labelled H+60 (the hour before its label), never the nearest one. No such entry: no value.
    const rideHourRain = () => {
      const HOUR = 4 * QUARTER_MS;
      const offMs = Number.isFinite(offset) ? offset * 1000 : -new Date(timeMs).getTimezoneOffset() * 60000;
      const H = Math.floor((timeMs + offMs) / HOUR) * HOUR - offMs;
      const labelled = (times, ms) => times.findIndex((t) => parseProviderTime(t, offset) === ms);
      const hi = labelled(hourly.time, H + HOUR);
      const ofHour = hi !== -1 && Array.isArray(hourly.precipitation) ? (hourly.precipitation[hi] ?? null) : null;
      if (!useMinutely || !Array.isArray(m.precipitation)) return ofHour;
      let sum = 0;
      for (let q = 1; q <= 4; q++) {
        const qi = labelled(m.time, H + q * QUARTER_MS);
        if (qi === -1 || m.precipitation[qi] == null) return ofHour;
        sum += Number(m.precipitation[qi]);
      }
      return sum;
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
      precipitation: rideHourRain(),
      precipProb: get('precipitation_probability'),
      weatherCode: get('weathercode'),
      uvIndex: get('uv_index'),
      isDay: get('is_day'),
      cloudCover: Array.isArray(hourly.cloud_cover) ? hourly.cloud_cover[idx] : undefined,
    };
  }

  function extractOpenWeather(w, timeMs, payloadUnits, maxGapMs, allowDaily) {
    // `maxDiff` matters for hourly only: beyond an hour from the closest slot the data
    // is stale enough to prefer daily (or nothing) over reading a distant hour as if it
    // were now. Daily entries are a day apart by nature, so they keep no such cap.
    const closestByDt = (arr, maxDiff = Infinity) => {
      if (!Array.isArray(arr) || !arr.length) return -1;
      let best = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const diff = Math.abs(Number(arr[i] && arr[i].dt) * 1000 - timeMs);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      return bestDiff <= maxDiff ? best : -1;
    };
    // Daily entries sit at local noon, a day apart. Picking the one nearest in raw UTC
    // `dt` ties (or misses) right at a local-midnight step, because that distance
    // ignores the location's own offset. Match on local calendar date instead; fall
    // back to nearest `dt` only when the offset itself is missing.
    const localDateOf = (ms, offsetSeconds) => new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 10);
    const closestByLocalDate = (arr, offsetSeconds) => {
      if (!Array.isArray(arr) || !arr.length) return -1;
      const stepDate = localDateOf(timeMs, offsetSeconds);
      return arr.findIndex((e) => e && localDateOf(Number(e.dt) * 1000, offsetSeconds) === stepDate);
    };
    const useHourly = Array.isArray(w.hourly) && w.hourly.length > 0;
    const hi = useHourly ? closestByDt(w.hourly, maxGapMs != null ? maxGapMs : 3600000) : -1;
    const di = allowDaily && (!useHourly || hi === -1)
      ? (typeof w.timezone_offset === 'number' ? closestByLocalDate(w.daily, w.timezone_offset) : closestByDt(w.daily))
      : -1;
    const hourly = (useHourly && hi !== -1) ? w.hourly[hi] : null;
    const daily = (!hourly && Array.isArray(w.daily) && di !== -1) ? w.daily[di] : null;

    const factor = payloadUnits === 'imperial' ? 1.60934 : 3.6;   // mph or m/s → km/h
    const toKmh = (v) => (Number(v) || 0) * factor;
    const code = (e) => (Array.isArray(e.weather) && e.weather[0] ? e.weather[0].id : null);
    const currentUv = w.current ? w.current.uvi : undefined;

    // Precipitation, unlike every other field, is the hour being ridden, (H, H+60 min], H the
    // step's time floored to the hour on the answer's own wall clock — the same window
    // extractOpenMeteo reads, because docs.openweather.co.uk/api/hourly-forecast documents this
    // vendor's own `rain.1h`/`dt` pair as "Rain volume for last hour" ending at `dt`. The entry
    // read for every other field (`hourly`, nearest by raw `dt`) is not this one in general; no
    // H+60 entry in the answer, or one further than `maxGapMs`, leaves precipitation alone with
    // no value, never a different hour's.
    const rideHourPrecip = () => {
      if (!useHourly) return null;
      const HOUR = 3600000;
      const offMs = typeof w.timezone_offset === 'number' ? w.timezone_offset * 1000 : -new Date(timeMs).getTimezoneOffset() * 60000;
      const target = Math.floor((timeMs + offMs) / HOUR) * HOUR - offMs + HOUR;
      if (Math.abs(target - timeMs) > (maxGapMs != null ? maxGapMs : HOUR)) return null;
      const pi = w.hourly.findIndex((e) => e && Number(e.dt) * 1000 === target);
      if (pi === -1) return null;
      const e = w.hourly[pi];
      return Number((e.rain && e.rain['1h']) ?? 0) + Number((e.snow && e.snow['1h']) ?? 0);
    };

    if (hourly) {
      return {
        source: 'hourly',
        temp: hourly.temp,
        wind: toKmh(hourly.wind_speed),
        gust: hourly.wind_gust != null ? toKmh(hourly.wind_gust) : null,
        windDir: Number(hourly.wind_deg || 0),
        humidity: hourly.humidity,
        precipitation: rideHourPrecip(),
        precipProb: (Number(hourly.pop) || 0) * 100,
        weatherCode: code(hourly),
        uvIndex: hourly.uvi ?? currentUv ?? null,
        cloudCover: hourly.clouds ?? hourly.cloud_cover ?? null,
      };
    }
    if (daily) {
      return {
        source: 'daily',
        temp: daily.temp ? (daily.temp.day ?? daily.temp.max ?? daily.temp.min ?? null) : null,
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
   *
   * Live, it is called with neither of the last two. Replaying a prepared snapshot passes
   * `maxGapMs` (an hourly entry further than that is no data; a quarter of minutely_15 counts
   * only within fifteen minutes) and `allowDaily: false` (OpenWeather never reads a day).
   */
  function extractStep(payload, { provider, time, payloadUnits, maxGapMs, allowDaily = true } = {}) {
    if (!payload) return null;
    const timeMs = parseProviderTime(time);
    if (provider === 'openmeteo' || provider === 'aromehd') {
      if (!payload.hourly || !payload.hourly.time) return null;
      return extractOpenMeteo(payload, timeMs, maxGapMs);
    }
    if (provider === 'openweather') return extractOpenWeather(payload, timeMs, payloadUnits, maxGapMs, allowDaily);
    return null;
  }

  /* ---------- the start time and a prepared snapshot ---------- */

  const HOUR_MS = 3600000;
  // How far the real start may be from the one a snapshot was prepared for (spec §3).
  const PREPARED_MARGIN_MS = 3 * HOUR_MS;
  // How a replay, and the coverage of preparing, read a stored answer (spec §4.4).
  const REPLAY = { maxGapMs: HOUR_MS, allowDaily: false };

  /**
   * The start a computation uses: the time chosen, or now rounded up when that has passed or
   * is not a time. `roundUp` is passed in (local quarter hours) so this stays free of a clock
   * and a zone.
   */
  function effectiveStart(nowMs, fieldMs, roundUp) {
    const earliest = roundUp(nowMs);
    return Number.isFinite(fieldMs) ? Math.max(earliest, fieldMs) : earliest;
  }

  /**
   * A copy of a snapshot moved by `diffMs`: every step's time and the start. Answers are kept.
   * Shallow: the steps and the settings are new objects, but every payload, the alerts and the
   * outcome are the stored ones, shared with the input. Replace them, never change them in place.
   */
  function retime(snapshot, diffMs) {
    return {
      ...snapshot,
      settings: { ...snapshot.settings, start: snapshot.settings.start + diffMs },
      steps: snapshot.steps.map((s) => ({ ...s, time: new Date(parseProviderTime(s.time) + diffMs) })),
      origin: 'prepared',
    };
  }

  const hasData = (r) => !!r && (Number.isFinite(r.temp) || Number.isFinite(r.wind));

  /**
   * How many steps of a snapshot a replay can show whatever the start within the margin: a step
   * is covered when every start from three hours before to three after, in quarter hours, still
   * reads a temperature or a wind in replay mode.
   */
  function preparedCoverage(snapshot) {
    const steps = (snapshot && snapshot.steps) || [];
    let covered = 0;
    for (const s of steps) {
      let ok = true;
      for (let d = -PREPARED_MARGIN_MS; ok && d <= PREPARED_MARGIN_MS; d += QUARTER_MS) {
        ok = hasData(extractStep(s.payload,
          { provider: s.provider, time: parseProviderTime(s.time) + d, payloadUnits: s.payloadUnits, ...REPLAY }));
      }
      if (ok) covered++;
    }
    return { covered, total: steps.length };
  }

  /** A prepared record can stand in for the route confirmed: same route, start within the margin.
   *  The route is the same only by a fingerprint string on both sides; two missing ones are not. */
  function usablePrepared(record, { fingerprint, startMs } = {}) {
    const snap = record && record.snapshot;
    return !!(snap && snap.route && snap.settings && typeof fingerprint === 'string'
      && snap.route.fingerprint === fingerprint
      && Math.abs(startMs - snap.settings.start) <= PREPARED_MARGIN_MS);
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
   */
  function usableSteps(steps) {
    let n = 0;
    for (const s of steps || []) {
      if (!s || s.payload == null) continue;
      const r = extractStep(s.payload, { provider: s.provider, time: s.time, payloadUnits: s.payloadUnits });
      if (r && (Number.isFinite(r.temp) || Number.isFinite(r.wind))) n++;
    }
    return n;
  }

  // Whole minutes, floored from the total, so 1 h 59 min 40 s never reads "1 h 60 min". An age that
  // is not a number (no clock passed in) reads as none rather than "NaN min".
  function formatAge(ms) {
    const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60000) : 0;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return hours ? `${hours} h ${mins} min` : `${mins} min`;
  }

  /**
   * The notice a published computation deserves, or null for none. Returns
   * `{ parts: [[i18nKey, params], ...], type }`; the page joins the translated parts.
   *
   * Order: an empty table whose requests failed says why; otherwise a replayed prepared
   * snapshot says how old it is (`now − preparedAt`) and for what start it was prepared
   * (`preparedFor`, as local HH:MM); otherwise data read from the cache without connection
   * says how old it is; otherwise the provider policy that used to live at the end of
   * fetchWeatherForSteps, quiet or detailed (`noticeAll`).
   */
  function decideNotice(outcome, { noticeAll, origin, preparedAt, preparedFor, now } = {}) {
    const o = outcome || {};
    const pv = o.providers || {};
    const ow = pv.openweather || {};
    const om = pv.openmeteo || {};
    const say = (type, ...parts) => ({ parts, type });

    if (!o.usableSteps && o.transportFailures > 0) {
      if (o.offline) return say('warn', ['offline_no_data', {}]);
      if (o.lastFailStatus === '401' || o.lastFailStatus === '403') return say('warn', ['provider_rejected', {}]);
      return say('warn', ['provider_unreachable', {}]);
    }
    if (origin === 'prepared') {
      const d = new Date(preparedFor);
      const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return say('warn', ['prepared_replayed', { age: formatAge(Math.max(0, now - preparedAt)), at }]);
    }
    if (o.staleAgeMs > 0) return say('warn', ['offline_stale_forecast', { age: formatAge(o.staleAgeMs) }]);

    // OpenWeather is the only provider left that needs a key, so missingKey never fires for another one.
    const keyed = 'OpenWeather';
    const short = ['fallback_short', {}];
    // The missing key, said once, by the table and by a date comparison: both asked Open-Meteo instead.
    const keyParts = o.missingKey ? [['provider_key_missing', { prov: keyed }], short] : [];

    // A comparison names every provider whose row a failed request left with a gap (`failedProviders`,
    // id → { status, code }): OpenWeather's key (`invalid_key`) and quota (`quota`) as the table names
    // them, another HTTP status as such, and anything else ('network', 'body') as not responding.
    // Without connection the failure is not the provider's, so it is not named.
    const failed = Object.entries(o.failedProviders || {});
    if (failed.length && !o.offline) {
      const names = { openmeteo: 'Open-Meteo', openweather: 'OpenWeather', aromehd: 'AROME-HD' };
      return say('error', ...keyParts, ...failed.map(([id, { status, code }]) => {
        const prov = names[id] || id;
        if (code === 'invalid_key') return ['provider_key_invalid', { prov }];
        if (code === 'quota') return ['provider_quota_exceeded', { prov }];
        return /^\d+$/.test(status) ? ['provider_http_error', { prov, status }] : ['provider_not_responding', { prov }];
      }));
    }
    const named = (flag) => (ow[flag] ? 'OpenWeather' : null);
    const httpFrom = ow.httpError ? ow : om.httpError ? om : null;
    const httpName = ow.httpError ? 'OpenWeather' : 'Open-Meteo';
    const httpParams = () => ({ prov: httpName, status: httpFrom.httpStatus != null ? String(httpFrom.httpStatus) : '…' });
    const fallbackError = !!o.usedFallbackError;

    if (noticeAll) {
      if (o.beyondHorizon) return say('warn', ['horizon_exceeded', { days: o.openMeteoMaxDays }]);
      if (o.usedFallbackHorizon) return say('warn', ['fallback_to_openmeteo', { days: o.horizonDays }]);
    }
    if (o.missingKey) return say('error', ...keyParts);
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

  /* ---------- routes: identity and names ---------- */

  /**
   * What makes two route texts the same route: the length and a 32-bit FNV-1a over the
   * UTF-16 code units of the exact text, as `${length}:${hex8}`.
   */
  function fingerprint(text) {
    const s = String(text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${s.length}:${h.toString(16).padStart(8, '0')}`;
  }

  /**
   * A snapshot may reach the screen only while it belongs to the confirmed route and to
   * the latest computation launched. Without both identities it never does.
   */
  function shouldPublish(snapshot, state) {
    if (!snapshot || !state) return false;
    const { requestId, computationId } = snapshot;
    return Number.isInteger(requestId) && Number.isInteger(computationId)
      && requestId === state.confirmedRequestId && computationId === state.lastComputationId;
  }

  /**
   * A comparison may reach the screen only while it still compares the snapshot there: its
   * route is the confirmed one, its computation is both the latest launched and the one
   * published, and no comparison was launched after it. Without all three identities it never does.
   */
  function shouldPublishComparison(run, state) {
    if (!run || !state) return false;
    const { requestId, computationId, comparisonId } = run;
    return Number.isInteger(requestId) && Number.isInteger(computationId) && Number.isInteger(comparisonId)
      && requestId === state.confirmedRequestId
      && computationId === state.lastComputationId && computationId === state.publishedComputationId
      && comparisonId === state.lastComparisonId;
  }

  /**
   * The name an imported route is stored under. Walks `name`, `base (2)ext`,
   * `base (3)ext`… and takes the first that is free, or the first held by the same
   * content, which is then replaced. A suffix already in `name` is not interpreted.
   * An old record carries no fingerprint, so its content is unknown and it is never
   * replaced: the same name and size in bytes can still be a different route.
   * The part before the extension never passes 64 characters: once a suffix is added,
   * the base gives up exactly the suffix's length, which the suffix itself never loses.
   * Trimmed by Unicode code point, not UTF-16 code unit, so a base ending in an emoji or
   * another character outside the Basic Multilingual Plane never gets its surrogate pair
   * split into one lone, unpaired unit.
   * A collision on a long name that an earlier version stored without trimming keeps its base
   * whole, which is a name this walk never builds: a record holding it with the same content is
   * claimed by fingerprint too and moves to the bounded name, rather than being kept twice.
   */
  function uniqueRouteName(records, { name, fingerprint: fp }) {
    const m = /\.(gpx|kml)$/i.exec(name);
    const ext = m ? m[0] : '';
    const base = m ? name.slice(0, -ext.length) : name;
    const same = (r) => !!r.fingerprint && r.fingerprint === fp;
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? '' : ` (${n})`;
      const trimmedBase = suffix ? Array.from(base).slice(0, Math.max(0, 64 - suffix.length)).join('') : base;
      const candidate = `${trimmedBase}${suffix}${ext}`;
      const taken = (records || []).filter((r) => r && r.name === candidate);
      if (!taken.length) {
        // Before the trimming above, the suffix was added to the whole base, so a collision on a
        // long name was stored with its base intact — a name this walk never builds now. Without
        // this, the same route reimported finds the shortened candidate free and is kept a second
        // time. Claimed by fingerprint, like any other record, and moved to the bounded name.
        const legacy = trimmedBase === base
          ? null
          : (records || []).find((r) => r && r.name === `${base}${suffix}${ext}` && same(r));
        return { name: candidate, replaceId: legacy ? legacy.id : null };
      }
      const match = taken.find(same);
      if (match) return { name: candidate, replaceId: match.id };
    }
  }

  return {
    parseProviderTime, nearestIndex, extractStep, routeLine, mergeAromeWithStandard,
    effectiveStart, retime, preparedCoverage, usablePrepared, REPLAY,
    usableSteps, decideNotice, alertId, alertsInWindow,
    fingerprint, shouldPublish, shouldPublishComparison, uniqueRouteName,
  };
})();
