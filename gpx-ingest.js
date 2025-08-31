(function () {
  // Verbose flag from ?log=1 or #log=1 (also accepts ingest_log)
  const VERBOSE = (() => {
    const q = new URLSearchParams(window.location.search || "");
    const h = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const v = (h.get("log") || q.get("log") || h.get("ingest_log") || q.get("ingest_log") || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  })();
  const L = {
    info: (...a) => { if (VERBOSE) console.log("[ingest]", ...a); },
    warn: (...a) => console.warn("[ingest]", ...a),
    err:  (...a) => console.error("[ingest]", ...a),
  };
  const snippet = (s, n = 200) => {
    if (typeof s !== "string") return String(s);
    const clean = s.replace(/\s+/g, " ").trim();
    if (clean.length <= n) return clean;
    return clean.slice(0, Math.floor(n / 2)) + " … " + clean.slice(-Math.floor(n / 2));
  };

  const until = (cond, { tries = 120, delay = 250 } = {}) =>
    new Promise((res) => {
      let n = 0;
      const t = setInterval(() => {
        if (cond()) { clearInterval(t); res(true); }
        else if (++n >= tries) { clearInterval(t); res(false); }
      }, delay);
    });

  function getParams() {
    const q = new URLSearchParams(window.location.search || "");
    const hstr = (window.location.hash || "").replace(/^#/, "");
    const h = new URLSearchParams(hstr);
    const get = (k) => h.get(k) ?? q.get(k) ?? null;
    const out = {
      gpx: get("gpx"),
      gpxUrl: get("gpx_url") || get("url"),
      name: get("name") || "Shared route"
    };
    L.info("Params:", {
      hasGpx: !!out.gpx, gpxLen: out.gpx ? out.gpx.length : 0,
      hasGpxUrl: !!out.gpxUrl, name: out.name
    });
    if (out.gpx) L.info("gpx (head/tail):", snippet(out.gpx));
    if (out.gpxUrl) L.info("gpx_url:", out.gpxUrl);
    return out;
  }

  function normalizeB64(b64) {
    // URL-safe to standard + add padding
    let s = String(b64 || "").replace(/-/g, "+").replace(/_/g, "/");
    const mod = s.length % 4;
    if (mod === 2) s += "==";
    else if (mod === 3) s += "=";
    else if (mod === 1) {
      // uncommon, likely not valid base64
      L.warn("Base64 length %4==1; likely invalid input");
    }
    return s;
  }

  // NEW: unwrap common Shortcut wrappers and data URIs
  function sanitizeGpxParam(s) {
    let v = String(s || "").trim();

    // Detect and strip [[...]] placeholder wrappers (from documentation examples)
    if (/^\[\[/.test(v) && /\]\]$/.test(v)) {
      L.warn("Detected [[...]] wrapper in gpx param; stripping placeholders (use tokens in Atajos, not [[var]]).");
      v = v.replace(/^\[\[/, "").replace(/\]\]$/, "");
    }

    // Strip surrounding single/double quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      L.info("Stripping surrounding quotes in gpx param");
      v = v.slice(1, -1);
    }

    // If a data: URI was passed, split it
    const m = /^data:([^;,]+);base64,(.*)$/i.exec(v);
    if (m) {
      L.info("Detected data: URI with base64; extracting payload. Content-Type:", m[1]);
      v = m[2];
    }

    // Trim whitespace/newlines that may break base64
    v = v.replace(/\s+/g, "");

    // Log head/tail after sanitize
    L.info("Sanitized gpx param (head/tail):", snippet(v));
    return v;
  }

  function tryDecodeBase64(b64) {
    try {
      const norm = normalizeB64(b64);
      const txt = atob(norm);
      // decode as UTF‑8
      const bytes = Uint8Array.from(txt, c => c.charCodeAt(0));
      const out = new TextDecoder("utf-8").decode(bytes);
      L.info("Base64 decoded length:", out.length);
      return out;
    } catch (e) {
      L.warn("Base64 decode failed:", e && e.message);
      return null;
    }
  }

  function looksLikeXmlText(s) {
    if (!s) return false;
    if (s.includes("<gpx")) return true;
    if (/%3Cgpx/i.test(s)) return true; // URL-encoded "<gpx"
    if (/^\s*</.test(s)) return true;
    return false;
  }

  function tryDecodeText(s) {
    try {
      // Try URL-decoding if it contains typical encodings
      const needs = /%[0-9a-f]{2}/i.test(s) || /\+/.test(s);
      const dec = needs ? decodeURIComponent(s.replace(/\+/g, "%20")) : s;
      L.info("URI text decode attempted:", needs);
      return dec;
    } catch (e) {
      L.warn("URI decode failed:", e && e.message);
      return s;
    }
  }

  async function fetchText(url) {
    L.info("Fetching GPX URL:", url);
    const res = await fetch(url);
    const ct = res.headers.get("content-type");
    const txt = await res.text();
    L.info("Fetch result:", { ok: res.ok, status: res.status, contentType: ct || "?", length: txt.length, sample: snippet(txt) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return txt;
  }

  function hasParsableGpxText(txt) {
    if (typeof txt !== "string") return false;
    return /<trkpt\b/i.test(txt) || /<rtept\b/i.test(txt) || /<wpt\b/i.test(txt) || /<trk\b/i.test(txt) || /<rte\b/i.test(txt);
  }

  async function loadFromParams() {
    const { gpx, gpxUrl, name } = getParams();
    if (!gpx && !gpxUrl) {
      L.info("No gpx or gpx_url params found. Nothing to ingest.");
      return;
    }

    // Log readiness attempts
    let tries = 0;
    const ready = await (new Promise((res) => {
      const t = setInterval(() => {
        tries++;
        const ok = typeof window.cwLoadGPXFromString === "function";
        if (ok || tries >= 120) { clearInterval(t); res(ok); }
      }, 250);
    }));
    L.info("cwLoadGPXFromString ready:", ready, "after tries:", tries);
    if (!ready) L.warn("cwLoadGPXFromString not found after wait; proceeding anyway (may fail).");

    try {
      if (gpxUrl) {
        const txt = await fetchText(gpxUrl);
        if (!txt || !txt.includes("<gpx")) {
          L.err("Fetched content does not look like GPX:", snippet(txt));
          throw new Error("Fetched content is not GPX");
        }
        // Expose for debugging
        window.__lastIngest = { source: "gpx_url", name, length: txt.length, sample: snippet(txt), when: Date.now() };
        L.info("Calling loader from gpx_url, name:", name);
        window.cwLoadGPXFromString && window.cwLoadGPXFromString(txt, name);
        return;
      }

      // gpx param present
      L.info("Processing inline gpx param…");
      const gpxClean = sanitizeGpxParam(gpx);

      let decoded = null;
      if (looksLikeXmlText(gpxClean)) {
        L.info("gpx looks like XML or URL-encoded XML; trying text path");
        decoded = tryDecodeText(gpxClean);
      } else {
        L.info("gpx does not look like XML; trying Base64 path");
        decoded = tryDecodeBase64(gpxClean);
        if (!decoded || !decoded.includes("<gpx")) {
          L.info("Base64 path did not yield XML; trying text decode as fallback");
          decoded = tryDecodeText(gpxClean);
        }
      }

      if (!decoded || !decoded.includes("<gpx")) {
        L.err("Invalid GPX payload after decode attempts. Sample:", snippet(decoded || gpxClean));
        throw new Error("Invalid GPX payload");
      }

      // Detecciones adicionales: posible truncado / sin capas parseables
      const len = decoded.length;
      const parseable = hasParsableGpxText(decoded);
      if (len < 500 || !parseable) {
        L.warn("Decoded GPX looks very small or has no trk/rte/wpt. length:", len, "parseable:", parseable);
      }

      // Expose last decoded payload for inspection
      window.__lastIngest = {
        source: "gpx_inline",
        name,
        length: len,
        sample: snippet(decoded),
        text: decoded,            // texto completo para inspección en DevTools
        parseable,
        when: Date.now()
      };

      L.info("Decoded GPX OK. Length:", len, "Sample:", snippet(decoded));
      L.info("Calling loader with inline gpx, name:", name);
      window.cwLoadGPXFromString && window.cwLoadGPXFromString(decoded, name);
    } catch (e) {
      L.err("GPX ingest error:", e);
    }
  }

  // Run once on load; Shortcuts usually open the URL with hash/query
  if (document.readyState === "complete" || document.readyState === "interactive") {
    loadFromParams();
  } else {
    window.addEventListener("DOMContentLoaded", loadFromParams, { once: true });
  }
})();
