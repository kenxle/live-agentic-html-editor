// A Markdown document carries its style in one frontmatter line,
// `lahe-style: <id>`, which the renderer turns into one stylesheet link after
// the house style, and a written artifact gets the style's files beside it.
//
// Plan rows V6 (R8, Markdown carries the style), V7 (a rebuild picks it up)
// and V25 (two style lines, service half), in
// docs/features/20260930.01_style_switcher/03_plan_style_switcher.md.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const markdown = require("../../src/service/markdown.js");
const styles = require("../../src/service/styles.js");
const rebuild = require("../../src/service/rebuild.js");
const stateDirModule = require("../../src/service/state_dir.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");
const SESSION = "s_markdown_style";
const LINK = "<link rel=\"stylesheet\" href=\"./.lahe-styles/sample/style.css\">";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function stateWithSample() {
  const state = path.join(tempDir("lahe-md-style-state-"), "state");
  const copy = path.join(tempDir("lahe-md-style-src-"), "sample");
  fs.cpSync(path.join(FIXTURES, "sample"), copy, { recursive: true });
  assert.equal(styles.install(state, copy).ok, true);
  return state;
}

function source(text, name) {
  const file = path.join(tempDir("lahe-md-style-doc-"), name || "doc.md");
  fs.writeFileSync(file, text);
  return file;
}

function headOf(html) {
  return html.slice(0, html.indexOf("</head>"));
}

function besideArtifact(target) {
  return path.join(path.dirname(target), ".lahe-styles");
}

test("the inlined house style is marked, so the layer finds it on both kinds of page", () => {
  const html = markdown.render(source("# Doc\n\nWords.\n"));
  assert.ok(html.indexOf("<style " + markdown.DOC_STYLE_ATTR + ">") !== -1);
  assert.equal(markdown.DOC_STYLE_ATTR, "data-lahe-doc-style");
});

test("a document with no style line renders no style link", () => {
  const html = markdown.render(source("# Doc\n\nWords.\n"));
  assert.equal(html.indexOf(".lahe-styles"), -1);
});

test("V6: `lahe-style: sample` links the style in the head, right after the house style", () => {
  const html = markdown.render(source("---\nlahe-style: sample\n---\n# Doc\n\nWords.\n"));
  const head = headOf(html);
  assert.ok(head.endsWith("</style>" + LINK), "directly after the bundle, and last in the head");
  assert.equal(html.split(".lahe-styles/").length, 2, "exactly one link");
  assert.equal(head.indexOf("/.lahe-source/"), -1, "the link is not rewritten into the source mount");
});

test("V6: a frontmatter block that holds only the style line is not shown as Document metadata", () => {
  for (const text of [
    "---\nlahe-style: sample\n---\n# Doc\n",
    "---\nlahe-style:sample\n---\n# Doc\n",
    "---\nlahe-style:   sample   \n---\n# Doc\n",
    "---\n\nlahe-style: sample\n\n---\n# Doc\n",
    "---\r\nlahe-style: sample\r\n---\r\n# Doc\r\n"
  ]) {
    const html = markdown.render(source(text));
    assert.ok(html.indexOf(LINK) !== -1, JSON.stringify(text));
    assert.equal(html.indexOf("Document metadata"), -1, JSON.stringify(text));
  }
});

test("V6: a frontmatter block with other lines is still shown, and the style still links", () => {
  const html = markdown.render(source("---\ntitle: A doc\nlahe-style: sample\n---\n# Doc\n"));
  assert.ok(html.indexOf(LINK) !== -1);
  assert.ok(html.indexOf("Document metadata") !== -1);
});

test("V6: `lahe-style: international` is the house style: no link, and nothing shown", () => {
  const html = markdown.render(source("---\nlahe-style: international\n---\n# Doc\n"));
  assert.equal(html.indexOf(".lahe-styles"), -1);
  assert.equal(html.indexOf("Document metadata"), -1);
});

test("V6: a quoted, upper-case, traversal or markup-bearing value is no style", () => {
  for (const value of [
    "\"sample\"",
    "'sample'",
    "Sample",
    "SAMPLE",
    "../sample",
    "sample/../../x",
    "./sample",
    "<b>sample</b>",
    "sample\"><script>alert(1)</script>",
    "sample extra",
    "sample # comment",
    "-sample",
    "x".repeat(41),
    ""
  ]) {
    const html = markdown.render(source("---\nlahe-style: " + value + "\n---\n# Doc\n"));
    assert.equal(headOf(html).indexOf(".lahe-styles"), -1, JSON.stringify(value));
    assert.ok(html.indexOf("Document metadata") !== -1, "a line that is not the style line is metadata: " + JSON.stringify(value));
    assert.equal(html.indexOf("<script>alert(1)"), -1, "and markup in it is escaped");
  }
});

test("V6: the key must be exactly lahe-style at the start of a line", () => {
  for (const line of ["Lahe-Style: sample", "  lahe-style: sample", "lahe_style: sample", "lahe-styles: sample", "x-lahe-style: sample"]) {
    const html = markdown.render(source("---\n" + line + "\n---\n# Doc\n"));
    assert.equal(headOf(html).indexOf(".lahe-styles"), -1, line);
  }
});

test("V6: a style line in the body, not the frontmatter, is just text", () => {
  const html = markdown.render(source("# Doc\n\nlahe-style: sample\n"));
  assert.equal(headOf(html).indexOf(".lahe-styles"), -1);
});

test("V25: two style lines render one link, from the first", () => {
  const html = markdown.render(source("---\nlahe-style: sample\nlahe-style: other\n---\n# Doc\n"));
  assert.equal(html.split("<link rel=\"stylesheet\"").length, 2, "one link");
  assert.ok(html.indexOf(LINK) !== -1, "the first line's style");
});

test("V6: a written artifact gets the style's checked files beside it", () => {
  const state = stateWithSample();
  const doc = source("---\nlahe-style: sample\n---\n# Doc\n\nWords.\n");
  const result = markdown.writeArtifact(state, SESSION, doc);
  const html = fs.readFileSync(result.target, "utf8");
  assert.ok(html.indexOf(LINK) !== -1);
  const copy = path.join(besideArtifact(result.target), "sample");
  assert.deepEqual(
    fs.readFileSync(path.join(copy, "style.css")),
    fs.readFileSync(path.join(stateDirModule.stylesRoot(state), "sample", "style.css"))
  );
  assert.deepEqual(
    fs.readFileSync(path.join(copy, "fonts", "sample-face.woff2")),
    fs.readFileSync(path.join(FIXTURES, "sample", "fonts", "sample-face.woff2"))
  );
  assert.deepEqual(fs.readdirSync(copy).sort(), ["fonts", "style.css"], "never the metadata or the reader files");
});

test("V6: a missing style emits the link and copies nothing", () => {
  const state = stateWithSample();
  const doc = source("---\nlahe-style: not-installed\n---\n# Doc\n");
  const result = markdown.writeArtifact(state, SESSION, doc);
  const html = fs.readFileSync(result.target, "utf8");
  assert.ok(html.indexOf("<link rel=\"stylesheet\" href=\"./.lahe-styles/not-installed/style.css\">") !== -1);
  assert.equal(fs.existsSync(besideArtifact(result.target)), false);
});

test("V6: a bad value touches no file", () => {
  const state = stateWithSample();
  for (const value of ["\"sample\"", "../sample", "Sample", "<b>sample</b>"]) {
    const doc = source("---\nlahe-style: " + value + "\n---\n# Doc\n");
    const result = markdown.writeArtifact(state, SESSION, doc);
    assert.equal(fs.existsSync(besideArtifact(result.target)), false, value);
  }
});

test("V6: a style that fails its rules is linked but copied as nothing", () => {
  const state = stateWithSample();
  fs.appendFileSync(path.join(stateDirModule.stylesRoot(state), "sample", "style.css"), "\na{background:url(https://example.com/x)}\n");
  const result = markdown.writeArtifact(state, SESSION, source("---\nlahe-style: sample\n---\n# Doc\n"));
  assert.equal(fs.existsSync(besideArtifact(result.target)), false);
});

test("V7: adding the style line to a reviewed source re-renders the artifact with the link", () => {
  const state = stateWithSample();
  const doc = source("# Doc\n\nWords.\n");
  const first = markdown.writeArtifact(state, SESSION, doc);
  assert.equal(fs.readFileSync(first.target, "utf8").indexOf(".lahe-styles"), -1);

  fs.writeFileSync(doc, "---\nlahe-style: sample\n---\n# Doc\n\nWords.\n");
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(doc, later, later);

  const rebuilder = rebuild.createRebuilder({ dir: state });
  const outcome = rebuilder.refresh({ id: "review-style", source_path: doc, target_path: first.target, agent_session_id: SESSION });
  assert.equal(outcome.rendered, true, outcome.reason);
  const html = fs.readFileSync(first.target, "utf8");
  assert.ok(html.indexOf(LINK) !== -1);
  assert.equal(html.indexOf("Document metadata"), -1);
  assert.ok(fs.existsSync(path.join(besideArtifact(first.target), "sample", "style.css")));
});
