#!/usr/bin/env node
// Builds docs/tests/index.html: a reading page that describes and lists every
// test in the suite.
//
// Every number on the page comes from this script. Nothing is typed by hand.
// It walks test/unit and test/browser, and for each file it pulls out:
//
//   - the file's purpose (the first paragraph of its leading comment block)
//   - every describe / test.describe title
//   - every test(...) / it(...) title, with its line number and status
//
// Status is one of: runs, todo (declared with a { todo: "..." } option), or
// skipped (declared with test.skip("title") or an { skip: ... } option).
// A runtime guard such as test.skip(condition, "reason") inside a test body is
// NOT a skipped test: it is a test that decides at run time, and the script
// counts those separately so the page can say so.
//
// Core Node modules only. The repo ships with zero runtime dependencies and
// this script honors that even though it is a dev tool.
//
// Run: npm run docs:tests

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO_ROOT, "docs", "tests", "index.html");
const SCRIPT_NAME = "scripts/test_index.js";

// ---------------------------------------------------------------------------
// Reading the test files
// ---------------------------------------------------------------------------

// The first paragraph of the leading comment block, as plain text. Leading
// blank lines are allowed; the block ends at the first line that is not a
// `//` comment, and the paragraph ends at the first empty comment line.
function leadingPurpose(lines) {
  const collected = [];
  let started = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!started && line === "") continue;
    if (!started && /^["']use strict["'];?$/.test(line)) continue;
    if (line.indexOf("//") !== 0) break;
    started = true;
    const text = line.slice(2).trim();
    if (text === "") {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(text);
  }
  return collected.join(" ").trim();
}

// Pull the first string literal out of a chunk of source starting at `from`.
// Handles single quotes, double quotes, backticks, and backslash escapes.
function firstStringLiteral(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let out = "";
  i += 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === "n") out += " ";
      else if (next === "t") out += " ";
      else out += next;
      i += 2;
      continue;
    }
    if (ch === quote) return { text: out.replace(/\s+/g, " ").trim(), end: i + 1 };
    out += ch;
    i += 1;
  }
  return null;
}

// What follows the title: the option object, if there is one. We only need to
// know whether it declares todo or skip.
function statusFromOptions(source, afterTitle) {
  let i = afterTitle;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== ",") return "runs";
  i += 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== "{") return "runs";
  // Read to the matching close brace, shallowly. Option objects here are flat.
  let depth = 0;
  let body = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    body += ch;
    i += 1;
  }
  if (/\btodo\s*:/.test(body)) return "todo";
  if (/\bskip\s*:/.test(body)) return "skipped";
  return "runs";
}

const CALL_RE = /(^|[^\w.$])(test|it|describe)((?:\.(?:describe|skip|only|todo|fixme|serial|parallel|configure))*)\s*\(/g;

function readTestFile(absPath, relPath) {
  const source = fs.readFileSync(absPath, "utf8");
  const lines = source.split("\n");

  // Line number for any character offset.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  function lineOf(offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  const tests = [];
  const describes = [];
  let runtimeGuards = 0;

  CALL_RE.lastIndex = 0;
  let match;
  while ((match = CALL_RE.exec(source)) !== null) {
    const base = match[2];
    const chain = match[3] || "";
    const openParen = match.index + match[0].length;
    const line = lineOf(match.index);
    const indent = (lines[line - 1] || "").match(/^\s*/)[0].length;

    if (chain.indexOf(".configure") !== -1) continue;

    const isDescribe = base === "describe" || chain.indexOf(".describe") !== -1;
    const literal = firstStringLiteral(source, openParen);

    if (isDescribe) {
      if (literal) describes.push({ title: literal.text, line: line, indent: indent });
      continue;
    }

    // test(...) / it(...)
    if (!literal) {
      // `test.skip(condition, "reason")` inside a body: a run-time decision,
      // not a declared skip.
      if (chain.indexOf(".skip") !== -1) runtimeGuards += 1;
      continue;
    }

    let status = "runs";
    if (chain.indexOf(".todo") !== -1) status = "todo";
    else if (chain.indexOf(".skip") !== -1 || chain.indexOf(".fixme") !== -1) status = "skipped";
    else status = statusFromOptions(source, literal.end);

    tests.push({ title: literal.text, line: line, indent: indent, status: status });
  }

  // A test belongs to the nearest preceding describe that is less indented.
  tests.forEach(function (t) {
    let owner = "";
    for (let i = describes.length - 1; i >= 0; i -= 1) {
      const d = describes[i];
      if (d.line < t.line && d.indent < t.indent) {
        owner = d.title;
        break;
      }
    }
    t.describe = owner;
  });

  tests.sort(function (a, b) {
    return a.line - b.line;
  });

  return {
    file: relPath,
    name: path.basename(relPath),
    purpose: leadingPurpose(lines),
    tests: tests,
    describes: describes,
    runtimeGuards: runtimeGuards
  };
}

function readLane(dirRel, suffix) {
  const dir = path.join(REPO_ROOT, dirRel);
  const names = fs
    .readdirSync(dir)
    .filter(function (n) {
      return n.endsWith(suffix);
    })
    .sort();
  return names.map(function (n) {
    return readTestFile(path.join(dir, n), dirRel + "/" + n);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The fixture table in test/helpers/README.md, parsed out of the markdown so
// the roles on the page are the roles the harness doc states.
function fixtureRoles() {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "test", "helpers", "README.md"), "utf8");
  const roles = {};
  readme.split("\n").forEach(function (line) {
    const m = line.match(/^\|\s*`([^`]+\.(?:html|js|txt))`\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) return;
    if (roles[m[1]]) return;
    let role = m[2].replace(/`/g, "");
    const stop = role.indexOf(". ");
    if (stop > 40) role = role.slice(0, stop + 1);
    roles[m[1]] = role;
  });
  return roles;
}

function readFixtures() {
  const dir = path.join(REPO_ROOT, "test", "fixtures");
  const roles = fixtureRoles();
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort(function (a, b) {
      return a.name < b.name ? -1 : 1;
    })
    .map(function (entry) {
      return {
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : "file",
        role: roles[entry.name] || ""
      };
    });
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

const GATE_AUDIENCE = {
  "gate:builder": "A builder, on every loop. No check:layer, because builders never commit dist/.",
  gate: "The orchestrator, at a checkpoint, after rebuilding dist/.",
  "gate:all": "The orchestrator, at a checkpoint. The three-browser run."
};

const SCRIPT_MEANING = {
  lint: "node --check over every tracked .js file, plus no jsdom, plus manifest completeness",
  "check:layer": "fails when the committed bundle dist/lahe-layer.js is stale",
  "test:unit": "node --test over test/unit",
  "test:browser": "Playwright, Chromium only",
  "test:browser:all": "Playwright, Chromium and Firefox and WebKit"
};

function readGates(pkg) {
  return ["gate:builder", "gate", "gate:all"].map(function (name) {
    const raw = pkg.scripts[name] || "";
    const steps = raw
      .split("&&")
      .map(function (s) {
        return s.trim().replace(/^npm run /, "");
      })
      .filter(Boolean);
    return {
      name: name,
      steps: steps,
      detail: steps
        .map(function (s) {
          return SCRIPT_MEANING[s] ? s + " (" + SCRIPT_MEANING[s] + ")" : s;
        })
        .join("; "),
      audience: GATE_AUDIENCE[name] || ""
    };
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function anchorFor(relPath) {
  return relPath.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function countTests(files) {
  return files.reduce(function (n, f) {
    return n + f.tests.length;
  }, 0);
}

function countStatus(files, status) {
  return files.reduce(function (n, f) {
    return (
      n +
      f.tests.filter(function (t) {
        return t.status === status;
      }).length
    );
  }, 0);
}

// Hanken Grotesk and Schibsted Grotesk are the brand faces. This page loads no
// web fonts (it has to render with no network at all), so both stacks name the
// brand face first and fall back to the system UI sans, which is the closest
// grotesk a machine already has.
const CSS = `
:root {
  --ink: #1f1e1a;
  --ink-faint: #6b6860;
  --white: #ffffff;
  --purple: #46188c;
  --cobalt: #0760c7;
  --cobalt-tint: #e6effc;
  --sage: #8fb5a0;
  --rule: #d8d6d0;
  --head: "Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --body: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--white);
  color: var(--ink);
  font-family: var(--body);
  font-size: 17px;
  line-height: 1.6;
}
.page { max-width: 1024px; margin: 0 auto; padding: 44px 44px 96px; }
h1, h2, h3 { font-family: var(--head); font-weight: 700; line-height: 1.2; }
h1 { font-size: 40px; margin: 0 0 8px; }
h2 { font-size: 27px; margin: 72px 0 12px; padding-top: 24px; border-top: 1px solid var(--ink); }
h3 { font-size: 18px; font-weight: 600; margin: 40px 0 6px; }
h2:first-of-type { border-top: none; padding-top: 0; }
p { max-width: 66ch; margin: 0 0 16px; }
.lede { font-size: 19px; }
.meta { color: var(--ink-faint); font-size: 15px; max-width: 66ch; }
a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
a.up { color: var(--purple); }
ul { max-width: 66ch; padding-left: 20px; list-style: none; margin: 0 0 16px; }
ul li { position: relative; margin: 0 0 8px; }
ul li::before {
  content: "";
  position: absolute;
  left: -18px;
  top: 0.62em;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sage);
}
code, .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
  background: var(--cobalt-tint);
  padding: 1px 5px;
}
pre {
  background: var(--cobalt-tint);
  border: 1px solid var(--cobalt);
  padding: 12px 14px;
  overflow-x: auto;
  max-width: 66ch;
  font-size: 15px;
}
pre code { background: none; padding: 0; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 24px;
  font-size: 15px;
}
th, td {
  border: 1px solid var(--ink);
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
}
th { background: var(--cobalt-tint); font-family: var(--head); font-weight: 600; }
td.num { width: 62px; color: var(--ink-faint); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
td.grp { width: 22%; color: var(--ink-faint); }
td.st { width: 96px; }
td.st.todo, td.st.skipped { color: var(--purple); font-weight: 600; }
.file-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.file-head .count { font-family: var(--body); font-weight: 400; font-size: 15px; color: var(--ink-faint); }
.toc { column-width: 240px; column-gap: 32px; max-width: 100%; }
.toc ul { max-width: none; }
.toc li { break-inside: avoid; font-size: 15px; }
.narrow { max-width: 66ch; }
table.narrow { max-width: 66ch; }
@media print { .page { padding: 0; } h2 { break-before: auto; } }
`;

function statusLabel(s) {
  if (s === "todo") return "todo";
  if (s === "skipped") return "skipped";
  return "runs";
}

function fileSection(f) {
  const id = anchorFor(f.file);
  const rows = f.tests
    .map(function (t) {
      return (
        "<tr><td class=\"num\">" +
        t.line +
        "</td><td class=\"grp\">" +
        esc(t.describe || "") +
        "</td><td>" +
        esc(t.title) +
        "</td><td class=\"st " +
        t.status +
        "\">" +
        statusLabel(t.status) +
        "</td></tr>"
      );
    })
    .join("\n");

  const purpose = f.purpose
    ? "<p>" + esc(f.purpose) + "</p>"
    : "<p class=\"meta\">This file carries no leading comment, so it states no purpose of its own.</p>";

  const guard = f.runtimeGuards
    ? "<p class=\"meta\">" +
      f.runtimeGuards +
      (f.runtimeGuards === 1 ? " test decides" : " tests decide") +
      " at run time whether to skip, based on what the browser does.</p>"
    : "";

  return (
    "<h3 id=\"" +
    id +
    "\"><span class=\"file-head\"><span>" +
    esc(f.name) +
    "</span> <span class=\"count\">" +
    f.tests.length +
    (f.tests.length === 1 ? " test" : " tests") +
    "</span></span></h3>\n" +
    purpose +
    guard +
    (f.tests.length
      ? "<table><thead><tr><th>Line</th><th>Group</th><th>Test</th><th>Status</th></tr></thead><tbody>\n" +
        rows +
        "\n</tbody></table>"
      : "<p class=\"meta\">No tests found in this file.</p>")
  );
}

function tocFor(files) {
  return (
    "<div class=\"toc\"><ul>" +
    files
      .map(function (f) {
        return (
          "<li><a class=\"up\" href=\"#" +
          anchorFor(f.file) +
          "\">" +
          esc(f.name) +
          "</a> <span class=\"meta\">" +
          f.tests.length +
          "</span></li>"
        );
      })
      .join("") +
    "</ul></div>"
  );
}

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const unit = readLane("test/unit", ".test.js");
  const browser = readLane("test/browser", ".spec.js");
  const fixtures = readFixtures();
  const gates = readGates(pkg);

  const all = unit.concat(browser);
  const totals = {
    unitFiles: unit.length,
    unitTests: countTests(unit),
    browserFiles: browser.length,
    browserTests: countTests(browser),
    total: countTests(all),
    skipped: countStatus(all, "skipped"),
    todo: countStatus(all, "todo"),
    runtimeGuards: all.reduce(function (n, f) {
      return n + f.runtimeGuards;
    }, 0),
    fixtures: fixtures.length
  };

  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch (err) {
    commit = "unknown (not a git checkout)";
  }
  const generatedAt = new Date().toISOString().slice(0, 10);

  const totalsRows = [
    ["Unit files", totals.unitFiles],
    ["Unit tests", totals.unitTests],
    ["Browser files", totals.browserFiles],
    ["Browser tests", totals.browserTests],
    ["All tests", totals.total],
    ["Skipped", totals.skipped],
    ["Todo", totals.todo],
    ["Fixtures", totals.fixtures]
  ]
    .map(function (row) {
      return "<tr><th scope=\"row\">" + row[0] + "</th><td>" + row[1] + "</td></tr>";
    })
    .join("\n");

  const gateRows = gates
    .map(function (g) {
      return (
        "<tr><td><code>npm run " +
        esc(g.name) +
        "</code></td><td>" +
        esc(g.detail) +
        "</td><td>" +
        esc(g.audience) +
        "</td></tr>"
      );
    })
    .join("\n");

  const fixtureRows = fixtures
    .map(function (f) {
      return (
        "<tr><td><code>" +
        esc(f.name) +
        "</code></td><td>" +
        esc(f.kind) +
        "</td><td>" +
        esc(f.role) +
        "</td></tr>"
      );
    })
    .join("\n");

  const html = [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>LAHE test index</title>",
    "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%AA%3C/text%3E%3C/svg%3E\">",
    "<style>" + CSS + "</style>",
    "</head>",
    "<body>",
    "<main class=\"page\">",

    "<h1>LAHE test index</h1>",
    "<p class=\"lede\">Every test in this repo, what it claims, and where it lives.</p>",
    "<p class=\"meta\">Generated by <code>" +
      SCRIPT_NAME +
      "</code> from commit <code>" +
      esc(commit) +
      "</code> on " +
      generatedAt +
      ". Every count on this page was produced by that script. None of them was typed by hand.</p>",

    "<h2>What the suite is for</h2>",
    "<p>The tool this project replaces had no browser-level test at all, and every symptom it produced lived in the part that had none. So the suite is built around a rule: if an assertion needs layout, a caret rectangle, a real key event, or a real Content-Security-Policy header, it runs in a real browser or it does not count. jsdom is banned repo-wide and the lint check enforces it.</p>",
    "<p>There are two lanes:</p>",
    "<ul>",
    "<li><strong>Unit</strong> (<code>test/unit</code>, Node's built-in <code>node:test</code>): the logic that does not need a page. Wire formats, path safety, projection, command dispatch, the anchor engine against a simulated DOM.</li>",
    "<li><strong>Browser</strong> (<code>test/browser</code>, Playwright): the real thing. A real <code>lahe review</code> walk, a real helper process, a real static server, a real injected script line, and a real page a reviewer touches.</li>",
    "</ul>",
    "<p>One more rule the suite enforces on itself: no arbitrary sleeps. Every wait is a condition poll or a counter read, and a unit test scans every file under <code>test/</code> and fails the gate on a sleep. A flaky browser test gets its determinism fixed, never its assertion loosened.</p>",

    "<h2>The three gates</h2>",
    "<p>Three gate commands exist and they are not interchangeable.</p>",
    "<table><thead><tr><th>Command</th><th>What it runs</th><th>Who runs it</th></tr></thead><tbody>",
    gateRows,
    "</tbody></table>",
    "<p>To run one browser lane by name, the environment flag has to come along, because the Playwright config reads <code>process.argv</code> to decide which projects exist and the worker process does not carry the flag:</p>",
    "<pre><code>LAHE_ALL_BROWSERS=1 npx playwright test --project=webkit</code></pre>",
    "<p>Single lanes otherwise: <code>npm run test:unit</code> and <code>npm run test:browser</code>. Browsers install once with <code>npx playwright install chromium</code>, plus <code>npx playwright install firefox webkit</code> for the other two lanes.</p>",

    "<h2>The totals</h2>",
    "<table class=\"narrow\"><tbody>",
    totalsRows,
    "</tbody></table>",
    "<p class=\"meta\">Skipped counts tests declared as skipped. It does not count the " +
      totals.runtimeGuards +
      " places where a test decides at run time to skip itself, usually because the browser it landed in paints an overlay scrollbar or restores a page from the back-forward cache differently. Todo counts tests declared with a <code>{ todo: \"...\" }</code> note: the claim is written down, the code it needs is not there yet.</p>",

    "<h2>Fixtures</h2>",
    "<p>A fixture is a page a test reviews. They are served over loopback rather than opened as <code>file://</code>, because a <code>file://</code> page has an opaque origin, storage behaves nothing like the case the tool ships into, and a real CSP is a response header. Roles below come from the table in <code>test/helpers/README.md</code>; blanks are fixtures that table does not describe.</p>",
    "<table><thead><tr><th>Fixture</th><th>Kind</th><th>Role</th></tr></thead><tbody>",
    fixtureRows,
    "</tbody></table>",

    "<h2>Browser suite</h2>",
    "<p>" +
      totals.browserTests +
      " tests across " +
      totals.browserFiles +
      " files, in <code>test/browser</code>. Playwright, against a real page.</p>",
    tocFor(browser),
    browser.map(fileSection).join("\n"),

    "<h2>Unit suite</h2>",
    "<p>" +
      totals.unitTests +
      " tests across " +
      totals.unitFiles +
      " files, in <code>test/unit</code>. Node's built-in runner, no browser.</p>",
    tocFor(unit),
    unit.map(fileSection).join("\n"),

    "<h2>How to read a test's name</h2>",
    "<p>Test names here are claims, not labels. A label says what area the test touches. A claim says what has to be true, in the order it happens, in words a person can check against the running tool. So the titles read as sentences:</p>",
    "<ul>",
    "<li>\"a reload waits while the reviewer is still touching the page, then lands\"</li>",
    "<li>\"the comment survives the rebuild and the card still points at the right paragraph\"</li>",
    "</ul>",
    "<p>The pattern is: the thing that happens, then the thing that must still be true afterward. When you read a failure, the title is the sentence that stopped being true. That is the whole reason for writing them this way.</p>",
    "<p>Two sets of names are cross-references rather than prose, and they mean something specific:</p>",
    "<ul>",
    "<li><strong>S1 through S8</strong> are the graceful-failure net: the eight ways the element stamp can be confidently wrong. Each one is a rebuilt page that lies to the engine in a different way, and each has to end the same way. Nothing written, the record marked lost with a sentence the reviewer can read, and the page left exactly as the rebuild left it. They are defined in <code>docs/ongoing/FINGERPRINTING.md</code> and carried by name into <code>graceful_failure.spec.js</code> and <code>anchor_cases.test.js</code>.</li>",
    "<li><strong>Numbered fingerprinting cases</strong> (case 1, case 4b, case 6b, and so on) are the use cases in the same document: finding the right element to edit, showing where an edit was made, surviving a rebuild. A test titled \"case 4b\" is answering that numbered case, and the document is where the case is described.</li>",
    "</ul>",
    "<p>If a title reads as a claim you cannot check, that is a bug in the title. Fix the title.</p>",

    "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, html);

  return { totals: totals, commit: commit };
}

const result = build();
process.stdout.write(
  "wrote docs/tests/index.html from commit " +
    result.commit +
    "\n" +
    "  unit files    " +
    result.totals.unitFiles +
    "\n  unit tests    " +
    result.totals.unitTests +
    "\n  browser files " +
    result.totals.browserFiles +
    "\n  browser tests " +
    result.totals.browserTests +
    "\n  all tests     " +
    result.totals.total +
    "\n  skipped       " +
    result.totals.skipped +
    "\n  todo          " +
    result.totals.todo +
    "\n  runtime skips " +
    result.totals.runtimeGuards +
    "\n  fixtures      " +
    result.totals.fixtures +
    "\n"
);
