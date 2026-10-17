// Choice buttons: arm the choice groups an agent wrote into a document page,
// mint a press, and raise the refusal chip.
//
// Owner: choice-buttons core. docs/features/20261013.01_choice_buttons.
//
// A choice group is a house component an agent writes as plain HTML:
//
//   <div class="choice" data-choice="lesson-css-counter">
//     <p class="choice-q">Promote this lesson?</p>
//     <button type="button" value="promote" data-recommended>Promote</button>
//     <button type="button" value="discard">Discard</button>
//   </div>
//
// THIS FILE ARMS GROUPS ONLY ON A DOCUMENT PAGE: one whose script tag carries
// data-lahe-document, which the helper writes onto pages it serves itself and
// nowhere else. On any other page (a `lahe add` dev server) nothing here
// touches the page, claims a click, or raises a chip: D3, browse is the page
// untouched, holds in full.
//
// On a document page, a group is ARMED when its name and every button value
// match record.CHOICE_TOKEN, its name is unique on the page, it has two or more
// buttons, and at most one carries data-chosen. Any other group gets
// data-lahe-inert, so the stylesheet draws it as plain content, and one rail
// chip names every such group and why (brief R4).
//
// A PRESS is decided by gestures.gestureFor (PRESS_CHOICE: browse, not picking,
// no edit open, a window that may write, not presenting). It mints a choice
// record in draft and marks it ready in the same tick, with no immediate
// flush: sync holds every event of a choice item until the page has been quiet
// for a few seconds, so presses close together travel together. A press on a
// group whose record is ready with no answer is a reword at the next revision;
// after a question or not_handled it continues the thread on the same record;
// after handled it is a new item.
//
// Needs record, gestures, epoch and failures, which load before it
// (src/shared/manifest.js). Everything else (the store, sync, the rail, the
// page identity, the heading reader) is handed in by index.js.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.choices = factory(root.LAHE.record, root.LAHE.gestures, root.LAHE.epoch, root.LAHE.failures);
  } else {
    module.exports = factory(
      require("../shared/record.js"),
      require("../shared/gestures.js"),
      require("../shared/epoch.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record, gestures, epoch, failures) {
  "use strict";

  var M = record.CHOICE_MARKUP;
  var F = record.FIELD;
  var INERT_CODE = "CHOICE_GROUP_INERT";

  // Why a group is not armed. The value written into data-lahe-inert, and the
  // key the chip's sentence is chosen by.
  var REFUSAL = {
    NO_NAME: "no-name",
    BAD_NAME: "bad-name",
    DUPLICATE: "duplicate",
    TOO_FEW: "too-few-buttons",
    BAD_VALUE: "bad-value",
    SAME_VALUE: "same-value",
    TWO_CHOSEN: "two-chosen"
  };

  function textOf(node) {
    return String((node && node.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function clip(text, max) {
    return text.length <= max ? text : text.slice(0, max - 1) + "…";
  }

  function hasClass(node, name) {
    var classes = node && typeof node.getAttribute === "function" ? node.getAttribute("class") : null;
    if (!classes) return false;
    return (" " + classes.replace(/\s+/g, " ") + " ").indexOf(" " + name + " ") !== -1;
  }

  function buttonsOf(group) {
    return Array.prototype.slice.call(group.querySelectorAll("button"));
  }

  /** The group's question, as the reviewer reads it, or null. */
  function questionOf(group) {
    var q = group.querySelector("." + M.QUESTION_CLASS);
    var text = textOf(q);
    return text || null;
  }

  /**
   * One group's verdict. Pure over the element and the page's name counts, so
   * the rule is the same at boot, after a repaint and at click time.
   *
   * @returns {{group: Element, name: (string|null), refusal: (string|null), detail: (string|null)}}
   */
  function judge(group, counts) {
    var name = group.getAttribute(M.NAME_ATTR);
    var out = { group: group, name: name, refusal: null, detail: null };
    if (name === null || name === "") {
      out.refusal = REFUSAL.NO_NAME;
      out.detail = "it has no data-choice name";
      return out;
    }
    if (!record.isChoiceToken(name)) {
      out.refusal = REFUSAL.BAD_NAME;
      out.detail = "its name \"" + clip(name, 40) + "\" is not 1 to 32 lowercase letters, digits and hyphens";
      return out;
    }
    if (counts[name] > 1) {
      out.refusal = REFUSAL.DUPLICATE;
      out.detail = counts[name] + " groups on this page are named " + name;
      return out;
    }
    var buttons = buttonsOf(group);
    if (buttons.length < 2) {
      out.refusal = REFUSAL.TOO_FEW;
      out.detail = buttons.length === 1 ? "it has only one button" : "it has no buttons";
      return out;
    }
    var seen = Object.create(null);
    var chosen = 0;
    for (var i = 0; i < buttons.length; i += 1) {
      var value = buttons[i].getAttribute("value");
      if (!record.isChoiceToken(value)) {
        out.refusal = REFUSAL.BAD_VALUE;
        out.detail =
          "the button \"" + clip(textOf(buttons[i]), 40) + "\" has " +
          (value === null || value === "" ? "no value" : "the value \"" + clip(value, 40) + "\", which is not 1 to 32 lowercase letters, digits and hyphens");
        return out;
      }
      if (seen[value]) {
        out.refusal = REFUSAL.SAME_VALUE;
        out.detail = "two buttons have the value " + value;
        return out;
      }
      seen[value] = true;
      if (buttons[i].hasAttribute(M.CHOSEN_ATTR)) chosen += 1;
    }
    if (chosen > 1) {
      out.refusal = REFUSAL.TWO_CHOSEN;
      out.detail = "more than one button carries data-chosen";
    }
    return out;
  }

  /** How the chip names a group: its name when it has a usable one, else its question. */
  function groupLabel(verdict) {
    if (verdict.name && record.isChoiceToken(verdict.name)) return "The choice " + verdict.name;
    var q = questionOf(verdict.group);
    return q ? "The choice asking \"" + clip(q, 60) + "\"" : "A choice with no name or question";
  }

  /** The chip's detail: one sentence per refused group, in page order. */
  function chipDetail(refused) {
    var said = Object.create(null);
    var lines = [];
    refused.forEach(function (v) {
      var line = groupLabel(v) + ": " + v.detail + ".";
      if (said[line]) return;
      said[line] = true;
      lines.push(line);
    });
    return lines.join("\n");
  }

  /**
   * @param {Object} options
   *   document, window
   *   isDocument  true when the script tag carries data-lahe-document
   *   store       the page-scoped store; reviewId
   *   page        () => the record.pageFrom of the page right now
   *   sync        the sync client (recordItem)
   *   rail        the overlay rail (failures)
   *   gate        () => {pickMode, editing, editState, mayWrite, presenting}
   *   headingFor  (element) => the nearest heading's words, or null
   *   listeners   the listener registry and its GROUP
   *   onPress     (item) => called after a press is stored and posted
   */
  function createChoices(options) {
    var opts = options || {};
    var doc = opts.document || null;
    var isDocument = opts.isDocument === true;
    var store = opts.store;
    var reviewId = opts.reviewId;
    var armed = [];
    var refused = [];
    var counters = { arms: 0, presses: 0, refusedPresses: 0 };
    var bound = null;

    function groupsOnPage() {
      if (!doc || typeof doc.querySelectorAll !== "function") return [];
      return Array.prototype.slice.call(doc.querySelectorAll("." + M.GROUP_CLASS)).filter(function (node) {
        return hasClass(node, M.GROUP_CLASS);
      });
    }

    /**
     * Judge every group on the page. On a document page, refused groups get
     * data-lahe-inert and the chip; armed ones lose any inert mark a fixed
     * rebuild left. Off a document page nothing is written and no chip shows.
     *
     * @returns {{armed: Array, refused: Array}}
     */
    function arm() {
      counters.arms += 1;
      var groups = groupsOnPage();
      if (!isDocument) {
        armed = [];
        refused = [];
        return { armed: [], refused: [] };
      }
      var counts = Object.create(null);
      groups.forEach(function (g) {
        var name = g.getAttribute(M.NAME_ATTR);
        if (record.isChoiceToken(name)) counts[name] = (counts[name] || 0) + 1;
      });
      var verdicts = groups.map(function (g) {
        return judge(g, counts);
      });
      armed = verdicts.filter(function (v) {
        return !v.refusal;
      });
      refused = verdicts.filter(function (v) {
        return !!v.refusal;
      });
      var writes = [];
      verdicts.forEach(function (v) {
        var want = v.refusal || null;
        if (v.group.getAttribute(M.INERT_ATTR) !== want) writes.push({ node: v.group, value: want });
      });
      if (writes.length) {
        epoch.write("choices", function () {
          writes.forEach(function (w) {
            if (w.value === null) w.node.removeAttribute(M.INERT_ATTR);
            else w.node.setAttribute(M.INERT_ATTR, w.value);
          });
        });
      }
      if (opts.rail && opts.rail.failures) {
        if (refused.length) opts.rail.failures.add(failures.failure(INERT_CODE, chipDetail(refused)));
        else opts.rail.failures.clear(INERT_CODE);
      }
      return { armed: armed.slice(), refused: refused.slice() };
    }

    /** The armed group a click landed in, and its button, or null. */
    function armedTarget(target) {
      var node = target && target.nodeType === 1 ? target : target && target.parentElement;
      var button = node && typeof node.closest === "function" ? node.closest("button") : null;
      if (!button) return null;
      var group = button.closest("." + M.GROUP_CLASS);
      if (!group) return null;
      for (var i = 0; i < armed.length; i += 1) {
        if (armed[i].group === group) return { group: group, button: button, name: armed[i].name };
      }
      // A group the page put in since the last arming pass (a morph replaced
      // the node): judge the page again and look once more.
      arm();
      for (var j = 0; j < armed.length; j += 1) {
        if (armed[j].group === group) return { group: group, button: button, name: armed[j].name };
      }
      return null;
    }

    // WHAT WAS OPEN WHEN THE POINTER WENT DOWN. Leaving an open edit commits
    // it on pointerdown (gestures, "the pointer going down anywhere outside
    // the block"), so by the click that follows no edit is open and the gate
    // would read browse. The window's capture phase runs before every
    // document listener, so the gate is read here first, and the click on the
    // same button within a moment uses it.
    var PRESS_SNAPSHOT_MS = 2000;
    var downSnapshot = null;

    function readGate() {
      return typeof opts.gate === "function" ? opts.gate() || {} : {};
    }

    function onPointerDown(event) {
      if (!isDocument) return;
      var node = event.target && event.target.nodeType === 1 ? event.target : null;
      var button = node && typeof node.closest === "function" ? node.closest("button") : null;
      downSnapshot = button ? { button: button, at: Date.now(), gate: readGate() } : null;
    }

    function gateForClick(button) {
      var now = readGate();
      var snap = downSnapshot;
      downSnapshot = null;
      if (!snap || snap.button !== button || Date.now() - snap.at > PRESS_SNAPSHOT_MS) return now;
      var out = {};
      ["pickMode", "editing", "editState", "presenting"].forEach(function (key) {
        out[key] = now[key] === true || snap.gate[key] === true;
      });
      out.mayWrite = now.mayWrite === true && snap.gate.mayWrite === true;
      return out;
    }

    function onClick(event) {
      if (!isDocument) return;
      // A click the library already took is not a press. The pick handler
      // listens on the same target in the same phase, closes pick mode and
      // calls preventDefault, so by the time this runs the gate would read
      // "not picking". Its own mark on the event is the honest answer.
      if (event.defaultPrevented) {
        counters.refusedPresses += 1;
        return;
      }
      var hit = armedTarget(event.target);
      var gate = gateForClick(hit ? hit.button : null);
      var decided = gestures.gestureFor({
        type: "click",
        inOverlay: false,
        inArmedChoice: !!hit,
        documentPage: isDocument,
        pickMode: gate.pickMode === true,
        editing: gate.editing === true,
        editState: gate.editState === true,
        mayWrite: gate.mayWrite === true,
        presenting: gate.presenting === true
      });
      if (decided.gesture !== gestures.GESTURE.PRESS_CHOICE) {
        if (hit) counters.refusedPresses += 1;
        return;
      }
      if (decided.preventDefault) event.preventDefault();
      press(hit.group, hit.button.getAttribute("value"));
    }

    function bind() {
      if (bound || !doc || !opts.listeners) return;
      var target = opts.window && typeof opts.window.addEventListener === "function" ? opts.window : doc;
      bound = [
        opts.listeners.registry.on(target, "pointerdown", onPointerDown, { capture: true }, opts.listeners.group),
        opts.listeners.registry.on(doc, "click", onClick, { capture: true }, opts.listeners.group)
      ];
    }

    function unbind() {
      (bound || []).forEach(function (one) {
        if (one && typeof one.off === "function") one.off();
      });
      bound = null;
    }

    /** This page's choice records for one group, as the store holds them now. */
    function recordsFor(name) {
      return store.read(reviewId).filter(function (item) {
        return record.isChoice(item) && item[F.CHOICE] && item[F.CHOICE].group === name;
      });
    }

    function freshPress(group, name, answer) {
      var page = typeof opts.page === "function" ? opts.page() : opts.page || {};
      var heading = typeof opts.headingFor === "function" ? opts.headingFor(group) : null;
      var context = record.emptyContext();
      context.quote = questionOf(group);
      context.heading = heading || null;
      return record.newItem({
        kind: record.KIND.CHOICE,
        state: record.STATE.DRAFT,
        page_origin: page.origin,
        page_path: page.path,
        page_title: page.title,
        page_seq: page.seq,
        source_hint: page.source_hint,
        choice: { group: name, answer: answer },
        context: context,
        region: { ref: record.choiceRef(name), label: "choice", lost: null, accepted_page_texts: [], check_reopen: null }
      });
    }

    /**
     * What a press on this group does to its records. Returns the record to
     * store, or null when the press changes nothing (the same answer pressed
     * again while it waits for the agent).
     */
    function nextRecord(group, name, answer) {
      var current = record.latestChoiceByGroup(recordsFor(name))[name] || null;
      if (!current || current[F.STATE] === record.STATE.HANDLED) return { item: freshPress(group, name, answer), fresh: true };
      var same = current[F.CHOICE] && current[F.CHOICE].answer === answer;
      var reply = current[F.REPLY];
      if (current[F.STATE] === record.STATE.NOT_HANDLED || (reply && current[F.STATE] === record.STATE.READY)) {
        // Answered (not_handled, or a question): a press continues the thread
        // on the same record, at the next revision. After not_handled even the
        // same answer reopens it (the reviewer still wants it). Under a
        // question the same answer changes nothing; the card's reply box is
        // where the reviewer answers in words.
        if (same && current[F.STATE] === record.STATE.READY) return null;
        var continued = record.continueThread(current, {});
        continued[F.CHOICE] = { group: name, answer: answer };
        return { item: continued, fresh: false };
      }
      if (same) return null;
      // Ready and unanswered, or a draft: a reword at the next revision.
      var reworded = record.bumpRev(current, { choice: { group: name, answer: answer } });
      reworded[F.STATE] = record.STATE.READY;
      return { item: reworded, fresh: false };
    }

    /**
     * The press itself. Draft then ready in one tick for a new item, both
     * recorded with no immediate flush; a reword or a continuation is one
     * ready write.
     *
     * @returns {Object|null} the stored record, or null when nothing changed
     */
    function press(group, answer) {
      var name = group.getAttribute(M.NAME_ATTR);
      if (!record.isChoiceToken(name) || !record.isChoiceToken(answer)) return null;
      var next = nextRecord(group, name, answer);
      if (!next) return null;
      var item = next.item;
      if (next.fresh) {
        record.validateItem(item);
        store.write(reviewId, item);
        if (opts.sync) opts.sync.recordItem(item, { press: true });
        item = Object.assign({}, item);
        item[F.STATE] = record.STATE.READY;
      }
      record.validateItem(item);
      store.write(reviewId, item);
      if (opts.sync) opts.sync.recordItem(item, { press: true });
      counters.presses += 1;
      if (typeof opts.onPress === "function") opts.onPress(item);
      return item;
    }

    /** The button's own label for an answer, read off the page, or null. */
    function labelFor(name, answer) {
      if (!doc || !record.isChoiceToken(name)) return null;
      var groups = groupsOnPage().filter(function (g) {
        return g.getAttribute(M.NAME_ATTR) === name;
      });
      if (groups.length !== 1) return null;
      var buttons = buttonsOf(groups[0]);
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].getAttribute("value") === answer) return textOf(buttons[i]) || null;
      }
      return null;
    }

    return {
      arm: arm,
      bind: bind,
      unbind: unbind,
      press: press,
      labelFor: labelFor,
      armedNames: function () {
        return armed.map(function (v) {
          return v.name;
        });
      },
      refused: function () {
        return refused.map(function (v) {
          return { name: v.name, refusal: v.refusal, detail: v.detail };
        });
      },
      isDocument: function () {
        return isDocument;
      },
      counters: counters
    };
  }

  return {
    REFUSAL: REFUSAL,
    INERT_CODE: INERT_CODE,
    judge: judge,
    chipDetail: chipDetail,
    createChoices: createChoices
  };
});
