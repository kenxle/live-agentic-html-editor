// The review layer's entry point.
//
// Owner: Task 2C. STUB: boot() wires nothing yet. It exists in Phase 0 so the
// concatenated artifact has a single documented entry point and a version
// stamp a browser test can read.
//
// Loaded LAST in the bundle, because it calls into everything above it. See
// src/shared/manifest.js.
//
// Two refusals that live here rather than anywhere else:
//
//  - The layer refuses to initialize on a non-loopback origin. It is one of the
//    three real controls behind R63 (local only), alongside the service
//    refusing non-local targets it serves and the origin allowlist. It is a
//    second line, not the guard: the guard is in the host template's own
//    conditional, which setup emits framework-correct (D11).
//
//  - The layer is never fetched from the service. It ships as one concatenated
//    file that setup copies into the host application's own static assets, so a
//    stopped service still means a working layer (D5).
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.layer = factory(root.LAHE);
  } else {
    module.exports = factory(require("../shared/contracts.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ns) {
  "use strict";

  // Replaced by scripts/build-layer.js at concatenation time.
  var VERSION = "0.0.0-dev";

  function isLoopbackOrigin(origin) {
    if (typeof origin !== "string" || !origin) return false;
    var normalize = ns.normalize;
    try {
      var u = new URL(origin);
      return normalize.isLoopbackHost(u.hostname);
    } catch (err) {
      return false;
    }
  }

  function boot(options) {
    var opts = options || {};
    var origin = opts.origin || (typeof location !== "undefined" ? location.origin : null);
    if (origin && !isLoopbackOrigin(origin) && opts.allowNonLoopback !== true) {
      return { booted: false, reason: "the layer refuses to initialize on a non-loopback origin (R63)" };
    }
    return { booted: false, reason: "not implemented yet: Task 2C owns boot()", version: VERSION, isStub: true };
  }

  return { VERSION: VERSION, boot: boot, isLoopbackOrigin: isLoopbackOrigin, isStub: true };
});
