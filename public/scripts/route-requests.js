/* The route coordinator: which route the user last asked to see, and nothing else.

   Every way a route arrives goes through requestRoute, which takes its identity before
   any wait, reads the text, parses it off the map and only then confirms it. A request
   that a later one has replaced stops at its next wait and touches nothing. Settings
   changed while a request is still acquiring are remembered and consumed by the next
   computation, so confirming and reconciling cannot launch two. The loading indicator
   is on while anyone holds a claim on it. Keeping a route among the recent ones is a
   separate queue, in arrival order, that does not care which route is on screen.

   A plain script, like forecast-rules.js: the page builds one coordinator wired to
   app.js and ui.js at runtime, and Node tests build their own with fake dependencies.
*/
var cwCreateRouteCoordinator = function (deps) {
  'use strict';

  const readTimeoutMs = deps.readTimeoutMs == null ? 30000 : deps.readTimeoutMs;
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;

  let lastRequestId = 0;
  let lastFinished = true;
  let pendingSettings = false;
  const owners = new Set();

  /* ---------- loading indicator ---------- */

  function claimLoading(owner) {
    if (owners.has(owner)) return;
    owners.add(owner);
    if (owners.size === 1) deps.paintLoading(true);
  }

  function releaseLoading(owner) {
    if (owners.delete(owner) && owners.size === 0) deps.paintLoading(false);
  }

  function releaseLoadingPrefix(prefix, except) {
    let released = false;
    for (const owner of [...owners]) {
      if (owner !== except && String(owner).startsWith(prefix)) {
        owners.delete(owner);
        released = true;
      }
    }
    if (released && owners.size === 0) deps.paintLoading(false);
  }

  /* ---------- computations ---------- */

  function startForecast() {
    if (!deps.hasConfirmedRoute()) return;
    pendingSettings = false;
    deps.launch();
  }

  function settingsChanged() {
    pendingSettings = true;
    if (lastFinished) startForecast();
  }

  /* ---------- requests ---------- */

  function withDeadline(read) {
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => reject(new Error('route read timed out')), readTimeoutMs);
      Promise.resolve().then(read).then(
        (value) => { clearTimer(timer); resolve(value); },
        (err) => { clearTimer(timer); reject(err); }
      );
    });
  }

  async function acquireParseCommit(id, source, read) {
    let got;
    try {
      got = await withDeadline(read);
    } catch (_) {
      if (id !== lastRequestId) return 'superseded';
      deps.notifyFailed();
      return 'failed';
    }
    if (id !== lastRequestId) return 'superseded';
    if (got == null) return 'failed';   // nothing to open, e.g. a first run with no recents

    let parsed = null;
    try {
      parsed = await deps.parse({ text: got.text, name: got.name, source, requestId: id });
    } catch (_) { parsed = null; }
    if (id !== lastRequestId) return 'superseded';
    if (!parsed) {
      deps.notifyFailed();
      return 'failed';
    }

    // No wait between confirming and launching its computation.
    deps.commit(parsed, id);
    startForecast();
    return 'committed';
  }

  async function requestRoute({ source, read }) {
    const id = ++lastRequestId;
    lastFinished = false;
    const owner = 'request:' + id;
    claimLoading(owner);
    releaseLoadingPrefix('request:', owner);
    let status;
    try {
      status = await acquireParseCommit(id, source, read);
      return status;
    } finally {
      releaseLoading(owner);
      if (id === lastRequestId) {
        lastFinished = true;
        // A confirmation has just launched with no wait since; reconciling it again
        // could only relaunch a computation that failed on the spot.
        if (status !== 'committed' && deps.hasConfirmedRoute()
            && (pendingSettings || !deps.hasCurrentForecast())) {
          startForecast();
        }
      }
    }
  }

  /* ---------- importing into recent routes ---------- */

  // Imports run one at a time, in the order they arrived, however long each write takes.
  // arrivedAt is fixed on arrival and is what the store keeps, so trimming to the newest
  // routes keeps the last to arrive even when an earlier write finishes later. An import
  // is independent of the request showing the same route: it goes on whatever that ends as.
  let importQueue = Promise.resolve();
  let lastArrivedAt = 0;

  function importRoute({ text, name, arrivedAt }) {
    const at = arrivedAt != null ? arrivedAt : Math.max(Date.now(), lastArrivedAt + 1);
    lastArrivedAt = Math.max(lastArrivedAt, at);
    const job = importQueue.then(async () => {
      let result = null;
      try {
        result = await deps.writeRecent({ text, name, arrivedAt: at, fingerprint: cwForecastRules.fingerprint(text) });
      } catch (_) { result = null; }
      if (!result || !result.ok) {
        deps.notifyNotSaved();
        return { ok: false, name };
      }
      return result;
    });
    importQueue = job;
    return job;
  }

  return {
    requestRoute, settingsChanged, startForecast, importRoute,
    claimLoading, releaseLoading, releaseLoadingPrefix: (prefix) => releaseLoadingPrefix(prefix),
  };
};

// The page's coordinator. Everything it calls lives in app.js and ui.js, which load
// later, so it only looks them up when a request or a setting needs them.
(function () {
  if (typeof window === 'undefined') return;
  const t = (key) => (window.t ? window.t(key) : key);
  const coordinator = cwCreateRouteCoordinator({
    parse: (input) => window.cwParseRoute(input),
    commit: (parsed, requestId) => window.cwCommitRoute(parsed, requestId),
    launch: () => window.cwLaunchComputation(),
    hasConfirmedRoute: () => !!(window.cwHasConfirmedRoute && window.cwHasConfirmedRoute()),
    hasCurrentForecast: () => !!(window.cwHasCurrentForecast && window.cwHasCurrentForecast()),
    paintLoading: (visible) => { if (window.cw.ui && window.cw.ui.paintLoading) window.cw.ui.paintLoading(visible); },
    notifyFailed: () => { if (window.setNotice) window.setNotice(t('route_load_failed'), 'error'); },
    writeRecent: (input) => window.cwIdbImportRoute(input),
    notifyNotSaved: () => { if (window.setNotice) window.setNotice(t('route_not_saved'), 'warn'); },
  });
  window.cw = window.cw || {};
  Object.assign(window.cw, {
    requestRoute: coordinator.requestRoute,
    settingsChanged: coordinator.settingsChanged,
    startForecast: coordinator.startForecast,
    claimLoading: coordinator.claimLoading,
    releaseLoading: coordinator.releaseLoading,
    releaseLoadingPrefix: coordinator.releaseLoadingPrefix,
    importRoute: coordinator.importRoute,
  });
})();
