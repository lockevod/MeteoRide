/* Background runner for the ride watch.

   This is not the web view. It is the headless JavaScript context the
   @capacitor/background-runner plugin starts on its own schedule (iOS
   BGTaskScheduler, Android WorkManager) with the app in the background, and again
   from the web view through BackgroundRunner.dispatchEvent(). There is no DOM, no
   localStorage and no window; what exists is fetch, CapacitorKV (UserDefaults /
   SharedPreferences) and CapacitorNotifications. Every context is thrown away when
   the handler resolves, so nothing survives between runs except the KV store.

   The build concatenates public/scripts/watch-rules.js in front of this file into
   www/runners/watch.js, which is the file capacitor.config.json points at, so the
   rules are the same ones the app used to seed the baseline. Keep this file to
   wiring: anything worth a test belongs in the rules.
*/
var WATCH_KEY = 'cw_watch';
var FETCH_TIMEOUT_MS = 20000;   // iOS gives a task about 30 seconds in total

function loadWatch() {
  var raw = CapacitorKV.get(WATCH_KEY);
  if (!raw || !raw.value) return null;
  try { return JSON.parse(raw.value); } catch (e) { return null; }
}

function storeWatch(watch) {
  if (!watch) CapacitorKV.remove(WATCH_KEY);
  else CapacitorKV.set(WATCH_KEY, JSON.stringify(watch));
}

function getJson(url) {
  var timer;
  var timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error('timeout ' + url)); }, FETCH_TIMEOUT_MS);
  });
  var request = fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
  });
  return Promise.race([request, timeout]).then(
    function (v) { clearTimeout(timer); return v; },
    function (e) { clearTimeout(timer); throw e; }
  );
}

function notify(watch, message) {
  var options = {
    // Android wants a 32-bit int; seconds since the epoch fit until 2038.
    id: Math.floor(Date.now() / 1000) % 2147483647,
    title: message.title,
    body: message.body,
    largeBody: message.body,
    // A few seconds out on purpose. The iOS plugin clamps a past date to "now" and
    // then builds a DateInterval whose end is before its start, which is a
    // precondition failure, not an error. Android reads the ISO string with a
    // formatter that ignores the Z (patched on install, see
    // scripts/patch-background-runner.mjs), and fires a past time immediately.
    scheduleAt: new Date(Date.now() + 5000),
    threadIdentifier: 'cw_watch',
    // Forecast changes can concern a ride up to a day away. Respect Focus and
    // notification summaries instead of treating every change as immediately urgent.
    interruptionLevel: 'active',
  };
  // Only when the app confirmed the high-importance channel exists: Android drops a
  // notification whose channel does not.
  if (watch.channelId) options.channelId = watch.channelId;
  CapacitorNotifications.schedule([options]);
}

// The app stores (or clears) the watch by dispatching this event; the runner owns
// the store so the background task and the app read the same copy.
addEventListener('saveWatch', function (resolve, reject, args) {
  try {
    storeWatch(args && args.watch ? args.watch : null);
    resolve();
  } catch (e) {
    reject(e);
  }
});

// The app asks for the stored watch at start-up to show what is being watched.
addEventListener('loadWatch', function (resolve) {
  resolve(loadWatch());
});

// Fired by the OS on the schedule in capacitor.config.json.
addEventListener('checkWatch', function (resolve, reject) {
  var watch = loadWatch();
  var now = Date.now();
  if (!watch) return resolve();
  if (cwWatchRules.expired(watch, now)) {
    storeWatch(null);
    return resolve();
  }
  // Nothing to compare until the ride is near: this saves a request per run on a
  // route planned days ahead and keeps the notification close to what will happen.
  if (watch.start - now > watch.horizonMs) return resolve();

  var forecast = getJson(cwWatchRules.forecastUrl(watch.points, now))
    .then(function (json) { return cwWatchRules.readForecast(json, watch.points); });

  var alerts = Promise.resolve([]);
  if (cwWatchRules.hasAlertsKey(watch.owKey)) {
    var lookups = cwWatchRules.alertPoints(watch.points).map(function (p) {
      return getJson(cwWatchRules.alertsUrl(p, watch.owKey))
        .then(cwWatchRules.readAlerts)
        .catch(function () { return []; });   // alerts are extra; a miss is not a failure
    });
    alerts = Promise.all(lookups).then(function (lists) {
      return lists.reduce(function (all, l) { return all.concat(l); }, []);
    });
  }

  Promise.all([forecast, alerts])
    .then(function (results) {
      var outcome = cwWatchRules.evaluate(watch, results[0], results[1], now);
      if (outcome.notification) notify(watch, outcome.notification);
      storeWatch(outcome.watch);
      resolve();
    })
    .catch(function (e) {
      // Left as it was: the next run tries again.
      reject(e);
    });
});
