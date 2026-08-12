// The layer file manifest: one owner per file, and the concatenation order.
//
// Owner: Task 0a (shared kernel). Read by: scripts/build-layer.js, the gate's
// build check, and every builder who needs to know whether a file is theirs.
//
// Two jobs.
//
// 1. ONE OWNER PER FILE. Six builders work in parallel and the merge is the
//    expensive part. A file with two owners is a conflict every time both
//    touch it; a file with none is a thing nobody built. If a task needs to
//    change a file it does not own, it asks the orchestrator rather than
//    editing it, or the change goes in a file it does own.
//
// 2. THE CONCATENATION ORDER. The layer ships as one file that setup copies
//    into the host application's own static assets (D5), because a stopped
//    service must not mean no layer. There is no module loader in the browser
//    here, so order is dependency order: a file may only use a namespace entry
//    a file above it already registered.
//
// Concatenation is a development-time script, not a runtime dependency, which
// is what keeps this inside D16's no-build-step rule. The built artifact is
// committed, so a stranger's clone plus setup works with no npm install.
//
// Node-only. Not part of the bundle it describes.

"use strict";

// The order is the load order. Do not sort this list.
var LAYER_FILES = [
  {
    path: "src/shared/markers.js",
    owner: "0a kernel",
    why: "the one spelling of 'this node is ours'. Nothing above it, it depends on nothing"
  },
  {
    path: "src/shared/normalize.js",
    owner: "0a kernel",
    why: "the one normalizer. Needs markers for cleanMarkup"
  },
  {
    path: "src/shared/failures.js",
    owner: "0a kernel",
    why: "the failure code enum. Depends on nothing"
  },
  {
    path: "src/shared/record.js",
    owner: "0a kernel",
    why: "item and event shapes. Needs normalize"
  },
  {
    path: "src/shared/lifecycle.js",
    owner: "0a kernel",
    why: "the transition table and send enablement. Needs record"
  },
  {
    path: "src/shared/regions.js",
    owner: "0a kernel",
    why: "region label rules. Needs markers and normalize"
  },
  {
    path: "src/shared/uniqueness.js",
    owner: "0a kernel",
    why: "D3 Law 1 as a predicate. Needs normalize"
  },
  {
    path: "src/shared/gestures.js",
    owner: "0a kernel",
    why: "the gesture table. Depends on nothing"
  },
  {
    path: "src/shared/epoch.js",
    owner: "0a kernel",
    why: "the write-epoch rule. Depends on nothing"
  },
  {
    path: "src/shared/protocol.js",
    owner: "0a kernel",
    why: "routes, headers, error shapes. Needs failures"
  },
  {
    path: "src/shared/review_format.js",
    owner: "0a kernel",
    why: "in the bundle because Copy and Export must produce the same markdown with no service (R10). Needs record"
  },
  {
    path: "src/layer/listeners.js",
    owner: "2C living in the page",
    why: "the listener registry. Everything that binds a handler goes through it, so it loads early"
  },
  {
    path: "src/layer/selection.js",
    owner: "2A-i text and records",
    why: "the caret and selection accessor. Needed by the rail, editing, and replay"
  },
  {
    path: "src/layer/store.js",
    owner: "1B-ii store and wire",
    why: "the durable queue the layer renders from"
  },
  {
    path: "src/layer/anchor.js",
    owner: "1C anchor engine",
    why: "mint and resolve. Pure, no DOM ownership"
  },
  {
    path: "src/layer/overlay.js",
    owner: "1B-i rail",
    why: "the rail, the card API, and the failures list. Five tasks import it"
  },
  {
    path: "src/layer/sync.js",
    owner: "1B-ii store and wire",
    why: "ships items, retries forever, tells policy refusal from service-down"
  },
  {
    path: "src/layer/editing.js",
    owner: "2A-i text and records",
    why: "turns editing into records. Needs selection, anchor, store, overlay"
  },
  {
    path: "src/layer/replay.js",
    owner: "2B replay and protected regions",
    why: "the highest-risk file. Needs everything above it"
  },
  {
    path: "src/layer/inject.js",
    owner: "2C living in the page",
    why: "remount, route detection, CSP refusal. Needs listeners and replay"
  },
  {
    path: "src/layer/index.js",
    owner: "2C living in the page",
    why: "boots the layer. Last, because it calls into everything"
  }
];

// Files that are NOT in the bundle, listed so the ownership question has an
// answer for every file in src/.
var NON_BUNDLE_FILES = [
  { path: "src/shared/cli_contract.js", owner: "0a kernel", why: "Node only. The layer never runs a command" },
  { path: "src/shared/manifest.js", owner: "0a kernel", why: "Node only. Development tooling" },
  { path: "src/service/index.js", owner: "1A service", why: "the local service" },
  { path: "src/service/routes.js", owner: "1A service", why: "the router, pinned to protocol.js" },
  { path: "src/service/auth.js", owner: "1A service", why: "run token, origin allowlist, forced preflight" },
  { path: "src/service/log.js", owner: "1A service", why: "the append-only log" },
  { path: "src/service/projection.js", owner: "1A service", why: "the log read into current state" },
  { path: "src/service/review_writer.js", owner: "1D agent surface", why: "the one writer of the review files, and the owner of the path-safety rules" },
  { path: "src/service/verification.js", owner: "3B verification", why: "verify(), called from the ack path" },
  { path: "src/cli/index.js", owner: "1D agent surface", why: "the command dispatcher" },
  { path: "src/cli/commands/open.js", owner: "1D agent surface", why: "open" },
  { path: "src/cli/commands/next.js", owner: "1D agent surface", why: "next" },
  { path: "src/cli/commands/ack.js", owner: "1D agent surface", why: "ack" },
  { path: "src/cli/commands/setup.js", owner: "1D agent surface", why: "setup" }
];

var BUNDLE_OUTPUT = "dist/lahe-layer.js";
var GLOBAL_NAMESPACE = "LAHE";

function ownerOf(path) {
  var all = LAYER_FILES.concat(NON_BUNDLE_FILES);
  for (var i = 0; i < all.length; i += 1) {
    if (all[i].path === path) return all[i].owner;
  }
  return null;
}

module.exports = {
  LAYER_FILES: LAYER_FILES,
  NON_BUNDLE_FILES: NON_BUNDLE_FILES,
  BUNDLE_OUTPUT: BUNDLE_OUTPUT,
  GLOBAL_NAMESPACE: GLOBAL_NAMESPACE,
  ownerOf: ownerOf
};
