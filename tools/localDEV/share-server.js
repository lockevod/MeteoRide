// Minimal local share receiver for MeteoRide
// Usage: node share-server.js
// Accepts POST /share (multipart field 'file' or raw GPX body) and stores under ./shared_storage/<id>.gpx
// Responds with 303 redirect to /index.html?shared_id=<id>
// Files are auto-deleted on first GET or after TTL (default 5 minutes)

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8081;
const STORAGE_DIR = path.join(__dirname, 'shared_storage');
const LOG_DIR = path.join(__dirname, 'logs');
// Default TTL for shared files: 2 minutes (configurable via SHARE_TTL_MS in ms or SHARE_TTL_SECONDS)
const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes
let SHARE_TTL_MS = DEFAULT_TTL_MS;
if (process.env.SHARE_TTL_MS) {
  SHARE_TTL_MS = Number(process.env.SHARE_TTL_MS);
} else if (process.env.SHARE_TTL_SECONDS) {
  SHARE_TTL_MS = Number(process.env.SHARE_TTL_SECONDS) * 1000;
}
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const LOGFILE = path.join(LOG_DIR, 'share-server.log');

function appendLog(line) {
  try { fs.appendFileSync(LOGFILE, line + '\n'); } catch (e) { console.warn('log write failed', e); }
}

const app = express();
const upload = multer();

// In-memory cleanup handles for TTL
const cleanupMap = new Map();
function scheduleCleanup(id) {
  if (cleanupMap.has(id)) return;
  const timeout = setTimeout(() => {
    try {
      const p = path.join(STORAGE_DIR, `${id}.gpx`);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        const msg = `TTL deleted ${id}.gpx`;
        console.log(msg);
        appendLog(`${new Date().toISOString()} INFO ${msg}`);
      }
    } catch (e) { appendLog(`${new Date().toISOString()} ERROR TTL delete ${e.message}`); }
    cleanupMap.delete(id);
  }, SHARE_TTL_MS);
  cleanupMap.set(id, timeout);
}
function clearCleanup(id) {
  const t = cleanupMap.get(id);
  if (t) { clearTimeout(t); cleanupMap.delete(id); }
}

// On startup, clean or re-schedule cleanup for existing files left in STORAGE_DIR
function initExistingStorage() {
  try {
    const now = Date.now();
    const files = fs.readdirSync(STORAGE_DIR);
    files.forEach((f) => {
      if (!f.endsWith('.gpx')) return;
      const id = path.basename(f, '.gpx');
      const p = path.join(STORAGE_DIR, f);
      try {
        const st = fs.statSync(p);
        const mtime = st.mtimeMs || (st.mtime && st.mtime.getTime && st.mtime.getTime());
        const age = now - mtime;
        if (age >= SHARE_TTL_MS) {
          fs.unlinkSync(p);
          const msg = `Startup TTL deleted ${f}`;
          console.log(msg);
          appendLog(`${new Date().toISOString()} INFO ${msg}`);
        } else {
          const remaining = SHARE_TTL_MS - age;
          const timeout = setTimeout(() => {
            try {
              if (fs.existsSync(p)) fs.unlinkSync(p);
              const msg = `TTL deleted ${f}`;
              console.log(msg);
              appendLog(`${new Date().toISOString()} INFO ${msg}`);
            } catch (e) { appendLog(`${new Date().toISOString()} ERROR TTL delete ${e.message}`); }
            cleanupMap.delete(id);
          }, remaining);
          cleanupMap.set(id, timeout);
          appendLog(`${new Date().toISOString()} INFO Startup scheduled cleanup ${f} in ${Math.round(remaining)}ms`);
        }
      } catch (e) { appendLog(`${new Date().toISOString()} ERROR inspecting ${f} ${e.message}`); }
    });
  } catch (e) { appendLog(`${new Date().toISOString()} ERROR initExistingStorage ${e.message}`); }
}

// Simple CORS + preflight handling for local testing
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Bypass-Service-Worker');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Log requests and responses
app.use((req, res, next) => {
  const start = Date.now();
  const reqSummary = `${new Date().toISOString()} REQ ${req.method} ${req.originalUrl} from=${req.ip} len=${req.get('content-length')||0}`;
  console.log(reqSummary);
  appendLog(reqSummary);
  res.on('finish', () => {
    const dur = Date.now() - start;
    const resSummary = `${new Date().toISOString()} RES ${req.method} ${req.originalUrl} status=${res.statusCode} dur=${dur}ms`;
    console.log(resSummary);
    appendLog(resSummary);
  });
  next();
});

// NOTE: we do NOT apply a global text body parser because it would consume the
// request stream and break multer/busboy for multipart/form-data requests.
// Instead we parse text bodies on-demand inside the /share route when the
// incoming request is NOT multipart/form-data.

function genId() {
  return crypto.randomBytes(12).toString('base64url'); // short, URL-safe token
}

app.post('/share', (req, res) => {
  // Determine if incoming is multipart/form-data
  const contentType = (req.get('content-type') || '');
  const isMultipart = /multipart\//i.test(contentType);

  if (isMultipart) {
    // Let multer handle the multipart parsing
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('multer error', err);
        appendLog(`${new Date().toISOString()} ERROR multer ${err.message}`);
        return res.status(500).send('Multipart parsing error');
      }
      try {
        let content = null;
        let filename = 'shared.gpx';
        if (req.file && req.file.buffer) {
          content = req.file.buffer.toString('utf8');
          filename = req.file.originalname || filename;
        }
        if (!content) return res.status(400).send('No GPX content received (multipart)');
        handleSaveContent(req, res, content, filename);
      } catch (e) {
        console.error('multipart handler error', e);
        appendLog(`${new Date().toISOString()} ERROR ${e.message}`);
        res.status(500).send('Server error');
      }
    });
  } else {
    // Non-multipart: collect raw body text up to reasonable limit
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      const content = String(body || '').trim();
      if (!content) {
        appendLog(`${new Date().toISOString()} WARN No GPX content received (raw)`);
        return res.status(400).send('No GPX content received');
      }
      try {
        handleSaveContent(req, res, content, 'shared.gpx');
      } catch (e) {
        console.error('raw body handler error', e);
        appendLog(`${new Date().toISOString()} ERROR ${e.message}`);
        res.status(500).send('Server error');
      }
    });
    req.on('error', (e) => {
      console.error('request stream error', e);
      appendLog(`${new Date().toISOString()} ERROR stream ${e.message}`);
      res.status(500).send('Stream error');
    });
  }
});

function handleSaveContent(req, res, content, filename) {
  const id = genId();
  // respect X-File-Name header if present, otherwise original filename
  let providedName = (req.get('X-File-Name') || filename || '').trim();
  if(providedName){
    providedName = providedName.replace(/[^A-Za-z0-9._-]+/g, '_');
    if(!/\.gpx$/i.test(providedName)) providedName = providedName + '.gpx';
  }
  const outName = providedName ? `${id}_${providedName}` : `${id}.gpx`;
  const outPath = path.join(STORAGE_DIR, outName);
  // If the content appears to contain a multipart/form-data envelope (browser boundary + headers)
  // but wasn't parsed (some clients/proxies may alter headers), try to extract the inner file body.
  let finalContent = content;
  try {
    if (/WebKitFormBoundary|Content-Disposition:\s*form-data/i.test(String(content))) {
      // Attempt to capture the file body between the file part headers and the next boundary
      const m = String(content).match(/Content-Disposition: form-data;[\s\S]*?filename=\"[^\"]+\"[\s\S]*?Content-Type:[^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/i);
      if (m && m[1]) {
        finalContent = m[1];
        appendLog(`${new Date().toISOString()} INFO multipart envelope stripped for ${outName || filename}`);
        console.log('multipart envelope detected and stripped before saving');
      }
    }
  } catch (e) { appendLog(`${new Date().toISOString()} ERROR multipart-strip ${e.message}`); }

  fs.writeFileSync(outPath, finalContent, 'utf8');
  scheduleCleanup(id);
  const info = `Saved shared GPX ${outName} size=${Buffer.byteLength(content,'utf8')} name=${filename}`;
  console.log(info);
  appendLog(`${new Date().toISOString()} INFO ${info}`);

  const redirectToShared = `/shared/${encodeURIComponent(outName)}`;
  const indexUrl = `/index.html?shared_id=${encodeURIComponent(id)}`;
  const redirectRequested = req.query && (req.query.follow === '1') || req.get('X-Follow-Redirect') === '1';
  const absoluteBase = req.protocol + '://' + req.get('host');
  const absoluteShared = absoluteBase + redirectToShared;
  const absoluteIndex = absoluteBase + indexUrl;
  if (redirectRequested) {
    res.status(303)
       .set('Location', absoluteShared)
       .set('X-Shared-Index', absoluteIndex)
       .set('X-Shared-Exists','1')
       .send(`Redirecting to ${absoluteShared} (open app: ${absoluteIndex})`);
  } else {
    const payload = { id: id, sharedUrl: redirectToShared, indexUrl: indexUrl, url: absoluteShared, message: `Stored as ${outName}` };
    res.status(201)
       .set('Content-Type','application/json')
       .set('Location', absoluteShared)
       .set('X-Shared-Exists','1')
       .send(JSON.stringify(payload));
  }
}

// Serve stored GPX files with CORS headers. On first GET, stream file and delete it immediately after serving.
app.get('/shared/:id', (req, res) => {
  // The :id path param actually contains the saved filename (possibly like "<id>_originalname.gpx").
  // We must treat it as a filename (no extra .gpx appended) and avoid path traversal.
  const raw = req.params.id || '';
  const filename = path.basename(raw);
  const filePath = path.join(STORAGE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    const msg = `Not found ${filename}`;
    console.warn(msg);
    appendLog(`${new Date().toISOString()} WARN ${msg}`);
    return res.status(404).send('Not found');
  }

  res.set('Content-Type', 'application/gpx+xml');

  // Stream file. By default we do NOT delete after first serve; file is removed by TTL.
  // If caller requests deletion after serve, either pass ?once=1 or header 'X-Delete-After-Serve: 1'.
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    console.error('stream error', err);
    appendLog(`${new Date().toISOString()} ERROR stream ${err.message}`);
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
  // After response finishes, optionally delete file and clear TTL if asked
  res.on('finish', () => {
    try {
      const once = (req.query && req.query.once === '1') || req.get('X-Delete-After-Serve') === '1';
      if (once) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        // Extract the original id token so we clear the same cleanup handle
        const m = filename.match(/^([^_]+)(?:_.*)?$/);
        const idToken = m ? m[1] : filename.replace(/\.gpx$/i, '');
        clearCleanup(idToken);
        const msg = `Served and deleted ${filename}`;
        console.log(msg);
        appendLog(`${new Date().toISOString()} INFO ${msg}`);
      } else {
        const msg = `Served (kept) ${filename}`;
        console.log(msg);
        appendLog(`${new Date().toISOString()} INFO ${msg}`);
      }
    } catch (e) { appendLog(`${new Date().toISOString()} ERROR post-serve delete ${e.message}`); }
  });
});

app.get('/share/:id', (req, res) => {
  const id = req.params.id;
  const indexUrl = `/index.html?shared_id=${encodeURIComponent(id)}`;
  res.status(303).set('Location', indexUrl).send(`Redirecting to ${indexUrl}`);
});

// Delete a shared file explicitly (safe: prevents path traversal)
app.delete('/shared/:filename', (req, res) => {
  const raw = req.params.filename || '';
  const filename = path.basename(raw);
  const filePath = path.join(STORAGE_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) {
      const msg = `Not found ${filename}`;
      appendLog(`${new Date().toISOString()} WARN DEL ${msg}`);
      return res.status(404).send('Not found');
    }
    fs.unlinkSync(filePath);
    // clear TTL handle
    const m = filename.match(/^([^_]+)(?:_.*)?$/);
    const idToken = m ? m[1] : filename.replace(/\.gpx$/i, '');
    clearCleanup(idToken);
    const msg = `Deleted ${filename} via DELETE`;
    console.log(msg);
    appendLog(`${new Date().toISOString()} INFO ${msg}`);
    return res.status(200).send('Deleted');
  } catch (e) {
    appendLog(`${new Date().toISOString()} ERROR delete ${e.message}`);
    return res.status(500).send('Error deleting');
  }
});

app.get('/health', (req, res) => res.send('ok'));

// Init: scan existing storage and schedule cleanups
initExistingStorage();

app.listen(PORT, () => {
  const msg = `share-server listening on http://localhost:${PORT} (TTL ${SHARE_TTL_MS}ms)`;
  console.log(msg);
  appendLog(`${new Date().toISOString()} INFO ${msg}`);
});
