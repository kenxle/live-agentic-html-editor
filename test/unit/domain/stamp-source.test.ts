/*
 * read-when: Changing src/domain/stamp-source.ts, which sources the page check expects a data-lahe-id on, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { STAMP_SOURCE_EXTENSIONS, pageCanCarryStamp, sourceCanCarryStamp } from "../../../src/domain/stamp-source.ts";
import { callUntyped } from "../contract/support/untyped.ts";

test("the source extensions that can hold an attribute are exactly these, in this order", () => {
  assert.deepEqual(STAMP_SOURCE_EXTENSIONS, [
    "html",
    "htm",
    "xhtml",
    "svg",
    "vue",
    "svelte",
    "astro",
    "jsx",
    "tsx",
    "erb",
    "ejs",
    "njk",
    "hbs",
    "liquid",
    "php",
    "mustache",
    "twig",
    "jinja",
    "j2"
  ]);
});

test("a path can carry a stamp when its extension, lowercased, is in the list", () => {
  assert.equal(sourceCanCarryStamp("page.HTML"), true);
  assert.equal(sourceCanCarryStamp("/a/b.erb?x#y"), true);
  assert.equal(sourceCanCarryStamp("app/views/clients/index.html.erb"), true);
  for (const extension of STAMP_SOURCE_EXTENSIONS) assert.equal(sourceCanCarryStamp("a." + extension), true, extension);
});

test("a Markdown file, a bare name, a dotfile, a trailing dot, a directory and a missing path cannot", () => {
  for (const path of ["notes.md", "README", ".html", "a.", "dir.html/", "", null, undefined]) {
    assert.equal(sourceCanCarryStamp(path), false, String(path));
  }
  assert.equal(sourceCanCarryStamp("a.html.md"), false, "the last extension decides");
  assert.equal(sourceCanCarryStamp("x?file=a.html"), false, "a query does not lend its extension");
});

test("a page asks its known source first, and its own path when it knows none", () => {
  assert.equal(pageCanCarryStamp({ path: "/notes.md", source_hint: "app/views/notes.html.erb" }), true);
  assert.equal(pageCanCarryStamp({ path: "/page.html", source_hint: "notes.md" }), false);
  assert.equal(pageCanCarryStamp({ path: "/notes.md", source_hint: { path: "app/page.vue", known: true } }), true);
  assert.equal(pageCanCarryStamp({ path: "/page.html", source_hint: { path: "notes.md" } }), false);
  assert.equal(pageCanCarryStamp({ path: "/page.html", source_hint: null }), true);
  assert.equal(pageCanCarryStamp({ path: "/page.html", source_hint: "" }), true, "an empty hint is no hint");
  assert.equal(pageCanCarryStamp({ path: "/page.html", source_hint: { known: false } }), true);
  assert.equal(pageCanCarryStamp({ path: "/notes.md" }), false);
});

test("a page that is missing or not an object cannot carry a stamp", () => {
  assert.equal(pageCanCarryStamp(null), false);
  assert.equal(pageCanCarryStamp(undefined), false);
  assert.equal(callUntyped(pageCanCarryStamp, "page.html"), false);
  assert.equal(callUntyped(pageCanCarryStamp, 7), false);
});
