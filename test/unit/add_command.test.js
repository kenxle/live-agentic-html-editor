// `lahe add`: the install command. Task 3B.
//
// These tests run the REAL command through the real entry point
// (`node bin/lahe.js add ...`), because the thing under test is a command: its
// exit code, what it prints, what it leaves in the file, and the helper it
// starts. Calling run() in-process would skip the half of it that a user meets.
//
// Every invocation is pointed at a throwaway state directory and an ephemeral
// port. The default port is fixed on purpose (a page has it baked into its
// script tag), and a parallel test run would collide on it, which is the same
// reason 1A's specs pass --port.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { pollUntil } = require("../helpers/poll.js");
const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

const PAGE = [
  "<!doctype html>",
  "<html>",
  "  <head><title>A report</title></head>",
  "  <body>",
  "    <h1>A report</h1>",
  "    <p>One paragraph.</p>",
  "  </body>",
  "</html>",
  ""
].join("\n");

/** A throwaway directory. Left in the OS temp; nothing here deletes. */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-3b-"));
}

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

/**
 * One `lahe add` run.
 *
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runAdd(args, env) {
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, [BIN, "add"].concat(args), {
      env: Object.assign({}, process.env, env || {}),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (err) {
    result.code = typeof err.status === "number" ? err.status : 1;
    result.stdout = err.stdout ? String(err.stdout) : "";
    result.stderr = err.stderr ? String(err.stderr) : "";
  }
  return result;
}

/** The helper `add` started, stopped the way a user's Ctrl-C would. */
async function stopHelper(stateDir) {
  const readyPath = path.join(stateDir, "service.json");
  if (!fs.existsSync(readyPath)) return;
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch (err) {
    return;
  }
  if (!ready || typeof ready.pid !== "number") return;
  try {
    process.kill(ready.pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
  await pollUntil(
    async function () {
      const up = await service.probeHealth("127.0.0.1", ready.port);
      return up ? null : true;
    },
    { message: "the helper add started to stop answering" }
  );
}

/** Every script tag `add` could have written, as matched text. */
function scriptTagsIn(html) {
  const found = html.match(/<script\b[^>]*data-lahe-review="[^"]*"[^>]*><\/script>/gi);
  return found || [];
}

function reviewIdIn(html) {
  const found = html.match(/data-lahe-review="([^"]+)"/);
  return found ? found[1] : null;
}

function tokenIn(html) {
  const found = html.match(/data-lahe-token="([^"]+)"/);
  return found ? found[1] : null;
}

/** A fresh page in a fresh directory, with a fresh state directory and port. */
async function aWorkspace() {
  const dir = tempDir();
  const pagePath = path.join(dir, "report.html");
  fs.writeFileSync(pagePath, PAGE);
  const stateDir = path.join(tempDir(), "state");
  const port = await freePort();
  return {
    dir: dir,
    page: pagePath,
    stateDir: stateDir,
    port: port,
    read: function () {
      return fs.readFileSync(pagePath, "utf8");
    },
    add: function (extra) {
      return runAdd(
        [pagePath, "--port", String(port), "--state-dir", stateDir].concat(extra || []),
        {}
      );
    },
    stop: function () {
      return stopHelper(stateDir);
    }
  };
}

test("add twice on the same file reuses the review, and --new does not", async () => {
  const work = await aWorkspace();
  try {
    const first = work.add();
    assert.equal(first.code, 0, "the first add succeeded:\n" + first.stdout + first.stderr);

    const afterFirst = work.read();
    const firstReview = reviewIdIn(afterFirst);
    const firstToken = tokenIn(afterFirst);
    assert.ok(firstReview, "the first add wrote a review id into the page");
    assert.ok(firstToken, "and its token");
    assert.equal(scriptTagsIn(afterFirst).length, 1, "exactly one script line");

    const second = work.add();
    assert.equal(second.code, 0, "the second add succeeded:\n" + second.stdout + second.stderr);

    const afterSecond = work.read();
    assert.equal(
      reviewIdIn(afterSecond),
      firstReview,
      "add twice on the same file reuses the review it already carries"
    );
    assert.equal(tokenIn(afterSecond), firstToken, "and the token that review was minted with");
    assert.equal(scriptTagsIn(afterSecond).length, 1, "still exactly one script line");
    assert.match(second.stdout, /reus/i, "and it says so rather than pretending it minted one");

    const third = work.add(["--new"]);
    assert.equal(third.code, 0, "add --new succeeded:\n" + third.stdout + third.stderr);

    const afterThird = work.read();
    assert.notEqual(reviewIdIn(afterThird), firstReview, "--new minted a second review");
    assert.notEqual(tokenIn(afterThird), firstToken, "with its own token");
    assert.equal(scriptTagsIn(afterThird).length, 1, "and replaced the line rather than adding one");
  } finally {
    await work.stop();
  }
});

test("the line add writes is protocol.scriptTag's, byte for byte", async () => {
  const work = await aWorkspace();
  try {
    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);

    const html = work.read();
    // The src is read back out of the file rather than recomputed: which path
    // add chose is a separate question (tested below), and this test is about
    // the FORM of the line being the pinned one, attribute for attribute.
    const expected = protocol.scriptTag({
      src: /src="([^"]+)"/.exec(html)[1],
      review: reviewIdIn(html),
      token: tokenIn(html),
      helper: "http://127.0.0.1:" + work.port
    });

    // The pinned form is multi-line and indented. What is in the file is that
    // string with the closing tag's indentation added to every line after the
    // first, and nothing else: no attribute reordered, none dropped, none added.
    const indented = expected
      .split("\n")
      .map(function (line, i) {
        return i === 0 ? line : "  " + line;
      })
      .join("\n");
    assert.ok(
      html.indexOf(indented) !== -1,
      "the file carries protocol.scriptTag's exact form.\nexpected:\n" + indented + "\ngot:\n" + html
    );
    assert.ok(
      html.indexOf('data-lahe-helper="http://127.0.0.1:' + work.port + '"') !== -1,
      "the helper attribute names the helper"
    );
    assert.ok(
      /src="[^"]*lahe-layer\.js"/.test(html),
      "and src names the built library, never the helper"
    );
    assert.ok(html.indexOf('src="http') === -1, "src is not a URL at the helper");
  } finally {
    await work.stop();
  }
});

test("src is a relative path back to the clone, or a copy in the page's own assets", async () => {
  // A page sitting next to the clone: a short relative path, and no copy.
  const near = tempDir();
  const nearPage = path.join(near, "report.html");
  fs.writeFileSync(nearPage, PAGE);
  const nearState = path.join(tempDir(), "state");
  const nearPort = await freePort();
  try {
    const run = runAdd([nearPage, "--port", String(nearPort), "--state-dir", nearState]);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    const src = /src="([^"]+)"/.exec(fs.readFileSync(nearPage, "utf8"))[1];
    assert.ok(
      fs.existsSync(path.resolve(near, src)),
      "whatever path add wrote, it resolves to a file that is really there: " + src
    );
    assert.ok(src.endsWith("/lahe-layer.js"), "and that file is the built bundle");
  } finally {
    await stopHelper(nearState);
  }

  // A page with its own assets directory: a copy goes in it, and the src is the
  // short relative URL, because a page with assets is a thing that gets moved.
  const withAssets = tempDir();
  const assetsPage = path.join(withAssets, "report.html");
  fs.writeFileSync(assetsPage, PAGE);
  fs.mkdirSync(path.join(withAssets, "assets"));
  const assetsState = path.join(tempDir(), "state");
  const assetsPort = await freePort();
  try {
    const run = runAdd([assetsPage, "--port", String(assetsPort), "--state-dir", assetsState]);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    const src = /src="([^"]+)"/.exec(fs.readFileSync(assetsPage, "utf8"))[1];
    assert.equal(src, "assets/lahe-layer.js");
    assert.ok(
      fs.existsSync(path.join(withAssets, "assets", "lahe-layer.js")),
      "the built library was copied in beside the page"
    );
  } finally {
    await stopHelper(assetsState);
  }
});

test("the script line goes before </body>, then before </html>, then at the end", () => {
  const add = require("../../src/cli/commands/add.js");
  const TAG = "<script defer></script>";

  const withBody = add.placeScriptLine("<html>\n  <body>\n    <p>x</p>\n  </body>\n</html>\n", TAG);
  assert.equal(withBody.where, "just before </body>");
  assert.match(withBody.html, /  <script defer><\/script>\n  <\/body>/);

  // The LAST closer, not the first: a page that quotes </body> in its own prose
  // still ends at the real one.
  const quoted = add.placeScriptLine(
    "<html>\n  <body>\n    <code>&lt;/body&gt; and </body> in prose</code>\n  </body>\n</html>\n",
    TAG
  );
  const tagAt = quoted.html.indexOf(TAG);
  assert.ok(tagAt > quoted.html.indexOf("in prose"), "the line went after the quoted one");

  const noBody = add.placeScriptLine("<html>\n  <p>a fragment with a document end</p>\n</html>\n", TAG);
  assert.equal(noBody.where, "just before </html>");
  assert.match(noBody.html, /<script defer><\/script>\n<\/html>/);

  const fragment = add.placeScriptLine("<p>just a fragment</p>\n", TAG);
  assert.equal(fragment.where, "at the end of the file");
  assert.equal(fragment.html, "<p>just a fragment</p>\n" + TAG + "\n");

  const noTrailingNewline = add.placeScriptLine("<p>a</p>", TAG);
  assert.equal(noTrailingNewline.html, "<p>a</p>\n" + TAG + "\n");
});

test("a static file registers the null origin, which is what a page opened from disk sends", async () => {
  const work = await aWorkspace();
  try {
    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);

    const review = reviewIdIn(work.read());
    const meta = JSON.parse(
      fs.readFileSync(path.join(work.stateDir, "reviews", review, "meta.json"), "utf8")
    );
    assert.deepEqual(meta.origins, ["null"], "the file origin, and only it");

    const ready = JSON.parse(fs.readFileSync(path.join(work.stateDir, "service.json"), "utf8"));
    assert.ok(ready.reviews[review], "the helper add started holds the review");
    assert.equal(ready.reviews[review].token, meta.token, "with the token that was minted for it");
    assert.deepEqual(ready.reviews[review].origins, ["null"]);
  } finally {
    await work.stop();
  }
});

test("add says out loud that the token it just wrote into a file can be committed and shared", async () => {
  const work = await aWorkspace();
  try {
    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /token/i);
    assert.match(run.stdout, /committed and shared/i);
    assert.match(run.stdout, /this one review's feedback/i, "and that the leak is scoped to one review");
    assert.match(run.stdout, /file:\/\//, "and it says what to open");
  } finally {
    await work.stop();
  }
});

test("add starts the helper when none is running, which is what makes the install one command", async () => {
  const work = await aWorkspace();
  try {
    const before = await service.probeHealth("127.0.0.1", work.port);
    assert.equal(before, null, "nothing was answering on that port before add ran");

    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);

    const after = await service.probeHealth("127.0.0.1", work.port);
    assert.ok(after && after.ok, "a helper is answering after add, without a second command");
    assert.match(run.stdout, /started just now/, "and add says it started one");
  } finally {
    await work.stop();
  }
});

test("a dev server target prints a guarded line and edits nothing", async () => {
  const project = tempDir();
  const layoutDir = path.join(project, "app", "views", "layouts");
  fs.mkdirSync(layoutDir, { recursive: true });
  const layout = path.join(layoutDir, "application.html.erb");
  fs.writeFileSync(layout, "<html><body><%= yield %></body></html>");
  fs.mkdirSync(path.join(project, "public"));

  const stateDir = path.join(tempDir(), "state");
  const port = await freePort();
  try {
    const run = runAdd([
      project,
      "--port",
      String(port),
      "--state-dir",
      stateDir,
      "--origin",
      "http://localhost:4321",
      "--source",
      "app/views/layouts/application.html.erb"
    ]);
    assert.equal(run.code, 0, run.stdout + run.stderr);

    assert.equal(
      fs.readFileSync(layout, "utf8"),
      "<html><body><%= yield %></body></html>",
      "add never edits application code"
    );
    assert.match(run.stdout, /development only/i, "the printed line is inside a development-only guard");
    assert.match(run.stdout, /data-lahe-review="r/, "and the line itself is printed");
    assert.match(run.stdout, /Nothing was edited/);

    const review = /data-lahe-review="([^"]+)"/.exec(run.stdout)[1];
    const meta = JSON.parse(fs.readFileSync(path.join(stateDir, "reviews", review, "meta.json"), "utf8"));
    assert.deepEqual(meta.origins, ["http://localhost:4321"], "the origin that was named is registered");

    // The source hint is RECORDED, not only printed: it rides a page.visited
    // event so an agent edits the template instead of the build output.
    const log = fs
      .readFileSync(path.join(stateDir, "reviews", review, "events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    const visited = log.filter((event) => event.event === protocol.EVENT.PAGE_VISITED);
    assert.equal(visited.length, 1, "one page.visited event");
    assert.equal(visited[0].source_hint, "app/views/layouts/application.html.erb");

    assert.ok(
      fs.existsSync(path.join(project, "public", "lahe-layer.js")),
      "the built library was copied where the app can serve it"
    );
  } finally {
    await stopHelper(stateDir);
  }
});

test("a second review on a running helper works without the user restarting anything", async () => {
  const first = await aWorkspace();
  const secondPage = path.join(first.dir, "second.html");
  fs.writeFileSync(secondPage, PAGE);
  try {
    const one = first.add();
    assert.equal(one.code, 0, one.stdout + one.stderr);
    const firstReview = reviewIdIn(first.read());
    const pidBefore = JSON.parse(fs.readFileSync(path.join(first.stateDir, "service.json"), "utf8")).pid;

    const two = runAdd([secondPage, "--port", String(first.port), "--state-dir", first.stateDir]);
    assert.equal(two.code, 0, two.stdout + two.stderr);

    const secondReview = /data-lahe-review="([^"]+)"/.exec(fs.readFileSync(secondPage, "utf8"))[1];
    assert.notEqual(secondReview, firstReview, "the second page got its own review");

    const ready = JSON.parse(fs.readFileSync(path.join(first.stateDir, "service.json"), "utf8"));
    assert.ok(ready.reviews[firstReview], "the running helper still holds the first review");
    assert.ok(ready.reviews[secondReview], "and now holds the second one too");
    assert.equal(ready.pid, pidBefore, "and it is the SAME helper process: nothing was bounced");
    assert.doesNotMatch(two.stdout, /restarted/i, "so add does not claim it restarted anything");
    assert.match(two.stdout, /without a restart/i, "and says what really happened");

    const up = await service.probeHealth("127.0.0.1", first.port);
    assert.ok(up && up.ok, "the helper is answering when add returns");
  } finally {
    await first.stop();
  }
});

test("--remove takes the script line out and leaves everything else in the page alone", async () => {
  const work = await aWorkspace();
  try {
    const before = work.read();
    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.equal(scriptTagsIn(work.read()).length, 1, "there is a line to remove");

    const removed = runAdd([work.page, "--remove"]);
    assert.equal(removed.code, 0, removed.stdout + removed.stderr);
    assert.equal(
      work.read(),
      before,
      "the page is byte for byte what it was before add touched it:\n" + JSON.stringify(work.read())
    );
    assert.match(removed.stdout, /Took out the script line/);

    // Removing again is a plain no-op, not a failure: a page with no line is
    // already in the state --remove is asking for.
    const again = runAdd([work.page, "--remove"]);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /no lahe script line/i);
  } finally {
    await work.stop();
  }
});

test("--remove removes the lahe tag and no other script on the page", () => {
  const add = require("../../src/cli/commands/add.js");
  const page = [
    "<html>",
    "  <body>",
    "    <script src=\"app.js\"></script>",
    "    <script defer src=\"lahe-layer.js\" data-lahe-review=\"r1\" data-lahe-token=\"t\"></script>",
    "    <script>window.theirs = 1;</script>",
    "  </body>",
    "</html>",
    ""
  ].join("\n");

  const removed = add.removeScriptLine(page);
  assert.equal(removed.review, "r1");
  assert.equal(
    removed.html,
    [
      "<html>",
      "  <body>",
      "    <script src=\"app.js\"></script>",
      "    <script>window.theirs = 1;</script>",
      "  </body>",
      "</html>",
      ""
    ].join("\n"),
    "their two scripts stay, the blank line does not"
  );

  assert.equal(add.removeScriptLine("<html><body><p>no line here</p></body></html>"), null);
});

test("add prints the review folder, because that is the only way an agent finds review.json", async () => {
  const work = await aWorkspace();
  try {
    const run = work.add();
    assert.equal(run.code, 0, run.stdout + run.stderr);

    const review = reviewIdIn(work.read());
    const folder = path.join(work.stateDir, "reviews", review);
    assert.ok(
      run.stdout.indexOf(folder) !== -1,
      "the review folder is in the output, not merely described:\n" + run.stdout
    );
    assert.ok(fs.existsSync(folder), "and it is really there");
  } finally {
    await work.stop();
  }
});

test("AGENTS.md says where the state directory is, so the folder can be found without add's output", () => {
  const agents = fs.readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
  assert.match(agents, /LAHE_STATE_DIR/, "the first place looked at");
  assert.match(agents, /XDG_STATE_HOME/, "the second");
  assert.match(agents, /~\/\.local\/state\/lahe/, "and the default");
  assert.match(agents, /reviews\/<review-id>/, "and how a review folder is named under it");
  assert.match(agents, /--state-dir/, "the isolation flags an agent needs on a shared machine");
  assert.match(agents, /--port/);
});

test("add refuses what it cannot do, with a reason and a non-zero exit", async () => {
  const missing = runAdd(["/no/such/page.html"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /nothing at/);

  const noTarget = runAdd([]);
  assert.equal(noTarget.code, protocol.WAIT.EXIT.BAD_USAGE);
  assert.match(noTarget.stderr, /usage: lahe add/);

  const unknown = runAdd(["--nope", "x.html"]);
  assert.equal(unknown.code, protocol.WAIT.EXIT.BAD_USAGE);
  assert.match(unknown.stderr, /unknown option/);
});

test("package.json installs one command, and it is bin/lahe.js", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.bin, { lahe: "bin/lahe.js" });
  assert.ok(fs.existsSync(path.join(REPO_ROOT, "bin", "lahe.js")), "and that file is there");
  assert.match(
    fs.readFileSync(path.join(REPO_ROOT, "bin", "lahe.js"), "utf8"),
    /^#!\/usr\/bin\/env node/,
    "with the shebang that makes an installed command runnable"
  );
});

test("the README states the real requirements and claims no single platform or browser", () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

  // The claim the plan sends 3B to delete (S13): it contradicted D1 and the
  // cross-browser lanes, both of which are real.
  assert.doesNotMatch(readme, /macOS and Chromium/i);
  assert.doesNotMatch(readme, /Chromium only/i);
  assert.doesNotMatch(readme, /macOS only/i);

  assert.match(readme, /Node 20/, "the one stated platform requirement");
  assert.match(readme, /Custom Highlight API/, "and the browser floor");
  assert.match(readme, /MIT/, "the license");
  assert.match(readme, /npm link/, "the documented install");
  assert.match(readme, /node bin\/lahe\.js/, "and the no-install fallback");
  assert.match(readme, /lahe add/, "and the one command that installs the library into a page");

  // The in-page hints, so a new user can work the tool out without this file.
  assert.match(readme, /Cmd-Shift-C/);
  assert.match(readme, /Cmd-Shift-E/);
  assert.match(readme, /Cmd-Enter/);
});
