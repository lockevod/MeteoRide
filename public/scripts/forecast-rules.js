/* Pure rules behind the forecast table: which values a provider answer holds for a step.

   A plain script on purpose, like watch-rules.js: the page loads it with a script tag
   and Node tests run it in a bare vm context. No DOM, no network, no clock; everything
   arrives as arguments. Values come back as the provider sent them, except OpenWeather
   wind, which is turned into km/h from the units the request asked for. Presentation
   conversions and daylight stay in processWeatherData.
*/
var cwForecastRules = (function () {
  'use strict';

  /** A provider time as epoch ms. */
  function parseProviderTime(value) {
    return (value instanceof Date ? value : new Date(value)).getTime();
  }

  /** Index of the entry closest to `targetMs`; ties keep the earlier one; -1 if none. */
  function nearestIndex(times, targetMs) {
    let best = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(parseProviderTime(times[i]) - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  // uv_index and precipitation_probability are often null in minutely_15 while hourly
  // has them (AROME merges them in from Open-Meteo), so those two fall back to hourly.
  const HOURLY_FALLBACK = { uv_index: true, precipitation_probability: true };

  function extractOpenMeteo(w, timeMs) {
    const hourly = w.hourly;
    const idx = nearestIndex(hourly.time, timeMs);

    let useMinutely = false;
    let minutelyIndex;
    const m = w.minutely_15;
    if (m && Array.isArray(m.time)) {
      const mi = nearestIndex(m.time, timeMs);
      const first = parseProviderTime(m.time[0]);
      const last = parseProviderTime(m.time[m.time.length - 1]);
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

  return { parseProviderTime, nearestIndex, extractStep, routeLine };
})();
