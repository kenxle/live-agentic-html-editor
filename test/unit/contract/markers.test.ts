/*
 * read-when: Changing src/contract/markers.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  AUTHOR_REGION_ATTR,
  EDIT_HOST_ATTR,
  FILE_TITLE_ATTR,
  FILE_TITLE_VALUE,
  OVERLAY_ROOT_ID,
  PROTECTED_ATTR,
  RENDER_NOTE_NAME,
  ROLE_CHROME,
  ROLE_WRAP,
  STAMP_ATTR,
  TOOL_ATTR,
  TURBO_PERMANENT_ATTR,
  isFileTitle,
  isInsideOverlay,
  isToolAttrName,
  isToolClassToken,
  isToolNode,
  markChrome,
  roleOf
} from "../../../src/contract/markers.ts";
import type { MarkedNode } from "../../../src/contract/markers.ts";

interface FakeOptions {
  readonly attrs?: Readonly<Record<string, string>>;
  readonly id?: string;
  readonly parent?: MarkedNode | null;
}

function element(options: FakeOptions = {}): MarkedNode {
  const attrs = options.attrs ?? {};
  return {
    nodeType: 1,
    id: options.id ?? "",
    parentNode: options.parent ?? null,
    getAttribute: (name: string): string | null => attrs[name] ?? null
  };
}

function textIn(parent: MarkedNode | null): MarkedNode {
  return { nodeType: 3, parentNode: parent };
}

const chromeAttrs = { [TOOL_ATTR]: ROLE_CHROME };

test("the names are exact, because they reach pages, records and the skill", () => {
  assert.equal(TOOL_ATTR, "data-lahe");
  assert.equal(ROLE_CHROME, "chrome");
  assert.equal(ROLE_WRAP, "wrap");
  assert.equal(OVERLAY_ROOT_ID, "lahe-surface-root");
  assert.equal(PROTECTED_ATTR, "data-lahe-protected");
  assert.equal(TURBO_PERMANENT_ATTR, "data-turbo-permanent");
  assert.equal(AUTHOR_REGION_ATTR, "data-review-region");
  assert.equal(STAMP_ATTR, "data-lahe-id");
  assert.equal(FILE_TITLE_ATTR, "data-lahe-file-title");
  assert.equal(FILE_TITLE_VALUE, "file-name");
  assert.equal(RENDER_NOTE_NAME, "lahe-render-note");
  assert.equal(EDIT_HOST_ATTR, "data-lahe-edit-host");
});

test("what the tool writes is stripped, and what an author writes is not", () => {
  for (const name of [TOOL_ATTR, STAMP_ATTR, PROTECTED_ATTR, FILE_TITLE_ATTR, EDIT_HOST_ATTR]) {
    assert.equal(isToolAttrName(name), true, name);
  }
  assert.equal(isToolAttrName(AUTHOR_REGION_ATTR), false);
  assert.equal(isToolAttrName(TURBO_PERMANENT_ATTR), false);
});

test("an attribute name is the tool's when it starts with data-lahe, whatever its case", () => {
  assert.equal(isToolAttrName("data-lahe-id"), true);
  assert.equal(isToolAttrName("DATA-LAHE-ID"), true);
  assert.equal(isToolAttrName("data-review-region"), false);
  assert.equal(isToolAttrName("data-lah"), false);
  assert.equal(isToolAttrName(""), false);
});

test("a class token is the tool's when it starts with lahe-, and case matters", () => {
  assert.equal(isToolClassToken("lahe-chip"), true);
  assert.equal(isToolClassToken("Lahe-chip"), false);
  assert.equal(isToolClassToken("lahe"), false);
  assert.equal(isToolClassToken("x-lahe-chip"), false);
});

test("a node's role is the exact value of its data-lahe attribute", () => {
  assert.equal(roleOf(element({ attrs: { [TOOL_ATTR]: "chrome" } })), "chrome");
  assert.equal(roleOf(element({ attrs: { [TOOL_ATTR]: "wrap" } })), "wrap");
  assert.equal(roleOf(element({ attrs: { [TOOL_ATTR]: "Chrome" } })), null);
  assert.equal(roleOf(element({ attrs: { [TOOL_ATTR]: "" } })), null);
  assert.equal(roleOf(element()), null);
});

test("a text node and null have no role", () => {
  assert.equal(roleOf(textIn(null)), null);
  assert.equal(roleOf(null), null);
});

test("a tool node is exactly a node with a role", () => {
  assert.equal(isToolNode(element({ attrs: chromeAttrs })), true);
  assert.equal(isToolNode(element({ attrs: { [TOOL_ATTR]: ROLE_WRAP } })), true);
  assert.equal(isToolNode(element({ attrs: { [TOOL_ATTR]: "other" } })), false);
  assert.equal(isToolNode(element()), false);
  assert.equal(isToolNode(textIn(null)), false);
  assert.equal(isToolNode(null), false);
});

test("a node is inside the overlay when it, or an ancestor element, is the root or a tool node", () => {
  const root = element({ id: OVERLAY_ROOT_ID });
  const inside = element({ parent: element({ parent: root }) });
  assert.equal(isInsideOverlay(root), true);
  assert.equal(isInsideOverlay(inside), true);

  const furniture = element({ attrs: chromeAttrs });
  assert.equal(isInsideOverlay(element({ parent: furniture })), true);
  assert.equal(isInsideOverlay(furniture), true);
});

test("a node on the page itself is not inside the overlay, and neither is null", () => {
  const page = element({ id: "main", parent: element({ id: "wrapper" }) });
  assert.equal(isInsideOverlay(page), false);
  assert.equal(isInsideOverlay(element()), false);
  assert.equal(isInsideOverlay(null), false);
});

test("the walk stops at a node that is not an element, so a text node answers false even inside the overlay", () => {
  const root = element({ id: OVERLAY_ROOT_ID });
  assert.equal(isInsideOverlay(textIn(root)), false);
  const behindText = element({ parent: textIn(root) });
  assert.equal(isInsideOverlay(behindText), false);
});

test("marking chrome sets data-lahe to chrome and returns the same element", () => {
  const written: Array<readonly [string, string]> = [];
  const el = {
    setAttribute(name: string, value: string): void {
      written.push([name, value]);
    }
  };
  assert.equal(markChrome(el), el);
  assert.deepEqual(written, [["data-lahe", "chrome"]]);
});

test("a marked node reads back as chrome, and so as a tool node inside the overlay", () => {
  const attrs: Record<string, string> = {};
  const el: MarkedNode & { setAttribute(name: string, value: string): void } = {
    nodeType: 1,
    id: "",
    parentNode: null,
    getAttribute: (name: string): string | null => attrs[name] ?? null,
    setAttribute(name: string, value: string): void {
      attrs[name] = value;
    }
  };
  assert.equal(roleOf(el), null);
  markChrome(el);
  assert.equal(roleOf(el), "chrome");
  assert.equal(isToolNode(el), true);
  assert.equal(isInsideOverlay(el), true);
});

test("the file-name title is recognized by its marker and value together", () => {
  assert.equal(isFileTitle(element({ attrs: { [FILE_TITLE_ATTR]: FILE_TITLE_VALUE } })), true);
  assert.equal(isFileTitle(element({ attrs: { [FILE_TITLE_ATTR]: "other" } })), false);
  assert.equal(isFileTitle(element()), false);
  assert.equal(isFileTitle(textIn(null)), false);
  assert.equal(isFileTitle(null), false);
});

test("the old path loads the same functions, in an ordinary object old code can write to", () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../src/shared/markers.js");
  assert.ok(typeof old === "object" && old !== null && "roleOf" in old);
  assert.equal(old.roleOf, roleOf);
  assert.equal(Reflect.get(old, "OVERLAY_ROOT_ID"), OVERLAY_ROOT_ID);
  const replacement = (): null => null;
  Reflect.set(old, "roleOf", replacement);
  assert.equal(Reflect.get(old, "roleOf"), replacement);
  Reflect.set(old, "roleOf", roleOf);
});
