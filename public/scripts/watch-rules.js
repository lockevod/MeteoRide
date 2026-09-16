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

  // Which reading of a point a stored baseline was made by. 1 took the rain of the nearest hourly
  // entry; 2 takes the rain of the hour being ridden, the entry labelled H+60, as the table shows it
  // (readForecast). A baseline of another version is about another hour, so it cannot be compared
  // against this reading: evaluate reseeds its rain rather than call the difference weather. Raise
  // this whenever readForecast changes which entry a magnitude comes from.
  const BASELINE_VERSION = 2;

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

  // Same rule the foreground uses to decide a key is usable (app.js, ui.js): under 5
  // characters is treated as no key at all, not just falsy. The runner has no key field
  // of its own to validate at save time, so it re-checks here before spending a request.
  function hasAlertsKey(key) {
    return !!key && String(key).trim().length >= 5;
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
   *
   * Wind and gust are the nearest hourly entry. Rain is the hour being ridden, as the
   * table shows it: (H, H+60 min] with H the point's time floored to the hour, which is
   * the entry labelled H+60, because Open-Meteo's hourly value is the hour before its
   * label. The request is in UTC unix time, so H is the UTC hour: the table's hour in
   * any zone with a whole-hour offset. No H+60 entry, no rain value.
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
      const hourRidden = Math.floor(p.t / 3600) * 3600 + 3600;
      const rainAt = h.time.findIndex((x) => Number(x) === hourRidden);
      const num = (arr, k) => (k >= 0 && arr && arr[k] != null ? Number(arr[k]) : NaN);
      return {
        rain: num(h.precipitation, rainAt),
        wind: num(h.wind_speed_10m, best),
        gust: num(h.wind_gusts_10m, best),
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

  // A step the rider has already passed is history, not a forecast. A little slack
  // so the step being ridden right now still counts.
  const PASSED_SLACK_MS = 15 * 60 * 1000;

  /** Steps that got worse: rain or wind one level or more above the baseline.
   *  `points` and `now` (ms) restrict it to steps still ahead. */
  function compare(baseline, current, points, now) {
    const changes = [];
    if (!Array.isArray(baseline) || !Array.isArray(current)) return changes;
    for (let i = 0; i < current.length; i++) {
      const was = baseline[i];
      const cur = current[i];
      if (!cur) continue;
      if (points && now != null && points[i] && points[i].t * 1000 < now - PASSED_SLACK_MS) continue;
      // A magnitude with no baseline counts as calm: a point that is already severe
      // the first time it is read is news, not a starting point.
      const rainNow = rainLevel(cur.rain, true);
      let rainWas = rainLevel(was && was.rain, false);
      if (rainWas == null && rainNow != null) rainWas = 0;
      if (rainWas != null && rainNow != null && rainNow > rainWas) {
        changes.push({ kind: 'rain', i, from: rainWas, to: rainNow, value: cur.rain });
      }
      const windNow = windLevel(cur.wind, cur.gust, true);
      let windWas = windLevel(was && was.wind, was && was.gust, false);
      if (windWas == null && windNow != null) windWas = 0;
      if (windWas != null && windNow != null && windNow > windWas) {
        changes.push({ kind: 'wind', i, from: windWas, to: windNow, value: cur.wind, gust: cur.gust });
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

  // iOS passes the title and body through localizedUserNotificationString, which
  // treats them as format strings; a "%" from an official warning ("80% ...") or a
  // file name would be read as a specifier with no arguments. Full-width percent
  // looks the same and formats nothing.
  function safeText(s) {
    return String(s == null ? '' : s).replace(/%/g, '\uFF05');
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
      lines.push(fill(L.alert, { event: safeText(a.event) }) + (a.sender ? ' · ' + safeText(a.sender) : ''));
    }
    const title = watch.name ? safeText(watch.name) + ' · ' + L.title : L.title;
    return { title, body: lines.join('\n') };
  }

  function expired(watch, now) {
    return !watch || !Number.isFinite(watch.end) || now > watch.end + HOUR;
  }

  /**
   * The baseline after a check, point by point and magnitude by magnitude. Rain, and
   * wind with its gusts, move to the current reading only when that very change was
   * reported, or when there was no baseline for it and the reading brings one. Any
   * other move would eat the margin (a creeping rise never announced) or forget a
   * level that merely eased (and announce it again as new). JSON storage turns NaN
   * into null; the level functions treat both as "no value".
   */
  function nextBaseline(baseline, current, changes) {
    const moved = new Set(changes.map((c) => c.i + ':' + c.kind));
    return current.map((cur, i) => {
      const was = baseline[i] || null;
      if (!cur) return was;
      const takeRain = moved.has(i + ':rain') || rainLevel(was && was.rain, false) == null;
      const takeWind = moved.has(i + ':wind') || windLevel(was && was.wind, was && was.gust, false) == null;
      return {
        rain: takeRain ? cur.rain : was.rain,
        wind: takeWind ? cur.wind : was.wind,
        gust: takeWind ? cur.gust : was.gust,
      };
    });
  }

  /**
   * One check. Pure: returns the notification to send (or null) and the watch as it
   * should be stored afterwards (see nextBaseline for how the baseline moves). An
   * official warning is remembered by id and moves no baseline. Without a baseline
   * (the app was offline when it armed the watch) the first check only seeds one.
   */
  function evaluate(watch, current, alerts, now) {
    const next = Object.assign({}, watch, { checkedAt: now, baselineVersion: BASELINE_VERSION });
    if (!Array.isArray(watch.baseline)) {
      next.baseline = current;
      return { notification: null, watch: next };
    }
    // A baseline stored by an earlier reading holds the rain of another hour (BASELINE_VERSION), and
    // nothing re-arms a watch in the background, so an app update leaves one behind. Comparing this
    // reading against it would announce the change of reader as a change in the weather, or hide a
    // real one. Its rain is taken from this reading instead, so this check reports none; the wind is
    // read as it always was and keeps its baseline, and the warnings already notified are untouched.
    const baseline = watch.baselineVersion === BASELINE_VERSION
      ? watch.baseline
      : watch.baseline.map((was, i) => (was
        ? Object.assign({}, was, { rain: current[i] ? current[i].rain : undefined })
        : was));
    const changes = compare(baseline, current, watch.points, now);
    const fresh = newAlerts(alerts, watch.notified, Math.max(watch.start, now), watch.end);
    next.baseline = nextBaseline(baseline, current, changes);
    if (!changes.length && !fresh.length) return { notification: null, watch: next };

    next.notified = (watch.notified || []).concat(fresh.map((a) => a.id));
    return { notification: compose(changes, fresh, watch), watch: next };
  }

  /**
   * The watch to store when the app arms `fresh` while `stored` is what the runner holds.
   * The same ride (same route fingerprint, same start) keeps the warnings already
   * notified, so arming it again does not announce them twice. `moved` says `fresh` comes
   * from a prepared snapshot moved to another start (spec §4.6): it is still that ride, so
   * what was notified stays whatever the start. The baseline is kept only over identical
   * points, because compare() reads it by index. Pure: returns a new record; nothing of
   * `moved` is stored.
   */
  function reuse(stored, fresh, moved) {
    const next = Object.assign({}, fresh, { notified: [], baseline: null });
    if (!stored || !fresh.fingerprint || stored.fingerprint !== fresh.fingerprint
        || (stored.start !== fresh.start && !moved)) {
      return next;
    }
    next.notified = (stored.notified || []).slice();
    const a = stored.points || [];
    const b = fresh.points || [];
    const samePoints = a.length === b.length
      && a.every((p, i) => p.lat === b[i].lat && p.lon === b[i].lon && p.t === b[i].t);
    // A baseline made by an earlier reading is about another hour's rain (BASELINE_VERSION), so it is
    // not carried over: here in the foreground it is simply read again, which costs one request.
    if (samePoints && Array.isArray(stored.baseline) && stored.baselineVersion === BASELINE_VERSION) {
      next.baseline = stored.baseline;
      next.baselineVersion = BASELINE_VERSION;
    }
    return next;
  }

  return {
    RAIN_MM, WIND_KMH, GUST_KMH, MAX_POINTS, BASELINE_VERSION,
    rainLevel, windLevel, sample, alertPoints, hasAlertsKey, forecastUrl, alertsUrl,
    readForecast, readAlerts, compare, newAlerts, compose, evaluate, expired, reuse,
  };
})();
