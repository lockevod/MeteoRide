// Shared by help.html and help_en.html. Lives in a file rather than inline so the
// site can ship a Content-Security-Policy without 'unsafe-inline' for scripts. Loaded
// from <head>, ahead of the stylesheet, so the native check below runs before the page
// paints — .web-only and the disclosure markers key off the class it sets, and waiting
// until the end of the body (as this used to) let the untouched page flash first.
(function () {
  // The app-only section is hidden unless this page is being read inside the native
  // shell. The help page does not load native.js — that one wires up the toolbar and
  // the route handling, none of which belongs here — but Capacitor injects its bridge
  // into every page in the web view, so the check is available all the same. This part
  // only touches <html> itself, which exists as soon as the parser reaches this script,
  // so it runs immediately rather than waiting for the rest of the body below.
  let isNative = false;
  let platform = '';
  try {
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      isNative = true;
      document.documentElement.classList.add('cw-native');
      // The privacy policy is one document per platform, because that is what each
      // store's form links to and a reviewer should not have to skip past the other
      // two. The link below is pointed at the right one once the body exists.
      platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    }
  } catch (_) { /* a plain browser: leave the section hidden */ }

  // Everything past this point reads elements further down the page, which do not
  // exist yet this early — so it waits for the parser to reach them.
  function whenBodyReady() {
    if (isNative) {
      // On a phone the whole page is too long to scroll through, so the sections
      // arrive closed and the reader gets an index. They are written open, which is
      // what the website shows and what a reader without JavaScript still gets:
      // closing them is the app's doing and happens nowhere else.
      document.querySelectorAll('details.section').forEach((section) => {
        section.open = false;
      });
    }

    // Written as the website's policy so a reader without JavaScript, and every
    // search engine, gets a working link; inside the app it becomes the platform's.
    const privacyLink = document.getElementById('privacyLink');
    if (privacyLink && (platform === 'ios' || platform === 'android')) {
      privacyLink.setAttribute('href', `privacy-${platform}.html?return=true`);
    }

    // A policy links to the other two. Without carrying the parameter over, the next
    // page decides it was not opened from the app and hides its own back button, which
    // on iOS leaves the reader with no way back at all.
    if (new URLSearchParams(window.location.search).get('return') === 'true') {
      document.querySelectorAll('a[href^="privacy-"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!href.includes('return=')) a.setAttribute('href', `${href}${href.includes('?') ? '&' : '?'}return=true`);
      });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('return') === 'true') {
      const backBtn = document.getElementById('backBtn');
      if (backBtn) {
        backBtn.style.display = 'inline-block';
        backBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = 'index.html';
          }
        });
      }
    }

    // Keep the tab title in the reader's language when they landed on the other page.
    // Only the help exists as two pages, one per language; the privacy policies borrow
    // this script for the back button and the footer but carry both languages at once,
    // so they must keep their own titles. Hence the marker rather than a bare lang check.
    const pageLang = (document.documentElement.lang || '').toLowerCase();
    const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (document.body.dataset.page === 'help') {
      if (pageLang.startsWith('es') && browserLang.startsWith('en')) {
        document.title = 'Help - MeteoRide';
      } else if (pageLang.startsWith('en') && browserLang.startsWith('es')) {
        document.title = 'Ayuda - MeteoRide';
      }
    }

    // Version footer, same element and script in both pages: window.CW_VERSION comes
    // from scripts/version.js, generated from mobile/package.json, so there is nothing
    // to keep in sync by hand here.
    const versionEl = document.getElementById('cwVersion');
    if (versionEl) {
      const label = pageLang.startsWith('es') ? 'Versión' : 'Version';
      const fallback = pageLang.startsWith('es') ? 'desconocida' : 'unknown';
      versionEl.textContent = `${label} ${window.CW_VERSION || fallback}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', whenBodyReady);
  } else {
    whenBodyReady();
  }
})();
