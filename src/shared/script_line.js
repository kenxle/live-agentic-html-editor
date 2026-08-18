// The script line inside an HTML file: finding it, placing it, replacing it,
// taking it out.
//
// Owner: 3B, shared with 1A. This used to live in src/cli/commands/add.js and
// nothing else could reach it. The helper now heals a page whose rebuild
// stripped the line (src/service/heal.js), and it must write the SAME line, in
// the same place, that `add` writes. Two copies of that logic is exactly the
// drift CONTRACTS.md's one-definition rule exists to stop, so the logic moved
// here and both callers import it. The pinned tag form itself is still
// protocol.scriptTag's and is not restated here.
//
// Node-only: not in the bundle, because only the helper and the CLI edit files.

"use strict";

// Every script tag `add` has ever written, found by the attribute that only it
// writes. The attribute list cannot contain a `>`, so a negated class is enough
// and it spans the newlines the pinned form has in it.
var EXISTING_TAG = /<script\b[^>]*data-lahe-review="([^"]*)"[^>]*>\s*<\/script>/i;

function indentBlock(text, indent) {
  if (!indent) return text;
  return text
    .split("\n")
    .map(function (line, i) {
      return i === 0 ? line : indent + line;
    })
    .join("\n");
}

/** The whitespace at the start of the line `index` falls on. */
function indentAt(html, index) {
  var lineStart = html.lastIndexOf("\n", index - 1) + 1;
  var match = /^[ \t]*/.exec(html.slice(lineStart, index));
  return match ? match[0] : "";
}

/**
 * Where a new script line goes, and what the file looks like with it there.
 *
 * THE POSITION RULE, in order:
 *   1. Immediately before the LAST `</body>`, on its own line, at that tag's
 *      indentation. Last, not first, because a page that quotes `</body>` in
 *      prose or in a nested template still ends at the real one.
 *   2. Failing that, before the last `</html>`, same rule. A fragment with no
 *      body still has a document end.
 *   3. Failing both, appended, with a trailing newline. A fragment included by
 *      something else is a real thing to review and the line still runs.
 *
 * `defer` is on the tag, so the position is about being unmissable to a human
 * reading the file, not about execution order.
 */
function placeScriptLine(html, tag) {
  var closers = [/<\/body\s*>/gi, /<\/html\s*>/gi];
  for (var i = 0; i < closers.length; i += 1) {
    var last = null;
    var regex = closers[i];
    var found;
    regex.lastIndex = 0;
    while ((found = regex.exec(html)) !== null) last = found;
    if (last) {
      var at = last.index;
      var indent = indentAt(html, at);
      var lineStart = html.lastIndexOf("\n", at - 1) + 1;
      var block = indent + indentBlock(tag, indent) + "\n";
      return {
        html: html.slice(0, lineStart) + block + html.slice(lineStart),
        where: i === 0 ? "just before </body>" : "just before </html>",
        indent: indent
      };
    }
  }
  var tail = html.length === 0 || html.slice(-1) === "\n" ? "" : "\n";
  return { html: html + tail + tag + "\n", where: "at the end of the file", indent: "" };
}

/** Replace the tag already in the file, keeping its position and indentation. */
function replaceScriptLine(html, tag) {
  var found = EXISTING_TAG.exec(html);
  if (!found) return null;
  var indent = indentAt(html, found.index);
  return {
    html: html.slice(0, found.index) + indentBlock(tag, indent) + html.slice(found.index + found[0].length),
    where: "in the place it already had",
    indent: indent
  };
}

/**
 * Take the script line back out, and take nothing else.
 *
 * The match is the same attribute-keyed one `add` writes with, so the only tag
 * that can be removed is one `add` put there. The line's own indentation and the
 * newline that ends it go with it, so no blank line is left behind; a tag that
 * shares its line with other markup loses only itself.
 *
 * @returns {{html: string, review: string}|null} null when there was no line.
 */
function removeScriptLine(html) {
  var found = EXISTING_TAG.exec(html);
  if (!found) return null;
  var start = found.index;
  var end = start + found[0].length;
  var lineStart = html.lastIndexOf("\n", start - 1) + 1;
  var onItsOwnLine = /^[ \t]*$/.test(html.slice(lineStart, start));
  if (onItsOwnLine) {
    start = lineStart;
    if (html.slice(end, end + 1) === "\n") end += 1;
  }
  return { html: html.slice(0, start) + html.slice(end), review: found[1] };
}

/** The review id the file's script line names, or null when it carries none. */
function reviewAlreadyInFile(html) {
  var found = EXISTING_TAG.exec(html);
  return found ? found[1] : null;
}

module.exports = {
  EXISTING_TAG: EXISTING_TAG,
  indentAt: indentAt,
  indentBlock: indentBlock,
  placeScriptLine: placeScriptLine,
  replaceScriptLine: replaceScriptLine,
  removeScriptLine: removeScriptLine,
  reviewAlreadyInFile: reviewAlreadyInFile
};
