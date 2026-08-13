// Copy and Export: the reviewer's way out, with or without a helper.
//
// Owner: 3C.
//
// ---------------------------------------------------------------------------
// What this file is for
// ---------------------------------------------------------------------------
//
// R10: there is always a way to take the work elsewhere, with nothing running.
// R11's other half applied to export: no false success, so a copy that did not
// reach the clipboard says so on a chip rather than looking like it worked.
// D10 keeps both controls VISIBLE at all times, because when something is
// wrong is exactly when the reviewer cannot tell.
//
// What comes out is HUMAN-READABLE TEXT, not the store file and not the agent
// contract. review.json is what an agent reads; this is what a person pastes
// into a chat window or hands to a colleague. Every byte of it is rendered by
// shared/review_format.js's renderText, which is 0A-wire's and FROZEN: this
// file calls it and never formats a record itself, so the same records read the
// same way in the helper's output and in the browser's. A change to the wording
// goes to the orchestrator, not into a second formatter here.
//
// ---------------------------------------------------------------------------
// Two scopes, and why the label exists
// ---------------------------------------------------------------------------
//
// FULL   the helper is reachable, so the whole review is in play.
// SLICE  nothing is running, so what comes out is what THIS BROWSER holds, and
//        it says so in its first line.
//
// Browser storage is partitioned by origin (store.js says the same thing), so
// with no helper there is no way to see a page served from another origin. An
// export that quietly left that out would be the tool telling the reviewer they
// have everything when they do not. The label is one line, it is the only
// difference between the two outputs, and ranked test 34 asserts exactly that:
// same records, byte-identical bytes, differing only in scope and the label.
//
// ---------------------------------------------------------------------------
// How "reachable" is decided
// ---------------------------------------------------------------------------
//
// LIVE, at the moment of the click, never from a remembered state. sync.js's
// status is read first because a CSP refusal is already known there and a fetch
// would only reproduce it noisily; everything else is settled by asking the
// helper. A cached "stored" from thirty seconds ago is exactly the reading that
// would label a dead helper's export as the whole review.
//
// The question asked is review.read, the same route the library reconciles
// against:
//
//   200   the helper answered for this review. Reachable.
//   501   the projection route is 3A's and is not built yet. The helper is up
//         and answering; this file does not need the projection to render, so
//         this counts as reachable. THE SEAM: when 3A lands, the same call
//         starts returning records, and recordsFromBody picks them up with no
//         change here.
//   401
//   403
//   404   the helper is up but this page cannot see this review. That is not
//         the whole review, so it is a slice, honestly labeled.
//   no answer at all: not reachable. A slice.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    var made = factory(root.LAHE.review_format, root.LAHE.record, root.LAHE.protocol, root.LAHE.failures);
    root.LAHE.exporter = made;
    // The same object under the manifest's own filename, so a caller who looked
    // up src/layer/export.js finds LAHE.export as well. One object, two names.
    root.LAHE.export = made;
  } else {
    module.exports = factory(
      require("../shared/review_format.js"),
      require("../shared/record.js"),
      require("../shared/protocol.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (review_format, record, protocol, failures) {
  "use strict";

  var SCOPE = { FULL: "full", SLICE: "slice" };

  // The one wording of the label, here rather than in the rail and in the file
  // writer and in a test. Written for the person who opens the file a week
  // later with no idea what was running when it was made.
  var SLICE_LABEL =
    "This is this page's slice of the review: the items this browser is holding. " +
    "The local helper was not reachable, so anything recorded on another origin, in another browser, " +
    "or in another profile is not in this file.";

  // Every request this file makes carries a deadline, for sync.js's reason: a
  // suspended helper accepts the socket and never answers, and a reviewer who
  // clicked Copy is waiting on it.
  var PROBE_TIMEOUT_MS = 2000;

  var FILE_PREFIX = "lahe-review-";
  var FILE_SUFFIX = ".txt";
  var SLICE_FILE_MARK = "-this-page-slice";

  // ---------------------------------------------------------------------------
  // The text (pure)
  // ---------------------------------------------------------------------------

  /**
   * Render records as the human-readable review text.
   *
   * Pure, synchronous, and the only place the slice label is attached. 3D's
   * Edits tab renders through here too, rather than formatting a second time.
   *
   * @param {{records: Array<Object>, scope: string, review?: string}} input
   * @returns {string}
   */
  function renderReviewText(input) {
    var opts = input || {};
    if (!Array.isArray(opts.records)) {
      throw new TypeError("renderReviewText: records must be an array");
    }
    // Fails loud rather than defaulting. A default scope is a guess about
    // whether the reviewer is looking at the whole review, and guessing that is
    // the exact thing the label exists to stop.
    if (opts.scope !== SCOPE.FULL && opts.scope !== SCOPE.SLICE) {
      throw new Error(
        "renderReviewText: scope must be " + SCOPE.FULL + " or " + SCOPE.SLICE + ", got " + String(opts.scope)
      );
    }
    var reviewId = opts.review || opts.reviewId;
    if (typeof reviewId !== "string" || !reviewId) {
      throw new TypeError("renderReviewText: a review id is required; the text names the review it came from");
    }

    var body = review_format.renderText({ id: reviewId, items: opts.records });
    if (opts.scope === SCOPE.FULL) return body;
    return SLICE_LABEL + "\n\n" + body;
  }

  /** yyyymmdd-hhmm in local time, which is the clock the reviewer is reading. */
  function stamp(at) {
    var d = at instanceof Date ? at : new Date();
    function two(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return (
      String(d.getFullYear()) +
      two(d.getMonth() + 1) +
      two(d.getDate()) +
      "-" +
      two(d.getHours()) +
      two(d.getMinutes())
    );
  }

  /**
   * A filename a person can find again: the review, the date, and whether it is
   * a slice. The scope is in the NAME as well as in the text, because a file
   * gets forwarded without its first line being read.
   */
  function filenameFor(options) {
    var opts = options || {};
    var id = String(opts.review || opts.reviewId || "review").replace(/[^A-Za-z0-9._-]+/g, "-");
    var mark = opts.scope === SCOPE.SLICE ? SLICE_FILE_MARK : "";
    var extra = opts.label ? "-" + String(opts.label).replace(/[^A-Za-z0-9._-]+/g, "-") : "";
    return FILE_PREFIX + id + extra + "-" + stamp(opts.at) + mark + FILE_SUFFIX;
  }

  // ---------------------------------------------------------------------------
  // Records from two places
  // ---------------------------------------------------------------------------

  /**
   * Records the helper handed back, or null when it handed back something this
   * file cannot use. Today review.read answers with 3A's projection, whose
   * items are projected fields rather than records, so this returns null and
   * the browser's own records are rendered. It is written as a shape test
   * rather than a version check so 3A's landing needs no edit here.
   */
  function recordsFromBody(body) {
    if (!body || typeof body !== "object") return null;
    var list = Array.isArray(body.records) ? body.records : Array.isArray(body.items) ? body.items : null;
    if (!list || !list.length) return null;
    var usable = list.every(function (item) {
      return item && typeof item === "object" && typeof item[record.FIELD.ID] === "string" && item[record.FIELD.KIND];
    });
    return usable ? list : null;
  }

  /**
   * One list from two, D5's rule: the browser is authoritative for a record's
   * content, so a local record wins its own id unless the helper is holding a
   * later revision. Local order first, then anything only the helper knows.
   */
  function unionById(local, remote) {
    var out = [];
    var index = Object.create(null);
    (local || []).forEach(function (item) {
      index[item[record.FIELD.ID]] = out.length;
      out.push(item);
    });
    (remote || []).forEach(function (item) {
      var id = item[record.FIELD.ID];
      if (!(id in index)) {
        index[id] = out.length;
        out.push(item);
        return;
      }
      var mine = out[index[id]];
      var theirs = item;
      if ((theirs[record.FIELD.REV] || 0) > (mine[record.FIELD.REV] || 0)) out[index[id]] = theirs;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // The instance
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} options
   * @param {string} options.review        the review id
   * @param {string} [options.token]       the per-review token, for the probe
   * @param {string} [options.helperOrigin]
   * @param {Object} [options.store]       1B's store, read for this browser's records
   * @param {Object} [options.sync]        1B's sync client, read for its status only
   * @param {Object} [options.rail]        1B's rail, for the failure chip
   * @param {Document} [options.document]
   * @param {Window} [options.window]
   * @param {Function} [options.fetch]
   * @param {Object} [options.clipboard]   defaults to navigator.clipboard
   * @param {Function} [options.records]   override for what this browser holds
   */
  function createExport(options) {
    var opts = options || {};
    var review = opts.review || null;
    var token = opts.token || "";
    var helperOrigin = opts.helperOrigin || protocol.DEFAULT_HELPER_ORIGIN;
    var store = opts.store || null;
    var sync = opts.sync || null;
    var rail = opts.rail || null;
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    var fetchImpl =
      opts.fetch ||
      (typeof fetch === "function" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : null) : null);
    var readRecords = opts.records || null;
    var clipboardOverride = opts.clipboard || null;

    var last = null;

    function requireReview() {
      if (!review) throw new Error("export: a review id is required; the text names the review it came from");
      return review;
    }

    function localRecords() {
      if (readRecords) return readRecords() || [];
      if (store) return store.read(requireReview()) || [];
      return [];
    }

    function raise(code, detail) {
      var made = failures.failure(code, detail === undefined ? null : detail);
      if (rail && rail.failures && typeof rail.failures.add === "function") rail.failures.add(made);
      return made;
    }

    // -------------------------------------------------------------------------
    // Is the helper there, right now
    // -------------------------------------------------------------------------

    function syncStatus() {
      if (!sync || typeof sync.status !== "function") return null;
      try {
        return sync.status();
      } catch (err) {
        return null;
      }
    }

    function probe() {
      var known = syncStatus();
      if (known && known.cspRefused) {
        // Already settled, and settled correctly: this page's own policy refuses
        // the helper's origin, so no fetch from here can ever reach it.
        return Promise.resolve({ reachable: false, via: "sync", reason: "csp_refused", status: null, body: null });
      }
      if (!fetchImpl) {
        return Promise.resolve({ reachable: false, via: "no_fetch", reason: "no fetch here", status: null, body: null });
      }

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timer = null;
      var timedOut = false;
      if (controller && win && typeof win.setTimeout === "function") {
        // harness-allow-timer: the request deadline. A suspended helper accepts
        // the socket and answers nothing, and the reviewer is standing on the
        // click waiting for it.
        timer = win.setTimeout(function () {
          timedOut = true;
          controller.abort();
        }, PROBE_TIMEOUT_MS);
      }

      var headers = {};
      headers[protocol.HEADER.CLIENT] = protocol.CLIENT_LAYER;
      headers[protocol.HEADER.TOKEN] = token;

      var url =
        helperOrigin +
        protocol.route("review.read").path +
        "?review=" +
        encodeURIComponent(requireReview());

      var config = { method: "GET", headers: headers };
      if (controller) config.signal = controller.signal;

      return fetchImpl(url, config)
        .then(function (response) {
          if (timer && win) win.clearTimeout(timer);
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              // 501 is the projection route not being built yet (3A). The helper
              // itself answered, which is the question being asked here.
              var answered = response.status === 200 || response.status === 501;
              return {
                reachable: answered,
                via: "helper",
                reason: answered ? null : "helper answered " + response.status + " for this review",
                status: response.status,
                body: body
              };
            });
        })
        .catch(function (error) {
          if (timer && win) win.clearTimeout(timer);
          return {
            reachable: false,
            via: "helper",
            reason: timedOut ? "the helper did not answer in time" : String((error && error.message) || error),
            status: null,
            body: null
          };
        });
    }

    /** The records to render, and the scope they are honestly labeled with. */
    function gather() {
      var mine = localRecords();
      return probe().then(function (answer) {
        if (!answer.reachable) {
          return { scope: SCOPE.SLICE, records: mine, probe: answer };
        }
        var theirs = recordsFromBody(answer.body);
        return {
          scope: SCOPE.FULL,
          records: theirs ? unionById(mine, theirs) : mine,
          probe: answer
        };
      });
    }

    // -------------------------------------------------------------------------
    // The clipboard, and the file
    // -------------------------------------------------------------------------

    function clipboard() {
      if (clipboardOverride) return clipboardOverride;
      if (win && win.navigator && win.navigator.clipboard) return win.navigator.clipboard;
      if (typeof navigator !== "undefined" && navigator.clipboard) return navigator.clipboard;
      return null;
    }

    function writeClipboard(text) {
      var target = clipboard();
      if (!target || typeof target.writeText !== "function") {
        return Promise.reject(new Error("this browser gave the page no clipboard to write to"));
      }
      return Promise.resolve(target.writeText(text));
    }

    /**
     * Save the text as a file the browser downloads.
     *
     * The anchor is added, clicked and taken away again in the same beat. It is
     * added to the document rather than into the rail's shadow root, because a
     * download click has to originate from a connected node.
     */
    function download(text, filename) {
      if (!doc || !win) throw new Error("export: there is no page here to download from");
      var maker = win.URL || win.webkitURL || (typeof URL !== "undefined" ? URL : null);
      var BlobImpl = win.Blob || (typeof Blob !== "undefined" ? Blob : null);
      if (!maker || typeof maker.createObjectURL !== "function" || typeof BlobImpl !== "function") {
        throw new Error("this browser gave the page no way to save a file");
      }
      var href = maker.createObjectURL(new BlobImpl([text], { type: "text/plain;charset=utf-8" }));
      var anchor = doc.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      (doc.body || doc.documentElement).appendChild(anchor);
      anchor.click();
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
      if (typeof maker.revokeObjectURL === "function" && win.setTimeout) {
        // harness-allow-timer: the object URL is revoked after the browser has
        // had the click. Revoking in the same task cancels the download in
        // some browsers.
        win.setTimeout(function () {
          maker.revokeObjectURL(href);
        }, 0);
      }
      return filename;
    }

    function remember(result) {
      last = result;
      return result;
    }

    // -------------------------------------------------------------------------
    // The two controls
    // -------------------------------------------------------------------------

    /**
     * Copy the review to the clipboard.
     *
     * R11: it resolves ok:false and puts a chip in the rail's failures list when
     * the write did not happen. Nothing here reports a success it did not have.
     *
     * @returns {Promise<{ok: boolean, scope: string, text: string, code?: string}>}
     */
    function copyReview() {
      var text = null;
      var scope = null;
      return gather()
        .then(function (got) {
          scope = got.scope;
          text = renderReviewText({ records: got.records, scope: got.scope, review: requireReview() });
          return writeClipboard(text);
        })
        .then(function () {
          return remember({ ok: true, action: "copy", scope: scope, text: text, characters: text.length });
        })
        .catch(function (error) {
          var failure = raise("COPY_FAILED", String((error && error.message) || error));
          return remember({
            ok: false,
            action: "copy",
            scope: scope,
            text: text,
            code: failure.code,
            error: String((error && error.message) || error)
          });
        });
    }

    /**
     * Download the review as a text file.
     *
     * @returns {Promise<{ok: boolean, scope: string, text: string, filename: string}>}
     */
    function exportReview() {
      var text = null;
      var scope = null;
      var filename = null;
      return gather()
        .then(function (got) {
          scope = got.scope;
          text = renderReviewText({ records: got.records, scope: got.scope, review: requireReview() });
          filename = filenameFor({ review: requireReview(), scope: got.scope });
          download(text, filename);
          return remember({ ok: true, action: "export", scope: scope, text: text, filename: filename });
        })
        .catch(function (error) {
          var failure = raise("EXPORT_FAILED", String((error && error.message) || error));
          return remember({
            ok: false,
            action: "export",
            scope: scope,
            text: text,
            filename: filename,
            code: failure.code,
            error: String((error && error.message) || error)
          });
        });
    }

    /**
     * The raw seam: render (and by default download) a caller's own records.
     * 3D's Edits tab list export calls this rather than formatting a second
     * time, which is why it takes records instead of reading them.
     *
     * @param {Array<Object>} records
     * @param {{scope?: string, download?: boolean, filename?: string, label?: string}} [options]
     * @returns {Promise<{ok: boolean, scope: string, text: string, filename: string|null}>}
     */
    function exportRecords(records, options) {
      var o = options || {};
      var wantsFile = o.download !== false;
      // A caller who knows its scope says so. One that does not gets the same
      // live answer the buttons get, so a subset list cannot claim to be the
      // whole review either.
      var scoped = o.scope
        ? Promise.resolve({ scope: o.scope })
        : gather().then(function (got) {
            return { scope: got.scope };
          });

      return scoped
        .then(function (got) {
          var text = renderReviewText({ records: records, scope: got.scope, review: requireReview() });
          var filename = o.filename || filenameFor({ review: requireReview(), scope: got.scope, label: o.label });
          if (wantsFile) download(text, filename);
          return remember({
            ok: true,
            action: "export_records",
            scope: got.scope,
            text: text,
            filename: wantsFile ? filename : null
          });
        })
        .catch(function (error) {
          var failure = raise("EXPORT_FAILED", String((error && error.message) || error));
          return remember({
            ok: false,
            action: "export_records",
            scope: o.scope || null,
            text: null,
            filename: null,
            code: failure.code,
            error: String((error && error.message) || error)
          });
        });
    }

    return {
      review: review,
      SCOPE: SCOPE,
      SLICE_LABEL: SLICE_LABEL,
      copyReview: copyReview,
      exportReview: exportReview,
      exportRecords: exportRecords,
      renderReviewText: renderReviewText,
      filenameFor: filenameFor,
      // Readings, for the rail, for a test, and for anyone debugging a page.
      scopeNow: function () {
        return gather().then(function (got) {
          return { scope: got.scope, records: got.records.length, probe: got.probe };
        });
      },
      records: localRecords,
      last: function () {
        return last;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // The module-level pair the rail's buttons call
  // ---------------------------------------------------------------------------
  //
  // index.js configures this with the instance it built at boot, so
  // LAHE.exporter.copyReview() works from anywhere on the page and 3D can call
  // exportRecords without being handed a reference through four files.

  var shared = null;

  function configure(instance) {
    shared = instance || null;
    return shared;
  }

  function current() {
    if (!shared) {
      throw new Error(
        "LAHE.exporter is not configured yet. The layer's boot configures it; a caller outside boot builds its own with createExport()."
      );
    }
    return shared;
  }

  return {
    SCOPE: SCOPE,
    SLICE_LABEL: SLICE_LABEL,
    PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
    createExport: createExport,
    configure: configure,
    configured: function () {
      return shared;
    },
    renderReviewText: renderReviewText,
    filenameFor: filenameFor,
    recordsFromBody: recordsFromBody,
    unionById: unionById,
    copyReview: function () {
      return current().copyReview();
    },
    exportReview: function () {
      return current().exportReview();
    },
    exportRecords: function (records, options) {
      return current().exportRecords(records, options);
    }
  };
});
