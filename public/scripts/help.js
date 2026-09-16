// Shared by help.html and help_en.html. Lives in a file rather than inline so the
// site can ship a Content-Security-Policy without 'unsafe-inline' for scripts.
(function () {
  // The app-only section is hidden unless this page is being read inside the native
  // shell. The help page does not load native.js — that one wires up the toolbar and
  // the route handling, none of which belongs here — but Capacitor injects its bridge
  // into every page in the web view, so the check is available all the same.
  try {
    const cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      document.documentElement.classList.add('cw-native');

      // On a phone the whole page is too long to scroll through, so the sections
      // arrive closed and the reader gets an index. They are written open, which is
      // what the website shows and what a reader without JavaScript still gets:
      // closing them is the app's doing and happens nowhere else.
      document.querySelectorAll('details.section').forEach((section) => {
        section.open = false;
      });
    }
  } catch (_) { /* a plain browser: leave the section hidden */ }

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
  const pageLang = (document.documentElement.lang || '').toLowerCase();
  const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  if (pageLang.startsWith('es') && browserLang.startsWith('en')) {
    document.title = 'Help - MeteoRide';
  } else if (pageLang.startsWith('en') && browserLang.startsWith('es')) {
    document.title = 'Ayuda - MeteoRide';
  }

  // Version footer, same element and script in both pages: window.CW_VERSION comes from
  // scripts/version.js, generated from mobile/package.json, so there is nothing to keep
  // in sync by hand here.
  const versionEl = document.getElementById('cwVersion');
  if (versionEl) {
    const label = pageLang.startsWith('es') ? 'Versión' : 'Version';
    const fallback = pageLang.startsWith('es') ? 'desconocida' : 'unknown';
    versionEl.textContent = `${label} ${window.CW_VERSION || fallback}`;
  }
})();
