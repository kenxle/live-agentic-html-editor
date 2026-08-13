// The file manifest: one owner per file, and the bundle's concatenation order.
//
// Owner: 0A-kernel, and FROZEN AT CP0. Read by scripts/build-layer.js,
// scripts/lint.js (the completeness check), and every builder who needs to know
// whether a file is theirs. A change to this file goes through the
// orchestrator.
//
// This is the plan's ownership table as code. Three jobs.
//
// 1. ONE OWNER PER FILE. Four builders work in parallel in every phase and the
//    merge is the expensive part. A file with two owners is a conflict every
//    time both touch it; a file with none is a thing nobody built. A builder
//    who needs a file they do not own asks the orchestrator rather than editing
//    it, or the change goes in a file they do own.
//
// 2. THE CONCATENATION ORDER. The library ships as one built file that a page
//    loads with one script line (D1). There is no module loader in the browser
//    here, so order is dependency order: a file may only use a namespace entry
//    a file above it already registered.
//
// 3. THE FILES THAT DO NOT EXIST YET. Entries carrying `planned: true` name a
//    file a later task creates. They are here because the ownership question
//    has to have an answer BEFORE the file exists, which is the whole reason
//    two tasks stopped implicitly claiming the same work. The build script
//    skips them until they land.
//
// Concatenation is development tooling, not a runtime dependency: a user clones
// the repo and adds the built file to a page. The built artifact is committed,
// which is only safe because the gate checks it is current. BUILDERS NEVER
// COMMIT dist/; the orchestrator rebuilds it once at each checkpoint.
//
// Node-only. Not part of the bundle it describes.

"use strict";

// The order is the load order. Do not sort this list.
var LAYER_FILES = [
  // --- the shared kernel ---------------------------------------------------
  {
    path: "src/shared/markers.js",
    owner: "0A-kernel",
    why: "the one spelling of 'this node is ours'. Nothing above it; it depends on nothing"
  },
  {
    path: "src/shared/normalize.js",
    owner: "0A-kernel",
    why: "the one normalizer, both comparison modes. Needs markers for cleanMarkup"
  },
  {
    path: "src/shared/failures.js",
    owner: "0A-wire",
    why: "the failure code enum. Depends on nothing"
  },
  {
    path: "src/shared/record.js",
    owner: "0A-kernel",
    why: "the record shape, page fields, applied-after history. Needs normalize"
  },
  {
    path: "src/shared/lifecycle.js",
    owner: "0A-kernel",
    why: "the four states and the actor column. Needs record"
  },
  {
    path: "src/shared/merge.js",
    owner: "0A-kernel",
    why: "D5's merge rule: browser wins on content, store wins on lifecycle per rev. Needs record"
  },
  {
    path: "src/shared/regions.js",
    owner: "0A-kernel",
    why: "region label rules. Needs markers and normalize"
  },
  {
    path: "src/shared/uniqueness.js",
    owner: "0A-kernel",
    why: "D9's predicate, no tunable number. Needs normalize"
  },
  {
    path: "src/shared/gestures.js",
    owner: "0A-kernel",
    why: "D3's gesture vocabulary. Depends on nothing"
  },
  {
    path: "src/shared/epoch.js",
    owner: "0A-kernel",
    why: "the write-epoch rule that stops replay retriggering replay. Depends on nothing"
  },
  {
    path: "src/shared/protocol.js",
    owner: "0A-wire",
    why: "routes, headers, the per-review token, error shapes. Needs failures"
  },
  {
    path: "src/shared/review_format.js",
    owner: "0A-wire, FROZEN at CP0",
    why: "in the bundle because copy and export must produce the same text with no helper (R10). Needs record"
  },
  {
    path: "src/shared/record_fixtures.js",
    owner: "0A-kernel",
    why: "realistic records for 2B and 2C to build against before 2A produces real ones. Needs record"
  },

  // --- the library ---------------------------------------------------------
  {
    path: "src/layer/listeners.js",
    owner: "2D",
    why: "the listener registry. Everything that binds a handler goes through it, so it loads early"
  },
  {
    path: "src/layer/selection.js",
    owner: "0A-kernel, FROZEN at CP0",
    why: "the caret accessor. 2A and 2B both read it and neither owns it"
  },
  {
    path: "src/layer/store.js",
    owner: "1B",
    why: "browser storage, synchronous on every keystroke, keyed by review id"
  },
  {
    path: "src/layer/anchor.js",
    owner: "1C",
    why: "mint and resolve. Pure, no DOM ownership"
  },
  {
    path: "src/layer/protect.js",
    owner: "2B",
    why: "the three protection layers: cooperative skip, pre-morph veto, snapshot and restore"
  },
  {
    path: "src/layer/highlight.js",
    owner: "1D",
    why: "Custom Highlight API registration plus the one page-level stylesheet (D8's named exception)"
  },
  {
    path: "src/layer/overlay.js",
    owner: "1B",
    why: "the rail chrome only: tab shell, status line, failure chips, card API. Tab contents live elsewhere"
  },
  {
    path: "src/layer/tab_active.js",
    owner: "1D",
    why: "Active tab contents"
  },
  {
    path: "src/layer/tab_done.js",
    owner: "3A",
    why: "Done tab contents, the agent-reply attachments, and the question treatment"
  },
  {
    path: "src/layer/tab_edits.js",
    owner: "3D",
    planned: true,
    why: "Edits tab contents"
  },
  {
    path: "src/layer/export.js",
    owner: "3C",
    planned: true,
    why: "copy and export, calling 0A-wire's frozen human-readable formatter"
  },
  {
    path: "src/layer/sync.js",
    owner: "1B",
    why: "post per record, re-post unacknowledged, and the reply poll loop"
  },
  {
    path: "src/layer/comments.js",
    owner: "1D",
    why: "comment boxes, element-pick mode, the untethered note. 0A-kernel seeds a minimal real box"
  },
  {
    path: "src/layer/editing.js",
    owner: "2A",
    why: "per-block edit state into records. Needs selection, anchor, store, overlay"
  },
  {
    path: "src/layer/replay.js",
    owner: "2C",
    why: "the four-branch history-aware compare. Needs everything above it"
  },
  {
    path: "src/layer/inject.js",
    owner: "2D",
    why: "remount, route detection, CSP refusal. Needs listeners and replay"
  },
  {
    path: "src/layer/index.js",
    owner: "2D",
    why: "boots the library. Last, because it calls into everything"
  }
];

// Files that are NOT in the bundle, listed so the ownership question has an
// answer for every file in src/.
var NON_BUNDLE_FILES = [
  { path: "src/shared/contracts.js", owner: "0A-kernel", why: "Node-side barrel re-export. Nothing is defined in it" },
  { path: "src/shared/manifest.js", owner: "0A-kernel, FROZEN at CP0", why: "Node only. This file" },
  {
    path: "src/shared/cli_contract.js",
    owner: "none (CUT)",
    cut: true,
    why: "the blocking next-and-ack exit-code contract is the dead send model. Removed in the Phase 4B batch"
  },

  { path: "src/service/index.js", owner: "1A", why: "serve" },
  { path: "src/service/routes.js", owner: "1A", why: "the router, pinned to protocol.js" },
  { path: "src/service/auth.js", owner: "1A", why: "the per-request check block, and the named refusal reason in the log" },
  { path: "src/service/log.js", owner: "1A", why: "the events.jsonl appender" },
  { path: "src/service/state_dir.js", owner: "1A", why: "reviews/<id>/ layout, owner-only, the safe-id rule" },
  { path: "src/service/reviews.js", owner: "1A", why: "review creation, per-review token minting, origin registration, the second-window session" },
  { path: "src/service/projection.js", owner: "3A", why: "the log projected into review.json and the reply state the library polls" },
  { path: "src/service/review_writer.js", owner: "3A", why: "the single writer of review.json, and the path-safety rules" },
  { path: "src/service/replies.js", owner: "3A", why: "reply file discovery, byte-offset reading, folding, the conflict rule" },
  {
    path: "src/service/verification.js",
    owner: "none (CUT)",
    cut: true,
    why: "checking an agent's claim is a deliberate v1 cut, with the reply's files field kept as the seam"
  },

  { path: "src/cli/index.js", owner: "1A", why: "the command dispatcher: serve, add, wait" },
  { path: "src/cli/commands/serve.js", owner: "1A", why: "serve" },
  { path: "src/cli/commands/add.js", owner: "3B", planned: true, why: "add" },
  { path: "src/cli/commands/wait.js", owner: "3A", why: "wait" },
  { path: "src/cli/commands/next.js", owner: "none (CUT)", cut: true, why: "the blocking next command is the dead send model" },
  { path: "src/cli/commands/ack.js", owner: "none (CUT)", cut: true, why: "acknowledgement is an appended reply line, not a command" },
  { path: "src/cli/commands/open.js", owner: "none (CUT)", cut: true, why: "superseded by add, which mints the review and its token in one act" },
  { path: "src/cli/commands/setup.js", owner: "none (CUT)", cut: true, why: "superseded by add. No instruction files are written now; the contract is the file" }
];

var BUNDLE_OUTPUT = "dist/lahe-layer.js";
var GLOBAL_NAMESPACE = "LAHE";

function allFiles() {
  return LAYER_FILES.concat(NON_BUNDLE_FILES);
}

function entryFor(path) {
  var all = allFiles();
  for (var i = 0; i < all.length; i += 1) {
    if (all[i].path === path) return all[i];
  }
  return null;
}

function ownerOf(path) {
  var entry = entryFor(path);
  return entry ? entry.owner : null;
}

// The entries the build script concatenates: everything in the bundle that
// actually exists yet.
function builtFiles() {
  return LAYER_FILES.filter(function (entry) {
    return entry.planned !== true;
  });
}

// Paths a later task still has to create. The gate reports them so "nobody
// built it" is visible rather than discovered at a checkpoint.
function plannedFiles() {
  return allFiles().filter(function (entry) {
    return entry.planned === true;
  });
}

// Paths on the Phase 4B cleanup batch. Nothing is deleted during the build.
function cutFiles() {
  return allFiles().filter(function (entry) {
    return entry.cut === true;
  });
}

module.exports = {
  LAYER_FILES: LAYER_FILES,
  NON_BUNDLE_FILES: NON_BUNDLE_FILES,
  BUNDLE_OUTPUT: BUNDLE_OUTPUT,
  GLOBAL_NAMESPACE: GLOBAL_NAMESPACE,
  allFiles: allFiles,
  entryFor: entryFor,
  ownerOf: ownerOf,
  builtFiles: builtFiles,
  plannedFiles: plannedFiles,
  cutFiles: cutFiles
};
