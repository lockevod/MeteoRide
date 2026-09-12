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
      window.open(href, '_blank');
    }, true);
  }

  /* ---------- boot ---------- */

  function boot() {
    setupChrome();
    setupApp();
    setupShareEvents();
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
})();
