/*
 * read-when: Changing src/domain/subject.ts, or a comment on a whole element is weighed against the wrong text, or an agent gets an image tag without its source, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBJECT_SRC_REF, emptyContext } from "../../../src/contract/record.ts";
import { paintQuoteOf, subjectHtmlOf } from "../../../src/domain/subject.ts";
import { callUntyped } from "../contract/support/untyped.ts";

test("a comment on a passage is weighed against its quote", () => {
  assert.equal(paintQuoteOf({ context: { ...emptyContext(), quote: "the words" } }), "the words");
  assert.equal(paintQuoteOf({ context: { ...emptyContext(), quote: "" } }), "", "an empty quote is still a string");
});

test("a comment on a whole element has no quote to weigh, whatever it saved as one", () => {
  const subject = { tag: "img", src: "x.png", alt: null, html: '<img src="x.png">', near: null };
  assert.equal(paintQuoteOf({ context: { ...emptyContext(), quote: "the whole element's text", subject } }), null);
});

test("a record with no context, no quote or a quote that is not text has none", () => {
  assert.equal(paintQuoteOf({ context: emptyContext() }), null);
  assert.equal(paintQuoteOf(null), null);
  assert.equal(paintQuoteOf(undefined), null);
  assert.equal(callUntyped(paintQuoteOf, { context: null }), null);
  assert.equal(callUntyped(paintQuoteOf, { context: { quote: 5, subject: null } }), null);
});

test("an embedded source is put back in the opening tag an agent reads", () => {
  const html = '<img src="' + SUBJECT_SRC_REF + '" alt="a">';
  assert.equal(subjectHtmlOf({ html, src: "data:image/png;base64,AAA" }), '<img src="data:image/png;base64,AAA" alt="a">');
});

test("the source is escaped as an attribute value", () => {
  const html = '<img src="' + SUBJECT_SRC_REF + '">';
  assert.equal(subjectHtmlOf({ html, src: 'a"b&c<d' }), '<img src="a&quot;b&amp;c&lt;d">');
});

test("every pointer is replaced, and the source's own dollar signs are not read as patterns", () => {
  const html = '<picture><source src="' + SUBJECT_SRC_REF + '"><img src="' + SUBJECT_SRC_REF + '"></picture>';
  assert.equal(subjectHtmlOf({ html, src: "a$&b$1" }), '<picture><source src="a$&amp;b$1"><img src="a$&amp;b$1"></picture>');
});

test("markup with no pointer, or a source that is not a string, comes back as it is", () => {
  assert.equal(subjectHtmlOf({ html: '<img src="x.png">', src: "y.png" }), '<img src="x.png">');
  const pointer = '<img src="' + SUBJECT_SRC_REF + '">';
  assert.equal(subjectHtmlOf({ html: pointer, src: null }), pointer);
  assert.equal(subjectHtmlOf({ html: pointer }), pointer);
});

test("no subject, or markup that is not text, is null", () => {
  assert.equal(subjectHtmlOf(null), null);
  assert.equal(subjectHtmlOf(undefined), null);
  assert.equal(subjectHtmlOf({ html: null }), null);
  assert.equal(subjectHtmlOf({}), null);
  assert.equal(callUntyped(subjectHtmlOf, { html: 5 }), null);
});
