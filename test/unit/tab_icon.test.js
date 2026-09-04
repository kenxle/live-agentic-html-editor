"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tabIcon = require("../../src/service/tab_icon.js");
const markdown = require("../../src/service/markdown.js");

test("a page that declares its own icon keeps it, in every relation an author uses", () => {
  const declared = [
    "<link rel=\"icon\" href=\"/favicon.ico\">",
    "<link rel=\"shortcut icon\" href=\"/favicon.ico\">",
    "<link rel=\"apple-touch-icon\" href=\"/touch.png\">",
    "<link rel=\"mask-icon\" href=\"/mask.svg\" color=\"#000\">",
    "<link rel=icon href=/favicon.ico>",
    "<link href='/favicon.ico' rel='ICON'>"
  ];
  declared.forEach((link) => {
    const html = "<!doctype html><html><head>" + link + "</head><body>hi</body></html>";
    assert.equal(tabIcon.hasIcon(html), true, link);
    assert.equal(tabIcon.ensure(html), html, link);
  });
});

test("a link that merely mentions icons is not an icon", () => {
  const html = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/css/icons.css\"></head><body></body></html>";
  assert.equal(tabIcon.hasIcon(html), false);
  assert.ok(tabIcon.ensure(html).includes(tabIcon.LINK));
});

test("the fallback goes inside head, and never above the doctype", () => {
  const withHead = tabIcon.ensure("<!doctype html>\n<html><head><title>Draft</title></head><body>x</body></html>");
  assert.match(withHead, /<head>\s*<link rel="icon"/);

  // No head: the parser puts a link that precedes any body content into the
  // head it implies, so the tag needs no head of its own.
  const noHead = tabIcon.ensure("<!doctype html>\n<html><body>x</body></html>");
  assert.match(noHead, /<html>\s*<link rel="icon"/);

  // A fragment with neither: everything still has to sit under the doctype,
  // because markup above it is what puts the browser into quirks mode.
  const bare = tabIcon.ensure("<!DOCTYPE html>\n<p>a fragment</p>");
  assert.match(bare, /^<!DOCTYPE html>\s*<link rel="icon"/);

  // Not even a doctype: there is nothing to sit under.
  assert.match(tabIcon.ensure("<p>a fragment</p>"), /^<link rel="icon"/);
});

test("ensure is idempotent, so a page served twice grows one icon and not two", () => {
  const once = tabIcon.ensure("<!doctype html><html><head></head><body></body></html>");
  assert.equal(tabIcon.ensure(once), once);
  assert.equal(once.split("rel=\"icon\"").length - 1, 1);
});

test("a rendered Markdown document carries the same icon the module spells", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-tab-icon-"));
  const source = path.join(root, "note.md");
  fs.writeFileSync(source, "# A note\n\nBody.\n");
  const html = markdown.render(source);
  assert.ok(html.includes(tabIcon.LINK));
  assert.equal(tabIcon.ensure(html), html);
});
