// The listener registry.
//
// Owner (from Phase 1 on): Task 2C, living in the page. Phase 0 ships it
// working, not stubbed, because it is small and because the leak it prevents is
// invisible until a test counts it.
//
// Why it exists. The Steady Thread dev layer re-registers document-level
// mousedown and mouseup on every morph with no removal, so handlers accumulate
// for the life of the page: after 100 morphs one gesture produces 100 items.
// The contract in architecture D5 is that every handler is de-registered before
// re-registration, and a contract nobody can measure is a wish. So the registry
// exposes count(), and plan test 20 asserts it is unchanged after 100 morphs.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  function createRegistry() {
    var entries = [];

    // Binds a listener and remembers it. Returns a handle whose off() removes
    // it. Every binding in the layer goes through here; a raw addEventListener
    // in layer code is a bug a reviewer can spot by grep.
    function on(target, type, handler, options, group) {
      if (!target || typeof target.addEventListener !== "function") {
        throw new TypeError("listeners.on: target must support addEventListener");
      }
      if (typeof type !== "string" || !type) throw new TypeError("listeners.on: type must be a non-empty string");
      if (typeof handler !== "function") throw new TypeError("listeners.on: handler must be a function");
      target.addEventListener(type, handler, options);
      var entry = {
        target: target,
        type: type,
        handler: handler,
        options: options,
        group: group || "default",
        boundAt: Date.now()
      };
      entries.push(entry);
      return {
        entry: entry,
        off: function () {
          removeEntry(entry);
        }
      };
    }

    function removeEntry(entry) {
      var i = entries.indexOf(entry);
      if (i === -1) return false;
      entries.splice(i, 1);
      try {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options);
      } catch (err) {
        // A detached node throwing on removal is not worth failing a remount
        // over, and the entry is gone from the registry either way.
      }
      return true;
    }

    // Removes every listener in a group. Remount calls this before it
    // re-registers, which is the whole contract in one line.
    function offGroup(group) {
      var doomed = entries.filter(function (e) {
        return e.group === group;
      });
      doomed.forEach(removeEntry);
      return doomed.length;
    }

    function offAll() {
      var n = entries.length;
      entries.slice().forEach(removeEntry);
      return n;
    }

    // The observable that makes the leak testable.
    function count(group) {
      if (group === undefined) return entries.length;
      return entries.filter(function (e) {
        return e.group === group;
      }).length;
    }

    function groups() {
      var seen = {};
      entries.forEach(function (e) {
        seen[e.group] = (seen[e.group] || 0) + 1;
      });
      return seen;
    }

    return { on: on, offGroup: offGroup, offAll: offAll, count: count, groups: groups };
  }

  // Group names, spelled once so remount can clear exactly what it re-binds.
  var GROUP = {
    DOCUMENT: "document", // click, keydown, selection on the reviewed document
    OVERLAY: "overlay", // the rail's own UI
    NAVIGATION: "navigation", // turbo:morph, turbo:load, popstate, pushState shim
    STORAGE: "storage", // storage events for the second-tab lock
    NETWORK: "network", // online/offline, the lifecycle stream
    // The two surfaces that register their own document-level handlers. They
    // are named here, and read by comments.js, editing.js and inject.js, so the
    // remount clears exactly what those two files re-register. A group spelled
    // as a literal in two files is a leak the registry count cannot see: the
    // handlers pile up under a name the remount never asks about.
    COMMENTS: "comments", // the comment surface's keydown, mousemove, click
    EDITING: "editing" // the editing surface's keydown, click, and block input
  };

  var shared = createRegistry();

  var api = {
    createRegistry: createRegistry,
    GROUP: GROUP,
    shared: shared,
    on: function (t, ty, h, o, g) {
      return shared.on(t, ty, h, o, g);
    },
    offGroup: function (g) {
      return shared.offGroup(g);
    },
    offAll: function () {
      return shared.offAll();
    },
    count: function (g) {
      return shared.count(g);
    }
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.listeners = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
