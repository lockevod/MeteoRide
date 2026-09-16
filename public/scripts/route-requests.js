/* The route coordinator: which route the user last asked to see, and nothing else.

   Every way a route arrives goes through requestRoute, which takes its identity before
   any wait, reads the text, parses it off the map and only then confirms it. A request
   that a later one has replaced stops at its next wait and touches nothing. Settings
   changed while a request is still acquiring are remembered and consumed by the next
   computation, so confirming and reconciling cannot launch two. The loading indicator
   is on while anyone holds a claim on it. Keeping a route among the recent ones is a
   separate queue, in arrival order, that does not care which route is on screen.

   A request never rejects: whatever a dependency throws is logged, and the request still
   ends as 'committed', 'superseded' or 'failed', with its claim let go.

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

  function guard(what, fn) {
    try {
      return fn();
    } catch (err) {
      console.warn(`[MeteoRide] route coordinator: ${what} failed`, err);
      return undefined;
    }
  }

  /* ---------- loading indicator ---------- */

  const paint = (visible) => guard('paintLoading', () => deps.paintLoading(visible));

  function claimLoading(owner) {
    if (owners.has(owner)) return;
    owners.add(owner);
    if (owners.size === 1) paint(true);
  }

  function releaseLoading(owner) {
    if (owners.delete(owner) && owners.size === 0) paint(false);
  }

  function releaseLoadingPrefix(prefix, except) {
    let released = false;
    for (const owner of [...owners]) {
      if (owner !== except && String(owner).startsWith(prefix)) {
        owners.delete(owner);
        released = true;
      }
    }
    if (released && owners.size === 0) paint(false);
  }

  /* ---------- computations ---------- */

  function startForecast() {
    guard('launch', () => {
      if (!deps.hasConfirmedRoute()) return;
      pendingSettings = false;
      deps.launch();
    });
  }

  function settingsChanged() {
    pendingSettings = true;
    if (lastFinished) startForecast();
  }

  /* ---------- requests ---------- */

  // The read starts on the next microtask, so a request replaced in the same tick never reads.
  function withDeadline(id, read) {
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => reject(new Error('route read timed out')), readTimeoutMs);
      Promise.resolve().then(() => (id === lastRequestId ? read() : null)).then(
        (value) => { clearTimer(timer); resolve(value); },
        (err) => { clearTimer(timer); reject(err); }
      );
    });
  }

  // 'committed', 'superseded', 'failed' (nothing to open), or a failure the request ending
  // says: 'unreadable' or 'unusable'.
  async function acquireParseCommit(id, source, read) {
    let got;
    try {
      got = await withDeadline(id, read);
    } catch (_) {
      return id !== lastRequestId ? 'superseded' : 'unreadable';
    }
    if (id !== lastRequestId) return 'superseded';
    if (got == null) return 'failed';   // nothing to open, e.g. a first run with no recents

    let parsed = null;
    try {
      parsed = await deps.parse({ text: got.text, name: got.name, source, requestId: id });
    } catch (_) { parsed = null; }
    if (id !== lastRequestId) return 'superseded';
    if (!parsed) return 'unusable';

    // No wait between confirming and launching its computation. A commit that throws may
    // have left the route half on screen, so it still counts as confirmed and computed.
    guard('commit', () => deps.commit(parsed, id));
    startForecast();
    return 'committed';
  }

  async function requestRoute({ source, read }) {
    const id = ++lastRequestId;
    lastFinished = false;
    const owner = 'request:' + id;
    claimLoading(owner);
    releaseLoadingPrefix('request:', owner);
    // Every dependency acquireParseCommit calls is guarded, so this never throws.
    const outcome = await acquireParseCommit(id, source, read);
    releaseLoading(owner);
    if (id === lastRequestId) {
      lastFinished = true;
      guard('reconcile', () => {
        // A confirmation has just launched; reconciling it again could only relaunch a
        // computation that stopped on the spot. Only settings changed since, even from
        // inside that launch, need another one.
        const again = outcome === 'committed'
          ? pendingSettings
          : deps.hasConfirmedRoute() && (pendingSettings || !deps.hasCurrentForecast());
        if (again) startForecast();
      });
      // Said after reconciling: a computation relaunched there may show a notice of its own
      // (a start date out of range), and the failure is what the user has just done.
      if (outcome === 'unreadable') guard('notice', () => deps.notifyReadFailed());
      if (outcome === 'unusable') guard('notice', () => deps.notifyFailed());
    }
    return outcome === 'unreadable' || outcome === 'unusable' ? 'failed' : outcome;
  }

  // Whether any route has been asked for, even one still being read.
  const hasRouteRequests = () => lastRequestId > 0;
  // Whether the latest request is still being read: it will commit (or fail) and reconcile on its
  // own, so nothing else should launch a computation in its place meanwhile.
  const hasRouteRequestPending = () => !lastFinished;
  // The identity of the last request made: a request taken right after asking is that request's own.
  const lastRouteRequestId = () => lastRequestId;

  /* ---------- importing into recent routes ---------- */

  // Imports run one at a time, in the order they arrived, however long each write takes.
  // arrivedAt is fixed on arrival and is what the store keeps, so trimming to the newest
  // routes keeps the last to arrive even when an earlier write finishes later. An import
  // is independent of the request showing the same route: it goes on whatever that ends as.
  // Moving an opened route to the top is a job in the same queue, so it cannot write back
  // a route an import has just trimmed. Every job resolves; none rejects.
  // ponytail: a job whose transaction never settles (a blocked open, say) stalls every job
  // after it with no notice; a per-job timeout ending it as not saved would unstick it.
  let importQueue = Promise.resolve();
  let lastArrivedAt = 0;

  function arrival(at) {
    const fixed = at != null ? at : Math.max(Date.now(), lastArrivedAt + 1);
    lastArrivedAt = Math.max(lastArrivedAt, fixed);
    return fixed;
  }

  function enqueue(work) {
    importQueue = importQueue.then(work);
    return importQueue;
  }

  // Resolves true once the stored route has the newest timestamp, false if it is gone.
  function touchRecent(id) {
    const at = arrival();
    return enqueue(async () => {
      try { return (await deps.touchRecent(id, at)) === true; } catch (_) { return false; }
    });
  }

  // Any other job on recent routes (loading the list at start-up) waits its turn the same
  // way. Resolves with what the job returns, or undefined if it throws.
  function enqueueRecents(job) {
    return enqueue(async () => { try { return await job(); } catch (_) { return undefined; } });
  }

  function importRoute({ text, name, arrivedAt }) {
    const at = arrival(arrivedAt);
    return enqueue(async () => {
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
  }

  return {
    requestRoute, hasRouteRequests, hasRouteRequestPending, lastRouteRequestId, settingsChanged, startForecast,
    importRoute, touchRecent, enqueueRecents,
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
    notifyFailed: () => window.cwNotifyRouteFailure(t('route_load_failed')),
    notifyReadFailed: () => window.cwNotifyRouteFailure(t('route_read_failed')),
    writeRecent: (input) => window.cwIdbImportRoute(input),
    touchRecent: (id, at) => window.cwIdbTouchRoute(id, at),
    notifyNotSaved: () => { if (window.setNotice) window.setNotice(t('route_not_saved'), 'warn'); },
  });
  window.cw = window.cw || {};
  Object.assign(window.cw, {
    requestRoute: coordinator.requestRoute,
    hasRouteRequests: coordinator.hasRouteRequests,
    hasRouteRequestPending: coordinator.hasRouteRequestPending,
    lastRouteRequestId: coordinator.lastRouteRequestId,
    enqueueRecents: coordinator.enqueueRecents,
    settingsChanged: coordinator.settingsChanged,
    startForecast: coordinator.startForecast,
    claimLoading: coordinator.claimLoading,
    releaseLoading: coordinator.releaseLoading,
    releaseLoadingPrefix: coordinator.releaseLoadingPrefix,
    importRoute: coordinator.importRoute,
    touchRecent: coordinator.touchRecent,
  });
})();
