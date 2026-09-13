/* Rules for the ride watch: what counts as "the weather changed" for a planned route.

   A plain script on purpose. It runs in two places that share nothing: the web view,
   which seeds the baseline when a forecast is computed, and the background runner,
   which is neither a browser nor Node and cannot load modules. The mobile build
   concatenates this file in front of mobile/runners/watch.js; the page loads it with
   a script tag. Everything is pure and time is passed in, so the same logic can be
   tested in Node without either environment.

   Units are fixed: millimetres per hour and km/h, whatever the user sees in the
   table. The baseline and every later check come from the same Open-Meteo request,
   so the comparison is never between two providers.
*/
var cwWatchRules = (function () {
  'use strict';

  // Level boundaries. A change is reported when a step moves UP a level; moving down
  // is good news nobody needs to be woken up for.
  const RAIN_MM = [0.3, 3];     // dry | rain | heavy   (mm in the hour)
  const WIND_KMH = [20, 35];    // calm | moderate | strong   (sustained)
  const GUST_KMH = [40, 55];    // gusts alone can raise the wind level

  // Values sit on a boundary for hours; without a margin a check that lands at 20.1
  // after a baseline of 19.9 would wake the phone for nothing.
  const MARGIN = { rain: 0.1, wind: 3 };

  // One request carries every point, but each one costs the API and the 30 seconds a
  // background task gets. A dozen spread along the route is plenty for a forecast
  // whose grid cells are several kilometres wide.
  const MAX_POINTS = 12;

  // Official alerts are regional; asking at the start, middle and end covers the
  // route without a request per point.
  const ALERT_POINTS = 3;

  const HOUR = 3600 * 1000;

  function level(value, bounds, margin) {
    if (!Number.isFinite(value)) return null;
    if (value >= bounds[1] + margin) return 2;
    if (value >= bounds[0] + margin) return 1;
    return 0;
  }

  // The baseline uses no margin and the current reading does, so a rise has to
  // clear the boundary by the margin to count.
  function rainLevel(mm, withMargin) {
    return level(mm, RAIN_MM, withMargin ? MARGIN.rain : 0);
  }

  function windLevel(kmh, gust, withMargin) {
    const m = withMargin ? MARGIN.wind : 0;
    const bySpeed = level(kmh, WIND_KMH, m);
    const byGust = level(gust, GUST_KMH, m);
    if (bySpeed == null) return byGust;
    if (byGust == null) return bySpeed;
    return Math.max(bySpeed, byGust);
  }

  /** Evenly spaced subset, always keeping the first and the last point. */
  function sample(points, max) {
    max = max || MAX_POINTS;
    if (!Array.isArray(points) || points.length <= max) return points || [];
    const out = [];
    for (let i = 0; i < max; i++) {
      out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
    }
    return out;
  }

  function alertPoints(points) {
    return sample(points, Math.min(ALERT_POINTS, points.length));
  }

  /** Days of forecast needed to cover the last point, from `now`. */
  function forecastDays(points, now) {
    const last = Math.max(...points.map((p) => p.t * 1000));
    const days = Math.ceil((last - now) / (24 * HOUR)) + 1;
    return Math.min(16, Math.max(1, days));
  }

  function forecastUrl(points, now) {
    const lat = points.map((p) => Number(p.lat).toFixed(4)).join(',');
    const lon = points.map((p) => Number(p.lon).toFixed(4)).join(',');
    return 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lon
      + '&hourly=precipitation,wind_speed_10m,wind_gusts_10m'
      + '&wind_speed_unit=kmh&timeformat=unixtime&timezone=UTC'
      + '&forecast_days=' + forecastDays(points, now);
  }

  function alertsUrl(point, key) {
    return 'https://api.openweathermap.org/data/3.0/onecall'
      + '?lat=' + Number(point.lat).toFixed(4) + '&lon=' + Number(point.lon).toFixed(4)
      + '&exclude=current,minutely,hourly,daily&appid=' + encodeURIComponent(key);
  }

  /**
   * Reading per point: { rain, wind, gust } at the hour the rider passes there, or
   * null when the response has nothing within an hour of it. Open-Meteo answers a
   * multi-location request with an array in request order, a single one with an
   * object.
   */
  function readForecast(json, points) {
    const list = Array.isArray(json) ? json : [json];
    return points.map((p, i) => {
      const h = list[i] && list[i].hourly;
      if (!h || !Array.isArray(h.time)) return null;
      let best = -1;
      let bestGap = Infinity;
      for (let k = 0; k < h.time.length; k++) {
        const gap = Math.abs(Number(h.time[k]) - p.t);
        if (gap < bestGap) { bestGap = gap; best = k; }
      }
      if (best < 0 || bestGap > 3600) return null;
      const num = (arr) => (arr && arr[best] != null ? Number(arr[best]) : NaN);
      return {
        rain: num(h.precipitation),
        wind: num(h.wind_speed_10m),
        gust: num(h.wind_gusts_10m),
      };
    });
  }

  function readAlerts(json) {
    const alerts = json && Array.isArray(json.alerts) ? json.alerts : [];
    return alerts.map((a) => ({
      id: [a.sender_name, a.event, a.start, a.end].join('_'),
      event: String(a.event || ''),
      sender: String(a.sender_name || ''),
      start: Number(a.start) || 0,
      end: Number(a.end) || Number.MAX_SAFE_INTEGER,
    }));
  }

  /** Steps that got worse: rain or wind one level or more above the baseline. */
  function compare(baseline, current) {
    const changes = [];
    if (!Array.isArray(baseline) || !Array.isArray(current)) return changes;
    for (let i = 0; i < current.length; i++) {
      const was = baseline[i];
      const now = current[i];
      if (!was || !now) continue;
      const rainWas = rainLevel(was.rain, false);
      const rainNow = rainLevel(now.rain, true);
      if (rainWas != null && rainNow != null && rainNow > rainWas) {
        changes.push({ kind: 'rain', i, from: rainWas, to: rainNow, value: now.rain });
      }
      const windWas = windLevel(was.wind, was.gust, false);
      const windNow = windLevel(now.wind, now.gust, true);
      if (windWas != null && windNow != null && windNow > windWas) {
        changes.push({ kind: 'wind', i, from: windWas, to: windNow, value: now.wind, gust: now.gust });
      }
    }
    return changes;
  }

  /** Official alerts that overlap the ride (an hour of slack each side) and have
   *  not been notified yet. */
  function newAlerts(alerts, notified, startMs, endMs) {
    const seen = new Set(notified || []);
    const from = startMs / 1000 - 3600;
    const to = endMs / 1000 + 3600;
    const out = [];
    for (const a of alerts || []) {
      if (seen.has(a.id)) continue;
      if (a.start > to || a.end < from) continue;
      seen.add(a.id);
      out.push(a);
    }
    return out;
  }

  const TEXT = {
    es: {
      title: 'Cambia el tiempo en tu ruta',
      rain: ['', 'Lluvia', 'Lluvia fuerte'],
      wind: ['', 'Viento moderado', 'Viento fuerte'],
      at: 'a las {time} (km {km})',
      alert: 'Aviso oficial: {event}',
      calm: 'no estaba previsto',
    },
    en: {
      title: 'The weather on your ride has changed',
      rain: ['', 'Rain', 'Heavy rain'],
      wind: ['', 'Moderate wind', 'Strong wind'],
      at: 'at {time} (km {km})',
      alert: 'Official warning: {event}',
      calm: 'not forecast before',
    },
  };

  function fill(s, vars) {
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  /** One notification for everything found in a check, worst change of each kind
   *  first, official alerts last. */
  function compose(changes, alerts, watch) {
    const L = TEXT[watch.lang] || TEXT.en;
    const lines = [];
    for (const kind of ['rain', 'wind']) {
      const mine = changes.filter((c) => c.kind === kind);
      if (!mine.length) continue;
      // The first step that gets worse is what the rider wants to know about; the
      // level shown is the worst one along the ride.
      const first = mine.reduce((a, b) => (b.i < a.i ? b : a));
      const worst = Math.max(...mine.map((c) => c.to));
      const p = watch.points[first.i] || {};
      let line = L[kind][worst];
      if (kind === 'wind') {
        const shown = Math.round(Math.max(first.value || 0, ...mine.map((c) => c.value || 0)));
        line += ' (' + shown + ' km/h)';
      }
      line += ' ' + fill(L.at, { time: p.label || '?', km: p.km != null ? Math.round(p.km) : '?' });
      if (first.from === 0) line += ', ' + L.calm;
      lines.push(line);
    }
    for (const a of alerts) {
      lines.push(fill(L.alert, { event: a.event }) + (a.sender ? ' · ' + a.sender : ''));
    }
    const title = watch.name ? watch.name + ' · ' + L.title : L.title;
    return { title, body: lines.join('\n') };
  }

  function expired(watch, now) {
    return !watch || !Number.isFinite(watch.end) || now > watch.end + HOUR;
  }

  /**
   * One check. Pure: returns the notification to send (or null) and the watch as it
   * should be stored afterwards. The baseline moves to the current reading whenever
   * something is reported, so the same change is not announced again on the next
   * run; a later worsening still is. Without a baseline (the app was offline when
   * it armed the watch) the first check only seeds one.
   */
  function evaluate(watch, current, alerts, now) {
    const next = Object.assign({}, watch, { checkedAt: now });
    if (!Array.isArray(watch.baseline)) {
      next.baseline = current;
      return { notification: null, watch: next };
    }
    const changes = compare(watch.baseline, current);
    const fresh = newAlerts(alerts, watch.notified, watch.start, watch.end);
    if (!changes.length && !fresh.length) return { notification: null, watch: next };

    next.baseline = current.map((c, i) => c || watch.baseline[i] || null);
    next.notified = (watch.notified || []).concat(fresh.map((a) => a.id));
    return { notification: compose(changes, fresh, watch), watch: next };
  }

  return {
    RAIN_MM, WIND_KMH, GUST_KMH, MAX_POINTS,
    rainLevel, windLevel, sample, alertPoints, forecastUrl, alertsUrl,
    readForecast, readAlerts, compare, newAlerts, compose, evaluate, expired,
  };
})();
