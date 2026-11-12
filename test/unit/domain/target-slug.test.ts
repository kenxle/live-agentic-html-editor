/*
 * read-when: Changing src/domain/target-slug.ts, or when one of these tests fails.
 * not-for: How a review file is named and written; see test/unit/review_writer.test.js.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SLUG_MAX, targetSlug } from "../../../src/domain/target-slug.ts";

test("the slug is at most 40 characters", () => {
  assert.equal(SLUG_MAX, 40);
});

test("the slug is the readable last segment of the target, and review file names depend on these values", () => {
  assert.equal(targetSlug("/Users/x/docs/02_architecture.html"), "02-architecture-html");
  assert.equal(targetSlug("http://localhost:3000/a/b?x=1"), "b");
  assert.equal(targetSlug("/"), "target");
  assert.equal(targetSlug(""), "target");
  assert.equal(targetSlug("/\u00C9.html"), "html");
  assert.equal(targetSlug("/docs/Trailing/"), "trailing");
  assert.equal(targetSlug("?only=query"), "target");
});

test("a long segment is cut to its first 40 characters and trimmed again", () => {
  const segment = "a".repeat(60);
  assert.equal(targetSlug("/x/" + segment), "a".repeat(40));
  assert.equal(targetSlug("/x/" + "a".repeat(39) + "-" + "b".repeat(20)), "a".repeat(39));
});

test("a target that tries to climb out can never contribute a path separator or a dot segment", () => {
  for (const target of [
    "http://localhost:3000/a/../../etc/passwd",
    "/tmp/../../../etc/passwd",
    "http://localhost:3000/%2e%2e%2f%2e%2e",
    "/a/b/..%2f..%2fCLAUDE.md"
  ]) {
    const slug = targetSlug(target);
    assert.match(slug, /^[a-z0-9-]+$/, target);
    assert.ok(!slug.includes("/"), target);
    assert.notEqual(slug, ".");
    assert.notEqual(slug, "..");
    assert.ok(slug.length <= 40, target);
  }
  assert.equal(targetSlug("/a/.."), "target");
});
