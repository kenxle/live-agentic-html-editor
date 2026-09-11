// A framed document does not boot, and the window that framed it is untouched.
//
// The case is reveal.js's speaker-notes window: pressing S opens a second
// window that embeds the same deck in an iframe with a `?receiver` query, so
// the deck's own script tag ran twice on one review and the two copies fought
// over the window claim (refusal panels, a read-only rail, heartbeat churn).
// Ken, presenting: "something is happening when I pull up speaker notes where
// LAHE is trying to interact with them."
//
// Nothing of reveal is vendored or loaded here. The fixture pair mimics what
// the notes plugin does, which is all the library can see from inside the page:
// a same-origin child, framed, carrying the same review.
//
// The rule itself is unit-tested over a fake window in
// test/unit/framed_boot.test.js. This is the wiring.

"use strict";

const path = require("node:path");

const { test, expect, pollPage, startStaticServer } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

test.describe("the library does not boot inside a frame", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("the embedded copy boots nothing and says why, and the real window keeps the review", async ({ page }) => {
    await page.goto(pages.urlFor("test/fixtures/frames-parent.html"));

    // The window the reviewer is actually looking at has the library on it.
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the framing window to boot"
    });

    const frame = page.frame({ url: /frames-child\.html/ });
    expect(frame, "the notes-style frame is on the page").toBeTruthy();
    await frame.waitForLoadState();

    const inFrame = await frame.evaluate(() => ({
      hasGlobal: typeof window.__lahe !== "undefined",
      skipped: window.LAHE && window.LAHE.layer ? window.LAHE.layer.skipped : "no module",
      // Nothing of the library's is in the framed document: no host element and
      // no page-level stylesheet. Storage is deliberately NOT asserted here: a
      // same-origin frame shares the framing window's localStorage, so the keys
      // it can see are the real window's own and say nothing about who wrote
      // them. "No boot" is what makes "no writes" true, and no boot is what the
      // two lines below assert.
      host: !!document.getElementById("lahe-surface-root"),
      styles: document.querySelectorAll("style[data-lahe-highlight]").length
    }));

    expect(inFrame.skipped, "the framed copy says why it did not boot").toBe("framed");
    expect(inFrame.hasGlobal, "and publishes no page global, because it is running no review").toBe(false);
    expect(inFrame.host).toBe(false);
    expect(inFrame.styles).toBe(0);

    // And the real window is not in a refusal: nothing claimed the review out
    // from under it.
    await page.evaluate(() => window.__lahe.startSync());
    await pollPage(page, () => window.__lahe.rail.isMounted(), undefined, { message: "the rail to mount" });

    const holder = await page.evaluate(() => ({
      refusal: window.__lahe.rail.refusalShown(),
      failures: window.__lahe.failures().map((f) => f.code)
    }));
    expect(holder.refusal, "the window that framed the other one is still the holder").toBe(false);
    expect(holder.failures).not.toContain("SECOND_WINDOW_REFUSED");
  });

  test('data-lahe-frames="allow" boots an embedded document on purpose', async ({ page }) => {
    await page.goto(pages.urlFor("test/fixtures/frames-parent.html"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the framing window to boot"
    });

    // The same shape as the notes frame above, on a page that says it wants to
    // be reviewed while embedded. The opt-in is the whole difference.
    const skipped = await page.evaluate(async () => {
      const frame = document.createElement("iframe");
      frame.id = "embedded";
      frame.src = "/test/fixtures/frames-child-allow.html?receiver";
      const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      document.body.appendChild(frame);
      await loaded;
      const win = frame.contentWindow;
      return {
        booted: !!(win.__lahe && win.__lahe.booted),
        reason: win.LAHE && win.LAHE.layer ? win.LAHE.layer.skipped : "no module"
      };
    });

    expect(skipped.booted, "the opted-in frame boots").toBe(true);
    expect(skipped.reason, "and has nothing to explain").toBe(null);
  });
});
