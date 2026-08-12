// Ranked test 24: the back/forward cache restore.
//
// Owner: 2D (living in the page).
//
//   "bfcache restore. Navigate away, press Back, and the page is restored
//    without a fresh load: assert the remount ran, the records merged, replay
//    ran, and the rail is present."
//
// Why this path and not the ordinary reload. When a browser restores a page
// from the back/forward cache, NOTHING re-runs: not the script tag, not boot,
// not the load-merge. The JavaScript context is the one that was frozen when
// the reviewer left, resumed in place. A library that only ever wires itself
// from a fresh boot comes back to a page it has not looked at since, with a
// store another tab may have written to and a DOM the framework may have
// morphed on the way out. `pageshow` with `persisted` is the only signal there
// is.
//
// THE ASSERTION IS THAT THE REMOUNT RAN, not that the rail is present. The rail
// is present after a fresh load too, so a library with no bfcache handling at
// all passes the weaker version of this test. What separates them is a counter
// that carried across the restore: a fresh load resets it to its boot value,
// and a restore continues it.
//
// And a bfcache test that quietly ran against a fresh load proves nothing, so
// this spec REFUSES to pass silently: it reads `persisted` out of the pageshow
// event the library recorded, and skips with a loud message when the engine
// declined to cache the page.

"use strict";

const { test: base, expect, pollPage } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const { withLayer } = require("./support/with_layer");

const REVIEW = "bfcache-review";
const TOKEN = "bfcache-token";
const HELPER = "http://127.0.0.1:1";

const test = base.extend({
  appServer: async function ({}, use) {
    const server = await startAppServer();
    await use(server);
    await server.close();
  }
});

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
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("ranked test 24: restored from the back/forward cache", () => {
  test("Back restores the page, and the remount, the merge and replay all run", async ({
    page,
    appServer
  }, testInfo) => {
    await withLayer(page, { review: REVIEW, token: TOKEN, helper: HELPER });
    await page.goto(appServer.urlFor("/clients?morph=raw&poll=200"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });

    // Work outstanding before the reviewer leaves the page.
    await commentOnSelection(page, ".lede", "Say which four, and why those four.");
    const left = await page.evaluate(() => ({
      items: window.__lahe.items().map((i) => i.id),
      remounts: window.__lahe.counters.remounts,
      merges: window.__lahe.counters.merges,
      replayPasses: window.__lahe.counters.replayPasses,
      // The value that cannot survive a fresh load, which is what makes the
      // skip below honest rather than decorative.
      bootStamp: (window.__laheBfcacheStamp = Math.random().toString(36).slice(2))
    }));
    expect(left.items.length).toBe(1);

    // Away, by clicking a link like a person.
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page.locator("h1")).toHaveText("Coach dashboard");

    // And Back.
    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Clients");
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to be there after Back"
    });
    // Give the restore's replay pass its frame. Swallowed on purpose: when the
    // engine refused to cache the page this counter starts again from zero, and
    // the loud skip below is the right answer to that, not a timeout here.
    await pollPage(page, (from) => window.__lahe.counters.replayPasses > from, left.replayPasses, {
      message: "the restore's replay pass to run",
      timeoutMs: 2000
    }).catch(() => {});

    const restored = await page.evaluate(() => {
      const last = window.__lahe.lastRemount();
      const log = window.__lahe.remountLog();
      return {
        sameContext: window.__laheBfcacheStamp || null,
        persistedSeen: log.some((entry) => entry.persisted === true),
        lastReason: last ? last.reason : null,
        lastPersisted: last ? last.persisted === true : false,
        bfcacheRestores: window.__lahe.counters.bfcacheRestores,
        remounts: window.__lahe.counters.remounts,
        merges: window.__lahe.counters.merges,
        replayPasses: window.__lahe.counters.replayPasses,
        hosts: document.querySelectorAll("#" + window.__lahe.rootId).length,
        items: window.__lahe.items().map((i) => i.id),
        cards: window.__lahe.cardIds()
      };
    });

    // LOUD SKIP, never a quiet pass. If the engine refused to cache the page we
    // are looking at a fresh load, every assertion below would pass for the
    // wrong reason, and the run has to say so.
    const refused = restored.sameContext !== left.bootStamp || !restored.persistedSeen;
    if (refused) {
      const why =
        "BFCACHE REFUSED by " +
        testInfo.project.name +
        ": the page came back " +
        (restored.sameContext !== left.bootStamp ? "in a NEW JavaScript context" : "without persisted=true") +
        ", so this is a fresh load and not a restore. Nothing about the bfcache path was tested. " +
        "Context: " +
        JSON.stringify(restored);
      testInfo.annotations.push({ type: "bfcache-refused", description: why });
      // eslint-disable-next-line no-console
      console.warn(why);
      test.skip(true, why);
      return;
    }

    // The restore really was a restore: same context, and the browser said so.
    expect(restored.lastPersisted).toBe(true);
    expect(restored.lastReason).toBe("pageshow-persisted");
    expect(restored.bfcacheRestores).toBeGreaterThanOrEqual(1);

    // The remount RAN. This is the assertion, and it is a counter that carried
    // across the restore rather than the rail's presence.
    expect(restored.remounts).toBeGreaterThan(left.remounts);

    // The records merged, and replay ran after the remount.
    expect(restored.merges).toBeGreaterThan(left.merges);
    expect(restored.replayPasses).toBeGreaterThan(left.replayPasses);

    // And the rail is there, once, holding the reviewer's outstanding work.
    expect(restored.hosts).toBe(1);
    expect(restored.items).toEqual(left.items);
    expect(restored.cards).toEqual(expect.arrayContaining(left.items));
  });

  // -------------------------------------------------------------------------
  // The same code path, driven deterministically
  // -------------------------------------------------------------------------
  //
  // NO ENGINE UNDER PLAYWRIGHT WILL BFCACHE A PAGE. Chromium is launched with
  // --disable-back-forward-cache and re-enabling the switch does not help,
  // because a page with a CDP client attached is not eligible either; Firefox
  // and WebKit under automation refused it in every configuration tried
  // (2d_builder_notes.md records the probe). So the test above is honest and
  // skips, and this one drives the SAME handler with a real pageshow event
  // carrying persisted=true.
  //
  // What it does and does not prove: it proves the persisted branch runs the
  // remount, the merge and replay, and that a persisted pageshow is told apart
  // from the fresh-load one. It does not prove the browser froze and thawed the
  // page. The test above is the one that will prove that, on the day an engine
  // allows it, and it is written so that day needs no new code.
  test("the persisted pageshow branch remounts, merges and replays", async ({ page, appServer }) => {
    await withLayer(page, { review: REVIEW + "-2", token: TOKEN, helper: HELPER });
    await page.goto(appServer.urlFor("/?morph=raw&poll=200"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });
    await commentOnSelection(page, ".lede", "Nine and four again.");

    const before = await page.evaluate(() => ({
      remounts: window.__lahe.counters.remounts,
      merges: window.__lahe.counters.merges,
      replayPasses: window.__lahe.counters.replayPasses,
      bfcacheRestores: window.__lahe.counters.bfcacheRestores,
      items: window.__lahe.items().map((i) => i.id)
    }));

    // A framework ate the root while the page was frozen, which is the state a
    // restore can wake up in.
    const fired = await page.evaluate(() => {
      const host = document.getElementById(window.__lahe.rootId);
      if (host) host.remove();
      const event =
        typeof PageTransitionEvent === "function"
          ? new PageTransitionEvent("pageshow", { persisted: true })
          : (function () {
              const e = new Event("pageshow");
              Object.defineProperty(e, "persisted", { value: true });
              return e;
            })();
      window.dispatchEvent(event);
      return event.persisted === true;
    });
    expect(fired).toBe(true);

    // replay.schedule coalesces onto an animation frame, so the pass lands a
    // frame after the event rather than inside it. Polling for the counter is
    // the difference between asserting replay ran and asserting it ran fast.
    await pollPage(
      page,
      (from) => window.__lahe.counters.replayPasses > from,
      before.replayPasses,
      { message: "the remount's replay pass to run" }
    );

    const after = await page.evaluate(() => {
      const last = window.__lahe.lastRemount();
      return {
        lastReason: last ? last.reason : null,
        lastPersisted: last ? last.persisted === true : false,
        remounts: window.__lahe.counters.remounts,
        merges: window.__lahe.counters.merges,
        replayPasses: window.__lahe.counters.replayPasses,
        bfcacheRestores: window.__lahe.counters.bfcacheRestores,
        rootsRecreated: window.__lahe.counters.rootsRecreated,
        hosts: document.querySelectorAll("#" + window.__lahe.rootId).length,
        items: window.__lahe.items().map((i) => i.id),
        cards: window.__lahe.cardIds(),
        groups: window.__lahe.listenerGroups()
      };
    });

    // The restore branch, told apart from the fresh-load pageshow by name.
    expect(after.lastPersisted).toBe(true);
    expect(after.lastReason).toBe("pageshow-persisted");
    expect(after.bfcacheRestores).toBe(before.bfcacheRestores + 1);

    // The remount ran, the records merged, replay ran.
    expect(after.remounts).toBe(before.remounts + 1);
    expect(after.merges).toBeGreaterThan(before.merges);
    expect(after.replayPasses).toBeGreaterThan(before.replayPasses);

    // The rail is back, once, with the reviewer's work on it.
    expect(after.rootsRecreated).toBeGreaterThanOrEqual(1);
    expect(after.hosts).toBe(1);
    expect(after.items).toEqual(before.items);
    expect(after.cards).toEqual(expect.arrayContaining(before.items));

    // No handler doubled by the restore.
    expect(after.groups.navigation).toBe(4);
    expect(after.groups.comments).toBe(3);

    // And the reviewer can still work on the page that woke up.
    await commentOnSelection(page, "h1", "The dashboard heading should name the day.");
    await pollPage(page, () => window.__lahe.items().length === 2, undefined, {
      message: "one more item from one more gesture on the woken page"
    });
  });
});
