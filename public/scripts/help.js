// Shared by help.html and help_en.html. Lives in a file rather than inline so the
// site can ship a Content-Security-Policy without 'unsafe-inline' for scripts.
(function () {
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
})();
