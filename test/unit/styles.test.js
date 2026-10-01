// Installed document styles: the id rule, the stylesheet rule, the metadata
// rule, reading a style folder, installing it, and the installed list.
//
// The stylesheet rule is the security boundary of the style switcher. A style
// is third-party CSS on a page whose script line carries a review token, and
// CSS can read attribute values through selectors and report them through any
// fetch. So a sheet may reach its own fonts and inline images and nothing else,
// and the check is a CSS Syntax Level 3 tokenizer rather than a scan, because
// every place a scan and a browser disagree is a way past it. Each refusal
// test below is one of those disagreements.
//
// Plan rows V1 to V4 and V22 (service half), in
// docs/features/20260930.01_style_switcher/03_plan_style_switcher.md.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const styles = require("../../src/service/styles.js");
const stateDirModule = require("../../src/service/state_dir.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");
const FONTS = ["sample-face.woff2"];

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A fresh state directory outside any checkout. */
function tempState() {
  return path.join(tempDir("lahe-styles-state-"), "state");
}

/** A copy of a fixture style in a temp folder, named `name`, for a test to change. */
function copyFixture(fixture, name) {
  const parent = tempDir("lahe-styles-src-");
  const target = path.join(parent, name || fixture);
  fs.cpSync(path.join(FIXTURES, fixture), target, { recursive: true });
  return target;
}

function sheet(css, fonts) {
  return styles.checkStylesheet(css, { fonts: fonts || FONTS });
}

function assertRefused(result, pattern, label) {
  assert.equal(result.ok, false, (label || "") + " should be refused");
  assert.match(result.reason, pattern, label);
}

// ---------------------------------------------------------------------------
// The id rule
// ---------------------------------------------------------------------------

test("a style id is lowercase letters, digits and hyphens, starting with a letter or digit, at most 40", () => {
  for (const good of ["sample", "sample-dark", "a", "0", "field-guide", "x".repeat(40)]) {
    assert.equal(styles.isStyleId(good), true, good);
  }
  for (const bad of ["", "-lead", "Upper", "has space", "under_score", "dot.ted", "x".repeat(41), "../up", "a/b", null, 3, "é"]) {
    assert.equal(styles.isStyleId(bad), false, JSON.stringify(bad));
  }
});

test("the id comes from the folder name: lowercased, spaces and underscores become hyphens", () => {
  assert.equal(styles.idFromFolderName("Field Guide"), "field-guide");
  assert.equal(styles.idFromFolderName("field_guide"), "field-guide");
  assert.equal(styles.idFromFolderName("Textbook"), "textbook");
  assert.equal(styles.idFromFolderName("bad.name"), null);
  assert.equal(styles.idFromFolderName("-lead"), null);
});

// ---------------------------------------------------------------------------
// The stylesheet rule: what passes
// ---------------------------------------------------------------------------

test("the fixture's own stylesheet passes", () => {
  const css = fs.readFileSync(path.join(FIXTURES, "sample", "style.css"), "utf8");
  assert.deepEqual(sheet(css), { ok: true });
});

test("a font url in each allowed spelling passes when the folder has the file", () => {
  for (const css of [
    '@font-face{src:url("./fonts/sample-face.woff2") format("woff2")}',
    "@font-face{src:url('fonts/sample-face.woff2')}",
    "@font-face{src:url(./fonts/sample-face.woff2)}",
    "@font-face{src:url(  fonts/sample-face.woff2  )}",
    '@font-face{src:URL("./fonts/sample-face.woff2")}'
  ]) {
    assert.deepEqual(sheet(css), { ok: true }, css);
  }
});

test("V3: a custom property string continued over lines with a backslash passes", () => {
  const css = ':root{--families:"one: first \\\n    | two: second \\\n    | three";}\nbody{color:red}';
  assert.deepEqual(sheet(css), { ok: true });
});

test("V3: a data: SVG whose markup names an http:// namespace passes", () => {
  const css = ":root{--tile:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M24 .5H.5V24' fill='none' stroke='white'/%3E%3C/svg%3E\");}";
  assert.deepEqual(sheet(css), { ok: true });
});

test("an escape inside a string passes: it is data, never a fetch", () => {
  assert.deepEqual(sheet('h2::before{content:"\\00A7\\00A0" counter(entry)}'), { ok: true });
});

test("comments may say anything, including url(), @import and a backslash", () => {
  const css = "/* url(\"https://example.com/x.css\") @import \"a.css\"; \\ image-set(\"x\") */ body{color:red}";
  assert.deepEqual(sheet(css), { ok: true });
});

test("allowed data: types pass: svg, png and woff2", () => {
  for (const css of [
    "a{background:url(data:image/png;base64,iVBORw0KGgo=)}",
    "@font-face{src:url(\"data:font/woff2;base64,d09GMgABAAAAAA==\")}",
    "a{background:url(\"data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E\")}"
  ]) {
    assert.deepEqual(sheet(css), { ok: true }, css);
  }
});

test("a name that merely contains url or src is not those functions", () => {
  assert.deepEqual(sheet("a{--myurl:1; background:my-url-thing; x:srcset}"), { ok: true });
  assert.deepEqual(sheet("@font-face{src: local(\"Arial\")}"), { ok: true }, "src: is a descriptor, not src()");
});

// ---------------------------------------------------------------------------
// The stylesheet rule: what is refused (V2)
// ---------------------------------------------------------------------------

test("V2: @import is refused, in any case", () => {
  assertRefused(sheet('@import "other.css";'), /@import/i, "@import");
  assertRefused(sheet('@IMPORT url("fonts/sample-face.woff2");'), /@import/i, "@IMPORT");
  assertRefused(sheet("@-webkit-import 'x';"), /@import/i, "a prefixed @import");
});

test("V2: an http url() is refused, in any case", () => {
  assertRefused(sheet('a{background:url("http://example.com/x.png")}'), /url\(/i, "http url");
  assertRefused(sheet("a{background:URL(https://example.com/x.png)}"), /url\(/i, "URL()");
  assertRefused(sheet("a{background:url(//example.com/x.png)}"), /url\(/i, "protocol-relative");
  assertRefused(sheet("a{background:url(/x.png)}"), /url\(/i, "root-relative");
  assertRefused(sheet("a{background:url(../x.png)}"), /url\(/i, "above the folder");
  assertRefused(sheet('a{background:url("fonts/../../x.woff2")}'), /url\(/i, "traversal through fonts");
});

test("V2: a string broken by a newline does not hide a url() after it", () => {
  // A browser ends the string at the newline and reads what follows as CSS,
  // so the url() is live. A scan that runs to the next quote misses it.
  const css = 'a{content:"broken\n; background:url(http://example.com/x) ;"}';
  assertRefused(sheet(css), /url\(/i);
});

test("V2: /* inside a string does not open a comment that hides a url()", () => {
  const css = 'a{content:"/*"; background:url(http://example.com/x); --b:"*/"}';
  assertRefused(sheet(css), /url\(/i);
});

test("V2: a backslash escape outside a string is refused", () => {
  assertRefused(sheet("a{background:u\\72l(http://example.com/x)}"), /backslash/i, "escaped url");
  assertRefused(sheet("a{color:red}\\"), /backslash/i, "a lone backslash");
});

test("V2: every function that fetches by string is refused", () => {
  for (const fn of ["image-set", "-webkit-image-set", "image", "cross-fade", "src", "element", "IMAGE-SET"]) {
    assertRefused(sheet("a{background:" + fn + '("x.png" 1x)}'), /fetch|not allowed/i, fn);
  }
});

test("V2: a data: type outside the three allowed is refused", () => {
  assertRefused(sheet("a{background:url(data:text/html,<p>hi</p>)}"), /data:/i, "text/html");
  assertRefused(sheet('a{background:url("data:image/jpeg;base64,AAAA")}'), /data:/i, "jpeg");
  assertRefused(sheet('a{background:url("data:image/svg+xml;foo=bar,%3Csvg/%3E")}'), /data:/i, "an unknown parameter");
});

test("V2: a data: SVG holding href, url( or @import is refused, percent-encoded or base64", () => {
  const withHref = "%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cimage href='http://example.com/x.png'/%3E%3C/svg%3E";
  assertRefused(sheet('a{background:url("data:image/svg+xml,' + withHref + '")}'), /href/i, "href");
  const encodedHref = "%3Csvg%3E%3Cuse %68ref='http://example.com/#a'/%3E%3C/svg%3E";
  assertRefused(sheet('a{background:url("data:image/svg+xml,' + encodedHref + '")}'), /href/i, "percent-encoded href");
  const withUrl = "%3Csvg%3E%3Crect fill='url(http://example.com/p)'/%3E%3C/svg%3E";
  assertRefused(sheet('a{mask:url("data:image/svg+xml,' + withUrl + '")}'), /url\(/i, "url(");
  const withImport = "%3Csvg%3E%3Cstyle%3E@IMPORT 'http://example.com/x.css';%3C/style%3E%3C/svg%3E";
  assertRefused(sheet('a{mask:url("data:image/svg+xml,' + withImport + '")}'), /@import/i, "@import");
  const b64 = Buffer.from("<svg><image href='http://example.com/x.png'/></svg>").toString("base64");
  assertRefused(sheet('a{mask:url("data:image/svg+xml;base64,' + b64 + '")}'), /href/i, "base64 href");
});

test("a data: SVG that spells a fetch through an XML entity or a CSS escape is refused", () => {
  const entity = "%3Csvg%3E%3Crect fill='u%26%23114;l(http://example.com/p)'/%3E%3C/svg%3E";
  assertRefused(sheet('a{mask:url("data:image/svg+xml,' + entity + '")}'), /entity|&/i, "entity");
  const escaped = "%3Csvg%3E%3Cstyle%3Erect{fill:u%5C72l(http://example.com/p)}%3C/style%3E%3C/svg%3E";
  assertRefused(sheet('a{mask:url("data:image/svg+xml,' + escaped + '")}'), /backslash/i, "css escape");
});

test("an escape inside a url() argument is refused, quoted or not", () => {
  assertRefused(sheet('a{background:url("\\68ttp://example.com/x")}'), /backslash|escape/i, "quoted");
  assertRefused(sheet('@font-face{src:url("./fonts/sample-face\\2ewoff2")}'), /backslash|escape/i, "in a font name");
});

test("a url() with anything after its string, or a malformed unquoted url, is refused", () => {
  assertRefused(sheet('a{background:url("fonts/sample-face.woff2" x)}'), /url\(/i, "a modifier");
  assertRefused(sheet("a{background:url(fonts/sample-face.woff2 x)}"), /url\(/i, "space inside");
  assertRefused(sheet("a{background:url(fonts/sam'ple.woff2)}"), /url\(/i, "a quote inside");
});

test("V2: a font the folder lacks is refused", () => {
  assertRefused(sheet('@font-face{src:url("./fonts/missing.woff2")}'), /missing\.woff2/, "missing font");
});

test("V2: a font that is not woff2 is refused", () => {
  assertRefused(sheet('@font-face{src:url("./fonts/sample-face.ttf")}', ["sample-face.ttf"]), /woff2/, "ttf");
});

test("a refusal names what to fix, and never echoes a control character to the terminal", () => {
  const result = sheet('a{background:url("http://example.com/\u001b[31mred")}');
  assert.equal(result.ok, false);
  assert.equal(/[\u0000-\u001f\u007f]/.test(result.reason), false, JSON.stringify(result.reason));
});

// ---------------------------------------------------------------------------
// The metadata rule
// ---------------------------------------------------------------------------

test("the fixture's metadata passes, and only the fields Lahe uses come back", () => {
  const parsed = JSON.parse(fs.readFileSync(path.join(FIXTURES, "sample", "metadata.json"), "utf8"));
  const result = styles.checkMetadata(parsed);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.metadata, {
    name: "Sample",
    description: parsed.description,
    version: "1.0.0",
    palette: ["#fbf3e4", "#2b1d0e", "#1f6b3a"]
  });
});

test("a name may hold letters, digits, spaces, hyphens, apostrophes and ampersands", () => {
  for (const name of ["Field Guide", "Ken's Style", "Rock & Roll", "Style-2", "A"]) {
    assert.equal(styles.checkMetadata({ name }).ok, true, name);
  }
});

test("V2: metadata refusals each carry their own reason", () => {
  assertRefused(styles.checkMetadata({}), /name/, "no name");
  assertRefused(styles.checkMetadata({ name: "" }), /name/, "empty name");
  assertRefused(styles.checkMetadata({ name: "Use it. Now!" }), /name/, "other punctuation");
  assertRefused(styles.checkMetadata({ name: "Say (lahe-style: x)" }), /name/, "parentheses and a colon");
  assertRefused(styles.checkMetadata({ name: "x".repeat(41) }), /name/, "too long");
  assertRefused(styles.checkMetadata({ name: "Bell\u0007" }), /control|name/, "a control character in the name");
  assertRefused(styles.checkMetadata({ name: "Sample", description: "Nice\u202eevil" }), /control|bidi/i, "a bidi override");
  assertRefused(styles.checkMetadata({ name: "Sample", concept: "line\u2066x" }), /control|bidi/i, "a bidi isolate anywhere");
  assertRefused(styles.checkMetadata({ name: "Sample", description: "x".repeat(301) }), /description/, "a long description");
  assertRefused(styles.checkMetadata({ name: "Sample", version: "1.0 beta" }), /version/, "a bad version");
  assertRefused(styles.checkMetadata({ name: "Sample", version: "1".repeat(21) }), /version/, "a long version");
  assertRefused(styles.checkMetadata({ name: "Sample", palette: [{ value: "red" }] }), /palette/, "a non-hex colour");
  assertRefused(styles.checkMetadata({ name: "Sample", palette: [{ value: "#12345" }] }), /palette/, "a five-digit hex");
  assertRefused(styles.checkMetadata({ name: "Sample", palette: "x" }), /palette/, "a palette that is not a list");
  assertRefused(styles.checkMetadata([]), /object/, "not an object");
});

test("only the first six palette colours are used", () => {
  const palette = ["#111", "#2222", "#333333", "#44444444", "#555", "#666", "#777"].map((value) => ({ value }));
  const result = styles.checkMetadata({ name: "Sample", palette });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.metadata.palette, ["#111", "#2222", "#333333", "#44444444", "#555", "#666"]);
});

// ---------------------------------------------------------------------------
// Reading a style folder (install side)
// ---------------------------------------------------------------------------

test("V1: the fixture reads as a style: only the allowed files, the id from the folder name", () => {
  const folder = copyFixture("sample", "Sample");
  // Files a real style folder carries that are not for a page.
  fs.mkdirSync(path.join(folder, "html"));
  fs.writeFileSync(path.join(folder, "html", "specimen.html"), "<p>x</p>");
  fs.mkdirSync(path.join(folder, "scripts"));
  fs.writeFileSync(path.join(folder, "scripts", "build.py"), "print(1)");
  fs.writeFileSync(path.join(folder, "fonts", "LICENSE"), "OFL");
  fs.writeFileSync(path.join(folder, ".DS_Store"), "x");
  fs.writeFileSync(path.join(folder, "fonts", ".DS_Store"), "x");

  const result = styles.readStyleFolder(folder);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.id, "sample");
  assert.equal(result.metadata.name, "Sample");
  assert.deepEqual(result.files.map((f) => f.rel).sort(), [
    "DESIGN.md",
    "LICENSE",
    "fonts/LICENSE",
    "fonts/sample-face.woff2",
    "metadata.json",
    "style.css"
  ]);
});

test("V2: folder refusals each carry their own reason", () => {
  const noSheet = copyFixture("sample");
  fs.renameSync(path.join(noSheet, "style.css"), path.join(noSheet, "styles.css"));
  assertRefused(styles.readStyleFolder(noSheet), /style\.css/, "no style.css");

  const noMeta = copyFixture("sample");
  fs.renameSync(path.join(noMeta, "metadata.json"), path.join(noMeta, "meta.json"));
  assertRefused(styles.readStyleFolder(noMeta), /metadata\.json/, "no metadata.json");

  const badJson = copyFixture("sample");
  fs.writeFileSync(path.join(badJson, "metadata.json"), "{ nope");
  assertRefused(styles.readStyleFolder(badJson), /metadata\.json/, "metadata that is not JSON");

  const badId = copyFixture("sample", "bad.name");
  assertRefused(styles.readStyleFolder(badId), /id|name/i, "a folder name that makes no id");

  const reserved = copyFixture("sample", "international");
  assertRefused(styles.readStyleFolder(reserved), /International/, "the reserved id");

  const reservedCase = copyFixture("sample", "International");
  assertRefused(styles.readStyleFolder(reservedCase), /International/, "the reserved id in capitals");

  const badSheet = copyFixture("sample");
  fs.appendFileSync(path.join(badSheet, "style.css"), '\na{background:url("https://example.com/x")}\n');
  assertRefused(styles.readStyleFolder(badSheet), /url\(/, "a sheet that fetches");

  const ttf = copyFixture("sample");
  fs.writeFileSync(path.join(ttf, "fonts", "other.ttf"), "x");
  assertRefused(styles.readStyleFolder(ttf), /woff2/, "a font that is not woff2");

  const badFontName = copyFixture("sample");
  fs.writeFileSync(path.join(badFontName, "fonts", "Upper Case.woff2"), "x");
  assertRefused(styles.readStyleFolder(badFontName), /font/i, "a font name outside the pattern");
});

test("V2: a symlink at any level is refused", () => {
  const outside = path.join(tempDir("lahe-styles-outside-"), "secret.css");
  fs.writeFileSync(outside, "body{color:red}");

  const sheetLink = copyFixture("sample");
  fs.rmSync(path.join(sheetLink, "style.css"));
  fs.symlinkSync(outside, path.join(sheetLink, "style.css"));
  assertRefused(styles.readStyleFolder(sheetLink), /symlink/, "style.css");

  const metaLink = copyFixture("sample");
  const realMeta = path.join(tempDir("lahe-styles-meta-"), "metadata.json");
  fs.copyFileSync(path.join(metaLink, "metadata.json"), realMeta);
  fs.rmSync(path.join(metaLink, "metadata.json"));
  fs.symlinkSync(realMeta, path.join(metaLink, "metadata.json"));
  assertRefused(styles.readStyleFolder(metaLink), /symlink/, "metadata.json");

  const fontLink = copyFixture("sample");
  const realFont = path.join(tempDir("lahe-styles-font-"), "sample-face.woff2");
  fs.copyFileSync(path.join(fontLink, "fonts", "sample-face.woff2"), realFont);
  fs.rmSync(path.join(fontLink, "fonts", "sample-face.woff2"));
  fs.symlinkSync(realFont, path.join(fontLink, "fonts", "sample-face.woff2"));
  assertRefused(styles.readStyleFolder(fontLink), /symlink/, "a font");

  const fontsDirLink = copyFixture("sample");
  const realFonts = tempDir("lahe-styles-fonts-");
  fs.cpSync(path.join(fontsDirLink, "fonts"), realFonts, { recursive: true });
  fs.rmSync(path.join(fontsDirLink, "fonts"), { recursive: true });
  fs.symlinkSync(realFonts, path.join(fontsDirLink, "fonts"));
  assertRefused(styles.readStyleFolder(fontsDirLink), /symlink/, "the fonts folder");

  const designLink = copyFixture("sample");
  fs.rmSync(path.join(designLink, "DESIGN.md"));
  fs.symlinkSync(outside, path.join(designLink, "DESIGN.md"));
  assertRefused(styles.readStyleFolder(designLink), /symlink/, "DESIGN.md");

  const real = copyFixture("sample");
  const folderLink = path.join(tempDir("lahe-styles-link-"), "sample");
  fs.symlinkSync(real, folderLink);
  assertRefused(styles.readStyleFolder(folderLink), /symlink/, "the style folder itself");
});

test("V2: each size cap is refused", () => {
  const bigSheet = copyFixture("sample");
  fs.appendFileSync(path.join(bigSheet, "style.css"), "/*" + "x".repeat(styles.LIMITS.sheetBytes) + "*/");
  assertRefused(styles.readStyleFolder(bigSheet), /style\.css.*(large|MB|bytes)/i, "style.css over 1 MB");

  const bigMeta = copyFixture("sample");
  const meta = JSON.parse(fs.readFileSync(path.join(bigMeta, "metadata.json"), "utf8"));
  meta.concept = "x".repeat(styles.LIMITS.metadataBytes);
  fs.writeFileSync(path.join(bigMeta, "metadata.json"), JSON.stringify(meta));
  assertRefused(styles.readStyleFolder(bigMeta), /metadata\.json.*(large|KB|bytes)/i, "metadata over 64 KB");

  const bigFont = copyFixture("sample");
  fs.writeFileSync(path.join(bigFont, "fonts", "big.woff2"), Buffer.alloc(styles.LIMITS.fontBytes + 1));
  assertRefused(styles.readStyleFolder(bigFont), /big\.woff2.*(large|MB|bytes)/i, "a font over 2 MB");

  const manyFonts = copyFixture("sample");
  for (let i = 0; i < styles.LIMITS.fontCount; i += 1) {
    fs.writeFileSync(path.join(manyFonts, "fonts", "extra-" + i + ".woff2"), "x");
  }
  assertRefused(styles.readStyleFolder(manyFonts), /fonts/i, "more than 16 fonts");
});

// ---------------------------------------------------------------------------
// Installing, and the installed list
// ---------------------------------------------------------------------------

test("V1: install copies only the allowed files into the styles folder, owner-only", () => {
  const state = tempState();
  const folder = copyFixture("sample");
  fs.mkdirSync(path.join(folder, "screenshots"));
  fs.writeFileSync(path.join(folder, "screenshots", "a.png"), "x");

  const result = styles.install(state, folder);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.id, "sample");
  assert.equal(result.name, "Sample");
  assert.equal(result.replaced, false);

  const root = stateDirModule.stylesRoot(state);
  const installed = path.join(root, "sample");
  const walk = (dir, prefix) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name), prefix + entry.name + "/") : [prefix + entry.name]);
  assert.deepEqual(walk(installed, "").sort(), ["DESIGN.md", "LICENSE", "fonts/sample-face.woff2", "metadata.json", "style.css"]);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(installed).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(installed, "style.css")).mode & 0o777, 0o600);
  assert.deepEqual(
    fs.readFileSync(path.join(installed, "style.css")),
    fs.readFileSync(path.join(FIXTURES, "sample", "style.css")),
    "the same bytes that were checked"
  );
});

test("V22: the installed list is built from checked metadata, and leaves out a hand-copied folder that breaks the rules", () => {
  const state = tempState();
  assert.equal(styles.install(state, copyFixture("sample")).ok, true);
  assert.equal(styles.install(state, copyFixture("sample-dark")).ok, true);
  const root = stateDirModule.stylesRoot(state);

  // Hand-copied folders, never through install.
  const badMeta = path.join(root, "bad-meta");
  fs.cpSync(path.join(FIXTURES, "sample"), badMeta, { recursive: true });
  fs.writeFileSync(path.join(badMeta, "metadata.json"), JSON.stringify({ name: "<img src=x onerror=alert(1)>" }));
  const badSheet = path.join(root, "bad-sheet");
  fs.cpSync(path.join(FIXTURES, "sample"), badSheet, { recursive: true });
  fs.appendFileSync(path.join(badSheet, "style.css"), "\na{background:url(https://example.com/x)}");
  const badId = path.join(root, "Bad_Id");
  fs.cpSync(path.join(FIXTURES, "sample"), badId, { recursive: true });
  // A temp folder an install in flight leaves behind is never a style.
  fs.mkdirSync(path.join(root, ".sample.new-123"));

  const index = styles.index(state);
  assert.deepEqual(index.styles.map((s) => s.id), ["sample", "sample-dark"]);
  assert.deepEqual(index.styles[0], {
    id: "sample",
    name: "Sample",
    description: "A made-up style for the test suite: a cream page, dark brown ink, a green accent and one made-up face.",
    palette: ["#fbf3e4", "#2b1d0e", "#1f6b3a"]
  });

  const listed = styles.list(state);
  const byId = Object.fromEntries(listed.map((entry) => [entry.id, entry]));
  assert.equal(byId.sample.ok, true);
  assert.equal(byId["bad-meta"].ok, false);
  assert.match(byId["bad-meta"].reason, /name/);
  assert.equal(byId["bad-sheet"].ok, false);
  assert.match(byId["bad-sheet"].reason, /url\(/);
  assert.equal(byId.Bad_Id, undefined, "a folder whose name is not an id is not listed at all");
});

test("the list is sorted by name, and an empty or missing styles folder lists nothing", () => {
  const state = tempState();
  assert.deepEqual(styles.index(state), { styles: [] });
  assert.deepEqual(styles.list(state), []);
});

test("install refuses the reserved id before touching the state directory", () => {
  const state = tempState();
  const result = styles.install(state, copyFixture("sample", "international"));
  assert.equal(result.ok, false);
  assert.match(result.reason, /International/);
});
