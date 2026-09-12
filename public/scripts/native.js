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
    try {
      let got = false;
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
      return false;
    } finally {
      consuming = false;
    }
  }

  // cwInjectGPXFromText (gpx-share.js) already waits for the map and the loader,
  // which matters here: shared routes arrive while the app is still booting.
  function injectRoute(text, name) {
    window.cwInjectGPXFromText(text, name || 'Shared route');
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
        warnIfStartTimeHasPassed();
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

  /* ---------- coming back to the app later ---------- */

  // An app is resumed, not reloaded. Come back hours later and the table is still
  // the one computed for a departure time that has already passed, with nothing
  // saying so. Fifteen minutes of slack, because leaving a little late is normal.
  const STALE_START_MS = 15 * 60 * 1000;

  function warnIfStartTimeHasPassed() {
    if (!window.lastGPXFile) return;    // nothing on screen to be wrong about
    const field = document.getElementById('datetimeRoute');
    if (!field || !field.value) return;
    const start = new Date(field.value);
    if (isNaN(start.getTime())) return;
    if (Date.now() - start.getTime() < STALE_START_MS) return;
    notify('start_time_passed', 'The start time has passed. Set a new one and run it again.');
  }

  /* ---------- reopening where you left off ---------- */

  // Opening the app with no coverage used to show nothing at all: no route, no
  // forecast, no explanation. Everything needed was already on the device, it just
  // was not put on screen. Restoring the last route makes the cached forecast appear
  // with it, and it is the better behaviour with coverage too.
  async function restoreLastRoute() {
    if (window.lastGPXFile) return;   // a route is already loaded

    // A route arriving by URL or by share wins; do not fight it.
    const params = new URLSearchParams(window.location.search || '');
    if (params.has('gpx_url') || params.has('url') || params.has('shared') || params.has('shared_id')) return;

    // Five seconds is generous for an IndexedDB read and short enough that a first
    // run with nothing stored is not left in silence.
    const routes = await waitFor(() => {
      const list = window.getRecentRoutes ? window.getRecentRoutes() : [];
      return list && list.length ? list : null;
    }, 5000);

    if (!routes) {
      // First run out of coverage: nothing to restore and no way to fetch anything.
      // Saying so beats an empty screen that looks broken.
      if (!window.lastGPXFile && offline()) {
        notify('offline_first_run', 'No connection. You can open a route, but the forecast needs coverage.');
      }
      return;
    }
    if (window.lastGPXFile) return;

    try {
      log('restoring last route', routes[0].name || '');
      await window.loadRecentRoute(routes[0]);
    } catch (e) {
      log('could not restore the last route', e);
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

  // Running the forecast already fills the cache, and the cache now keeps serving it
  // when the device is offline. What this adds is certainty: it tells you the data is
  // there, how much of it, and protects those entries from being cleared when
  // localStorage runs short.
  function prepareForOffline() {
    const utils = window.cw && window.cw.utils;
    if (!utils || !utils.cachedWeatherKeys) return log('cache helpers missing');

    const entries = utils.cachedWeatherKeys();
    const fresh = entries.filter((e) => Date.now() - e.timestamp <= utils.staleMaxAge);

    if (!fresh.length) {
      notify('prepare_offline_empty', 'Load a route and let the forecast appear first.');
      return;
    }

    utils.pinCacheKeys(fresh.map((e) => e.key));
    notify('prepare_offline_done', 'Route saved for offline ({n} points).', { n: fresh.length });
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
    watchConnectivity();
    hideSplash();

    // A route shared from another app takes precedence over the one from last time.
    const arrived = await consumePendingShare();
    if (!arrived) restoreLastRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.cwConsumePendingShare = consumePendingShare;
  window.cwShareCurrentRoute = shareCurrentRoute;
  window.cwPrepareForOffline = prepareForOffline;
})();
