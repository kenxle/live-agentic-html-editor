"use strict";

// Markdown through pandoc (docs/features/20261017.02_pandoc_render): fenced
// divs drawn as house components, the page shape and links LAHE writes today,
// and the fallback to marked when pandoc is missing. The unit script pins
// LAHE_MARKDOWN_ENGINE=marked for every other test, so these ask for pandoc by
// name and skip, saying why, on a machine without it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const markdown = require("../../src/service/markdown.js");
const pandoc = require("../../src/service/pandoc.js");
const markers = require("../../src/shared/markers.js");

function withEnv(values, fn) {
  const saved = {};
  Object.keys(values).forEach((key) => {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  });
  pandoc.reset();
  try {
    return fn();
  } finally {
    Object.keys(saved).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    pandoc.reset();
  }
}

const HAVE_PANDOC = withEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: undefined }, () => !!pandoc.locate().path);
const NEEDS_PANDOC = HAVE_PANDOC ? false : "pandoc 3 is not installed here, so the pandoc render cannot be checked";

function folder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-pandoc-render-"));
}

function renderWith(text, options, name) {
  const root = folder();
  const source = path.join(root, name || "doc.md");
  fs.writeFileSync(source, text);
  return markdown.renderPage(source, Object.assign({ engine: "pandoc" }, options || {}));
}

function bodyOf(html) {
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

function pandocBody(text, name) {
  const page = renderWith(text, null, name);
  assert.equal(page.engine, "pandoc", "pandoc rendered the page");
  return bodyOf(page.html);
}

function literalFenceLines(html) {
  const text = bodyOf(html).replace(/<pre[\s\S]*?<\/pre>/g, "").replace(/<[^>]+>/g, "");
  return text.split("\n").filter((line) => /^\s*:{3,}/.test(line));
}

// --- the runner -------------------------------------------------------------

test("parseVersion reads pandoc's first line", () => {
  assert.deepEqual(pandoc.parseVersion("pandoc 3.9.0.2\nFeatures: +server +lua"), { major: 3, minor: 9, text: "3.9.0" });
  assert.equal(pandoc.parseVersion("pandoc.exe 2.19.2").major, 2);
  assert.equal(pandoc.parseVersion("something else"), null);
});

test("LAHE_MARKDOWN_ENGINE=marked forces marked and says nothing", () => {
  withEnv({ LAHE_MARKDOWN_ENGINE: "marked" }, () => {
    assert.deepEqual(pandoc.render("# x"), { html: null, reason: "forced", note: null });
  });
});

test("LAHE_PANDOC=none acts as a machine with no pandoc, with a log line", () => {
  withEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: "none" }, () => {
    const out = pandoc.render("# x");
    assert.equal(out.html, null);
    assert.equal(out.reason, "missing");
    assert.match(out.note, /pandoc is not installed/);
  });
});

test("pandoc's data folder does not exist, so no init.lua can run inside LAHE", () => {
  assert.equal(fs.existsSync(pandoc.NO_DATA_DIR), false);
});

test("the filter touches nothing outside the document: no io, os, pipe or mediabag", () => {
  const code = fs.readFileSync(pandoc.FILTER, "utf8").split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
  assert.doesNotMatch(code, /\bio\.|\bos\.|pandoc\.pipe|mediabag|pandoc\.read|require\s*\(/);
});

test("the extensions LAHE names are spelled into one --from value", () => {
  assert.equal(pandoc.FROM, "gfm+fenced_divs-gfm_auto_identifiers-yaml_metadata_block-tex_math_dollars-tex_math_gfm");
});

// --- fenced divs ------------------------------------------------------------

test("a requirement run is one eyebrow label over every item, ids kept as anchors", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("# T\n\n::: callout-req\n**R1.** One\n:::\n\n::: {.callout-req #r2}\n**R2.** Two\n:::\n");
  assert.equal(body.split('<p class="eyebrow">Requirement</p>').length, 2, "one label for the run");
  assert.match(body, /<p class="eyebrow">Requirement<\/p>\n<p><strong>R1\.<\/strong> One<\/p>\n<span id="r2"><\/span>\n<p><strong>R2\.<\/strong> Two<\/p>/);
  assert.doesNotMatch(body, /callout-req/);
});

test("a heading or paragraph between two callouts ends the run", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("::: callout-req\nOne\n:::\n\nBetween.\n\n::: callout-req\nTwo\n:::\n");
  assert.equal(body.split('<p class="eyebrow">Requirement</p>').length, 3);
});

test("non-goals are an eyebrow and plain content, even when they open with a heading", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("::: callout-nongoal\n### Out\n- Not this\n:::\n");
  assert.match(body, /<p class="eyebrow">Non-goals<\/p>\n<h3>Out<\/h3>\n<ul>\n<li>Not this<\/li>\n<\/ul>/);
  assert.doesNotMatch(body, /<section class="callout/);
});

test("each insight kind gets its panel and label; an author's label wins", { skip: NEEDS_PANDOC }, () => {
  const cases = [
    ["callout-metric", '<div class="insight callout-metric" data-label="Metrics">'],
    ["callout-suggest", '<div class="insight callout-suggest" data-label="Suggestion">'],
    ["callout-question", '<div class="insight insight--caveat callout-question" data-label="Open question">'],
    ["callout-flag", '<div class="insight insight--caveat callout-flag" data-label="Red flag">'],
    ["callout-warn", '<div class="insight insight--caveat callout-warn">'],
    ["callout-note", '<div class="insight callout-note" data-label="Note">'],
    ["callout", '<div class="insight">']
  ];
  cases.forEach(([kind, open]) => {
    const body = pandocBody("::: " + kind + "\nText.\n:::\n");
    assert.ok(body.indexOf(open + "\n<p>Text.</p>\n</div>") !== -1, kind + " -> " + open + "\n" + body);
  });
  const labelled = pandocBody('::: {.callout-question data-label="Ask Ken"}\nQ\n:::\n');
  assert.match(labelled, /data-label="Ask Ken"/);
  assert.doesNotMatch(labelled, /Open question/);
  const insight = pandocBody('::: {.insight .insight--caveat data-label="What this means"}\nx\n:::\n');
  assert.match(insight, /<div class="insight insight--caveat" data-label="What this means">/);
});

test("report kinds map onto their house twins", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody([
    ":::: stat-row",
    "::: stat",
    "**73%**",
    "",
    "conceptual, not prompt skill",
    ":::",
    "::::",
    "",
    "::: pullquote",
    "\"The line.\"",
    "",
    "— A Person ([source](https://example.com/q))",
    ":::",
    "",
    "::: keytakeaway",
    "Copy the *grammar*.",
    ":::",
    "",
    "::: eyebrow",
    "Competitive landscape",
    ":::",
    "",
    "::: rimage",
    "![Product UI](images/ui.png)",
    "",
    "Screenshot: example.com, fair use",
    ":::",
    "",
    "::: xref",
    "[Appendix](#appendix-a)",
    ":::"
  ].join("\n"));
  assert.match(body, /<div class="stats">\n<div class="stat">\n<p class="stat-value"><strong>73%<\/strong><\/p>\n<p class="stat-meta">conceptual, not prompt skill<\/p>\n<\/div>\n<\/div>/);
  assert.match(body, /<blockquote class="pullquote">\n<p>"The line\."<\/p>\n<footer>— A Person \(<a href="https:\/\/example\.com\/q" target="_blank" rel="noopener noreferrer">source<\/a>\)<\/footer>\n<\/blockquote>/);
  assert.match(body, /<div class="callout">\n<p>Copy the <em>grammar<\/em>\.<\/p>\n<\/div>/);
  assert.match(body, /<p class="eyebrow">Competitive landscape<\/p>/);
  assert.match(body, /<figure class="plate">\n<img src="\/\.lahe-source\/[a-f0-9]+\/images\/ui\.png" alt="Product UI" \/>\n<figcaption>Screenshot: example\.com, fair use<\/figcaption>\n<\/figure>/);
  assert.match(body, /<div class="xref">\n<p><a href="#appendix-a">Appendix<\/a><\/p>\n<\/div>/);
});

test("a card grid becomes .cards, and a card's bold first line its name", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody(":::: cardgrid\n::: card\n**Structure first**\n\nBehavior loads first.\n:::\n\n::: card\n**Examples**\n\n- one\n:::\n::::\n");
  assert.match(body, /<div class="cards">\n<div class="card">\n<h4>Structure first<\/h4>\n<p>Behavior loads first\.<\/p>\n<\/div>\n<div class="card">\n<h4>Examples<\/h4>/);
});

test("an unknown kind is a plain div with its inside rendered, even when it opens with a heading", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("::: beattable\n### Beat\n**bold** text\n:::\n");
  assert.match(body, /<div class="beattable">\n<h3>Beat<\/h3>\n<p><strong>bold<\/strong> text<\/p>\n<\/div>/);
});

test("same-count nesting and a five-colon fence both nest", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("::: outer\n::: inner\nx\n:::\n:::\n\n::::: cardgrid\n::: card\ny\n:::\n:::::\n");
  assert.match(body, /<div class="outer">\n<div class="inner">\n<p>x<\/p>\n<\/div>\n<\/div>/);
  assert.match(body, /<div class="cards">\n<div class="card">\n<p>y<\/p>\n<\/div>\n<\/div>/);
});

test("a ::: line inside a code fence stays literal code", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("::: callout-note\n```\n::: not a div\n```\nafter\n:::\n");
  assert.match(body, /<pre><code>::: not a div<\/code><\/pre>/);
  assert.match(body, /<p>after<\/p>\n<\/div>/);
});

test("the choice-buttons brief shape renders with no literal fence line", { skip: NEEDS_PANDOC }, () => {
  const page = renderWith("# Brief\n\n## Non-Goals\n\n::: callout-nongoal\n- Not on live sites.\n- Not mobile.\n:::\n");
  assert.deepEqual(literalFenceLines(page.html), []);
});

// --- the page LAHE writes today ---------------------------------------------

test("hero and one numbered sheet per top-level H2; an H2 in a div or a fence does not split", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody([
    "# Title *em*",
    "",
    "Lede.",
    "",
    "## First [link](https://e.com)",
    "",
    "::: card",
    "## Inside a card",
    ":::",
    "",
    "```",
    "## inside code",
    "```",
    "",
    "## Second"
  ].join("\n"));
  assert.match(body, /<div class="hero">\n<h1>Title <em>em<\/em><\/h1>\n<p>Lede\.<\/p>\n<\/div>\n<section class="sheet">\n<div class="sheet-head">\n<h2>First <a href="https:\/\/e\.com" target="_blank" rel="noopener noreferrer">link<\/a><\/h2>\n<span class="n">Section 1<\/span><\/div>/);
  assert.equal((body.match(/<section class="sheet">/g) || []).length, 2);
  assert.match(body, /<span class="n">Section 2<\/span><\/div>\n<\/section>\s*$/);
  assert.match(body, /<div class="card">\n<h2>Inside a card<\/h2>/);
});

test("no # heading: the file name is the title, marked as chrome; an empty file still has its hero", { skip: NEEDS_PANDOC }, () => {
  const empty = pandocBody("", "notes.md");
  assert.ok(empty.indexOf("<h1 " + markers.FILE_TITLE_ATTR + "=\"" + markers.FILE_TITLE_VALUE + "\">notes.md</h1>") !== -1, empty);
  const plain = pandocBody("Words.\n\n## A\n\nMore.\n", "plain.md");
  assert.equal(plain.split(markers.FILE_TITLE_ATTR).length, 2);
});

test("links: relative and translated stay in the tab, external opens a new one, a missing file is inert", { skip: NEEDS_PANDOC }, () => {
  const root = folder();
  fs.writeFileSync(path.join(root, "other.md"), "# Other\n");
  const source = path.join(root, "doc.md");
  fs.writeFileSync(source, [
    "[sibling](other.md \"T&q\") [ext](https://e.com/?a=1&b=2) [mail](mailto:a@b.c) [gone](../../nowhere/missing.md) [anchor](#x)",
    "",
    "[ref link][r]",
    "",
    "[r]: other.md"
  ].join("\n"));
  const page = markdown.renderPage(source, { engine: "pandoc" });
  const body = bodyOf(page.html);
  assert.match(body, /<a href="\/\.lahe-source\/[a-f0-9]+\/other\.md" title="T&amp;q">sibling<\/a>/);
  assert.match(body, /<a href="https:\/\/e\.com\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">ext<\/a>/);
  assert.match(body, /<a href="mailto:a@b\.c">mail<\/a>/);
  assert.match(body, /<span class="lahe-local-link" title="local file, open it on disk: [^"]*missing\.md">gone<\/span>/);
  assert.match(body, /<a href="#x">anchor<\/a>/);
  assert.match(body, />ref link<\/a>/);
  assert.doesNotMatch(body, /data-lahe-link|lahe-link /, "every tag and marker the filter wrote is gone");
});

test("a raw-HTML anchor faking the link tag is never classified", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody('<a data-lahe-link="x:1" href="https://e.com">raw</a> and [md](https://e.com)\n');
  assert.match(body, /<a data-lahe-link="x:1" href="https:\/\/e\.com">raw<\/a>/, "raw HTML passes through untouched, as under marked");
  assert.match(body, /<a href="https:\/\/e\.com" target="_blank" rel="noopener noreferrer">md<\/a>/);
});

test("link text holding raw HTML still swaps whole when the link is inert", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("[a <b>bold</b> one](../../nowhere/gone.md)\n");
  assert.match(body, /<span class="lahe-local-link" title="[^"]*">a <b>bold<\/b> one<\/span>/);
});

test("Mermaid and code blocks keep marked's markup; task items are bare checkboxes; tables scroll", { skip: NEEDS_PANDOC }, () => {
  const page = renderWith("```mermaid\nflowchart TD\n  A --> B\n```\n\n```JS extra\nlet a = 1 < 2;\n```\n\n- [ ] open\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  assert.match(page.html, /<pre class="mermaid">flowchart TD\n  A --&gt; B<\/pre>/);
  assert.match(page.html, /\.lahe-mermaid-11\.16\.1\.js/);
  assert.match(page.html, /<pre><code class="language-js">let a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(page.html, /<ul>\n<li><input disabled="" type="checkbox"> open<\/li>\n<li><input checked="" disabled="" type="checkbox"> done<\/li>\n<\/ul>/);
  assert.match(page.html, /<div class="scrollx">\n<table>/);
});

test("words marked shows stay words: no math, no swallowed --- block", { skip: NEEDS_PANDOC }, () => {
  const body = pandocBody("Paths $HOME/$PATH stay.\n\n---\ntitle: kept\n---\n");
  assert.match(body, /\$HOME\/\$PATH stay\./);
  assert.match(body, /title: kept/);
});

test("frontmatter and the style line still work under pandoc", { skip: NEEDS_PANDOC }, () => {
  const page = renderWith("---\nname: example\n---\n\n# T\n");
  assert.match(page.html, /<summary>Document metadata<\/summary>/);
  assert.match(page.html, /<h1>T<\/h1>/);
});

// --- the fallback -----------------------------------------------------------

test("hasFencedDiv sees a fence line outside code only", () => {
  assert.equal(markdown.hasFencedDiv("::: callout-req\nx\n:::\n"), true);
  assert.equal(markdown.hasFencedDiv(":::: stat-row\n"), true);
  assert.equal(markdown.hasFencedDiv("```\n::: not\n```\n"), false);
  assert.equal(markdown.hasFencedDiv("~~~~\n:::\n~~~~\n"), false);
  assert.equal(markdown.hasFencedDiv("text :: not a fence\n"), false);
});

test("without pandoc a page with fenced divs renders with marked and carries the rail's notice", () => {
  withEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: "none" }, () => {
    const root = folder();
    const source = path.join(root, "doc.md");
    fs.writeFileSync(source, "# T\n\n::: callout-req\nR1\n:::\n");
    const page = markdown.renderPage(source);
    assert.equal(page.engine, "marked");
    assert.ok(page.html.indexOf('<meta name="' + markers.RENDER_NOTE_NAME + '" content="pandoc">') !== -1);
    assert.match(page.note, /pandoc is not installed/);
  });
});

test("without pandoc a page with no fenced div is today's page: no notice, no log line", () => {
  const root = folder();
  const source = path.join(root, "doc.md");
  fs.writeFileSync(source, "# T\n\nWords.\n");
  const forced = withEnv({ LAHE_MARKDOWN_ENGINE: "marked", LAHE_PANDOC: undefined }, () => markdown.renderPage(source));
  const missing = withEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: "none" }, () => markdown.renderPage(source));
  assert.equal(missing.html, forced.html, "byte-identical to the forced marked page");
  assert.equal(missing.note, null);
  assert.equal(missing.html.indexOf(markers.RENDER_NOTE_NAME), -1);
});

test("a forced marked never carries the notice", () => {
  withEnv({ LAHE_MARKDOWN_ENGINE: "marked" }, () => {
    const page = renderWith("::: callout-req\nR1\n:::\n", { engine: undefined });
    assert.equal(page.html.indexOf(markers.RENDER_NOTE_NAME), -1);
    assert.equal(page.note, null);
  });
});

test("writeArtifact logs the missing-pandoc line once to the helper log", () => {
  withEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: "none" }, () => {
    const root = folder();
    const state = path.join(root, "state");
    const source = path.join(root, "doc.md");
    fs.writeFileSync(source, "::: callout-req\nR1\n:::\n");
    markdown.writeArtifact(state, "s_note", source);
    markdown.writeArtifact(state, "s_note", source);
    const log = fs.readFileSync(path.join(state, "helper.log"), "utf8");
    assert.equal(log.split("pandoc is not installed").length, 2, log);
  });
});

// --- the house components ---------------------------------------------------

test("the house stylesheet carries the new card components", () => {
  const css = markdown.styleSheet();
  assert.match(css, /\.cards\{/);
  assert.match(css, /\.card\{/);
});
