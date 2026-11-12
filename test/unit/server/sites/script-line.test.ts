/*
 * read-when: Changing src/server/sites/script-line.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXISTING_TAG,
  placeScriptLine,
  removeScriptLine,
  replaceScriptLine,
  reviewAlreadyInFile
} from "../../../../src/server/sites/script-line.ts";

const SHORT_TAG = "<script defer></script>";

function pinnedTag(review: string): string {
  return [
    '<script src="http://127.0.0.1:7817/lahe-layer.js"',
    `        data-lahe-review="${review}"`,
    '        data-lahe-token="tok"',
    '        data-lahe-helper="http://127.0.0.1:7817"',
    "        defer></script>"
  ].join("\n");
}

function fallbackTag(review: string): string {
  return [
    '<script src="http://127.0.0.1:7817/lahe-layer.js"',
    `        data-lahe-review="${review}"`,
    `        data-lahe-token="tok_${review}"`,
    '        data-lahe-helper="http://127.0.0.1:7817"',
    '        data-lahe-fallback="lahe-layer.js"',
    "        onerror=\"var s=document.createElement('script');s.src=this.getAttribute('data-lahe-fallback');document.head.appendChild(s)\"",
    "        defer></script>"
  ].join("\n");
}

const DOCUMENT_TAG = [
  '<script src="/x.js"',
  '        data-lahe-review="rev_a"',
  '        data-lahe-token="tok"',
  '        data-lahe-helper="http://127.0.0.1:7817"',
  '        data-lahe-document="true"',
  "        defer></script>"
].join("\n");

const FORMATTED = "<html>\n  <body>\n    <p>x</p>\n  </body>\n</html>\n";

test("1, 2: the review id comes from the first empty script tag carrying data-lahe-review", () => {
  assert.equal(reviewAlreadyInFile(`<html><body>${pinnedTag("rev_one")}</body></html>`), "rev_one");
  assert.equal(reviewAlreadyInFile(`${pinnedTag("first")}\n${pinnedTag("second")}`), "first");
  assert.equal(reviewAlreadyInFile('<SCRIPT data-lahe-review="upper" defer>\n  </SCRIPT>'), "upper");
  assert.equal(reviewAlreadyInFile(DOCUMENT_TAG), "rev_a");
});

test("2: a page with no script line, or only other scripts, has no review", () => {
  assert.equal(reviewAlreadyInFile("<html><body><p>nothing here</p></body></html>"), null);
  assert.equal(reviewAlreadyInFile('<script src="app.js"></script>'), null);
  assert.equal(reviewAlreadyInFile('<script data-lahe-review="r1">window.x = 1;</script>'), null);
});

test("3: EXISTING_TAG finds the first line by exec, and its source finds every line", () => {
  const page = `<p>a</p>\n${pinnedTag("one")}\n<p>b</p>\n${pinnedTag("two")}\n`;
  assert.equal(EXISTING_TAG.global, false);
  const first = EXISTING_TAG.exec(page);
  assert.ok(first !== null);
  assert.equal(first.index, page.indexOf("<script"));
  assert.equal(first[0], pinnedTag("one"));
  assert.equal(first[1], "one");
  assert.equal(EXISTING_TAG.exec(page)?.[1], "one", "a second exec starts from the top again");
  const every = Array.from(page.matchAll(new RegExp(EXISTING_TAG.source, "gi")), (match) => match[1]);
  assert.deepEqual(every, ["one", "two"]);
});

test("4, 8: a closer on its own line gets the tag on the line above, at its indentation", () => {
  const placed = placeScriptLine(FORMATTED, SHORT_TAG);
  assert.equal(placed.where, "just before </body>");
  assert.equal(placed.html, "<html>\n  <body>\n    <p>x</p>\n  <script defer></script>\n  </body>\n</html>\n");
});

test("4: the last </body> counts, so a closer quoted in prose is passed over", () => {
  const page = "<html>\n  <body>\n    <code>&lt;/body&gt; and </body> in prose</code>\n  </body>\n</html>\n";
  const placed = placeScriptLine(page, SHORT_TAG);
  assert.equal(placed.where, "just before </body>");
  assert.equal(placed.html, page.replace("  </body>\n</html>", "  <script defer></script>\n  </body>\n</html>"));
});

test("4: a closer in capitals or with a space before > still counts", () => {
  assert.equal(placeScriptLine("<HTML><BODY><p>x</p></BODY></HTML>", SHORT_TAG).html, "<HTML><BODY><p>x</p><script defer></script></BODY></HTML>");
  assert.equal(placeScriptLine("<body><p>x</p></body >", SHORT_TAG).html, "<body><p>x</p><script defer></script></body >");
});

test("5: a closer inside a comment, a script or a style is not the page's end", () => {
  const commented = "<html><body><p>x</p></body></html><!-- old </body> -->";
  assert.equal(placeScriptLine(commented, SHORT_TAG).html, "<html><body><p>x</p><script defer></script></body></html><!-- old </body> -->");
  const scripted = '<html><body><p>x</p><script>var s = "</body>";</script></body></html>';
  assert.equal(
    placeScriptLine(scripted, SHORT_TAG).html,
    '<html><body><p>x</p><script>var s = "</body>";</script><script defer></script></body></html>'
  );
  const styled = "<html><body><p>x</p></body><style>p::after { content: '</body>' }</style></html>";
  assert.equal(
    placeScriptLine(styled, SHORT_TAG).html,
    "<html><body><p>x</p><script defer></script></body><style>p::after { content: '</body>' }</style></html>"
  );
});

test("5: a comment or style never closed runs to the end, so a closer inside it does not count", () => {
  const openComment = "<html><body><p>x</p></body></html>\n<!-- left open </body>\n";
  assert.equal(
    placeScriptLine(openComment, SHORT_TAG).html,
    "<html><body><p>x</p><script defer></script></body></html>\n<!-- left open </body>\n"
  );
  const openStyle = "<html><body><p>x</p></body><style>p { color: red } </body>";
  const placed = placeScriptLine(openStyle, SHORT_TAG);
  assert.equal(placed.where, "just before </body>");
  assert.equal(placed.html, "<html><body><p>x</p><script defer></script></body><style>p { color: red } </body>");
});

test("5: a commented closer on the last line does not pull the tag into the comment", () => {
  const page = "<html>\n  <body>\n    <p>x</p>\n  </body>\n</html>\n<!-- </body> -->\n";
  assert.equal(
    placeScriptLine(page, SHORT_TAG).html,
    "<html>\n  <body>\n    <p>x</p>\n  <script defer></script>\n  </body>\n</html>\n<!-- </body> -->\n"
  );
});

test("6: with no </body>, the tag goes before the last </html>", () => {
  const placed = placeScriptLine("<html>\n  <p>a fragment with a document end</p>\n</html>\n", SHORT_TAG);
  assert.equal(placed.where, "just before </html>");
  assert.equal(placed.html, "<html>\n  <p>a fragment with a document end</p>\n<script defer></script>\n</html>\n");
  const minified = placeScriptLine("<html><style>p{}</style><p>x</p></html>", SHORT_TAG);
  assert.equal(minified.where, "just before </html>");
  assert.equal(minified.html, "<html><style>p{}</style><p>x</p><script defer></script></html>");
});

test("6: a </body> that does not count leaves </html> to decide", () => {
  const placed = placeScriptLine("<html><p>x</p><!-- </body> --></html>", SHORT_TAG);
  assert.equal(placed.where, "just before </html>");
  assert.equal(placed.html, "<html><p>x</p><!-- </body> --><script defer></script></html>");
});

test("7: a fragment with neither closer gets the tag at the end, on its own line", () => {
  const ended = placeScriptLine("<p>just a fragment</p>\n", SHORT_TAG);
  assert.equal(ended.where, "at the end of the file");
  assert.equal(ended.html, "<p>just a fragment</p>\n<script defer></script>\n");
  assert.equal(placeScriptLine("<p>a</p>", SHORT_TAG).html, "<p>a</p>\n<script defer></script>\n");
  assert.equal(placeScriptLine("", SHORT_TAG).html, "<script defer></script>\n");
});

test("8: every line of a multi-line tag after the first takes the closer's indentation", () => {
  const tag = pinnedTag("rev_one");
  const placed = placeScriptLine("<html>\n\t<body>\n\t\t<p>x</p>\n\t</body>\n</html>\n", tag);
  const indented = tag.split("\n").map((line) => "\t" + line).join("\n");
  assert.equal(placed.html, `<html>\n\t<body>\n\t\t<p>x</p>\n${indented}\n\t</body>\n</html>\n`);
});

test("9: on a minified page the tag goes directly before </body> on the same line, outside the style", () => {
  const tag = fallbackTag("rev_min");
  const minified = "<!doctype html><html><head><style>p{color:red}</style></head><body><p>x</p></body></html>";
  const placed = placeScriptLine(minified, tag);
  assert.equal(placed.where, "just before </body>");
  assert.equal(placed.html, minified.replace("</body>", tag + "</body>"));
});

test("10: replace puts the new tag where the old one was, with that line's indentation", () => {
  const placed = placeScriptLine(FORMATTED, fallbackTag("rev_one"));
  const replaced = replaceScriptLine(placed.html, fallbackTag("rev_two"));
  assert.ok(replaced !== null);
  assert.equal(replaced.where, "in the place it already had");
  assert.equal(replaced.html, placeScriptLine(FORMATTED, fallbackTag("rev_two")).html);
  assert.equal(reviewAlreadyInFile(replaced.html), "rev_two");
  assert.equal(replaced.html.match(/data-lahe-review=/g)?.length, 1, "one line, not two");
  assert.deepEqual(removeScriptLine(replaced.html), { html: FORMATTED, review: "rev_two" });
});

test("10: a tag sharing its line with markup is replaced in place, indented by that line's own indentation", () => {
  const page = `  <p>x</p>${SHORT_TAG.replace("<script", '<script data-lahe-review="old"')}<p>y</p>\n`;
  const replaced = replaceScriptLine(page, "<script\ndata-lahe-review=\"new\"></script>");
  assert.ok(replaced !== null);
  assert.equal(replaced.html, '  <p>x</p><script\n  data-lahe-review="new"></script><p>y</p>\n');
});

test("10: replace finds nothing to replace on a page with no line", () => {
  assert.equal(replaceScriptLine(FORMATTED, SHORT_TAG), null);
});

test("11: remove takes out only the lahe tag, its indentation and its newline", () => {
  const page = [
    "<html>",
    "  <body>",
    '    <script src="app.js"></script>',
    '    <script defer src="lahe-layer.js" data-lahe-review="r1" data-lahe-token="t"></script>',
    "    <script>window.theirs = 1;</script>",
    "  </body>",
    "</html>",
    ""
  ].join("\n");
  const removed = removeScriptLine(page);
  assert.ok(removed !== null);
  assert.equal(removed.review, "r1");
  assert.equal(
    removed.html,
    ["<html>", "  <body>", '    <script src="app.js"></script>', "    <script>window.theirs = 1;</script>", "  </body>", "</html>", ""].join("\n")
  );
});

test("11: a tag sharing its line with markup takes only itself", () => {
  const removed = removeScriptLine(`<p>x</p>${pinnedTag("r2")}</body>`);
  assert.deepEqual(removed, { html: "<p>x</p></body>", review: "r2" });
});

test("11: remove finds nothing on a page with no line", () => {
  assert.equal(removeScriptLine("<html><body><p>no line here</p></body></html>"), null);
});

test("12: place then remove gives back the page byte for byte", () => {
  const pages = [
    FORMATTED,
    "<!doctype html><html><head><style>p{color:red}</style></head><body><p>x</p></body></html>",
    "<html>\n  <p>a fragment with a document end</p>\n</html>\n",
    "<p>just a fragment</p>\n",
    "<html><body><p>x</p></body></html>"
  ];
  for (const tag of [pinnedTag("rev_one"), fallbackTag("rev_two"), DOCUMENT_TAG]) {
    for (const page of pages) {
      assert.equal(removeScriptLine(placeScriptLine(page, tag).html)?.html, page);
    }
  }
});
