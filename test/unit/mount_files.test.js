// A mount serves only the files a site's pages link to, plus their images
// (docs/features/20261019.03_linked_folder_scope). The rows are the spec's
// verification table: V1 to V3, V5 to V8, V10, V14, V15, V17 to V19. V4 is in
// markdown_linked_docs.test.js, V9 and V16 in sites_pages.test.js.
//
// Every test serves from an in-process helper on free ports and a temp state
// folder, closed in teardown. The fake home is LAHE_HOME_DIR, so ~/.ssh and
// the other secret folders are folders under it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const links = require("../../src/service/markdown_links.js");
const markdown = require("../../src/service/markdown.js");
const pageRoutes = require("../../src/service/page_routes.js");
const pandoc = require("../../src/service/pandoc.js");
const service = require("../../src/service/index.js");
const sitesModule = require("../../src/service/sites.js");
const stateDir = require("../../src/service/state_dir.js");
const { sitesWorld, writeFile, getPage, tempRoot } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>words</p></body></html>";

function real(file) {
  return fs.realpathSync.native(file);
}

function helperLog(w) {
  try { return fs.readFileSync(stateDir.helperLogPath(w.state), "utf8"); } catch (err) { return ""; }
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

/** The mount prefix a rendered page uses for the file named `tail`. */
function mountOf(html, tail) {
  const escaped = tail.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const found = new RegExp('(?:href|src)="(/\\.lahe-source/[a-f0-9]+/)' + escaped + '"').exec(html);
  assert.ok(found, "no mounted address for " + tail + " in " + html.slice(0, 600));
  return found[1];
}

/**
 * A folder site rooted at home/ws/repo/notes with a hub page that holds
 * `hubText`. The hub is requested once so its links make their mounts.
 */
async function hubWorld(t, hubText, extra) {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  writeFile(notes, "hub.md", hubText);
  if (extra) extra(w);
  const bound = w.helper.sites.bind({ root: real(notes), mode: "folder", entry: "hub.md" });
  const hub = await getPage(w, bound.name, "/hub.md");
  assert.equal(hub.status, 200);
  return Object.assign(w, { name: bound.name, notes: real(notes), hub });
}

// --- V1 and V2: the function that reads a finished page -----------------------

function listWorld() {
  const root = tempRoot("lahe-files-under-");
  const home = path.join(root, "home");
  const folder = path.join(home, "ws", "other");
  fs.mkdirSync(folder, { recursive: true });
  const prior = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  return {
    root,
    home: real(home),
    folder: real(folder),
    prefix: links.mountPrefix(real(folder)),
    restore: () => { if (prior === undefined) delete process.env.LAHE_HOME_DIR; else process.env.LAHE_HOME_DIR = prior; }
  };
}

function withList(fn) {
  const world = listWorld();
  try { return fn(world); } finally { world.restore(); }
}

test("V1: filesUnderMounts lists a translated link, a relative link, an inline image, a srcset entry, a raw img and a folder link as its index.html", () => {
  withList((x) => {
    for (const name of ["far.md", "next.md", "pic.png", "raw.png", "a.png", "b.png", "c.png", "folder/index.html"]) writeFile(x.folder, name, "x");
    const html = [
      '<a href="' + x.prefix + 'far.md">translated</a>',
      '<a href="next.md">relative to the page</a>',
      '<img src="' + x.prefix + 'pic.png" alt="inline">',
      '<img src="raw.png">',
      '<img srcset="' + x.prefix + 'a.png 1x, ' + x.prefix + 'b.png 2x" src="' + x.prefix + 'c.png">',
      '<a href="' + x.prefix + 'folder/">a folder</a>'
    ].join("\n");
    const out = pageRoutes.filesUnderMounts(html, x.prefix, { [x.prefix]: x.folder });
    const want = ["far.md", "next.md", "pic.png", "raw.png", "a.png", "b.png", "c.png", "folder/index.html"].map((n) => path.join(x.folder, n));
    assert.deepEqual(out.files.slice().sort(), want.slice().sort());
    assert.equal(out.over, 0);
  });
});

test("V1: the entities in an attribute are decoded before the address is read", () => {
  withList((x) => {
    writeFile(x.folder, "a&b.png", "x");
    const html = '<img src="' + x.prefix + 'a&amp;b.png">';
    assert.deepEqual(pageRoutes.filesUnderMounts(html, x.prefix, { [x.prefix]: x.folder }).files, [path.join(x.folder, "a&b.png")]);
  });
});

test("V1: pandoc output is listed the same way (a link, an image, a raw img)", { skip: pandoc.locate().path ? false : "pandoc is not installed here" }, () => {
  withList((x) => {
    const doc = writeFile(x.folder, "doc.md", "# Doc\n\n[next](next.md) ![pic](pic.png)\n\n<img src=\"raw.png\">\n");
    for (const name of ["next.md", "pic.png", "raw.png"]) writeFile(x.folder, name, "x");
    const registry = links.createRegistry({ mounts: { [x.prefix]: x.folder } });
    const page = markdown.renderPage(doc, { engine: "pandoc", assetPrefix: x.prefix, links: registry });
    assert.equal(page.engine, "pandoc");
    const out = pageRoutes.filesUnderMounts(page.html, x.prefix, registry.mounts);
    for (const name of ["next.md", "pic.png", "raw.png"]) assert.ok(out.files.includes(path.join(x.folder, name)), name);
  });
});

test("V2: filesUnderMounts lists nothing for an outside URL, Lahe's own files, a dot-dot or symlink that leaves the mount, a missing file or a prefix the site does not mount", () => {
  withList((x) => {
    writeFile(x.folder, "inside.txt", "x");
    writeFile(x.home, "ws/secret.txt", "x");
    fs.symlinkSync(path.join(x.home, "ws", "secret.txt"), path.join(x.folder, "link.txt"));
    const other = "/.lahe-source/ffffffffffffffff/";
    const html = [
      '<img src="https://example.com/x.png">',
      '<script src="//cdn.example.com/x.js"></script>',
      '<style>@import url("' + x.prefix + 'inside.txt")</style>',
      '<link href="/.lahe-doc-style.css">',
      '<script src="/.lahe-library/lahe-layer.js"></script>',
      '<img src="/.lahe-fonts/x.woff2">',
      '<script src="./mermaid.tiny.js"></script>',
      '<img src="' + x.prefix + '../secret.txt">',
      '<img src="' + x.prefix + '%2e%2e/secret.txt">',
      '<img src="' + x.prefix + '..%2fsecret.txt">',
      '<img src="' + x.prefix + 'link.txt">',
      '<img src="' + x.prefix + 'missing.png">',
      '<img src="' + other + 'inside.txt">',
      '<img src="data:image/png;base64,AAAA">',
      '<a href="#top">top</a>'
    ].join("\n");
    const out = pageRoutes.filesUnderMounts(html, x.prefix, { [x.prefix]: x.folder });
    assert.deepEqual(out.files, []);
  });
});

test("V2: filesUnderMounts lists nothing under a prefix whose folder is outside home", () => {
  withList((x) => {
    const outside = tempRoot("lahe-outside-home-");
    writeFile(outside, "x.txt", "x");
    const prefix = "/.lahe-source/0123456789abcdef/";
    assert.deepEqual(pageRoutes.filesUnderMounts('<img src="' + prefix + 'x.txt">', prefix, { [prefix]: outside }).files, []);
  });
});

// --- V3: the premise check turned into a test ---------------------------------

test("V3: one link to ~/todo.md serves todo.md and nothing else under the home mount", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[todo](" + "../../../todo.md" + ")\n", (x) => {
    writeFile(x.home, "todo.md", "# Todo\n\ntodo words\n");
    writeFile(x.home, ".ssh/id_ed25519", "PRIVATE KEY");
    writeFile(x.home, "Documents/taxes/2025.txt", "TAX RETURN");
  });
  const prefix = mountOf(w.hub.text, "todo.md");
  assert.equal(prefix, links.mountPrefix(w.home), "the link mounted the home folder");
  const todo = await getPage(w, w.name, prefix + "todo.md");
  assert.equal(todo.status, 200);
  assert.match(todo.text, /todo words/);
  for (const p of [".ssh/id_ed25519", "Documents/taxes/2025.txt"]) {
    const res = await getPage(w, w.name, prefix + p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /PRIVATE KEY|TAX RETURN/, p);
  }
});

// --- V5 and V19: a linked HTML page brings what it names, from its own folder ---

test("V5: a linked HTML page's stylesheet, image, url() inside the stylesheet and script answer 200, and a sibling it does not name answers 404", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[page](../../other/site/page.html)\n", (x) => {
    const site = path.join(x.home, "ws", "other", "site");
    writeFile(site, "page.html",
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="app.js"></script></head>' +
      '<body><img src="img/a.png"></body></html>');
    writeFile(site, "style.css", "body { background: url(bg/back.png); } @font-face { src: url('fonts/f.woff2'); }");
    writeFile(site, "img/a.png", "PNG-A");
    writeFile(site, "bg/back.png", "PNG-BACK");
    writeFile(site, "fonts/f.woff2", "FONT");
    writeFile(site, "app.js", "window.x = 1;");
    writeFile(site, "sibling.txt", "NOT NAMED");
    writeFile(site, "data.json", '{"loaded":"by script"}');
  });
  const prefix = mountOf(w.hub.text, "page.html");
  assert.equal((await getPage(w, w.name, prefix + "page.html")).status, 200);
  for (const [p, body] of [["style.css", /background/], ["img/a.png", /PNG-A/], ["bg/back.png", /PNG-BACK/], ["fonts/f.woff2", /FONT/], ["app.js", /window\.x/]]) {
    const res = await getPage(w, w.name, prefix + p);
    assert.equal(res.status, 200, p);
    assert.match(res.text, body, p);
  }
  for (const p of ["sibling.txt", "data.json"]) {
    const res = await getPage(w, w.name, prefix + p);
    assert.equal(res.status, 404, p);
  }
});

test("V19: a linked HTML page that names a file under another mount and a file above its folder lists neither, and its own folder's stylesheet answers 200", async (t) => {
  const w = await hubWorld(t,
    "# Hub\n\n[far](../../other/far.md) [page](../../other/sub/page.html) [third](../../third/t.md)\n",
    (x) => {
      const other = path.join(x.home, "ws", "other");
      writeFile(other, "far.md", "# Far\n");
      writeFile(other, "up.css", "UP ONE FOLDER");
      writeFile(other, "sub/own.css", "OWN FOLDER");
      writeFile(path.join(x.home, "ws", "third"), "t.md", "# Third\n");
      writeFile(path.join(x.home, "ws", "third"), "t.png", "THIRD MOUNT IMAGE");
      const thirdPrefix = links.mountPrefix(real(path.join(x.home, "ws", "third")));
      writeFile(other, "sub/page.html",
        '<!doctype html><html><head><link rel="stylesheet" href="own.css"><link rel="stylesheet" href="../up.css"></head>' +
        '<body><img src="' + thirdPrefix + 't.png"></body></html>');
    });
  const otherPrefix = mountOf(w.hub.text, "far.md");
  const thirdPrefix = mountOf(w.hub.text, "t.md");
  assert.notEqual(otherPrefix, thirdPrefix);
  assert.match(w.hub.text, new RegExp(otherPrefix.replace(/\//g, "\\/") + "sub\\/page\\.html"), "the page is reached through the other folder's mount");
  assert.equal((await getPage(w, w.name, otherPrefix + "sub/page.html")).status, 200);
  assert.equal((await getPage(w, w.name, otherPrefix + "sub/own.css")).status, 200);
  assert.equal((await getPage(w, w.name, otherPrefix + "up.css")).status, 404, "above the page's folder");
  assert.equal((await getPage(w, w.name, thirdPrefix + "t.png")).status, 404, "under another mount");
});

// --- V6 and V7: what is already on the site, and what survives a restart --------

test("V6: a site entry with linked_files and no mount_files serves its linked pages with no render first", async (t) => {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const other = path.join(w.home, "ws", "other");
  writeFile(notes, "hub.md", "# Hub\n");
  writeFile(other, "far.md", "# Far\n\nfar words\n");
  writeFile(other, "unlinked.txt", "NOT LINKED");
  const prefix = "/.lahe-source/00aa11bb22cc33dd/";
  const bound = w.helper.sites.bind({ root: real(notes), mode: "folder", entry: "hub.md", mounts: { [prefix]: real(other) } });
  w.helper.sites.addLinked(bound.name, "r-old", [path.join(real(other), "far.md")]);
  assert.equal(w.helper.sites.get(bound.name).mount_files === undefined || w.helper.sites.get(bound.name).mount_files.length === 0, true);
  const far = await getPage(w, bound.name, prefix + "far.md");
  assert.equal(far.status, 200);
  assert.match(far.text, /far words/);
  assert.equal((await getPage(w, bound.name, prefix + "unlinked.txt")).status, 404);
});

test("V7: a listed image is served by a new helper started on the same state folder, with no re-render", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[far](../../other/far.md)\n", (x) => {
    writeFile(path.join(x.home, "ws", "other"), "far.md", "# Far\n\n![pic](pic.png)\n");
    writeFile(path.join(x.home, "ws", "other"), "pic.png", "THE PICTURE");
    writeFile(path.join(x.home, "ws", "other"), "unlinked.png", "NOT LISTED");
  });
  const prefix = mountOf(w.hub.text, "far.md");
  assert.equal((await getPage(w, w.name, prefix + "far.md")).status, 200);
  assert.equal((await getPage(w, w.name, prefix + "pic.png")).text, "THE PICTURE");
  await w.helper.close();
  const again = await service.serve({ port: 0, stateDir: w.state, quiet: true, pagesPort: 0, sitesHome: w.home });
  t.after(() => again.close());
  const fresh = { helper: again };
  assert.equal((await getPage(fresh, w.name, prefix + "pic.png")).text, "THE PICTURE", "served with no render since the restart");
  assert.equal((await getPage(fresh, w.name, prefix + "unlinked.png")).status, 404);
});

// --- V8: the list in the registry ------------------------------------------------

function registryIn(dir) {
  return sitesModule.createSites({ dir: dir, home: dir });
}

function seedSite(dir, extra) {
  const root = tempRoot("lahe-reg-root-");
  const registry = registryIn(dir);
  const bound = registry.bind(Object.assign({ root: root, mode: "folder", entry: "" }, extra || {}));
  return { registry, name: bound.name, root };
}

test("V8: mount_files is cleaned on load: absolute path strings only, no repeats", () => {
  const dir = tempRoot("lahe-reg-clean-");
  const seeded = seedSite(dir);
  const file = sitesModule.jsonPath(dir);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.sites[seeded.name].mount_files = ["/a/one.png", "/a/one.png", "relative/two.png", 7, null, "/a/three.png", { x: 1 }];
  fs.writeFileSync(file, JSON.stringify(data));
  const loaded = registryIn(dir).get(seeded.name);
  assert.deepEqual(loaded.mount_files, ["/a/one.png", "/a/three.png"]);
});

test("V8: addMountFiles merges without repeats and says whether it changed anything", () => {
  const dir = tempRoot("lahe-reg-merge-");
  const seeded = seedSite(dir);
  assert.equal(seeded.registry.addMountFiles(seeded.name, ["/a/one.png", "/a/two.png"]), true);
  assert.equal(seeded.registry.addMountFiles(seeded.name, ["/a/two.png", "/a/three.png", "/a/three.png"]), true);
  assert.equal(seeded.registry.addMountFiles(seeded.name, ["/a/one.png"]), false);
  assert.equal(seeded.registry.addMountFiles(seeded.name, ["relative.png", 5, null]), false);
  assert.deepEqual(seeded.registry.get(seeded.name).mount_files, ["/a/one.png", "/a/two.png", "/a/three.png"]);
  assert.equal(seeded.registry.addMountFiles("no.such.site", ["/a/x.png"]), false);
});

test("V8: the list is rebuilt from the mount-files log lines when sites.json is lost", () => {
  const dir = tempRoot("lahe-reg-rebuild-");
  const seeded = seedSite(dir);
  seeded.registry.addMountFiles(seeded.name, ["/a/one.png", "/a/two.png"]);
  seeded.registry.addMountFiles(seeded.name, ["/a/three.png"]);
  fs.writeFileSync(sitesModule.jsonPath(dir), "{ not json");
  const rebuilt = registryIn(dir).get(seeded.name);
  assert.ok(rebuilt, "the site comes back from the log");
  assert.deepEqual(rebuilt.mount_files.slice().sort(), ["/a/one.png", "/a/three.png", "/a/two.png"]);
  const written = JSON.parse(fs.readFileSync(sitesModule.jsonPath(dir), "utf8"));
  assert.deepEqual(written.sites[seeded.name].mount_files.slice().sort(), ["/a/one.png", "/a/three.png", "/a/two.png"], "sites.json is written again");
});

test("V8: a mount-files line the json lacks (a crash between the two writes) is joined on load", () => {
  const dir = tempRoot("lahe-reg-crash-");
  const seeded = seedSite(dir);
  seeded.registry.addMountFiles(seeded.name, ["/a/one.png"]);
  const data = JSON.parse(fs.readFileSync(sitesModule.jsonPath(dir), "utf8"));
  data.sites[seeded.name].mount_files = [];
  fs.writeFileSync(sitesModule.jsonPath(dir), JSON.stringify(data));
  assert.deepEqual(registryIn(dir).get(seeded.name).mount_files, ["/a/one.png"]);
});

// --- V10: a refused file leaves a trace, once --------------------------------

test("V10: a file that is not on the list writes one helper-log line naming the file and the site, once", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[far](../../other/far.md)\n", (x) => {
    writeFile(path.join(x.home, "ws", "other"), "far.md", "# Far\n");
    writeFile(path.join(x.home, "ws", "other"), "unlisted.txt", "x");
  });
  const prefix = mountOf(w.hub.text, "far.md");
  const file = path.join(real(path.join(w.home, "ws", "other")), "unlisted.txt");
  for (let i = 0; i < 3; i += 1) assert.equal((await getPage(w, w.name, prefix + "unlisted.txt")).status, 404);
  const log = helperLog(w);
  assert.equal(count(log, file), 1, log);
  const line = log.split("\n").find((l) => l.includes(file));
  assert.ok(line.includes(w.name), line);
});

test("V10: a secret file writes one helper-log line too", async (t) => {
  const w = await sitesWorld(t);
  writeFile(w.home, ".ssh/id_ed25519", "KEY");
  writeFile(w.home, "todo.md", "# t\n");
  const bound = w.helper.sites.bind({ root: real(w.home), mode: "folder", entry: "todo.md" });
  for (let i = 0; i < 3; i += 1) assert.equal((await getPage(w, bound.name, "/.ssh/id_ed25519")).status, 404);
  const log = helperLog(w);
  assert.equal(count(log, path.join(real(w.home), ".ssh", "id_ed25519")), 1, log);
});

// --- V14 and V15: the secret list -----------------------------------------------

test("isSecretPath: the listed paths and everything inside them, and nothing that only shares a name start", () => {
  const root = tempRoot("lahe-secret-list-");
  const prior = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = root;
  try {
    const home = real(root);
    for (const rel of [".ssh", ".aws", ".gnupg", ".config/gh", ".config/gcloud", ".kube", ".docker", "Library/Keychains"]) {
      assert.equal(links.isSecretPath(path.join(home, rel)), true, rel);
      assert.equal(links.isSecretPath(path.join(home, rel, "deep", "file")), true, rel + "/deep/file");
    }
    for (const rel of [".netrc", ".git-credentials", ".npmrc"]) {
      assert.equal(links.isSecretPath(path.join(home, rel)), true, rel);
    }
    for (const rel of [".sshconfig", ".ssh-notes/a.md", ".config/ghost", ".config", "Library", "Documents/.ssh-keys.md", ".npmrc.bak", "todo.md"]) {
      assert.equal(links.isSecretPath(path.join(home, rel)), false, rel);
    }
    assert.equal(links.isSecretPath("/etc/passwd"), false);
  } finally {
    if (prior === undefined) delete process.env.LAHE_HOME_DIR; else process.env.LAHE_HOME_DIR = prior;
  }
});

test("V14: a hostile README links a key by relative and absolute path and shows a gnupg file in raw HTML: plain text, nothing listed, 404 for each", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[readme](../../linked/README.md)\n[todo](../../../todo.md)\n", (x) => {
    writeFile(x.home, "todo.md", "# Todo\n");
    writeFile(x.home, ".ssh/id_ed25519", "PRIVATE KEY");
    writeFile(x.home, ".aws/credentials", "AWS KEYS");
    writeFile(x.home, ".gnupg/secring.gpg", "GPG KEYS");
    const homeMount = links.mountPrefix(real(x.home));
    writeFile(path.join(x.home, "ws", "linked"), "README.md", [
      "# Hostile",
      "",
      "[key](../../.ssh/id_ed25519)",
      "",
      "[aws](" + path.join(x.home, ".aws", "credentials") + ")",
      "",
      '<img src="' + homeMount + '.gnupg/secring.gpg">',
      ""
    ].join("\n"));
    fs.symlinkSync(path.join(x.home, ".ssh", "id_ed25519"), path.join(x.home, "ws", "linked", "key-link"));
  });
  const linkedPrefix = mountOf(w.hub.text, "README.md");
  const homePrefix = mountOf(w.hub.text, "todo.md");
  assert.equal((await getPage(w, w.name, homePrefix + "todo.md")).status, 200);
  const readme = await getPage(w, w.name, linkedPrefix + "README.md");
  assert.equal(readme.status, 200);
  assert.equal(count(readme.text, 'class="lahe-local-link"'), 2, "both links are plain text");
  assert.match(readme.text, /title="local file, open it on disk: [^"]*id_ed25519"/);
  assert.match(readme.text, /title="local file, open it on disk: [^"]*credentials"/);
  assert.doesNotMatch(readme.text, /href="[^"]*(id_ed25519|credentials)/);
  const listed = (w.helper.sites.get(w.name).mount_files || []).concat(Object.keys(w.helper.sites.get(w.name).linked_files || {}));
  assert.deepEqual(listed.filter((f) => /\.ssh|\.aws|\.gnupg/.test(f)), [], "nothing secret is listed");
  for (const p of [homePrefix + ".ssh/id_ed25519", homePrefix + ".aws/credentials", homePrefix + ".gnupg/secring.gpg", linkedPrefix + "key-link"]) {
    const res = await getPage(w, w.name, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /PRIVATE KEY|AWS KEYS|GPG KEYS/, p);
  }
});

test("V14: a secret file stays 404 even when it is put on the list by hand", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[todo](../../../todo.md)\n", (x) => {
    writeFile(x.home, "todo.md", "# Todo\n");
    writeFile(x.home, ".ssh/id_ed25519", "PRIVATE KEY");
  });
  const homePrefix = mountOf(w.hub.text, "todo.md");
  const key = path.join(real(w.home), ".ssh", "id_ed25519");
  w.helper.sites.addMountFiles(w.name, [key]);
  w.helper.sites.addLinked(w.name, "r-x", [key]);
  assert.equal((await getPage(w, w.name, homePrefix + ".ssh/id_ed25519")).status, 404);
});

test("V15: a site rooted at home serves todo.md and ~/notes/other.md, and refuses the secret folders", async (t) => {
  const w = await sitesWorld(t);
  writeFile(w.home, "todo.md", "# Todo\n\ntodo words\n");
  writeFile(w.home, "notes/other.md", "# Other\n\nother words\n");
  writeFile(w.home, ".ssh/id_ed25519", "PRIVATE KEY");
  writeFile(w.home, ".config/gh/hosts.yml", "oauth_token: x");
  writeFile(w.home, "Library/Keychains/login.keychain-db", "KEYCHAIN");
  const bound = w.helper.sites.bind({ root: real(w.home), mode: "folder", entry: "todo.md" });
  assert.equal((await getPage(w, bound.name, "/todo.md")).status, 200);
  assert.equal((await getPage(w, bound.name, "/notes/other.md")).status, 200);
  for (const p of ["/.ssh/id_ed25519", "/.config/gh/hosts.yml", "/Library/Keychains/login.keychain-db", "/%2Essh/id_ed25519"]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /PRIVATE KEY|oauth_token|KEYCHAIN/, p);
  }
});

test("V15: a link to a file in a secret folder is plain text on any page", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[gh](../../../.config/gh/hosts.yml)\n", (x) => {
    writeFile(x.home, ".config/gh/hosts.yml", "oauth_token: x");
  });
  assert.equal(count(w.hub.text, 'class="lahe-local-link"'), 1);
  assert.doesNotMatch(w.hub.text, /href="\/\.lahe-source\//);
  assert.deepEqual(Object.keys(w.helper.sites.get(w.name).mounts || {}), [], "no mount was made for it");
});

// --- V17: the log carries only new paths ------------------------------------------

test("V17: each render that adds files appends one mount-files line holding only the new paths; no whole-entry line carries mount_files; an older reader ignores the new lines", async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[far](../../other/far.md)\n", (x) => {
    writeFile(path.join(x.home, "ws", "other"), "far.md", "# Far\n\n![a](a.png) ![b](b.png)\n");
    writeFile(path.join(x.home, "ws", "other"), "a.png", "A");
    writeFile(path.join(x.home, "ws", "other"), "b.png", "B");
  });
  const prefix = mountOf(w.hub.text, "far.md");
  await getPage(w, w.name, prefix + "far.md");
  await getPage(w, w.name, prefix + "far.md");
  const lines = fs.readFileSync(sitesModule.logPath(w.state), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const fileLines = lines.filter((l) => l.event === "mount-files");
  assert.equal(fileLines.length, 2, "the hub's render added far.md, far.md's render added the two images");
  const other = real(path.join(w.home, "ws", "other"));
  assert.deepEqual(fileLines[0].add, [path.join(other, "far.md")]);
  assert.deepEqual(fileLines[1].add.slice().sort(), [path.join(other, "a.png"), path.join(other, "b.png")]);
  fileLines.forEach((l) => assert.equal(l.site, undefined, "an older reader keeps only lines whose site is a full entry"));
  lines.filter((l) => l.event !== "mount-files").forEach((l) => assert.equal("mount_files" in l.site, false, l.event));
  const site = w.helper.sites.get(w.name);
  assert.deepEqual(site.mount_files.slice().sort(), [path.join(other, "a.png"), path.join(other, "b.png"), path.join(other, "far.md")]);
});

// --- V18: one spelling for every path ---------------------------------------------

function caseInsensitive() {
  const dir = tempRoot("lahe-case-probe-");
  fs.writeFileSync(path.join(dir, "probe.txt"), "x");
  return fs.existsSync(path.join(dir, "PROBE.txt"));
}

test("V18: a link spelled Todo.md to the file todo.md is listed as todo.md and answers 200, and an old linked_files key spelled Todo.md still lets the page be served", { skip: caseInsensitive() ? false : "this disk is case-sensitive, so one file has one spelling" }, async (t) => {
  const w = await hubWorld(t, "# Hub\n\n[todo](../../other/Todo.md)\n", (x) => {
    writeFile(path.join(x.home, "ws", "other"), "todo.md", "# Todo\n\ntodo words\n");
  });
  const other = real(path.join(w.home, "ws", "other"));
  const prefix = mountOf(w.hub.text, "todo.md");
  assert.deepEqual(w.helper.sites.get(w.name).mount_files, [path.join(other, "todo.md")]);
  assert.equal((await getPage(w, w.name, prefix + "todo.md")).status, 200);
  assert.equal((await getPage(w, w.name, prefix + "Todo.md")).status, 200, "the browser's own spelling works too");

  writeFile(path.join(w.home, "ws", "other"), "second.md", "# Second\n");
  w.helper.sites.addLinked(w.name, "r-old", [path.join(other, "Second.md")]);
  assert.equal((await getPage(w, w.name, prefix + "second.md")).status, 200, "an old key in a link's spelling matches");
});
