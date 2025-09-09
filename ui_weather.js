(function () {
// Affordance for horizontal scroll on the weather table (always visible when needed)
  const c = document.getElementById('weatherTableContainer'); // inner scroller
  if (!c) return;
  const w = c.parentElement; // .wtc-wrap (overlay host)

  // Runtime safeguard for small screens (Edge/Safari/iOS quirks)
  try {
    const mq900 = window.matchMedia('(max-width: 900px)');
    const mq700 = window.matchMedia('(max-width: 700px)');
    const applyTA = () => {
      if (mq900.matches) {
        // <=900: enable inertial scrolling on iOS
        c.style.webkitOverflowScrolling = 'touch';
      }
      // <=700: force horizontal pan-only to avoid vertical gesture stealing
      if (mq700.matches) {
        c.style.touchAction = 'pan-x';
      } else if (mq900.matches) {
        c.style.touchAction = 'pan-x pan-y';
      } else {
        c.style.touchAction = 'auto';
      }
    };
    applyTA();
    (mq900.addEventListener ? mq900.addEventListener('change', applyTA) : mq900.addListener(applyTA));
    (mq700.addEventListener ? mq700.addEventListener('change', applyTA) : mq700.addListener(applyTA));
  } catch (_) {}

  function update() {
    const table = c.querySelector('#weatherTable');
    const innerWidth = table ? table.scrollWidth : c.scrollWidth;
    const canScroll = (innerWidth - c.clientWidth) > 2;
    w.classList.toggle('can-scroll', canScroll);
    if (!canScroll) {
      w.classList.remove('at-left','mid','at-right');
      return;
    }
    const atLeft = c.scrollLeft <= 0;
    const atRight = Math.ceil(c.scrollLeft + c.clientWidth) >= innerWidth;
    w.classList.toggle('at-left', atLeft);
    w.classList.toggle('at-right', atRight);
    w.classList.toggle('mid', !atLeft && !atRight);
  }

  c.addEventListener('scroll', update);

  // Wheel -> horizontal scroll helper (trackpads/mice)
  c.addEventListener('wheel', (ev) => {
    const table = c.querySelector('#weatherTable');
    const innerWidth = table ? table.scrollWidth : c.scrollWidth;
    const canScrollX = (innerWidth - c.clientWidth) > 2;
    if (!canScrollX) return;
    if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
      c.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }
  }, { passive: false });

  // drag-to-scroll helper (click-safe with threshold)
  let isDown = false, dragging = false, startX = 0, startLeft = 0;
  const DRAG_THRESH = 6;

  function begin(x) {
    isDown = true;
    dragging = false;
    startX = x;
    startLeft = c.scrollLeft;
  }
  function move(x, ev) {
    if (!isDown) return;
    const dx = x - startX;
    if (!dragging && Math.abs(dx) > DRAG_THRESH) {
      dragging = true;
      c.classList.add('dragging');
      document.body.classList.add('dragging');
    }
    if (dragging) {
      c.scrollLeft = startLeft - dx;
      if (ev) ev.preventDefault(); // only prevent default while dragging
    }
  }
  function end() {
    isDown = false;
    if (dragging) {
      dragging = false;
      c.classList.remove('dragging');
      document.body.classList.remove('dragging');
    }
  }

  // Prefer Pointer Events when available (covers mouse + touch uniformly)
  if (window.PointerEvent) {
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      begin(e.clientX);
      // do NOT preventDefault here to allow clicks if no drag
    }, { passive: true });
    c.addEventListener('pointermove', (e) => move(e.clientX, e), { passive: false });
    const endPtr = () => end();
    c.addEventListener('pointerup', endPtr, { passive: true });
    c.addEventListener('pointercancel', endPtr, { passive: true });
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') end(); }, { passive: true });
  } else {
    // Mouse fallback
    c.addEventListener('mousedown', (e) => begin(e.clientX), { passive: true });
    window.addEventListener('mousemove', (e) => move(e.clientX, e), { passive: false });
    window.addEventListener('mouseup', end, { passive: true });
    // Touch fallback
    c.addEventListener('touchstart', (e) => {
      if (!e.touches?.length) return;
      begin(e.touches[0].clientX);
      // do NOT preventDefault here
    }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      if (!e.touches?.length) return;
      move(e.touches[0].clientX, e);
    }, { passive: false });
    c.addEventListener('touchend', end, { passive: true });
    c.addEventListener('touchcancel', end, { passive: true });
  }

  // ResizeObserver: update on container resize (debounced)
  let resizeTimeout;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(update, 150);
  });
  resizeObserver.observe(c);

  // MutationObserver: detect table changes (for GPX load + interval changes)
  const mutObserver = new MutationObserver(update);
  mutObserver.observe(document.getElementById('weatherTable'), { childList: true, subtree: true });

  // Initial load / timeout fallback
  setTimeout(update, 3000);
})();