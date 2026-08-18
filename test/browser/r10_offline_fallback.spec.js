// R10, the offline half: there is always a way to take the work elsewhere,
// with nothing running.
//
// The regression this spec exists for. The script line's src became the
// helper's own URL and nothing else, so a page OPENED while the helper was down
// loaded no library at all: no rail, no "the helper is unreachable" chip, no
// local capture, no export. Silent nothing, on the exact page a reviewer opens
// before starting the helper. The note that justified cutting the copy beside
// the page said "a review with no helper cannot record anything anyway", which
// is false, and this spec is the proof: the library alone records into browser
// storage, says out loud that the helper is unreachable, and posts what it held
// the moment the helper is back.
//
// What is real here:
//
//   REAL  the page: a static file served over http, with the pinned script line
//         in it, primary src pointing at a helper that is NOT running
//   REAL  the fallback: a copy of the built bundle beside the page, reached only
//         through the line's own onerror
//   REAL  the comment: made with the reviewer's own gestures, with nothing up
//   REAL  the recovery: the same helper started again on its own port and
//         token, and the record arriving in its event log with nothing retyped
//
// The reviewer is never told any of this. They open the page and the rail is
// there, saying the true thing about a helper that is away.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  startStaticServer,
  startService,
  readEventLog,
  SERVICE_ENTRY
} = require("../helpers");

const protocol = require("../../src/shared/protocol.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "dist", "lahe-layer.js");

const REVIEW = "r10-offline-fallback";
const SAID = "The helper was off when I wrote this, and it still counted.";

const PAGE = [
  "<!doctype html>",
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Offline review</title></head>',
  "<body>",
  '  <h1 id="title">A page opened with nothing running</h1>',
  '  <p id="lede">Marcus is running four easy miles on Tuesday and resting on Wednesday.</p>',
  "</body>",
  "</html>",
  ""
].join("\n");

/** The reviewer's comment gesture: select a passage, Cmd-Shift-C, type, commit. */
async function commentOnSelection(page, selector, text) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("nothing matched " + sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("R10: the work survives a helper that is not running", () => {
  test("a page opened with the helper down boots from the fallback, keeps the comment, and syncs when the helper returns", async ({
    page
  }) => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-r10-"));
    const pagePath = path.join(workDir, "report.html");
    fs.writeFileSync(pagePath, PAGE, "utf8");

    // THE FALLBACK COPY, exactly what `lahe add` writes beside a static page.
    fs.copyFileSync(BUNDLE_PATH, path.join(workDir, "lahe-layer.js"));

    const site = await startStaticServer({ root: workDir, label: "r10-offline" });

    // The helper mints the review and its token, and is then killed. Everything
    // the reviewer does happens with it dead.
    let helper = await startService({
      entry: SERVICE_ENTRY,
      args: ["--port", "0"],
      reviews: [REVIEW],
      allowedOrigins: [site.origin]
    });
    const port = helper.port;
    const helperUrl = helper.url;
    const stateDir = helper.stateDir;
    const token = helper.tokenFor(REVIEW);
    let second = null;

    try {
      fs.writeFileSync(
        pagePath,
        PAGE.replace(
          "</body>",
          protocol.scriptTag({
            src: helperUrl + protocol.route("library.get").path,
            review: REVIEW,
            token: token,
            helper: helperUrl,
            fallback: "lahe-layer.js"
          }) + "\n</body>"
        ),
        "utf8"
      );

      await helper.kill9();
      expect(helper.alive(), "the helper is down before the page is ever opened").toBe(false);

      // --- the page opens, with nothing running --------------------------------
      //
      // The primary src cannot load: there is no helper on that port. If the
      // fallback did not exist, this poll is what would time out, which is the
      // regression stated as a failing test.
      await page.goto(site.urlFor("report.html"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        timeoutMs: 15000,
        message: "the library to boot from the fallback copy beside the page, with no helper up"
      });

      // It really came from the fallback: the injected script names the relative
      // sibling, not the helper's URL.
      const injected = await page.evaluate(() =>
        Array.prototype.map.call(document.querySelectorAll("script"), (s) => s.getAttribute("src"))
      );
      expect(
        injected.some((src) => src === "lahe-layer.js"),
        "the onerror injected the sibling copy: " + JSON.stringify(injected)
      ).toBe(true);

      // --- and it says the true thing about the helper -------------------------
      await pollPage(page, () => window.__lahe.status() === "kept_locally", undefined, {
        timeoutMs: 20000,
        message: "the status line to say the work is kept in this browser"
      });
      const chips = await page.evaluate(() => window.__lahe.failures().map((chip) => chip.code));
      expect(chips, "the reviewer is told the helper is unreachable, without being told why").toContain(
        "HELPER_UNREACHABLE"
      );

      // --- the comment, typed with nothing running -----------------------------
      await commentOnSelection(page, "#lede", SAID);
      const items = await page.evaluate(() => window.__lahe.items());
      expect(items, "the comment exists with no helper to take it").toHaveLength(1);
      expect(items[0].note).toBe(SAID);
      expect(items[0].state).toBe("ready");

      // It is in BROWSER STORAGE, not only in this page's memory. A reload with
      // the helper still down brings it back.
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        timeoutMs: 15000,
        message: "the library to boot from the fallback again after a reload"
      });
      const afterReload = await page.evaluate(() => window.__lahe.items());
      expect(afterReload, "the comment came back from browser storage").toHaveLength(1);
      expect(afterReload[0].note).toBe(SAID);

      // --- the helper comes back, and nothing is retyped -----------------------
      second = await startService({
        entry: SERVICE_ENTRY,
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [site.origin],
        env: { LAHE_PORT: String(port), LAHE_TOKEN: token }
      });

      await pollPage(page, () => window.__lahe.status() === "stored", undefined, {
        timeoutMs: 30000,
        message: "the status line to recover on its own once the helper is back"
      });
      const recovered = await page.evaluate(() => window.__lahe.failures().map((chip) => chip.code));
      expect(recovered, "the standing chip goes when its condition ends").not.toContain("HELPER_UNREACHABLE");

      const log = await pollUntil(
        () => {
          const lines = readEventLog(stateDir, REVIEW);
          const found = lines.filter((line) => JSON.stringify(line).indexOf(SAID) !== -1);
          return found.length > 0 ? found : null;
        },
        {
          timeoutMs: 30000,
          message: "the comment made with no helper up to arrive in the helper's event log"
        }
      );
      expect(log.length, "the offline comment is in the helper's log").toBeGreaterThan(0);
    } finally {
      if (second && second.alive()) await second.kill9();
      if (helper.alive()) await helper.kill9();
      await site.close();
    }
  });
});
