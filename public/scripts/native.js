/* Native shell bridge (Capacitor).
   Loaded by every build; it is a no-op in a normal browser, so the web app and the
   PWA behave exactly as before. Inside the iOS/Android shell it takes over the jobs
   the service worker used to do: receiving GPX files shared from other apps.
*/
(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

  window.CW_NATIVE = isNative;
  window.CW_PLATFORM = isNative ? cap.getPlatform() : 'web';

  if (!isNative) return;

  const plugins = cap.Plugins || {};
  const root = document.documentElement;
  root.classList.add('cw-native', 'cw-native-' + window.CW_PLATFORM);

  const log = (...a) => { try { console.log('[cw-native]', ...a); } catch (_) {} };

  /* ---------- chrome ---------- */

  async function setupChrome() {
    try {
      if (plugins.StatusBar) {
        await plugins.StatusBar.setStyle({ style: 'DARK' }); // light text over the blue header
        if (window.CW_PLATFORM === 'android') {
          await plugins.StatusBar.setBackgroundColor({ color: '#0B6297' });
        }
      }
    } catch (e) { log('status bar', e); }
  }

  async function hideSplash() {
    try { if (plugins.SplashScreen) await plugins.SplashScreen.hide(); } catch (_) {}
  }

  /* ---------- shared GPX handoff ---------- */

  // The iOS share extension (and "Open in MeteoRide") drops files in a shared
  // container; the MeteoRideShare plugin hands them over one at a time.
  let consuming = false;
  let askedAgain = false;

  async function consumePendingShare() {
    const share = plugins.MeteoRideShare;
    if (!share) return false;
    // A share can land while we are still draining the previous one. Remember it
    // instead of returning, or the route would wait for the next app activation.
    if (consuming) {
      askedAgain = true;
      return false;
    }
    consuming = true;
    let got = false;
    try {
      do {
        askedAgain = false;
        // Several files can pile up while the app was closed.
        for (let i = 0; i < 10; i++) {
          const payload = await share.consumePending();
          if (!payload || !payload.gpx) break;
          log('received shared route', payload.name || '');
          injectRoute(payload.gpx, payload.name);
          got = true;
        }
      } while (askedAgain);
      return got;
    } catch (e) {
      log('consumePending failed', e);
      // Routes handed over before the throw are on their way in all the same.
      return got;
    } finally {
      consuming = false;
    }
  }

  // cwReceiveRoute (gpx-share.js) asks for the route at once, imports it into recent routes
  // as it arrives and waits for the map inside its read, which matters here: shared routes
  // arrive while the app is still booting.
  function injectRoute(text, name) {
    window.cwReceiveRoute({ source: 'share-native', name: name || 'Shared route', text, importOn: 'arrival' });
  }

  /* ---------- app lifecycle ---------- */

  function setupApp() {
    const app = plugins.App;
    if (!app) return;
    try {
      // Opened through meteoride:// (share extension) or a file:// URL.
      app.addListener('appUrlOpen', (data) => {
        log('appUrlOpen', data && data.url);
        consumePendingShare();
      });
      app.addListener('appStateChange', (state) => {
        if (!state || !state.isActive) return;
        consumePendingShare();
        refreshOnResume();
      });
      if (window.CW_PLATFORM === 'android') {
        app.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack && window.location.pathname !== '/index.html' && window.location.pathname !== '/') {
            window.history.back();
          } else {
            app.exitApp();
          }
        });
      }
    } catch (e) { log('app listeners', e); }
  }

  // Android has no appUrlOpen for a plain share intent, so the plugin says so itself.
  // Kept out of setupApp: it must not depend on the App plugin being installed.
  function setupShareEvents() {
    const share = plugins.MeteoRideShare;
    if (!share || typeof share.addListener !== 'function') return;
    try {
      share.addListener('sharedRouteAvailable', () => consumePendingShare());
    } catch (e) { log('share listener', e); }
  }

  /* ---------- sending a route on ---------- */

  // The point of the app sitting between Komoot and a head unit: take the route that
  // is loaded, hand it to the system share sheet, and let the user pick Hammerhead,
  // Files, Mail or anything else. Native only — the button does not exist on the web,
  // where the browser has no share sheet worth the name.
  async function currentRouteGpx() {
    let file = window.lastGPXFile;
    if (!file && window.cw && typeof window.cw.exportRouteToGpx === 'function') {
      // No original file (route came from a comparison or a rebuild): regenerate one.
      window.cw.exportRouteToGpx(undefined, true);
      file = window.lastGPXFile;
    }
    if (!file) return null;

    // lastGPXFile is a File when the browser has one, and a plain object otherwise.
    if (typeof file.text === 'function') {
      return { name: file.name || 'route.gpx', text: await file.text() };
    }
    if (file._text) return { name: file.name || 'route.gpx', text: file._text };
    return null;
  }

  function safeFileName(name) {
    // The name reaches us from whichever app shared the route, so bound it: some
    // filesystems stop at 255 bytes and the share sheet shows it to the user.
    const base = String(name || 'route.gpx').replace(/[^A-Za-z0-9._ -]+/g, '-').trim().slice(0, 120);
    return /\.(gpx|kml)$/i.test(base) ? base : `${base || 'route'}.gpx`;
  }

  let sharing = false;

  async function shareCurrentRoute() {
    const { Share, Filesystem } = plugins;
    if (!Share || !Filesystem) return log('share plugins missing');
    if (sharing) return;  // the sheet is already up; a second tap would be rejected
    sharing = true;
    try {
      await doShareCurrentRoute(Share, Filesystem);
    } finally {
      sharing = false;
    }
  }

  async function doShareCurrentRoute(Share, Filesystem) {

    let route;
    try {
      route = await currentRouteGpx();
    } catch (e) {
      log('could not read the loaded route', e);
    }
    if (!route || !route.text) {
      window.setNotice && window.setNotice(
        window.t ? window.t('no_route_for_export') || 'No route to share' : 'No route to share',
        'warn'
      );
      return;
    }

    try {
      // The share sheet needs a real file on disk. Cache is right: the system copies
      // what it needs and we are not accumulating routes in the app's storage.
      const written = await Filesystem.writeFile({
        path: safeFileName(route.name),
        data: route.text,
        directory: 'CACHE',
        encoding: 'utf8',
      });
      await Share.share({
        title: route.name,
        files: [written.uri],
        dialogTitle: 'Send route to',
      });
    } catch (e) {
      // Dismissing the sheet rejects too, so this is not necessarily a failure.
      log('share cancelled or failed', e);
    }
  }

  function addShareButton() {
    const nav = document.querySelector('header nav');
    if (!nav || document.getElementById('cwShareRoute')) return;
    if (!plugins.Share || !plugins.Filesystem) return;

    const btn = document.createElement('button');
    btn.id = 'cwShareRoute';
    btn.type = 'button';
    const label = (window.t && window.t('share_route')) || 'Send route to another app';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<span aria-hidden="true">\u{1F4E4}</span>';
    btn.addEventListener('click', shareCurrentRoute);
    nav.insertBefore(btn, nav.firstChild);
  }

  /* ---------- settings that survive ---------- */

  // The settings live in localStorage, which inside a web view is not durable: iOS
  // clears WebKit storage when the device runs short of space, and the user would
  // find their units, language and API key gone. Preferences is UserDefaults on iOS
  // and SharedPreferences on Android, which the system does not reclaim.
  const SETTINGS_KEY = 'cwSettings';

  async function mirrorSettings(json) {
    const prefs = plugins.Preferences;
    if (!prefs || !json) return;
    try { await prefs.set({ key: SETTINGS_KEY, value: String(json) }); }
    catch (e) { log('could not mirror the settings', e); }
  }

  async function restoreSettings() {
    const prefs = plugins.Preferences;
    if (!prefs) return;

    let local = null;
    try { local = localStorage.getItem(SETTINGS_KEY); } catch (_) {}
    // The web view is authoritative while it still has them; just refresh the copy.
    if (local) return mirrorSettings(local);

    let stored = null;
    try { stored = (await prefs.get({ key: SETTINGS_KEY })).value; }
    catch (e) { return log('could not read the stored settings', e); }
    if (!stored) return;

    try { localStorage.setItem(SETTINGS_KEY, stored); }
    catch (e) { return log('could not restore the settings', e); }

    log('settings restored from device storage');
    // If the app already read settings on its way up, make it read them again.
    if (typeof window.loadSettings === 'function') {
      try {
        window.loadSettings();
        if (window.applyTranslations) window.applyTranslations();
        if (window.updateProviderOptions) window.updateProviderOptions();
      } catch (e) { log('could not re-apply the settings', e); }
    }
  }

  window.cwMirrorSettings = mirrorSettings;

  /* ---------- coming back to the app later ---------- */

  // An app is resumed, not reloaded. Come back hours later and the table would still be the
  // one computed for a departure that has passed. The start rule runs again (a time chosen
  // ahead stays), and the forecast is computed again when that moved the start or the
  // snapshot on screen is more than half an hour old. A prepared route whose start is now more
  // than three hours away is dropped first.
  const RESUMED_STALE_MS = 30 * 60 * 1000;

  function refreshOnResume() {
    const moved = !!(window.cwApplyStartRule && window.cwApplyStartRule());
    expireIfPast(preparedRecord).then((dropped) => { if (dropped) notifyExpired(); });
    const shown = window.cw.currentSnapshot ? window.cw.currentSnapshot() : null;
    if (moved || (shown && Date.now() - shown.createdAt > RESUMED_STALE_MS)) window.cw.startForecast();
  }

  /* ---------- reopening where you left off ---------- */

  // Opening the app with no coverage used to show nothing at all: no route, no
  // forecast, no explanation. Everything needed was already on the device, it just
  // was not put on screen. Restoring the last route makes the cached forecast appear
  // with it, and it is the better behaviour with coverage too.
  async function restoreLastRoute() {
    // A route is on screen, or one was asked for and is still being read or parsed: the
    // restore would be a later request and replace it. Boot runs this before anything else in
    // the app asks, but the sessionStorage handoff (initGpxShare) asks while app.js loads,
    // before boot. lastGPXFile is set only on confirming.
    // A route arriving by URL or by share wins; do not fight it.
    const params = new URLSearchParams(window.location.search || '');
    if (window.lastGPXFile || window.cw.hasRouteRequests()
        || params.has('gpx_url') || params.has('url') || params.has('shared') || params.has('shared_id')) {
      // The prepared record still belongs to this session: later changes and coming back replay or
      // expire with it. Expired, it goes without a word, over a route that is not its own.
      loadPreparedRecord().then(expireIfPast);
      return;
    }
    return openLastRoute();
  }

  // The restore's own request, past the checks above: they no longer hold once it has asked.
  async function openLastRoute() {
    // The request is made before any wait, so a route that arrives while the recent
    // routes are still loading is a later request and replaces this one. Five seconds is
    // generous for an IndexedDB read and short enough that a first run with nothing
    // stored is not left in silence.
    let nothingStored = false;
    let expired = false;
    let opened = null;
    const result = await window.cw.requestRoute({
      source: 'recent',
      read: async () => {
        // The prepared route comes first (spec §4.7): until it has expired it is what opens,
        // whichever recent route is newest. Expired, it is dropped here and said after the request.
        const prepared = await loadPreparedRecord();
        if (prepared && (await expireIfPast(prepared))) expired = true;
        else if (prepared) {
          log('restoring the prepared route', prepared.gpx.name || '');
          opened = prepared;
          return { text: prepared.gpx.text, name: prepared.gpx.name };
        }
        const routes = await waitFor(() => {
          const list = window.getRecentRoutes ? window.getRecentRoutes() : [];
          return list && list.length ? list : null;
        }, 5000);
        if (!routes) {
          nothingStored = true;
          return null;
        }
        log('restoring last route', routes[0].name || '');
        return window.cwReadRecentRoute(routes[0]);
      },
    });

    // A later request replaced this one: the screen and the notice are that request's.
    if (result === 'superseded') return;
    // A prepared route whose text cannot be opened would stand in the way of every start for three
    // hours: it is dropped, and the restore runs again on the recent routes. The request ends as
    // 'failed' for a text that does not parse too; with the prepared text read, that is the only way.
    if (result === 'failed' && opened) {
      if (preparedRecord === opened) preparedRecord = null;
      await writePrepared((store) => store.delete(PREPARED_KEY));
      return openLastRoute();
    }
    if (expired) notifyExpired();
    // First run out of coverage: nothing to restore and no way to fetch anything.
    // Saying so beats an empty screen that looks broken.
    if (nothingStored && !window.lastGPXFile && offline()) {
      notify('offline_first_run', 'No connection. You can open a route, but the forecast needs coverage.');
    }
  }

  function offline() {
    const utils = window.cw && window.cw.utils;
    return utils && utils.isOffline ? utils.isOffline() : navigator.onLine === false;
  }

  /** Polls until the check returns something truthy, or gives up. */
  function waitFor(check, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const first = check();
      if (first) return resolve(first);
      const deadline = Date.now() + timeoutMs;
      const timer = setInterval(() => {
        const value = check();
        if (value || Date.now() > deadline) {
          clearInterval(timer);
          resolve(value || null);
        }
      }, 200);
    });
  }

  /* ---------- preparing for no coverage ---------- */

  // One prepared route at a time (spec §4.9.2): the snapshot on screen and the route text it was
  // computed from, in IndexedDB, which is what survives. The copy in memory is what launching a
  // computation decides with, with no wait; every read and every write replaces it. Neither
  // identities nor API keys are stored: a replay takes the keys in use then. It used to pin cache
  // entries and count them as points, and promised what reading without coverage could not find.
  const PREPARED_DB = 'meteoride_prepared';
  const PREPARED_STORE = 'snapshot';
  const PREPARED_KEY = 'current';
  let preparedRecord = null;

  function openPrepared() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(PREPARED_DB, 1); } catch (_) { return resolve(null); }
      req.onupgradeneeded = () => req.result.createObjectStore(PREPARED_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    });
  }

  // Runs `op` on the store in one transaction and resolves true only once it completes: an
  // abort or an error, like no IndexedDB at all, is false.
  async function writePrepared(op) {
    const db = await openPrepared();
    if (!db) return false;
    return new Promise((resolve) => {
      const done = (ok) => { try { db.close(); } catch (_) { /* closed */ } resolve(ok); };
      try {
        const tx = db.transaction(PREPARED_STORE, 'readwrite');
        tx.oncomplete = () => done(true);
        tx.onabort = tx.onerror = () => done(false);
        op(tx.objectStore(PREPARED_STORE));
      } catch (_) { done(false); }
    });
  }

  // A record of another version, or one missing what a replay needs, is no record: dropped
  // without a word (spec §5).
  const wellFormed = (r) => !!(r && r.version === 1 && r.gpx && typeof r.gpx.text === 'string'
    && r.snapshot && r.snapshot.route && typeof r.snapshot.route.fingerprint === 'string'
    && r.snapshot.settings && Number.isFinite(r.snapshot.settings.start)
    && Array.isArray(r.snapshot.steps));

  async function loadPreparedRecord() {
    const db = await openPrepared();
    let record = null;
    if (db) {
      record = await new Promise((resolve) => {
        try {
          const get = db.transaction(PREPARED_STORE, 'readonly').objectStore(PREPARED_STORE).get(PREPARED_KEY);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
      try { db.close(); } catch (_) { /* closed */ }
    }
    preparedRecord = wellFormed(record) ? record : null;
    return preparedRecord;
  }

  // A prepared route is deleted, at start-up or when the app comes back (spec §4.9.3, step 5), only
  // once it can never stand in again: the earliest start there can be, now rounded up to the quarter
  // hour, is more than three hours past the start it was prepared for. The start in the field plays
  // no part, so a time moved by hand, however far, never deletes it, and moved back within three hours
  // it replays. Out of memory at once, then out of IndexedDB. Resolves whether it was dropped; saying
  // so (notifyExpired) is the caller's.
  async function expireIfPast(record) {
    if (!record) return false;
    const prepared = record.snapshot.settings.start;
    const earliest = window.roundUpToNextQuarterDate(new Date()).getTime();
    const startMs = Math.max(earliest, prepared);   // a start still ahead of it is always within reach
    if (cwForecastRules.usablePrepared(record, { fingerprint: record.snapshot.route.fingerprint, startMs })) return false;
    if (preparedRecord === record) preparedRecord = null;
    await writePrepared((store) => store.delete(PREPARED_KEY));
    return true;
  }

  function notifyExpired() {
    if (!offline()) return;
    notify('prepared_expired_needs_coverage', 'The prepared route no longer fits this start time and was deleted: the forecast needs coverage.');
  }

  async function prepareForOffline() {
    const snapshot = window.cw.currentSnapshot();
    const route = window.cwConfirmedRouteText ? window.cwConfirmedRouteText() : null;
    if (!snapshot || snapshot.origin !== 'live' || !route) {
      notify('prepare_offline_empty', 'Load a route and let the forecast appear first.');
      return;
    }
    const { requestId, computationId, ...kept } = snapshot;
    const { keys, alertsKey, ...settings } = snapshot.settings;
    const record = { version: 1, snapshot: { ...kept, settings }, gpx: { text: route.text, name: route.name } };

    // What a replay can show whatever the start within three hours, not what was downloaded. Counted
    // before anything is written: with no point covered there is nothing worth keeping, and a route
    // prepared before must not be replaced by it.
    const { covered, total } = cwForecastRules.preparedCoverage(record.snapshot);
    if (!covered) {
      notify('prepare_offline_uncovered', 'Nothing saved: no point has a forecast for every start up to 3 h earlier or later. Run it again while you have coverage.');
      return;
    }
    const before = await loadPreparedRecord();
    if (!(await writePrepared((store) => store.put(record, PREPARED_KEY)))) {
      notify('prepare_offline_failed', 'Could not save the prepared route.');
      return;
    }
    preparedRecord = record;
    const parts = [];
    if (before && before.snapshot.route.fingerprint !== record.snapshot.route.fingerprint) {
      parts.push(['prepare_offline_replaced', {}]);
    }
    parts.push(covered === total ? ['prepare_offline_done', { n: total }] : ['prepare_offline_partial', { n: covered, total }]);
    if (window.setNotice) window.setNotice(parts.map(([key, vars]) => window.t(key, vars)).join(' '), 'warn');
  }

  function notify(key, fallback, vars) {
    // t() substitutes the placeholders itself and blanks out any it is not given,
    // so pass the values in rather than patching the result afterwards.
    let msg = window.t ? window.t(key, vars || {}) : fallback;
    if (!window.t) {
      for (const [k, v] of Object.entries(vars || {})) msg = msg.replace(`{${k}}`, v);
    }
    if (window.setNotice) window.setNotice(msg, 'warn');
    else log(msg);
  }

  function addPrepareButton() {
    const nav = document.querySelector('header nav');
    if (!nav || document.getElementById('cwPrepareOffline')) return;

    const btn = document.createElement('button');
    btn.id = 'cwPrepareOffline';
    btn.type = 'button';
    const label = (window.t && window.t('prepare_offline')) || 'Save for riding without coverage';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<span aria-hidden="true">\u{1F4F4}</span>';
    btn.addEventListener('click', prepareForOffline);
    nav.insertBefore(btn, nav.firstChild);
  }

  /* ---------- the map with no tiles ---------- */

  // Out of coverage the map draws the route, the wind arrows and the markers, but the
  // background stays blank: the tiles are not in the web view's HTTP cache, verified
  // by serving them from a real server and taking it away. A flat grey rectangle reads
  // as something broken, so label it instead.
  function mapTilesNotice() {
    const container = document.getElementById('map');
    if (!container) return null;
    let el = document.getElementById('cwMapOffline');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'cwMapOffline';
    el.hidden = true;
    el.textContent = (window.t && window.t('map_offline')) || 'Map unavailable offline';
    container.appendChild(el);
    return el;
  }

  // Tiles viewed earlier are kept, so being offline no longer means a blank map.
  // The badge follows what happened to the tiles rather than the connection, read
  // from the DOM rather than counted from events: the first load finishes before
  // there is anything to attach a listener to.
  function tilesAreMissing() {
    const tiles = document.querySelectorAll('#map img.leaflet-tile');
    if (!tiles.length) return true;
    return [...tiles].some((t) => !t.classList.contains('leaflet-tile-loaded'));
  }

  function updateMapNotice() {
    const el = mapTilesNotice();
    if (el) el.hidden = !(offline() && tilesAreMissing());
  }

  let noticeTimer = null;
  function scheduleMapNotice() {
    if (noticeTimer) return;
    noticeTimer = setTimeout(() => { noticeTimer = null; updateMapNotice(); }, 250);
  }

  function watchConnectivity() {
    window.addEventListener('online', scheduleMapNotice);
    window.addEventListener('offline', scheduleMapNotice);

    // Layer events alone are not enough: the first tiles can settle before there is
    // a layer to listen to, and a run that ends on an event we missed leaves the
    // badge in the wrong state. Watching the tiles themselves is what is reliable —
    // Leaflet marks a tile loaded by adding a class to it.
    const container = document.getElementById('map');
    if (container && typeof MutationObserver === 'function') {
      new MutationObserver(scheduleMapNotice).observe(container, {
        subtree: true,
        childList: true,
        attributeFilter: ['class'],
      });
    }

    waitFor(() => window.cwTileLayer, 10000).then((layer) => {
      if (layer) layer.on('load tileerror', scheduleMapNotice);
      scheduleMapNotice();
    });
    scheduleMapNotice();
  }

  /* ---------- ride alerts ---------- */

  // A forecast is a plan made hours ahead. This watches it: once a route has its
  // table, the shell stores the route's points and the forecast read for them, and
  // a background task (mobile/runners/watch.js) re-reads the same forecast while the
  // app is closed. Dry turning to rain, calm turning to wind, or an official warning
  // overlapping the ride becomes a notification. The rules live in watch-rules.js,
  // shared with the runner; this side only builds the record and stores it.
  const WATCH_LABEL = 'cc.meteoride.app.watch';   // = the BackgroundRunner label in capacitor.config.json

  // The npm package is @capacitor/background-runner and its JS export is called
  // BackgroundRunner, but the plugin registers itself with the bridge as
  // "CapacitorBackgroundRunner" — that is the name `Capacitor.Plugins` is keyed by,
  // on both platforms. Getting this wrong costs nothing at build time and silently
  // hides the whole feature, so tests/plugin-names.test.mjs checks it against the
  // installed package.
  const runnerPlugin = () => plugins.CapacitorBackgroundRunner;
  const WATCH_CHANNEL = 'cw_alerts';
  // A ride days away is not checked until it is a day out: fewer requests, and the
  // notification then describes the forecast that will actually hold.
  const WATCH_HORIZON_MS = 24 * 60 * 60 * 1000;

  let channelReady = false;
  let armToken = 0;   // a newer arm or a disarm supersedes an arm still waiting
  // The route fingerprint of the watch last armed or stored: undefined until the stored one
  // has been read at start-up, null while nothing is stored.
  let watchFingerprint;
  // Saves, disarms and reads reach the runner one at a time, each once the runner has
  // answered the one before, so the save of a replaced forecast can never land after the
  // disarm that followed it.
  let watchQueue = Promise.resolve();

  function alertsWanted() {
    const el = document.getElementById('rideAlerts');
    return !!(el && el.checked);
  }

  function queueWatch(op) {
    const done = watchQueue.then(op);
    watchQueue = done.catch((e) => log('ride watch', e));
    return done;
  }

  const runnerCall = (event, details) =>
    runnerPlugin().dispatchEvent({ label: WATCH_LABEL, event, details });

  async function notificationsAllowed() {
    const runner = runnerPlugin();
    let status = 'denied';
    try {
      status = (await runner.checkPermissions()).notifications;
      if (status !== 'granted') {
        status = (await runner.requestPermissions({ apis: ['notifications'] })).notifications;
      }
    } catch (e) { log('notification permission', e); }
    if (status !== 'granted') return false;

    // Android: a notification is only as loud as its channel. The runner's default
    // channel is medium importance (no heads-up); this one is high. Created through
    // LocalNotifications because the runner cannot create channels, and channels are
    // app-wide, so the runner can post to it by id.
    if (window.CW_PLATFORM === 'android' && !channelReady && plugins.LocalNotifications) {
      try {
        await plugins.LocalNotifications.createChannel({
          id: WATCH_CHANNEL,
          name: (window.t && window.t('ride_alerts_label')) || 'Ride alerts',
          importance: 5,
          visibility: 1,
        });
        channelReady = true;
      } catch (e) { log('notification channel', e); }
    }
    return true;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const clockLabel = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  /** The record the runner works from, built from a snapshot and nothing else (not the
   *  page, not localStorage), or null when there is nothing worth watching. */
  function buildWatch(snapshot) {
    const rules = window.cwWatchRules;
    const settings = snapshot.settings || {};
    const route = snapshot.route || {};
    const valid = (snapshot.steps || []).filter((s) =>
      s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))
        && s.time && !isNaN(new Date(s.time).getTime()));
    if (!rules || !valid.length) return null;

    const intervalMin = Number(settings.interval) || 0;
    const start = new Date(valid[0].time).getTime();
    const end = new Date(valid[valid.length - 1].time).getTime() + intervalMin * 60000;
    if (end < Date.now()) return null;   // the ride is over; nothing can change it

    const points = rules.sample(valid.map((s) => {
      const when = new Date(s.time);
      return {
        lat: Number(s.lat),
        lon: Number(s.lon),
        t: Math.round(when.getTime() / 1000),
        label: clockLabel(when),      // the runner has no reliable locale or timezone
        km: Number(s.distanceM || 0) / 1000,
      };
    }));

    return {
      name: route.name || 'GPX',
      fingerprint: route.fingerprint || '',   // ignored by the runner; tells rides apart here
      lang: settings.lang === 'es' ? 'es' : 'en',
      createdAt: Date.now(),
      start,
      end,
      horizonMs: WATCH_HORIZON_MS,
      points,
      baseline: null,
      notified: [],
      // Official warnings need the OpenWeather key, and only if the user shows them: the
      // snapshot carries it only then.
      owKey: String(settings.alertsKey || ''),
      channelId: channelReady ? WATCH_CHANNEL : '',
    };
  }

  // The baseline is read here, in the foreground, from the same request the runner
  // will make: comparing against the table would compare two providers. Offline, the
  // runner seeds it on its first run instead.
  async function seedBaseline(watch) {
    const rules = window.cwWatchRules;
    if (offline()) return;
    try {
      // No cwRecorder: a failure here belongs to no computation, so it never becomes a
      // notice over a table that loaded fine.
      const res = await fetch(rules.forecastUrl(watch.points, Date.now()));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      watch.baseline = rules.readForecast(await res.json(), watch.points);
    } catch (e) {
      log('baseline left to the first background check', e && e.message);
    }
  }

  // Queued. When its turn comes it runs only if no arm or disarm came after it and its
  // snapshot is still the one on screen. Resolves true once the runner has it.
  function saveWatch(watch, snapshot, token) {
    const current = () => token === armToken && window.cw.currentSnapshot() === snapshot;
    return queueWatch(async () => {
      if (!current()) return false;
      // Named before the runner answers, so it is always the last watch sent to it.
      watchFingerprint = watch ? watch.fingerprint : null;
      await runnerCall('saveWatch', { watch: watch || null });
      if (current()) showWatchStatus(watch);
      return true;
    });
  }

  // Arms the watch for a published snapshot. Every wait is followed by the same check,
  // before any effect: still the latest arm, and still the snapshot on screen.
  async function armWatch(snapshot) {
    if (!runnerPlugin() || !snapshot) return;
    const mine = ++armToken;
    const current = () => mine === armToken && window.cw.currentSnapshot() === snapshot;
    try {
      if (!alertsWanted()) return;
      const fresh = buildWatch(snapshot);
      if (!fresh) return saveWatch(null, snapshot, mine);

      const allowed = await notificationsAllowed();
      if (!current()) return;
      if (!allowed) {
        // The toggle would lie if it stayed on. Off, saved, and said out loud: the
        // user has to grant it in the system settings and tick it again.
        const el = document.getElementById('rideAlerts');
        if (el) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
        notify('ride_alerts_denied', 'Notifications are off for MeteoRide. Allow them in the system settings to get ride alerts.');
        return;
      }
      fresh.channelId = channelReady ? WATCH_CHANNEL : '';
      // Read after every save and disarm already queued: arming the same ride again keeps
      // what was notified, and the baseline when the points are the same. A replay moved to
      // another start is still the same ride. A read that fails arms afresh.
      const stored = await queueWatch(() => runnerCall('loadWatch', {}).catch((e) => {
        log('could not read the stored watch', e);
        return null;
      }));
      if (!current()) return;
      const watch = window.cwWatchRules.reuse(stored, fresh, snapshot.origin === 'prepared');
      if (!Array.isArray(watch.baseline)) {
        await seedBaseline(watch);
        if (!current()) return;
      }
      if (await saveWatch(watch, snapshot, mine)) log('watching the forecast until', new Date(watch.end).toISOString());
    } catch (e) {
      log('could not arm the watch', e);
    }
  }

  // With `keepFor`, a route fingerprint, whether to disarm is decided when its turn comes: a
  // watch stored for that route, or none, is left alone.
  function disarmWatch(keepFor) {
    if (!runnerPlugin()) return;
    ++armToken;
    queueWatch(async () => {
      if (keepFor !== undefined && (watchFingerprint === null || watchFingerprint === keepFor)) return;
      // Nothing is named only once the runner has cleared it. While it has not, or if it refuses,
      // the fingerprint still names the route it holds, so confirming another route disarms again.
      await runnerCall('saveWatch', { watch: null });
      watchFingerprint = null;
      showWatchStatus(null);
    }).catch((e) => log('could not clear the watch', e));
  }

  function showWatchStatus(watch) {
    const el = document.getElementById('rideAlertsStatus');
    if (!el) return;
    if (!watch) { el.textContent = ''; return; }
    const until = clockLabel(new Date(watch.end));
    el.textContent = window.t
      ? window.t('ride_alerts_watching', { name: watch.name || '', until })
      : `Watching ${watch.name} until ${until}`;
  }

  function setupRideAlerts() {
    const runner = runnerPlugin();
    const row = document.getElementById('rideAlertsRow');
    if (!runner || !row) return;
    row.hidden = false;

    // app.js announces every published forecast with its snapshot.
    document.addEventListener('cw:forecast', (ev) => {
      armWatch(ev.detail && ev.detail.snapshot);
    });

    const toggle = document.getElementById('rideAlerts');
    if (toggle) {
      toggle.addEventListener('change', () => {
        if (toggle.checked) armWatch(window.cw.currentSnapshot());
        else disarmWatch();
      });
    }

    // Called by app.js as a route is confirmed. The watch belongs to the route it was armed
    // for: another route disarms it; the same route keeps it, so arming it again keeps
    // what was already notified.
    // Until the start-up read has answered, the queue decides after it.
    window.cwDisarmWatchFor = (fingerprint) => {
      if (watchFingerprint === undefined) return disarmWatch(fingerprint);
      if (watchFingerprint === null || watchFingerprint === fingerprint) return;
      disarmWatch();
    };

    // Reflect a watch stored by a previous session. The read goes first in the queue, so every
    // other operation runs knowing the stored fingerprint, and the status it shows is what the
    // runner holds until a later save or disarm changes both.
    queueWatch(async () => {
      const watch = await runnerCall('loadWatch', {});
      watchFingerprint = watch ? (watch.fingerprint || '') : null;
      const rules = window.cwWatchRules;
      if (watch && rules && !rules.expired(watch, Date.now())) showWatchStatus(watch);
    });

    warnIfBackgroundIsOff();
  }

  // The watch runs in a task the OS schedules, and the OS may refuse: on iOS when
  // Background App Refresh is off for the app or the device, on Android when the
  // vendor's battery manager is restricting the app. Neither is visible from
  // JavaScript, so the app-local plugin reports it and the toggle says so; the
  // alternative is a feature that looks on and never fires.
  async function warnIfBackgroundIsOff() {
    const share = plugins.MeteoRideShare;
    if (!share || typeof share.backgroundRefreshStatus !== 'function') return;
    let status = 'available';
    try { status = (await share.backgroundRefreshStatus()).status; }
    catch (e) { return log('background refresh status', e); }
    if (status === 'available') return;
    const el = document.getElementById('rideAlertsHint');
    if (!el) return;
    el.textContent = window.CW_PLATFORM === 'android'
      ? ((window.t && window.t('ride_alerts_bg_android')) || 'Battery optimisation may stop the check: exclude MeteoRide in the battery settings.')
      : ((window.t && window.t('ride_alerts_bg_ios')) || 'Background App Refresh is off for MeteoRide, so no check will run. Turn it on in Settings → General → Background App Refresh.');
    el.hidden = false;
  }

  /* ---------- picking a file ---------- */

  // iOS turns the `accept` attribute into a list of UTIs and greys out everything
  // else in the Files picker. GPX has no system UTI, so `.gpx` maps to nothing and
  // the user cannot select the very files the app exists to read. Widened here only:
  // the website keeps the tighter list, where extensions work as written. Picking
  // the wrong file is harmless — parsing it fails and says so.
  function relaxFilePicker() {
    const input = document.getElementById('gpxFile');
    if (!input) return;
    input.setAttribute('accept', [
      '.gpx', '.kml',
      'application/gpx+xml',
      'application/vnd.google-earth.kml+xml',
      'application/xml',
      'text/xml',
      // public.data: the catch-all that makes everything selectable, for the apps
      // and downloads that hand a route over with no usable type at all.
      'application/octet-stream',
    ].join(','));
  }

  /* ---------- where the phone is ---------- */

  // With no route loaded the map opens on Barcelona, the hard-coded default of the
  // website. On a phone the obvious place to start is where the phone is. Runs
  // alongside the route restore rather than after it, because on a first run the
  // restore waits several seconds for routes that do not exist; whichever finishes
  // last must not undo the other, so a position is only applied while the map is
  // still unclaimed, and a route always fits itself afterwards anyway.
  async function centreOnUser() {
    if (!navigator.geolocation) return;
    const map = await waitFor(() => window.map, 10000);
    if (!map || window.lastGPXFile) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (window.lastGPXFile) return;   // a route arrived while we were waiting
        map.setView([pos.coords.latitude, pos.coords.longitude], 12);
      },
      (err) => log('no position', err && err.message),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  }

  /* ---------- external links ---------- */

  // Keep the web view on the app; send real websites to the system browser.
  function setupLinks() {
    document.addEventListener('click', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      try {
        if (new URL(href).origin === window.location.origin) return;
      } catch (_) { return; }
      ev.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }, true);
  }

  /* ---------- boot ---------- */

  async function boot() {
    setupChrome();
    setupApp();
    setupShareEvents();
    addShareButton();
    addPrepareButton();
    setupLinks();
    relaxFilePicker();
    watchConnectivity();
    setupRideAlerts();
    hideSplash();

    // Neither waits for the other. The restore asks for its route at once; a route shared from
    // another app comes out of the inbox later, so it is the later request and replaces the
    // restore by identity, even once that has published. The map goes to the phone's position
    // only when nothing was shared, as before.
    consumePendingShare().then((arrived) => { if (!arrived) centreOnUser(); });
    restoreLastRoute();
  }

  // Started as early as possible, so the restored values are usually in place before
  // the app reads them; if not, the restore re-applies them itself.
  restoreSettings();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.cwConsumePendingShare = consumePendingShare;
  window.cwShareCurrentRoute = shareCurrentRoute;
  window.cwPrepareForOffline = prepareForOffline;
  window.cwPreparedRecord = () => preparedRecord;
  window.cwLoadPreparedRecord = loadPreparedRecord;
  window.cwArmWatch = armWatch;
})();
