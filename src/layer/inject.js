// Living in the page: remount, route detection, CSP refusal.
//
// Owner: Task 2C. STUB: real signatures, no DOM.
//
// The overlay-root contract from architecture D5, stated here because it is the
// thing that breaks silently:
//
//   A morph can remove the overlay root, because the root is not in the
//   server's HTML. So the root is re-created on turbo:morph, turbo:load,
//   popstate, and a MutationObserver fallback; EVERY HANDLER IS DE-REGISTERED
//   BEFORE RE-REGISTRATION, through the listener registry; and replay runs
//   after each remount.
//
// The Steady Thread layer survives morphs partly because Rails re-renders its
// partial into the response, which an injected script does not inherit, and its
// own remount path leaks a listener pair on every morph. Neither shape is
// inherited. Plan test 20 is the guard: 100 morphs, listener count unchanged,
// one overlay root, one gesture produces one item.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.inject = factory(root.LAHE.listeners, root.LAHE.replay, root.LAHE.markers, root.LAHE.failures);
  } else {
    module.exports = factory(
      require("./listeners.js"),
      require("./replay.js"),
      require("../shared/markers.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (listeners, replay, markers, failures) {
  "use strict";

  // Every event that can cost the layer its root. Data, so a test can assert
  // the list rather than the implementation.
  var REMOUNT_TRIGGERS = [
    { event: "turbo:morph", on: "document", why: "Hotwire replaced part of the page" },
    { event: "turbo:load", on: "document", why: "a Turbo Drive navigation finished" },
    { event: "popstate", on: "window", why: "the reviewer went back or forward" },
    { event: "pageshow", on: "window", why: "restored from the back/forward cache" },
    { event: "mutation-fallback", on: "document.body", why: "a framework that fires none of the above still removes the root" }
  ];

  // The order remount runs in. Written down because doing these out of order is
  // exactly the leak: re-registering before de-registering doubles the handlers.
  var REMOUNT_ORDER = [
    "listeners.offGroup(DOCUMENT) and offGroup(NAVIGATION)",
    "re-create the overlay root if it is gone",
    "re-register document and navigation handlers through the registry",
    "replay.schedule(REASON.REMOUNT)"
  ];

  // Client-side routing gives the layer no event unless it hooks history. The
  // shim moves into the layer; it does not disappear (D5).
  var HISTORY_HOOKS = ["pushState", "replaceState"];

  function remount() {
    return { remounted: false, listenerCount: listeners.count(), isStub: true };
  }

  function overlayRootCount() {
    return 0;
  }

  // CSP refusal detection. 2C wires a SecurityPolicyViolationEvent listener and
  // reports connect-src violations naming the service origin as a policy
  // refusal, distinct from service-down. The policy for what happens then lives
  // in sync.classify; this only detects.
  function watchForCspRefusal(onRefusal) {
    void onRefusal;
    return { watching: false, isStub: true };
  }

  function cspFailure(detail) {
    return failures.failure("SYNC_POLICY_REFUSED", detail || null);
  }

  return {
    REMOUNT_TRIGGERS: REMOUNT_TRIGGERS,
    REMOUNT_ORDER: REMOUNT_ORDER,
    HISTORY_HOOKS: HISTORY_HOOKS,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    remount: remount,
    overlayRootCount: overlayRootCount,
    watchForCspRefusal: watchForCspRefusal,
    cspFailure: cspFailure,
    replayReason: replay.REASON.REMOUNT,
    isStub: true
  };
});
