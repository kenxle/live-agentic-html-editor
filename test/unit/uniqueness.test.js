// The uniqueness predicate, judged against the fixture corpus Task 1C is also
// judged against.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const u = require("../../src/shared/uniqueness.js");
const corpus = require("../fixtures/uniqueness_corpus.js");

test("the fixture corpus: every case lands where architecture D3 Law 1 says", () => {
  for (const c of corpus.CASES) {
    const got = u.resolveInBlocks(c.blocks, corpus.REFERENCE);
    assert.equal(got.bound, c.expect.bound, `${c.name}: expected bound=${c.expect.bound}, got ${got.bound} (${got.reason})`);
    assert.equal(got.reason, c.expect.reason, `${c.name}: expected reason=${c.expect.reason}, got ${got.reason}`);
  }
});

test("a non-binding verdict carries the failure code the card will show", () => {
  const deleted = corpus.CASES.find((c) => c.name === "region_deleted");
  const got = u.resolveInBlocks(deleted.blocks, corpus.REFERENCE);
  assert.equal(got.bound, false);
  assert.equal(got.failureCode, "ANCHOR_NO_TEXT_MATCH");

  const dup = corpus.CASES.find((c) => c.name === "same_paragraph_duplicated");
  const got2 = u.resolveInBlocks(dup.blocks, corpus.REFERENCE);
  assert.equal(got2.failureCode, "ANCHOR_AMBIGUOUS");
});

test("a candidate found only by structure can never place a write", () => {
  const verdict = u.selectUnique(
    [{ key: "a", match: u.MATCH.STRUCTURE, prefix: null, suffix: null, structure: true, heading: true }],
    {}
  );
  assert.equal(verdict.bound, false);
  assert.equal(verdict.reason, u.REASON.STRUCTURE_ONLY);
  assert.equal(verdict.failureCode, "ANCHOR_STRUCTURE_ONLY");
});

test("structure and heading corroborate and never change the verdict", () => {
  // Two eligible candidates with identical context. One of them is also the
  // structural match and sits under the record's heading. A scalar score would
  // pick it. The predicate refuses.
  const candidates = [
    { key: "a", match: u.MATCH.EXACT, prefix: "P", suffix: "S", structure: true, heading: true },
    { key: "b", match: u.MATCH.EXACT, prefix: "P", suffix: "S", structure: false, heading: false }
  ];
  const verdict = u.selectUnique(candidates, { prefix: "P", suffix: "S" });
  assert.equal(verdict.bound, false, "the high-confidence ambiguous case is the dangerous one");
  assert.equal(verdict.reason, u.REASON.AMBIGUOUS);
});

test("a single candidate binds even when its context has changed entirely", () => {
  // A sibling was inserted above. The stored prefix is wrong and the structural
  // path is wrong. The text is still unique, so it binds. This is the case a
  // path-first ladder gets wrong.
  const verdict = u.selectUnique(
    [{ key: "only", match: u.MATCH.EXACT, prefix: "something else entirely", suffix: null, structure: false, heading: false }],
    { prefix: "the old neighbour", suffix: "the old suffix" }
  );
  assert.equal(verdict.bound, true);
  assert.equal(verdict.reason, u.REASON.UNIQUE);
  assert.equal(verdict.key, "only");
});

test("zero survivors and two survivors are the same verdict: fail closed", () => {
  const twoRivals = [
    { key: "a", match: u.MATCH.EXACT, prefix: "X", suffix: "Y", structure: false, heading: false },
    { key: "b", match: u.MATCH.EXACT, prefix: "X", suffix: "Y", structure: false, heading: false }
  ];
  const noneSurvive = u.selectUnique(twoRivals, { prefix: "totally different", suffix: "also different" });
  const bothSurvive = u.selectUnique(twoRivals, { prefix: "X", suffix: "Y" });
  assert.equal(noneSurvive.bound, false);
  assert.equal(bothSurvive.bound, false);
  assert.equal(noneSurvive.reason, bothSurvive.reason);
});

test("context matching is whitespace tolerant, because rewrapping is not a move", () => {
  assert.equal(u.contextMatches("the previous block", "  the previous\n  block  "), true);
});

test("an empty stored context can never be what eliminates a rival", () => {
  // A region that was first on the page has no prefix. If an empty context
  // failed to match, that region could never be re-found among rivals.
  assert.equal(u.contextMatches("", "anything"), true);
  assert.equal(u.contextMatches(null, null), true);
  // And a stored context with nothing found is a genuine mismatch.
  assert.equal(u.contextMatches("something", ""), false);
});

test("the predicate exposes no tunable number", () => {
  const source = u.selectUnique.toString();
  assert.equal(/threshold|confidence|score|0\.\d/.test(source), false, "no scalar may creep back in");
});
