// The page side bridge.
//
// A handful of small utilities have to run inside the page: describing a node,
// measuring a caret rect, serializing a MutationRecord. They are installed once
// per page here rather than pasted into every evaluate, so there is one
// definition of "how a node is described in a failure message" and failure
// messages read the same everywhere.
//
// This is harness-owned code and does not change when the real review layer
// lands. It knows nothing about the layer; it only knows about the DOM.
//
// Everything lives under window.__laheTest, which is the harness's namespace.
// The layer's own namespace is window.__lahe. Keeping them apart means a test
// can assert the layer left nothing behind without tripping over the harness.

"use strict";

const BRIDGE_VERSION = 1;

// This function's BODY runs in the page. It is written as a real function, not
// a string, so `node --check` in the lint gate still parses it.
function installBridgeInPage(version) {
  const reg = window.__laheTest || (window.__laheTest = {});
  if (reg.version === version) return version;

  reg.version = version;
  reg.carets = reg.carets || {};
  reg.observers = reg.observers || {};

  function cssPath(node) {
    if (!node) return "(none)";
    if (node.nodeType === 3) return cssPath(node.parentElement) + " > #text";
    const parts = [];
    let el = node;
    let depth = 0;
    while (el && el.nodeType === 1 && depth < 8) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        parts.unshift(part + "#" + el.id);
        break;
      }
      const parent = el.parentElement;
      if (parent) {
        const index = Array.prototype.indexOf.call(parent.children, el) + 1;
        part += ":nth-child(" + index + ")";
      }
      parts.unshift(part);
      el = el.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function caretRect(node, offset) {
    if (!node) return null;
    const range = document.createRange();
    try {
      range.setStart(node, offset);
      range.setEnd(node, offset);
    } catch (err) {
      return null;
    }
    let rect = range.getBoundingClientRect();
    // A collapsed range at the very end of a text node can measure as all
    // zeroes. Widen it by one character and measure that instead, so a real
    // position is never reported as the origin.
    if (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0 && node.nodeType === 3) {
      const len = node.nodeValue ? node.nodeValue.length : 0;
      const start = Math.max(0, Math.min(offset, len - 1));
      const end = Math.min(len, start + 1);
      if (end > start) {
        range.setStart(node, start);
        range.setEnd(node, end);
        rect = range.getBoundingClientRect();
      }
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function describeNode(node, offset) {
    return {
      path: cssPath(node),
      offset: offset === undefined ? null : offset,
      nodeType: node ? node.nodeType : null,
      text: node && node.nodeType === 3 ? node.nodeValue : null,
      connected: node ? node.isConnected : false,
      rect: node ? caretRect(node, offset || 0) : null
    };
  }

  function textOf(nodes) {
    return Array.prototype.map
      .call(nodes, function (node) {
        return node.nodeType === 3 ? node.nodeValue : node.textContent;
      })
      .join("");
  }

  function serializeMutation(record) {
    return {
      type: record.type,
      targetPath: cssPath(record.target),
      targetTag: record.target.nodeType === 1 ? record.target.tagName.toLowerCase() : "#text",
      attributeName: record.attributeName || null,
      oldValue: record.oldValue === undefined ? null : record.oldValue,
      newValue:
        record.type === "characterData"
          ? record.target.nodeValue
          : record.type === "attributes" && record.target.nodeType === 1
            ? record.target.getAttribute(record.attributeName)
            : null,
      addedCount: record.addedNodes.length,
      removedCount: record.removedNodes.length,
      addedText: record.addedNodes.length ? textOf(record.addedNodes).slice(0, 200) : null,
      removedText: record.removedNodes.length ? textOf(record.removedNodes).slice(0, 200) : null
    };
  }

  reg.utils = {
    cssPath: cssPath,
    caretRect: caretRect,
    describeNode: describeNode,
    serializeMutation: serializeMutation
  };

  return version;
}

/**
 * Install (or confirm) the bridge in a page. Idempotent and cheap; call it at
 * the top of any helper that evaluates bridge utilities.
 * @param {import('@playwright/test').Page} page
 */
async function installBridge(page) {
  return page.evaluate(installBridgeInPage, BRIDGE_VERSION);
}

module.exports = {
  BRIDGE_VERSION,
  installBridge
};
