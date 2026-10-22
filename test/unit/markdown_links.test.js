"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const links = require("../../src/service/markdown_links.js");
const markdown = require("../../src/service/markdown.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A fixture home: LAHE_HOME_DIR is the same seam LAHE_STATE_DIR gives the state
// directory, so a test can own the boundary the mount rules are written against.
function withHome(run) {
  const home = tempDir("lahe-links-home-");
  const previous = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  try { return run(home); }
  finally {
    if (previous === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previous;
  }
}

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

test("link classification keeps in-folder links, translates local ones, and leaves the rest alone", () => {
  withHome((home) => {
    const skills = path.join(home, "skills");
    const source = path.join(skills, "lahe");
    write(path.join(source, "SKILL.md"), "# Skill\n");
    write(path.join(source, "references", "document-templates.md"), "# Templates\n");
    write(path.join(skills, "crucible", "SKILL.md"), "# Crucible\n");
    const registry = links.createRegistry({});

    assert.equal(links.classify("https://example.com", source, registry).kind, "external");
    assert.equal(links.classify("mailto:someone@example.com", source, registry).kind, "external");
    assert.equal(links.classify("#a-heading", source, registry).kind, "anchor");
    assert.equal(
      links.classify("references/document-templates.md", source, registry).kind,
      "relative",
      "a link inside the document's own folder keeps the behavior it always had"
    );

    const sibling = links.classify("../crucible/SKILL.md", source, registry);
    assert.equal(sibling.kind, "translate");
    assert.equal(sibling.dir, path.join(skills, "crucible"));
    assert.equal(sibling.url, links.mountPrefix(sibling.dir) + "SKILL.md");

    const absolute = links.classify(path.join(skills, "crucible", "SKILL.md"), source, registry);
    assert.equal(absolute.kind, "translate");
    assert.equal(absolute.url, sibling.url, "the same folder is mounted once and reused");
    assert.equal(registry.added.length, 1);

    const anchored = links.classify("../crucible/SKILL.md#step-two", source, registry);
    assert.equal(anchored.url, sibling.url + "#step-two", "a fragment rides along with the translation");
  });
});

test("a local link the mount rules refuse renders inert instead of pointing at a 404", () => {
  withHome((home) => {
    const source = path.join(home, "docs");
    write(path.join(source, "guide.md"), "# Guide\n");
    const outside = tempDir("lahe-links-outside-");
    write(path.join(outside, "secret.md"), "# Outside\n");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(source, "escape.md"));
    const registry = links.createRegistry({});

    const missing = links.classify("../nothing/here.md", source, registry);
    assert.equal(missing.kind, "inert");
    assert.equal(missing.reason, "missing");

    const away = links.classify(path.join(outside, "secret.md"), source, registry);
    assert.equal(away.kind, "inert");
    assert.equal(away.reason, "outside-home", "nothing outside the home directory is ever mounted");

    const escaping = links.classify("../docs/escape.md", path.join(home, "elsewhere"), registry);
    assert.equal(escaping.kind, "inert");
    assert.equal(escaping.reason, "outside-home");

    const symlinked = links.classify(path.join(source, "escape.md"), path.join(home, "elsewhere"), registry);
    assert.equal(symlinked.kind, "inert");
    assert.equal(symlinked.reason, "outside-home", "the real path decides, so a symlink cannot walk out of home");

    const directory = links.classify(path.join(home, "docs"), source, registry);
    assert.equal(directory.kind, "inert");
    assert.equal(directory.reason, "not-a-file");

    assert.equal(registry.added.length, 0, "a refused link registers no mount");
  });
});

test("a link to a hidden location is translated like any other", () => {
  withHome((home) => {
    const source = path.join(home, "docs");
    write(path.join(source, "guide.md"), "# Guide\n");
    write(path.join(source, ".drafts", "plan.md"), "# Plan\n");
    const hiddenFile = path.join(home, ".config", "notes", ".todo.md");
    write(hiddenFile, "# Hidden\n");
    const registry = links.createRegistry({});

    const hidden = links.classify(hiddenFile, source, registry);
    assert.equal(hidden.kind, "translate");
    assert.equal(hidden.url, links.mountPrefix(fs.realpathSync(path.dirname(hiddenFile))) + ".todo.md");
    assert.equal(registry.added.length, 1, "the hidden folder is mounted like any other");
    assert.ok(registry.linked.indexOf(fs.realpathSync(hiddenFile)) !== -1);

    const relative = links.classify(".drafts/plan.md", source, registry);
    assert.equal(relative.kind, "relative");
    assert.ok(
      registry.linked.indexOf(fs.realpathSync(path.join(source, ".drafts", "plan.md"))) !== -1,
      "a relative link into a hidden folder is noted like any other"
    );
  });
});

test("a render may name at most 256 files under mounts: links past it are inert, counted, and do not fail the render", () => {
  withHome((home) => {
    const source = path.join(home, "docs");
    write(path.join(source, "index.md"), "# Index\n");
    const registry = links.createRegistry({});
    const results = [];
    for (let i = 0; i < links.FILE_LIMIT + 3; i += 1) {
      write(path.join(home, "folder", "doc-" + i + ".md"), "# Doc " + i + "\n");
      results.push(links.classify("../folder/doc-" + i + ".md", source, registry));
    }
    assert.equal(links.FILE_LIMIT, 256);
    assert.equal(registry.added.length, 1, "one folder, one mount, however many files");
    assert.equal(registry.past, 3);
    assert.equal(results[links.FILE_LIMIT].kind, "inert");
    assert.equal(results[links.FILE_LIMIT].reason, "too-many");
    assert.equal(results[0].kind, "translate");
    assert.equal(links.classify("../folder/doc-0.md", source, registry).kind, "translate", "a file already named does not count twice");
  });
});

test("the number of folders a page links into is no longer limited", () => {
  withHome((home) => {
    const source = path.join(home, "docs");
    write(path.join(source, "index.md"), "# Index\n");
    const registry = links.createRegistry({});
    for (let i = 0; i < 100; i += 1) {
      write(path.join(home, "folder-" + i, "doc.md"), "# Doc " + i + "\n");
      assert.equal(links.classify("../folder-" + i + "/doc.md", source, registry).kind, "translate");
    }
    assert.equal(registry.added.length, 100);
  });
});

test("a registry that does not follow links reuses the served root and refuses every other folder", () => {
  withHome((home) => {
    const project = path.join(home, "project");
    const source = path.join(project, "docs");
    write(path.join(source, "index.md"), "# Index\n");
    const registry = links.createRegistry({
      mounts: { "/": project }, follow: false
    });
    for (let i = 0; i < 5; i += 1) {
      const target = write(path.join(project, "skills", "skill " + i, "SKILL.md"), "# Skill\n");
      const result = links.classify("../skills/skill " + i + "/SKILL.md#details", source, registry);
      assert.equal(result.kind, "translate");
      assert.equal(result.url, "/skills/skill%20" + i + "/SKILL.md#details");
      assert.ok(registry.linked.includes(target));
    }
    assert.equal(registry.added.length, 0);
    write(path.join(home, "project-other", "SECRET.md"), "# Outside this site\n");
    const refused = links.classify("../../project-other/SECRET.md", source, registry);
    assert.equal(refused.kind, "inert");
    assert.equal(refused.reason, "no-follow");
    assert.equal(registry.added.length, 0);
  });
});

test("rendering translates local links, marks the read-only view, and stays deterministic", () => {
  withHome((home) => {
    const source = path.join(home, "skills", "lahe");
    const doc = write(path.join(source, "SKILL.md"), [
      "# Skill",
      "",
      "- [Template](references/document-templates.md)",
      "- [Sibling](../crucible/SKILL.md)",
      "- [Gone](../nowhere/GONE.md)",
      "- [Heading](#skill)",
      "- [Away](https://example.com)",
      "- [Email](mailto:someone@example.com)"
    ].join("\n"));
    write(path.join(source, "references", "document-templates.md"), "# Templates\n");
    const siblingDir = path.join(home, "skills", "crucible");
    write(path.join(siblingDir, "SKILL.md"), "# Crucible\n");

    const registry = links.createRegistry({});
    const html = markdown.render(doc, { readOnlyNote: true, links: registry });
    assert.match(html, /Read-only rendered view of <code>[^<]*SKILL\.md<\/code><br>This document is not under review\./);
    assert.match(html, new RegExp('href="' + links.mountPrefix(siblingDir) + 'SKILL\\.md"'));
    assert.match(html, /href="\/\.lahe-source\/[a-f0-9]+\/references\/document-templates\.md"/);
    assert.doesNotMatch(html,
      new RegExp('href="' + links.mountPrefix(siblingDir) + 'SKILL\\.md"[^>]*target='),
      "a translated local link stays in the same tab"
    );
    assert.match(html, /<span class="lahe-local-link" title="local file, open it on disk: [^"]*nowhere[^"]*GONE\.md">Gone<\/span>/);
    assert.match(html, /<a href="#skill">Heading<\/a>/, "an in-page anchor stays in the same tab");
    assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">Away<\/a>/,
      "a link leaving the documentation opens in a new tab");
    assert.match(html, /<a href="mailto:someone@example\.com">Email<\/a>/,
      "a mailto link gets no target");
    assert.doesNotMatch(html, /lahe-layer\.js/, "a rendered linked document carries no library script line");

    const again = markdown.render(doc, { readOnlyNote: true, links: links.createRegistry({}) });
    assert.equal(again, html, "the same source renders the same bytes");
    assert.equal(
      fs.readFileSync(doc, "utf8").indexOf("../crucible/SKILL.md") !== -1,
      true,
      "the disk keeps the link its author wrote"
    );
  });
});

// LAHE-markdown-link-schemes: a rendered page carries only web, email and phone
// links, plus the relative and in-page ones. Anything else keeps its words and
// loses its address, however a browser would have spelled the scheme.
test("only http, https, mailto and tel links render as links; every other scheme renders as text", () => {
  withHome((home) => {
    const source = path.join(home, "notes");
    const registry = links.createRegistry({});
    const allowed = ["https://example.com", "http://example.com", "mailto:a@example.com", "tel:+15555550100",
      "//example.com/x", "#a-heading"];
    for (const href of allowed) {
      assert.notEqual(links.classify(href, source, registry).kind, "blocked", href + " is allowed");
    }
    const refused = {
      "javascript:alert(1)": "javascript",
      "JaVaScRiPt:alert(1)": "javascript",
      " javascript:alert(1)": "javascript",
      "\u0001javascript:alert(1)": "javascript",
      "java\tscript:alert(1)": "javascript",
      "java\nscript:alert(1)": "javascript",
      "data:text/html,<b>hi</b>": "data",
      "vbscript:msgbox(1)": "vbscript",
      "vscode://file/x": "vscode",
      "file:///etc/passwd": "file"
    };
    for (const href of Object.keys(refused)) {
      const decision = links.classify(href, source, registry);
      assert.equal(decision.kind, "blocked", JSON.stringify(href) + " is refused");
      assert.equal(decision.scheme, refused[href]);
    }
  });
});

// LAHE-pandoc-link-safety-tests: the unit suite forces marked, but Ken's pages
// render with pandoc, so the render checks run once per engine. pandoc turns
// the tab in `<java\tscript:...>` into spaces before Lahe sees the address, so
// it is read as a relative file and becomes a same-site path; the check is
// then on what a browser would do with every href, not on its spelling.
const pandoc = require("../../src/service/pandoc.js");
const BLOCK_FORMS = [
  "# Page",
  "",
  "[inline](javascript:alert(1)) [ref][bad] <javascript:alert(2)> [angle](<java\tscript:alert(3)>) [ok](https://example.com)",
  "",
  "[bad]: JAVASCRIPT:alert(4)"
].join("\n");
const PAGE_ORIGIN = "http://notes.lahe.localhost:1483";

function pandocHere() {
  const saved = { LAHE_MARKDOWN_ENGINE: process.env.LAHE_MARKDOWN_ENGINE, LAHE_PANDOC: process.env.LAHE_PANDOC };
  delete process.env.LAHE_MARKDOWN_ENGINE;
  delete process.env.LAHE_PANDOC;
  pandoc.reset();
  try { return !!pandoc.locate().path; }
  finally {
    Object.keys(saved).forEach((key) => { if (saved[key] !== undefined) process.env[key] = saved[key]; });
    pandoc.reset();
  }
}
const NEEDS_PANDOC = pandocHere() ? false : "no usable pandoc 3 here (missing, or too old), so the pandoc render cannot be checked";

/** Every link's href, as a browser would resolve it on the served page. */
function resolvedHrefs(html) {
  const hrefs = [];
  html.replace(/<a\s[^>]*?href="([^"]*)"/g, (all, href) => {
    const raw = href.replace(/&amp;/g, "&").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
    hrefs.push({ href: raw, url: new URL(raw, PAGE_ORIGIN + "/page.md") });
    return all;
  });
  return hrefs;
}

for (const engine of ["marked", "pandoc"]) {
  test("a refused link renders as plain text in every Markdown link form (" + engine + ")", { skip: engine === "pandoc" && NEEDS_PANDOC }, () => {
    withHome((home) => {
      const doc = write(path.join(home, "notes", "page.md"), BLOCK_FORMS);
      const page = markdown.renderPage(doc, { engine, links: links.createRegistry({}) });
      assert.equal(page.engine, engine, engine + " rendered the page");
      const html = page.html;
      for (const { href, url } of resolvedHrefs(html)) {
        assert.ok(["http:", "https:", "mailto:", "tel:"].includes(url.protocol), JSON.stringify(href) + " opens as " + url.protocol);
      }
      assert.doesNotMatch(html, /href="\s*(java|vb)script:/i, "no href starts with a script scheme");
      assert.match(html, /<span class="lahe-blocked-link" title="javascript: links are not opened from a rendered page">inline<\/span>/);
      assert.match(html, /<span class="lahe-blocked-link"[^>]*>ref<\/span>/, "a reference-style link is checked too");
      assert.match(html, /<span class="lahe-blocked-link"[^>]*>javascript:alert\(2\)<\/span>/, "an autolink is checked too");
      if (engine === "marked") {
        assert.match(html, /<span class="lahe-blocked-link"[^>]*>angle<\/span>/, "a tab inside the scheme does not slip through");
      } else {
        const angle = /<a href="([^"]*)"[^>]*>angle<\/a>/.exec(html);
        if (angle) {
          assert.equal(new URL(angle[1], PAGE_ORIGIN + "/page.md").origin, PAGE_ORIGIN, "the tab form is a path on this site, not a script");
        } else {
          assert.match(html, /<span class="lahe-blocked-link"[^>]*>angle<\/span>/);
        }
      }
      assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
    });
  });
}
