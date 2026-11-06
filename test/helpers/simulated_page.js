// read-when: A unit test needs a large or randomly shaped page over the
// simulated DOM, or the best-guess speed test's page needs to change.
// not-for: real browser pages; see test/helpers/index.js.
//
// The simulated DOM the anchor tests use answers five questions (tag, text, an
// attribute, element children, parent) plus the three a text walk needs
// (nodeType, firstChild, nextSibling). This copy keeps each node's index in its
// parent, so nextSibling is constant time and a 4,000-element page measures the
// engine rather than the stand-in.
//
// Pages are built from a plain description, {tag, attrs, text, children}, so
// the same description can be turned into HTML for a browser spec.

"use strict";

function el(tag, opts) {
  const options = opts || {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.assign({}, options.attrs || {}),
    children: [],
    parentElement: null,
    ownText: typeof options.text === "string" ? options.text : "",
    indexInParent: -1,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    }
  };
  Object.defineProperty(node, "textContent", {
    get: function () {
      if (!this.children.length) return this.ownText;
      let out = "";
      for (let i = 0; i < this.children.length; i += 1) out += this.children[i].textContent;
      return out;
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
      return parent.children[this.indexInParent + 1] || null;
    }
  });
  (options.children || []).forEach((child) => append(node, child));
  return node;
}

function append(parent, child) {
  child.parentElement = parent;
  child.indexInParent = parent.children.length;
  parent.children.push(child);
  return child;
}

function setText(node, text) {
  node.ownText = text;
}

/** A description {tag, attrs, text, children} as simulated nodes. */
function build(spec) {
  return el(spec.tag, {
    attrs: spec.attrs,
    text: spec.text,
    children: (spec.children || []).map(build)
  });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A description as HTML. */
function toHtml(spec) {
  const attrs = Object.keys(spec.attrs || {})
    .map((name) => " " + name + '="' + escapeHtml(spec.attrs[name]) + '"')
    .join("");
  const inner = spec.children && spec.children.length ? spec.children.map(toHtml).join("") : escapeHtml(spec.text || "");
  return "<" + spec.tag + attrs + ">" + inner + "</" + spec.tag + ">";
}

function countAndDepth(node, depth) {
  let count = 1;
  let deepest = depth;
  for (let i = 0; i < node.children.length; i += 1) {
    const below = countAndDepth(node.children[i], depth + 1);
    count += below.count;
    if (below.depth > deepest) deepest = below.depth;
  }
  return { count: count, depth: deepest };
}

// A word list, so every passage reads differently and text alone can tell
// passages apart, as it can on a real page.
const WORDS = [
  "agent", "header", "doc", "tree", "link", "board", "skill", "review", "page", "token",
  "depth", "route", "branch", "lesson", "charter", "report", "card", "rule", "test", "scope"
];

function words(seed, count) {
  const out = [];
  let n = seed;
  for (let i = 0; i < count; i += 1) {
    n = (n * 1103515245 + 12345) % 2147483648;
    out.push(WORDS[n % WORDS.length]);
  }
  return out.join(" ") + " " + seed + ".";
}

/**
 * The shape of Seneschal's knowledge tree page: a hero, a few sections with a
 * heading each, and in every section a stack of nested <details> whose
 * summaries hold spans and whose bodies hold a paragraph and the next level.
 * Few headings, many spans, deep nesting.
 *
 * @returns {{spec, body, target, count, depth}} `target` is a paragraph deep
 *   inside the third section, the one the speed test comments on.
 */
function knowledgeTreeSpec() {
  let serial = 0;
  function level(depth, maxDepth) {
    serial += 1;
    const id = serial;
    const summary = {
      tag: "summary",
      attrs: { class: "node-summary" },
      children: [
        { tag: "span", attrs: { class: "name" }, text: "doc-" + id + ".md" },
        { tag: "b", attrs: { class: "depth" }, text: "level " + depth },
        { tag: "span", attrs: { class: "n" }, text: String(id % 7) }
      ]
    };
    const bodyKids = [{ tag: "p", attrs: { class: "read-when" }, text: words(id, 9) }];
    if (depth < maxDepth) bodyKids.push(level(depth + 1, maxDepth));
    return {
      tag: "details",
      attrs: { class: "node node-d" + depth, "data-id": "n" + id },
      children: [summary, { tag: "div", attrs: { class: "kids" }, children: bodyKids }]
    };
  }
  const sections = [];
  for (let s = 0; s < 4; s += 1) {
    const stacks = [];
    for (let k = 0; k < 13; k += 1) stacks.push(level(1, 11));
    sections.push({
      tag: "section",
      attrs: { class: "sheet", id: "sheet-" + s },
      children: [
        { tag: "div", attrs: { class: "sheet-head" }, children: [
          { tag: "h2", text: "Sheet " + s + ": the knowledge tree" },
          { tag: "span", attrs: { class: "n" }, text: "Feature" }
        ] },
        { tag: "p", text: words(1000 + s, 20) },
        { tag: "div", attrs: { class: "tree" }, children: stacks }
      ]
    });
  }
  return {
    tag: "body",
    children: [
      { tag: "div", attrs: { class: "hero" }, children: [
        { tag: "h1", text: "steady-thread: knowledge tree" },
        { tag: "p", attrs: { class: "lede" }, text: words(9999, 18) }
      ] },
      { tag: "main", children: sections }
    ]
  };
}

function knowledgeTree() {
  const spec = knowledgeTreeSpec();
  const body = build(spec);
  const shape = countAndDepth(body, 0);
  // Third section, sixth stack, seven levels down: the paragraph of that level.
  let node = body.children[1].children[2].children[2].children[5];
  for (let i = 1; i < 7; i += 1) node = node.children[1].children[1];
  const target = node.children[1].children[0];
  return { spec: spec, body: body, target: target, count: shape.count, depth: shape.depth };
}

module.exports = {
  el: el,
  append: append,
  build: build,
  toHtml: toHtml,
  setText: setText,
  countAndDepth: countAndDepth,
  knowledgeTreeSpec: knowledgeTreeSpec,
  knowledgeTree: knowledgeTree
};
