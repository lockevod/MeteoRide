// --- BEGIN: console → debugConsole bridge ---
(function(){
  function toText(v){
    if (v == null) return String(v);
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch(e) { return String(v); }
  }
  function ensureEl(){ return document.getElementById('debugConsole'); }
  window.logdebug = function(...args){
      // ensure toolbar
      try {
        const sec = document.getElementById('debugSection');
        const con = document.getElementById('debugConsole');
        if (sec && con && !document.getElementById('debugToolbar')) {
          const bar = document.createElement('div');
          bar.id = 'debugToolbar';
          bar.style.cssText = 'display:flex;gap:8px;align-items:center;background:#111;color:#eee;padding:6px 8px;border-bottom:1px solid #333;position:sticky;top:0;';

          const clearBtn = document.createElement('button');
          clearBtn.textContent = 'Clear';
          clearBtn.style.cssText = 'padding:2px 8px;border-radius:4px;border:1px solid #444;background:#222;color:#eee;';
          clearBtn.addEventListener('click', () => { con.textContent = ''; });

          const copyBtn = document.createElement('button');
          copyBtn.textContent = 'Copy';
          copyBtn.style.cssText = clearBtn.style.cssText;
          copyBtn.addEventListener('click', async () => {
            const text = con.innerText || '';
            try {
              await navigator.clipboard.writeText(text);
              console.log('[debug] Copiado al portapapeles');
            } catch(err) {
              try {
                const ta = document.createElement('textarea');
                ta.value = text; ta.setAttribute('readonly','');
                ta.style.position='absolute'; ta.style.left='-9999px';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                console.log('[debug] Copiado (fallback)');
              } catch(e){ console.error('No se pudo copiar:', e); }
            }
          });

          const resetBtn = document.createElement('button');
          resetBtn.textContent = 'Reset';
          resetBtn.style.cssText = clearBtn.style.cssText;
          resetBtn.addEventListener('click', () => {
            const secEl = document.getElementById('debugSection');
            if (secEl) {
              secEl.style.width = '380px';
              secEl.style.height = '220px';
            }
            try {
              sessionStorage.removeItem('cw_debug_w');
              sessionStorage.removeItem('cw_debug_h');
            } catch(_) {}
          });

          const label = document.createElement('label');
          label.style.cssText = 'font:12px -apple-system,system-ui;display:inline-flex;gap:6px;align-items:center;';
          const ck = document.createElement('input');
          ck.type = 'checkbox';
          ck.id = 'debugAutoOpen';
          ck.checked = (sessionStorage.getItem('cw_debug_auto_open') ?? '1') !== '0';
          ck.addEventListener('change', () => sessionStorage.setItem('cw_debug_auto_open', ck.checked ? '0' : '0'));
          const sp = document.createElement('span');
          sp.textContent = 'Auto-open';
          //label.appendChild(ck); label.appendChild(sp);

          bar.appendChild(clearBtn);
          bar.appendChild(copyBtn);
          bar.appendChild(resetBtn);
          bar.appendChild(label);
          sec.insertBefore(bar, sec.firstChild);
        }
      } catch(_) {}

      // helpers to open/close debug panel
      try {
        window.openDebug = function(){
          const sec = document.getElementById('debugSection');
          if (sec && sec.hasAttribute('hidden')) sec.removeAttribute('hidden');
        };
        window.closeDebug = function(){
          const sec = document.getElementById('debugSection');
          if (sec && !sec.hasAttribute('hidden')) sec.setAttribute('hidden','');
        };
      } catch(_) {}
    try {
      const el = ensureEl();
      if (!el) return;
      const line = args.map(toText).join(' ');
      const row = document.createElement('div');
      row.textContent = `[${new Date().toISOString()}] ${line}`;
      el.appendChild(row);
      el.scrollTop = el.scrollHeight;
    } catch(e) { /* ignore */ }
    // auto-open debug panel on first log if pref enabled
    try {
      const auto = (sessionStorage.getItem('cw_debug_auto_open') ?? '1') !== '0';
      if (auto) window.openDebug && window.openDebug();
    } catch(_) {}
  };
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    trace: console.trace ? console.trace.bind(console) : console.log.bind(console),
    group: console.group ? console.group.bind(console) : console.log.bind(console),
    groupEnd: console.groupEnd ? console.groupEnd.bind(console) : () => {},
    table: console.table ? console.table.bind(console) : console.log.bind(console),
    assert: console.assert ? console.assert.bind(console) : () => {}
  };
  // Override all console methods to also log to debug
  ['log','warn','error','info','debug','trace','group','groupEnd','table','assert'].forEach(fn => {
    console[fn] = function(...args){
      try { orig[fn](...args); } catch(_){ }
      try { window.logdebug(...args); } catch(_){ }
    };
  });

  // Capture uncaught errors
  window.onerror = function(message, source, lineno, colno, error) {
    try { window.logdebug('Uncaught Error:', message, 'at', source + ':' + lineno + ':' + colno, error); } catch(_){ }
  };

  // Capture unhandled promise rejections
  window.onunhandledrejection = function(event) {
    try { window.logdebug('Unhandled Promise Rejection:', event.reason); } catch(_){ }
  };

  // Optional: toggle debug panel if the button exists
  try {
    const btn = document.getElementById('toggleDebug');
    const sec = document.getElementById('debugSection');
    if (btn && sec) {
      btn.addEventListener('click', () => {
        const hidden = sec.hasAttribute('hidden');
        if (hidden) sec.removeAttribute('hidden'); else sec.setAttribute('hidden','');
      });
    }
  } catch(_){}
  // Resizer (JS-driven, iOS/desktop)
  try {
  const sec = document.getElementById('debugSection');
  if (sec && !document.getElementById('debugResizerLeft') && !document.getElementById('debugResizerRight')) {
    const leftGrip = document.createElement('div');
    leftGrip.id = 'debugResizerLeft';
    const rightGrip = document.createElement('div');
    rightGrip.id = 'debugResizerRight';
    sec.appendChild(leftGrip);
    sec.appendChild(rightGrip);

    // restore saved size
    const w = sessionStorage.getItem('cw_debug_w');
    const h = sessionStorage.getItem('cw_debug_h');
    if (w) sec.style.width = w; if (h) sec.style.height = h;

    const start = {x:0,y:0,w:0,h:0};

    const onMoveLeft = (e)=>{
      const px = e.touches ? e.touches[0].clientX : e.clientX;
      const py = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = (start.x - px);   // drag left => wider
      const dy = (py - start.y);   // drag down => taller
      const nw = Math.max(280, Math.round(start.w + dx));
      const nh = Math.max(140, Math.round(start.h + dy));
      sec.style.width = nw + 'px';
      sec.style.height = nh + 'px';
    };
    const onMoveRight = (e)=>{
      const px = e.touches ? e.touches[0].clientX : e.clientX;
      const py = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = (px - start.x);   // drag right => wider
      const dy = (py - start.y);   // drag down  => taller
      const nw = Math.max(280, Math.round(start.w + dx));
      const nh = Math.max(140, Math.round(start.h + dy));
      sec.style.width = nw + 'px';
      sec.style.height = nh + 'px';
    };
    const onUp = ()=>{
      document.removeEventListener('mousemove', onMoveLeft);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMoveLeft);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('mousemove', onMoveRight);
      document.removeEventListener('touchmove', onMoveRight);
      try { sessionStorage.setItem('cw_debug_w', sec.style.width); sessionStorage.setItem('cw_debug_h', sec.style.height); } catch(_){ }
    };
    const onDown = (moveHandler)=>(e)=>{
      e.preventDefault();
      start.x = e.touches ? e.touches[0].clientX : e.clientX;
      start.y = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = sec.getBoundingClientRect();
      start.w = rect.width; start.h = rect.height;
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', moveHandler, {passive:false});
      document.addEventListener('touchend', onUp, {passive:false});
    };

    const resetSize = () => {
      sec.style.width = '380px';
      sec.style.height = '220px';
      try { sessionStorage.removeItem('cw_debug_w'); sessionStorage.removeItem('cw_debug_h'); } catch(_) {}
    };

    leftGrip.addEventListener('mousedown', onDown(onMoveLeft));
    leftGrip.addEventListener('touchstart', onDown(onMoveLeft), {passive:false});
    leftGrip.addEventListener('dblclick', resetSize);

    rightGrip.addEventListener('mousedown', onDown(onMoveRight));
    rightGrip.addEventListener('touchstart', onDown(onMoveRight), {passive:false});
    rightGrip.addEventListener('dblclick', resetSize);
  }
} catch(_) {}

})();