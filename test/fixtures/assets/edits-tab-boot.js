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
      button.click();
      return t.lastExport();
    }
  };
})();
