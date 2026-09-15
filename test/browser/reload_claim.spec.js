// A page that reloads itself must not trip its own second-window guard.
//
// R36's auto-reload starts a new document in the same tab, and the new document
// starts BEFORE the outgoing one is torn down. For that moment the outgoing page
// still holds the Web Lock, so the incoming one was refused, went read-only, and
// showed "This review is open in another window" with exactly one window open
// (Ken, live, 2026-08-18). The window id lives in sessionStorage and survives a
// same-tab reload, so the two are the same tab and the store now says so.
//
// The second half is the chip. A chip is restored from browser storage on every
// load, and it was trusted as it stood, so a refusal from an earlier session
// stayed on the rail while the reviewer typed happily into the review it claimed
// was locked. Every successful claim now re-validates it.
//
// Three claims:
//
//   1. Reload the page, several times: no second-window chip, not read-only, and
//      the reviewer can still comment.
//   2. A second-window chip seeded into storage before the load is GONE once the
//      claim succeeds.
//   3. The helper restarting mid-session does not refuse the page that is
//      already open: the claims are in memory, so a restart means no holder.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "reload-claim";
const PAGE_FILE = "page.html";

function docHtml(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    "<body>\n<main>\n" +
    '<p id="body">Runners come back too fast after a layoff, and the third week is where it shows.</p>\n' +
    "</main>\n" +
    '<script src="' +
    helperOrigin +
    '/lahe-layer.js" ' +
    attrs.REVIEW +
    '="' +
    REVIEW +
    '" ' +
    attrs.TOKEN +
    '="' +
    token +
    '" ' +
    attrs.HELPER +
    '="' +
    helperOrigin +
    '"></script>\n</body>\n</html>\n'
  );
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

function refusalState(page) {
  return page.evaluate(() => ({
    chips: window.__lahe.failures().map((f) => f.code),
    readOnly: window.__lahe.handle.sync.status().readOnly,
    refusalShown: window.__lahe.rail.refusalShown()
  }));
}


// TEMPORARY DIAGNOSTIC (ci/reload-claim). Records every window.claim and
// window.release this tab makes, across reloads, in sessionStorage, so a
// failure can be read as a sequence rather than a snapshot.
const CLAIM_TRACE = `
(function () {
  var KEY = "lahe.diag.claimtrace";
  function push(entry) {
    try {
      var all = JSON.parse(window.sessionStorage.getItem(KEY) || "[]");
      all.push(entry);
      window.sessionStorage.setItem(KEY, JSON.stringify(all));
    } catch (err) {}
  }
  var ss = window.sessionStorage;
  var realSet = ss.setItem.bind(ss);
  var realRemove = ss.removeItem.bind(ss);
  ss.setItem = function (key, value) {
    if (String(key).indexOf("lahe.session.v1:") === 0) {
      push({ t: Date.now(), dir: "set", key: key, value: String(value).slice(0, 12), stack: String(new Error().stack).split("\\n").slice(1, 6).join(" | ") });
    }
    return realSet(key, value);
  };
  ss.removeItem = function (key) {
    if (String(key).indexOf("lahe.session.v1:") === 0) {
      push({ t: Date.now(), dir: "rm", key: key, stack: String(new Error().stack).split("\\n").slice(1, 6).join(" | ") });
    }
    return realRemove(key);
  };
  var real = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var watched = url.indexOf("/window/") !== -1 || url.indexOf("window.claim") !== -1 || url.indexOf("/window") !== -1;
    if (!watched) return real.apply(this, arguments);
    var at = Date.now();
    var body = (init && init.body) || null;
    push({ t: at, dir: "->", url: url, body: String(body).slice(0, 300), doc: window.__laheDiagDoc });
    return real.apply(this, arguments).then(
      function (response) {
        push({ t: at, at2: Date.now(), dir: "<h", url: url, status: response.status });
        var clone = null;
        try { clone = response.clone(); } catch (err) {}
        if (clone) {
          clone.text().then(function (text) {
            push({ t: at, at2: Date.now(), dir: "<-", url: url, status: response.status, body: text.slice(0, 300), doc: window.__laheDiagDoc });
          }, function () {});
        }
        return response;
      },
      function (error) {
        push({ t: at, at2: Date.now(), dir: "<x", url: url, error: String(error && error.message), doc: window.__laheDiagDoc });
        throw error;
      }
    );
  };
})();
`;

async function traceOf(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem("lahe.diag.claimtrace") || "[]");
    } catch (err) {
      return [];
    }
  });
}

async function dumpDiagnostics(page, service, label) {
  let pageState = null;
  try {
    pageState = await page.evaluate(() => ({
      failures: window.__lahe.failures(),
      lock: window.__lahe.handle.sync.lockState(),
      status: window.__lahe.handle.sync.status(),
      claimMisses: window.__lahe.handle.sync.claimMisses ? window.__lahe.handle.sync.claimMisses() : null,
      secret: (window.sessionStorage.getItem("lahe.session.v1:reload-claim") || "").slice(0, 8),
      session: Object.keys(window.sessionStorage).map((k) => k + "=" + String(window.sessionStorage.getItem(k)).slice(0, 120))
    }));
  } catch (err) {
    pageState = { error: String(err && err.message) };
  }
  const trace = await traceOf(page).catch(() => []);
  let helperLog = "";
  try {
    helperLog = fs.readFileSync(path.join(service.stateDir, "helper.log"), "utf8");
  } catch (err) {
    helperLog = "(no helper log: " + err.message + ")";
  }
  let windows = "";
  try {
    windows = fs.readFileSync(path.join(service.stateDir, "windows.json"), "utf8");
  } catch (err) {
    windows = "(no windows.json: " + err.message + ")";
  }
  // eslint-disable-next-line no-console
  console.log(
    "\n===== LAHE DIAG " + label + " =====\n" +
      "page: " + JSON.stringify(pageState, null, 2) + "\n" +
      "claim trace:\n" + trace.map((e) => JSON.stringify(e)).join("\n") + "\n" +
      "windows.json: " + windows + "\n" +
      "helper.log tail:\n" + helperLog.split("\n").slice(-60).join("\n") + "\n" +
      "===== END DIAG =====\n"
  );
}

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
  await page.evaluate(() => window.__lahe.handle.comments.closeAll());
}

test.describe("a reload is the same window, not a second one", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-reload-claim-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "reload-claim" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(filePath, docHtml(service.url, token));
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("reloading the page over and over never refuses it, and it stays writable", async ({ page }) => {
    await page.addInitScript(CLAIM_TRACE);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);

    for (let i = 0; i < 4; i += 1) {
      await page.reload();
      await booted(page);
      // The claim is asynchronous, so wait for it to have been decided rather
      // than reading a state that has not happened yet.
      await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
        message: "the window claim to be decided after the reload"
      });
      const state = await refusalState(page);
      if (state.chips.includes("SECOND_WINDOW_REFUSED") || state.readOnly || state.refusalShown) {
        await dumpDiagnostics(page, service, "reload " + (i + 1));
      }
      expect(state.chips, "no second-window chip after reload " + (i + 1)).not.toContain("SECOND_WINDOW_REFUSED");
      expect(state.readOnly, "and the window is not read-only").toBe(false);
      expect(state.refusalShown, "and the refusal panel is not shown").toBe(false);
    }

    // Still the reviewer's page: they can comment on it.
    await commentOnBody(page, "This paragraph needs a number.");
    expect((await page.evaluate(() => window.__lahe.items())).length).toBe(1);
  });

  test("a second-window chip left in storage does not survive a successful claim", async ({ page }) => {
    // A refusal from an earlier session, exactly as browser storage holds it.
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            chips: [
              {
                code: "SECOND_WINDOW_REFUSED",
                message: "This review is already open in another window.",
                detail: "the window on page.html, open for the last 4 minutes",
                count: 1
              }
            ],
            dismissed: []
          })
        );
      },
      { key: "lahe.chips.v1:" + REVIEW }
    );

    await page.reload();
    await booted(page);
    await pollPage(page, () => !window.__lahe.failures().some((f) => f.code === "SECOND_WINDOW_REFUSED"), undefined, {
      message: "the stale second-window chip to be cleared by the successful claim"
    });
    expect((await refusalState(page)).readOnly, "and the window is not read-only").toBe(false);
  });

  test("a helper restart does not refuse the page that is already open", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the first claim to be decided"
    });

    // The helper's claims are in memory, so a restart is the case where the page
    // outlives every record of who holds what.
    const port = String(service.port);
    const stateDir = service.stateDir;
    await service.stop();
    service = await startService({
      reviews: [REVIEW],
      allowedOrigins: [pages.origin],
      stateDir: stateDir,
      env: { LAHE_PORT: port }
    });
    expect(service.tokenFor(REVIEW), "the token persists across a restart").toBe(token);

    await pollPage(page, () => window.__lahe.handle.sync.status().counters.polls > 0, undefined, {
      message: "the page to keep polling across the restart"
    });
    const state = await refusalState(page);
    expect(state.chips, "the restart did not refuse the open page").not.toContain("SECOND_WINDOW_REFUSED");
    expect(state.readOnly).toBe(false);
  });
});
