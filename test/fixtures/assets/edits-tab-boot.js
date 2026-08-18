// The boot 3D's browser spec drives: THE REAL BOOT.
//
// It wires nothing of its own. LAHE.layer.boot is the shipped boot, which is
// what mounts the rail, the Active tab and the Edits tab; everything below is a
// reader or a gesture the spec cannot express as a keystroke (a delete has no
// keystroke, and a selection inside a block is a Range, not a key).
//
// If an assertion in the Edits tab spec could pass because of a line in this
// file, the line is in the wrong file.
//
// Everything the spec reads is under window.__laheEdits.

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "review-3d";

  var handle = LAHE.layer.boot({ review: reviewId, startSync: false });
  var rail = handle.rail;
  var editing = handle.editing;
  var comments = handle.comments;

  function tab() {
    return handle.editsTab ? handle.editsTab() : null;
  }

  // The Edits pane and the Active pane, straight off the rail's own accessor.
  // Both live in a closed shadow root, so a selector from the spec cannot reach
  // them and this is the only honest way to count what is really in each one.
  function paneRows(name) {
    var pane = rail.tabBody(name);
    if (!pane) return [];
    return Array.prototype.slice.call(pane.querySelectorAll("[data-lahe-edit-row]"));
  }

  function selectWordIn(blockId, word) {
    var el = document.getElementById(blockId);
    if (!el) return false;
    var text = null;
    for (var i = 0; i < el.childNodes.length; i += 1) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].nodeValue.indexOf(word) !== -1) {
        text = el.childNodes[i];
        break;
      }
    }
    if (!text) return false;
    var at = text.nodeValue.indexOf(word);
    var range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + word.length);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  window.__laheEdits = {
    reviewId: reviewId,

    items: function () {
      return handle.store.read(reviewId);
    },

    // --- gestures ------------------------------------------------------------

    editBlock: function (id) {
      var got = editing.editBlock(document.getElementById(id));
      return got ? { itemId: got.itemId, before: got.before } : null;
    },
    deleteBlock: function (id) {
      var item = editing.deleteBlock(document.getElementById(id));
      return item ? item.id : null;
    },
    selectWordIn: selectWordIn,
    format: function (command) {
      return editing.format(command);
    },
    commit: function () {
      var item = editing.commit({ reason: "spec" });
      return item ? item.id : null;
    },
    isEditing: function () {
      return editing.isEditing();
    },

    // A real comment through the real comment surface, so "hand edits are kept
    // apart from the comment thread" is measured against a comment that exists.
    commentOn: function (blockId, words, text) {
      if (!selectWordIn(blockId, words)) return null;
      var box = comments.commentOnSelection();
      if (!box) return null;
      box.type(text);
      var ready = box.markReady();
      box.close();
      return ready ? ready.id : null;
    },

    // --- the page itself -----------------------------------------------------

    blockExists: function (id) {
      return !!document.getElementById(id);
    },
    blockText: function (id) {
      var el = document.getElementById(id);
      return el ? el.textContent : null;
    },
    blockHtml: function (id) {
      var el = document.getElementById(id);
      return el ? el.innerHTML : null;
    },

    // Replay's counters, read straight off 2C's module: an undone record must
    // not be re-applied by the next pass.
    replay: function (passes) {
      for (var i = 0; i < (passes || 1); i += 1) LAHE.replay.runPass("undo");
      return Object.assign({}, LAHE.replay.counters);
    },
    replayCounters: function () {
      return Object.assign({}, LAHE.replay.counters);
    },

    // --- what the rail holds -------------------------------------------------

    currentTab: function () {
      return rail.currentTab();
    },
    selectTab: function (name) {
      return rail.selectTab(name);
    },
    countFor: function (name) {
      return rail.countFor(name);
    },
    pillCount: function () {
      rail.collapse(true);
      return rail.geometry().pillCount;
    },
    // Edit rows found in a pane, by the row's own marker attribute. This is the
    // "none of them appear in the Active thread" measurement.
    rowsInPane: function (name) {
      return paneRows(name).map(function (node) {
        return {
          id: node.getAttribute("data-lahe-edit-row"),
          kind: node.getAttribute("data-kind"),
          text: node.textContent
        };
      });
    },

    // --- what the Edits tab says about itself --------------------------------

    rowCount: function () {
      var t = tab();
      return t ? t.rowCount() : -1;
    },
    rows: function () {
      var t = tab();
      return t ? t.rows() : null;
    },
    // The Edits pane, open and on screen, which is what a geometry click needs.
    showEditsTab: function () {
      rail.collapse(false);
      return rail.selectTab("edits");
    },

    // The row's own Undo button, where it really is on screen. The root is
    // closed, so a selector from the spec cannot reach it and hit-testing is the
    // only honest way in: it is also what a hand does.
    undoButtonInfo: function (id) {
      var pane = rail.tabBody("edits");
      if (!pane) return null;
      var row = pane.querySelector('[data-lahe-edit-row="' + id + '"]');
      if (!row) return null;
      var button = row.querySelector('[data-lahe-act="undo"]');
      if (!button) return null;
      // The pane scrolls, so a row further down the list is behind the fold
      // until the reviewer scrolls to it. Measuring without this reports a
      // position the mouse cannot reach.
      button.scrollIntoView({ block: "center" });
      var rect = button.getBoundingClientRect();
      return {
        label: button.textContent,
        disabled: !!button.disabled,
        title: button.title || null,
        visible: rect.width > 0 && rect.height > 0,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2
      };
    },

    // What a row says when an undo could not be carried out.
    rowFailure: function (id) {
      var pane = rail.tabBody("edits");
      if (!pane) return null;
      var row = pane.querySelector('[data-lahe-edit-row="' + id + '"]');
      if (!row) return null;
      var said = row.querySelector("[data-lahe-undo-failed]");
      return said && said.textContent ? said.textContent : null;
    },

    exportEnabled: function () {
      var t = tab();
      return t ? t.exportEnabled() : null;
    },
    exportTitle: function () {
      var t = tab();
      return t ? t.exportTitle() : null;
    },
    clickExport: function () {
      var t = tab();
      if (!t) return null;
      var button = t.exportButton();
      if (!button) return null;
      if (button.disabled) {
        // A disabled button's click never runs, so answer with what the button
        // itself tells the reviewer.
        return { ok: false, reason: button.title, text: null };
      }
      button.click();
      // exportList is a promise now (3C's seam delivers the file); the click
      // handler kicked it off, and page.evaluate awaits what we return.
      return t.exportDone() || t.lastExport();
    }
  };
})();
