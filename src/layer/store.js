// The item store: the durable queue the layer renders from.
//
// Owner: Task 1B-ii. STUB: real signatures, an in-memory backing map, and no
// browser storage yet. Downstream tasks (the rail, editing, replay, sync) can
// read and write items today; 1B-ii swaps the backing map for synchronous
// browser storage without touching a caller.
//
// The two rules 1B-ii must not lose, both from architecture D6:
//
//  1. WRITTEN SYNCHRONOUSLY ON EVERY CHANGE, before any network call. Not on a
//     timer, not debounced, not on blur. Plan test 4 asserts durability in the
//     same task as the final keystroke with no awaited timer in between, which
//     is a test a debounced store cannot pass.
//
//  2. KEYED BY CANONICAL TARGET, never by basename. The built-doc module keys
//     on the file's basename, so two index.html files in different folders
//     merge into one bucket and their comments mix.
//
// And the partition rule from D9: every served document shares one origin, so
// the browser store is partitioned per target or one served review can read
// another's unsent feedback.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.store = factory(root.LAHE.record, root.LAHE.normalize, root.LAHE.failures);
  } else {
    module.exports = factory(
      require("../shared/record.js"),
      require("../shared/normalize.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, normalize, failures) {
  "use strict";

  var KEY_PREFIX = "lahe.items.v1:";

  // The storage key for a target. Canonical target, never a basename, never a
  // display title.
  function keyFor(canonicalTarget) {
    if (typeof canonicalTarget !== "string" || !canonicalTarget) {
      throw new TypeError("store.keyFor: canonicalTarget must be a non-empty string");
    }
    return KEY_PREFIX + canonicalTarget;
  }

  function createStore() {
    // STUB backing. 1B-ii replaces this object with localStorage reads and
    // writes; every function below keeps its signature.
    var backing = Object.create(null);

    // @returns {Array<Object>} every item for this target, in creation order
    function read(canonicalTarget) {
      var k = keyFor(canonicalTarget);
      return backing[k] ? backing[k].slice() : [];
    }

    // Writes one item. Synchronous. Returns the item as stored.
    // Throws on a quota failure rather than swallowing it: R9 says failures are
    // loud, and a silently dropped write is the failure this whole tool exists
    // to remove.
    function write(canonicalTarget, item) {
      record.validateItem(item);
      var k = keyFor(canonicalTarget);
      var list = backing[k] || (backing[k] = []);
      for (var i = 0; i < list.length; i += 1) {
        if (list[i][record.FIELD.ID] === item[record.FIELD.ID]) {
          list[i] = item;
          return item;
        }
      }
      list.push(item);
      return item;
    }

    // Reads one item by id across this target.
    function readItem(canonicalTarget, id) {
      var list = read(canonicalTarget);
      for (var i = 0; i < list.length; i += 1) {
        if (list[i][record.FIELD.ID] === id) return list[i];
      }
      return null;
    }

    // Every target this origin holds anything for. Copy and Export are scoped
    // to this, honestly: with the service down, one origin's storage is one
    // origin's slice of a multi-origin review, and the export says so.
    function targets() {
      return Object.keys(backing).map(function (k) {
        return k.slice(KEY_PREFIX.length);
      });
    }

    // Removes an item. The reviewer deleting their own feedback is the only
    // caller; nothing in the tool removes an item on its own initiative.
    function remove(canonicalTarget, id) {
      var k = keyFor(canonicalTarget);
      var list = backing[k];
      if (!list) return false;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i][record.FIELD.ID] === id) {
          list.splice(i, 1);
          return true;
        }
      }
      return false;
    }

    // Reconciliation against the service projection. Lifecycle wins for the rev
    // it names; a newer local revision survives as outstanding (D6).
    // STUB: 1B-ii implements it. The signature is here so 1A can be written
    // against it.
    function reconcile(canonicalTarget, projectionItems) {
      void canonicalTarget;
      void projectionItems;
      return { updated: 0, kept_local: 0, isStub: true };
    }

    // The second-tab lock (D6, R12). STUB: 1B-ii implements the lock; the
    // failure code and the take-over affordance already exist.
    function acquireTabLock(canonicalTarget) {
      void canonicalTarget;
      return { acquired: true, holder: null, failure: null, isStub: true };
    }

    function refusalFailure() {
      return failures.failure("SECOND_TAB_REFUSED", null);
    }

    return {
      keyFor: keyFor,
      read: read,
      write: write,
      readItem: readItem,
      remove: remove,
      targets: targets,
      reconcile: reconcile,
      acquireTabLock: acquireTabLock,
      refusalFailure: refusalFailure
    };
  }

  var shared = createStore();

  return {
    KEY_PREFIX: KEY_PREFIX,
    keyFor: keyFor,
    createStore: createStore,
    shared: shared,
    normalize: normalize,
    isStub: true
  };
});
