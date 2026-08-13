// 3C's pure half: the scope rule, the label, the filename, and the seam 3D's
// list export calls.
//
// The behavior ranked test 34 scores is in test/browser/copy_export.spec.js,
// through the real buttons, the real clipboard and a real download. This file
// covers the parts that are arithmetic on strings, where a browser adds nothing
// and a fast test says more.
//
// What is deliberately NOT here: any assertion about the wording review_format
// produces. That module is 0A-wire's and frozen, its own unit test owns its
// bytes, and restating them here would be two sources of truth for one sentence.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const exporter = require("../../src/layer/export.js");
const failures = require("../../src/shared/failures.js");
const manifest = require("../../src/shared/manifest.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3c-export" });

const REVIEW = "rev_export";

function someRecords(n) {
  return fixtures.manyEdits(n || 3);
}

test("the full and slice renders differ by the slice label and nothing else", () => {
  const records = someRecords(3);
  const full = exporter.renderReviewText({ records: records, scope: "full", review: REVIEW });
  const slice = exporter.renderReviewText({ records: records, scope: "slice", review: REVIEW });

  assert.ok(full.length > 0, "the full render is not empty");
  assert.ok(slice.length > 0, "the slice render is not empty");
  assert.ok(slice.startsWith(exporter.SLICE_LABEL + "\n\n"), "the label leads the slice");
  assert.equal(slice.slice((exporter.SLICE_LABEL + "\n\n").length), full);
  assert.ok(full.indexOf(exporter.SLICE_LABEL) === -1, "the full render never claims to be a slice");
});

test("a missing or invented scope fails loud rather than guessing", () => {
  const records = someRecords(1);
  assert.throws(() => exporter.renderReviewText({ records: records, review: REVIEW }), /scope must be/);
  assert.throws(() => exporter.renderReviewText({ records: records, scope: "whole", review: REVIEW }), /scope must be/);
  assert.throws(() => exporter.renderReviewText({ records: records, scope: "full" }), /review id is required/);
  assert.throws(() => exporter.renderReviewText({ scope: "full", review: REVIEW }), /records must be an array/);
});

test("the filename carries the scope, so a forwarded file still says what it is", () => {
  const at = new Date(2026, 7, 12, 9, 5);
  const full = exporter.filenameFor({ review: REVIEW, scope: "full", at: at });
  const slice = exporter.filenameFor({ review: REVIEW, scope: "slice", at: at });
  assert.equal(full, "lahe-review-rev_export-20260812-0905.txt");
  assert.equal(slice, "lahe-review-rev_export-20260812-0905-this-page-slice.txt");
  assert.match(exporter.filenameFor({ review: "../../etc/passwd", scope: "full", at: at }), /^lahe-review-[A-Za-z0-9._-]+\.txt$/);
});

test("3D's list export renders through 3C's path, with the scope it names", async () => {
  const records = someRecords(2);
  const instance = exporter.createExport({ review: REVIEW, records: () => records });
  const got = await instance.exportRecords(records, { scope: "slice", download: false });
  assert.equal(got.ok, true);
  assert.equal(got.scope, "slice");
  assert.equal(got.filename, null, "download:false renders without saving a file");
  assert.equal(got.text, exporter.renderReviewText({ records: records, scope: "slice", review: REVIEW }));
  assert.deepEqual(instance.last(), got, "the last result is readable, so nothing has to be guessed at");
});

test("with no helper answering, the scope is the slice and the records are this browser's", async () => {
  const records = someRecords(2);
  const instance = exporter.createExport({
    review: REVIEW,
    records: () => records,
    fetch: () => Promise.reject(new Error("connection refused")),
    window: null
  });
  const got = await instance.scopeNow();
  assert.equal(got.scope, "slice");
  assert.equal(got.records, 2);
  assert.equal(got.probe.reachable, false);
});

test("a helper that answers for this review puts the export in full scope", async () => {
  const records = someRecords(2);
  const answers = [
    { status: 200, body: { schema: "lahe.review/2", pages: [] } },
    // The projection route before 3A builds it. The helper is up and answering,
    // which is the question this probe asks.
    { status: 501, body: { error: "not implemented" } }
  ];
  for (const answer of answers) {
    const instance = exporter.createExport({
      review: REVIEW,
      records: () => records,
      fetch: () => Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) }),
      window: null
    });
    const got = await instance.scopeNow();
    assert.equal(got.scope, "full", "status " + answer.status + " means the helper answered");
  }
});

test("a helper that refuses this page's credentials is not the whole review", async () => {
  const instance = exporter.createExport({
    review: REVIEW,
    records: () => someRecords(1),
    fetch: () => Promise.resolve({ status: 401, json: () => Promise.resolve({ error: "unauthorized" }) }),
    window: null
  });
  const got = await instance.scopeNow();
  assert.equal(got.scope, "slice", "up but refusing is not the same as reachable");
});

test("records the helper is holding are folded in, and the browser wins its own content", () => {
  const mine = someRecords(2);
  const theirs = [
    Object.assign({}, mine[0], { rev: (mine[0].rev || 1) + 1, note: "the helper's later revision" }),
    Object.assign({}, mine[1], { id: "c_only_there" })
  ];
  const union = exporter.unionById(mine, theirs);
  assert.equal(union.length, 3, "the item only the helper knows about is kept");
  assert.equal(union[0].note, "the helper's later revision", "a later revision wins");
  assert.equal(union[1], mine[1], "an item the helper has no newer version of is untouched");
});

test("a projection is not mistaken for records", () => {
  assert.equal(exporter.recordsFromBody({ pages: [{ items: [{ id: "c_1", note: "x" }] }] }), null);
  assert.equal(exporter.recordsFromBody({ items: [] }), null);
  assert.equal(exporter.recordsFromBody(null), null);
  const real = someRecords(1);
  assert.deepEqual(exporter.recordsFromBody({ records: real }), real);
});

test("a copy that did not reach the clipboard says so, and never reports success", async () => {
  const chips = [];
  const instance = exporter.createExport({
    review: REVIEW,
    records: () => someRecords(1),
    fetch: () => Promise.reject(new Error("connection refused")),
    window: null,
    clipboard: {
      writeText: () => Promise.reject(new Error("the browser refused the clipboard"))
    },
    rail: { failures: { add: (failure) => chips.push(failure) } }
  });
  const got = await instance.copyReview();
  assert.equal(got.ok, false);
  assert.equal(got.code, "COPY_FAILED");
  assert.equal(chips.length, 1, "the reviewer sees a chip rather than a control that looked like it worked");
  assert.equal(chips[0].persistent, true, "and it stays until they dismiss it");
});

test("the copy and export failure codes are in the one code list", () => {
  assert.ok(failures.CODE_NAMES.includes("COPY_FAILED"));
  assert.ok(failures.CODE_NAMES.includes("EXPORT_FAILED"));
  assert.equal(failures.describe("COPY_FAILED").surface, failures.SURFACE.FAILURES_LIST);
});

test("export.js is 3C's, and it is no longer a planned file", () => {
  assert.equal(manifest.ownerOf("src/layer/export.js"), "3C");
  assert.equal(
    manifest.plannedFiles().some((entry) => entry.path === "src/layer/export.js"),
    false
  );
});
