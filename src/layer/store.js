// The draft store: browser storage, written synchronously on every change.
//
// Owner: 1B. 0A-kernel ships this as a REAL minimal store rather than a stub,
// because 1B (library shell) and 1D (comments) each need a scoreable done bar
// in their own worktree instead of each stubbing the other's half and both
// passing.
//
// What is real here: synchronous writes to browser storage keyed by review id,
// drafts, revisions, deletion, and the merge against the helper's state. What
// 1B still owns: the Web Lock that refuses a second window, the quota story,
// and everything about posting to the helper (that is sync.js).
//
// THE TWO RULES 1B MUST NOT LOSE, both from D5:
//
//  1. WRITTEN SYNCHRONOUSLY ON EVERY CHANGE, before any network call. Not on a
//     timer, not debounced, not on blur. Ranked test 6 asserts durability in the
//     same task as the final keystroke with no awaited timer in between, which
//     is a test a debounced store cannot pass. The debounce in this design is
//     on the post to the HELPER (750ms of typing idle, 0A-wire's flush policy),
//     never on the write to storage.
//
//  2. KEYED BY REVIEW ID, never by filename and never by page. A review spans
//     pages, so keying by page splits one review into several buckets and the
//     rail shows a slice of the reviewer's own work.
//
// Browser storage is partitioned by origin and no key choice changes that, so
// localhost and 127.0.0.1 are physically separate buckets. The helper is what
// unifies a review across origins (D5), which is one more reason drafts flow to
// it.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.store = factory(root.LAHE.record, root.LAHE.merge, root.LAHE.failures);
  } else {
    module.exports = factory(
      require("../shared/record.js"),
      require("../shared/merge.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, merge, failures) {
  "use strict";

  var KEY_PREFIX = "lahe.items.v1:";

  // The storage key for a review. Review id, never a filename, never a page.
  function keyFor(reviewId) {
    if (typeof reviewId !== "string" || !reviewId) {
      throw new TypeError("store.keyFor: reviewId must be a non-empty string");
    }
    return KEY_PREFIX + reviewId;
  }

  // The backing store. localStorage in a browser, a plain object in Node, and
  // an injected object in a test. Every write below goes through this
  // synchronously; nothing here is deferred, batched, or debounced.
  function defaultBacking() {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    var mem = Object.create(null);
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      setItem: function (k, v) {
        mem[k] = String(v);
      },
      removeItem: function (k) {
        delete mem[k];
      },
      key: function (i) {
        return Object.keys(mem)[i] === undefined ? null : Object.keys(mem)[i];
      },
      get length() {
        return Object.keys(mem).length;
      }
    };
  }

  function createStore(options) {
    var opts = options || {};
    var backing = opts.backing || defaultBacking();

    function readAll(reviewId) {
      var raw = backing.getItem(keyFor(reviewId));
      if (!raw) return [];
      try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        // Fail loud. A store that silently returns an empty list after a
        // corrupt write is the reviewer's whole session disappearing quietly,
        // which is exactly the failure this tool exists to remove.
        throw new Error(
          "store: the stored items for review " + reviewId + " are not readable JSON (" + err.message + ")"
        );
      }
    }

    function writeAll(reviewId, items) {
      backing.setItem(keyFor(reviewId), JSON.stringify(items));
      return items;
    }

    // @returns {Array<Object>} every item for this review, in creation order
    function read(reviewId) {
      return readAll(reviewId);
    }

    // Writes one item. SYNCHRONOUS. Returns the item as stored. A quota failure
    // throws rather than being swallowed: R11 says failures are loud, and a
    // silently dropped write is the failure this tool exists to remove.
    function write(reviewId, item) {
      record.validateItem(item);
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === item[record.FIELD.ID]) {
          items[i] = item;
          writeAll(reviewId, items);
          return item;
        }
      }
      items.push(item);
      writeAll(reviewId, items);
      return item;
    }

    // The draft path, called on every keystroke. Same synchronous write; named
    // separately so a reader can see that a half-written thought is as durable
    // as a finished one (D5, drafts are durable and never actionable).
    function writeDraft(reviewId, item) {
      if (!record.isDraft(item)) {
        throw new Error("store.writeDraft: item " + item[record.FIELD.ID] + " is not a draft");
      }
      return write(reviewId, item);
    }

    function readItem(reviewId, id) {
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === id) return items[i];
      }
      return null;
    }

    // The reviewer deleting their own outstanding work is the only caller.
    // Nothing in the library removes an item on its own initiative.
    function remove(reviewId, id) {
      var items = readAll(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        if (items[i][record.FIELD.ID] === id) {
          items.splice(i, 1);
          writeAll(reviewId, items);
          return true;
        }
      }
      return false;
    }

    // Every review this origin holds anything for. Copy and export are scoped
    // to this, honestly: with the helper down, one origin's storage is one
    // origin's slice of a review, and the export says so.
    function reviews() {
      var out = [];
      for (var i = 0; i < backing.length; i += 1) {
        var k = backing.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) out.push(k.slice(KEY_PREFIX.length));
      }
      return out;
    }

    // Merge against the helper's state, through the one merge rule. Browser
    // wins on content, store wins on lifecycle per revision (D5). The result is
    // written back synchronously, so a reload after a merge shows the merged
    // truth rather than re-running the merge from stale halves.
    function mergeWithHelper(reviewId, helperItems) {
      var got = merge.mergeLists(readAll(reviewId), helperItems || []);
      writeAll(reviewId, got.items);
      return got;
    }

    // The second-window refusal, client side (D5). STUB: 1B holds a Web Lock
    // for the life of the session, which works with the helper down. The
    // failure code and the shape of the answer are already here.
    function acquireWindowLock(reviewId) {
      void reviewId;
      return { acquired: true, holder: null, failure: null, isStub: true };
    }

    function refusalFailure() {
      return failures.failure("SECOND_TAB_REFUSED", null);
    }

    return {
      keyFor: keyFor,
      read: read,
      write: write,
      writeDraft: writeDraft,
      readItem: readItem,
      remove: remove,
      reviews: reviews,
      mergeWithHelper: mergeWithHelper,
      acquireWindowLock: acquireWindowLock,
      refusalFailure: refusalFailure
    };
  }

  var shared = createStore();

  return {
    KEY_PREFIX: KEY_PREFIX,
    keyFor: keyFor,
    createStore: createStore,
    shared: shared
  };
});
