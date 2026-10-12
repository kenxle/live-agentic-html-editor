// Put text on the clipboard, with or without the clipboard API.
//
// ONE FUNCTION, SHARED. `navigator.clipboard` exists only in a secure context,
// and a page at a plain-HTTP address that is not a loopback name (a typed
// `.lahe` address, once the short ending exists) is not one. So the API is
// tried first, and when it is missing, or it refuses, the text goes into a
// hidden field, is selected, and the browser's own copy command runs. That
// works on any page, on a click.
//
// The Library page uses it for its Copy button. The rail's copy buttons can
// call the same function: this file loads on its own, so it can move into the
// bundle's list in src/shared/manifest.js without change.
//
// ORDER MATTERS. The field fallback runs synchronously when the API is
// missing, inside the click that asked, because Safari only runs the copy
// command while that click is still happening.
//
// Dual-environment module, like src/shared/: the browser gets LAHE.copyText,
// node:test gets module.exports and passes the document and navigator in.

(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.copyText = factory();
  } else {
    module.exports = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Copy `text` with the browser's copy command, through a hidden field. True
   * when the command ran and said it worked.
   *
   * @param {Document} doc
   * @param {string} text
   */
  function copyViaField(doc, text) {
    if (!doc || !doc.body || typeof doc.execCommand !== "function") return false;
    var before = doc.activeElement;
    var field = doc.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.setAttribute("tabindex", "-1");
    // Off screen, not display:none, which would stop it from being selected.
    field.style.position = "fixed";
    field.style.top = "0";
    field.style.left = "-9999px";
    field.style.opacity = "0";
    doc.body.appendChild(field);
    var ok = false;
    try {
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, text.length);
      ok = doc.execCommand("copy") === true;
    } catch (err) {
      ok = false;
    }
    if (field.parentNode) field.parentNode.removeChild(field);
    if (before && typeof before.focus === "function") {
      try {
        before.focus({ preventScroll: true });
      } catch (err) {
        // The old focus target is gone; nothing to give back.
      }
    }
    return ok;
  }

  /**
   * @param {string} text
   * @param {{navigator?: object, document?: Document}} [env] the page's own by
   *   default; a test passes stand-ins
   * @returns {Promise<boolean>} whether the text reached the clipboard
   */
  function copyText(text, env) {
    var e = env || {};
    var nav = e.navigator || (typeof navigator !== "undefined" ? navigator : null);
    var doc = e.document || (typeof document !== "undefined" ? document : null);
    var value = String(text === undefined || text === null ? "" : text);
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      // Called now, not in a later turn, so it still counts as the click's.
      var attempt;
      try {
        attempt = Promise.resolve(nav.clipboard.writeText(value));
      } catch (err) {
        attempt = Promise.reject(err);
      }
      return attempt.then(
        function () { return true; },
        // Refused (no permission, or the page lost focus): the field may
        // still work.
        function () { return copyViaField(doc, value); }
      );
    }
    return Promise.resolve(copyViaField(doc, value));
  }

  return copyText;
});
