// The tab icon a reviewed page falls back to when it declares none of its own.
//
// WHY THIS EXISTS. A reviewer usually has several documents open at once, and a
// page with no icon gets the browser's blank default: the tabs are a row of
// identical grey rectangles and finding the review means clicking through them.
// The rendered-Markdown page has carried this icon since it existed, because
// LAHE authors that page end to end. The gap was every OTHER document: an HTML
// file an agent wrote a moment ago has a title and no icon, and it is the case
// a human hits most.
//
// THE RULE IS ONE LINE: a page that declares its own icon keeps it. This is a
// floor, never an override. An author who set an icon meant it, and a served
// page is the author's document with a review layer on it, not LAHE's document.
//
// It is an inline data URI rather than a served file because the tool has zero
// runtime dependencies: this way there is no second asset for the static server
// to publish and no extra request. The drawing is a speech bubble on a blue
// rounded square, which is the review layer's own subject rather than the
// document's, and that is the honest thing for a fallback to say.

"use strict";

var LINK =
  "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='7'%20fill='%231a73e8'/%3E%3Cpath%20d='M9%208h14a3%203%200%200%201%203%203v8a3%203%200%200%201-3%203h-6l-6%205v-5H9a3%203%200%200%201-3-3v-8a3%203%200%200%201%203-3z'%20fill='%23fff'/%3E%3C/svg%3E\">";

var LINK_TAG = /<link\b[^>]*>/gi;
var REL_ATTR = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
var HEAD_OPEN = /<head\b[^>]*>/i;
var HTML_OPEN = /<html\b[^>]*>/i;
var DOCTYPE = /<!doctype\b[^>]*>/i;

/**
 * Does this page already name a tab icon of its own?
 *
 * Any icon relation counts, not just `rel="icon"`: a page that ships only
 * `apple-touch-icon` or `mask-icon` made a deliberate choice, and a second link
 * appended under it would win over the author's on some browsers and not
 * others. The test is per rel TOKEN rather than a substring of the whole
 * attribute, so `rel="stylesheet"` on a file named `icons.css` is not an icon.
 *
 * @param {string} html the page's bytes
 * @returns {boolean}
 */
function hasIcon(html) {
  var text = String(html);
  var tag;
  LINK_TAG.lastIndex = 0;
  while ((tag = LINK_TAG.exec(text)) !== null) {
    var rel = REL_ATTR.exec(tag[0]);
    if (!rel) continue;
    var tokens = String(rel[1] || rel[2] || rel[3] || "").toLowerCase().split(/\s+/);
    for (var i = 0; i < tokens.length; i += 1) {
      if (tokens[i] === "icon" || tokens[i].slice(-5) === "-icon") return true;
    }
  }
  return false;
}

/**
 * `html` with the fallback icon added, or `html` unchanged when it has one.
 *
 * Placement walks down to the least presumptuous spot that still works: inside
 * an existing `<head>`, else straight after `<html>`, else after the doctype.
 * The doctype step is the one that matters. A `<link>` prepended ABOVE
 * `<!doctype html>` puts the browser into quirks mode, which would break the
 * page's layout to decorate its tab, so nothing is ever written above it.
 *
 * @param {string} html the page's bytes
 * @returns {string}
 */
function ensure(html) {
  var text = String(html);
  if (hasIcon(text)) return text;
  var anchors = [HEAD_OPEN, HTML_OPEN, DOCTYPE];
  for (var i = 0; i < anchors.length; i += 1) {
    var found = anchors[i].exec(text);
    if (!found) continue;
    var at = found.index + found[0].length;
    return text.slice(0, at) + "\n" + LINK + text.slice(at);
  }
  return LINK + "\n" + text;
}

module.exports = {
  LINK: LINK,
  hasIcon: hasIcon,
  ensure: ensure
};
