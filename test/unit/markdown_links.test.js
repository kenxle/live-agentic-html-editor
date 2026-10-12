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

test("the per-render mount cap is honored, counted, and does not fail the render", () => {
  withHome((home) => {
    const source = path.join(home, "docs");
    write(path.join(source, "index.md"), "# Index\n");
    const registry = links.createRegistry({});
    const results = [];
    for (let i = 0; i < links.MOUNT_CAP + 3; i += 1) {
      write(path.join(home, "folder-" + i, "doc.md"), "# Doc " + i + "\n");
      results.push(links.classify("../folder-" + i + "/doc.md", source, registry));
    }
    assert.equal(registry.added.length, links.MOUNT_CAP);
    assert.equal(registry.skipped, 3);
    assert.equal(results[links.MOUNT_CAP].kind, "inert");
    assert.equal(results[links.MOUNT_CAP].reason, "cap");
    assert.equal(results[0].kind, "translate");
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
    assert.match(html, /Read-only rendered view of <code>[^<]*SKILL\.md<\/code>\. This document is not under review\./);
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
