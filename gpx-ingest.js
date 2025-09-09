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

  // Convert URL-safe base64 (or normal) into Uint8Array
  function base64UrlToUint8Array(s) {
    try {
      const norm = normalizeB64(s);
      const bin = atob(norm);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) {
      L.warn("base64->Uint8Array failed:", e && e.message);
      return null;
    }
  }

  // Try to decode an encoded GPX that may be compressed (gzip/zlib) or plain text.
  // Returns string GPX or null.
  function decodeHashGPX(enc) {
    if (!enc) return null;
    let input = enc;
    try { input = decodeURIComponent(enc); } catch (_) { /* ignore */ }
    // If it already looks like XML, return early
    if (looksLikeXmlText(input)) return tryDecodeText(input);

    const bytes = base64UrlToUint8Array(input);
    if (!bytes) return null;

    // gzip magic 0x1f 0x8b
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && window.pako?.ungzip) {
      try { L.info("Detected gzip bytes, attempting ungzip"); return window.pako.ungzip(bytes, { to: "string" }); }
      catch (e) { L.warn("gzip ungzip failed:", e && e.message); }
    }
    // zlib/deflate (starts often with 0x78)
    if (bytes.length > 2 && bytes[0] === 0x78 && window.pako?.inflate) {
      try { L.info("Detected zlib/deflate bytes, attempting inflate"); return window.pako.inflate(bytes, { to: "string" }); }
      catch (e) { L.warn("zlib inflate failed:", e && e.message); }
    }

    // Heuristic UTF-16 detection (lots of NULs)
    try {
      let zerosEven = 0, zerosOdd = 0, limit = Math.min(bytes.length, 2000);
      for (let i = 0; i < limit; i++) {
        if (bytes[i] === 0) { if ((i & 1) === 0) zerosEven++; else zerosOdd++; }
      }
      if (zerosEven > zerosOdd && zerosEven > limit * 0.2) {
        try { L.info("Heuristic UTF-16LE detected"); return new TextDecoder("utf-16le").decode(bytes); } catch(e){}
      } else if (zerosOdd > zerosEven && zerosOdd > limit * 0.2) {
        try { L.info("Heuristic UTF-16BE detected"); return new TextDecoder("utf-16be").decode(bytes); } catch(e){}
      }
    } catch (e) { L.warn("UTF-16 heuristic failed", e && e.message); }

    // Fallback to UTF-8 decode
    try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { L.warn("TextDecoder utf-8 failed", e && e.message); }

    // Last resort: atob decode (should match base64->string)
    try { return atob(normalizeB64(input)); } catch (_) { return null; }
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
    // Improved: try compressed-aware decode first
    try {
      const out = decodeHashGPX(b64);
      if (out) {
        L.info("Smart base64 decode succeeded, len:", out.length);
        return out;
      }
      // fallback: try atob->utf8
      const norm = normalizeB64(b64);
      const bin = atob(norm);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const out2 = new TextDecoder("utf-8").decode(bytes);
      return out2;
    } catch (e) {
      L.warn("tryDecodeBase64 failed:", e && e.message);
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

      // Prefer the smart decoder that handles gzip/zlib/base64/utf16/urlencoded
      let decoded = decodeHashGPX(gpxClean);
      if (!decoded || !decoded.includes("<gpx")) {
        // If decodeHashGPX failed, try plain text decode (URL decode)
        decoded = tryDecodeText(gpxClean);
      }

      // As last fallback, try simple base64 decode path (already covered by decodeHashGPX usually)
      if ((!decoded || !decoded.includes("<gpx")) && !looksLikeXmlText(gpxClean)) {
        decoded = tryDecodeBase64(gpxClean);
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

  // expose decoder for debug / UI usage
  window.decodeHashGPX = decodeHashGPX;

  // Console utilities: inspect an encoded GPX string and optionally copy decoded GPX to clipboard.
  (function exposeConsoleUtils(){
    window.cw = window.cw || {};
    window.cw.utils = window.cw.utils || {};

    // Inspect encoded payload: returns details useful for debugging Shortcuts/URL payloads.
    window.cw.utils.inspectEncodedGPX = function (enc) {
      try {
        const orig = String(enc || "");
        const triedDecodeURI = (() => { try { return decodeURIComponent(orig); } catch(_) { return orig; } })();
        const normalized = triedDecodeURI.replace(/\s+/g, "");
        const bytes = base64UrlToUint8Array(normalized);
        const hex = bytes ? Array.from(bytes.slice(0,20)).map(b => b.toString(16).padStart(2,'0')).join(' ') : null;
        const isGzip = !!(bytes && bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b);
        const isZlib = !!(bytes && bytes.length > 2 && bytes[0] === 0x78);
        const utf16Heuristic = (() => {
          if (!bytes) return false;
          let zerosEven = 0, zerosOdd = 0, lim = Math.min(bytes.length, 2000);
          for (let i=0;i<lim;i++){ if (bytes[i]===0) { if ((i&1)===0) zerosEven++; else zerosOdd++; } }
          return (zerosEven>zerosOdd && zerosEven>lim*0.2) || (zerosOdd>zerosEven && zerosOdd>lim*0.2);
        })();
        const decoded = decodeHashGPX(orig) || null;
        const isXml = !!(decoded && /<gpx\b/i.test(decoded));
        const parseable = !!(decoded && /<trk\b|<rte\b|<wpt\b/i.test(decoded));
        return {
          inputPreview: orig.slice(0,400),
          triedDecodeURI: triedDecodeURI.slice(0,400),
          bytesLength: bytes ? bytes.length : null,
          hexPreview: hex,
          isGzip,
          isZlib,
          utf16Heuristic,
          decodedLength: decoded ? decoded.length : null,
          decodedSnippet: decoded ? decoded.slice(0,800) : null,
          isXml,
          parseable
        };
      } catch (e) {
        return { error: String(e && e.message ? e.message : e) };
      }
    };

    // Copy decoded GPX to clipboard (returns Promise). Useful to quickly inspect result.
    window.cw.utils.copyDecodedGPXToClipboard = async function(enc) {
      try {
        const info = window.cw.utils.inspectEncodedGPX(enc);
        if (!info.decodedSnippet) throw new Error("no_decoded_gpx");
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("clipboard_not_supported");
        await navigator.clipboard.writeText(info.decodedSnippet);
        return { ok: true, message: "decoded copied" };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    };
  })();

   // Run once on load; Shortcuts usually open the URL with hash/query
   if (document.readyState === "complete" || document.readyState === "interactive") {
     loadFromParams();
   } else {
     window.addEventListener("DOMContentLoaded", loadFromParams, { once: true });
   }
 })();
