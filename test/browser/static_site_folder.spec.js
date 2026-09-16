// A folder of pages is one review, and every page our own server hands out
// carries the rail.
//
// WHAT THIS COVERS. Before this, a review remembered the exact file paths it was
// pointed at and the static server only injected the script line for one of
// those. A reviewer walking a set of wireframes found the rail on the one page
// the agent had enrolled and nothing on the other four, and the workaround was
// to enroll every page one at a time: one run on 2026-09-16 made 82 separate
// reviews for 82 pages. Ken's rule replaced the whole question: anything our own
// static server serves gets the rail.
//
// Nothing here is simulated. It is the real `lahe review` walk on a real folder,
// so the session, the helper, and the static server are the real ones, and the
// pages are plain files with no script line anywhere on disk.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "site");

const SAID_ON_PLAN = "This screen needs the date the plan starts.";

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

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

/** A page written into the folder later, exactly as an agent adds a screen. */
function pageHtml(title, body, extra) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>' + title + "</title></head>",
    "<body>",
    "<main>",
    '<h1 id="title">' + title + "</h1>",
    '<p id="body">' + body + "</p>",
    "</main>",
    extra || "",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag",
    timeoutMs: 20000
  });
}

/** The reviewer's gesture, exactly as they make it: select, Cmd-Shift-C, type, Cmd-Enter. */
async function commentOnBody(page, text) {
  await page.evaluate(() => {
    const el = document.querySelector("#body");
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(
    page,
    (note) => window.__lahe.items().some((item) => item.note === note && item.state === "ready"),
    text,
    { message: "the comment to be ready" }
  );
}

test.describe("lahe review <folder>: one review, every page carries the rail", () => {
  let world = null;

  test.beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-site-folder-"));
    const stateDir = path.join(root, "state");
    const site = path.join(root, "site");
    fs.mkdirSync(site, { recursive: true });
    fs.readdirSync(FIXTURE).forEach(function (name) {
      fs.copyFileSync(path.join(FIXTURE, name), path.join(site, name));
    });

    const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
    delete env.XDG_STATE_HOME;
    const port = await freePort();

    const output = execFileSync(process.execPath, [CLI, "review", site, "--port", String(port)], {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const session = labelled(output, "session");
    const review = labelled(output, "review");
    const open = labelled(output, "open");
    const server = labelled(output, "server");
    const folder = labelled(output, "folder");
    expect(session, "`lahe review <folder>` printed the agent session id").toBeTruthy();
    expect(review, "`lahe review <folder>` printed the review id").toBeTruthy();
    expect(server, "a static server was started for the folder, not a dev-server snippet").toBeTruthy();
    expect(open, "`lahe review <folder>` printed one URL to open").toBeTruthy();
    expect(output, "a folder of HTML is not the app-in-dev row: no snippet to paste").not.toContain(
      "Wrap the script in your framework"
    );
    expect(open, "the open link is the folder's index").toBe(server + "/index.html");

    world = { root, stateDir, site, env, session, review, open, server, folder, output };
  });

  test.afterAll(async () => {
    if (!world) return;
    try {
      execFileSync(process.execPath, [CLI, "session", "close", world.session], {
        cwd: REPO_ROOT,
        env: world.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      // A session that already went down is not a test failure.
    }
  });

  test("all three pages of the folder come up with the rail, on one review", async ({ page }) => {
    for (const name of ["index.html", "plan.html", "notes.html"]) {
      await page.goto(world.server + "/" + name);
      await booted(page);
      expect(
        await page.evaluate(() => window.__lahe.review),
        name + " is on the review the folder was opened for"
      ).toBe(world.review);
    }

    // And the reviewer's own folder is exactly as they left it: three pages,
    // none of them carrying a review id or a token.
    expect(fs.readdirSync(world.site).sort(), "nothing was written into the folder").toEqual([
      "index.html",
      "notes.html",
      "plan.html"
    ]);
    ["index.html", "plan.html", "notes.html"].forEach(function (name) {
      expect(
        fs.readFileSync(path.join(world.site, name), "utf8").indexOf("data-lahe-review"),
        name + " on disk carries no script line"
      ).toBe(-1);
    });
  });

  test("a comment made on the second page lands in the folder's review, carrying that page's path", async ({ page }) => {
    await page.goto(world.server + "/plan.html");
    await booted(page);
    await commentOnBody(page, SAID_ON_PLAN);

    const reviewJson = path.join(world.folder, "review.json");
    let projected = null;
    await pollUntil(
      () => {
        if (!fs.existsSync(reviewJson)) return false;
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(reviewJson, "utf8"));
        } catch (err) {
          return false;
        }
        const hit = (parsed.pages || []).some((p) =>
          (p.items || []).some((item) => item.note === SAID_ON_PLAN)
        );
        if (hit) projected = parsed;
        return hit;
      },
      { timeoutMs: 20000, message: "the comment to reach review.json" }
    );

    expect(projected.review.id, "it is the folder's review, not a second one").toBe(world.review);
    const pages = projected.pages.filter((p) => (p.items || []).some((item) => item.note === SAID_ON_PLAN));
    expect(pages.length, "the item belongs to exactly one page group").toBe(1);
    expect(pages[0].path, "and the page it names is the second screen").toContain("plan.html");
    expect(pages[0].path, "not the page the review was opened at").not.toContain("index.html");
  });

  test("a page added to the folder after the review was opened gets the rail too", async ({ page }) => {
    const late = path.join(world.site, "settings.html");
    fs.writeFileSync(
      late,
      pageHtml("The settings screen", "Written into the folder after the review was already open.")
    );

    await page.goto(world.server + "/settings.html");
    await booted(page);
    expect(
      await page.evaluate(() => window.__lahe.review),
      "a page no review ever recorded is still this folder's review"
    ).toBe(world.review);
    expect(
      fs.readFileSync(late, "utf8").indexOf("data-lahe-review"),
      "and it was not written into on disk either"
    ).toBe(-1);
  });

  test("a page already carrying another review's script line is served exactly as it is", async () => {
    // The existing rule, unchanged: a page that was deliberately re-attached
    // somewhere else keeps the line it carries. The folder rule must not
    // quietly overwrite it.
    const attrs = protocol.SCRIPT_ATTR;
    const foreignTag =
      '<script src="http://127.0.0.1:7817/lahe-layer.js" ' +
      attrs.REVIEW +
      '="r_somebody_else" ' +
      attrs.TOKEN +
      '="tok_somebody_else" ' +
      attrs.HELPER +
      '="http://127.0.0.1:7817"></script>';
    const foreign = path.join(world.site, "foreign.html");
    fs.writeFileSync(foreign, pageHtml("Somebody else's page", "This one belongs to another review.", foreignTag));

    const res = await fetch(world.server + "/foreign.html");
    expect(res.status).toBe(200);
    const body = await res.text();
    const tags = body.match(/data-lahe-review="([^"]+)"/g) || [];
    expect(tags.length, "exactly one script line, not two: " + JSON.stringify(tags)).toBe(1);
    expect(tags[0], "and it is still the other review's").toContain("r_somebody_else");
    expect(body.indexOf(world.review), "this folder's review id was not put on the page").toBe(-1);
  });
});
