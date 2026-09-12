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
        if (state && state.isActive) consumePendingShare();
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
    const base = String(name || 'route.gpx').replace(/[^A-Za-z0-9._ -]+/g, '-').trim();
    return /\.(gpx|kml)$/i.test(base) ? base : `${base || 'route'}.gpx`;
  }

  async function shareCurrentRoute() {
    const { Share, Filesystem } = plugins;
    if (!Share || !Filesystem) return log('share plugins missing');

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
    btn.title = 'Send route to another app';
    btn.setAttribute('aria-label', 'Send route to another app');
    btn.innerHTML = '<span aria-hidden="true">\u{1F4E4}</span>';
    btn.addEventListener('click', shareCurrentRoute);
    nav.insertBefore(btn, nav.firstChild);
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

  function boot() {
    setupChrome();
    setupApp();
    setupShareEvents();
    addShareButton();
    setupLinks();
    consumePendingShare();
    hideSplash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.cwConsumePendingShare = consumePendingShare;
  window.cwShareCurrentRoute = shareCurrentRoute;
})();
