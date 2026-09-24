// LAHE re-renders a Markdown review's page itself.
//
// Owner: 3A. Read with src/service/reviews.js (the mtime stat this hangs off)
// and src/service/markdown.js (the render it calls).
//
// THE FAILURE THIS REMOVES. `lahe review notes.md` renders the Markdown into an
// artifact HTML file and puts the review on THAT file. The reload trigger stats
// the artifact, because the artifact is what the browser is showing. An agent
// that edits notes.md and does not rerun the review command leaves the artifact
// exactly as it was: nothing the helper watches has moved, so the page never
// reloads. The agent then replies handled, the item retires, replay stops
// re-applying it, and the reviewer's own edit disappears the next time they
// refresh. They make it again. It disappears again. Reported by the owner after
// making one edit three times.
//
// So the rebuild is not the agent's job any more. When the poll asks for the
// artifact's modification time, this module asks first whether the Markdown
// behind it is newer, and if it is, renders the artifact again. The number the
// poll then reports is the new render's, the page reloads onto it, and no agent
// had to remember anything.
//
// FOUR RULES, and each one is a thing that must not happen.
//
//  1. A STAT WHEN ASKED, NOT A WATCHER. Same shape as the mtime stat it runs
//     in front of, and for the same reason: two stats a second per review is
//     nothing, and a watcher would mean fd lifetimes, rename handling and a
//     restart story for a fact that is one syscall.
//
//  2. FAIL SOFT, ALWAYS. The poll route is what the reviewer's page depends on.
//     A source that was deleted, a source that cannot be read, a render that
//     throws on malformed input: all of them log and answer exactly as before.
//     Nothing in here may cost the reviewer their poll.
//
//  3. ONLY MARKDOWN, AND ONLY OUR OWN ARTIFACT. A review whose target is the
//     reviewer's own build output is never rewritten: that file belongs to
//     their build, and writing it would be this tool editing a working tree
//     nobody enrolled. The test is exact rather than approximate: the target
//     must be the very path markdown.artifactPath mints for that source in that
//     session.
//
//  4. THE SAME RENDER `lahe review` PRODUCES. It calls markdown.writeArtifact,
//     the same function src/cli/commands/review.js calls, so the Mermaid script,
//     the fonts, the asset prefix and the translated local links are whatever
//     that function does today. Nothing here reimplements any of it.
//
// Node-only. Not in the layer bundle.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var markdown = require("./markdown.js");
var stateDir = require("./state_dir.js");
var staticServers = require("./static_servers.js");

// Several callers can ask inside one tick (the poll's mtime stat, and a reply
// fold judging a handled claim against the page). They share one answer for
// this long, so the cheap case is two stats rather than two renders.
var REBUILD_TTL_MS = 500;

/** One review's meta.json, or null. Never throws. */
function readMeta(dir, reviewId) {
  var file;
  try {
    file = stateDir.metaPath(dir, reviewId);
  } catch (error) {
    return null;
  }
  try {
    var parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (error) {
    return null;
  }
}

/**
 * Is this review one whose page LAHE renders, and which file pair is it?
 *
 * @param {string} dir the state directory
 * @param {object} review a review record or meta.json object
 * @returns {{source: string, target: string, session: string}|null}
 */
function renderableOf(dir, review) {
  if (!review || typeof review !== "object") return null;
  var source = typeof review.source_path === "string" ? review.source_path : "";
  var target = typeof review.target_path === "string" ? review.target_path : "";
  if (!source || !target) return null;
  if (!markdown.isMarkdown(source)) return null;
  var session = typeof review.agent_session_id === "string" ? review.agent_session_id : "";
  if (!session) return null;
  var ours;
  try {
    ours = markdown.artifactPath(dir, session, source);
  } catch (error) {
    return null;
  }
  // Rule 3. Anything that is not the exact artifact this tool minted for this
  // source in this session belongs to somebody else's build.
  if (path.resolve(target) !== path.resolve(ours)) return null;
  return { source: path.resolve(source), target: path.resolve(ours), session: session };
}

/**
 * Put any local-link mounts the new render needs onto the session's static
 * server, without going through the async registration handshake.
 *
 * The render is deterministic, so an unchanged document produces the mounts the
 * server already has and nothing is written. A document that gained a link to a
 * new folder is the case this exists for: without it, the link the reviewer now
 * sees would point at a prefix the server does not serve.
 *
 * Best effort in every branch. A mount that does not land is a link that reads
 * as a 404; a throw here would be the reviewer's poll.
 */
function mergeMounts(dir, session, target, added, log) {
  if (!added || !added.length) return 0;
  var servers;
  try {
    servers = staticServers.list(dir, session);
  } catch (error) {
    return 0;
  }
  var folder = path.dirname(target);
  var landed = 0;
  servers.forEach(function (meta) {
    var root;
    try {
      root = fs.realpathSync(meta.root);
    } catch (error) {
      return;
    }
    // The server rooted at the artifact's own folder is the one serving this page.
    if (path.resolve(folder) !== root && path.resolve(folder).indexOf(root + path.sep) !== 0) return;
    var file;
    try {
      file = stateDir.staticServerPath(dir, session, meta.id);
    } catch (error) {
      return;
    }
    var current;
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      return;
    }
    var mounts = Object.assign({}, current.mounts || {});
    var auto = Array.isArray(current.auto_mounts) ? current.auto_mounts.slice() : [];
    var changed = false;
    added.forEach(function (entry) {
      if (!entry || typeof entry.prefix !== "string" || typeof entry.dir !== "string") return;
      if (mounts[entry.prefix] === entry.dir) return;
      mounts[entry.prefix] = entry.dir;
      if (auto.indexOf(entry.prefix) === -1) auto.push(entry.prefix);
      changed = true;
    });
    if (!changed) return;
    current.mounts = mounts;
    current.auto_mounts = auto;
    try {
      stateDir.writeAtomic(file, JSON.stringify(current, null, 2) + "\n");
      process.kill(meta.pid, "SIGHUP");
      landed += 1;
    } catch (error) {
      if (log && typeof log.helperLog === "function") {
        log.helperLog("could not hand a new link mount to the static server: " + error.message);
      }
    }
  });
  return landed;
}

/**
 * The re-render trigger for one state directory.
 *
 * @param {{dir: string, log?: object, clock?: function, ttlMs?: number}} options
 */
function createRebuilder(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createRebuilder: dir is required");
  var dir = opts.dir;
  var log = opts.log || null;
  var clock = typeof opts.clock === "function" ? opts.clock : Date.now;
  var ttl = typeof opts.ttlMs === "number" ? opts.ttlMs : REBUILD_TTL_MS;
  var askedAt = Object.create(null);
  var lastRenderAt = Object.create(null);

  function note(message) {
    if (log && typeof log.helperLog === "function") log.helperLog(message);
  }

  /**
   * Re-render this review's page if the Markdown behind it has moved.
   *
   * @param {object} review a review record, or a meta.json object
   * @returns {{rendered: boolean, reason: string}} `reason` is for tests and the
   *   helper log; no caller is expected to branch on it.
   */
  function refresh(review) {
    var id = review && typeof review.id === "string" ? review.id : null;
    var pair = renderableOf(dir, review);
    if (!pair) return { rendered: false, reason: "not-a-rendered-markdown-review" };

    var now = clock();
    if (id && askedAt[id] !== undefined && now - askedAt[id] < ttl) {
      return { rendered: false, reason: "asked-within-the-window" };
    }
    if (id) askedAt[id] = now;

    var sourceAt = mtimeMs(pair.source);
    if (sourceAt === null) {
      // The source moved or was deleted. The artifact on disk is still a real
      // page with the reviewer's review on it, so it is left alone.
      note("review " + String(id) + ": the Markdown behind this page is gone, so it was not re-rendered");
      return { rendered: false, reason: "source-missing" };
    }
    var targetAt = mtimeMs(pair.target);
    if (targetAt !== null && sourceAt <= targetAt) {
      return { rendered: false, reason: "artifact-is-current" };
    }

    var result;
    try {
      result = markdown.writeArtifact(dir, pair.session, pair.source);
    } catch (error) {
      // Rule 2. A Markdown file mid-save, or one the renderer cannot take, is
      // not a reason for the poll to fail. The page keeps the render it has.
      note(
        "review " + String(id) + ": could not re-render " + pair.source + ", so the page keeps the render it has: " +
          error.message
      );
      return { rendered: false, reason: "render-failed" };
    }
    mergeMounts(dir, pair.session, pair.target, result.linkMounts, log);
    if (id) lastRenderAt[id] = new Date(clock()).toISOString();
    note("review " + String(id) + ": re-rendered " + pair.source + " because it is newer than the page");
    return { rendered: true, reason: "source-is-newer" };
  }

  /** The same, for a caller that holds only the review id. */
  function refreshById(reviewId) {
    var meta = readMeta(dir, reviewId);
    if (!meta) return { rendered: false, reason: "no-meta" };
    if (typeof meta.id !== "string") meta = Object.assign({}, meta, { id: reviewId });
    return refresh(meta);
  }

  /** When this helper last re-rendered a review's page, as an ISO string, or null. */
  function lastRebuildAt(reviewId) {
    return lastRenderAt[reviewId] || null;
  }

  return {
    refresh: refresh,
    refreshById: refreshById,
    lastRebuildAt: lastRebuildAt
  };
}

module.exports = {
  REBUILD_TTL_MS: REBUILD_TTL_MS,
  readMeta: readMeta,
  renderableOf: renderableOf,
  createRebuilder: createRebuilder
};
