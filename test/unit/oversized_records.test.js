// Three records that stored far more than they identify.
//
// docs/features/20260928.03_oversized_records/NOTES.md has the story of each,
// with the measurements from the records on Ken's machine. The rule behind all
// three (Ken): never truncate what the reviewer wrote, and a record stores what
// identifies a thing, once.
//
//   1. The text after the spot ran to the end of the page. A region the words
//      could not re-find kept the context of the LAST, widest ring mint tried:
//      the next two top-level sections of the document, 64 KB on one Mermaid
//      comment.
//   2. An embedded image (a data: URL) was stored three times: in the
//      signature, in subject.src, and inside subject.html. 516 KB for one
//      comment.
//   3. A comment whose region was the whole page. A selection that ends at the
//      very start of the next block (what a triple-click makes) climbed to the
//      container of both blocks, which on a flat page is <main> or <body>. Its
//      stamp then went on the whole page, and any change anywhere on the page
//      read as "your passage was reworded, here it is", painting everything.
//
// The simulated DOM is the one anchor_engine.test.js uses: the five questions
// the engine asks a node, and nothing else. The browser half is
// test/browser/oversized_records.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const record = require("../../src/shared/record.js");
const rf = require("../../src/shared/review_format.js");

function el(tag, opts) {
  const options = opts || {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: options.attrs || {},
    children: [],
    parentElement: null,
    ownText: typeof options.text === "string" ? options.text : "",
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }
  };
  Object.defineProperty(node, "textContent", {
    get: function () {
      if (!this.children.length) return this.ownText;
      return this.children
        .map(function (c) {
          return c.textContent;
        })
        .join("");
    }
  });
  // The live attribute list, in the order written, as a real element has it.
  // openingTagOf reads this when it is there.
  Object.defineProperty(node, "attributes", {
    get: function () {
      const attrs = this.attrs;
      return Object.keys(attrs).map(function (name) {
        return { name: name, value: attrs[name] };
      });
    }
  });
  Object.defineProperty(node, "nodeType", { value: 1 });
  Object.defineProperty(node, "firstChild", {
    get: function () {
      if (this.children.length) return this.children[0];
      return this.ownText ? { nodeType: 3, data: this.ownText, nextSibling: null } : null;
    }
  });
  Object.defineProperty(node, "nextSibling", {
    get: function () {
      const parent = this.parentElement;
      if (!parent) return null;
      const at = parent.children.indexOf(this);
      return at === -1 ? null : parent.children[at + 1] || null;
    }
  });
  (options.children || []).forEach(function (child) {
    append(node, child);
  });
  return node;
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

// Long enough that "ran to the end of the page" is unmistakable, and made of
// words nothing else on the page uses.
function appendixText(n) {
  const words = [];
  for (let i = 0; i < 400; i += 1) words.push("appendix" + n + "word" + i);
  return "Appendix " + n + ": State of the Art " + words.join(" ");
}

/**
 * A report laid out the way the Mermaid page was: top-level sections, the
 * first holding prose and a diagram, then long appendices.
 */
function reportPage() {
  const root = el("body");
  const main = append(root, el("section"));
  const intro = append(main, el("p", { text: "The paragraph before the diagram." }));
  const pre = append(main, el("pre", { attrs: { class: "mermaid" } }));
  const svg = append(pre, el("svg", { attrs: { "aria-label": "Draft flow" } }));
  const g = append(svg, el("g"));
  const label = append(g, el("span", { text: "Draft generated" }));
  const after = append(main, el("p", { text: "The paragraph after the diagram." }));
  append(root, el("section", { children: [el("p", { text: appendixText(1) })] }));
  append(root, el("section", { children: [el("p", { text: appendixText(2) })] }));
  return { root: root, intro: intro, pre: pre, svg: svg, label: label, after: after };
}

// ---------------------------------------------------------------------------
// 1. The text after a spot is the nearest neighbourhood, never the page
// ---------------------------------------------------------------------------

test("1: a unique text region stores one whole sibling each side of its own ring", () => {
  // What a text selection stores today, and the bar the other cases must match.
  const page = reportPage();
  const ref = anchor.mint({ element: page.intro, root: page.root });
  assert.equal(ref.text_unique, true);
  assert.equal(ref.context_level, 0);
  assert.equal(ref.prefix, "");
  assert.equal(ref.suffix, "", "the diagram holds no prose, so the nearest sibling adds no words");
});

test("1: a region the words cannot find keeps its nearest neighbours, not the rest of the page", () => {
  // The recorded case: a label inside an inline diagram. The text walk never
  // enters an <svg>, so its words are nowhere, mint widens through every ring
  // to the top of the document, and it used to keep the top ring's context.
  const page = reportPage();
  const ref = anchor.mint({ element: page.label, root: page.root });

  assert.equal(ref.ok, true, "the click is still captured");
  assert.equal(ref.text_unique, false, "and it says its words will not find it");
  assert.equal(ref.suffix.indexOf("Appendix"), -1, "no appendix in the text after: " + ref.suffix.slice(0, 80));
  assert.equal(ref.prefix.indexOf("Appendix"), -1);
  assert.equal(ref.context_level, 0, "the ring the context was read from is the nearest one");
  assert.equal(ref.prefix, "The paragraph before the diagram.");
  assert.equal(ref.suffix, "The paragraph after the diagram.");
});

test("1: a region that is not unique anywhere stores the same bounded neighbourhood", () => {
  const root = el("body");
  const section = append(root, el("section"));
  const list = append(section, el("ul"));
  const items = [1, 2, 3].map(function () {
    return append(list, el("li", { text: "Approve / Deny / Discuss" }));
  });
  append(root, el("section", { children: [el("p", { text: appendixText(1) })] }));
  append(root, el("section", { children: [el("p", { text: appendixText(2) })] }));

  const ref = anchor.mint({ element: items[0], root: root });
  assert.equal(ref.text_unique, false);
  assert.equal(ref.context_level, 0);
  assert.equal(ref.suffix, "Approve / Deny / Discuss", "one whole sibling after, from its own ring");
  assert.equal(ref.suffix.indexOf("Appendix"), -1);

  // D9 is untouched: three identical items, no write.
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.element, null);
  assert.equal(verdict.failureCode, "ANCHOR_AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// 2. An embedded image is stored once
// ---------------------------------------------------------------------------

function dataUrl(fill, tail) {
  return "data:image/png;base64," + fill.repeat(20000) + tail;
}

function occurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

function imagePage(srcs) {
  const root = el("body");
  append(root, el("p", { text: "Above the figures." }));
  const images = srcs.map(function (src, i) {
    const figure = append(root, el("figure"));
    const image = append(figure, el("img", { attrs: { src: src, alt: "Chart " + (i + 1) } }));
    append(figure, el("figcaption", { text: "Figure " + (i + 1) }));
    return image;
  });
  return { root: root, images: images };
}

/** The region and context a comment on an element stores, as comments.js builds them. */
function storedFor(image, root) {
  const ref = anchor.mint({ element: image, root: root });
  const context = record.emptyContext();
  context.element = "IMG";
  context.subject = anchor.subjectFor(image, root);
  return { region: { ref: ref }, context: context };
}

test("2: an embedded image's source is stored once in the record, and in full", () => {
  const src = dataUrl("iVBORw0KGgo", "ENDOFIMAGE");
  const page = imagePage([src]);
  const stored = storedFor(page.images[0], page.root);
  const json = JSON.stringify(stored);

  assert.equal(occurrences(json, "ENDOFIMAGE"), 1, "the picture is in the record exactly once");
  assert.equal(stored.context.subject.src, src, "whole, as the author wrote it: nothing cut short");
  assert.ok(json.length < src.length + 2000, "and nothing else in the record is the size of the picture: " + json.length);
});

test("2: the image is still found again by what it is", () => {
  const page = imagePage([dataUrl("iVBORw0KGgo", "FIRST"), dataUrl("iVBORw0KGgo", "SECOND")]);
  const first = storedFor(page.images[0], page.root).region.ref;
  const second = storedFor(page.images[1], page.root).region.ref;
  assert.equal(first.probe_kind, anchor.PROBE.ELEMENT);
  assert.notEqual(first.probe, second.probe, "two pictures that differ only at the end are two signatures");
  assert.equal(anchor.resolve(first, page.root).element, page.images[0]);
  assert.equal(anchor.resolve(second, page.root).element, page.images[1]);
});

test("2: two images with the same embedded source are ambiguous, exactly as before", () => {
  const same = dataUrl("iVBORw0KGgo", "SAME");
  const root = el("body");
  const a = append(root, el("img", { attrs: { src: same, alt: "" } }));
  append(root, el("img", { attrs: { src: same, alt: "" } }));
  const ref = anchor.mint({ element: a, root: root });
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.element, null, "D9: two candidates, no write");
});

test("2: a reference already on disk, with the whole source in its signature, still resolves", () => {
  const src = dataUrl("iVBORw0KGgo", "LEGACY");
  const page = imagePage([src, dataUrl("iVBORw0KGgo", "OTHER")]);
  const legacy = anchor.emptyRef();
  legacy.probe = "img|src=" + src + "|alt=Chart 1|srcset=";
  legacy.probe_kind = anchor.PROBE.ELEMENT;
  legacy.prefix = "Above the figures.";
  legacy.suffix = "";
  const verdict = anchor.resolve(legacy, page.root);
  assert.equal(verdict.bound, true, "old records must still load and replay: " + verdict.reason);
  assert.equal(verdict.element, page.images[0]);
});

test("2: review.json still hands the agent the opening tag with the real source in it", () => {
  const src = "data:image/png;base64,AAAA" + "B".repeat(100);
  const page = imagePage([src]);
  const stored = storedFor(page.images[0], page.root);
  const expected = '<img src="' + src + '" alt="Chart 1">';

  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "This one.",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/report.html"
  });
  item[record.FIELD.REGION] = Object.assign(record.emptyRegion(), stored.region);
  item[record.FIELD.CONTEXT] = stored.context;
  const projected = rf.projectItem(item, null);
  assert.equal(projected.subject.html, expected, "the agent reads the same tag it always did");
  assert.equal(projected.subject.src, src);

  // A record written before this change carries the full tag; it projects the same.
  const old = JSON.parse(JSON.stringify(item));
  old[record.FIELD.CONTEXT].subject.html = expected;
  assert.equal(rf.projectItem(old, null).subject.html, expected);
});

test("2: a media element's opening tag carries its <source> children", () => {
  const root = el("body");
  const video = append(root, el("video", { attrs: { controls: "", poster: "p.jpg" } }));
  append(video, el("source", { attrs: { src: "clip.webm", type: "video/webm" } }));
  append(video, el("source", { attrs: { src: "clip.mp4", type: "video/mp4" } }));
  const subject = anchor.subjectFor(video, root);
  assert.equal(
    subject.html,
    '<video controls="" poster="p.jpg"><source src="clip.webm" type="video/webm"><source src="clip.mp4" type="video/mp4">'
  );
});

// 3. A region that is the whole page: no unit test here. Whether a selection
// is anchored on its first block or on the page is a real-Range question, so
// test/browser/oversized_records.spec.js and whole_page_selection.spec.js own
// it. The page-sized rule these tests covered (anchor.isPageSized) is gone: a
// reviewer who selects the whole page commented on the whole page.

test("2: alt text that happens to contain =data: does not make a new signature read as old", () => {
  const src = dataUrl("iVBORw0KGgo", "ALTCASE");
  const root = el("body");
  append(root, el("p", { text: "Above." }));
  const image = append(root, el("img", { attrs: { src: src, alt: "a|x=data:y" } }));
  const ref = anchor.mint({ element: image, root: root });
  const verdict = anchor.resolve(ref, root);
  assert.equal(verdict.element, image, "found by its new signature: " + verdict.reason);
});
