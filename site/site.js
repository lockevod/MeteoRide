// meteoride.cc: language chooser at /, language selector, App Store country, phone menu,
// gallery buttons. No dependencies; every page works without this file.
(function () {
  var LANGS = ['es', 'en', 'ca', 'gl', 'eu', 'fr', 'de', 'it', 'pt'];
  var KEY = 'meteoride-site-lang';
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];

  // Storage can be blocked (private mode, site data off): then it is simply not used.
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function remember(code) { try { localStorage.setItem(KEY, code); } catch (e) { /* not remembered */ } }

  function chooseLanguage(saved, list) {
    if (LANGS.indexOf(saved) >= 0) return saved;
    for (var i = 0; i < list.length; i++) {
      var base = String(list[i]).split('-')[0].toLowerCase();
      if (LANGS.indexOf(base) >= 0) return base;
    }
    return 'en';
  }

  if (document.body.classList.contains('chooser')) {
    location.replace('/' + chooseLanguage(stored(), langs) + '/');
    return;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[hreflang]');
    if (a && LANGS.indexOf(a.getAttribute('hreflang')) >= 0) remember(a.getAttribute('hreflang'));
  });

  // en-GB → gb, es-MX → mx; es-419 or a bare "en" keep the page's default country.
  var region = /-([a-z]{2})(?:-|$)/i.exec(langs[0] || '');
  if (region) {
    document.querySelectorAll('a[data-store]').forEach(function (a) {
      a.href = a.href.replace(/(apps\.apple\.com\/)[a-z]{2}\//, '$1' + region[1].toLowerCase() + '/');
    });
  }

  var toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      document.documentElement.classList.toggle('menu-open', open);
    };
    document.documentElement.classList.add('has-menu');
    toggle.hidden = false;
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
    });
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
  }

  var track = document.querySelector('.gallery-track');
  var buttons = document.querySelector('.gallery-buttons');
  if (track && buttons) {
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    buttons.hidden = false;
    buttons.addEventListener('click', function (e) {
      var b = e.target.closest('[data-gallery]');
      if (b) track.scrollBy({ left: Number(b.dataset.gallery) * track.clientWidth * 0.8, behavior: still ? 'auto' : 'smooth' });
    });
  }
})();
