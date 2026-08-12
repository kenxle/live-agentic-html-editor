// Caret and selection helpers.
//
// The design choice that matters, and the reason this is a helper rather than a
// line in each test: caret identity is compared by NODE IDENTITY, not by an id
// and not by a path.
//
// A path or an id survives exactly the thing we are trying to catch. A repaint
// that replaces a paragraph's children builds a fresh text node holding the same
// characters, at the same path, inside an element with the same id. Compared by
// path the assertion passes while the caret is dead. Compared with === on the
// node reference it fails, correctly.
//
// So the captured nodes stay INSIDE the page, in window.__laheTest.carets, and
// the comparison happens there too. What crosses the wire is a serializable
// descriptor, used only to write a failure message someone can act on.
//
// The rect comparison is the second half. Node identity says the node survived.
// The rect says the caret is still in the same place on screen, which catches a
// repaint that kept the node and rearranged everything around it.

"use strict";

const { installBridge } = require("./bridge");

let tokenSeq = 0;

function nextToken(prefix) {
  tokenSeq += 1;
  return prefix + "-" + tokenSeq + "-" + Date.now();
}

/**
 * Put the caret at a character offset inside a region's text.
 *
 * Focus first, then set the selection. Focusing a contenteditable can collapse
 * the selection to its start, so the other order silently loses the offset.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, offset: number, textNodeIndex?: number}} options
 * @returns {Promise<{text: string, offset: number, length: number}>}
 */
async function placeCaret(page, options) {
  const selector = options.selector;
  const offset = options.offset;
  const textNodeIndex = options.textNodeIndex ?? 0;

  return page.evaluate(
    function (args) {
      const el = document.querySelector(args.selector);
      if (!el) throw new Error("placeCaret: no element matches " + args.selector);
      el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const target = nodes[args.textNodeIndex];
      if (!target) {
        throw new Error(
          "placeCaret: " +
            args.selector +
            " has " +
            nodes.length +
            " text nodes, wanted index " +
            args.textNodeIndex
        );
      }
      const length = target.nodeValue.length;
      const at = Math.max(0, Math.min(args.offset, length));
      const range = document.createRange();
      range.setStart(target, at);
      range.collapse(true);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { text: target.nodeValue, offset: at, length: length };
    },
    { selector: selector, offset: offset, textNodeIndex: textNodeIndex }
  );
}

/**
 * Capture the current selection so it can be compared later by node identity.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{token?: string}} [options]
 * @returns {Promise<{token: string, anchor: object, focus: object, collapsed: boolean}>}
 *   The returned object is for failure messages. The comparison itself uses the
 *   token, which points at node references held inside the page.
 */
async function captureCaret(page, options = {}) {
  await installBridge(page);
  const token = options.token || nextToken("caret");
  const snapshot = await page.evaluate(function (args) {
    const reg = window.__laheTest;
    const utils = reg.utils;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      throw new Error("captureCaret: there is no selection in the page. Call placeCaret first.");
    }
    reg.carets[args.token] = {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      activeElement: document.activeElement,
      rect: utils.caretRect(selection.anchorNode, selection.anchorOffset)
    };
    return {
      anchor: utils.describeNode(selection.anchorNode, selection.anchorOffset),
      focus: utils.describeNode(selection.focusNode, selection.focusOffset),
      collapsed: selection.isCollapsed,
      activeElementPath: utils.cssPath(document.activeElement)
    };
  }, { token: token });

  return Object.assign({ token: token }, snapshot);
}

/**
 * Compare the live selection against a captured one and report every way they
 * differ. Returns a report rather than throwing, so callers can assert on the
 * part they care about.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{token: string}} handle from captureCaret
 * @param {{expectedOffsetDelta?: number, rectTolerance?: number}} [options]
 *   `expectedOffsetDelta` is for the typing case: after typing ten characters
 *   into the caret's own text node, the caret should be ten further along in the
 *   SAME node. Default 0. The rect check is skipped when the offset is expected
 *   to move, because the caret is supposed to have advanced across the line.
 */
async function compareCaret(page, handle, options = {}) {
  await installBridge(page);
  const expectedOffsetDelta = options.expectedOffsetDelta ?? 0;
  const rectTolerance = options.rectTolerance ?? 1;

  return page.evaluate(
    function (args) {
      const reg = window.__laheTest;
      const utils = reg.utils;
      const stored = reg.carets[args.token];
      if (!stored) throw new Error("compareCaret: unknown caret token " + args.token);

      const selection = document.getSelection();
      const hasSelection = !!selection && selection.rangeCount > 0;
      const liveAnchor = hasSelection ? selection.anchorNode : null;
      const liveOffset = hasSelection ? selection.anchorOffset : null;
      const liveRect = utils.caretRect(liveAnchor, liveOffset);
      const expectedOffset = stored.anchorOffset + args.expectedOffsetDelta;

      let rectMoved = false;
      if (args.expectedOffsetDelta === 0) {
        rectMoved =
          !stored.rect || !liveRect
            ? true
            : Math.abs(stored.rect.x - liveRect.x) > args.rectTolerance ||
              Math.abs(stored.rect.y - liveRect.y) > args.rectTolerance;
      }

      return {
        hasSelection: hasSelection,
        nodeIdentical: liveAnchor === stored.anchorNode,
        nodeConnected: !!stored.anchorNode && stored.anchorNode.isConnected,
        offsetMatches: liveOffset === expectedOffset,
        expectedOffset: expectedOffset,
        liveOffset: liveOffset,
        rectMoved: rectMoved,
        rectTolerance: args.rectTolerance,
        activeElementIdentical: document.activeElement === stored.activeElement,
        captured: utils.describeNode(stored.anchorNode, stored.anchorOffset),
        live: utils.describeNode(liveAnchor, liveOffset),
        capturedRect: stored.rect,
        liveRect: liveRect
      };
    },
    { token: handle.token, expectedOffsetDelta: expectedOffsetDelta, rectTolerance: rectTolerance }
  );
}

function caretProblems(report) {
  const problems = [];
  if (!report.hasSelection) problems.push("the selection is gone entirely");
  if (!report.nodeConnected) problems.push("the captured text node was removed from the document");
  if (!report.nodeIdentical) {
    problems.push(
      "the caret is in a DIFFERENT node than the one captured, compared by identity rather than by path. " +
        "A repaint that rebuilds a subtree produces a node holding the same text at the same path, " +
        "which is exactly what this check exists to catch"
    );
  }
  if (!report.offsetMatches) {
    problems.push("offset is " + report.liveOffset + ", expected " + report.expectedOffset);
  }
  if (report.rectMoved) {
    problems.push(
      "the caret rect moved more than " +
        report.rectTolerance +
        "px: was " +
        JSON.stringify(report.capturedRect) +
        ", now " +
        JSON.stringify(report.liveRect)
    );
  }
  return problems;
}

/**
 * Assert the caret did not move: same text node by identity, same offset, same
 * screen position within tolerance, and the node is still in the document.
 *
 * Use this around an action that must not disturb the reviewer: a repaint of a
 * subtree they are not in, a replay pass over other regions, a rail update.
 * For the typing case use assertCaretSurvivesTyping in assertions.js, which
 * allows the offset to advance by exactly what was typed.
 *
 * @throws with every difference listed, plus both node descriptors
 */
async function assertCaretUnmoved(page, handle, options = {}) {
  const report = await compareCaret(page, handle, options);
  const problems = caretProblems(report);
  if (problems.length > 0) {
    throw new Error(
      "assertCaretUnmoved failed:\n  - " +
        problems.join("\n  - ") +
        "\nCaptured: " +
        JSON.stringify(report.captured) +
        "\nLive:     " +
        JSON.stringify(report.live)
    );
  }
  return report;
}

module.exports = {
  placeCaret,
  captureCaret,
  compareCaret,
  caretProblems,
  assertCaretUnmoved
};
